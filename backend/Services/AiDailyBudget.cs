using backend.Data;
using backend.Options;
using Microsoft.EntityFrameworkCore;

namespace backend.Services;

/// <summary>
/// The hard ceiling on what one account can cost in a day, shared by everything that talks
/// to Gemini about a chat — the keyword-hit metrics and the personality profiles. One
/// budget, not one each: otherwise a chat analysed by both would count twice, and an
/// account could spend the cap again just by asking for the other feature.
/// <para>
/// Counted in <em>distinct chats</em> rather than requests or tokens, because that is the
/// thing the caller controls and the thing that actually causes spend: a chat already
/// analysed is answered from cache forever, so repeat traffic is free no matter how much of
/// it there is, while a chat fingerprint never seen before always reaches Gemini. Anything
/// already counted today passes straight through — the cap must never strand someone
/// halfway through the chat they are actually looking at.
/// </para>
/// </summary>
internal static class AiDailyBudget
{
    public static async Task EnsureAsync(
        AppDbContext db,
        GoogleAiOptions options,
        ILogger logger,
        Guid userId,
        string sourceHash,
        CancellationToken cancellationToken)
    {
        var limit = options.MaxChatsPerDay;
        if (limit <= 0)
        {
            return;
        }

        var since = DateTime.UtcNow.Date;

        var metricChats = await db.AiMetricResults
            .Where(item => item.UserId == userId && item.CreatedAtUtc >= since)
            .Select(item => item.SourceHash)
            .Distinct()
            .ToListAsync(cancellationToken);

        var profileChats = await db.AiProfileResults
            .Where(item => item.UserId == userId && item.CreatedAtUtc >= since)
            .Select(item => item.SourceHash)
            .Distinct()
            .ToListAsync(cancellationToken);

        var chatsToday = metricChats.Union(profileChats, StringComparer.Ordinal).ToList();

        if (chatsToday.Count < limit || chatsToday.Contains(sourceHash, StringComparer.Ordinal))
        {
            return;
        }

        logger.LogWarning(
            "User {UserId} hit the daily AI chat limit ({Limit}). Refusing to analyse another chat today.",
            userId,
            limit);

        throw new AiDailyLimitReachedException(
            $"This account has already had {limit} chats analysed by the AI today. The allowance resets at UTC midnight.");
    }
}
