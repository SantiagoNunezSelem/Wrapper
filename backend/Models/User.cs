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

    /// <summary>
    /// The last time the app opened with this account signed in, to within an hour: it is
    /// refreshed by <c>/api/auth/me</c> at most once an hour, so it costs one write per
    /// active hour rather than one per page load. It is what "usuarios activos" counts.
    /// </summary>
    public DateTime? LastSeenAtUtc { get; set; }

    /// <summary>
    /// Pro given from the admin panel without a payment — to make up for a mistake, or for
    /// a test. It lives on the account and not in a subscription row on purpose: no charge,
    /// renewal, cancellation or Mercado Pago sync ever reads or writes it.
    /// </summary>
    public DateTime? VipUntilUtc { get; set; }

    /// <summary>
    /// When an admin last handed this account a free week. While <see cref="HasUsedTrial"/>
    /// is false it lets the next checkout carry the trial even if the IP or the device
    /// already used one — which is the whole point of giving it by hand.
    /// </summary>
    public DateTime? TrialGrantedAtUtc { get; set; }

    public List<Subscription> Subscriptions { get; init; } = [];
    public List<SavedAnalysis> Analyses { get; init; } = [];
    public List<AiMetricResult> AiMetricResults { get; init; } = [];
}
