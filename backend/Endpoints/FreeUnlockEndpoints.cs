using System.Security.Claims;
using backend.Data;
using backend.Models;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace backend.Endpoints;

/// <summary>
/// The daily taste test: an account without Pro may open the full detail of a handful of
/// free-tier metrics per day, so the paywall is something people have seen behind rather
/// than only been stopped by.
///
/// Two different scopes meet here, and keeping them apart is the whole design:
/// <list type="bullet">
/// <item>the <em>allowance</em> is per account per day, counted across every chat;</item>
/// <item>each <em>unlock</em> belongs to the one chat it was spent on.</item>
/// </list>
///
/// The allowance is counted server-side because that is the only place it holds: a
/// counter in localStorage resets with a new browser, a cleared cache, or an incognito
/// window, which would make "5 per day" mean nothing.
/// </summary>
public static class FreeUnlockEndpoints
{
    public static void MapFreeUnlockEndpoints(this WebApplication app)
    {
        // `sourceHash` is optional: without a chat loaded there is still a meaningful
        // answer (how many are left today), just no per-chat unlock list to report.
        app.MapGet("/api/metric-unlocks", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            string? sourceHash,
            CancellationToken cancellationToken) =>
        {
            var userId = principal.GetRequiredUserId();

            return await db.Users.AnyAsync(candidate => candidate.Id == userId, cancellationToken)
                ? Results.Ok(await FreeUnlockState.ReadAsync(db, userId, sourceHash?.Trim(), cancellationToken))
                : Results.Unauthorized();
        });

        // Spends one unlock. Idempotent per (user, chat, metric, day): asking again for a
        // metric already unlocked on this chat today costs nothing, which is what lets the
        // client re-request freely without a double-tap quietly burning two of the five.
        app.MapPost("/api/metric-unlocks", [Authorize] async (
            ClaimsPrincipal principal,
            FreeUnlockRequest? request,
            AppDbContext db,
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

            var metricId = request?.MetricId?.Trim();
            var sourceHash = request?.SourceHash?.Trim();

            // The whole point of the allowance is to preview what is already free. A Pro
            // metric can never be bought with it, whatever the client sends.
            if (!FreeMetricCatalog.IsFreeMetric(metricId))
            {
                return Results.Json(
                    new { message = "Only free-tier metrics can be unlocked with a daily free unlock.", code = "vip_metric" },
                    statusCode: StatusCodes.Status403Forbidden);
            }

            // An unlock has to belong to a chat. Without one there is nothing to scope it
            // to, and storing it blank would quietly recreate the old behaviour where a
            // single unlock opened that metric everywhere.
            if (string.IsNullOrWhiteSpace(sourceHash) || sourceHash.Length > 64)
            {
                return Results.Json(
                    new { message = "A valid sourceHash identifying the chat is required.", code = "source_hash_required" },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            // Nothing to spend it on — a Pro account already sees every detail. Refused
            // rather than silently accepted so a stale tab cannot eat an allowance the
            // user would want back the day their subscription lapses.
            if (SubscriptionAccessEvaluator.HasVipAccess(user))
            {
                return Results.Json(
                    new { message = "This account already has Pro access.", code = "vip_active" },
                    statusCode: StatusCodes.Status409Conflict);
            }

            var dayKey = FreeMetricCatalog.DayKey(DateTime.UtcNow);
            // Every chat, because the allowance is the account's — only the idempotency
            // check below narrows to the chat being asked about.
            var todays = await db.FreeMetricUnlocks
                .Where(item => item.UserId == userId && item.DayKeyUtc == dayKey)
                .ToListAsync(cancellationToken);

            if (todays.Any(item => item.MetricId == metricId && item.SourceHash == sourceHash))
            {
                return Results.Ok(await FreeUnlockState.ReadAsync(db, userId, sourceHash, cancellationToken));
            }

            if (todays.Count >= FreeMetricCatalog.DailyLimit)
            {
                return Results.Json(
                    new
                    {
                        message = "No free unlocks left today.",
                        code = "daily_limit_reached",
                        resetsAtUtc = FreeMetricCatalog.NextResetUtc(DateTime.UtcNow),
                    },
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            db.FreeMetricUnlocks.Add(new FreeMetricUnlock
            {
                UserId = userId,
                MetricId = metricId!,
                SourceHash = sourceHash,
                DayKeyUtc = dayKey,
            });

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // Two requests for the same metric and chat raced and the unique index
                // caught the loser. The user got what they asked for either way, so drop
                // the duplicate and report the state the winner produced.
                db.ChangeTracker.Clear();
            }

            return Results.Ok(await FreeUnlockState.ReadAsync(db, userId, sourceHash, cancellationToken));
        });
    }
}

record FreeUnlockRequest(string? MetricId, string? SourceHash);

/// <param name="Used">
/// Unlocks spent today across every chat — this is the account-wide allowance, not a
/// per-chat tally.
/// </param>
/// <param name="UnlockedMetricIds">
/// Metrics unlocked today <em>for <see cref="SourceHash"/> only</em>. Empty when the
/// caller named no chat.
/// </param>
/// <param name="SourceHash">
/// Echoed back so the client can tell which chat this answer describes. Without it, a
/// reply that arrives after the user has already switched chats would be applied to the
/// wrong one — briefly showing a detail nobody paid for.
/// </param>
/// <param name="ResetsAtUtc">
/// Next UTC midnight. An absolute instant rather than "hours left" so the countdown the
/// UI shows keeps running down without asking the server again.
/// </param>
record FreeUnlockStateResponse(
    int DailyLimit,
    int Used,
    int Remaining,
    IReadOnlyList<string> UnlockedMetricIds,
    string? SourceHash,
    DateTime ResetsAtUtc);

static class FreeUnlockState
{
    /// <summary>
    /// Today's allowance for one account, plus what it bought on one chat. Yesterday's
    /// rows are simply not matched by the day key — no cleanup job, and no way for a
    /// stale row to leak into a new day.
    /// </summary>
    public static async Task<FreeUnlockStateResponse> ReadAsync(
        AppDbContext db,
        Guid userId,
        string? sourceHash,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var dayKey = FreeMetricCatalog.DayKey(now);

        var todays = await db.FreeMetricUnlocks
            .Where(item => item.UserId == userId && item.DayKeyUtc == dayKey)
            .OrderBy(item => item.CreatedAtUtc)
            .Select(item => new { item.MetricId, item.SourceHash })
            .ToListAsync(cancellationToken);

        // Counted over every chat; listed for one. That split is the feature: five a day
        // for the account, each one tied to the export it was opened on.
        var used = todays.Count;
        var unlockedMetricIds = string.IsNullOrWhiteSpace(sourceHash)
            ? []
            : todays.Where(item => item.SourceHash == sourceHash).Select(item => item.MetricId).ToList();

        return new FreeUnlockStateResponse(
            FreeMetricCatalog.DailyLimit,
            used,
            Math.Max(0, FreeMetricCatalog.DailyLimit - used),
            unlockedMetricIds,
            sourceHash,
            FreeMetricCatalog.NextResetUtc(now));
    }
}
