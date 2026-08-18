using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using backend.Data;
using backend.Endpoints;
using backend.Models;
using backend.Options;
using backend.Services;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

EnsureProductionSecrets(builder);

// Kestrel's own default is 30 MB. Nothing this API accepts comes anywhere near that: the
// largest legitimate body is one analysis' aggregated JSON (see SavedAnalysisLimits, half
// this). Leaving the default in place means any anonymous caller — the Mercado Pago
// webhook route reads the whole body into a string before it can check the signature —
// can make the server allocate 30 MB per request purely on request.
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 4 * 1024 * 1024);

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<GoogleAuthOptions>(builder.Configuration.GetSection(GoogleAuthOptions.SectionName));
builder.Services.Configure<AdminSeedOptions>(builder.Configuration.GetSection(AdminSeedOptions.SectionName));
builder.Services.Configure<GoogleAiOptions>(builder.Configuration.GetSection(GoogleAiOptions.SectionName));
builder.Services.Configure<MercadoPagoOptions>(builder.Configuration.GetSection(MercadoPagoOptions.SectionName));
builder.Services.Configure<TrialGuardOptions>(builder.Configuration.GetSection(TrialGuardOptions.SectionName));
builder.Services.Configure<RecaptchaOptions>(builder.Configuration.GetSection(RecaptchaOptions.SectionName));

// Behind a proxy, the socket address is the proxy's — the same value for every visitor.
// Rewriting HttpContext.Connection.RemoteIpAddress from X-Forwarded-For here means the
// rate limiter, the trial guard and the logs all see the real client without each one
// having to parse that header itself (and disagree about how).
var trialGuardOptions = builder.Configuration.GetSection(TrialGuardOptions.SectionName).Get<TrialGuardOptions>() ?? new TrialGuardOptions();
if (trialGuardOptions.TrustProxyHeaders)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

        // One hop by default: the proxy in front. Raising this without knowing the exact
        // chain length lets a client prepend its own entries and choose what we read.
        options.ForwardLimit = 1;

        if (trialGuardOptions.KnownProxies.Length > 0)
        {
            options.KnownProxies.Clear();
            options.KnownNetworks.Clear();

            foreach (var proxy in trialGuardOptions.KnownProxies)
            {
                if (System.Net.IPAddress.TryParse(proxy.Trim(), out var address))
                {
                    options.KnownProxies.Add(address);
                }
            }
        }
        else
        {
            // No allow-list given: accept the header from anywhere. Only sound when the
            // app is unreachable except through the proxy — LogSecurityConfiguration warns
            // about exactly this at boot.
            options.KnownProxies.Clear();
            options.KnownNetworks.Clear();
        }
    });
}

builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection"));
});

builder.Services.AddScoped<TokenService>();
builder.Services.AddHttpClient<GoogleAiClient>();
builder.Services.AddScoped<AiMetricService>();
builder.Services.AddHttpClient<MercadoPagoClient>();
builder.Services.AddSingleton<MercadoPagoSignatureValidator>();
builder.Services.AddSingleton<ClientFingerprint>();
builder.Services.AddHttpClient<RecaptchaClient>();
builder.Services.AddScoped<TrialEligibilityService>();
builder.Services.AddScoped<SubscriptionService>();
builder.Services.AddOpenApi();

