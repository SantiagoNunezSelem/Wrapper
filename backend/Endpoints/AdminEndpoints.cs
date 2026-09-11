using System.Security.Claims;
using System.Text;
using backend.Data;
using backend.Services;
using Microsoft.EntityFrameworkCore;

namespace backend.Endpoints;

/// <summary>
/// The admin panel's API. Every route sits behind one gate — <see cref="RequireAdmin"/> —
/// so a new section cannot ship without it. The only writes are a re-read from Mercado
/// Pago and internal notes; both land in the audit trail, as do the exports.
/// </summary>
public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/admin")
            .RequireAuthorization()
            .AddEndpointFilter(RequireAdmin);

        group.MapGet("/business", async (int? days, AdminDashboardService admin, CancellationToken cancellationToken) =>
            Results.Ok(await admin.GetBusinessAsync(days ?? 30, DateTime.UtcNow, cancellationToken)));

        group.MapGet("/urgencies", async (AdminDashboardService admin, MercadoPagoAccountProbe probe, CancellationToken cancellationToken) =>
            Results.Ok(await admin.GetUrgenciesAsync(DateTime.UtcNow, await probe.GetAsync(cancellationToken), cancellationToken)));

        group.MapGet("/users", async (string? q, int? page, AdminDashboardService admin, CancellationToken cancellationToken) =>
            Results.Ok(await admin.SearchUsersAsync(q, page ?? 1, cancellationToken)));

        group.MapGet("/users/{id:guid}", async (Guid id, AdminDashboardService admin, CancellationToken cancellationToken) =>
            await admin.GetUserAsync(id, cancellationToken) is { } detail ? Results.Ok(detail) : Results.NotFound());

        // Re-reads the account from Mercado Pago. It moves no money — it only catches the
        // local row up with what Mercado Pago already says.
        group.MapPost("/users/{id:guid}/sync", async (
            Guid id,
            ClaimsPrincipal principal,
            AdminDashboardService admin,
            AdminAuditService audit,
            SubscriptionService subscriptions,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            var user = await admin.LoadUserAsync(id, cancellationToken);
            if (user is null)
            {
                return Results.NotFound();
            }

            try
            {
                await subscriptions.SyncAsync(user, cancellationToken);
            }
            catch (MercadoPagoException exception)
            {
                loggerFactory.CreateLogger("Admin").LogError(exception, "Admin sync failed for user {UserId}.", id);
                return Results.Json(
                    new { message = "Mercado Pago no respondió. Probá de nuevo en un momento.", code = "provider_error" },
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var (adminId, adminEmail) = Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.Sync, id, null, cancellationToken);
            return Results.Ok(await admin.GetUserAsync(id, cancellationToken));
        });

        group.MapPost("/users/{id:guid}/notes", async (
            Guid id,
            AdminNoteRequest request,
            ClaimsPrincipal principal,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Text))
            {
                return Results.BadRequest(new { message = "La nota está vacía.", code = "empty_note" });
            }

            var (adminId, adminEmail) = Actor(principal);
            return await audit.AddNoteAsync(id, adminId, adminEmail, request.Text, cancellationToken) is { } note
                ? Results.Ok(note)
                : Results.NotFound();
        });

        group.MapGet("/invoices", async (string? status, int? page, AdminReportsService reports, CancellationToken cancellationToken) =>
            Results.Ok(await reports.GetInvoicesAsync(status, page ?? 1, DateTime.UtcNow, cancellationToken)));

        group.MapGet("/ai", async (int? days, AdminReportsService reports, CancellationToken cancellationToken) =>
            Results.Ok(await reports.GetAiReportAsync(days ?? 30, DateTime.UtcNow, cancellationToken)));

        group.MapGet("/product", async (int? days, AdminReportsService reports, CancellationToken cancellationToken) =>
            Results.Ok(await reports.GetProductReportAsync(days ?? 30, DateTime.UtcNow, cancellationToken)));

        group.MapGet("/system", async (
            AdminReportsService reports,
            AdminAuditService audit,
            MercadoPagoAccountProbe probe,
            CancellationToken cancellationToken) =>
            Results.Ok(await reports.GetSystemReportAsync(
                await probe.GetAsync(cancellationToken),
                await audit.GetRecentAsync(50, cancellationToken),
                DateTime.UtcNow,
                cancellationToken)));

        group.MapGet("/export/users.csv", async (
            ClaimsPrincipal principal,
            AdminReportsService reports,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            var csv = await reports.ExportUsersCsvAsync(cancellationToken);
            var (adminId, adminEmail) = Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.ExportUsers, null, null, cancellationToken);
            return Results.File(Encoding.UTF8.GetBytes(csv), "text/csv; charset=utf-8", "vistazo-usuarios.csv");
        });

        group.MapGet("/export/invoices.csv", async (
            ClaimsPrincipal principal,
            AdminReportsService reports,
            AdminAuditService audit,
            CancellationToken cancellationToken) =>
        {
            var csv = await reports.ExportInvoicesCsvAsync(cancellationToken);
            var (adminId, adminEmail) = Actor(principal);
            await audit.RecordAsync(adminId, adminEmail, AdminActions.ExportInvoices, null, null, cancellationToken);
            return Results.File(Encoding.UTF8.GetBytes(csv), "text/csv; charset=utf-8", "vistazo-cobros.csv");
        });
    }

    private static (Guid Id, string Email) Actor(ClaimsPrincipal principal) =>
        (principal.GetRequiredUserId(), principal.FindFirstValue(ClaimTypes.Email) ?? string.Empty);

    /// <summary>
    /// Re-reads <c>IsAdmin</c> from the database on every request instead of trusting the
    /// role claim in the token: that claim lives as long as the token does (hours), so
    /// taking admin away from someone would not apply until it expired.
    ///
    /// 404 rather than 403, like the payments diagnostics: an endpoint that describes the
    /// business should not confirm its own existence to an account that cannot read it.
    /// </summary>
    private static async ValueTask<object?> RequireAdmin(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var db = http.RequestServices.GetRequiredService<AppDbContext>();
        var userId = http.User.GetRequiredUserId();

        var isAdmin = await db.Users
            .Where(candidate => candidate.Id == userId)
            .Select(candidate => candidate.IsAdmin)
            .FirstOrDefaultAsync(http.RequestAborted);

        return isAdmin ? await next(context) : Results.NotFound();
    }
}

public sealed record AdminNoteRequest(string? Text);
