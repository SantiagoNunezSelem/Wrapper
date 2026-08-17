using System.Security.Claims;
using System.Text.Json;
using backend.Data;
using backend.Models;
using backend.Options;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Endpoints;

public static class SubscriptionEndpoints
{
    public static void MapSubscriptionEndpoints(this WebApplication app)
    {
        // Public: the landing page needs a price to advertise before anyone signs in.
        app.MapGet("/api/subscription/plan", (SubscriptionService subscriptions) =>
            Results.Ok(PlanResponse.From(subscriptions.GetPlanInfo())));

        app.MapGet("/api/subscription", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            string? deviceId,
            CancellationToken cancellationToken) =>
        {
            var user = await LoadUserAsync(principal, db, cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            var eligibility = await trialEligibility.EvaluateAsync(user, http, deviceId, cancellationToken);

            return Results.Ok(await BuildOverviewAsync(user, subscriptions, eligibility, cancellationToken));
        });

        // Opens a checkout and hands back Mercado Pago's own hosted page — the frontend's
        // whole job after this call is `window.location.href = initPoint`. Nothing about
        // the subscription is known to have succeeded yet: that arrives later, through the
        // webhook or the /sync endpoint the checkout's back_url lands on.
        app.MapPost("/api/subscription/checkout", [Authorize] async (
            ClaimsPrincipal principal,
            CheckoutRequest? request,
            AppDbContext db,
            SubscriptionService subscriptions,
            HttpContext http,
            CancellationToken cancellationToken) =>
        {
            var user = await LoadUserAsync(principal, db, cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            CheckoutResult result;
            try
            {
                result = await subscriptions.StartCheckoutAsync(user, http, request?.DeviceId, cancellationToken);
            }
            catch (SubscriptionConflictException exception)
            {
                return Results.Json(
                    new { message = exception.Message, code = exception.Code },
                    statusCode: StatusCodes.Status409Conflict);
            }
            catch (MercadoPagoException exception)
            {
                return Results.Json(
                    new { message = exception.Message, code = "provider_error" },
                    statusCode: StatusCodes.Status502BadGateway);
            }

            return Results.Ok(new CheckoutStartResponse(result.RedirectUrl, result.SubscriptionId));
        });

        app.MapPost("/api/subscription/cancel", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            CancellationToken cancellationToken) =>
        {
            var user = await LoadUserAsync(principal, db, cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            try
            {
                await subscriptions.CancelAsync(user, cancellationToken);
            }
            catch (SubscriptionConflictException exception)
            {
                return Results.Json(
                    new { message = exception.Message, code = exception.Code },
                    statusCode: StatusCodes.Status409Conflict);
            }
            catch (MercadoPagoException exception)
            {
                return Results.Json(
                    new { message = exception.Message, code = "provider_error" },
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var eligibility = await trialEligibility.EvaluateAsync(user, http, null, cancellationToken);
            return Results.Ok(await BuildOverviewAsync(user, subscriptions, eligibility, cancellationToken));
        });

        // Called by the checkout return page: the browser almost always gets back before
        // the webhook lands, so without this the customer would stare at "pendiente"
        // right after paying.
        app.MapPost("/api/subscription/sync", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            CancellationToken cancellationToken) =>
        {
            var user = await LoadUserAsync(principal, db, cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            try
            {
                await subscriptions.SyncAsync(user, cancellationToken);
            }
            catch (MercadoPagoException exception)
            {
                // A sync failure is not fatal: the stored state is still shown, and the
                // webhook remains the authoritative path.
                return Results.Ok(await BuildOverviewAsync(
                    user,
                    subscriptions,
                    await trialEligibility.EvaluateAsync(user, http, null, cancellationToken),
                    cancellationToken,
                    warning: exception.Message));
            }

            var eligibility = await trialEligibility.EvaluateAsync(user, http, null, cancellationToken);
            return Results.Ok(await BuildOverviewAsync(user, subscriptions, eligibility, cancellationToken));
        });

        MapWebhook(app);
    }

    private static void MapWebhook(WebApplication app)
    {
        // Anonymous by necessity — Mercado Pago cannot hold a JWT. The signature is what
        // authenticates it; see MercadoPagoSignatureValidator.
        app.MapPost("/api/webhooks/mercadopago", async (
            HttpContext http,
            MercadoPagoSignatureValidator validator,
            SubscriptionService subscriptions,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            var logger = loggerFactory.CreateLogger("MercadoPagoWebhook");

            http.Request.EnableBuffering();
            using var reader = new StreamReader(http.Request.Body, leaveOpen: true);
            var rawBody = await reader.ReadToEndAsync(cancellationToken);
            http.Request.Body.Position = 0;

            var notification = ParseNotification(rawBody, http.Request.Query);
            if (notification is null)
            {
                logger.LogWarning("Discarded an unparseable Mercado Pago notification.");
                return Results.BadRequest(new { message = "Unrecognised notification payload." });
            }

            var check = validator.Validate(http.Request, notification.DataId);
            if (!check.IsValid)
            {
                logger.LogWarning("Rejected a Mercado Pago notification: {Reason}", check.Reason);
                return Results.Unauthorized();
            }

            try
            {
                await subscriptions.HandleNotificationAsync(
                    notification.Topic,
                    notification.Action,
                    notification.DataId,
                    rawBody,
                    cancellationToken);
            }
            catch (Exception exception)
            {
                // 500 asks Mercado Pago to redeliver, which is what we want for a
                // transient fault — the handler is idempotent, so a repeat is harmless.
                logger.LogError(exception, "Failed to process Mercado Pago notification {Topic}/{DataId}.", notification.Topic, notification.DataId);
                return Results.StatusCode(StatusCodes.Status500InternalServerError);
            }

            return Results.Ok(new { received = true });
        });
    }

    /// <summary>
    /// Mercado Pago has sent notifications in more than one shape over the years (JSON
    /// body, and query-string IPN with <c>topic</c>/<c>id</c>). Both are accepted so a
    /// panel configured either way works.
    /// </summary>
    private static WebhookNotification? ParseNotification(string rawBody, IQueryCollection query)
    {
        string? topic = null;
        string? action = null;
        string? dataId = null;

        if (!string.IsNullOrWhiteSpace(rawBody))
        {
            try
            {
                using var document = JsonDocument.Parse(rawBody);
                var root = document.RootElement;

                if (root.ValueKind == JsonValueKind.Object)
                {
                    topic = ReadString(root, "type") ?? ReadString(root, "topic");
                    action = ReadString(root, "action");

                    if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
                    {
                        dataId = ReadString(data, "id");
                    }

                    dataId ??= ReadString(root, "id");
                }
            }
            catch (JsonException)
            {
                // Falls through to the query-string form below.
            }
        }

        topic ??= query["topic"].ToString() is { Length: > 0 } queryTopic ? queryTopic : query["type"].ToString();
        dataId ??= query["id"].ToString() is { Length: > 0 } queryId ? queryId : query["data.id"].ToString();

        // `action` looks like "payment.updated"; the part before the dot repeats the topic.
        if (string.IsNullOrWhiteSpace(topic) && action?.Split('.') is [var prefix, ..])
        {
            topic = prefix;
        }

        if (string.IsNullOrWhiteSpace(topic) || string.IsNullOrWhiteSpace(dataId))
        {
            return null;
        }

        return new WebhookNotification(topic, action, dataId);
    }

    private static string? ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value)
            ? value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.ToString(),
                _ => null,
            }
            : null;

    private static Task<User?> LoadUserAsync(ClaimsPrincipal principal, AppDbContext db, CancellationToken cancellationToken)
    {
        var userId = principal.GetRequiredUserId();
        return db.Users
            .Include(candidate => candidate.Subscriptions)
            .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);
    }

