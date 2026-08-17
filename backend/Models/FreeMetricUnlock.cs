namespace backend.Models;

/// <summary>
/// One free-tier metric whose full detail a non-Pro user opened, for one chat, on one
/// UTC day.
///
/// Rows are the counter: "how many of today's free unlocks are spent" is
/// <c>COUNT(*) WHERE UserId = … AND DayKeyUtc = today</c> — every chat included. That is
/// what makes the allowance survive a reload, a new chat, or a whole new browser: it
/// lives with the account, not with the session. Nothing is ever deleted on a new day;
/// the day key simply moves on and yesterday's rows stop counting.
///
/// The grain is (user, chat, metric, day): an unlock buys that metric *for the chat it
/// was spent on*. Opening the same metric on a different export is a different thing to
/// look at, so it costs its own unlock — while reopening the one already paid for, in
/// the same chat, stays free for the rest of the day.
/// </summary>
public sealed class FreeMetricUnlock
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>Metric this unlock bought — always one of <see cref="Services.FreeMetricCatalog"/>'s ids.</summary>
    public string MetricId { get; set; } = string.Empty;

    /// <summary>
    /// Which chat it was bought for: the client-side SHA-256 of the normalized chat text,
    /// the same fingerprint the saved analyses and AI verdicts are keyed by. Re-importing
    /// the same export therefore lands on the unlock already paid for rather than asking
    /// for a second one.
    /// </summary>
    public string SourceHash { get; set; } = string.Empty;

    /// <summary>UTC calendar day as <c>yyyy-MM-dd</c>. Stored as text so the daily reset is a plain equality match.</summary>
    public string DayKeyUtc { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
}