var jwtOptions = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey));

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = signingKey,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Without this the client only learns "too many requests", never when to try again.
    // Both limiters below use a 1-minute window, so that's what's advertised — simpler
    // and just as accurate as reading it back out of lease metadata, which the built-in
    // fixed/sliding window limiters don't reliably populate on an immediate rejection.
    options.OnRejected = (context, _) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        return ValueTask.CompletedTask;
    };

    // A blunt, generous net across every endpoint — not tuned per route, just enough to
    // stop a runaway script from hammering the API. Authenticated routes already cost an
    // attacker a valid login; this is the backstop for the ones that don't.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(RateLimitPartitionKey(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 200,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));

    // Login is the one unauthenticated POST in the whole API — the endpoint a script that
    // skips the frontend (and its reCAPTCHA token) entirely would hit directly. Tighter
    // than the global limit on purpose.
    options.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetSlidingWindowLimiter(RateLimitPartitionKey(httpContext), _ => new SlidingWindowRateLimiterOptions
        {
            PermitLimit = 8,
            Window = TimeSpan.FromMinutes(1),
            SegmentsPerWindow = 4,
            QueueLimit = 0,
        }));

    // The only routes that spend money per call. Partitioned by account, not by address:
    // an attacker can have as many addresses as they like, but every one of these requests
    // has to come from an account that already holds Pro access, and that is the thing
    // worth rationing. Deliberately low — the real client makes one of these per chat, not
    // one per second.
    options.AddPolicy("ai", httpContext =>
        RateLimitPartition.GetTokenBucketLimiter(AiRateLimitPartitionKey(httpContext), _ => new TokenBucketRateLimiterOptions
        {
            // Room for the handful of metrics a genuine upload fires off back-to-back…
            TokenLimit = 12,
            // …then down to a trickle, so a script gets minutes-per-call rather than
            // hundreds-per-minute. The daily cap in AiMetricService is the harder ceiling;
            // this is what stops a burst from reaching it in seconds.
            TokensPerPeriod = 4,
            ReplenishmentPeriod = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? ["http://localhost:5173"];
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();
    // EnsureCreated skips databases that already exist, so anything added to the schema
    // after the first run has to be applied by hand. See SchemaUpgrades.
    await SchemaUpgrades.ApplyAsync(db);
    await SeedData.InitializeAsync(scope.ServiceProvider, db);
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// First in the pipeline, before anything reads the client address — the rate limiter and
// the trial guard both depend on it being the real one by the time they look.
if (trialGuardOptions.TrustProxyHeaders)
{
    app.UseForwardedHeaders();
}

app.UseHttpsRedirection();
app.UseCors("frontend");
app.UseAuthentication();
// After authentication on purpose: the AI policy partitions by account id, and the claim
// it reads only exists once the JWT has been validated. Partitioning AI spend by IP would
// be pointless anyway — addresses are free, and it is the account that carries Pro access.
app.UseRateLimiter();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/auth/google", async (
    GoogleLoginRequest request,
    AppDbContext db,
    IConfiguration configuration,
    TokenService tokenService,
    RecaptchaClient recaptcha,
    IOptions<RecaptchaOptions> recaptchaOptions,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.IdToken))
    {
        return Results.BadRequest(new { message = "Missing Google ID token." });
    }

    // Checked before anything else touches Google: no point spending that round-trip on
    // traffic reCAPTCHA already flagged. Unconfigured deployments skip this entirely and
    // behave exactly as they did before reCAPTCHA existed.
    if (recaptchaOptions.Value.IsConfigured &&
        !await PassesRecaptchaAsync(
            request,
            recaptchaOptions.Value,
            recaptcha,
            loggerFactory.CreateLogger("Recaptcha"),
            cancellationToken))
    {
        return Results.Json(
            new { message = "Verificación de seguridad requerida.", code = "recaptcha_required" },
            statusCode: StatusCodes.Status403Forbidden);
    }

    var googleOptions = configuration.GetSection(GoogleAuthOptions.SectionName).Get<GoogleAuthOptions>() ?? new GoogleAuthOptions();

    if (string.IsNullOrWhiteSpace(googleOptions.AllowedAudience))
    {
        return Results.Problem(
            title: "Google auth is not configured",
            detail: "Set GoogleAuth:AllowedAudience in backend/appsettings.Development.json before signing in.");
    }

    GoogleJsonWebSignature.Payload payload;
    try
    {
        // Google.Apis.Auth has no built-in way to bound this call (no CancellationToken
        // or HttpClient override on ValidationSettings), and its default HttpClient
        // timeout is 100s — long enough to look like a frozen page. Race it against our
        // own timeout so a slow/unreachable network fails fast with a clear error
        // instead of hanging the request for up to a minute or two.
        var validationTask = GoogleJsonWebSignature.ValidateAsync(request.IdToken, new GoogleJsonWebSignature.ValidationSettings
        {
            Audience = [googleOptions.AllowedAudience],
        });

        if (await Task.WhenAny(validationTask, Task.Delay(TimeSpan.FromSeconds(10), cancellationToken)) != validationTask)
        {
            return Results.Problem(
                title: "Google validation timed out",
                detail: "Could not reach Google to verify the sign-in token in time. Please try again.",
                statusCode: StatusCodes.Status504GatewayTimeout);
        }

        payload = await validationTask;
    }
    catch (Exception)
    {
        return Results.BadRequest(new { message = "Google token validation failed." });
    }

    if (!payload.EmailVerified)
    {
        return Results.BadRequest(new { message = "Google account email is not verified." });
    }

    var normalizedEmail = payload.Email.Trim().ToLowerInvariant();

    var user = await db.Users
        .Include(candidate => candidate.Subscriptions)
        .FirstOrDefaultAsync(candidate =>
            candidate.GoogleSubject == payload.Subject ||
            candidate.Email == normalizedEmail,
            cancellationToken);

    if (user is null)
    {
        user = new User
        {
            Email = normalizedEmail,
            GoogleSubject = payload.Subject,
            DisplayName = payload.Name ?? payload.Email,
            AvatarUrl = payload.Picture,
            PreferredLanguage = "es",
        };

        db.Users.Add(user);
    }
    else
    {
        user.GoogleSubject ??= payload.Subject;
        user.DisplayName = payload.Name ?? user.DisplayName;
        user.AvatarUrl = payload.Picture ?? user.AvatarUrl;
        user.UpdatedAtUtc = DateTime.UtcNow;
    }

    SeedData.ApplyAdminVipIfNeeded(user, db, configuration);

    await db.SaveChangesAsync(cancellationToken);

    var aiOptions = configuration.GetSection(GoogleAiOptions.SectionName).Get<GoogleAiOptions>() ?? new GoogleAiOptions();
    var paymentOptions = configuration.GetSection(MercadoPagoOptions.SectionName).Get<MercadoPagoOptions>() ?? new MercadoPagoOptions();
    var response = AuthResponse.Create(tokenService.Create(user), user, aiOptions.IsConfigured, paymentOptions.IsConfigured);
    return Results.Ok(response);
}).RequireRateLimiting("auth");

