using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using backend.Models;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// The only thing in the system that knows the Google AI Studio API key. It lives
/// server-side so the credential is never shipped to the browser and nobody can
/// spend our quota by copying it out of a network tab.
/// </summary>
public sealed class GoogleAiClient(
    HttpClient httpClient,
    IOptions<GoogleAiOptions> options,
    ILogger<GoogleAiClient> logger)
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web)
    {
        // An explicit "thinkingConfig": null is rejected by the API, so omit instead.
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly GoogleAiOptions _options = options.Value;

    /// <summary>
    /// Asks the model to keep the ids that genuinely match the metric's criterion.
    /// Returns the accepted ids, or an <see cref="AiErrorCode"/> — never throws for
    /// an expected failure (quota, timeout, refusal), because a failed AI metric must
    /// degrade into a retry button, not into a broken page.
    /// </summary>
    public async Task<AiCallOutcome> ClassifyAsync(
        string systemInstruction,
        string userContent,
        CancellationToken cancellationToken)
    {
        var payload = new
        {
            systemInstruction = new { parts = new[] { new { text = systemInstruction } } },
            contents = new[] { new { role = "user", parts = new[] { new { text = userContent } } } },
            generationConfig = new
            {
                temperature = 0,
                responseMimeType = "application/json",
                // Structured output: the model can only answer with the id list, which
                // removes prose, apologies and markdown fences from the reply — cheaper
                // in output tokens and immune to "sure, here's the JSON:" prefixes.
                responseSchema = new
                {
                    type = "OBJECT",
                    properties = new
                    {
                        ids = new { type = "ARRAY", items = new { type = "STRING" } },
                    },
                    required = new[] { "ids" },
                },
                // Reasoning tokens are billed like output tokens and buy nothing on a
                // yes/no classification. -1 omits the field for models that reject it.
                thinkingConfig = _options.ThinkingBudget >= 0
                    ? (object?)new { thinkingBudget = _options.ThinkingBudget }
                    : null,
            },
            // This job is *about* judging suggestive or hostile language, so the default
            // filters would refuse exactly the inputs we need classified.
            safetySettings = new[]
            {
                new { category = "HARM_CATEGORY_HARASSMENT", threshold = "BLOCK_NONE" },
                new { category = "HARM_CATEGORY_HATE_SPEECH", threshold = "BLOCK_NONE" },
                new { category = "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold = "BLOCK_NONE" },
                new { category = "HARM_CATEGORY_DANGEROUS_CONTENT", threshold = "BLOCK_NONE" },
            },
        };

        var call = await SendAsync(payload, cancellationToken);

        return call.Failure is not null
            ? AiCallOutcome.Failure(call.Failure)
            : WithUsage(ParseAcceptedIds(call.Body!), call.Body!);
    }

    /// <summary>
    /// Asks the model to write one person's personality profile: a label from the closed
    /// list and a short summary of why. Same contract as <see cref="ClassifyAsync"/> — an
    /// expected failure comes back as an <see cref="AiErrorCode"/>, never as an exception.
    /// </summary>
    public async Task<AiProfileCallOutcome> GenerateProfileAsync(
        string systemInstruction,
        string userContent,
        CancellationToken cancellationToken)
    {
        var payload = new
        {
            systemInstruction = new { parts = new[] { new { text = systemInstruction } } },
            contents = new[] { new { role = "user", parts = new[] { new { text = userContent } } } },
            generationConfig = new
            {
                temperature = _options.ProfileTemperature,
                responseMimeType = "application/json",
                // The label is a free STRING here and is checked against the closed list on
                // our side. An `enum` in the schema would be tidier, but a schema the model
                // rejects fails as a 400 — which this client reads as a server
                // misconfiguration — and the list is validated afterwards either way.
                responseSchema = new
                {
                    type = "OBJECT",
                    properties = new
                    {
                        label = new { type = "STRING" },
                        secondary = new { type = "STRING" },
                        summary = new { type = "STRING" },
                    },
                    required = new[] { "label", "summary" },
                },
                thinkingConfig = _options.ThinkingBudget >= 0
                    ? (object?)new { thinkingBudget = _options.ThinkingBudget }
                    : null,
            },
            // Not BLOCK_NONE, unlike the classification calls. There the model only reads
            // hostile or suggestive text and answers with ids; here it *writes* about named
            // people, and the audience includes minors. The thresholds sit one step short of
            // the strictest so ordinary teenage chat — swearing, teasing — still goes through.
            safetySettings = new[]
            {
                new { category = "HARM_CATEGORY_HARASSMENT", threshold = "BLOCK_ONLY_HIGH" },
                new { category = "HARM_CATEGORY_HATE_SPEECH", threshold = "BLOCK_ONLY_HIGH" },
                new { category = "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold = "BLOCK_MEDIUM_AND_ABOVE" },
                new { category = "HARM_CATEGORY_DANGEROUS_CONTENT", threshold = "BLOCK_ONLY_HIGH" },
            },
        };

        var call = await SendAsync(payload, cancellationToken);

        return call.Failure is not null
            ? AiProfileCallOutcome.Failure(call.Failure)
            : WithProfileUsage(ParseProfile(call.Body!), call.Body!);
    }

    /// <summary>One Gemini round trip: the raw body on success, or the failure code — never both.</summary>
    private sealed record GeminiCall(string? Body, string? Failure);

    /// <summary>
    /// Posts a <c>generateContent</c> payload, riding out the transient failures. Shared by
    /// every kind of call so the quota and "high demand" handling lives in one place.
    /// </summary>
    private async Task<GeminiCall> SendAsync(object payload, CancellationToken cancellationToken)
    {
        if (!_options.IsConfigured)
        {
            logger.LogWarning("GoogleAi:ApiKey is not set — refusing to call Gemini.");
            return new GeminiCall(null, AiErrorCode.Config);
        }

        var url = $"{_options.Endpoint.TrimEnd('/')}/models/{_options.Model}:generateContent";
        var requestBody = JsonSerializer.Serialize(payload, SerializerOptions);

        // A free-tier key's per-minute request cap (15 RPM as of this writing, for
        // gemini-3.1-flash-lite) is realistic to brush up against within a single
        // analysis: one metric alone can take several batch calls, and a batch that
        // trips the content-safety floor (see ClassifyBatchAsync's splitting) adds more.
        // One bounded, backed-off retry turns that into an invisible pause instead of
        // surfacing an error for something that resolves itself a few seconds later —
        // without touching the outer 2-minute manual-retry cooldown, which still owns
        // every failure this doesn't recover from.
        var quotaAttempt = 0;

        // Verified empirically (2026-08-18) against the real API: gemini-3.1-flash-lite's
        // latency on a healthy 200 response can already run 15-23s, and it occasionally
        // answers with a flat 503 "high demand" a few seconds later on an identical retry.
        // A chat with a lot of keyword hits needs several of these calls in a row (up to 8
        // per metric, 16 when tonopicante and redflags run together), so without a retry
        // here a single slow/overloaded call was enough to fail the whole metric even
        // though every other batch classified fine. One bounded retry — same shape as the
        // quota one above — absorbs that without ever entering the outer cooldown.
        var unavailableAttempt = 0;

        while (true)
        {
            HttpResponseMessage response;
            string body;

            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(requestBody, Encoding.UTF8),
            };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            // Header instead of ?key= so the credential never lands in a URL, proxy log
            // or exception message.
            request.Headers.Add("x-goog-api-key", _options.ApiKey);

            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

                response = await httpClient.SendAsync(request, timeout.Token);
                body = await response.Content.ReadAsStringAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                if (unavailableAttempt < MaxUnavailableRetries)
                {
                    unavailableAttempt += 1;
                    logger.LogInformation(
                        "Gemini call timed out after {Seconds}s (retry {Attempt}); trying once more.",
                        _options.TimeoutSeconds,
                        unavailableAttempt);
                    await Task.Delay(UnavailableRetryDelay, cancellationToken);
                    continue;
                }

                logger.LogWarning("Gemini call timed out after {Seconds}s.", _options.TimeoutSeconds);
                return new GeminiCall(null, AiErrorCode.Unavailable);
            }
            catch (HttpRequestException exception)
            {
                if (unavailableAttempt < MaxUnavailableRetries)
                {
                    unavailableAttempt += 1;
                    logger.LogInformation(
                        exception,
                        "Gemini call failed at the transport level (retry {Attempt}); trying once more.",
                        unavailableAttempt);
                    await Task.Delay(UnavailableRetryDelay, cancellationToken);
                    continue;
                }

                logger.LogWarning(exception, "Gemini call failed at the transport level.");
                return new GeminiCall(null, AiErrorCode.Unavailable);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                {
                    var code = MapStatusCode(response.StatusCode);

                    if (response.StatusCode == HttpStatusCode.TooManyRequests && quotaAttempt < MaxQuotaRetries)
                    {
                        quotaAttempt += 1;
                        var wait = ParseRetryDelay(body);
                        logger.LogInformation(
                            "Gemini rate-limited us (attempt {Attempt}); waiting {Seconds}s before one retry.",
                            quotaAttempt,
                            wait.TotalSeconds);
                        await Task.Delay(wait, cancellationToken);
                        continue;
                    }

                    if (code == AiErrorCode.Unavailable && unavailableAttempt < MaxUnavailableRetries)
                    {
                        unavailableAttempt += 1;
                        logger.LogInformation(
                            "Gemini returned {Status} (retry {Attempt}); waiting {Seconds}s before one retry.",
                            (int)response.StatusCode,
                            unavailableAttempt,
                            UnavailableRetryDelay.TotalSeconds);
                        await Task.Delay(UnavailableRetryDelay, cancellationToken);
                        continue;
                    }

                    logger.LogWarning(
                        "Gemini returned {Status} ({Code}). Body: {Body}",
                        (int)response.StatusCode,
                        code,
                        Truncate(body, 500));
                    return new GeminiCall(null, code);
                }
            }

            return new GeminiCall(body, null);
        }
    }

    /// <summary>One bounded retry: enough to ride out a rolling per-minute window without
    /// turning a transient cap into a long or unbounded wait inside one request.</summary>
    private const int MaxQuotaRetries = 1;

    /// <summary>One bounded retry for a timed-out call, a dropped connection, or a Gemini-side
    /// 503 — see the comment above the retry loop for the empirical basis.</summary>
    private const int MaxUnavailableRetries = 1;

    /// <summary>Short and fixed rather than parsed from a header: unlike quota, Gemini never
    /// tells us how long "high demand" will last, and a timeout already burned up to
    /// <see cref="GoogleAiOptions.TimeoutSeconds"/> waiting — a long extra pause here would
    /// make one bad batch dominate the whole analysis's wall-clock time.</summary>
    private static readonly TimeSpan UnavailableRetryDelay = TimeSpan.FromSeconds(2);

    /// <summary>
    /// Reads the structured wait time Google actually returns — <c>details[].retryDelay</c>
    /// on the <c>google.rpc.RetryInfo</c> entry (e.g. <c>"57s"</c>) — rather than parsing the
    /// free-text message. Retrying earlier than this is just a wasted call: per-minute quotas
    /// don't reset early. Capped at a bit over a minute (the window this quota resets on) so
    /// a pathological value can't stall the request for longer than that.
    /// </summary>
    private static TimeSpan ParseRetryDelay(string body)
    {
        const double fallbackSeconds = 5;
        var cap = TimeSpan.FromSeconds(65);

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error) &&
                error.TryGetProperty("details", out var details) &&
                details.ValueKind == JsonValueKind.Array)
            {
                foreach (var detail in details.EnumerateArray())
                {
                    if (detail.TryGetProperty("@type", out var type) &&
                        type.GetString()?.EndsWith("RetryInfo", StringComparison.Ordinal) == true &&
                        detail.TryGetProperty("retryDelay", out var retryDelay) &&
                        retryDelay.GetString() is { } raw &&
                        double.TryParse(raw.TrimEnd('s'), out var seconds))
                    {
                        // +1s buffer: retrying at the exact reported instant risks landing
                        // a moment early once request latency and clock skew are counted.
                        var delay = TimeSpan.FromSeconds(seconds + 1);
                        return delay > cap ? cap : delay;
                    }
                }
            }
        }
        catch (JsonException)
        {
            // Falls through to the fallback below — a malformed body shouldn't crash the retry.
        }

        return TimeSpan.FromSeconds(fallbackSeconds);
    }

    private static string MapStatusCode(HttpStatusCode status) => status switch
    {
        HttpStatusCode.TooManyRequests => AiErrorCode.Quota,
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.BadRequest => AiErrorCode.Config,
        // 402/PaymentRequired and friends read as "billing ran out" to a user.
        HttpStatusCode.PaymentRequired => AiErrorCode.Quota,
        >= HttpStatusCode.InternalServerError => AiErrorCode.Unavailable,
        _ => AiErrorCode.Unknown,
    };

    /// <summary>
    /// Pulls the model's text out of a <c>generateContent</c> response, or says why there is
    /// none. Refusals arrive as a 200 with no candidates and a block reason, not as an error,
    /// so this is where they become <see cref="AiErrorCode.Blocked"/>.
    /// </summary>
    private (string? Answer, string? Failure) ExtractAnswer(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;

            // Refusals arrive as a 200 with no candidates and a blockReason, not as an error.
            if (root.TryGetProperty("promptFeedback", out var feedback) &&
                feedback.TryGetProperty("blockReason", out var blockReason))
            {
                logger.LogWarning("Gemini blocked the prompt: {Reason}", blockReason.GetString());
                return (null, AiErrorCode.Blocked);
            }

            if (!root.TryGetProperty("candidates", out var candidates) ||
                candidates.ValueKind != JsonValueKind.Array ||
                candidates.GetArrayLength() == 0)
            {
                logger.LogWarning("Gemini answered without candidates: {Body}", Truncate(body, 500));
                return (null, AiErrorCode.Blocked);
            }

            var candidate = candidates[0];

            if (candidate.TryGetProperty("finishReason", out var finishReason) &&
                finishReason.GetString() is "SAFETY" or "PROHIBITED_CONTENT" or "BLOCKLIST")
            {
                logger.LogWarning("Gemini stopped early: {Reason}", finishReason.GetString());
                return (null, AiErrorCode.Blocked);
            }

            // Some model versions split the answer across several parts; join them all
            // rather than assuming parts[0] holds the whole JSON object.
            var text = new StringBuilder();
            if (candidate.TryGetProperty("content", out var content) &&
                content.TryGetProperty("parts", out var parts) &&
                parts.ValueKind == JsonValueKind.Array)
            {
                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var partText) && partText.GetString() is { } value)
                    {
                        text.Append(value);
                    }
                }
            }

            var answer = text.ToString().Trim();
            if (answer.Length == 0)
            {
                logger.LogWarning("Gemini answered with empty text: {Body}", Truncate(body, 500));
                return (null, AiErrorCode.Invalid);
            }

            return (answer, null);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Could not parse Gemini's answer: {Body}", Truncate(body, 500));
            return (null, AiErrorCode.Invalid);
        }
    }

    private AiCallOutcome ParseAcceptedIds(string body)
    {
        var (answer, failure) = ExtractAnswer(body);
        if (failure is not null)
        {
            return AiCallOutcome.Failure(failure);
        }

        try
        {
            using var parsed = JsonDocument.Parse(answer!);
            if (!parsed.RootElement.TryGetProperty("ids", out var ids) || ids.ValueKind != JsonValueKind.Array)
            {
                logger.LogWarning("Gemini answer had no ids array: {Answer}", Truncate(answer!, 500));
                return AiCallOutcome.Failure(AiErrorCode.Invalid);
            }

            var accepted = new List<string>();
            foreach (var id in ids.EnumerateArray())
            {
                var value = id.ValueKind == JsonValueKind.String ? id.GetString() : id.ToString();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    accepted.Add(NormalizeId(value));
                }
            }

            return AiCallOutcome.Success(accepted);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Could not parse Gemini's answer: {Body}", Truncate(body, 500));
            return AiCallOutcome.Failure(AiErrorCode.Invalid);
        }
    }

    private AiProfileCallOutcome ParseProfile(string body)
    {
        var (answer, failure) = ExtractAnswer(body);
        if (failure is not null)
        {
            return AiProfileCallOutcome.Failure(failure);
        }

        try
        {
            using var parsed = JsonDocument.Parse(answer!);
            var root = parsed.RootElement;

            if (root.ValueKind != JsonValueKind.Object ||
                !TryReadString(root, "label", out var label) ||
                !TryReadString(root, "summary", out var summary))
            {
                logger.LogWarning("Gemini profile answer was missing its label or summary: {Answer}", Truncate(answer!, 500));
                return AiProfileCallOutcome.Failure(AiErrorCode.Invalid);
            }

            TryReadString(root, "secondary", out var secondary);

            return AiProfileCallOutcome.Success(new AiProfileAnswer(label!, secondary, summary!));
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "Could not parse Gemini's profile answer: {Body}", Truncate(body, 500));
            return AiProfileCallOutcome.Failure(AiErrorCode.Invalid);
        }
    }

    private static bool TryReadString(JsonElement element, string name, out string? value)
    {
        value = null;

        if (!element.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var text = property.GetString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        value = text.Trim();
        return true;
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";

    /// <summary>
    /// The prompt labels each snippet as "#N" (see <see cref="AiMetricPrompts.RenderBatch"/>),
    /// and models tend to echo that exact token back even when asked for the bare number —
    /// confirmed empirically against gemini-3.1-flash-lite, which answered "#2" for a
    /// candidate whose real id is "2". Stripping it here means a verdict is never silently
    /// dropped by an exact-string match against <see cref="AiSnippetInput.Id"/> just because
    /// the model kept the leading "#".
    /// </summary>
    private static string NormalizeId(string value) => value.Trim().TrimStart('#').Trim();

    /// <summary>
    /// Attaches what the call cost, read off the answer's <c>usageMetadata</c>. Best effort
    /// by design: an answer without it, or one that is not JSON, leaves the counts null and
    /// the verdict untouched — what a call cost must never decide what it answered.
    /// Reasoning tokens are billed as output, so they are added to it.
    /// </summary>
    internal static AiCallOutcome WithUsage(AiCallOutcome outcome, string body)
    {
        var (input, output) = ReadUsage(body);

        return input is null && output is null
            ? outcome
            : outcome with { InputTokens = input, OutputTokens = output };
    }

    /// <summary>The same bookkeeping for a profile call; see <see cref="WithUsage"/>.</summary>
    internal static AiProfileCallOutcome WithProfileUsage(AiProfileCallOutcome outcome, string body)
    {
        var (input, output) = ReadUsage(body);

        return input is null && output is null
            ? outcome
            : outcome with { InputTokens = input, OutputTokens = output };
    }

    private static (int? Input, int? Output) ReadUsage(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("usageMetadata", out var usage) || usage.ValueKind != JsonValueKind.Object)
            {
                return (null, null);
            }

            int Read(string name) =>
                usage.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
                    ? number
                    : 0;

            return (Read("promptTokenCount"), Read("candidatesTokenCount") + Read("thoughtsTokenCount"));
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }
}

public sealed record AiCallOutcome(bool IsSuccess, IReadOnlyList<string> AcceptedIds, string? ErrorCode)
{
    /// <summary>Null when the call never reached Gemini, or its answer carried no usage.</summary>
    public int? InputTokens { get; init; }

    public int? OutputTokens { get; init; }

    public static AiCallOutcome Success(IReadOnlyList<string> acceptedIds) => new(true, acceptedIds, null);

    public static AiCallOutcome Failure(string errorCode) => new(false, [], errorCode);
}

/// <summary>What the model wrote for one person, exactly as it wrote it — validation comes later.</summary>
public sealed record AiProfileAnswer(string Label, string? Secondary, string Summary);

public sealed record AiProfileCallOutcome(bool IsSuccess, AiProfileAnswer? Answer, string? ErrorCode)
{
    /// <summary>Null when the call never reached Gemini, or its answer carried no usage.</summary>
    public int? InputTokens { get; init; }

    public int? OutputTokens { get; init; }

    public static AiProfileCallOutcome Success(AiProfileAnswer answer) => new(true, answer, null);

    public static AiProfileCallOutcome Failure(string errorCode) => new(false, null, errorCode);
}
