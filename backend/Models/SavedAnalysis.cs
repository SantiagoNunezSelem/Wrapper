namespace backend.Models;

public sealed class SavedAnalysis
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string ChatName { get; set; } = string.Empty;
    public string DateRangeLabel { get; set; } = string.Empty;
    public int MessageCount { get; set; }
    public int ParticipantCount { get; set; }
    public string ResultsJson { get; set; } = string.Empty;
    /// <summary>
    /// SHA-256 fingerprint of the normalized source chat text, computed client-side.
    /// Never the raw text itself — lets the backend recognize "the same chat was
    /// re-uploaded" without ever seeing message content, so history doesn't fill up
    /// with duplicate rows for an identical export.
    /// </summary>
    public string SourceHash { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
