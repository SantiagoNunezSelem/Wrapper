namespace backend.Models;

/// <summary>
/// One Gemini call's token bill, append-only. It is what "gasto en IA" adds up.
///
/// A plain column for the account rather than a foreign key, like <see cref="TrialClaim"/>:
/// what the AI cost has to outlive a deleted account, or deleting one would erase spend.
/// </summary>
public sealed class AiUsage
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string MetricId { get; set; } = string.Empty;
    public int InputTokens { get; set; }

    /// <summary>Answer plus reasoning tokens: Gemini bills both as output.</summary>
    public int OutputTokens { get; set; }

    public bool Succeeded { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
}
