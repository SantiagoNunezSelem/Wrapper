using backend.Models;

namespace backend.Services;

public static class SubscriptionAccessEvaluator
{
    public static bool HasVipAccess(User user)
    {
        if (user.IsAdmin)
        {
            return true;
        }

        return GetLatestRelevantSubscription(user) is { } subscription && HasVipAccess(subscription);
    }

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

        if (GetLatestRelevantSubscription(user) is not { } subscription)
        {
            return "inactiva";
        }

        return subscription.Status == "pendiente" && !HasPaymentInFlight(subscription)
            ? "inactiva"
            : subscription.Status;
    }

    /// <summary>
    /// Prefixes of the <c>status_detail</c> values that mean the attempt is <b>over</b>:
    /// the card was declined, the payment expired, someone cancelled it. Money was never
    /// taken and none is coming, so a subscription sitting on these is not waiting on
    /// anything — it is a checkout that did not go through, and the screen should say so
    /// and offer to try again rather than promise that Pro is about to switch itself on.
    /// </summary>
    private static readonly string[] SettledWithoutPayment =
        ["cc_rejected", "rejected", "expired", "by_payer", "by_collector"];

    /// <summary>
    /// Whether Mercado Pago has a charge for this subscription that is still going
    /// somewhere. This is the difference between "tu pago se está procesando" and
    /// "abriste el checkout y no lo terminaste", which the local <c>pendiente</c> status
    /// covers alike.
    ///
    /// <see cref="Models.Subscription.LastPaymentStatusDetail"/> is the signal: it is only
    /// ever written from a payment Mercado Pago actually reported, and cleared again the
    /// moment nothing is outstanding (see
    /// <c>SubscriptionService.RefreshPendingReasonAsync</c>), so a checkout nobody
    /// completed never gets one.
    ///
    /// A detail we do not recognise counts as in flight, deliberately. Mercado Pago adds
    /// these over time, and of the two ways to be wrong about a new one, telling someone
    /// "lo estamos siguiendo" about a payment that is already dead is far cheaper than
    /// telling someone whose money is genuinely in motion that nothing happened.
    /// </summary>
    public static bool HasPaymentInFlight(Subscription subscription) =>
        subscription.LastPaymentStatusDetail is { Length: > 0 } detail &&
        !SettledWithoutPayment.Any(prefix => detail.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));

    public static bool HasVipAccess(Subscription subscription)
    {
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
