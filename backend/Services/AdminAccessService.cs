using backend.Models;

namespace backend.Services;

/// <summary>
/// What the panel can do to an account's access: give Pro without a payment, take Pro
/// away, and hand the free week back. None of it applies to an admin account — the admin
/// override already gives Pro, and taking a "VIP" off it would change nothing.
///
/// Each change is saved together with its line in the audit trail:
/// <see cref="AdminAuditService.RecordAsync"/> saves the context this request shares, so
/// the change and the record of who made it land in the same write.
/// </summary>
public sealed class AdminAccessService(
    SubscriptionService subscriptions,
    TrialEligibilityService trials,
    AdminAuditService audit)
{
    /// <summary>The durations the panel offers, besides "sin vencimiento".</summary>
    public static readonly IReadOnlyList<int> AllowedDays = [7, 30, 90];

    /// <summary>"Sin vencimiento": the same far-off date the seeded admin VIP uses.</summary>
    public static readonly DateTime Forever = new(2099, 12, 31, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// Gives Pro for <paramref name="days"/> — counted from the end of the Pro already
    /// given, when there is some, so a second grant adds up instead of cutting the first
    /// short. Null days is no end.
    /// </summary>
    public async Task GrantVipAsync(User user, int? days, Guid adminId, string adminEmail, CancellationToken cancellationToken)
    {
        EnsureNotAdmin(user);

        // On top of a subscription Mercado Pago still charges it would not stop a single
        // charge; it would only hide the row that makes them. That one is cancelled first.
        if (user.Subscriptions.Any(SubscriptionAccessEvaluator.BillsAtProvider))
        {
            throw new SubscriptionConflictException(
                "paid_active",
                "La cuenta tiene una suscripción que Mercado Pago sigue cobrando: el VIP no frenaría esos cobros.");
        }

        var now = DateTime.UtcNow;
        var from = user.VipUntilUtc is { } until && until > now ? until : now;
        var end = days is { } count ? from.AddDays(count) : Forever;

        user.VipUntilUtc = end > Forever ? Forever : end;
        user.UpdatedAtUtc = now;

        await audit.RecordAsync(
            adminId,
            adminEmail,
            AdminActions.GrantVip,
            user.Id,
            days is { } granted ? $"{granted} días, hasta {user.VipUntilUtc:yyyy-MM-dd}" : "sin vencimiento",
            cancellationToken);
    }

    /// <summary>
    /// Takes Pro away now: the Pro given from the panel and every subscription still
    /// granting it, cancelled at Mercado Pago first when it would be charged again. See
    /// <see cref="SubscriptionService.RevokeAccessAsync"/>.
    /// </summary>
    public async Task RevokeVipAsync(User user, Guid adminId, string adminEmail, CancellationToken cancellationToken)
    {
        EnsureNotAdmin(user);

        if (!SubscriptionAccessEvaluator.HasVipAccess(user))
        {
            throw new SubscriptionConflictException("no_access", "La cuenta no tiene Pro.");
        }

        user.VipUntilUtc = null;
        user.UpdatedAtUtc = DateTime.UtcNow;

        var cancelled = await subscriptions.RevokeAccessAsync(user, cancellationToken);

        await audit.RecordAsync(
            adminId,
            adminEmail,
            AdminActions.RevokeVip,
            user.Id,
            cancelled.Count > 0 ? $"Cancelada en Mercado Pago: {string.Join(", ", cancelled)}" : null,
            cancellationToken);
    }

    /// <summary>The next checkout carries the free week again. See <see cref="TrialEligibilityService.Grant"/>.</summary>
    public async Task GrantTrialAsync(User user, Guid adminId, string adminEmail, CancellationToken cancellationToken)
    {
        EnsureNotAdmin(user);

        trials.Grant(user);

        await audit.RecordAsync(adminId, adminEmail, AdminActions.GrantTrial, user.Id, null, cancellationToken);
    }

    /// <summary>
    /// Where the account's Pro comes from, and which of the actions above the panel may
    /// offer. Decided here, next to the rules, so the panel never shows a button the API
    /// would answer with a 409.
    /// </summary>
    public static AdminAccess Describe(User user)
    {
        var courtesy = SubscriptionAccessEvaluator.HasCourtesyAccess(user);
        var subscriptionAccess = user.Subscriptions.Any(SubscriptionAccessEvaluator.HasVipAccess);
        var billing = user.Subscriptions.Any(SubscriptionAccessEvaluator.BillsAtProvider);

        var source = user.IsAdmin ? "admin" : subscriptionAccess ? "subscription" : courtesy ? "courtesy" : "none";
        var grantBlocked = user.IsAdmin ? "admin" : billing ? "paid_active" : null;
        var trialState = user.HasUsedTrial ? "used" : user.TrialGrantedAtUtc is not null ? "granted" : "unused";

        return new AdminAccess(
            source,
            courtesy ? user.VipUntilUtc : null,
            grantBlocked is null,
            grantBlocked,
            !user.IsAdmin && (courtesy || subscriptionAccess),
            !user.IsAdmin && user.Subscriptions.Any(item =>
                SubscriptionAccessEvaluator.HasVipAccess(item) && SubscriptionAccessEvaluator.BillsAtProvider(item)),
            trialState,
            user.TrialGrantedAtUtc,
            !user.IsAdmin && trialState != "granted");
    }

    private static void EnsureNotAdmin(User user)
    {
        if (user.IsAdmin)
        {
            throw new SubscriptionConflictException("admin", "Es una cuenta de admin: siempre tiene Pro.");
        }
    }
}

/// <param name="Source">Where today's Pro comes from: <c>admin</c>, <c>subscription</c>,
/// <c>courtesy</c> (given from the panel) or <c>none</c>.</param>
/// <param name="CourtesyUntilUtc">The end of the Pro given from the panel, while it runs.</param>
/// <param name="GrantVipBlockedReason">Why "Dar VIP" is not offered: <c>admin</c> or
/// <c>paid_active</c>. Null when it is.</param>
/// <param name="RevokeCancelsBilling">Whether taking Pro away also cancels a subscription
/// Mercado Pago would charge again — the confirmation has to say so.</param>
/// <param name="TrialState"><c>used</c>, <c>granted</c> (given back and not used yet) or
/// <c>unused</c>.</param>
public sealed record AdminAccess(
    string Source,
    DateTime? CourtesyUntilUtc,
    bool CanGrantVip,
    string? GrantVipBlockedReason,
    bool CanRevokeVip,
    bool RevokeCancelsBilling,
    string TrialState,
    DateTime? TrialGrantedAtUtc,
    bool CanGrantTrial);
