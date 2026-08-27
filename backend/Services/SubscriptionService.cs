using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// The whole subscription lifecycle in one place: opening a checkout, applying what
/// Mercado Pago reports, cancelling, and reconciling.
///
/// One rule governs everything here — <b>Mercado Pago decides, we record</b>. Local
/// state is never advanced optimistically (no "assume it worked" after a redirect),
/// because the only thing that actually moves money is on their side. Every state
/// change re-reads the resource and writes a <see cref="SubscriptionEvent"/>, so the
/// history screen and any future billing dispute have a real trail.
/// </summary>
public sealed class SubscriptionService(
    AppDbContext db,
    MercadoPagoClient client,
    TrialEligibilityService trialEligibility,
    IOptions<MercadoPagoOptions> options,
    ILogger<SubscriptionService> logger)
{
    private readonly MercadoPagoOptions _options = options.Value;

    // ---------------------------------------------------------------------------
    // Reading
    // ---------------------------------------------------------------------------

    public PlanInfo GetPlanInfo() =>
        new(
            _options.TransactionAmount,
            _options.CurrencyId,
            _options.Frequency,
            _options.FrequencyType,
            _options.TrialFrequency,
            _options.TrialFrequencyType,
            _options.Reason,
            client.IsConfigured);

    /// <summary>
    /// Mercado Pago's own subscription page, where the payer replaces the card behind a
    /// running subscription. There is no API for that — no endpoint accepts a new card
    /// token for an existing preapproval — so the honest move is to send them where it
    /// actually works instead of building a form that cannot save.
    /// </summary>
    public string? GetManageUrl() =>
        string.IsNullOrWhiteSpace(_options.ManageUrl) ? null : _options.ManageUrl;

    public async Task<IReadOnlyList<SubscriptionInvoice>> GetInvoicesAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.SubscriptionInvoices
            .Where(invoice => invoice.UserId == userId)
            .OrderByDescending(invoice => invoice.PeriodStartUtc ?? invoice.PaidAtUtc ?? invoice.CreatedAtUtc)
            .Take(60)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<SubscriptionEvent>> GetEventsAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.SubscriptionEvents
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(60)
            .ToListAsync(cancellationToken);

    // ---------------------------------------------------------------------------
    // Checkout
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Opens a checkout: a local "pendiente" row and the URL to send the payer's browser
    /// to.
    ///
    /// The preapproval is created here, per payer, with <c>status: "pending"</c> and no
    /// card token (see <see cref="MercadoPagoClient.CreateSubscriptionAsync"/>), so this
    /// method already knows its id and has stamped <c>external_reference</c> with the
    /// local row's — which is what stops a completed payment from being stranded on
    /// "pendiente". The older route, redirecting to the shared plan's <c>init_point</c>,
    /// is kept as a fallback for accounts where <c>POST /preapproval</c> is refused; it
    /// works, but nothing links back to the local row except the payer's Mercado Pago
    /// account email, which is often not the address they signed in with.
    /// </summary>
    public async Task<CheckoutResult> StartCheckoutAsync(
        User user,
        HttpContext http,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        if (!client.IsConfigured)
        {
            throw new MercadoPagoException("Mercado Pago is not configured: set MercadoPago:AccessToken.");
        }

        if (SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user) is { } current &&
            current.Status is "activa" or "trial" &&
            !current.IsDevSimulated)
        {
            throw new SubscriptionConflictException("already_active", "This account already has an active subscription.");
        }

        // A checkout left half-finished is resumed, never duplicated. Mercado Pago keeps a
        // pending preapproval's init_point valid until it is authorised, so opening a
        // second one would leave the payer with two authorisable subscriptions — and the
        // very real chance of two monthly charges.
        if (FindResumableCheckout(user) is { CheckoutUrl: { Length: > 0 } resumeUrl } resumable)
        {
            return new CheckoutResult(
                resumable.Status,
                resumable.Id,
                resumable.TrialWasApplied,
                null,
                resumeUrl,
                Resumed: true);
        }

        var eligibility = await trialEligibility.EvaluateAsync(user, http, deviceId, cancellationToken);

        // Built but not tracked yet: ResolvePlanIdAsync saves the context on the fallback
        // path, and a half-built row must not be written before Mercado Pago has accepted
        // anything. Its Id exists from construction, which is what external_reference
        // carries.
        var subscription = new Subscription
        {
            UserId = user.Id,
            Status = "pendiente",
            PlanType = "mensual",
            PaymentProvider = "mercadopago",
            Amount = _options.TransactionAmount,
            CurrencyId = _options.CurrencyId,
            TrialWasApplied = eligibility.IsEligible,
        };

        var redirectUrl = await OpenProviderCheckoutAsync(user, subscription, eligibility.IsEligible, cancellationToken);

        subscription.CheckoutUrl = redirectUrl;

        db.Subscriptions.Add(subscription);
        user.Subscriptions.Add(subscription);

        // Burned here, not on conversion: an abandoned checkout still consumes the offer,
        // the conservative direction (see TrialEligibilityService.Claim).
        if (eligibility.IsEligible)
        {
            trialEligibility.Claim(user, subscription, eligibility.Identity);
        }

        RecordEvent(
            subscription,
            "checkout",
            action: eligibility.IsEligible ? "trial" : "no_trial",
            externalEventId: null,
            notes: eligibility.Reason is { } reason ? $"trial denied: {reason}" : null);

        await db.SaveChangesAsync(cancellationToken);

        return new CheckoutResult(subscription.Status, subscription.Id, eligibility.IsEligible, eligibility.Reason, redirectUrl);
    }

    /// <summary>
    /// The still-usable checkout on this account, if there is one. Only a row that
    /// Mercado Pago has not authorised counts, and only while the link is young enough to
    /// still be the same offer — a month-old "pendiente" is an abandoned attempt, not a
    /// payment in progress, and its price may not even be current any more.
    /// </summary>
    private Subscription? FindResumableCheckout(User user) =>
        user.Subscriptions
            .Where(item =>
                item.Status == "pendiente" &&
                !item.IsDevSimulated &&
                !string.IsNullOrWhiteSpace(item.CheckoutUrl) &&
                item.CreatedAtUtc >= DateTime.UtcNow.AddHours(-_options.PendingCheckoutHours))
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefault();

    /// <summary>
    /// Asks Mercado Pago for a checkout URL, preferring the per-payer preapproval and
    /// falling back to the shared plan link. The fallback exists because
    /// <c>POST /preapproval</c> is not available on every account or country, and losing
    /// checkout entirely would be a far worse failure than losing the id up front.
    /// </summary>
    private async Task<string> OpenProviderCheckoutAsync(
        User user,
        Subscription subscription,
        bool withTrial,
        CancellationToken cancellationToken)
    {
        if (_options.UseDirectPreapproval)
        {
            try
            {
                var preapproval = await client.CreateSubscriptionAsync(
                    user.Email,
                    subscription.Id.ToString(),
                    withTrial,
                    cancellationToken);

                var initPoint = preapproval.InitPoint ?? preapproval.SandboxInitPoint;
                if (!string.IsNullOrWhiteSpace(preapproval.Id) && !string.IsNullOrWhiteSpace(initPoint))
                {
                    // Stored before the redirect — the whole point of this path.
                    subscription.ExternalSubscriptionId = preapproval.Id;
                    subscription.ExternalPlanId = preapproval.PreapprovalPlanId;

                    if (withTrial)
                    {
                        subscription.TrialStartsAtUtc = DateTime.UtcNow;
                    }

                    return initPoint;
                }

                logger.LogWarning(
                    "Mercado Pago accepted the preapproval but returned no usable init_point (id {Id}); falling back to the plan link.",
                    preapproval.Id);
            }
            catch (MercadoPagoException exception)
            {
                logger.LogWarning(
                    exception,
                    "POST /preapproval was refused; falling back to the shared plan checkout. The subscription will have to be linked by payer email.");
            }
        }

        var planId = await ResolvePlanIdAsync(withTrial, cancellationToken);
        var plan = await client.GetPlanAsync(planId, cancellationToken);

        if (string.IsNullOrWhiteSpace(plan?.InitPoint))
        {
            throw new MercadoPagoException("Mercado Pago did not return a checkout URL for this plan.");
        }

        subscription.ExternalPlanId = planId;
        return plan.InitPoint;
    }

    // ---------------------------------------------------------------------------
    // Cancellation
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Turns off automatic renewal. Access is intentionally *not* revoked: the customer
    /// keeps what their last charge already bought, which is both the stated policy and
    /// the thing that keeps cancellations from turning into refund requests.
    ///
    /// Cancelling inside the free week is the case worth being precise about — Mercado
    /// Pago's own engine is what schedules the first debit, so removing the preapproval
    /// before that date means the charge is never attempted at all. That is a stronger
    /// promise than "we will refund you", and the screen is allowed to say it because
    /// <see cref="CancellationOutcome.NothingWillBeCharged"/> is decided from the state
    /// Mercado Pago just confirmed, not from what the customer clicked.
    /// </summary>
    public async Task<CancellationOutcome> CancelAsync(User user, CancellationToken cancellationToken)
    {
        var subscription = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user)
            ?? throw new SubscriptionConflictException("no_subscription", "There is no subscription to cancel.");

        // Read before the status is overwritten: afterwards there is no way to tell a
        // cancellation during the free week from one after a paid month.
        var wasInTrial = subscription.Status == "trial" ||
                         (subscription.TrialEndsAtUtc is { } trialEnd && trialEnd > DateTime.UtcNow && subscription.LastPaymentAtUtc is null);

        if (subscription.Status is "cancelada")
        {
            return CancellationOutcome.From(subscription, wasInTrial, alreadyCancelled: true);
        }

        if (subscription.IsDevSimulated)
        {
            // The local toggle never touched Mercado Pago, so neither does cancelling it.
            subscription.Status = "cancelada";
            subscription.CancelledAtUtc = DateTime.UtcNow;
            subscription.NextBillingAtUtc = null;
            subscription.TrialEndsAtUtc = null;
            subscription.UpdatedAtUtc = DateTime.UtcNow;
            RecordEvent(subscription, "dev", "cancel", null, "Simulated subscription cancelled locally.");
            await db.SaveChangesAsync(cancellationToken);
            return CancellationOutcome.From(subscription, wasInTrial, alreadyCancelled: false);
        }

        if (string.IsNullOrWhiteSpace(subscription.ExternalSubscriptionId))
        {
            // An unlinked row that is still "pendiente" is an abandoned checkout: nothing
            // was ever authorised on Mercado Pago's side, so there is nothing to cancel
            // there — but leaving it standing keeps offering to resume a payment the
            // customer has just said they do not want. Closing it locally is both honest
            // and the only thing that can be done.
            if (subscription.Status == "pendiente")
            {
                subscription.Status = "cancelada";
                subscription.CancelledAtUtc = DateTime.UtcNow;
                subscription.CheckoutUrl = null;
                subscription.UpdatedAtUtc = DateTime.UtcNow;
                RecordEvent(subscription, "cancel", "abandoned_checkout", null, "Checkout closed before Mercado Pago authorised it.");
                await db.SaveChangesAsync(cancellationToken);
                return CancellationOutcome.From(subscription, wasInTrial, alreadyCancelled: false);
            }

            // Anything else unlinked is a row we cannot reason about — an active
            // subscription with no provider id should not exist — and quietly marking it
            // cancelled would tell the customer their billing stopped without stopping
            // anything.
            throw new SubscriptionConflictException("not_linked", "This subscription is not linked to Mercado Pago.");
        }

        var updated = await client.CancelSubscriptionAsync(subscription.ExternalSubscriptionId, cancellationToken);

        if (updated is not null)
        {
            ApplyPreapproval(subscription, updated);
        }

        // Applied after the mapping, not before: ApplyPreapproval trusts the provider's
        // status, and a just-cancelled preapproval sometimes still reads as authorized for
        // a moment.
        subscription.Status = "cancelada";
        subscription.CancelledAtUtc ??= DateTime.UtcNow;
        subscription.CheckoutUrl = null;
        subscription.UpdatedAtUtc = DateTime.UtcNow;

        RecordEvent(subscription, "cancel", "user_requested", null, wasInTrial ? "Cancelled during the free trial." : null);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("User {UserId} cancelled subscription {SubscriptionId}.", user.Id, subscription.Id);
        return CancellationOutcome.From(subscription, wasInTrial, alreadyCancelled: false);
    }

    /// <summary>
    /// Suspends debits without giving up the subscription: the card stays on file and
    /// <see cref="ResumeAsync"/> puts it back. Offered because the alternative most people
    /// reach for — cancelling because this month is tight — costs them their price and
    /// their history, and costs us the customer.
    /// </summary>
    public async Task<Subscription> PauseAsync(User user, CancellationToken cancellationToken)
    {
        var subscription = RequireLinkedSubscription(user, "pause");

        if (subscription.Status is "pausada")
        {
            return subscription;
        }

        if (subscription.Status is not ("activa" or "trial" or "pago_fallido"))
        {
            throw new SubscriptionConflictException("not_pausable", "Only a running subscription can be paused.");
        }

        var updated = await client.PauseSubscriptionAsync(subscription.ExternalSubscriptionId!, cancellationToken);

        if (updated is not null)
        {
            ApplyPreapproval(subscription, updated);
        }

        subscription.Status = "pausada";
        subscription.PausedAtUtc ??= DateTime.UtcNow;
        subscription.UpdatedAtUtc = DateTime.UtcNow;

        RecordEvent(subscription, "pause", "user_requested", null, null);
        await db.SaveChangesAsync(cancellationToken);

        return subscription;
    }

    /// <summary>Puts a paused subscription back on its schedule.</summary>
    public async Task<Subscription> ResumeAsync(User user, CancellationToken cancellationToken)
    {
        var subscription = RequireLinkedSubscription(user, "resume");

        if (subscription.Status is not "pausada")
        {
            throw new SubscriptionConflictException("not_paused", "Only a paused subscription can be resumed.");
        }

        var updated = await client.ResumeSubscriptionAsync(subscription.ExternalSubscriptionId!, cancellationToken);

        if (updated is not null)
        {
            ApplyPreapproval(subscription, updated);
        }
        else
        {
            subscription.Status = "activa";
        }

        subscription.PausedAtUtc = null;
        subscription.UpdatedAtUtc = DateTime.UtcNow;

        RecordEvent(subscription, "resume", "user_requested", null, null);
        await db.SaveChangesAsync(cancellationToken);

        return subscription;
    }

    private static Subscription RequireLinkedSubscription(User user, string action)
    {
        var subscription = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user)
            ?? throw new SubscriptionConflictException("no_subscription", $"There is no subscription to {action}.");

        if (subscription.IsDevSimulated || string.IsNullOrWhiteSpace(subscription.ExternalSubscriptionId))
        {
            throw new SubscriptionConflictException("not_linked", "This subscription is not linked to Mercado Pago.");
        }

        return subscription;
    }

    // ---------------------------------------------------------------------------
    // Reconciliation
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Re-reads the subscription and its charges straight from Mercado Pago. Webhooks
    /// get lost — a deploy mid-delivery, an expired tunnel in development — and without
    /// a way to catch up, a paying customer would simply stay locked out. This is also
    /// what the checkout return page calls, since the redirect usually beats the
    /// notification.
    /// </summary>
    public async Task<Subscription?> SyncAsync(User user, CancellationToken cancellationToken)
    {
        if (!client.IsConfigured)
        {
            return SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user);
        }

        // Newest attempt first, by when it was opened rather than when it was last
        // touched: a resubscription supersedes whatever came before it, and ordering by
        // UpdatedAtUtc would let a cancelled row that a webhook happened to touch
        // afterwards win over the subscription the customer is actually holding.
        var subscription = user.Subscriptions
            .Where(item => !string.IsNullOrWhiteSpace(item.ExternalSubscriptionId) && !item.IsDevSimulated)
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefault();

        // A row opened through the shared plan link starts with no id — Mercado Pago only
        // hands one out once the payer finishes on their own hosted page, and the link
        // carries nothing that points back here. Look it up by payer email, the same
        // signal the webhook handler falls back to in FindSubscriptionAsync. Checkouts
        // opened the normal way never reach this: they already have their id.
        if (subscription is null)
        {
            var pending = user.Subscriptions
                .Where(item => item.Status == "pendiente" && string.IsNullOrWhiteSpace(item.ExternalSubscriptionId))
                .OrderByDescending(item => item.CreatedAtUtc)
                .FirstOrDefault();

            if (pending is not null)
            {
                var candidates = await client.SearchSubscriptionsByPayerEmailAsync(user.Email, cancellationToken);
                var found = candidates
                    .Where(candidate => candidate.Id is not null && candidate.PreapprovalPlanId == pending.ExternalPlanId)
                    .OrderByDescending(candidate => candidate.DateCreated)
                    .FirstOrDefault();

                if (found is not null)
                {
                    pending.ExternalSubscriptionId = found.Id;
                    subscription = pending;
                }
            }
        }

        if (subscription is null)
        {
            return SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user);
        }

        var preapproval = await client.GetSubscriptionAsync(subscription.ExternalSubscriptionId!, cancellationToken);
        if (preapproval is null)
        {
            return subscription;
        }

        var previousStatus = subscription.Status;
        ApplyPreapproval(subscription, preapproval);

        foreach (var payment in await client.SearchAuthorizedPaymentsAsync(subscription.ExternalSubscriptionId!, cancellationToken))
        {
            await UpsertInvoiceAsync(subscription, payment, cancellationToken);
        }

        // The authorized_payments list carries the subscription's own scheduled charges,
        // but only /v1/payments knows *why* one is unsettled. Reading it for the newest
        // unsettled charge is what turns a bare "pendiente" into "tu banco tiene que
        // confirmar el pago" — one extra call, and only when something is actually stuck.
        await RefreshPendingReasonAsync(subscription, cancellationToken);

        subscription.LastSyncedAtUtc = DateTime.UtcNow;

        if (previousStatus != subscription.Status)
        {
            RecordEvent(subscription, "sync", previousStatus, null, $"{previousStatus} → {subscription.Status}");
        }

        await db.SaveChangesAsync(cancellationToken);
        return subscription;
    }

    /// <summary>
    /// Reads <c>status_detail</c> off the newest charge that has not settled, so the
    /// account screen can explain the delay instead of restating it. Failures here are
    /// swallowed: an explanation is a nicety, and losing it must never cost the caller the
    /// status update it came for.
    /// </summary>
    private async Task RefreshPendingReasonAsync(Subscription subscription, CancellationToken cancellationToken)
    {
        var unsettled = await db.SubscriptionInvoices
            .Where(invoice =>
                invoice.SubscriptionId == subscription.Id &&
                (invoice.Status == "pendiente" || invoice.Status == "rechazado" || invoice.Status == "reintentando") &&
                invoice.ExternalTransactionId != null)
            .OrderByDescending(invoice => invoice.UpdatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        if (unsettled is null)
        {
            subscription.LastPaymentStatusDetail = null;
            return;
        }

        try
        {
            var payment = await client.GetPaymentAsync(unsettled.ExternalTransactionId!, cancellationToken);
            if (payment?.StatusDetail is { Length: > 0 } detail)
            {
                unsettled.StatusDetail = detail;
                unsettled.UpdatedAtUtc = DateTime.UtcNow;
                subscription.LastPaymentStatusDetail = detail;
            }
        }
        catch (MercadoPagoException exception)
        {
            logger.LogDebug(exception, "Could not read the payment behind invoice {InvoiceId}.", unsettled.Id);
        }
    }

    /// <summary>
    /// Re-reads every subscription Mercado Pago may have moved without us hearing about
    /// it, and hands back how many actually changed.
    ///
    /// This is the safety net under the webhook, not a substitute for it. A notification
    /// can be lost for reasons that leave no trace on our side — the topic was never
    /// enabled in the panel, the secret was rotated, a deploy ate the delivery, the retry
    /// budget ran out while the host was down — and every one of those ends with a paying
    /// customer locked out of what they bought. Polling a handful of rows on a timer is a
    /// cheap price for that never being a support ticket.
    /// </summary>
    public async Task<int> ReconcileAsync(int batchSize, CancellationToken cancellationToken)
    {
        if (!client.IsConfigured)
        {
            return 0;
        }

        var now = DateTime.UtcNow;
        var checkoutFloor = now.AddHours(-_options.PendingCheckoutHours);

        var candidates = await db.Subscriptions
            .Where(item =>
                !item.IsDevSimulated &&
                item.ExternalSubscriptionId != null &&
                (
                    // Waiting on the payer, or on Mercado Pago's own processing.
                    (item.Status == "pendiente" && item.CreatedAtUtc >= checkoutFloor) ||
                    // A retry may have gone through since the rejection.
                    item.Status == "pago_fallido" ||
                    // The renewal was due and we were never told how it went.
                    ((item.Status == "activa" || item.Status == "trial") &&
                     item.NextBillingAtUtc != null &&
                     item.NextBillingAtUtc < now)
                ))
            .OrderBy(item => item.LastSyncedAtUtc ?? item.CreatedAtUtc)
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        var changed = 0;

        foreach (var subscription in candidates)
        {
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                var preapproval = await client.GetSubscriptionAsync(subscription.ExternalSubscriptionId!, cancellationToken);
                if (preapproval is null)
                {
                    subscription.LastSyncedAtUtc = now;
                    continue;
                }

                var previousStatus = subscription.Status;
                ApplyPreapproval(subscription, preapproval);

                foreach (var payment in await client.SearchAuthorizedPaymentsAsync(subscription.ExternalSubscriptionId!, cancellationToken))
                {
                    await UpsertInvoiceAsync(subscription, payment, cancellationToken);
                }

                await RefreshPendingReasonAsync(subscription, cancellationToken);
                subscription.LastSyncedAtUtc = DateTime.UtcNow;

                if (previousStatus != subscription.Status)
                {
                    RecordEvent(subscription, "reconcile", previousStatus, null, $"{previousStatus} → {subscription.Status}");
                    changed++;

                    logger.LogInformation(
                        "Reconciler moved subscription {SubscriptionId} {Previous} → {Current}; the notification for it never arrived.",
                        subscription.Id,
                        previousStatus,
                        subscription.Status);
                }
            }
            catch (MercadoPagoException exception)
            {
                // One unreachable subscription must not stop the rest of the batch.
                logger.LogWarning(exception, "Could not reconcile subscription {SubscriptionId}.", subscription.Id);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        return changed;
    }

    // ---------------------------------------------------------------------------
    // Webhooks
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Applies one verified notification. The body is treated as a doorbell, not as
    /// data: it says which resource changed, and the resource is then fetched over an
    /// authenticated connection. That way a forged payload — should one ever get past
    /// the signature check — still cannot invent a payment.
    /// </summary>
    public async Task HandleNotificationAsync(
        string topic,
        string? action,
        string dataId,
        string rawBody,
        CancellationToken cancellationToken)
    {
        switch (topic)
        {
            case "subscription_preapproval":
            case "preapproval":
                await HandlePreapprovalNotificationAsync(topic, action, dataId, rawBody, cancellationToken);
                break;

            case "subscription_authorized_payment":
            case "authorized_payment":
                await HandleAuthorizedPaymentNotificationAsync(topic, action, dataId, rawBody, cancellationToken);
                break;

            case "payment":
                await HandlePaymentNotificationAsync(topic, action, dataId, rawBody, cancellationToken);
                break;

            default:
                // subscription_preapproval_plan / point_integration_wh and anything
                // Mercado Pago adds later. Logged and acknowledged: a 2xx stops the retry
                // storm for events this product has no use for.
                logger.LogInformation("Ignoring Mercado Pago notification of topic {Topic}.", topic);
                break;
        }
    }

    /// <summary>
    /// Applies a plain <c>payment</c> notification.
    ///
    /// Mercado Pago's own documentation tells you to enable this topic alongside the two
    /// subscription ones, and it earns its place: for a first charge it is regularly the
    /// only notification that arrives, and it is the sole carrier of <c>status_detail</c>.
    /// Dropping it — which is what happened before — is how an account that has genuinely
    /// paid keeps reading "pendiente".
    ///
    /// Payments that belong to no subscription of ours (a one-off collected by the same
    /// account) are acknowledged and ignored rather than treated as an error.
    /// </summary>
    private async Task HandlePaymentNotificationAsync(
        string topic,
        string? action,
        string dataId,
        string rawBody,
        CancellationToken cancellationToken)
    {
        var payment = await client.GetPaymentAsync(dataId, cancellationToken);
        if (payment is null)
        {
            logger.LogWarning("Mercado Pago notified payment {Id} but it could not be read back.", dataId);
            return;
        }

        var subscription = await FindSubscriptionForPaymentAsync(payment, cancellationToken);
        if (subscription is null)
        {
            logger.LogInformation("Payment {Id} does not belong to any subscription; ignoring.", dataId);
            return;
        }

        var eventId = BuildEventId(topic, dataId, payment.DateLastUpdated);
        if (await IsAlreadyProcessedAsync(eventId, cancellationToken))
        {
            return;
        }

        var previousStatus = subscription.Status;

        // Order matters, and it is the same order the authorized_payment handler uses: the
        // preapproval first, because it is the authority on trial-vs-active and on when
        // the next debit lands — then the payment on top, because a charge is the
        // strongest available signal about the subscription's health and it arrives before
        // the preapproval's own status catches up. Reversed, a rejection would be wiped by
        // a preapproval that still reads "authorized" (which it does, for days, while
        // Mercado Pago retries) and the grace window would never start.
        if (!string.IsNullOrWhiteSpace(subscription.ExternalSubscriptionId))
        {
            try
            {
                if (await client.GetSubscriptionAsync(subscription.ExternalSubscriptionId, cancellationToken) is { } preapproval)
                {
                    ApplyPreapproval(subscription, preapproval);
                }
            }
            catch (MercadoPagoException exception)
            {
                logger.LogWarning(exception, "Could not re-read preapproval {Id} after payment {PaymentId}.", subscription.ExternalSubscriptionId, dataId);
            }
        }

        subscription.LastPaymentStatusDetail = payment.Status is "approved"
            ? null
            : payment.StatusDetail;

        if (BuildPaymentMethodLabel(payment.PaymentMethodId, payment.Card?.LastFourDigits) is { } label)
        {
            subscription.PaymentMethodLabel = label;
        }

        if (payment.Status is "approved")
        {
            subscription.LastPaymentAtUtc = payment.DateApproved ?? payment.DateLastUpdated ?? DateTime.UtcNow;
            subscription.GraceEndsAtUtc = null;
            subscription.CheckoutUrl = null;

            // Only forward, and only out of the states this payment actually disproves.
            // A subscription the preapproval says is still in its free week stays there —
            // the trial's own $0 invoice is an approved payment too.
            if (subscription.Status is "pendiente" or "pago_fallido")
            {
                subscription.Status = "activa";
                subscription.SubscriptionStartsAtUtc ??= subscription.LastPaymentAtUtc;
            }
        }
        else if (payment.Status is "rejected" && subscription.Status is "activa" or "trial")
        {
            subscription.Status = "pago_fallido";
            // Started on the first failure only, so Mercado Pago's own retries cannot keep
            // extending the window indefinitely.
            subscription.GraceEndsAtUtc ??= DateTime.UtcNow.AddDays(_options.FailedPaymentGraceDays);
        }

        subscription.UpdatedAtUtc = DateTime.UtcNow;

        RecordEvent(
            subscription,
            topic,
            action,
            eventId,
            $"{payment.Status}/{payment.StatusDetail} · {previousStatus} → {subscription.Status}",
            rawBody);

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Which subscription a bare payment belongs to. Three signals, strongest first:
    /// the preapproval id Mercado Pago attaches in metadata, our own
    /// <c>external_reference</c> (present on everything the direct-preapproval checkout
    /// creates), and finally the payer's email.
    /// </summary>
    private async Task<Subscription?> FindSubscriptionForPaymentAsync(
        MercadoPagoPayment payment,
        CancellationToken cancellationToken)
    {
        if (payment.PreapprovalId is { Length: > 0 } preapprovalId)
        {
            var byPreapproval = await db.Subscriptions
                .FirstOrDefaultAsync(item => item.ExternalSubscriptionId == preapprovalId, cancellationToken);

            if (byPreapproval is not null)
            {
                return byPreapproval;
            }
        }

        if (Guid.TryParse(payment.ExternalReference, out var localId))
        {
            var byReference = await db.Subscriptions.FirstOrDefaultAsync(item => item.Id == localId, cancellationToken);
            if (byReference is not null)
            {
                return byReference;
            }
        }

        if (payment.Payer?.Email is not { Length: > 0 } email)
        {
            return null;
        }

        var normalized = email.Trim().ToLowerInvariant();

        return await db.Subscriptions
            .Where(item => item.User!.Email == normalized && item.PaymentProvider == "mercadopago")
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task HandlePreapprovalNotificationAsync(
        string topic,
        string? action,
        string dataId,
        string rawBody,
        CancellationToken cancellationToken)
    {
        var preapproval = await client.GetSubscriptionAsync(dataId, cancellationToken);
        if (preapproval is null)
        {
            logger.LogWarning("Mercado Pago notified preapproval {Id} but it could not be read back.", dataId);
            return;
        }

        var subscription = await FindSubscriptionAsync(dataId, preapproval.ExternalReference, preapproval.PayerEmail, cancellationToken);
        if (subscription is null)
        {
            logger.LogWarning("No local subscription matches preapproval {Id}.", dataId);
            await RecordOrphanEventAsync(topic, action, dataId, rawBody, cancellationToken);
            return;
        }

        // The resource's own last-modified stamp is part of the key: a genuine repeat
        // delivery collapses, while a real later change still gets applied.
        var eventId = BuildEventId(topic, dataId, preapproval.LastModified);
        if (await IsAlreadyProcessedAsync(eventId, cancellationToken))
        {
            return;
        }

        var previousStatus = subscription.Status;
        ApplyPreapproval(subscription, preapproval);

        RecordEvent(subscription, topic, action, eventId, $"{previousStatus} → {subscription.Status}", rawBody);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Subscription {SubscriptionId} moved {Previous} → {Current} from a {Topic} notification.",
            subscription.Id,
            previousStatus,
            subscription.Status,
            topic);
    }

    private async Task HandleAuthorizedPaymentNotificationAsync(
        string topic,
        string? action,
        string dataId,
        string rawBody,
        CancellationToken cancellationToken)
    {
        var payment = await client.GetAuthorizedPaymentAsync(dataId, cancellationToken);
        if (payment?.PreapprovalId is null)
        {
            logger.LogWarning("Mercado Pago notified authorized_payment {Id} but it could not be read back.", dataId);
            return;
        }

        var subscription = await FindSubscriptionAsync(payment.PreapprovalId, null, null, cancellationToken);
        if (subscription is null)
        {
            logger.LogWarning("No local subscription matches preapproval {Id} from authorized_payment {PaymentId}.", payment.PreapprovalId, dataId);
            await RecordOrphanEventAsync(topic, action, dataId, rawBody, cancellationToken);
            return;
        }

        var eventId = BuildEventId(topic, dataId, payment.LastModified);
        if (await IsAlreadyProcessedAsync(eventId, cancellationToken))
        {
            return;
        }

        var previousStatus = subscription.Status;
        var invoice = await UpsertInvoiceAsync(subscription, payment, cancellationToken);

        // A charge is the strongest available signal about the subscription's health, and
        // it arrives before the preapproval's own status catches up.
        switch (invoice.Status)
        {
            case "aprobado":
                subscription.Status = "activa";
                subscription.GraceEndsAtUtc = null;
                subscription.LastPaymentAtUtc = invoice.PaidAtUtc ?? DateTime.UtcNow;
                if (invoice.PeriodEndUtc is { } periodEnd)
                {
                    subscription.NextBillingAtUtc = periodEnd;
                }
                subscription.SubscriptionStartsAtUtc ??= invoice.PeriodStartUtc ?? DateTime.UtcNow;
                break;

            case "rechazado":
                subscription.Status = "pago_fallido";
                // Started on the first failure only, so Mercado Pago's own retries
                // cannot keep extending the window indefinitely.
                subscription.GraceEndsAtUtc ??= DateTime.UtcNow.AddDays(_options.FailedPaymentGraceDays);
                break;
        }

        subscription.UpdatedAtUtc = DateTime.UtcNow;

        RecordEvent(subscription, topic, action, eventId, $"{invoice.Status} · {previousStatus} → {subscription.Status}", rawBody);
        await db.SaveChangesAsync(cancellationToken);
    }

    // ---------------------------------------------------------------------------
    // Mapping
    // ---------------------------------------------------------------------------

    /// <summary>Folds a Mercado Pago preapproval into the local row.</summary>
    private void ApplyPreapproval(Subscription subscription, Preapproval preapproval)
    {
        subscription.ExternalSubscriptionId ??= preapproval.Id;
        subscription.ExternalPlanId ??= preapproval.PreapprovalPlanId;
        subscription.ExternalPayerId = preapproval.PayerId?.ToString(CultureInfo.InvariantCulture) ?? subscription.ExternalPayerId;
        subscription.PaymentProvider = "mercadopago";
        subscription.UpdatedAtUtc = DateTime.UtcNow;
        subscription.LastSyncedAtUtc = DateTime.UtcNow;

        if (preapproval.AutoRecurring is { } recurring)
        {
            subscription.Amount = recurring.TransactionAmount ?? subscription.Amount;
            subscription.CurrencyId = recurring.CurrencyId ?? subscription.CurrencyId;
        }

        if (!string.IsNullOrWhiteSpace(preapproval.PaymentMethodId))
        {
            subscription.PaymentMethodLabel = preapproval.PaymentMethodId;
        }

        if (preapproval.Summarized?.LastChargedDate is { } lastCharged)
        {
            subscription.LastPaymentAtUtc = lastCharged;
        }

        subscription.Status = preapproval.Status switch
        {
            "pending" => "pendiente",
            "authorized" => ResolveAuthorizedStatus(subscription, preapproval),
            "paused" => "pausada",
            "cancelled" or "canceled" => "cancelada",
            _ => subscription.Status,
        };

        if (subscription.Status == "cancelada")
        {
            subscription.CancelledAtUtc ??= DateTime.UtcNow;
        }

        if (subscription.Status == "pausada")
        {
            subscription.PausedAtUtc ??= DateTime.UtcNow;
        }
        else
        {
            subscription.PausedAtUtc = null;
        }

        // The checkout link only has a job while the payer still has to use it. Clearing
        // it is what makes "Terminá el pago" disappear the moment there is nothing left to
        // finish, instead of inviting someone to authorise a second subscription.
        if (subscription.Status != "pendiente")
        {
            subscription.CheckoutUrl = null;
        }

        if (preapproval.NextPaymentDate is { } next)
        {
            subscription.NextBillingAtUtc = next;
        }

        subscription.SubscriptionStartsAtUtc ??= preapproval.AutoRecurring?.StartDate ?? preapproval.DateCreated;
    }

    /// <summary>
    /// An authorised subscription is either inside its free week or genuinely paying.
    /// Mercado Pago does not expose a "trialing" status, so it is derived: a plan with a
    /// free trial that has not been charged yet is still in the trial, and the first
    /// real debit date is exactly when it ends.
    /// </summary>
    private static string ResolveAuthorizedStatus(Subscription subscription, Preapproval preapproval)
    {
        var hasFreeTrial = preapproval.AutoRecurring?.FreeTrial is not null;
        var chargedCount = preapproval.Summarized?.ChargedQuantity ?? 0;
        var firstChargeAt = preapproval.NextPaymentDate;

        if (hasFreeTrial && chargedCount == 0 && firstChargeAt is { } trialEnd && trialEnd > DateTime.UtcNow)
        {
            subscription.TrialWasApplied = true;
            subscription.TrialStartsAtUtc ??= preapproval.DateCreated ?? DateTime.UtcNow;
            subscription.TrialEndsAtUtc = trialEnd;
            return "trial";
        }

        subscription.GraceEndsAtUtc = null;
        return "activa";
    }

    private async Task<SubscriptionInvoice> UpsertInvoiceAsync(
        Subscription subscription,
        AuthorizedPayment payment,
        CancellationToken cancellationToken)
    {
        var externalId = payment.Id?.ToString(CultureInfo.InvariantCulture) ?? Guid.NewGuid().ToString();

        var invoice = await db.SubscriptionInvoices
            .FirstOrDefaultAsync(item => item.ExternalPaymentId == externalId, cancellationToken);

        if (invoice is null)
        {
            invoice = new SubscriptionInvoice
            {
                SubscriptionId = subscription.Id,
                UserId = subscription.UserId,
                ExternalPaymentId = externalId,
            };

            db.SubscriptionInvoices.Add(invoice);
        }

        invoice.Amount = payment.TransactionAmount ?? subscription.Amount;
        invoice.CurrencyId = payment.CurrencyId ?? subscription.CurrencyId;
        invoice.RawStatus = payment.Payment?.Status ?? payment.Status;
        invoice.Status = MapInvoiceStatus(payment);
        invoice.StatusDetail = payment.Payment?.StatusDetail ?? invoice.StatusDetail;
        invoice.ExternalTransactionId = payment.Payment?.Id?.ToString(CultureInfo.InvariantCulture);
        invoice.PeriodStartUtc = payment.Period?.StartDate;
        invoice.PeriodEndUtc = payment.Period?.EndDate;
        invoice.DebitScheduledAtUtc = payment.DebitDate;
        invoice.AttemptNumber = payment.RetryAttempt ?? invoice.AttemptNumber;
        invoice.PaidAtUtc = invoice.Status == "aprobado" ? payment.LastModified ?? payment.DateCreated : null;
        invoice.PaymentMethodLabel = BuildPaymentMethodLabel(payment) ?? invoice.PaymentMethodLabel;
        invoice.UpdatedAtUtc = DateTime.UtcNow;

        if (invoice.PaymentMethodLabel is not null)
        {
            subscription.PaymentMethodLabel = invoice.PaymentMethodLabel;
        }

        return invoice;
    }

    private static string MapInvoiceStatus(AuthorizedPayment payment) =>
        (payment.Payment?.Status ?? payment.Status)?.ToLowerInvariant() switch
        {
            "approved" or "accredited" or "processed" => "aprobado",
            "rejected" or "cancelled" or "canceled" => "rechazado",
            "refunded" or "charged_back" => "devuelto",
            "recycling" or "retrying" => "reintentando",
            // `in_process` is Mercado Pago's "we are still deciding" — the state behind
            // pending_contingency and pending_review_manual, and the one most likely to be
            // what a customer is staring at. It is pending, not a failure.
            _ => "pendiente",
        };

    private static string? BuildPaymentMethodLabel(AuthorizedPayment payment) =>
        BuildPaymentMethodLabel(payment.Payment?.PaymentMethodId, payment.Payment?.LastFourDigits);

    private static string? BuildPaymentMethodLabel(string? method, string? lastFour)
    {
        if (string.IsNullOrWhiteSpace(method))
        {
            return null;
        }

        return string.IsNullOrWhiteSpace(lastFour) ? method : $"{method} ···· {lastFour}";
    }

    // ---------------------------------------------------------------------------
    // Plans
    // ---------------------------------------------------------------------------

    /// <summary>
    /// The plan to attach a new subscriber to, created on first use and cached.
    ///
    /// The cache key includes a fingerprint of the pricing configuration, so changing
    /// the amount in <c>appsettings.json</c> produces a new plan instead of silently
    /// charging everyone the old price forever.
    /// </summary>
    private async Task<string> ResolvePlanIdAsync(bool withTrial, CancellationToken cancellationToken)
    {
        var configured = withTrial ? _options.PreapprovalPlanId : _options.PreapprovalPlanIdNoTrial;
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        if (!_options.AutoCreatePlan)
        {
            throw new MercadoPagoException(
                withTrial
                    ? "No plan configured: set MercadoPago:PreapprovalPlanId or enable AutoCreatePlan."
                    : "No trial-free plan configured: set MercadoPago:PreapprovalPlanIdNoTrial or enable AutoCreatePlan.");
        }

        var key = $"mercadopago.plan.{(withTrial ? "trial" : "no_trial")}.{BuildPricingFingerprint(withTrial)}";
        var stored = await db.AppSettings.FirstOrDefaultAsync(item => item.Key == key, cancellationToken);

        if (stored is not null && !string.IsNullOrWhiteSpace(stored.Value))
        {
            return stored.Value;
        }

        var plan = await client.CreatePlanAsync(withTrial, cancellationToken);
        if (string.IsNullOrWhiteSpace(plan.Id))
        {
            throw new MercadoPagoException("Mercado Pago created a plan without an id.");
        }

        if (stored is null)
        {
            db.AppSettings.Add(new AppSetting { Key = key, Value = plan.Id });
        }
        else
        {
            stored.Value = plan.Id;
            stored.UpdatedAtUtc = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Created Mercado Pago plan {PlanId} ({Kind}) for {Amount} {Currency} every {Frequency} {FrequencyType}.",
            plan.Id,
            withTrial ? "with free trial" : "without free trial",
            _options.TransactionAmount,
            _options.CurrencyId,
            _options.Frequency,
            _options.FrequencyType);

        return plan.Id;
    }

    private string BuildPricingFingerprint(bool withTrial)
    {
        var seed = string.Create(
            CultureInfo.InvariantCulture,
            $"{_options.TransactionAmount}|{_options.CurrencyId}|{_options.Frequency}|{_options.FrequencyType}|{(withTrial ? $"{_options.TrialFrequency}{_options.TrialFrequencyType}" : "none")}");

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seed)))[..12].ToLowerInvariant();
    }

    // ---------------------------------------------------------------------------
    // Plumbing
    // ---------------------------------------------------------------------------

    private async Task<Subscription?> FindSubscriptionAsync(
        string externalSubscriptionId,
        string? externalReference,
        string? payerEmail,
        CancellationToken cancellationToken)
    {
        // external_reference carries our own subscription id, which is the only link
        // available for the window between creating the preapproval and storing its id.
        var fallbackId = Guid.TryParse(externalReference, out var parsed) ? parsed : (Guid?)null;

        var byId = await db.Subscriptions.FirstOrDefaultAsync(
            item => item.ExternalSubscriptionId == externalSubscriptionId ||
                    (fallbackId != null && item.Id == fallbackId),
            cancellationToken);

        if (byId is not null || string.IsNullOrWhiteSpace(payerEmail))
        {
            return byId;
        }

        // No id and no external_reference to go on. In the normal card-token flow this
        // should not happen — CreateSubscriptionAsync sets ExternalSubscriptionId in the
        // same call that creates the row — so reaching here means an earlier attempt
        // failed partway (e.g. the process crashed after Mercado Pago accepted the
        // subscription but before the response was saved). The email Mercado Pago shares
        // with the seller is the best remaining signal: match it to whichever account most
        // recently opened a checkout that never got linked.
        var normalizedEmail = payerEmail.Trim().ToLowerInvariant();

        return await db.Subscriptions
            .Where(item => item.ExternalSubscriptionId == null && item.User!.Email == normalizedEmail)
            .OrderByDescending(item => item.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private Task<bool> IsAlreadyProcessedAsync(string eventId, CancellationToken cancellationToken) =>
        db.SubscriptionEvents.AnyAsync(item => item.ExternalEventId == eventId, cancellationToken);

    private static string BuildEventId(string topic, string dataId, DateTime? version) =>
        $"{topic}:{dataId}:{version?.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture) ?? "na"}";

    private async Task RecordOrphanEventAsync(
        string topic,
        string? action,
        string dataId,
        string rawBody,
        CancellationToken cancellationToken)
    {
        db.SubscriptionEvents.Add(new SubscriptionEvent
        {
            Topic = topic,
            Action = action,
            ExternalSubscriptionId = dataId,
            ExternalEventId = BuildEventId(topic, dataId, DateTime.UtcNow),
            PayloadJson = Trim(rawBody),
            Notes = "No matching local subscription.",
        });

        await db.SaveChangesAsync(cancellationToken);
    }

    private void RecordEvent(
        Subscription subscription,
        string topic,
        string? action,
        string? externalEventId,
        string? notes,
        string? rawBody = null)
    {
        db.SubscriptionEvents.Add(new SubscriptionEvent
        {
            SubscriptionId = subscription.Id,
            UserId = subscription.UserId,
            ExternalSubscriptionId = subscription.ExternalSubscriptionId,
            Topic = topic,
            Action = action,
            ExternalEventId = externalEventId,
            ResultingStatus = subscription.Status,
            Notes = notes,
            PayloadJson = Trim(rawBody),
        });
    }

    private static string? Trim(string? value) =>
        value is null ? null : value.Length <= 4000 ? value : value[..4000];
}

public sealed record PlanInfo(
    decimal Amount,
    string CurrencyId,
    int Frequency,
    string FrequencyType,
    int TrialFrequency,
    string TrialFrequencyType,
    string Reason,
    bool ProviderConfigured);

/// <param name="Status">Always <c>pendiente</c> at this point — <c>StartCheckoutAsync</c>
/// only opens the checkout, it never learns the outcome. The webhook or a later
/// <see cref="SubscriptionService.SyncAsync"/> is what eventually moves it to
/// <c>trial</c>/<c>activa</c> (or leaves it <c>pendiente</c>, if the payer never finishes).</param>
/// <param name="RedirectUrl">Mercado Pago's hosted checkout page — send the browser here.</param>
/// <param name="Resumed">Whether this handed back an earlier unfinished checkout rather
/// than opening a new one. The screen says so, because "te llevamos de nuevo al pago que
/// dejaste a medias" and "abrimos un pago nuevo" are not the same promise.</param>
public sealed record CheckoutResult(
    string Status,
    Guid SubscriptionId,
    bool TrialApplied,
    string? TrialDeniedReason,
    string RedirectUrl,
    bool Resumed = false);

/// <summary>
/// What a cancellation actually did, in the terms the customer cares about: will they be
/// charged again, and until when do they keep Pro. Derived server-side rather than left to
/// the screen, because the answer depends on Mercado Pago's confirmed state and getting it
/// wrong in either direction is a support ticket — or a chargeback.
/// </summary>
/// <param name="NothingWillBeCharged">True when the subscription was cancelled before its
/// first real debit, so no money ever moves.</param>
/// <param name="AccessUntilUtc">The moment Pro ends. Null when access ended immediately —
/// an abandoned checkout that never bought anything.</param>
public sealed record CancellationOutcome(
    Guid SubscriptionId,
    string Status,
    bool NothingWillBeCharged,
    bool AlreadyCancelled,
    DateTime? AccessUntilUtc)
{
    public static CancellationOutcome From(Subscription subscription, bool wasInTrial, bool alreadyCancelled)
    {
        var accessUntil = SubscriptionAccessEvaluator.HasVipAccess(subscription)
            ? subscription.NextBillingAtUtc ?? subscription.TrialEndsAtUtc
            : null;

        return new CancellationOutcome(
            subscription.Id,
            subscription.Status,
            // "Nada se te va a cobrar" is only safe to say when no charge ever landed.
            wasInTrial && subscription.LastPaymentAtUtc is null,
            alreadyCancelled,
            accessUntil);
    }
}

public sealed class SubscriptionConflictException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