app.MapGet("/api/auth/me", [Authorize] async (
    ClaimsPrincipal principal,
    AppDbContext db,
    IOptions<GoogleAiOptions> googleAi,
    IOptions<MercadoPagoOptions> mercadoPago,
    CancellationToken cancellationToken) =>
{
    var userId = principal.GetRequiredUserId();
    var user = await db.Users
        .Include(candidate => candidate.Subscriptions)
        .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);

    return user is null
        ? Results.Unauthorized()
        : Results.Ok(CurrentUserResponse.FromUser(user, googleAi.Value.IsConfigured, mercadoPago.Value.IsConfigured));
});

app.MapGet("/api/analyses", [Authorize] async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var userId = principal.GetRequiredUserId();
    var analyses = await db.Analyses
        .Where(item => item.UserId == userId)
        .OrderByDescending(item => item.UpdatedAtUtc)
        .Select(item => SavedAnalysisResponse.FromEntity(item))
        .ToListAsync(cancellationToken);

    return Results.Ok(analyses);
});

app.MapPost("/api/analyses", [Authorize] async (
    ClaimsPrincipal principal,
    SaveAnalysisRequest request,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var userId = principal.GetRequiredUserId();

    if (string.IsNullOrWhiteSpace(request.ChatName) || string.IsNullOrWhiteSpace(request.ResultsJson))
    {
        return Results.BadRequest(new { message = "ChatName and ResultsJson are required." });
    }

    if (!IsValidSourceHash(request.SourceHash))
    {
        return Results.BadRequest(new { message = "A valid SourceHash is required." });
    }

    // Everything below is attacker-controlled text that gets written to disk and kept.
    // Without ceilings, an ordinary signed-in account can grow the database until the
    // volume fills — which takes the whole app down, not just this feature.
    if (request.ResultsJson.Length > SavedAnalysisLimits.MaxResultsJsonChars)
    {
        return Results.BadRequest(new { message = "ResultsJson is too large." });
    }

    if (request.ChatName.Length > SavedAnalysisLimits.MaxChatNameChars || request.DateRangeLabel.Length > SavedAnalysisLimits.MaxDateRangeLabelChars)
    {
        return Results.BadRequest(new { message = "ChatName or DateRangeLabel is too long." });
    }

    // Re-uploading the exact same export (identical source text, fingerprinted
    // client-side) updates the existing row instead of piling up duplicates in
    // the user's history.
    var existing = await db.Analyses.FirstOrDefaultAsync(
        item => item.UserId == userId && item.SourceHash == request.SourceHash,
        cancellationToken);

    if (existing is not null)
    {
        existing.ChatName = request.ChatName.Trim();
        existing.DateRangeLabel = request.DateRangeLabel.Trim();
        existing.MessageCount = request.MessageCount;
        existing.ParticipantCount = request.ParticipantCount;
        existing.ResultsJson = request.ResultsJson;
        existing.UpdatedAtUtc = DateTime.UtcNow;

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(SavedAnalysisResponse.FromEntity(existing));
    }

    // An update to an existing chat is always allowed (bounded by the size caps above);
    // it is only *new* rows that grow the table, so that is what the ceiling counts.
    if (await db.Analyses.CountAsync(item => item.UserId == userId, cancellationToken) >= SavedAnalysisLimits.MaxAnalysesPerUser)
    {
        return Results.Json(
            new
            {
                message = $"This account has reached the limit of {SavedAnalysisLimits.MaxAnalysesPerUser} saved analyses.",
                code = "analysis_limit_reached",
            },
            statusCode: StatusCodes.Status409Conflict);
    }

    var analysis = new SavedAnalysis
    {
        UserId = userId,
        ChatName = request.ChatName.Trim(),
        DateRangeLabel = request.DateRangeLabel.Trim(),
        MessageCount = request.MessageCount,
        ParticipantCount = request.ParticipantCount,
        ResultsJson = request.ResultsJson,
        SourceHash = request.SourceHash,
    };

    db.Analyses.Add(analysis);
    await db.SaveChangesAsync(cancellationToken);

    return Results.Created($"/api/analyses/{analysis.Id}", SavedAnalysisResponse.FromEntity(analysis));
});

