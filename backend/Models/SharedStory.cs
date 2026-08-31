namespace backend.Models;

/// <summary>
/// A public, unlisted snapshot of one chat's Wrapped run, readable without signing in.
///
/// Three things make this safe enough to hand out as a link:
///
/// <list type="bullet">
/// <item>It is a <b>snapshot</b>, not a live view. What the sharer could see at the moment
/// they pressed Share — Pro metrics, daily free unlocks and all — is frozen into
/// <see cref="PayloadJson"/>. Losing Pro later never retroactively empties a link that is
/// already circulating, and gaining it never enriches one.</item>
/// <item>It carries <b>no literal message text</b>. The payload is rebuilt server-side
/// through <see cref="Services.SharePayloadSanitizer"/>, which models only the fields that
/// hold aggregates — so chat bubbles and quoted lines cannot survive the round trip even
/// if a tampered client sends them.</item>
/// <item>It <b>expires</b>. A link that escaped its intended group stops working on its
/// own rather than living forever.</item>
/// </list>
///
/// The row keeps <see cref="UserId"/> so abuse is attributable and a deleted account takes
/// its shares with it — never to gate reads, which are deliberately anonymous.
/// </summary>
public sealed class SharedStory
{
    public Guid Id { get; init; } = Guid.NewGuid();

    /// <summary>
    /// The public identifier that appears in the URL (<c>/s/{slug}</c>). Random rather
    /// than derived from the row id or the chat: a guessable slug would turn "unlisted"
    /// into "enumerable", and the whole privacy story rests on the link being unguessable.
    /// </summary>
    public string Slug { get; set; } = string.Empty;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// Fingerprint of the chat this came from — the same client-side hash the saved
    /// analyses and free unlocks are keyed by. Lets re-sharing the same chat replace the
    /// previous snapshot instead of leaving a trail of stale links behind.
    /// </summary>
    public string SourceHash { get; set; } = string.Empty;

    public string ChatName { get; set; } = string.Empty;
    public string DateRangeLabel { get; set; } = string.Empty;
    public int MessageCount { get; set; }
    public int ParticipantCount { get; set; }

    /// <summary>Language the snapshot was rendered in — the labels inside the payload are
    /// already translated, so the public page has to show it in the same language rather
    /// than the visitor's.</summary>
    public string Language { get; set; } = "es";

    /// <summary>The sanitized cards, as produced by <see cref="Services.SharePayloadSanitizer"/>.</summary>
    public string PayloadJson { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime ExpiresAtUtc { get; set; }

    /// <summary>Bumped on each public read. Not a metric anyone is shown — it exists so a
    /// link being scraped in a loop is visible when looking into abuse.</summary>
    public int ViewCount { get; set; }
}
