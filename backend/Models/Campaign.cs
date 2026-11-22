namespace backend.Models;

/// <summary>
/// One printed piece (a flyer, a poster, a batch of them) whose QR points at
/// <c>/q/{Code}</c>. The title is for the panel only and can change freely; the code is
/// what is printed, so it is generated once and never rewritten — renaming a campaign must
/// never break a QR that is already out on the street.
/// </summary>
public sealed class Campaign
{
    public Guid Id { get; init; } = Guid.NewGuid();

    /// <summary>Random, lowercase, a few characters: says nothing about the campaign to whoever scans it.</summary>
    public string Code { get; init; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    /// <summary>When the visits were last wiped from the panel (after testing the QR yourself), if ever.</summary>
    public DateTime? VisitsResetAtUtc { get; set; }

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Someone opened the site through a campaign link. Only a salted hash of the visitor is
/// kept — enough to tell "the same phone twice" from "two people", nothing more.
/// </summary>
public sealed class CampaignVisit
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public string? VisitorHash { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
}
