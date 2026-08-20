using System.Security.Claims;
using System.Security.Cryptography;
using backend.Data;
using backend.Models;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

namespace backend.Endpoints;

/// <summary>
/// Public, unlisted share links for a Wrapped run — the one corner of this API that answers
/// without a session.
///
/// <para>The reading endpoint is deliberately anonymous: the entire point is that a link
/// pasted into a group chat opens for people who have never used the app. What keeps that
/// from being an open door is that reads are keyed by an unguessable slug, return a frozen
/// snapshot that was stripped of message text before it was ever stored (see
/// <see cref="SharePayloadSanitizer"/>), and expire on their own.</para>
///
/// <para>Writing is the opposite: it costs a signed-in account and is rate limited, because
/// it is the half that creates rows.</para>
/// </summary>
public static class ShareEndpoints
{
    /// <summary>
    /// How long a link stays readable. Long enough to circulate through a group chat and be
    /// opened by someone who checks their phone next week; short enough that a link which
    /// escaped its intended audience stops working without anyone having to notice.
    /// </summary>
    public const int ExpiryDays = 90;

    /// <summary>
    /// Ceiling on the submitted cards. An order of magnitude under the saved-analysis cap:
    /// a shared run holds no message bubbles, so it is a fraction of the size of the bundle
    /// the same chat is saved as.
    /// </summary>
    private const int MaxCardsJsonChars = 400_000;

    private const int MaxChatNameChars = 200;
    private const int MaxDateRangeLabelChars = 120;

    /// <summary>
    /// Slug length in characters, drawn from <see cref="SlugAlphabet"/>. Twelve characters
    /// of a 58-symbol alphabet is roughly 70 bits — far past guessing, while still short
    /// enough to sit in a URL somebody might read out loud.
    /// </summary>
    private const int SlugLength = 12;

    /// <summary>
    /// Base58: the digits and letters minus the four that get misread when a link is typed
    /// off a screen (0/O, 1/l/I). Sharing links is exactly the case where that matters.
    /// </summary>
    private const string SlugAlphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    public static void MapShareEndpoints(this WebApplication app)
    {
        // ---------------------------------------------------------------------
        // Create — signed in, rate limited
        // ---------------------------------------------------------------------
        app.MapPost("/api/shares", [Authorize] async (
            ClaimsPrincipal principal,
            CreateShareRequest? request,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            var userId = principal.GetRequiredUserId();

            if (!await db.Users.AnyAsync(candidate => candidate.Id == userId, cancellationToken))
            {
                return Results.Unauthorized();
            }

            var chatName = request?.ChatName?.Trim();
            var sourceHash = request?.SourceHash?.Trim();
            var cardsJson = request?.CardsJson;

            if (string.IsNullOrWhiteSpace(chatName) || string.IsNullOrWhiteSpace(cardsJson))
            {
                return Results.BadRequest(new { message = "ChatName and CardsJson are required.", code = "invalid_request" });
            }

            if (string.IsNullOrWhiteSpace(sourceHash) || sourceHash.Length > 64)
            {
                return Results.BadRequest(new { message = "A valid SourceHash is required.", code = "source_hash_required" });
            }

            if (cardsJson.Length > MaxCardsJsonChars)
            {
                return Results.BadRequest(new { message = "CardsJson is too large.", code = "payload_too_large" });
            }

            if (chatName.Length > MaxChatNameChars || (request?.DateRangeLabel?.Length ?? 0) > MaxDateRangeLabelChars)
            {
                return Results.BadRequest(new { message = "ChatName or DateRangeLabel is too long.", code = "invalid_request" });
            }

            // The submitted cards are rebuilt into the publishable shape here rather than
            // stored as sent. This is the line where message text stops: whatever the
            // client posted, only the modeled fields exist past this point.
            var sanitized = SharePayloadSanitizer.Sanitize(cardsJson);

            if (sanitized is null)
            {
                return Results.BadRequest(new { message = "No shareable metrics in the payload.", code = "nothing_to_share" });
            }

            var now = DateTime.UtcNow;

            // Re-sharing the same chat replaces that chat's snapshot instead of minting a
            // second link. Someone who shares, unlocks another metric and shares again
            // means "share the better version" — not "leave the thinner one circulating".
            var existing = await db.SharedStories.FirstOrDefaultAsync(
                item => item.UserId == userId && item.SourceHash == sourceHash,
                cancellationToken);

            var story = existing ?? new SharedStory
            {
                UserId = userId,
                SourceHash = sourceHash,
                Slug = await GenerateUniqueSlugAsync(db, cancellationToken),
            };

            story.ChatName = chatName;
            story.DateRangeLabel = request?.DateRangeLabel?.Trim() ?? string.Empty;
            story.MessageCount = request?.MessageCount ?? 0;
            story.ParticipantCount = request?.ParticipantCount ?? 0;
            story.Language = request?.Language == "en" ? "en" : "es";
            story.PayloadJson = SharePayloadSanitizer.Serialize(sanitized);
            // Re-sharing restarts the clock: the link the user is about to send is the one
            // that should live 90 days, not whatever was left of an older share.
            story.ExpiresAtUtc = now.AddDays(ExpiryDays);

            if (existing is null)
            {
                db.SharedStories.Add(story);
            }

            await db.SaveChangesAsync(cancellationToken);

            return Results.Ok(new CreateShareResponse(story.Slug, story.ExpiresAtUtc));
        }).RequireRateLimiting("share");

        // ---------------------------------------------------------------------
        // Read — public, no session
        // ---------------------------------------------------------------------
        app.MapGet("/api/shares/{slug}", async (
            string slug,
            AppDbContext db,
            CancellationToken cancellationToken) =>
        {
            // Checked before touching the database so a scraper walking junk slugs is
            // rejected on shape rather than costing a query each time.
            if (string.IsNullOrWhiteSpace(slug) || slug.Length != SlugLength || !slug.All(SlugAlphabet.Contains))
            {
                return Results.NotFound(new { message = "This link is not valid.", code = "share_not_found" });
            }

            var story = await db.SharedStories.FirstOrDefaultAsync(item => item.Slug == slug, cancellationToken);

            // Expired reads as "never existed" on purpose: telling an anonymous caller that
            // a slug is real but stale confirms the guess, which is the one thing an
            // unlisted link cannot afford to do.
            if (story is null || story.ExpiresAtUtc <= DateTime.UtcNow)
            {
                return Results.NotFound(new { message = "This link expired or does not exist.", code = "share_not_found" });
            }

            story.ViewCount += 1;
            await db.SaveChangesAsync(cancellationToken);

            return Results.Content(
                BuildSharedStoryJson(story),
                "application/json");
        }).RequireRateLimiting("share-read");
    }

