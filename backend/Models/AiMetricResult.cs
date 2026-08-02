namespace backend.Models;

/// <summary>
/// One AI verdict per (user, chat, metric). Kept forever on purpose: once Gemini has
/// judged a chat's candidate messages, that answer is reused for good instead of
/// spending tokens again — including across sessions and re-uploads of the same export.
/// </summary>
public sealed class AiMetricResult
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>Client-side SHA-256 of the normalized chat text. Same fingerprint the saved analyses use.</summary>
    public string SourceHash { get; set; } = string.Empty;

    /// <summary>Metric this verdict belongs to (e.g. "tonopicante", "redflags").</summary>
    public string MetricId { get; set; } = string.Empty;

    /// <summary>
    /// Fingerprint of the exact snippet payload that produced <see cref="ResultJson"/>.
    /// If the keyword dictionaries or the context rules change in code, the payload
    /// changes too and the stale verdict is recomputed instead of silently reused.
    /// </summary>
    public string InputHash { get; set; } = string.Empty;

    /// <summary>
    /// The snippets exactly as sent. Stored so a retry after a failure can re-run
    /// server-side without the browser having to rebuild and re-upload them.
    /// </summary>
    public string InputJson { get; set; } = string.Empty;

    /// <summary><see cref="AiMetricStatus"/>: "ready" or "failed".</summary>
    public string Status { get; set; } = AiMetricStatus.Failed;

    /// <summary>JSON array of the candidate ids the model accepted. Null while failed.</summary>
    public string? ResultJson { get; set; }

    /// <summary><see cref="AiErrorCode"/>. Null once ready.</summary>
    public string? ErrorCode { get; set; }

    /// <summary>Earliest moment a failed metric may be retried. Drives the countdown in the UI.</summary>
    public DateTime? RetryAvailableAtUtc { get; set; }

    public int AttemptCount { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public static class AiMetricStatus
{
    public const string Ready = "ready";
    public const string Failed = "failed";
}

/// <summary>
/// Stable codes the frontend maps to friendly copy. Deliberately coarse — the user
/// never needs to know whether Google said 429 or 503, only whether waiting helps.
/// </summary>
public static class AiErrorCode
{
    /// <summary>Out of quota / rate limited (HTTP 429).</summary>
    public const string Quota = "quota";

    /// <summary>Google unreachable, 5xx, or our own timeout.</summary>
    public const string Unavailable = "unavailable";

    /// <summary>Missing or rejected API key — a server misconfiguration, not a user problem.</summary>
    public const string Config = "config";

    /// <summary>Gemini's safety filter refused to answer for this batch.</summary>
    public const string Blocked = "blocked";

    /// <summary>Answered, but not with the JSON shape we asked for.</summary>
    public const string Invalid = "invalid";

    public const string Unknown = "unknown";
}
