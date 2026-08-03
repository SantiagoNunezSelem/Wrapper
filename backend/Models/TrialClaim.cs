namespace backend.Models;

/// <summary>
/// One row per free trial ever started. Kept separately from <see cref="User"/> so a
/// deleted account cannot buy a second trial, and so the "same device, new Google
/// account" case has something to match against.
///
/// Addresses and device ids are stored hashed: the ledger only ever needs to answer
/// "have I seen this before?", never "who was it?".
/// </summary>
public sealed class TrialClaim
{
    public Guid Id { get; init; } = Guid.NewGuid();

    /// <summary>Deliberately a plain column, not a foreign key: the ledger has to outlive
    /// the account, or deleting it would restore the trial.</summary>
    public Guid UserId { get; set; }

    /// <summary>Salted hash of the exact client address.</summary>
    public string? IpHash { get; set; }

    /// <summary>Salted hash of the /24 (IPv4) or /48 (IPv6) block the address sits in.
    /// Recorded always, consulted only when <c>TrialGuard:LockBySubnet</c> is on.</summary>
    public string? SubnetHash { get; set; }

    /// <summary>Salted hash of the browser-held device id.</summary>
    public string? DeviceHash { get; set; }

    /// <summary>ISO-3166 alpha-2, when the deployment can actually determine it.</summary>
    public string? CountryCode { get; set; }

    /// <summary>The subscription the trial was granted on, for auditing a dispute.</summary>
    public Guid? SubscriptionId { get; set; }

    public DateTime ClaimedAtUtc { get; init; } = DateTime.UtcNow;
}