    /// <summary>
    /// Writes the response by hand so the already-sanitized payload can be spliced in as
    /// raw JSON. Re-parsing it into objects only to serialize them straight back would cost
    /// two conversions per view and risk the two shapes drifting apart.
    /// </summary>
    private static string BuildSharedStoryJson(SharedStory story)
    {
        var meta = System.Text.Json.JsonSerializer.Serialize(new
        {
            chatName = story.ChatName,
            dateRangeLabel = story.DateRangeLabel,
            messageCount = story.MessageCount,
            participantCount = story.ParticipantCount,
            language = story.Language,
            createdAtUtc = story.CreatedAtUtc,
            expiresAtUtc = story.ExpiresAtUtc,
        });

        // `meta` is a JSON object, so dropping its closing brace and appending one more
        // property yields a single flat object without re-encoding the cards.
        return $"{meta[..^1]},\"cards\":{story.PayloadJson}}}";
    }

    private static async Task<string> GenerateUniqueSlugAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        // A collision at 70 bits is a theoretical event, but the column is unique and a
        // duplicate would surface as a 500 on somebody's share. Cheap to just re-roll.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var slug = RandomSlug();
            if (!await db.SharedStories.AnyAsync(item => item.Slug == slug, cancellationToken))
            {
                return slug;
            }
        }

        throw new InvalidOperationException("Could not generate a unique share slug.");
    }

    /// <summary>
    /// Cryptographically random, not <c>Random</c>: the slug is the only thing standing
    /// between an unlisted page and anyone who wants to enumerate them, so it must not come
    /// from a predictable sequence.
    /// </summary>
    private static string RandomSlug() =>
        RandomNumberGenerator.GetString(SlugAlphabet, SlugLength);
}

record CreateShareRequest(
    string? ChatName,
    string? DateRangeLabel,
    string? SourceHash,
    string? Language,
    int MessageCount,
    int ParticipantCount,
    /// <summary>The already-gated cards, serialized client-side. Only what the sharer could
    /// actually see is sent — and only the publishable part of that is stored.</summary>
    string? CardsJson);

record CreateShareResponse(string Slug, DateTime ExpiresAtUtc);
