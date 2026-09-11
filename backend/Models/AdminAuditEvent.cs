namespace backend.Models;

/// <summary>
/// Who did what from the admin panel, append-only. No foreign keys on purpose: the trail
/// has to outlive both the admin and the account it touched.
/// </summary>
public sealed class AdminAuditEvent
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid AdminId { get; set; }
    public string AdminEmail { get; set; } = string.Empty;

    /// <summary><see cref="Services.AdminActions"/>.</summary>
    public string Action { get; set; } = string.Empty;

    public Guid? TargetUserId { get; set; }
    public string? Details { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
}
