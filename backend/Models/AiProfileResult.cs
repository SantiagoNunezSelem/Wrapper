namespace backend.Models;

/// <summary>
/// One personality profile per (user, chat, language, person). Kept for good on purpose, like
/// <see cref="AiMetricResult"/>: once Gemini has written a profile for a chat, reopening or
/// re-uploading that export costs nothing.
///
/// What is stored is what the model <em>wrote</em> — a label from a closed list and a short
/// summary — and never what it read. The sample of messages the browser sent is judged and
/// dropped; only its fingerprint (<see cref="InputHash"/>) stays, so a changed prompt or a
/// changed sample recomputes instead of showing a stale profile.
/// </summary>
public sealed class AiProfileResult
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>Client-side SHA-256 of the normalized chat text. Same fingerprint the saved analyses use.</summary>
    public string SourceHash { get; set; } = string.Empty;

    /// <summary>
    /// The letter the browser gave this person for this chat ("A", "B"…). Names never reach
    /// the server: the browser maps the letter back to the real participant.
    /// </summary>
    public string PersonId { get; set; } = string.Empty;

    /// <summary>"es" or "en". The summary is prose, so each language is its own row.</summary>
    public string Language { get; set; } = "es";

    /// <summary>Fingerprint of the exact prompt and sample that produced this row.</summary>
    public string InputHash { get; set; } = string.Empty;

    /// <summary><see cref="AiMetricStatus"/>: "ready" or "failed".</summary>
    public string Status { get; set; } = AiMetricStatus.Failed;

    /// <summary>One of the closed label ids (see <c>AiProfilePrompts.LabelIds</c>). Null while failed.</summary>
    public string? LabelId { get; set; }

    /// <summary>An optional second label, from the same closed list.</summary>
    public string? SecondaryLabelId { get; set; }

    public string? Summary { get; set; }

    /// <summary><see cref="AiErrorCode"/>. Null once ready.</summary>
    public string? ErrorCode { get; set; }

    /// <summary>Earliest moment a failed profile may be retried. Drives the countdown in the UI.</summary>
    public DateTime? RetryAvailableAtUtc { get; set; }

    public int AttemptCount { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