// ---------------------------------------------------------------------------
// AI-backed Pro metrics
//
// Every route here is gated on an active Pro subscription *before* anything is
// sent to Google. A free user's request costs zero tokens: it is rejected at the
// door, because a locked metric would never display the answer anyway.
// ---------------------------------------------------------------------------

app.MapPost("/api/ai/consent", [Authorize] async (
    ClaimsPrincipal principal,
    AppDbContext db,
    IOptions<GoogleAiOptions> googleAi,
    IOptions<MercadoPagoOptions> mercadoPago,
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

    user.AiConsentAtUtc ??= DateTime.UtcNow;
    user.UpdatedAtUtc = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);

    return Results.Ok(CurrentUserResponse.FromUser(user, googleAi.Value.IsConfigured, mercadoPago.Value.IsConfigured));
});

app.MapGet("/api/ai/metrics", [Authorize] async (
    string sourceHash,
    ClaimsPrincipal principal,
    AppDbContext db,
    AiMetricService service,
    CancellationToken cancellationToken) =>
{
    var access = await AiAccess.EvaluateAsync(principal, db, cancellationToken);
    if (access.Failure is not null)
    {
        return access.Failure;
    }

    if (!IsValidSourceHash(sourceHash))
    {
        return Results.BadRequest(new { message = "A valid sourceHash is required." });
    }

    return Results.Ok(new AiMetricsResponse(await service.GetAsync(access.User!.Id, sourceHash, cancellationToken)));
});

app.MapPost("/api/ai/metrics", [Authorize] async (
    AiAnalyzeRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    AiMetricService service,
    CancellationToken cancellationToken) =>
{
    var access = await AiAccess.EvaluateAsync(principal, db, cancellationToken);
    if (access.Failure is not null)
    {
        return access.Failure;
    }

    if (access.User!.AiConsentAtUtc is null)
    {
        return Results.Json(
            new { message = "AI analysis has not been authorized by this user.", code = "consent_required" },
            statusCode: StatusCodes.Status403Forbidden);
    }

    if (!IsValidSourceHash(request.SourceHash))
    {
        return Results.BadRequest(new { message = "A valid SourceHash is required." });
    }

    // The client asks for at most the handful of AI metrics that exist. A longer list is
    // not a real client, and each entry is a separate run of Gemini batches.
    if (request.Metrics is { Count: > AiMetricService.MaxMetricsPerRequest })
    {
        return Results.BadRequest(new { message = "Too many metrics in one request." });
    }

    try
    {
        var results = await service.AnalyzeAsync(
            access.User.Id,
            request.SourceHash,
            request.Metrics ?? [],
            cancellationToken);

        return Results.Ok(new AiMetricsResponse(results));
    }
    catch (AiDailyLimitReachedException exception)
    {
        return Results.Json(
            new { message = exception.Message, code = "ai_daily_limit_reached" },
            statusCode: StatusCodes.Status429TooManyRequests);
    }
}).RequireRateLimiting("ai");

