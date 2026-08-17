using System.Security.Claims;
using System.Text;
using backend.Data;
using backend.Endpoints;
using backend.Models;
using backend.Options;
using backend.Services;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<GoogleAuthOptions>(builder.Configuration.GetSection(GoogleAuthOptions.SectionName));
builder.Services.Configure<AdminSeedOptions>(builder.Configuration.GetSection(AdminSeedOptions.SectionName));
builder.Services.Configure<GoogleAiOptions>(builder.Configuration.GetSection(GoogleAiOptions.SectionName));
builder.Services.Configure<MercadoPagoOptions>(builder.Configuration.GetSection(MercadoPagoOptions.SectionName));
builder.Services.Configure<TrialGuardOptions>(builder.Configuration.GetSection(TrialGuardOptions.SectionName));

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

app.UseHttpsRedirection();
app.UseCors("frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/api/auth/google", async (
    GoogleLoginRequest request,
    AppDbContext db,
    IConfiguration configuration,
    TokenService tokenService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.IdToken))
    {
        return Results.BadRequest(new { message = "Missing Google ID token." });
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
});

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

    if (string.IsNullOrWhiteSpace(request.SourceHash))
    {
        return Results.BadRequest(new { message = "SourceHash is required." });
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

    if (string.IsNullOrWhiteSpace(sourceHash))
    {
        return Results.BadRequest(new { message = "sourceHash is required." });
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

    if (string.IsNullOrWhiteSpace(request.SourceHash))
    {
        return Results.BadRequest(new { message = "SourceHash is required." });
    }

    var results = await service.AnalyzeAsync(
        access.User.Id,
        request.SourceHash,
        request.Metrics ?? [],
        cancellationToken);

    return Results.Ok(new AiMetricsResponse(results));
});

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

    if (string.IsNullOrWhiteSpace(request.SourceHash))
    {
        return Results.BadRequest(new { message = "SourceHash is required." });
    }

    // Retries only ever touch metrics currently marked failed, and only once their
    // stored cooldown has elapsed — the button can't be used to hammer the quota.
    var results = await service.RetryFailedAsync(access.User.Id, request.SourceHash, cancellationToken);
    return Results.Ok(new AiMetricsResponse(results));
});

app.MapSubscriptionEndpoints();
app.MapFreeUnlockEndpoints();
app.MapDevEndpoints();

LogPaymentsConfiguration(app);

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

record GoogleLoginRequest(string IdToken);

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
