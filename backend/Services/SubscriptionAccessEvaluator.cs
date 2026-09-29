using backend.Models;

namespace backend.Services;

public static class SubscriptionAccessEvaluator
{
    public static bool HasVipAccess(User user)
    {
        if (user.IsAdmin || HasCourtesyAccess(user))
        {
            return true;
        }

        return GetLatestRelevantSubscription(user) is { } subscription && HasVipAccess(subscription);
    }

    /// <summary>Pro given from the admin panel, still running. See <see cref="User.VipUntilUtc"/>.</summary>
    public static bool HasCourtesyAccess(User user) =>
        user.VipUntilUtc is { } until && until >= DateTime.UtcNow;

    /// <summary>
    /// The one word the shells put next to someone's name. Deliberately not the raw row
    /// status: a checkout that was opened and walked away from is stored as
    /// <c>pendiente</c>, and calling that "Pendiente de pago" everywhere in the app tells
    /// someone a payment of theirs is in the air when nothing ever left the ground —
    /// which is both wrong and worrying. Nothing was authorised and nothing will be
    /// charged, so the account looks exactly like an account without a subscription. The
    /// half-finished checkout is not lost: <c>/suscripcion</c> still offers to resume it,
    /// which is the one screen where that is worth saying.
    /// </summary>
    public static string GetVisibleState(User user)
    {
        if (user.IsAdmin)
        {
            return "activa";
        }

        var subscription = GetLatestRelevantSubscription(user);

        // Pro from the panel reads as active, like the admin override: a cancelled or
        // abandoned row left over from before must not label an account that has Pro.
        if (HasCourtesyAccess(user) && (subscription is null || !HasVipAccess(subscription)))
        {
            return "activa";
        }

        if (subscription is null)
        {
            return "inactiva";
        }

        return subscription.Status == "pendiente" && !HasPaymentInFlight(subscription)
            ? "inactiva"
            : subscription.Status;
    }

    /// <summary>
    /// What became of the last charge Mercado Pago reported for this subscription and did
    /// not approve — see <see cref="PaymentOutcomes"/>. Null when there is none: nothing was
    /// ever charged, or the last charge went through.
    ///
    /// Decided by the payment's <c>status</c>, which Mercado Pago documents as a short,
    /// closed list. The <c>status_detail</c> only explains it, and reading the outcome off
    /// the detail's wording went wrong in both directions: a card over its limit
    /// (<c>cc_amount_rate_limit_exceeded</c>), a refund or a dispute all read as "still
    /// processing", which told people to wait for money that was never coming.
    ///
    /// Rows stored before the status was kept fall back to the detail, and a detail we do
    /// not recognise there still counts as in progress: of the two ways to be wrong,
    /// "lo estamos siguiendo" about a dead payment is the cheaper one.
    /// </summary>
    public static string? DescribeLastPayment(Subscription subscription)
    {
        if (subscription.LastPaymentStatusDetail is not { Length: > 0 } detail)
        {
            return null;
        }

        return subscription.LastPaymentStatus switch
        {
            "pending" or "in_process" or "authorized" => PaymentOutcomes.InProgress,
            "rejected" => PaymentOutcomes.Declined,
            "cancelled" => PaymentOutcomes.Cancelled,
            "refunded" => PaymentOutcomes.Refunded,
            "charged_back" or "in_mediation" => PaymentOutcomes.Disputed,
            "approved" => null,
            _ => FromDetail(detail),
        };
    }

    /// <summary>The fallback for rows with no stored status: the detail's own meaning, per
    /// Mercado Pago's table of <c>status_detail</c> values.</summary>
    private static string FromDetail(string detail)
    {
        if (detail.StartsWith("cc_rejected", StringComparison.OrdinalIgnoreCase) ||
            detail.StartsWith("rejected", StringComparison.OrdinalIgnoreCase) ||
            detail is "bank_error" or "insufficient_amount" or "cc_amount_rate_limit_exceeded")
        {
            return PaymentOutcomes.Declined;
        }

        return detail switch
        {
            "expired" or "by_payer" or "by_collector" => PaymentOutcomes.Cancelled,
            "refunded" or "by_admin" or "partially_refunded" => PaymentOutcomes.Refunded,
            "settled" or "reimbursed" => PaymentOutcomes.Disputed,
            _ => PaymentOutcomes.InProgress,
        };
    }