app.MapPost("/api/ai/metrics/retry", [Authorize] async (
    AiRetryRequest request,
    ClaimsPrincipal principal,
    AppDbContext db,
    AiMetricService service,
    CancellationToken cancellationToken) =>
{
    var access = await AiAccess.EvaluateAsync(principal, db, cancellationToken);
    if (access.Failure is not null)
    {
        return access.Failure;
    }

    if (access.User!.AiConsentAtUtc is null)
    {
        return Results.Json(
            new { message = "AI analysis has not been authorized by this user.", code = "consent_required" },
            statusCode: StatusCodes.Status403Forbidden);
    }

    if (!IsValidSourceHash(request.SourceHash))
    {
        return Results.BadRequest(new { message = "A valid SourceHash is required." });
    }

    // Retries only ever touch metrics currently marked failed, and only once their
    // stored cooldown has elapsed — the button can't be used to hammer the quota.
    var results = await service.RetryFailedAsync(access.User.Id, request.SourceHash, cancellationToken);
    return Results.Ok(new AiMetricsResponse(results));
}).RequireRateLimiting("ai");

app.MapSubscriptionEndpoints();
app.MapFreeUnlockEndpoints();
app.MapDevEndpoints();

LogPaymentsConfiguration(app);
LogSecurityConfiguration(app);

app.Run();

// Says plainly, on every boot, whether real payments can be taken. The failure mode
// otherwise is silent: the checkout button simply errors and it is not obvious that a
// single missing setting is the cause.
static void LogPaymentsConfiguration(WebApplication app)
{
    var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Payments");
    var mercadoPago = app.Configuration.GetSection(MercadoPagoOptions.SectionName).Get<MercadoPagoOptions>() ?? new MercadoPagoOptions();

    if (!mercadoPago.IsConfigured)
    {
        logger.LogWarning(
            "Mercado Pago is not configured — checkout is disabled. Set MercadoPago:AccessToken " +
            "(dotnet user-secrets set \"MercadoPago:AccessToken\" \"APP_USR-...\") to enable it.");
        return;
    }

    logger.LogInformation(
        "Mercado Pago ready ({Mode} credentials): {Amount} {Currency} every {Frequency} {FrequencyType}, {TrialFrequency} {TrialFrequencyType} free trial.",
        mercadoPago.IsTestCredential ? "test" : "production",
        mercadoPago.TransactionAmount,
        mercadoPago.CurrencyId,
        mercadoPago.Frequency,
        mercadoPago.FrequencyType,
        mercadoPago.TrialFrequency,
        mercadoPago.TrialFrequencyType);

    if (string.IsNullOrWhiteSpace(mercadoPago.WebhookSecret))
    {
        logger.LogWarning(
            "MercadoPago:WebhookSecret is empty — every incoming notification will be rejected, so " +
            "subscriptions will never activate. Copy the secret shown when registering the webhook URL.");
    }
}

