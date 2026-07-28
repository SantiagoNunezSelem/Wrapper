using System.Security.Claims;
using System.Text;
using backend.Data;
using backend.Models;
using backend.Options;
using backend.Services;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<GoogleAuthOptions>(builder.Configuration.GetSection(GoogleAuthOptions.SectionName));
builder.Services.Configure<AdminSeedOptions>(builder.Configuration.GetSection(AdminSeedOptions.SectionName));

builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection"));
});

builder.Services.AddScoped<TokenService>();
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
        payload = await GoogleJsonWebSignature.ValidateAsync(request.IdToken, new GoogleJsonWebSignature.ValidationSettings
        {
            Audience = [googleOptions.AllowedAudience],
        });
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

    var response = AuthResponse.Create(tokenService.Create(user), user);
    return Results.Ok(response);
});

app.MapGet("/api/auth/me", [Authorize] async (ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken) =>
{
    var userId = principal.GetRequiredUserId();
    var user = await db.Users
        .Include(candidate => candidate.Subscriptions)
        .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);

    return user is null ? Results.Unauthorized() : Results.Ok(CurrentUserResponse.FromUser(user));
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

app.Run();

record GoogleLoginRequest(string IdToken);

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
    string SubscriptionState)
{
    public static CurrentUserResponse FromUser(User user) =>
        new(
            user.Id,
            user.Email,
            user.DisplayName,
            user.AvatarUrl,
            user.IsAdmin,
            user.HasUsedTrial,
            SubscriptionAccessEvaluator.HasVipAccess(user),
            SubscriptionAccessEvaluator.GetVisibleState(user));
}

record AuthResponse(string Token, CurrentUserResponse User)
{
    public static AuthResponse Create(string token, User user) => new(token, CurrentUserResponse.FromUser(user));
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