    internal static async Task<SubscriptionOverviewResponse> BuildOverviewAsync(
        User user,
        SubscriptionService subscriptions,
        TrialEligibility eligibility,
        CancellationToken cancellationToken,
        string? warning = null)
    {
        var current = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user);
        var invoices = await subscriptions.GetInvoicesAsync(user.Id, cancellationToken);
        var events = await subscriptions.GetEventsAsync(user.Id, cancellationToken);

        return new SubscriptionOverviewResponse(
            PlanResponse.From(subscriptions.GetPlanInfo()),
            current is null ? null : SubscriptionResponse.From(current),
            SubscriptionAccessEvaluator.HasVipAccess(user),
            user.IsAdmin,
            // The admin override is real access, but it is not a purchase, so the screen
            // must not offer to cancel it.
            user.IsAdmin && current is null,
            eligibility.IsEligible,
            eligibility.Reason,
            [.. user.Subscriptions
                .OrderByDescending(item => item.CreatedAtUtc)
                .Select(SubscriptionResponse.From)],
            [.. invoices.Select(InvoiceResponse.From)],
            [.. events.Select(EventResponse.From)],
            warning);
    }
}

internal sealed record WebhookNotification(string Topic, string? Action, string DataId);

public sealed record CheckoutRequest(string? DeviceId);

