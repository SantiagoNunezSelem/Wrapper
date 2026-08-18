using System.Net;
using System.Security.Claims;
using backend.Data;
using backend.Models;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace backend.Endpoints;

/// <summary>
/// Local development conveniences, chiefly the VIP switch that makes the paid
/// experience testable without pushing real money through Mercado Pago, plus a reset for
/// the daily free-unlock allowance so that flow can be walked more than once a day.
///
/// Two independent gates, because either one alone eventually fails: the routes are only
/// mapped when the app runs in the Development environment, and every call additionally
/// has to arrive from the loopback address. Shipping a build with ASPNETCORE_ENVIRONMENT
/// misconfigured therefore still does not hand out free Pro over the internet.
/// </summary>
public static class DevEndpoints
{
    public static void MapDevEndpoints(this WebApplication app)
    {
        if (!app.Environment.IsDevelopment())
        {
            return;
        }

        var group = app.MapGroup("/api/dev");

        group.MapGet("/status", (HttpContext http) =>
            IsLoopback(http)
                ? Results.Ok(new { devToolsEnabled = true })
                : Results.NotFound());

        // Grants or removes a fake Pro subscription. It is a real row with
        // IsDevSimulated set, not a client-side flag, so the backend's own Pro gate on
        // the AI routes sees exactly what a paying customer's would.
        group.MapPost("/subscription/toggle", [Authorize] async (
            HttpContext http,
            ClaimsPrincipal principal,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            if (!IsLoopback(http))
            {
                return Results.NotFound();
            }

            var userId = principal.GetRequiredUserId();
            var user = await db.Users
                .Include(candidate => candidate.Subscriptions)
                .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);

            if (user is null)
            {
                return Results.Unauthorized();
            }

            var simulated = user.Subscriptions.FirstOrDefault(item => item.IsDevSimulated);
            var isActive = simulated is not null && SubscriptionAccessEvaluator.HasVipAccess(simulated);

            if (isActive)
            {
                // Removed outright rather than marked cancelled: a cancelled subscription
                // deliberately keeps access until the period ends, which is the opposite
                // of what a "turn it off now" test switch should do.
                db.Subscriptions.Remove(simulated!);
                user.Subscriptions.Remove(simulated!);
            }
            else
            {
                if (simulated is not null)
                {
                    db.Subscriptions.Remove(simulated);
                    user.Subscriptions.Remove(simulated);
                }

                var subscription = new Subscription
                {
                    UserId = user.Id,
                    Status = "activa",
                    PlanType = "mensual",
                    PaymentProvider = "dev",
                    SubscriptionStartsAtUtc = DateTime.UtcNow,
                    NextBillingAtUtc = DateTime.UtcNow.AddMonths(1),
                    IsDevSimulated = true,
                    Amount = 0m,
                };

                db.Subscriptions.Add(subscription);
                user.Subscriptions.Add(subscription);

                db.SubscriptionEvents.Add(new SubscriptionEvent
                {
                    SubscriptionId = subscription.Id,
                    UserId = user.Id,
                    Topic = "dev",
                    Action = "activate",
                    ResultingStatus = "activa",
                    Notes = "Simulated Pro access granted from the local dev toggle.",
                });
            }

            user.UpdatedAtUtc = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);

            return Results.Ok(new
            {
                simulatedSubscriptionActive = !isActive,
                hasVipAccess = SubscriptionAccessEvaluator.HasVipAccess(user),
                subscriptionState = SubscriptionAccessEvaluator.GetVisibleState(user),
            });
        });

        // Hands today's five free unlocks back. Without this, checking the exhausted
        // state and then the fresh state again means waiting for UTC midnight.
        group.MapPost("/free-unlocks/reset", [Authorize] async (
            HttpContext http,
            ClaimsPrincipal principal,
            AppDbContext db,
            // Only so the reply can describe the chat on screen; the reset itself is
            // account-wide and clears every chat's unlocks.
            string? sourceHash,
            CancellationToken cancellationToken) =>
        {
            if (!IsLoopback(http))
            {
                return Results.NotFound();
            }

            var userId = principal.GetRequiredUserId();

            if (!await db.Users.AnyAsync(candidate => candidate.Id == userId, cancellationToken))
            {
                return Results.Unauthorized();
            }

            // Every day's rows, not just today's: this is a test switch, and leaving
            // history behind only invites confusion about which day a row belongs to.
            await db.FreeMetricUnlocks
                .Where(item => item.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            return Results.Ok(await FreeUnlockState.ReadAsync(db, userId, sourceHash?.Trim(), cancellationToken));
        });
    }

    private static bool IsLoopback(HttpContext http)
    {
        // When forwarded headers are trusted, the middleware overwrites RemoteIpAddress
        // with whatever X-Forwarded-For claimed — which would let a remote caller assert
        // "127.0.0.1" and walk straight through this gate into the free-Pro switch. The
        // middleware leaves X-Original-For behind whenever it rewrites, so its presence is
        // proof the address was not observed on the socket and must not be believed here.
        if (http.Request.Headers.ContainsKey("X-Original-For"))
        {
            return false;
        }

        var address = http.Connection.RemoteIpAddress;
        return address is not null &&
               (IPAddress.IsLoopback(address) ||
                // A dual-stack socket reports an IPv4 loopback client as ::ffff:127.0.0.1.
                (address.IsIPv4MappedToIPv6 && IPAddress.IsLoopback(address.MapToIPv4())));
    }
}
