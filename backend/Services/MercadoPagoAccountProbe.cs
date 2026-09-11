namespace backend.Services;

/// <summary>
/// Asks Mercado Pago who the configured token belongs to, at most once an hour. The answer
/// only changes when someone swaps the token, and the panel asks on every visit to
/// Urgencias and Sistema — so it is cached across requests, not per request.
/// </summary>
public sealed class MercadoPagoAccountProbe(MercadoPagoClient client, ILogger<MercadoPagoAccountProbe> logger)
{
    private static readonly TimeSpan CacheFor = TimeSpan.FromHours(1);
    private static readonly Lock Gate = new();
    private static (MercadoPagoAccount? Account, DateTime FetchedAtUtc)? _cached;

    /// <summary>Null when there is no token to ask about, or Mercado Pago could not be reached.</summary>
    public async Task<MercadoPagoAccount?> GetAsync(CancellationToken cancellationToken)
    {
        if (!client.IsConfigured)
        {
            return null;
        }

        lock (Gate)
        {
            if (_cached is { } hit && DateTime.UtcNow - hit.FetchedAtUtc < CacheFor)
            {
                return hit.Account;
            }
        }

        try
        {
            var account = await client.GetAccountAsync(cancellationToken);
            lock (Gate)
            {
                _cached = (account, DateTime.UtcNow);
            }

            return account;
        }
        catch (MercadoPagoException exception)
        {
            logger.LogWarning(exception, "Could not ask Mercado Pago who the access token belongs to.");
            return null;
        }
    }
}