/// <summary>
/// Says, on every boot, which anti-abuse defences are actually standing. Each of these can
/// be switched off by nothing more than an empty config value, and every one of them fails
/// silently — the app keeps serving traffic exactly as before, just unprotected. A line in
/// the startup log is the only thing that makes "we thought reCAPTCHA was on" discoverable
/// before an incident rather than after one.
/// </summary>
static void LogSecurityConfiguration(WebApplication app)
{
    var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Security");
    var recaptcha = app.Configuration.GetSection(RecaptchaOptions.SectionName).Get<RecaptchaOptions>() ?? new RecaptchaOptions();
    var trialGuard = app.Configuration.GetSection(TrialGuardOptions.SectionName).Get<TrialGuardOptions>() ?? new TrialGuardOptions();

    if (recaptcha.IsPartiallyConfigured)
    {
        logger.LogError(
            "reCAPTCHA is HALF configured (only one of Recaptcha:SecretKeyV3 / Recaptcha:SecretKeyV2 is set), " +
            "so it is switched OFF entirely. Both keys are required — the login endpoint lets the client say " +
            "which check it is answering, so a single-key setup would leave the other path unverifiable.");
    }
    else if (!recaptcha.IsConfigured)
    {
        logger.LogWarning(
            "reCAPTCHA is not configured — login is protected by rate limiting alone. " +
            "Set Recaptcha:SecretKeyV3 and Recaptcha:SecretKeyV2 to enable it.");
    }
    else
    {
        logger.LogInformation(
            "reCAPTCHA ready: v3 threshold {Threshold}, action \"{Action}\", {FailMode} if Google is unreachable.",
            recaptcha.ScoreThreshold,
            recaptcha.LoginAction,
            recaptcha.FailOpenOnProviderOutage ? "allowing logins" : "rejecting logins");
    }

    // The rate limiter partitions by client IP. Behind a proxy that address is the
    // proxy's unless forwarded headers are trusted — which would put every visitor in one
    // bucket and let a handful of requests exhaust the login limit for everybody.
    if (!trialGuard.TrustProxyHeaders && !app.Environment.IsDevelopment())
    {
        logger.LogWarning(
            "TrialGuard:TrustProxyHeaders is false. If this deployment sits behind a proxy, CDN or load " +
            "balancer, every request looks like it comes from that one address: rate limits would then be " +
            "shared by all visitors (a few requests could lock everyone out of login) and the trial guard " +
            "would treat unrelated people as the same client. Set it to true — and list the proxy in " +
            "TrialGuard:KnownProxies — only once the app is genuinely unreachable except through that proxy.");
    }

    if (trialGuard.TrustProxyHeaders && trialGuard.KnownProxies.Length == 0)
    {
        logger.LogWarning(
            "TrialGuard:TrustProxyHeaders is on with an empty TrialGuard:KnownProxies list, so X-Forwarded-For " +
            "is trusted from ANY source. If this app can be reached directly (not only through the proxy), " +
            "anyone can forge that header to get a fresh rate-limit bucket per request and a fresh free trial.");
    }
}

/// <summary>
/// Refuses to boot with a signing key anyone can read. The repository ships placeholder
/// keys so a fresh clone runs without setup, which is convenient right up until one of
/// them reaches production — at which point anybody with the repo can mint a token for
/// any user, including an admin one. Failing to start is the only reliable way to catch
/// that: a warning in a log nobody reads is exactly how it would ship.
/// </summary>
static void EnsureProductionSecrets(WebApplicationBuilder builder)
{
    if (builder.Environment.IsDevelopment())
    {
        return;
    }

    var jwt = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();

    // The values committed to appsettings.json / appsettings.Development.json.
    string[] knownPlaceholders =
    [
        "change-this-before-production-use-a-long-random-secret-key",
        "wrapper-crm-development-signing-key-change-me-before-production",
    ];

    if (knownPlaceholders.Contains(jwt.SigningKey, StringComparer.Ordinal))
    {
        throw new InvalidOperationException(
            "Jwt:SigningKey is still the placeholder committed to this repository. Anyone who can read the " +
            "source could forge a token for any account. Set a unique random value (for example " +
            "`openssl rand -base64 48`) via the Jwt__SigningKey environment variable before deploying.");
    }

    // HMAC-SHA256 derives its strength from the key; a short one is brute-forceable
    // offline from a single captured token.
    if (Encoding.UTF8.GetByteCount(jwt.SigningKey) < 32)
    {
        throw new InvalidOperationException(
            "Jwt:SigningKey is shorter than 32 bytes, which is too weak for HS256. Set a longer random value " +
            "via the Jwt__SigningKey environment variable.");
    }
}

/// <summary>
/// Rate limit partitions share the same IP hash the trial-guard system already computes
/// (<see cref="ClientFingerprint"/>) instead of reading the connection address a second
/// way — that hash already respects <c>TrialGuard:TrustProxyHeaders</c>, so it can't be
/// spoofed with a forged <c>X-Forwarded-For</c> on a deployment that isn't behind a proxy.
/// </summary>
static string RateLimitPartitionKey(HttpContext httpContext) =>
    httpContext.RequestServices.GetRequiredService<ClientFingerprint>().Describe(httpContext, null).IpHash ?? "unknown";

/// <summary>
/// Partition key for the AI routes: the signed-in account, falling back to the address for
/// anything that somehow reaches them unauthenticated (which the [Authorize] attribute
/// already refuses — this only exists so the key is never null).
/// </summary>
static string AiRateLimitPartitionKey(HttpContext httpContext) =>
    httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier) is { Length: > 0 } userId
        ? $"user:{userId}"
        : $"ip:{RateLimitPartitionKey(httpContext)}";

