using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Thrown when an account has already had its day's worth of chats analysed. Surfaced to
/// the caller as a 429 rather than swallowed: silently returning empty results would look
/// like the AI failed, and send the user to the retry button in a loop.
/// </summary>
public sealed class AiDailyLimitReachedException(string message) : Exception(message);

/// <summary>One already-filtered fragment of chat, as the browser built it.</summary>
public sealed record AiSnippetInput(string Id, string Keyword, string Text);

public sealed record AiMetricRequestItem(string MetricId, List<AiSnippetInput> Snippets);

/// <param name="RejectedIds">
/// Candidates Gemini actually looked at and explicitly said no to — distinct from one
/// that was blocked or never sent at all (see <see cref="AiMetricService.ClassifyBatchAsync"/>).
/// Only this bucket is specific enough evidence to discount a hit's weight in a score;
/// the frontend's "redflags" metric is the first to use it that way.
/// </param>
public sealed record AiMetricStateDto(
    string MetricId,
    string Status,
    IReadOnlyList<string> AcceptedIds,
    IReadOnlyList<string> RejectedIds,
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
    /// Most metrics one request may ask for. There are only a handful of AI metrics in the
    /// product; a longer list is not a real client, and every entry is its own run of
    /// Gemini batches.
    /// </summary>
    public const int MaxMetricsPerRequest = 12;

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
    /// <param name="participants">
    /// How many people the chat has, when the browser says. Two is a pair — a couple, or close to
    /// one — and changes how strict the red-flags prompts are; anything else, or nothing, is a group.
    /// </param>
    public async Task<List<AiMetricStateDto>> AnalyzeAsync(
        Guid userId,
        string sourceHash,
        IReadOnlyList<AiMetricRequestItem> requests,
        CancellationToken cancellationToken,
        int? participants = null)
    {
        await EnsureDailyChatBudgetAsync(userId, sourceHash, cancellationToken);

        var bond = AiMetricPrompts.BondFor(participants);
        var results = new List<AiMetricStateDto>();

        foreach (var request in requests.Take(MaxMetricsPerRequest))
        {
            if (!AiMetricPrompts.IsSupported(request.MetricId))
            {
                logger.LogWarning("Ignoring unsupported AI metric id {MetricId}.", request.MetricId);
                continue;
            }

            results.Add(AiMetricPrompts.IsScan(request.MetricId)
                ? await ResolveScanAsync(userId, sourceHash, request.MetricId, SanitizeScan(request.Snippets), bond, cancellationToken)
                : await ResolveAsync(userId, sourceHash, request.MetricId, Sanitize(request.Snippets), bond, cancellationToken));
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
            // A scan keeps no copy of what it read — it is a stretch of someone's conversation, and
            // the browser still has it — so there is nothing to re-run here. It is retried the same
            // way it was first run: by the browser sending it again.
            if (AiMetricPrompts.IsScan(row.MetricId))
            {
                results.Add(ToDto(row));
                continue;
            }

            var snippets = DeserializeSnippets(row.InputJson);
            results.Add(await ResolveAsync(userId, sourceHash, row.MetricId, snippets, ChatBond.Group, cancellationToken));
        }

        return results;
    }

    /// <summary>
    /// The hard ceiling on what one account can cost in a day. The rule itself lives in
    /// <see cref="AiDailyBudget"/>, shared with the personality profiles so both draw from
    /// the same allowance.
    /// </summary>
    private Task EnsureDailyChatBudgetAsync(Guid userId, string sourceHash, CancellationToken cancellationToken) =>
        AiDailyBudget.EnsureAsync(db, _options, logger, userId, sourceHash, cancellationToken);

    private async Task<AiMetricStateDto> ResolveAsync(
        Guid userId,
        string sourceHash,
        string metricId,
        IReadOnlyList<AiSnippetInput> snippets,
        ChatBond bond,
        CancellationToken cancellationToken)
    {
        var inputHash = ComputeInputHash(metricId, snippets, bond);
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
            Apply(row, ClassificationOutcome.Success([], []));
        }
        else
        {
            row.AttemptCount += 1;
            Apply(row, await ClassifyInBatchesAsync(metricId, snippets, bond, cancellationToken));
        }

        if (db.Entry(row).State == EntityState.Detached)
        {
            db.AiMetricResults.Add(row);
        }

        await db.SaveChangesAsync(cancellationToken);
        await SaveUsageAsync(userId, metricId, cancellationToken);
        return ToDto(row);
    }

    /// <summary>What each Gemini call of the metric being resolved cost; see <see cref="TrackUsage"/>.</summary>
    private readonly List<AiUsage> _pendingUsage = [];

    private void TrackUsage(string metricId, AiCallOutcome outcome)
    {
        if (outcome.InputTokens is null && outcome.OutputTokens is null)
        {
            return;
        }

        _pendingUsage.Add(new AiUsage
        {
            MetricId = metricId,
            InputTokens = outcome.InputTokens ?? 0,
            OutputTokens = outcome.OutputTokens ?? 0,
            Succeeded = outcome.IsSuccess,
        });
    }

    /// <summary>
    /// Saved after the verdict and on its own, on purpose: what a call cost is bookkeeping,
    /// and failing to write it must never cost the user the verdict those tokens paid for.
    /// </summary>
    private async Task SaveUsageAsync(Guid userId, string metricId, CancellationToken cancellationToken)
    {
        var entries = _pendingUsage.Where(item => item.MetricId == metricId).ToList();
        if (entries.Count == 0)
        {
            return;
        }

        _pendingUsage.RemoveAll(item => item.MetricId == metricId);

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
            logger.LogWarning(exception, "Could not record AI token usage for {MetricId}; the verdict itself was saved.", metricId);

            // Left tracked, the failed rows would ride along with the next metric's save and
            // take that verdict down with them.
            foreach (var entry in entries)
            {
                db.Entry(entry).State = EntityState.Detached;
            }
        }
    }

    private async Task<ClassificationOutcome> ClassifyInBatchesAsync(
        string metricId,
        IReadOnlyList<AiSnippetInput> snippets,
        ChatBond bond,
        CancellationToken cancellationToken)
    {
        var instruction = AiMetricPrompts.SystemInstruction(metricId, bond);
        var batchSize = Math.Max(1, _options.BatchSize);
        var accepted = new List<string>();
        var rejected = new List<string>();

        // Only tonopicante's candidates carry the raw anatomical/crude vocabulary that
        // trips Gemini's safety floor — softened fresh on every call, never persisted,
        // so the stored input hash still reflects exactly what the browser sent.
        var preparedSnippets = metricId == AiMetricPrompts.TonoPicante
            ? snippets.Select(TonoPicanteVocabulary.Soften).ToList()
            : snippets;

        for (var offset = 0; offset < preparedSnippets.Count; offset += batchSize)
        {
            var batch = preparedSnippets.Skip(offset).Take(batchSize).ToList();
            var (batchAccepted, batchRejected, failure) = await ClassifyBatchAsync(metricId, instruction, batch, cancellationToken);

            // One bad batch fails the whole metric on purpose: keeping a partial answer
            // would silently undercount the metric with no way for the user to tell.
            if (failure is not null)
            {
                return ClassificationOutcome.Failure(failure.ErrorCode!);
            }

            accepted.AddRange(batchAccepted);
            rejected.AddRange(batchRejected);
        }

        return ClassificationOutcome.Success(accepted, rejected);
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
    /// the base case below decides per metric what a message Gemini refuses to even look
    /// at should count as.
    /// Quota/unavailable/config/invalid failures are not retried here: a smaller batch
    /// wouldn't fix an exhausted quota or a bad key, only waste calls before failing anyway.
    /// </summary>
    private async Task<(List<string> Accepted, List<string> Rejected, AiCallOutcome? Failure)> ClassifyBatchAsync(
        string metricId,
        string instruction,
        IReadOnlyList<AiSnippetInput> batch,
        CancellationToken cancellationToken)
    {
        var outcome = await client.ClassifyAsync(instruction, AiMetricPrompts.RenderBatch(batch), cancellationToken);
        TrackUsage(metricId, outcome);

        if (outcome.IsSuccess)
        {
            // The model can only ever confirm ids we actually sent — a hallucinated id
            // must not slip into the result.
            var batchIds = batch.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
            var accepted = outcome.AcceptedIds.Where(batchIds.Contains).ToList();
            // Everything Gemini actually looked at but chose not to include is an
            // explicit "no" — the only verdict specific enough to discount a keyword
            // hit's weight in a score (see metricRedflags' reweighting on the frontend).
            var rejected = batchIds.Except(accepted).ToList();
            return (accepted, rejected, null);
        }

        if (outcome.ErrorCode == AiErrorCode.Blocked && batch.Count <= 1)
        {
            var id = batch[0].Id;

            if (metricId == AiMetricPrompts.TonoPicante)
            {
                // This candidate already passed the keyword filter, and Gemini's safety
                // floor still refuses to even look at it alone — with every configurable
                // safetySettings category at BLOCK_NONE, that refusal is itself stronger
                // evidence of real +18 content than any verdict the model could return.
                // Counting it beats excluding it: excluding would silently undercount
                // exactly the spiciest messages in the chat, the ones this metric exists
                // to find.
                logger.LogInformation(
                    "Gemini's safety floor would not classify message {Id} even alone; counting it as a hit for {MetricId} instead of excluding it.",
                    id,
                    metricId);
                return ([id], [], null);
            }

            // For redflags the same refusal is much weaker evidence — it can just as
            // easily be a threat or hate-speech floor tripping on something unrelated to
            // a directed conflict — so "ante la duda, excluí" (see AiMetricPrompts) still
            // applies for the shown examples: left out, not counted. It is NOT the same
            // as an explicit rejection, though — a block is Gemini saying "I don't know",
            // not "no" — so unlike a real rejection it must not end up in `Rejected`
            // either: it stays neutral, keeping its plain dictionary weight in the score.
            logger.LogInformation(
                "Gemini's safety floor would not classify message {Id} even alone; excluding it from {MetricId}.",
                id,
                metricId);
            return ([], [], null);
        }

        if (outcome.ErrorCode != AiErrorCode.Blocked)
        {
            return ([], [], outcome);
        }

        var half = batch.Count / 2;
        var (firstAccepted, firstRejected, firstFailure) =
            await ClassifyBatchAsync(metricId, instruction, batch.Take(half).ToList(), cancellationToken);
        if (firstFailure is not null)
        {
            return ([], [], firstFailure);
        }

        var (secondAccepted, secondRejected, secondFailure) =
            await ClassifyBatchAsync(metricId, instruction, batch.Skip(half).ToList(), cancellationToken);
        if (secondFailure is not null)
        {
            return ([], [], secondFailure);
        }

        firstAccepted.AddRange(secondAccepted);
        firstRejected.AddRange(secondRejected);
        return (firstAccepted, firstRejected, null);
    }

    /// <summary>
    /// The scan: instead of judging the keyword hits, Gemini reads a stretch of the chat itself and
    /// names the messages that are red flags, each with a category. It is how a threat nobody
    /// listed in a dictionary, or a manipulation with no insult in it, gets found. Same rule as
    /// every other metric — a part is judged once, ever — with one difference: the browser's
    /// sample is not stored. It is a long stretch of someone's conversation, and what is kept is
    /// what the model answered and a fingerprint of what it was asked.
    /// </summary>
    private async Task<AiMetricStateDto> ResolveScanAsync(
        Guid userId,
        string sourceHash,
        string metricId,
        IReadOnlyList<ScanBlock> blocks,
        ChatBond bond,
        CancellationToken cancellationToken)
    {
        var inputHash = ComputeScanInputHash(metricId, blocks, bond);
        var now = DateTime.UtcNow;

        var row = await db.AiMetricResults.FirstOrDefaultAsync(
            item => item.UserId == userId && item.SourceHash == sourceHash && item.MetricId == metricId,
            cancellationToken);

        if (row is { Status: AiMetricStatus.Ready } && row.InputHash == inputHash)
        {
            return ToDto(row);
        }

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
        row.InputJson = string.Empty;
        row.UpdatedAtUtc = now;

        if (blocks.Count == 0)
        {
            Apply(row, ClassificationOutcome.Success([], []));
        }
        else
        {
            row.AttemptCount += 1;
            Apply(row, await ScanInBatchesAsync(metricId, blocks, bond, cancellationToken));
        }

        if (db.Entry(row).State == EntityState.Detached)
        {
            db.AiMetricResults.Add(row);
        }

        await db.SaveChangesAsync(cancellationToken);
        await SaveUsageAsync(userId, metricId, cancellationToken);
        return ToDto(row);
    }

    /// <summary>
    /// The numbered lines the browser sent, checked. A line is a number, a space and the rest; one
    /// that is not is dropped, a number seen twice is dropped, a long line is cut, and the whole
    /// part is held to <see cref="GoogleAiOptions.MaxScanLinesPerPart"/> — a client cannot make us
    /// pay for a novel, and a model cannot be asked about a line it was never shown.
    /// </summary>
    private IReadOnlyList<ScanBlock> SanitizeScan(IEnumerable<AiSnippetInput>? chunks)
    {
        var blocks = new List<ScanBlock>();

        if (chunks is null)
        {
            return blocks;
        }

        var budget = Math.Max(1, _options.MaxScanLinesPerPart);
        var chunkLimit = Math.Max(1, _options.MaxScanChunkLines);
        var lineChars = Math.Max(20, _options.MaxScanLineChars);
        var seen = new HashSet<int>();

        foreach (var chunk in chunks)
        {
            if (budget <= 0)
            {
                break;
            }

            var lines = new List<ScanLine>();

            foreach (var raw in (chunk.Text ?? string.Empty).Split('\n'))
            {
                if (lines.Count >= chunkLimit || lines.Count >= budget)
                {
                    break;
                }

                var line = raw.Trim();
                var space = line.IndexOf(' ');

                if (space <= 0
                    || !int.TryParse(line.AsSpan(0, space), out var number)
                    || number <= 0
                    || !seen.Add(number))
                {
                    continue;
                }

                lines.Add(new ScanLine(number, Clamp(line, lineChars)));
            }

            budget -= lines.Count;

            if (lines.Count > 0)
            {
                blocks.Add(new ScanBlock(lines));
            }
        }

        return blocks;
    }

    private async Task<ClassificationOutcome> ScanInBatchesAsync(
        string metricId,
        IReadOnlyList<ScanBlock> blocks,
        ChatBond bond,
        CancellationToken cancellationToken)
    {
        var instruction = AiMetricPrompts.SystemInstruction(metricId, bond);
        var perCall = Math.Max(1, _options.ScanLinesPerCall);

        // Whole blocks travel together up to the line limit of one call; a block is never cut
        // between two calls, so what the model reads as one stretch of conversation stays one.
        var batches = new List<List<IReadOnlyList<ScanLine>>>();
        var current = new List<IReadOnlyList<ScanLine>>();
        var currentLines = 0;

        foreach (var block in blocks)
        {
            if (currentLines > 0 && currentLines + block.Lines.Count > perCall)
            {
                batches.Add(current);
                current = [];
                currentLines = 0;
            }

            current.Add(block.Lines);
            currentLines += block.Lines.Count;
        }

        if (current.Count > 0)
        {
            batches.Add(current);
        }

        // The calls are independent, so a few run at once: a part is several of them, and one
        // after another they would outlast what a request may take. The bound keeps a part from
        // bursting past the model's per-minute quota in one go.
        using var gate = new SemaphoreSlim(Math.Max(1, _options.ScanConcurrency));

        var outcomes = await Task.WhenAll(batches.Select(async batch =>
        {
            await gate.WaitAsync(cancellationToken);

            try
            {
                return await ScanAsync(instruction, batch, cancellationToken);
            }
            finally
            {
                gate.Release();
            }
        }));

        // What every call cost is recorded first, failed ones included: the tokens were spent.
        foreach (var outcome in outcomes)
        {
            foreach (var call in outcome.Calls)
            {
                TrackUsage(metricId, call);
            }
        }

        // One bad call fails the whole part on purpose: keeping a partial answer would silently
        // undercount the chat with no way for the user to tell.
        var failure = outcomes.FirstOrDefault(outcome => outcome.Failure is not null)?.Failure;

        return failure is not null
            ? ClassificationOutcome.Failure(failure)
            : ClassificationOutcome.Success(outcomes.SelectMany(outcome => outcome.Findings).ToList(), []);
    }

    /// <summary>
    /// One Gemini call over some lines, splitting and retrying on <see cref="AiErrorCode.Blocked"/>
    /// the way <see cref="ClassifyBatchAsync"/> does: a stretch dense with hostile or explicit
    /// messages can trip the safety floor, and halving it finds the lines that are fine. A single
    /// line the model refuses even alone is left out, which is neutral: not a finding, not an error.
    /// </summary>
    private async Task<ScanCallResult> ScanAsync(
        string instruction,
        IReadOnlyList<IReadOnlyList<ScanLine>> groups,
        CancellationToken cancellationToken)
    {
        var rendered = string.Join("\n\n", groups.Select(group => string.Join('\n', group.Select(line => line.Text))));
        var outcome = await client.ClassifyAsync(instruction, rendered, cancellationToken);
        var calls = new List<AiCallOutcome> { outcome };

        if (outcome.IsSuccess)
        {
            var shown = groups.SelectMany(group => group).Select(line => line.Number).ToHashSet();
            return new ScanCallResult(ValidFindings(outcome.AcceptedIds, shown), null, calls);
        }

        if (outcome.ErrorCode != AiErrorCode.Blocked)
        {
            return new ScanCallResult([], outcome.ErrorCode, calls);
        }

        var lines = groups.SelectMany(group => group).ToList();

        if (lines.Count <= 1)
        {
            logger.LogInformation("Gemini's safety floor would not read a single scanned line even alone; leaving it out.");
            return new ScanCallResult([], null, calls);
        }

        var half = lines.Count / 2;
        var first = await ScanAsync(instruction, [lines.Take(half).ToList()], cancellationToken);
        var second = await ScanAsync(instruction, [lines.Skip(half).ToList()], cancellationToken);
        calls.AddRange(first.Calls);
        calls.AddRange(second.Calls);

        var failure = first.Failure ?? second.Failure;

        return failure is not null
            ? new ScanCallResult([], failure, calls)
            : new ScanCallResult([.. first.Findings, .. second.Findings], null, calls);
    }

    /// <summary>
    /// What the model answered, kept only if it can be trusted: <c>line:code</c> with a line it was
    /// actually shown and a code from the list. One finding per line, the first one wins. A
    /// hallucinated line or a made-up category must not slip into the result.
    /// </summary>
    private static List<string> ValidFindings(IEnumerable<string> ids, IReadOnlySet<int> shown)
    {
        var seen = new HashSet<int>();
        var findings = new List<string>();

        foreach (var id in ids)
        {
            var parts = id.Split(':');

            if (parts.Length != 2
                || !int.TryParse(parts[0].Trim(), out var line)
                || !shown.Contains(line))
            {
                continue;
            }

            var code = parts[1].Trim().ToLowerInvariant();

            if (AiMetricPrompts.ScanCodes.Contains(code) && seen.Add(line))
            {
                findings.Add($"{line}:{code}");
            }
        }

        return findings;
    }

    /// <summary>The scan's version of <see cref="ComputeInputHash"/>: the lines AND the prompt they were read against.</summary>
    private static string ComputeScanInputHash(string metricId, IReadOnlyList<ScanBlock> blocks, ChatBond bond)
    {
        var canonical = string.Join(
            FieldSeparator,
            blocks.Select(block => string.Join('\n', block.Lines.Select(line => line.Text))));
        canonical = $"{AiMetricPrompts.SystemInstruction(metricId, bond)}{FieldSeparator}{canonical}";

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private void Apply(AiMetricResult row, ClassificationOutcome outcome)
    {
        if (outcome.IsSuccess)
        {
            row.Status = AiMetricStatus.Ready;
            row.ResultJson = JsonSerializer.Serialize(
                new StoredVerdict(outcome.AcceptedIds.ToList(), outcome.RejectedIds.ToList()),
                SerializerOptions);
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
    /// Fingerprints the exact payload behind a verdict — the snippets AND the prompt
    /// they were judged against. If the keyword dictionaries or the context-window
    /// rules change in code, the snippets change and this hash changes with them. The
    /// prompt is folded in for the same reason: a chat analysed before a wording fix
    /// to <see cref="AiMetricPrompts.SystemInstruction"/> (verified 2026-09-02 — Gemini
    /// flagged a self-critical "qué tonto haberme quedado triste" as an insult under
    /// the old wording) must not go on showing that stale verdict forever just because
    /// its snippets never changed. Either way, the stale verdict gets recomputed
    /// instead of reused — this is the one hash covering both triggers.
    /// </summary>
    private static string ComputeInputHash(string metricId, IReadOnlyList<AiSnippetInput> snippets, ChatBond bond)
    {
        var canonical = string.Join(
            FieldSeparator,
            snippets.Select(item => $"{item.Id}{FieldSeparator}{item.Keyword}{FieldSeparator}{item.Text}"));
        canonical = $"{AiMetricPrompts.SystemInstruction(metricId, bond)}{FieldSeparator}{canonical}";

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static AiMetricStateDto ToDto(AiMetricResult row)
    {
        var (accepted, rejected) = DeserializeVerdict(row.ResultJson);
        return new(
            row.MetricId,
            row.Status,
            accepted,
            rejected,
            row.ErrorCode,
            AsUtc(row.RetryAvailableAtUtc),
            AsUtc(row.UpdatedAtUtc) ?? row.UpdatedAtUtc);
    }

    /// <summary>
    /// A row written before <see cref="StoredVerdict"/> existed holds a bare JSON array
    /// of accepted ids instead of the <c>{Accepted, Rejected}</c> shape — reading that
    /// old shape as "accepted, nothing rejected" costs nothing and needs no DB
    /// migration, since `ResultJson` is just a text column either way.
    /// </summary>
    private static (IReadOnlyList<string> Accepted, IReadOnlyList<string> Rejected) DeserializeVerdict(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return ([], []);
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Array)
            {
                return (JsonSerializer.Deserialize<List<string>>(json, SerializerOptions) ?? [], []);
            }

            var stored = JsonSerializer.Deserialize<StoredVerdict>(json, SerializerOptions);
            return (stored?.Accepted ?? [], stored?.Rejected ?? []);
        }
        catch (JsonException)
        {
            return ([], []);
        }
    }

    /// <summary>
    /// SQLite stores dates as text and EF reads them back with <c>DateTimeKind.Unspecified</c>,
    /// which System.Text.Json then writes without a trailing "Z". The browser would read
    /// that as local time and the retry countdown would be off by the timezone offset —
    /// on the exact path (a page refresh) where the countdown matters most.
    /// </summary>
    private static DateTime? AsUtc(DateTime? value) =>
        value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);
}

/// <summary>One numbered line of a scanned chat, as the browser sent it: "412 B: te dije que no".</summary>
internal sealed record ScanLine(int Number, string Text);

/// <summary>A run of scanned lines that belong to the same stretch of conversation.</summary>
internal sealed record ScanBlock(IReadOnlyList<ScanLine> Lines);

/// <summary>What one scan call, and every call it split into, found and cost.</summary>
internal sealed record ScanCallResult(IReadOnlyList<string> Findings, string? Failure, List<AiCallOutcome> Calls);

/// <summary>The shape `AiMetricResult.ResultJson` is stored as. See `AiMetricService.DeserializeVerdict`
/// for how an older, pre-`Rejected` row (a bare JSON array) still reads back correctly.</summary>
internal sealed record StoredVerdict(List<string> Accepted, List<string> Rejected);

/// <summary>
/// The result of judging one whole metric's worth of candidates — as opposed to
/// <see cref="AiCallOutcome"/>, which is just one raw Gemini HTTP call. Kept separate
/// because only this layer knows the full candidate set a batch was drawn from, which
/// is what turns "not accepted" into a meaningful "explicitly rejected".
/// </summary>
internal sealed record ClassificationOutcome(
    bool IsSuccess,
    IReadOnlyList<string> AcceptedIds,
    IReadOnlyList<string> RejectedIds,
    string? ErrorCode)
{
    public static ClassificationOutcome Success(IReadOnlyList<string> accepted, IReadOnlyList<string> rejected) =>
        new(true, accepted, rejected, null);

    public static ClassificationOutcome Failure(string errorCode) => new(false, [], [], errorCode);
}
