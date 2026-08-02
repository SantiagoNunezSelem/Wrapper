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
            "cancelada" => subscription.NextBillingAtUtc is not null && subscription.NextBillingAtUtc >= now,
            _ => false,
        };
    }

    private static Subscription? GetLatestRelevantSubscription(User user) =>
        user.Subscriptions
            .OrderByDescending(item => item.NextBillingAtUtc ?? item.TrialEndsAtUtc ?? item.CreatedAtUtc)
            .FirstOrDefault();
}
