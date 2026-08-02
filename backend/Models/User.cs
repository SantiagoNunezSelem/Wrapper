namespace backend.Models;

public sealed class User
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string? GoogleSubject { get; set; }
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public string PreferredLanguage { get; set; } = "es";
    public bool IsAdmin { get; set; }
    public bool HasUsedTrial { get; set; }

    /// <summary>
    /// When the user agreed to have a filtered handful of their messages sent to
    /// Google's AI for the Pro metrics. Null means no consent yet — and with no
    /// consent we never build a prompt, so nothing leaves the browser.
    /// </summary>
    public DateTime? AiConsentAtUtc { get; set; }

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public List<Subscription> Subscriptions { get; init; } = [];
    public List<SavedAnalysis> Analyses { get; init; } = [];
    public List<AiMetricResult> AiMetricResults { get; init; } = [];
}