/// <summary>
/// The browser fingerprints a chat with a SHA-256 hex digest. Checking the shape matters
/// because this value is a primary lookup key for stored verdicts <em>and</em> the cache
/// key that decides whether a request costs Gemini tokens: an unbounded, free-form string
/// lets a caller mint a fresh cache miss on every request, and bloats the index it is
/// stored in while doing so.
/// </summary>
static bool IsValidSourceHash(string? value) =>
    value is { Length: >= 16 and <= 64 } && value.All(char.IsAsciiHexDigit);

/// <summary>
/// True if the login attempt clears reCAPTCHA. The v3 score check and the v2 fallback
/// share this path but need different secrets and different pass conditions (v2 has no
/// score — a solved checkbox is a solved checkbox).
///
/// <para>
/// Every early return here is a <em>rejection</em>, never a pass. That is the whole point:
/// the client chooses which of the two checks it claims to be answering, so any branch
/// that let a missing key or an unverifiable token through would be a bypass anyone could
/// trigger by flipping one field in the request body. The single "let it through" case is
/// a deliberate operator choice (see
/// <see cref="RecaptchaOptions.FailOpenOnProviderOutage"/>), and it only applies when
/// Google itself is unreachable — never when Google answers "no".
/// </para>
///
/// <para>
/// The fallback path is genuinely weaker than the score path — an attacker who wants a
/// checkbox solved can buy that — but it is still a real cost per attempt, and the "auth"
/// rate-limit policy is what actually bounds how fast it can be spent.
/// </para>
/// </summary>
static async Task<bool> PassesRecaptchaAsync(
    GoogleLoginRequest request,
    RecaptchaOptions options,
    RecaptchaClient recaptcha,
    ILogger logger,
    CancellationToken cancellationToken)
{
    var secret = request.RecaptchaIsFallback ? options.SecretKeyV2 : options.SecretKeyV3;

    // Unreachable while IsConfigured demands both keys, but this is the exact spot where
    // a future "only one key needed" change would silently open the door — so it is
    // written as a refusal rather than left to be inferred.
    if (string.IsNullOrWhiteSpace(secret))
    {
        logger.LogError(
            "Refusing a login: no reCAPTCHA secret is configured for the {Path} path.",
            request.RecaptchaIsFallback ? "v2 fallback" : "v3");
        return false;
    }

    if (string.IsNullOrWhiteSpace(request.RecaptchaToken))
    {
        return false;
    }

    var verification = await recaptcha.VerifyAsync(secret, request.RecaptchaToken, cancellationToken);

    // null means Google could not be reached at all — an outage, not a verdict.
    if (verification is null)
    {
        if (options.FailOpenOnProviderOutage)
        {
            logger.LogWarning("Allowing a login unverified: reCAPTCHA siteverify is unreachable.");
            return true;
        }

        return false;
    }

    if (!verification.Success)
    {
        return false;
    }

    // v2 has no score and no action — a solved checkbox is the whole verdict.
    if (request.RecaptchaIsFallback)
    {
        return true;
    }

    // A v3 token is minted for one action. Without this check, a token harvested from any
    // other action on the same site key would be accepted here.
    if (!string.Equals(verification.Action, options.LoginAction, StringComparison.Ordinal))
    {
        logger.LogWarning(
            "Rejecting a login: reCAPTCHA token was minted for action {Action}, expected {Expected}.",
            verification.Action ?? "(none)",
            options.LoginAction);
        return false;
    }

    return (verification.Score ?? 0) >= options.ScoreThreshold;
}

record GoogleLoginRequest(string IdToken, string? RecaptchaToken = null, bool RecaptchaIsFallback = false);

record AiAnalyzeRequest(string SourceHash, List<AiMetricRequestItem>? Metrics);

record AiRetryRequest(string SourceHash);

record AiMetricsResponse(IReadOnlyList<AiMetricStateDto> Results);

