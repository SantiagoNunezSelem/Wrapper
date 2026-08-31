using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Periodically re-reads the subscriptions Mercado Pago may have moved without telling us.
///
/// The webhook is the fast path and stays authoritative, but it is a single point of
/// failure with a long tail of silent modes: the topic was never ticked in the panel, the
/// signing secret was rotated, a deploy swallowed the delivery, the retry budget expired
/// while the host was restarting. Every one of those ends the same way — someone's card was
/// charged and the app still shows "pendiente". Polling a small batch on a timer turns that
/// from a support ticket into a delay of at most one interval.
///
/// Deliberately modest: it only looks at rows that are actually in motion (see
/// <see cref="SubscriptionService.ReconcileAsync"/>), so a healthy account costs nothing.
/// </summary>
public sealed class SubscriptionReconciliationService(
    IServiceScopeFactory scopeFactory,
    IOptions<MercadoPagoOptions> options,
    ILogger<SubscriptionReconciliationService> logger) : BackgroundService
{
    private readonly MercadoPagoOptions _options = options.Value;

    /// <summary>How many subscriptions one pass may touch. Each costs two or three calls
    /// to Mercado Pago, so the cap is what keeps a backlog from turning into a burst
    /// against their rate limits.</summary>
    private const int BatchSize = 25;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (_options.ReconcileIntervalMinutes <= 0 || !_options.IsConfigured)
        {
            logger.LogInformation("Subscription reconciliation is off (no interval, or Mercado Pago is not configured).");
            return;
        }

        var interval = TimeSpan.FromMinutes(_options.ReconcileIntervalMinutes);

        // A short delay before the first pass: starting up is exactly when the database
        // is being created and seeded, and there is nothing to reconcile yet anyway.
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(interval);

        do
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var subscriptions = scope.ServiceProvider.GetRequiredService<SubscriptionService>();

                var changed = await subscriptions.ReconcileAsync(BatchSize, stoppingToken);

                if (changed > 0)
                {
                    logger.LogInformation("Reconciliation pass updated {Count} subscription(s).", changed);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                // Never let one bad pass kill the loop: the next one is the recovery.
                logger.LogError(exception, "A subscription reconciliation pass failed.");
            }
        }
        while (await SafeWaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken stoppingToken)
    {
        try
        {
            return await timer.WaitForNextTickAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
