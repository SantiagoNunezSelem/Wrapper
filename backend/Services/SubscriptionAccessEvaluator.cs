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

    public static string GetVisibleState(User user)
    {
        if (user.IsAdmin)
        {
            return "activa";
        }

        return GetLatestRelevantSubscription(user)?.Status ?? "inactiva";
    }

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
