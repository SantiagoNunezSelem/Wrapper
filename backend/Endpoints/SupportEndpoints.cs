using System.Security.Claims;
using backend.Data;
using backend.Services;
using Microsoft.EntityFrameworkCore;

namespace backend.Endpoints;

/// <summary>
/// The help page's one route: send a report. Only for a signed-in account — that is what
/// lets the panel open the account next to the report. Each account may send
/// <see cref="SupportReportService.MaxPerDay"/> a day and <see cref="SupportReportService.MaxPerWeek"/>
/// a week (checked in the service), and the per-account rate limiter on the route is a second,
/// blunter net under that: it counts every request, valid or not.
/// </summary>
public static class SupportEndpoints
{
    public static void MapSupportEndpoints(this WebApplication app)
    {
        app.MapPost("/api/support/reports", async (
            SupportReportRequest request,
            HttpContext http,
            ClaimsPrincipal principal,
            AppDbContext db,
            SupportReportService reports,
            CancellationToken cancellationToken) =>
        {
            var userId = principal.GetRequiredUserId();
            var user = await db.Users
                .Include(candidate => candidate.Subscriptions)
                .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);

            if (user is null)
            {
                return Results.Unauthorized();
            }

            var result = await reports.SubmitAsync(user, request, http.Request.Headers.UserAgent.ToString(), cancellationToken);

            if (result.Receipt is { } receipt)
            {
                return Results.Ok(receipt);
            }

            // Over a limit: 429, with the code of the report the account already has so the page
            // can tell it which one to refer to. The status is that report's own ("nuevo" / "resuelto").
            if (result.Ticket is { } ticket)
            {
                return Results.Json(
                    new { message = result.Message, code = result.Code, ticketCode = ticket.Code, ticketStatus = ticket.Status },
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            return Results.BadRequest(new { message = result.Message, code = result.Code });
        })
        .RequireAuthorization()
        .RequireRateLimiting("support");
    }
}
