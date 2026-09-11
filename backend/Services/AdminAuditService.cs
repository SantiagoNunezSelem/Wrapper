using backend.Data;
using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Services;

/// <summary>What an admin can do from the panel, as written to the audit trail.</summary>
public static class AdminActions
{
    public const string NoteAdded = "note_added";
    public const string Sync = "sync";
    public const string ExportUsers = "export_users";
    public const string ExportInvoices = "export_invoices";
    public const string GrantVip = "grant_vip";
    public const string RevokeVip = "revoke_vip";
    public const string GrantTrial = "grant_trial";
}

/// <summary>
/// Internal notes on accounts, and the trail of who did what from the panel. The trail
/// goes first on purpose: it has to exist before the panel gets any action that moves
/// money or access, not after.
/// </summary>
public sealed class AdminAuditService(AppDbContext db)
{
    public const int MaxNoteLength = 2000;
    private const int MaxDetailsLength = 500;

    public async Task RecordAsync(
        Guid adminId,
        string adminEmail,
        string action,
        Guid? targetUserId,
        string? details,
        CancellationToken cancellationToken)
    {
        db.AdminAuditEvents.Add(new AdminAuditEvent
        {
            AdminId = adminId,
            AdminEmail = adminEmail,
            Action = action,
            TargetUserId = targetUserId,
            Details = details is { Length: > MaxDetailsLength } ? details[..MaxDetailsLength] : details,
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Null when the account does not exist. The caller rejects empty text before this.</summary>
    public async Task<AdminNoteDto?> AddNoteAsync(
        Guid userId,
        Guid adminId,
        string adminEmail,
        string text,
        CancellationToken cancellationToken)
    {
        if (!await db.Users.AnyAsync(user => user.Id == userId, cancellationToken))
        {
            return null;
        }

        var trimmed = text.Trim();
        var note = new AdminNote
        {
            UserId = userId,
            AuthorId = adminId,
            AuthorEmail = adminEmail,
            Text = trimmed.Length > MaxNoteLength ? trimmed[..MaxNoteLength] : trimmed,
        };

        db.AdminNotes.Add(note);
        db.AdminAuditEvents.Add(new AdminAuditEvent
        {
            AdminId = adminId,
            AdminEmail = adminEmail,
            Action = AdminActions.NoteAdded,
            TargetUserId = userId,
        });
        await db.SaveChangesAsync(cancellationToken);

        return new AdminNoteDto(note.Id, note.AuthorEmail, note.Text, note.CreatedAtUtc);
    }

    public async Task<IReadOnlyList<AdminAuditDto>> GetRecentAsync(int take, CancellationToken cancellationToken) =>
        await db.AdminAuditEvents
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(take)
            .Select(item => new AdminAuditDto(item.Id, item.AdminEmail, item.Action, item.TargetUserId, item.Details, item.CreatedAtUtc))
            .ToListAsync(cancellationToken);
}

public sealed record AdminAuditDto(Guid Id, string AdminEmail, string Action, Guid? TargetUserId, string? Details, DateTime CreatedAtUtc);
