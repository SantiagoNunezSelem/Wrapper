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

    /// <summary>
    /// Verified empirically (2026-08-18): a healthy 200 response from gemini-3.1-flash-lite
    /// can already take 15-23s under normal load. 30s left almost no margin and turned
    /// ordinary slowness into a false "unavailable" — see <see cref="GoogleAiClient"/>'s
    /// retry loop for how a genuine timeout is now handled once this margin is used up.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 45;

    /// <summary>Snippets per Gemini call. Keeps one prompt small and the JSON answer parseable.</summary>
    public int BatchSize { get; set; } = 40;

    /// <summary>
    /// Hard ceiling on how many filtered snippets one chat+metric may ever send.
    /// This is the main spend guard: a 85k-message chat can produce a lot of keyword
    /// hits, and without a cap a single upload could burn an entire quota. Above
    /// <see cref="BatchSize"/>, so a dense chat still spans multiple Gemini calls — the
    /// tiered candidate selection (see <c>buildAiCandidates</c> on the frontend) is what
    /// keeps that spend worth it: crude/explicit hits fill the slots before milder ones
    /// ever get a chance.
    /// </summary>
    public int MaxSnippetsPerMetric { get; set; } = 300;

    /// <summary>
    /// Numbered lines of the red-flags scan that go to Gemini in one call. The whole stretch the
    /// browser sends — the last five thousand messages, plus the few hundred it picked from
    /// earlier on — is far too much for one prompt that must also come back as parseable JSON
    /// within <see cref="TimeoutSeconds"/>, so it is read a few hundred lines at a time.
    /// </summary>
    public int ScanLinesPerCall { get; set; } = 500;

    /// <summary>
    /// Most lines one scan request may carry. The browser splits its sample into parts of about
    /// this size so no single request has to wait for the whole chat to be read, and this is the
    /// same ceiling enforced on this side: a hand-built request cannot ask for more.
    /// </summary>
    public int MaxScanLinesPerPart { get; set; } = 2000;

    /// <summary>Most lines in one stretch of the scan. Must not exceed <see cref="ScanLinesPerCall"/> by much, or one stretch is more than a call can take.</summary>
    public int MaxScanChunkLines { get; set; } = 500;

    /// <summary>Ceiling on one scanned line, in characters. A client cannot make us pay for a novel.</summary>
    public int MaxScanLineChars { get; set; } = 400;

    /// <summary>
    /// Calls of one scan part that run at the same time. They are independent, and a part is
    /// several of them; this keeps it inside one request's patience without bursting past the
    /// model's per-minute quota.
    /// </summary>
    public int ScanConcurrency { get; set; } = 4;

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
    /// Most people one chat's personality profiles may cover. The browser picks the most
    /// active ones; this is the same ceiling enforced on this side so a hand-built request
    /// cannot ask for a whole group chat. Mirrors <c>MAX_PROFILED_PEOPLE</c> on the frontend.
    /// </summary>
    public int MaxProfilePeople { get; set; } = 8;

    /// <summary>
    /// Messages of one person's sample that reach Gemini. The other half of the spend guard
    /// for profiles — people × this × <see cref="MaxProfileMessageChars"/> bounds a request.
    /// Mirrors <c>PROFILE_SAMPLE_SIZE</c> on the frontend.
    /// </summary>
    public int MaxProfileMessages { get; set; } = 40;

    /// <summary>Ceiling on one sample message, in characters. A client cannot make us pay for a novel.</summary>
    public int MaxProfileMessageChars { get; set; } = 300;

    /// <summary>Below this a "sample" is just a handful of lines and the profile would be made up.</summary>
    public int MinProfileMessages { get; set; } = 10;

    /// <summary>
    /// People profiled at the same time. Profiles are independent calls, so running a few at
    /// once keeps a full group inside one request's patience — without ever being able to
    /// burst past the model's per-minute quota in one go.
    /// </summary>
    public int ProfileConcurrency { get; set; } = 3;

    /// <summary>
    /// A little above zero, unlike the classification calls: the summary is prose, and at
    /// zero every profile in a group opens with the same sentence.
    /// </summary>
    public double ProfileTemperature { get; set; } = 0.4;

    /// <summary>
    /// Reasoning-token budget. 0 disables "thinking" on Gemini 2.5 models, which is
    /// pure savings for a yes/no classification. Set to -1 to omit the field entirely
    /// if you switch to a model that rejects it (e.g. the 2.0 series).
    /// </summary>
    public int ThinkingBudget { get; set; }

    /// <summary>
    /// Google's price per million input tokens for <see cref="Model"/>, in US dollars. Left
    /// at 0, the admin panel shows tokens and no cost: a price copied off a pricing page that
    /// has since changed is worse than none, because it looks exact.
    /// </summary>
    public decimal InputPricePerMillionUsd { get; set; }

    /// <summary>Same as <see cref="InputPricePerMillionUsd"/>, for output (answer plus reasoning) tokens.</summary>
    public decimal OutputPricePerMillionUsd { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
