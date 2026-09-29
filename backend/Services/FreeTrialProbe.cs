using backend.Data;
using Microsoft.EntityFrameworkCore;

namespace backend.Services;

/// <summary>
/// Checks, against Mercado Pago itself, that the free week is really part of the
/// subscriptions we open — the panel's "Prueba gratis en Mercado Pago" row.
///
/// The checkout sends <c>auto_recurring.free_trial</c> on a preapproval <b>without</b> a
/// plan, and the API reference only documents that field on <c>/preapproval_plan</c>. If
/// Mercado Pago quietly dropped it, every "7 días gratis" customer would be charged on day
/// one while the app promises otherwise — and nothing in our own data would show it. So
/// this reads back the newest real preapproval opened with the trial and looks for the
/// field in what Mercado Pago stored.
///
/// A preapproval's terms do not change after it is created, so an answer is cached per
/// preapproval id: the panel reloads freely without turning every visit into a call.
/// </summary>
public sealed class FreeTrialProbe(
    AppDbContext db,
    MercadoPagoClient client,
    ILogger<FreeTrialProbe> logger)
{
    public const string Key = "free_trial";

    private static readonly TimeSpan CacheFor = TimeSpan.FromHours(1);
    private static readonly Lock Gate = new();
    private static (string PreapprovalId, IntegrationStatus Status, DateTime FetchedAtUtc)? _cached;

    public async Task<IntegrationStatus> CheckAsync(CancellationToken cancellationToken)
    {
        if (!client.IsConfigured)
        {
            return new IntegrationStatus(Key, IntegrationStates.Off, null);
        }

        // Rows whose week was handed back (a discarded or replaced checkout) are left out
        // on purpose: TrialWasApplied is cleared then, and they prove nothing either way.
        var preapprovalId = await db.Subscriptions
            .Where(item =>
                item.TrialWasApplied &&
                !item.IsDevSimulated &&
                item.ExternalSubscriptionId != null)
            .OrderByDescending(item => item.CreatedAtUtc)
            .Select(item => item.ExternalSubscriptionId)
            .FirstOrDefaultAsync(cancellationToken);

        if (preapprovalId is null)
        {
            return new IntegrationStatus(Key, IntegrationStates.Off, null);
        }

        lock (Gate)
        {
            if (_cached is { } hit &&
                hit.PreapprovalId == preapprovalId &&
                DateTime.UtcNow - hit.FetchedAtUtc < CacheFor)
            {
                return hit.Status;
            }
        }

        IntegrationStatus status;
        try
        {
            var preapproval = await client.GetSubscriptionAsync(preapprovalId, cancellationToken);
            var trial = preapproval?.AutoRecurring?.FreeTrial;

            status = preapproval is null
                // Not cached: a 404 here is more likely credentials pointing at another
                // account than a verdict about the trial.
                ? new IntegrationStatus(Key, IntegrationStates.Warn, preapprovalId)
                : trial is { Frequency: > 0 }
                    ? new IntegrationStatus(Key, IntegrationStates.Ok, $"{preapprovalId} · {trial.Frequency} {trial.FrequencyType}")
                    : new IntegrationStatus(Key, IntegrationStates.Bad, preapprovalId);
        }
        catch (MercadoPagoException exception)
        {
            logger.LogWarning(exception, "Could not read preapproval {PreapprovalId} to check its free trial.", preapprovalId);
            return new IntegrationStatus(Key, IntegrationStates.Warn, preapprovalId);
        }

        if (status.State != IntegrationStates.Warn)
        {
            lock (Gate)
            {
                _cached = (preapprovalId, status, DateTime.UtcNow);
            }
        }

        if (status.State == IntegrationStates.Bad)
        {
            logger.LogError(
                "Preapproval {PreapprovalId} was opened with a free trial but Mercado Pago did not keep it: the first charge will not wait.",
                preapprovalId);
        }

        return status;
    }

    /// <summary>For tests: the cache is static, so one test's answer must not leak into the next.</summary>
    internal static void ResetCache()
    {
        lock (Gate)
        {
            _cached = null;
        }
    }
}
