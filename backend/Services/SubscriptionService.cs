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
    /// Opens a checkout: a local "pendiente" row, and the plan's own <c>init_point</c> to
    /// send the payer's browser to. There is no per-user "create a pending preapproval"
    /// call here — Mercado Pago's redirect checkout for subscriptions doesn't offer one
    /// (their <c>/preapproval</c> endpoint requires a tokenized card, which is exactly the
    /// embedded flow this replaces); the payer logs into their own Mercado Pago account on
    /// the plan's hosted page and Mercado Pago creates the actual preapproval on their
    /// side. That means this local row has no <see cref="Subscription.ExternalSubscriptionId"/>
    /// yet when this method returns — linking it happens by matching payer email, either
    /// when the webhook notifies us or when <see cref="SyncAsync"/> searches for it.
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

        var eligibility = await trialEligibility.EvaluateAsync(user, http, deviceId, cancellationToken);
        var planId = await ResolvePlanIdAsync(eligibility.IsEligible, cancellationToken);

        var plan = await client.GetPlanAsync(planId, cancellationToken);
        if (string.IsNullOrWhiteSpace(plan?.InitPoint))
        {
            throw new MercadoPagoException("Mercado Pago did not return a checkout URL for this plan.");
        }

        var subscription = new Subscription
        {
            UserId = user.Id,
            Status = "pendiente",
            PlanType = "mensual",
            PaymentProvider = "mercadopago",
            ExternalPlanId = planId,
            Amount = _options.TransactionAmount,
            CurrencyId = _options.CurrencyId,
            TrialWasApplied = eligibility.IsEligible,
        };

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

        return new CheckoutResult(subscription.Status, subscription.Id, eligibility.IsEligible, eligibility.Reason, plan.InitPoint);
    }

    // ---------------------------------------------------------------------------
    // Cancellation
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Turns off automatic renewal. Access is intentionally *not* revoked: the customer
    /// keeps what their last charge already bought, which is both the stated policy and
    /// the thing that keeps cancellations from turning into refund requests.
    /// </summary>
    public async Task<Subscription> CancelAsync(User user, CancellationToken cancellationToken)
    {
        var subscription = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user)
            ?? throw new SubscriptionConflictException("no_subscription", "There is no subscription to cancel.");

        if (subscription.Status is "cancelada")
        {
            return subscription;
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
            return subscription;
        }

        if (string.IsNullOrWhiteSpace(subscription.ExternalSubscriptionId))
        {
            throw new SubscriptionConflictException("not_linked", "This subscription is not linked to Mercado Pago.");
        }

        var updated = await client.CancelSubscriptionAsync(subscription.ExternalSubscriptionId, cancellationToken);

        subscription.Status = "cancelada";
        subscription.CancelledAtUtc = DateTime.UtcNow;
        subscription.UpdatedAtUtc = DateTime.UtcNow;

        if (updated is not null)
        {
            ApplyPreapproval(subscription, updated);
            // ApplyPreapproval trusts the provider's status, and a just-cancelled
            // preapproval sometimes still reads as authorized for a moment.
            subscription.Status = "cancelada";
            subscription.CancelledAtUtc ??= DateTime.UtcNow;
        }

        RecordEvent(subscription, "cancel", "user_requested", null, null);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("User {UserId} cancelled subscription {SubscriptionId}.", user.Id, subscription.Id);
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

        var subscription = user.Subscriptions
            .Where(item => !string.IsNullOrWhiteSpace(item.ExternalSubscriptionId))
            .OrderByDescending(item => item.UpdatedAtUtc)
            .FirstOrDefault();

        // A redirect checkout's local row starts with no id — Mercado Pago only hands one
        // out once the payer finishes on their own hosted page (see StartCheckoutAsync).
        // Look it up by payer email, the same signal the webhook handler falls back to in
        // FindSubscriptionAsync, so the very first landing back on /suscripcion has a
        // chance to link it even if the webhook is slow, unreachable, or not set up yet.
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

        subscription.LastSyncedAtUtc = DateTime.UtcNow;

        if (previousStatus != subscription.Status)
        {
            RecordEvent(subscription, "sync", previousStatus, null, $"{previousStatus} → {subscription.Status}");
        }

        await db.SaveChangesAsync(cancellationToken);
        return subscription;
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

            default:
                // payment / plan / point_integration_wh and anything Mercado Pago adds
                // later. Logged and acknowledged: a 2xx stops the retry storm for events
                // this product has no use for.
                logger.LogInformation("Ignoring Mercado Pago notification of topic {Topic}.", topic);
                break;
        }
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
            _ => "pendiente",
        };

    private static string? BuildPaymentMethodLabel(AuthorizedPayment payment)
    {
        var method = payment.Payment?.PaymentMethodId;
        var lastFour = payment.Payment?.LastFourDigits;

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
public sealed record CheckoutResult(string Status, Guid SubscriptionId, bool TrialApplied, string? TrialDeniedReason, string RedirectUrl);

public sealed class SubscriptionConflictException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
