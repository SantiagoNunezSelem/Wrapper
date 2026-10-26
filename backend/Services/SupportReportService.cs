using System.Net.Mail;
using backend.Data;
using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Services;

/// <summary>
/// The help page's reports: written by the account that has the problem, read and closed
/// from the admin panel. Nothing is mailed anywhere — the panel is the inbox.
/// </summary>
public sealed class SupportReportService(AppDbContext db)
{
    public const int PageSize = 20;
    public const int MinDescriptionLength = 10;
    public const int MaxDescriptionLength = 4000;
    private const int MaxUserAgentLength = 400;
    private const int MaxViewportLength = 20;

    /// <summary>
    /// What one account may send. Counted over a sliding window — the last 24 hours, the last
    /// 7 days — and not over calendar days: with a calendar day, two reports at 23:59 and two
    /// more at 00:01 would be four in two minutes, and the week would reset on a Monday no
    /// account can see.
    /// </summary>
    public const int MaxPerDay = 2;
    public const int MaxPerWeek = 5;

    public const string DailyLimitCode = "daily_limit";
    public const string WeeklyLimitCode = "weekly_limit";

    private static readonly TimeSpan DayWindow = TimeSpan.FromHours(24);
    private static readonly TimeSpan WeekWindow = TimeSpan.FromDays(7);

    /// <summary>
    /// A code is random, so two reports can draw the same one; the unique index lets only the
    /// first win and the other draws again. With 387 million codes that is a rare event, and a
    /// handful of attempts is far more than it ever needs.
    /// </summary>
    private const int TicketCodeAttempts = 5;

    /// <summary>
    /// Files a report, or says why not. The field checks mirror the form's own, so a refusal
    /// there only ever reaches someone who skipped the form; the two limits are the ones a real
    /// person can hit.
    ///
    /// The limits come first: someone who cannot send anything more should hear that before
    /// being told their description is too short. Counting and then inserting is not atomic, so
    /// two requests landing in the same instant could slip one report past a limit. That is
    /// accepted: the per-account rate limiter on the route bounds it, and the cost of one
    /// extra row in a support inbox is nothing.
    /// </summary>
    public async Task<SupportReportResult> SubmitAsync(
        User user,
        SupportReportRequest request,
        string? userAgent,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var limited = await CheckLimitsAsync(user.Id, now, cancellationToken);
        if (limited is not null)
        {
            return limited;
        }

        var email = request.ContactEmail?.Trim() ?? string.Empty;
        if (!IsPlausibleEmail(email))
        {
            return SupportReportResult.Fail("invalid_email", "Revisá el mail: no parece una dirección válida.");
        }

        var category = request.Category?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!SupportReportCategories.All.Contains(category))
        {
            return SupportReportResult.Fail("invalid_category", "Elegí de qué se trata el problema.");
        }

        var description = request.Description?.Trim() ?? string.Empty;
        if (description.Length < MinDescriptionLength)
        {
            return SupportReportResult.Fail("description_too_short", "Contanos un poco más de lo que pasó.");
        }

        if (description.Length > MaxDescriptionLength)
        {
            return SupportReportResult.Fail("description_too_long", $"La descripción puede tener hasta {MaxDescriptionLength} caracteres.");
        }

        var report = new SupportReport
        {
            UserId = user.Id,
            ContactEmail = email,
            Category = category,
            Description = description,
            UserAgent = Truncate(userAgent, MaxUserAgentLength),
            Viewport = Truncate(request.Viewport?.Trim(), MaxViewportLength),
            Language = request.Language is "es" or "en" ? request.Language : null,
            SubscriptionState = SubscriptionAccessEvaluator.GetVisibleState(user),
        };

        for (var attempt = 1; ; attempt++)
        {
            report.TicketCode = TicketCodes.Generate();
            db.SupportReports.Add(report);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (DbUpdateException) when (attempt < TicketCodeAttempts)
            {
                // Another report already has this code. Forget the failed insert and draw again.
                db.Entry(report).State = EntityState.Detached;
            }
        }