public sealed record CheckoutStartResponse(string InitPoint, Guid SubscriptionId);

public sealed record PlanResponse(
    decimal Amount,
    string CurrencyId,
    int Frequency,
    string FrequencyType,
    int TrialFrequency,
    string TrialFrequencyType,
    string Name,
    bool ProviderConfigured)
{
    public static PlanResponse From(PlanInfo plan) =>
        new(
            plan.Amount,
            plan.CurrencyId,
            plan.Frequency,
            plan.FrequencyType,
            plan.TrialFrequency,
            plan.TrialFrequencyType,
            plan.Reason,
            plan.ProviderConfigured);
}

public sealed record SubscriptionResponse(
    Guid Id,
    string Status,
    string PlanType,
    decimal Amount,
    string CurrencyId,
    string? PaymentProvider,
    string? PaymentMethodLabel,
    string? ExternalSubscriptionId,
    DateTime? TrialStartsAtUtc,
    DateTime? TrialEndsAtUtc,
    DateTime? SubscriptionStartsAtUtc,
    DateTime? NextBillingAtUtc,
    DateTime? LastPaymentAtUtc,
    DateTime? CancelledAtUtc,
    DateTime? GraceEndsAtUtc,
    bool TrialWasApplied,
    bool IsDevSimulated,
    bool HasAccess,
    DateTime CreatedAtUtc)
{
    public static SubscriptionResponse From(Subscription subscription) =>
        new(
            subscription.Id,
            subscription.Status,
            subscription.PlanType,
            subscription.Amount,
            subscription.CurrencyId,
            subscription.PaymentProvider,
            subscription.PaymentMethodLabel,
            subscription.ExternalSubscriptionId,
            subscription.TrialStartsAtUtc,
            subscription.TrialEndsAtUtc,
            subscription.SubscriptionStartsAtUtc,
            subscription.NextBillingAtUtc,
            subscription.LastPaymentAtUtc,
            subscription.CancelledAtUtc,
            subscription.GraceEndsAtUtc,
            subscription.TrialWasApplied,
            subscription.IsDevSimulated,
            SubscriptionAccessEvaluator.HasVipAccess(subscription),
            subscription.CreatedAtUtc);
}

public sealed record InvoiceResponse(
    Guid Id,
    decimal Amount,
    string CurrencyId,
    string Status,
    string? PaymentMethodLabel,
    DateTime? PeriodStartUtc,
    DateTime? PeriodEndUtc,
    DateTime? PaidAtUtc,
    DateTime? DebitScheduledAtUtc,
    int AttemptNumber,
    DateTime CreatedAtUtc)
{
    public static InvoiceResponse From(SubscriptionInvoice invoice) =>
        new(
            invoice.Id,
            invoice.Amount,
            invoice.CurrencyId,
            invoice.Status,
            invoice.PaymentMethodLabel,
            invoice.PeriodStartUtc,
            invoice.PeriodEndUtc,
            invoice.PaidAtUtc,
            invoice.DebitScheduledAtUtc,
            invoice.AttemptNumber,
            invoice.CreatedAtUtc);
}

public sealed record EventResponse(
    Guid Id,
    string Topic,
    string? Action,
    string? ResultingStatus,
    string? Notes,
    DateTime CreatedAtUtc)
{
    public static EventResponse From(SubscriptionEvent item) =>
        new(item.Id, item.Topic, item.Action, item.ResultingStatus, item.Notes, item.CreatedAtUtc);
}

public sealed record SubscriptionOverviewResponse(
    PlanResponse Plan,
    SubscriptionResponse? Current,
    bool HasVipAccess,
    bool IsAdmin,
    bool AccessFromAdminOverride,
    bool TrialAvailable,
    string? TrialDeniedReason,
    IReadOnlyList<SubscriptionResponse> History,
    IReadOnlyList<InvoiceResponse> Invoices,
    IReadOnlyList<EventResponse> Events,
    string? Warning);