    /// <summary>
    /// Whether Mercado Pago has a charge for this subscription that is still going
    /// somewhere. This is the difference between "tu pago se está procesando" and
    /// "abriste el checkout y no lo terminaste", which the local <c>pendiente</c> status
    /// covers alike. See <see cref="DescribeLastPayment"/>.
    /// </summary>
    public static bool HasPaymentInFlight(Subscription subscription) =>
        DescribeLastPayment(subscription) == PaymentOutcomes.InProgress;

    /// <summary>
    /// Whether Mercado Pago may still charge this subscription: linked to a preapproval,
    /// not simulated, not revoked, and in a state whose preapproval is alive — or pending
    /// with a charge already moving.
    /// </summary>
    public static bool BillsAtProvider(Subscription subscription) =>
        !subscription.IsDevSimulated &&
        subscription.AccessRevokedAtUtc is null &&
        !string.IsNullOrWhiteSpace(subscription.ExternalSubscriptionId) &&
        (subscription.Status is "trial" or "activa" or "pago_fallido" or "pausada" ||
         (subscription.Status == "pendiente" && HasPaymentInFlight(subscription)));

    public static bool HasVipAccess(Subscription subscription)
    {
        // Taken away from the panel. Checked before the status on purpose: Mercado Pago can
        // rewrite that status and its dates afterwards, and none of it gives Pro back.
        if (subscription.AccessRevokedAtUtc is not null)
        {
            return false;
        }

        var now = DateTime.UtcNow;

        return subscription.Status switch
        {
            "trial" => subscription.TrialEndsAtUtc is not null && subscription.TrialEndsAtUtc >= now,
            "activa" => subscription.NextBillingAtUtc is null || subscription.NextBillingAtUtc >= now,
            // A rejected charge is not proof the customer left — Mercado Pago keeps
            // retrying for a few days. Pro stays on for the configured grace window so a
            // card that recovers never produces a visible outage; after it, access ends.
            "pago_fallido" => subscription.GraceEndsAtUtc is not null && subscription.GraceEndsAtUtc >= now,
            // Cancelled and paused both keep what was already paid for: the period the
            // customer's last charge bought does not shrink because they turned off
            // renewal.
            "cancelada" or "pausada" =>
                (subscription.NextBillingAtUtc is not null && subscription.NextBillingAtUtc >= now) ||
                (subscription.TrialEndsAtUtc is not null && subscription.TrialEndsAtUtc >= now),
            _ => false,
        };
    }

    /// <summary>
    /// The subscription that decides today's access. A user accumulates rows over time
    /// (trial → cancelled → resubscribed), so anything currently granting Pro wins
    /// outright; otherwise the most recent one is what the account screen describes.
    /// </summary>
    public static Subscription? GetLatestRelevantSubscription(User user)
    {
        var ordered = user.Subscriptions
            .OrderByDescending(item => item.NextBillingAtUtc ?? item.TrialEndsAtUtc ?? item.CreatedAtUtc)
            .ThenByDescending(item => item.CreatedAtUtc)
            .ToList();

        return ordered.FirstOrDefault(HasVipAccess) ?? ordered.FirstOrDefault();
    }
}

/// <summary>
/// What became of a charge that was not approved, for the account screen to word it:
/// still moving, refused, cancelled, given back, or disputed through the card.
/// </summary>
public static class PaymentOutcomes
{
    public const string InProgress = "in_progress";
    public const string Declined = "declined";
    public const string Cancelled = "cancelled";
    public const string Refunded = "refunded";
    public const string Disputed = "disputed";
}