        return SupportReportResult.Ok(new SupportReportReceipt(report.Id, report.TicketCode, report.CreatedAtUtc));
    }

    /// <summary>
    /// Null while the account is under both limits. Over one, the refusal names the code the
    /// account already has: the most recent one still open, or else the most recent of all —
    /// someone who keeps writing about the same problem is best answered by saying it is known
    /// and being watched.
    /// </summary>
    private async Task<SupportReportResult?> CheckLimitsAsync(Guid userId, DateTime now, CancellationToken cancellationToken)
    {
        var weekAgo = now - WeekWindow;
        var dayAgo = now - DayWindow;

        var recent = await db.SupportReports
            .Where(item => item.UserId == userId && item.CreatedAtUtc > weekAgo)
            .OrderByDescending(item => item.CreatedAtUtc)
            .Select(item => new { item.TicketCode, item.Status, item.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        var code = recent.Count(item => item.CreatedAtUtc > dayAgo) >= MaxPerDay
            ? DailyLimitCode
            : recent.Count >= MaxPerWeek ? WeeklyLimitCode : null;

        if (code is null)
        {
            return null;
        }

        var cited = recent.FirstOrDefault(item => item.Status == SupportReportStatuses.Open) ?? recent[0];
        var ticket = new SupportReportTicket(cited.TicketCode, cited.Status);
        return SupportReportResult.Limited(code, LimitMessage(code, ticket), ticket);
    }

    private static string LimitMessage(string code, SupportReportTicket ticket)
    {
        var limit = code == DailyLimitCode
            ? $"Ya mandaste {MaxPerDay} reportes en las últimas 24 horas, que es el máximo por día."
            : $"Ya mandaste {MaxPerWeek} reportes en los últimos 7 días, que es el máximo por semana.";

        var ticketLine = ticket.Status == SupportReportStatuses.Resolved
            ? $"Tu consulta con el código {ticket.Code} figura como resuelta: si el problema sigue, volvé a escribirnos cuando se libere el cupo."
            : $"Tu consulta está registrada con el código {ticket.Code} y la estamos monitoreando: no hace falta que escribas de nuevo.";

        return $"{limit} {ticketLine}";
    }

    public async Task<SupportReportPage> GetPageAsync(string? status, int page, CancellationToken cancellationToken)
    {
        page = Math.Max(1, page);
        var reports = db.SupportReports.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
        {
            reports = reports.Where(item => item.Status == status);
        }

        var total = await reports.CountAsync(cancellationToken);
        var rows = await reports
            .OrderByDescending(item => item.CreatedAtUtc)
            .Skip((page - 1) * PageSize)
            .Take(PageSize)
            .Join(db.Users, report => report.UserId, user => user.Id, (report, user) => new { Report = report, user.Email })
            .ToListAsync(cancellationToken);

        var counts = await db.SupportReports
            .GroupBy(item => item.Status)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        return new SupportReportPage(
            total,
            page,
            PageSize,
            rows.Select(row => ToRow(row.Report, row.Email)).ToList(),
            counts.ToDictionary(item => item.Key ?? "?", item => item.Count));
    }

    /// <summary>Null when there is no such report. The caller has already checked <paramref name="status"/>.</summary>
    public async Task<SupportReportRow?> SetStatusAsync(Guid id, string status, string adminEmail, CancellationToken cancellationToken)
    {
        var report = await db.SupportReports.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (report is null)
        {
            return null;
        }

        report.Status = status;
        report.ResolvedAtUtc = status == SupportReportStatuses.Resolved ? DateTime.UtcNow : null;
        report.ResolvedByEmail = status == SupportReportStatuses.Resolved ? adminEmail : null;
        await db.SaveChangesAsync(cancellationToken);

        var accountEmail = await db.Users
            .Where(user => user.Id == report.UserId)
            .Select(user => user.Email)
            .FirstOrDefaultAsync(cancellationToken);
        return ToRow(report, accountEmail ?? string.Empty);
    }

    public Task<int> CountOpenAsync(CancellationToken cancellationToken) =>
        db.SupportReports.CountAsync(item => item.Status == SupportReportStatuses.Open, cancellationToken);

    /// <summary>
    /// Good enough to answer to, nothing more: a single address with no display name. The
    /// form already uses the browser's own check; this is for requests that skip it.
    /// </summary>
    public static bool IsPlausibleEmail(string value) =>
        value.Length is > 3 and <= 320 &&
        !value.Any(char.IsWhiteSpace) &&
        MailAddress.TryCreate(value, out var parsed) &&
        parsed.Address == value &&
        parsed.Host.Contains('.');

    private static SupportReportRow ToRow(SupportReport report, string accountEmail) =>
        new(
            report.Id,
            report.TicketCode,
            report.UserId,
            accountEmail,
            report.ContactEmail,
            report.Category,
            report.Description,
            report.UserAgent,
            report.Viewport,
            report.Language,
            report.SubscriptionState,
            report.Status,
            report.CreatedAtUtc,
            report.ResolvedAtUtc,
            report.ResolvedByEmail);

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? null : value.Length > max ? value[..max] : value;
}

/// <summary>What the help form sends. The browser is read from the request, not from here.</summary>
public sealed record SupportReportRequest(
    string? ContactEmail,
    string? Category,
    string? Description,
    string? Viewport = null,
    string? Language = null);

public sealed record SupportReportReceipt(Guid Id, string TicketCode, DateTime CreatedAtUtc);

/// <summary>The report a refusal points at: its code and whether it is still open.</summary>
public sealed record SupportReportTicket(string Code, string Status);

/// <param name="Ticket">Only on a refusal for a limit: the report the account already has.</param>
public sealed record SupportReportResult(SupportReportReceipt? Receipt, string? Code, string? Message, SupportReportTicket? Ticket = null)
{
    public static SupportReportResult Ok(SupportReportReceipt receipt) => new(receipt, null, null);

    public static SupportReportResult Fail(string code, string message) => new(null, code, message);

    public static SupportReportResult Limited(string code, string message, SupportReportTicket ticket) =>
        new(null, code, message, ticket);
}

public sealed record SupportReportRow(
    Guid Id,
    string TicketCode,
    Guid UserId,
    string AccountEmail,
    string ContactEmail,
    string Category,
    string Description,
    string? UserAgent,
    string? Viewport,
    string? Language,
    string? SubscriptionState,
    string Status,
    DateTime CreatedAtUtc,
    DateTime? ResolvedAtUtc,
    string? ResolvedByEmail);

public sealed record SupportReportPage(
    int Total,
    int Page,
    int PageSize,
    IReadOnlyList<SupportReportRow> Items,
    IReadOnlyDictionary<string, int> CountsByStatus);
