using backend.Data;
using backend.Services;
using Microsoft.EntityFrameworkCore;

namespace backend.Endpoints;

/// <summary>
/// The admin panel's API. Every route sits behind one gate — <see cref="RequireAdmin"/> —
/// so a new section cannot ship without it.
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

        group.MapGet("/urgencies", async (AdminDashboardService admin, CancellationToken cancellationToken) =>
            Results.Ok(await admin.GetUrgenciesAsync(DateTime.UtcNow, cancellationToken)));

        group.MapGet("/users", async (string? q, int? page, AdminDashboardService admin, CancellationToken cancellationToken) =>
            Results.Ok(await admin.SearchUsersAsync(q, page ?? 1, cancellationToken)));

        group.MapGet("/users/{id:guid}", async (Guid id, AdminDashboardService admin, CancellationToken cancellationToken) =>
            await admin.GetUserAsync(id, cancellationToken) is { } detail ? Results.Ok(detail) : Results.NotFound());

        // The one write the panel has: re-read this account from Mercado Pago. It moves
        // no money — it only catches the local row up with what Mercado Pago already says.
        group.MapPost("/users/{id:guid}/sync", async (
            Guid id,
            AdminDashboardService admin,
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

            return Results.Ok(await admin.GetUserAsync(id, cancellationToken));
        });
    }

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
