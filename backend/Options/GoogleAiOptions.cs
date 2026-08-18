namespace backend.Options;

public sealed class GoogleAiOptions
{
    public const string SectionName = "GoogleAi";

    /// <summary>
    /// Google AI Studio API key. Never commit this: load it from user secrets
    /// (<c>dotnet user-secrets set "GoogleAi:ApiKey" "..."</c>) or from the
    /// <c>GoogleAi__ApiKey</c> environment variable. It only ever leaves this
    /// process toward Google — the browser never sees it.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    public string Endpoint { get; set; } = "https://generativelanguage.googleapis.com/v1beta";

    /// <summary>
    /// Cheapest usable Gemini tier for a short classification job. Verified directly
    /// against the API on 2026-08-02: <c>gemini-2.5-flash-lite</c> and <c>gemini-2.5-flash</c>
    /// both 404 for newly-created API keys ("no longer available to new users"), and
    /// <c>gemini-2.0-flash-lite</c> 429s on the free tier (quota limit 0 for that model).
    /// <c>gemini-3.1-flash-lite</c> is the cheapest tier that actually answers for a new
    /// key. Model deprecations roll out over time — if this starts 404ing again, list
    /// models the key can see with a GET to <c>/v1beta/models</c> and pick another
    /// non-preview "-lite" one from there rather than guessing a name.
    /// </summary>
    public string Model { get; set; } = "gemini-3.1-flash-lite";

    public int TimeoutSeconds { get; set; } = 30;

    /// <summary>Snippets per Gemini call. Keeps one prompt small and the JSON answer parseable.</summary>
    public int BatchSize { get; set; } = 40;

    /// <summary>
    /// Hard ceiling on how many filtered snippets one chat+metric may ever send.
    /// This is the main spend guard: a 85k-message chat can produce a lot of keyword
    /// hits, and without a cap a single upload could burn an entire quota.
    /// </summary>
    public int MaxSnippetsPerMetric { get; set; } = 300;

    /// <summary>Cooldown before a failed metric may be retried, in seconds.</summary>
    public int RetryCooldownSeconds { get; set; } = 120;

    /// <summary>
    /// How many distinct chats one account may have analysed by the AI in a UTC day.
    /// <para>
    /// This is the ceiling on what a single account can cost. Verdicts are cached per
    /// (account, chat, metric), so re-reading an already-analysed chat is free forever —
    /// but a <em>new</em> chat fingerprint always misses that cache and always spends
    /// tokens, and the fingerprint comes from the request. Without this cap, one
    /// subscription (or one week-long free trial) is enough to drain the entire Gemini
    /// quota by looping with a fresh hash each time. Ten is far above what a real person
    /// does in a day and far below what an attack needs.
    /// </para>
    /// </summary>
    public int MaxChatsPerDay { get; set; } = 10;

    /// <summary>
    /// Reasoning-token budget. 0 disables "thinking" on Gemini 2.5 models, which is
    /// pure savings for a yes/no classification. Set to -1 to omit the field entirely
    /// if you switch to a model that rejects it (e.g. the 2.0 series).
    /// </summary>
    public int ThinkingBudget { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
