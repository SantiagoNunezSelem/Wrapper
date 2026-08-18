using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>One already-filtered fragment of chat, as the browser built it.</summary>
public sealed record AiSnippetInput(string Id, string Keyword, string Text);

public sealed record AiMetricRequestItem(string MetricId, List<AiSnippetInput> Snippets);

public sealed record AiMetricStateDto(
    string MetricId,
    string Status,
    IReadOnlyList<string> AcceptedIds,
    string? ErrorCode,
    DateTime? RetryAvailableAtUtc,
    DateTime UpdatedAtUtc);

/// <summary>
/// Decides when a Gemini call is actually worth making. Every path through here is
/// built around one rule: a chat+metric is judged once, ever. Cached verdicts, empty
/// candidate sets and metrics still inside their cooldown all return without spending
/// a single token.
/// </summary>
public sealed class AiMetricService(
    AppDbContext db,
    GoogleAiClient client,
    IOptions<GoogleAiOptions> options,
    ILogger<AiMetricService> logger)
{
    /// <summary>Ceiling on one snippet's length. A client can't make us pay for a novel.</summary>
    private const int MaxSnippetChars = 1200;

    /// <summary>
    /// ASCII unit separator, used only to build the input fingerprint. Between fields so
    /// two different snippet sets can't collide by shifting characters across a boundary,
    /// and it can never appear in a WhatsApp export.
    /// </summary>
    private const char FieldSeparator = (char)31;

    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    private readonly GoogleAiOptions _options = options.Value;

    /// <summary>Reads stored verdicts without ever calling the model.</summary>
    public async Task<List<AiMetricStateDto>> GetAsync(Guid userId, string sourceHash, CancellationToken cancellationToken)
    {
        var rows = await db.AiMetricResults
            .Where(item => item.UserId == userId && item.SourceHash == sourceHash)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    /// <summary>
    /// Runs the metrics that still need a verdict. Each metric succeeds or fails on its
    /// own — one running out of quota never invalidates another that already answered.
    /// </summary>
    public async Task<List<AiMetricStateDto>> AnalyzeAsync(
        Guid userId,
        string sourceHash,
        IReadOnlyList<AiMetricRequestItem> requests,
        CancellationToken cancellationToken)
    {
        var results = new List<AiMetricStateDto>();

        foreach (var request in requests)
        {
            if (!AiMetricPrompts.IsSupported(request.MetricId))
            {
                logger.LogWarning("Ignoring unsupported AI metric id {MetricId}.", request.MetricId);
                continue;
            }

            var snippets = Sanitize(request.Snippets);
            results.Add(await ResolveAsync(userId, sourceHash, request.MetricId, snippets, cancellationToken));
        }

        return results;
    }

    /// <summary>
    /// Re-runs every metric of this chat that is currently failed, reusing the snippets
    /// stored when it first failed — so the browser doesn't have to rebuild or re-upload
    /// anything, and a metric that already succeeded is never charged for twice.
    /// </summary>
    public async Task<List<AiMetricStateDto>> RetryFailedAsync(
        Guid userId,
        string sourceHash,
        CancellationToken cancellationToken)
    {
        var rows = await db.AiMetricResults
            .Where(item => item.UserId == userId && item.SourceHash == sourceHash)
            .ToListAsync(cancellationToken);

        // Snapshot the healthy ones first: they are echoed back untouched so the caller
        // can refresh the whole board from one response, and re-reading them after the
        // retries would double-count anything that just turned ready.
        var results = rows
            .Where(item => item.Status != AiMetricStatus.Failed)
            .Select(ToDto)
            .ToList();

        foreach (var row in rows.Where(item => item.Status == AiMetricStatus.Failed))
        {
            var snippets = DeserializeSnippets(row.InputJson);
            results.Add(await ResolveAsync(userId, sourceHash, row.MetricId, snippets, cancellationToken));
        }

        return results;
    }

    private async Task<AiMetricStateDto> ResolveAsync(
        Guid userId,
        string sourceHash,
        string metricId,
        IReadOnlyList<AiSnippetInput> snippets,
        CancellationToken cancellationToken)
    {
        var inputHash = ComputeInputHash(snippets);
        var now = DateTime.UtcNow;

        var row = await db.AiMetricResults.FirstOrDefaultAsync(
            item => item.UserId == userId && item.SourceHash == sourceHash && item.MetricId == metricId,
            cancellationToken);

        // Already judged, and the candidate set hasn't changed: this is the case that
        // makes a re-upload (or a second visit) cost nothing.
        if (row is { Status: AiMetricStatus.Ready } && row.InputHash == inputHash)
        {
            return ToDto(row);
        }

        // Still cooling down after a failure — refuse to spend tokens, hand the caller
        // the timestamp so it can keep counting down.
        if (row is { Status: AiMetricStatus.Failed }
            && row.RetryAvailableAtUtc is { } retryAt
            && retryAt > now)
        {
            return ToDto(row);
        }

        row ??= new AiMetricResult
        {
            UserId = userId,
            SourceHash = sourceHash,
            MetricId = metricId,
        };

        row.InputHash = inputHash;
        row.InputJson = JsonSerializer.Serialize(snippets, SerializerOptions);
        row.UpdatedAtUtc = now;

        // No candidate survived the keyword filters: a valid, free "nothing here" verdict.
        if (snippets.Count == 0)
        {
            Apply(row, AiCallOutcome.Success([]));
        }
        else
        {
            row.AttemptCount += 1;
            Apply(row, await ClassifyInBatchesAsync(metricId, snippets, cancellationToken));
        }

        if (db.Entry(row).State == EntityState.Detached)
        {
            db.AiMetricResults.Add(row);
        }

        await db.SaveChangesAsync(cancellationToken);
        return ToDto(row);
    }

    private async Task<AiCallOutcome> ClassifyInBatchesAsync(
        string metricId,
        IReadOnlyList<AiSnippetInput> snippets,
        CancellationToken cancellationToken)
    {
        var instruction = AiMetricPrompts.SystemInstruction(metricId);
        var batchSize = Math.Max(1, _options.BatchSize);
        var accepted = new List<string>();

        for (var offset = 0; offset < snippets.Count; offset += batchSize)
        {
            var batch = snippets.Skip(offset).Take(batchSize).ToList();
            var (batchAccepted, failure) = await ClassifyBatchAsync(instruction, batch, cancellationToken);

            // One bad batch fails the whole metric on purpose: keeping a partial answer
            // would silently undercount the metric with no way for the user to tell.
            if (failure is not null)
            {
                return failure;
            }

            accepted.AddRange(batchAccepted);
        }

        return AiCallOutcome.Success(accepted);
    }

    /// <summary>
    /// Classifies one batch, splitting and retrying on <see cref="AiErrorCode.Blocked"/>.
    /// Verified empirically (2026-08-03) against a real chat: a batch of 40 messages can
    /// trip Gemini's non-adjustable content-safety floor — <c>promptFeedback.blockReason:
    /// "PROHIBITED_CONTENT"</c> — even with every <c>safetySettings</c> category set to
    /// <c>BLOCK_NONE</c>, apparently from the sheer density of genuinely explicit messages
    /// landing in the same call (exactly the content "tonopicante" exists to find). Halving
    /// and retrying resolved it that time — but verified again empirically (2026-08-18)
    /// against a different real chat: a single message, sent completely alone, can still
    /// trip the same floor. There is no smaller batch to fall back to at that point, so
    /// (see the base case below) it is excluded from the metric instead of failing every
    /// other candidate that already classified fine.
    /// Quota/unavailable/config/invalid failures are not retried here: a smaller batch
    /// wouldn't fix an exhausted quota or a bad key, only waste calls before failing anyway.
    /// </summary>
    private async Task<(List<string> Accepted, AiCallOutcome? Failure)> ClassifyBatchAsync(
        string instruction,
        IReadOnlyList<AiSnippetInput> batch,
        CancellationToken cancellationToken)
    {
        var outcome = await client.ClassifyAsync(instruction, AiMetricPrompts.RenderBatch(batch), cancellationToken);

        if (outcome.IsSuccess)
        {
            // The model can only ever confirm ids we actually sent — a hallucinated id
            // must not slip into the result.
            var batchIds = batch.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
            return (outcome.AcceptedIds.Where(batchIds.Contains).ToList(), null);
        }

        if (outcome.ErrorCode == AiErrorCode.Blocked && batch.Count <= 1)
        {
            // A lone message that Gemini's safety floor still refuses to even look at.
            // "Ante la duda, excluí" (see AiMetricPrompts) already governs every borderline
            // verdict the model does return — an input it can't answer at all is the most
            // uncertain case there is, so it gets the same treatment: left out, not counted
            // as a hit, and — critically — not allowed to sink every other candidate in this
            // metric that Gemini did manage to classify.
            logger.LogInformation(
                "Gemini's safety floor would not classify message {Id} even alone; excluding it from the metric.",
                batch[0].Id);
            return ([], null);
        }

        if (outcome.ErrorCode != AiErrorCode.Blocked)
        {
            return ([], outcome);
        }

        var half = batch.Count / 2;
        var (firstAccepted, firstFailure) = await ClassifyBatchAsync(instruction, batch.Take(half).ToList(), cancellationToken);
        if (firstFailure is not null)
        {
            return ([], firstFailure);
        }

        var (secondAccepted, secondFailure) = await ClassifyBatchAsync(instruction, batch.Skip(half).ToList(), cancellationToken);
        if (secondFailure is not null)
        {
            return ([], secondFailure);
        }

        firstAccepted.AddRange(secondAccepted);
        return (firstAccepted, null);
    }

    private void Apply(AiMetricResult row, AiCallOutcome outcome)
    {
        if (outcome.IsSuccess)
        {
            row.Status = AiMetricStatus.Ready;
            row.ResultJson = JsonSerializer.Serialize(outcome.AcceptedIds, SerializerOptions);
            row.ErrorCode = null;
            row.RetryAvailableAtUtc = null;
            return;
        }

        row.Status = AiMetricStatus.Failed;
        row.ResultJson = null;
        row.ErrorCode = outcome.ErrorCode;
        // Persisted rather than kept in memory so the countdown survives a refresh and
        // is the same on every device the user opens.
        row.RetryAvailableAtUtc = DateTime.UtcNow.AddSeconds(_options.RetryCooldownSeconds);
    }

    private IReadOnlyList<AiSnippetInput> Sanitize(IEnumerable<AiSnippetInput>? snippets)
    {
        if (snippets is null)
        {
            return [];
        }

        return snippets
            .Where(item => !string.IsNullOrWhiteSpace(item.Id) && !string.IsNullOrWhiteSpace(item.Text))
            .Take(Math.Max(1, _options.MaxSnippetsPerMetric))
            .Select(item => new AiSnippetInput(
                item.Id.Trim(),
                (item.Keyword ?? string.Empty).Trim(),
                Clamp(item.Text.Trim(), MaxSnippetChars)))
            .ToList();
    }

    private static string Clamp(string value, int max) => value.Length <= max ? value : value[..max];

    private static IReadOnlyList<AiSnippetInput> DeserializeSnippets(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<AiSnippetInput>>(json, SerializerOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>
    /// Fingerprints the exact payload behind a verdict. If the keyword dictionaries or
    /// the context-window rules change in code, the snippets change, this hash changes,
    /// and the stale verdict is recomputed instead of being reused forever.
    /// </summary>
    private static string ComputeInputHash(IReadOnlyList<AiSnippetInput> snippets)
    {
        var canonical = string.Join(
            FieldSeparator,
            snippets.Select(item => $"{item.Id}{FieldSeparator}{item.Keyword}{FieldSeparator}{item.Text}"));

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static AiMetricStateDto ToDto(AiMetricResult row) => new(
        row.MetricId,
        row.Status,
        row.ResultJson is null
            ? []
            : JsonSerializer.Deserialize<List<string>>(row.ResultJson, SerializerOptions) ?? [],
        row.ErrorCode,
        AsUtc(row.RetryAvailableAtUtc),
        AsUtc(row.UpdatedAtUtc) ?? row.UpdatedAtUtc);

    /// <summary>
    /// SQLite stores dates as text and EF reads them back with <c>DateTimeKind.Unspecified</c>,
    /// which System.Text.Json then writes without a trailing "Z". The browser would read
    /// that as local time and the retry countdown would be off by the timezone offset —
    /// on the exact path (a page refresh) where the countdown matters most.
    /// </summary>
    private static DateTime? AsUtc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
}