/// <summary>
/// Shared entry check for the AI routes: the caller must be a real, signed-in user
/// with Pro access. Returns the ready-to-return failure instead of throwing so each
/// endpoint stays a straight line.
/// </summary>
static class AiAccess
{
    public static async Task<AiAccessResult> EvaluateAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = principal.GetRequiredUserId();
        var user = await db.Users
            .Include(candidate => candidate.Subscriptions)
            .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);

        if (user is null)
        {
            return new AiAccessResult(null, Results.Unauthorized());
        }

        if (!SubscriptionAccessEvaluator.HasVipAccess(user))
        {
            return new AiAccessResult(
                null,
                Results.Json(
                    new { message = "AI metrics require an active Pro subscription.", code = "pro_required" },
                    statusCode: StatusCodes.Status403Forbidden));
        }

        return new AiAccessResult(user, null);
    }
}

record AiAccessResult(User? User, IResult? Failure);

/// <summary>
/// Ceilings on the one thing this API stores on behalf of a user. The aggregated results
/// of a very large chat run to a few hundred kilobytes; a megabyte is comfortably above
/// any real export and comfortably below "an account can fill the disk".
/// </summary>
static class SavedAnalysisLimits
{
    /// <summary>
    /// Two megabytes of aggregated JSON. An 85k-message export produces a couple of
    /// hundred kilobytes here — the results are counts, rankings and samples, never the
    /// chat itself — so this leaves an order of magnitude of headroom over anything real
    /// while still being a hard bound. Kestrel's own body limit is set to twice this, so
    /// an over-large payload trips this friendlier check rather than a bare 413.
    /// </summary>
    public const int MaxResultsJsonChars = 2_000_000;
    public const int MaxChatNameChars = 200;
    public const int MaxDateRangeLabelChars = 120;

    /// <summary>
    /// Rows one account may keep. Well past anyone's real history, while still bounding
    /// what a single sign-in can cost in storage — each row can be up to
    /// <see cref="MaxResultsJsonChars"/>.
    /// </summary>
    public const int MaxAnalysesPerUser = 200;
}

record SaveAnalysisRequest(
    string ChatName,
    string DateRangeLabel,
    int MessageCount,
    int ParticipantCount,
    string ResultsJson,
    string SourceHash);

record SavedAnalysisResponse(
    Guid Id,
    string ChatName,
    string DateRangeLabel,
    int MessageCount,
    int ParticipantCount,
    string ResultsJson,
    string SourceHash,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc)
{
    public static SavedAnalysisResponse FromEntity(SavedAnalysis analysis) =>
        new(
            analysis.Id,
            analysis.ChatName,
            analysis.DateRangeLabel,
            analysis.MessageCount,
            analysis.ParticipantCount,
            analysis.ResultsJson,
            analysis.SourceHash,
            analysis.CreatedAtUtc,
            analysis.UpdatedAtUtc);
}

record CurrentUserResponse(
    Guid Id,
    string Email,
    string DisplayName,
    string? AvatarUrl,
    bool IsAdmin,
    bool HasUsedTrial,
    bool HasVipAccess,
    string SubscriptionState,
    bool HasAiConsent,
    bool AiEnabled,
    bool PaymentsEnabled)
{
    /// <param name="aiEnabled">
    /// Whether this deployment actually has a Google AI Studio key. Lets the app hide
    /// the AI flow entirely instead of showing a retry button for what is really a
    /// server-side misconfiguration.
    /// </param>
    /// <param name="paymentsEnabled">
    /// Whether Mercado Pago credentials are present. Same idea: without them the upsell
    /// explains that checkout is not available yet rather than opening a doomed flow.
    /// </param>
    public static CurrentUserResponse FromUser(User user, bool aiEnabled, bool paymentsEnabled) =>
        new(
            user.Id,
            user.Email,
            user.DisplayName,
            user.AvatarUrl,
            user.IsAdmin,
            user.HasUsedTrial,
            SubscriptionAccessEvaluator.HasVipAccess(user),
            SubscriptionAccessEvaluator.GetVisibleState(user),
            user.AiConsentAtUtc is not null,
            aiEnabled,
            paymentsEnabled);
}

record AuthResponse(string Token, CurrentUserResponse User)
{
    public static AuthResponse Create(string token, User user, bool aiEnabled, bool paymentsEnabled) =>
        new(token, CurrentUserResponse.FromUser(user, aiEnabled, paymentsEnabled));
}

static class ClaimsPrincipalExtensions
{
    public static Guid GetRequiredUserId(this ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return value is not null && Guid.TryParse(value, out var parsed)
            ? parsed
            : throw new UnauthorizedAccessException("Missing user identifier claim.");
    }
}
