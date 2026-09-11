namespace backend.Models;

/// <summary>An internal note an admin left on an account, for support. Never shown to the account itself.</summary>
public sealed class AdminNote
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public Guid AuthorId { get; set; }

    /// <summary>Copied, not joined: the note still says who wrote it if that admin account goes away.</summary>
    public string AuthorEmail { get; set; } = string.Empty;

    public string Text { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
}
