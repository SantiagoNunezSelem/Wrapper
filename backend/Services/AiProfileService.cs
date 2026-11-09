using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>One person as the browser described them, after the server bounded it.</summary>
public sealed record AiProfilePerson(
    string Id,
    IReadOnlyDictionary<string, double> Features,
    IReadOnlyList<string> Messages);

/// <summary>One person as it arrives in the request body — nothing here is trusted yet.</summary>
public sealed record AiProfilePersonInput(
    string? Id,
    Dictionary<string, double>? Features,
    List<string>? Messages);

/// <param name="PersonId">The letter the browser gave this person; the real name never travels.</param>
public sealed record AiProfileStateDto(
    string PersonId,
    string Status,
    string? LabelId,
    string? SecondaryLabelId,
    string? Summary,
    string? ErrorCode,
    DateTime? RetryAvailableAtUtc,
    DateTime UpdatedAtUtc);

/// <summary>
/// Writes the personality profiles. Every path through here is built around one rule —
/// the same one as <see cref="AiMetricService"/>: a person in a chat is profiled once,
/// ever. A cached profile, a request with nothing usable in it and a profile still inside
/// its cooldown all return without spending a single token.
///
/// Unlike the keyword-hit metrics, the unit of failure is the person, not the metric: one
/// person's sample being refused by the safety filter leaves everyone else's profile intact,
/// and the browser shows its own local reading for just that person.
/// </summary>
public sealed partial class AiProfileService(
    AppDbContext db,
    GoogleAiClient client,
    IOptions<GoogleAiOptions> options,
    ILogger<AiProfileService> logger)
{
    /// <summary>
    /// Most people one request may list. The browser profiles the most active handful; a
    /// longer list is not a real client, and every entry is its own Gemini call.
    /// </summary>
    public const int MaxPeoplePerRequest = 16;

    private const int MinSummaryChars = 40;
    private const int MaxSummaryChars = 600;

    /// <summary>
    /// A run of this many consecutive words copied out of the sample is treated as quoting
    /// the chat. The summary may name single words and short expressions — that is how it
    /// stays concrete — but never lift a sentence somebody wrote, which would end up stored
    /// and, if the owner shares the card, published.
    /// </summary>
    private const int CopiedRunWords = 4;

    private const char FieldSeparator = (char)31;

    private readonly GoogleAiOptions _options = options.Value;

    /// <summary>Reads stored profiles without ever calling the model.</summary>
    public async Task<List<AiProfileStateDto>> GetAsync(
        Guid userId,
        string sourceHash,
        string? language,
        CancellationToken cancellationToken)
    {
        var normalized = NormalizeLanguage(language);

        var rows = await db.AiProfileResults
            .Where(item => item.UserId == userId && item.SourceHash == sourceHash && item.Language == normalized)
            .ToListAsync(cancellationToken);

        return rows.OrderBy(item => item.PersonId, StringComparer.Ordinal).Select(ToDto).ToList();
    }

    /// <summary>
    /// Profiles whoever still needs one. The browser sends everyone it wants profiled on
    /// every call — there is no separate "retry" route — and what is already done, or still
    /// cooling down after a failure, is answered from the database.
    /// </summary>
    public async Task<List<AiProfileStateDto>> AnalyzeAsync(
        Guid userId,
        string sourceHash,
        string? language,
        Dictionary<string, double>? group,
        IEnumerable<AiProfilePersonInput>? people,
        CancellationToken cancellationToken)
    {
        await AiDailyBudget.EnsureAsync(db, _options, logger, userId, sourceHash, cancellationToken);

        var normalized = NormalizeLanguage(language);
        var groupFeatures = SanitizeFeatures(group);
        var sanitized = SanitizePeople(people);

        if (sanitized.Count == 0)
        {
            return [];
        }

        var instruction = AiProfilePrompts.SystemInstruction(normalized);

        var rows = await db.AiProfileResults
            .Where(item => item.UserId == userId && item.SourceHash == sourceHash && item.Language == normalized)
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var ordered = new List<AiProfileResult>();
        var pending = new List<PendingProfile>();

        foreach (var person in sanitized)
        {
            var inputHash = ComputeInputHash(instruction, person, groupFeatures, sanitized.Count);
            var row = rows.FirstOrDefault(item => item.PersonId == person.Id);

            // Already written, and nothing about the sample or the prompt has changed: this is
            // the case that makes a re-upload (or a second visit) cost nothing.
            if (row is { Status: AiMetricStatus.Ready } && row.InputHash == inputHash)
            {
                ordered.Add(row);
                continue;
            }

            // Still cooling down after a failure — refuse to spend tokens, hand the caller the
            // timestamp so it can keep counting down.
            if (row is { Status: AiMetricStatus.Failed } && row.RetryAvailableAtUtc is { } retryAt && retryAt > now)
            {
                ordered.Add(row);
                continue;
            }

            row ??= new AiProfileResult
            {
                UserId = userId,
                SourceHash = sourceHash,
                PersonId = person.Id,
                Language = normalized,
            };

            ordered.Add(row);
            pending.Add(new PendingProfile(person, row, inputHash));
        }

        if (pending.Count > 0)
        {
            var outcomes = await GenerateAllAsync(instruction, pending, groupFeatures, sanitized.Count, cancellationToken);
            var usage = new List<AiUsage>();

            foreach (var (item, outcome) in pending.Zip(outcomes))
            {
                Apply(item.Row, item.InputHash, outcome, now);

                if (db.Entry(item.Row).State == EntityState.Detached)
                {
                    db.AiProfileResults.Add(item.Row);
                }

                usage.AddRange(outcome.Usage);
            }

            await db.SaveChangesAsync(cancellationToken);
            await SaveUsageAsync(userId, usage, cancellationToken);
        }

        return ordered.Select(ToDto).ToList();
    }

    /// <summary>
    /// Runs the pending calls a few at a time. They are independent — nothing here touches
    /// the database — so a group's profiles take a few rounds of Gemini's latency instead of
    /// one per person, while the cap keeps a burst under the model's per-minute quota.
    /// </summary>
    private async Task<ProfileOutcome[]> GenerateAllAsync(
        string instruction,
        List<PendingProfile> pending,
        IReadOnlyDictionary<string, double> group,
        int peopleCount,
        CancellationToken cancellationToken)
    {
        using var gate = new SemaphoreSlim(Math.Max(1, _options.ProfileConcurrency));

        var calls = pending.Select(async item =>
        {
            await gate.WaitAsync(cancellationToken);

            try
            {
                return await GenerateAsync(instruction, item.Person, group, peopleCount, cancellationToken);
            }
            finally
            {
                gate.Release();
            }
        });

        return await Task.WhenAll(calls);
    }

    /// <summary>
    /// One person's profile, with one retry for an answer that came back but could not be
    /// used (a label outside the list, a quoted sentence). Failures that retrying cannot fix —
    /// quota, a refusal, a timeout — are not retried here: they go to the cooldown.
    /// </summary>
    private async Task<ProfileOutcome> GenerateAsync(
        string instruction,
        AiProfilePerson person,
        IReadOnlyDictionary<string, double> group,
        int peopleCount,
        CancellationToken cancellationToken)
    {
        var content = AiProfilePrompts.RenderPerson(person, group, peopleCount);
        var usage = new List<AiUsage>();
        string? reason = null;

        for (var attempt = 0; attempt < 2; attempt++)
        {
            var userContent = reason is null ? content : content + "\n\n" + AiProfilePrompts.CorrectionNote(reason);
            var outcome = await client.GenerateProfileAsync(instruction, userContent, cancellationToken);

            if (outcome.InputTokens is not null || outcome.OutputTokens is not null)
            {
                usage.Add(new AiUsage
                {
                    MetricId = AiProfilePrompts.MetricId,
                    InputTokens = outcome.InputTokens ?? 0,
                    OutputTokens = outcome.OutputTokens ?? 0,
                    Succeeded = outcome.IsSuccess,
                });
            }

            if (!outcome.IsSuccess)
            {
                return new ProfileOutcome(null, outcome.ErrorCode ?? AiErrorCode.Unknown, usage);
            }

            var (valid, invalidReason) = Validate(outcome.Answer!, person);
            if (valid is not null)
            {
                return new ProfileOutcome(valid, null, usage);
            }

            logger.LogInformation(
                "Discarding the profile Gemini wrote for person {Person}: {Reason}.",
                person.Id,
                invalidReason);
            reason = invalidReason;
        }

        return new ProfileOutcome(null, AiErrorCode.Invalid, usage);
    }

    /// <summary>
    /// What the model wrote is checked before it is stored, because it will be shown to the
    /// group and may be published. The label has to be one of the closed list; the summary
    /// has to be a sentence or three, free of contact details and of text lifted from the
    /// chat. Returns the cleaned answer, or the reason it cannot be used.
    /// </summary>
    internal static (AiProfileAnswer? Valid, string? Reason) Validate(AiProfileAnswer answer, AiProfilePerson person)
    {
        var label = AiProfilePrompts.NormalizeLabel(answer.Label);
        if (label is null)
        {
            return (null, "la etiqueta no es un id de la lista");
        }

        var secondary = AiProfilePrompts.NormalizeLabel(answer.Secondary);
        if (secondary == label)
        {
            secondary = null;
        }

        var summary = Whitespace().Replace(answer.Summary, " ").Trim();

        if (summary.Length < MinSummaryChars)
        {
            return (null, "el resumen es demasiado corto");
        }

        if (summary.Length > MaxSummaryChars)
        {
            return (null, "el resumen es demasiado largo");
        }

        if (ContainsContactDetails(summary))
        {
            return (null, "el resumen incluye links, mails o teléfonos");
        }

        if (CopiesTheChat(summary, person.Messages))
        {
            return (null, "el resumen copia frases completas del chat");
        }

        return (new AiProfileAnswer(label, secondary, summary), null);
    }

    private static bool CopiesTheChat(string summary, IReadOnlyList<string> messages)
    {
        var summaryWords = Words(summary);
        if (summaryWords.Count < CopiedRunWords)
        {
            return false;
        }

        var runs = new HashSet<string>(StringComparer.Ordinal);

        foreach (var message in messages)
        {
            var words = Words(message);

            for (var start = 0; start + CopiedRunWords <= words.Count; start++)
            {
                runs.Add(string.Join(' ', words.GetRange(start, CopiedRunWords)));
            }
        }

        for (var start = 0; start + CopiedRunWords <= summaryWords.Count; start++)
        {
            if (runs.Contains(string.Join(' ', summaryWords.GetRange(start, CopiedRunWords))))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// True when the text holds a link, a mail address or something shaped like a phone
    /// number. Shared with the share sanitizer, which applies the same rule to what it
    /// publishes.
    /// </summary>
    internal static bool ContainsContactDetails(string text) => ContactDetails().IsMatch(text);

    private static List<string> Words(string text) =>
        WordPattern().Matches(AiProfilePrompts.Fold(text)).Select(match => match.Value).ToList();

    private void Apply(AiProfileResult row, string inputHash, ProfileOutcome outcome, DateTime now)
    {
        row.InputHash = inputHash;
        row.UpdatedAtUtc = now;
        row.AttemptCount += 1;

        if (outcome.Answer is { } answer)
        {
            row.Status = AiMetricStatus.Ready;
            row.LabelId = answer.Label;
            row.SecondaryLabelId = answer.Secondary;
            row.Summary = answer.Summary;
            row.ErrorCode = null;
            row.RetryAvailableAtUtc = null;
            return;
        }

        row.Status = AiMetricStatus.Failed;
        row.LabelId = null;
        row.SecondaryLabelId = null;
        row.Summary = null;
        row.ErrorCode = outcome.ErrorCode ?? AiErrorCode.Unknown;
        // Persisted rather than kept in memory so the countdown survives a refresh and is the
        // same on every device the user opens — and so a failed person cannot be hammered.
        row.RetryAvailableAtUtc = now.AddSeconds(_options.RetryCooldownSeconds);
    }

    /// <summary>
    /// Saved after the profiles and on their own, on purpose: what a call cost is bookkeeping,
    /// and failing to write it must never cost the user the profile those tokens paid for.
    /// </summary>
    private async Task SaveUsageAsync(Guid userId, List<AiUsage> entries, CancellationToken cancellationToken)
    {
        if (entries.Count == 0)
        {
            return;
        }

        foreach (var entry in entries)
        {
            entry.UserId = userId;
        }

        db.AiUsage.AddRange(entries);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
        {
            logger.LogWarning(exception, "Could not record AI token usage for the personality profiles; the profiles themselves were saved.");

            // Left tracked, the failed rows would ride along with the next save and take
            // that one down with them.
            foreach (var entry in entries)
            {
                db.Entry(entry).State = EntityState.Detached;
            }
        }
    }

    private IReadOnlyList<AiProfilePerson> SanitizePeople(IEnumerable<AiProfilePersonInput>? people)
    {
        if (people is null)
        {
            return [];
        }

        var maxPeople = Math.Max(1, _options.MaxProfilePeople);
        var maxMessages = Math.Max(1, _options.MaxProfileMessages);
        var minMessages = Math.Max(1, _options.MinProfileMessages);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<AiProfilePerson>();

        foreach (var person in people)
        {
            if (result.Count >= maxPeople)
            {
                break;
            }

            var id = person.Id?.Trim();

            // A single capital letter, once: the browser's stand-in for a name. Anything
            // longer is a name that should never have been sent.
            if (id is not { Length: 1 } || id[0] is < 'A' or > 'Z' || !seen.Add(id))
            {
                continue;
            }

            var messages = (person.Messages ?? [])
                .Select(CleanMessage)
                .Where(message => message.Length > 0)
                .Take(maxMessages)
                .ToList();

            if (messages.Count < minMessages)
            {
                continue;
            }

            result.Add(new AiProfilePerson(id, SanitizeFeatures(person.Features), messages));
        }

        return result;
    }

    private string CleanMessage(string? message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return string.Empty;
        }

        var collapsed = Whitespace().Replace(message, " ").Trim();
        var max = Math.Max(1, _options.MaxProfileMessageChars);
        return collapsed.Length <= max ? collapsed : collapsed[..max];
    }

    private static Dictionary<string, double> SanitizeFeatures(Dictionary<string, double>? features)
    {
        var result = new Dictionary<string, double>(StringComparer.Ordinal);

        if (features is null)
        {
            return result;
        }

        foreach (var (key, value) in features)
        {
            if (AiProfilePrompts.IsFeatureKey(key) && double.IsFinite(value))
            {
                result[key] = Math.Round(Math.Clamp(value, 0, 100_000), 3);
            }
        }

        return result;
    }

    /// <summary>
    /// Fingerprints the exact payload behind a profile — the sample, the numbers AND the
    /// prompt they were judged against — so a wording fix to
    /// <see cref="AiProfilePrompts.SystemInstruction"/> recomputes instead of leaving the
    /// old profile on screen forever.
    /// </summary>
    private static string ComputeInputHash(
        string instruction,
        AiProfilePerson person,
        IReadOnlyDictionary<string, double> group,
        int peopleCount)
    {
        var canonical = new StringBuilder(instruction).Append(FieldSeparator).Append(peopleCount).Append(FieldSeparator).Append(person.Id);

        foreach (var (key, _, _) in AiProfilePrompts.FeatureDescriptions)
        {
            canonical.Append(FieldSeparator).Append(key).Append('=')
                .Append(person.Features.TryGetValue(key, out var own) ? own.ToString("R", System.Globalization.CultureInfo.InvariantCulture) : "-")
                .Append('/')
                .Append(group.TryGetValue(key, out var average) ? average.ToString("R", System.Globalization.CultureInfo.InvariantCulture) : "-");
        }

        foreach (var message in person.Messages)
        {
            canonical.Append(FieldSeparator).Append(message);
        }

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical.ToString())));
    }

    private static string NormalizeLanguage(string? language) => language == "en" ? "en" : "es";

    private static AiProfileStateDto ToDto(AiProfileResult row) =>
        new(
            row.PersonId,
            row.Status,
            row.LabelId,
            row.SecondaryLabelId,
            row.Summary,
            row.ErrorCode,
            AsUtc(row.RetryAvailableAtUtc),
            AsUtc(row.UpdatedAtUtc) ?? row.UpdatedAtUtc);

    /// <summary>
    /// SQLite stores dates as text and EF reads them back with <c>DateTimeKind.Unspecified</c>,
    /// which System.Text.Json then writes without a trailing "Z" — the browser would read that
    /// as local time and the retry countdown would be off by the timezone offset.
    /// </summary>
    private static DateTime? AsUtc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);

    private sealed record PendingProfile(AiProfilePerson Person, AiProfileResult Row, string InputHash);

    private sealed record ProfileOutcome(AiProfileAnswer? Answer, string? ErrorCode, List<AiUsage> Usage);

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[\p{L}\p{N}]+")]
    private static partial Regex WordPattern();

    /// <summary>Links, mail addresses and anything shaped like a phone number.</summary>
    [GeneratedRegex(@"https?://|www\.|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{7,}\d", RegexOptions.IgnoreCase)]
    private static partial Regex ContactDetails();
}
