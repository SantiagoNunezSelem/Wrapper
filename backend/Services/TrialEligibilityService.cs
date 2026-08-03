using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Decides whether an account may start the free week, and records the claim when it
/// does.
///
/// The rules are layered because each one alone is weak: the per-account rule is exact
/// but a new Google account costs nothing; the IP rule catches that but changes on a
/// mobile network; the device rule catches *that* but resets when site data is cleared.
/// Together they make repeat trials tedious enough not to be worth it — which is the
/// realistic goal. None of them can be perfect, so the failure mode is chosen
/// deliberately: a blocked user is not refused service, they are simply offered the
/// paid plan without a trial.
/// </summary>
public sealed class TrialEligibilityService(
    AppDbContext db,
    ClientFingerprint fingerprint,
    IOptions<TrialGuardOptions> options,
    ILogger<TrialEligibilityService> logger)
{
    private readonly TrialGuardOptions _options = options.Value;

    public async Task<TrialEligibility> EvaluateAsync(
        User user,
        HttpContext http,
        string? deviceId,
        CancellationToken cancellationToken)
    {
        var identity = fingerprint.Describe(http, deviceId);

        // The account rule is absolute and comes first: it is the only one that is
        // certain, and it also covers "cancelled during the trial, now trying again",
        // which the brief calls out explicitly.
        if (user.HasUsedTrial)
        {
            return new TrialEligibility(false, "account_used", identity);
        }

        if (_options.AllowedCountries.Length > 0 &&
            identity.CountryCode is { } country &&
            !_options.AllowedCountries.Contains(country, StringComparer.OrdinalIgnoreCase))
        {
            return new TrialEligibility(false, "country_not_allowed", identity);
        }

        var since = _options.WindowDays > 0
            ? DateTime.UtcNow.AddDays(-_options.WindowDays)
            : (DateTime?)null;

        var claims = db.TrialClaims.AsQueryable();
        if (since is not null)
        {
            claims = claims.Where(claim => claim.ClaimedAtUtc >= since);
        }

        // A user's own earlier claim must not disqualify them — that case is already
        // covered by HasUsedTrial, and matching it here would block a legitimate retry
        // after a failed checkout.
        claims = claims.Where(claim => claim.UserId != user.Id);

        if (_options.LockByIp && identity.IpHash is { } ipHash &&
            await claims.AnyAsync(claim => claim.IpHash == ipHash, cancellationToken))
        {
            return new TrialEligibility(false, "ip_used", identity);
        }

        if (_options.LockBySubnet && identity.SubnetHash is { } subnetHash &&
            await claims.AnyAsync(claim => claim.SubnetHash == subnetHash, cancellationToken))
        {
            return new TrialEligibility(false, "network_used", identity);
        }

        if (_options.LockByDevice && identity.DeviceHash is { } deviceHash &&
            await claims.AnyAsync(claim => claim.DeviceHash == deviceHash, cancellationToken))
        {
            return new TrialEligibility(false, "device_used", identity);
        }

        return new TrialEligibility(true, null, identity);
    }

    /// <summary>
    /// Burns the trial. Called when the subscription is created — not when it converts —
    /// so an abandoned checkout still consumes the offer. That is the conservative
    /// direction: the alternative lets someone re-open checkout indefinitely.
    /// </summary>
    public void Claim(User user, Subscription subscription, ClientIdentity identity)
    {
        user.HasUsedTrial = true;
        user.UpdatedAtUtc = DateTime.UtcNow;

        db.TrialClaims.Add(new TrialClaim
        {
            UserId = user.Id,
            SubscriptionId = subscription.Id,
            IpHash = identity.IpHash,
            SubnetHash = identity.SubnetHash,
            DeviceHash = identity.DeviceHash,
            CountryCode = identity.CountryCode,
        });

        logger.LogInformation("Free trial claimed by user {UserId} on subscription {SubscriptionId}.", user.Id, subscription.Id);
    }
}

/// <param name="Reason">
/// Why the trial was refused, as a stable code the UI translates:
/// <c>account_used</c>, <c>ip_used</c>, <c>network_used</c>, <c>device_used</c>,
/// <c>country_not_allowed</c>. Null when the trial is available.
/// </param>
public readonly record struct TrialEligibility(bool IsEligible, string? Reason, ClientIdentity Identity);
