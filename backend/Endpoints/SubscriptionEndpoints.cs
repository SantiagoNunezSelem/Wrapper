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
    /// <summary>
    /// How long one webhook may take before it is abandoned. Comfortably under Mercado
    /// Pago's own 22-second cutoff, so we choose the outcome rather than having them time
    /// us out.
    /// </summary>
    private static readonly TimeSpan WebhookBudget = TimeSpan.FromSeconds(18);

    /// <summary>
    /// Shown to the customer whenever a <see cref="MercadoPagoException"/> reaches an
    /// endpoint. <see cref="MercadoPagoException.Message"/> is not safe to forward as-is —
    /// on a rejected request it embeds Mercado Pago's own raw error text, and on others the
    /// HTTP method and path we called — so every catch site logs the real exception and
    /// hands the customer this instead.
    /// </summary>
    private const string ProviderErrorMessage = "We couldn't reach Mercado Pago. Please try again in a moment.";

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
            ILogger<SubscriptionService> logger,
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
                logger.LogError(exception, "Checkout failed for user {UserId}.", user.Id);
                return Results.Json(
                    new { message = ProviderErrorMessage, code = "provider_error" },
                    statusCode: StatusCodes.Status502BadGateway);
            }

            return Results.Ok(new CheckoutStartResponse(result.RedirectUrl, result.SubscriptionId, result.Resumed));
        });

        app.MapPost("/api/subscription/cancel", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            ILogger<SubscriptionService> logger,
            CancellationToken cancellationToken) =>
        {
            var user = await LoadUserAsync(principal, db, cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            CancellationOutcome outcome;
            try
            {
                outcome = await subscriptions.CancelAsync(user, cancellationToken);
            }
            catch (SubscriptionConflictException exception)
            {
                return Results.Json(
                    new { message = exception.Message, code = exception.Code },
                    statusCode: StatusCodes.Status409Conflict);
            }
            catch (MercadoPagoException exception)
            {
                logger.LogError(exception, "Cancel failed for user {UserId}.", user.Id);
                return Results.Json(
                    new { message = ProviderErrorMessage, code = "provider_error" },
                    statusCode: StatusCodes.Status502BadGateway);
            }

            var eligibility = await trialEligibility.EvaluateAsync(user, http, null, cancellationToken);

            // The overview carries the new state; `cancellation` carries what just
            // happened to it, which is the part the confirmation message is written from
            // and cannot be re-derived once the screen has only the "cancelada" row.
            return Results.Ok(await BuildOverviewAsync(
                user,
                subscriptions,
                eligibility,
                cancellationToken,
                cancellation: CancellationResponse.From(outcome)));
        });

        // Pausing exists so that "this month is tight" does not have to mean cancelling.
        // Mercado Pago keeps the card and the price; resuming puts it back on schedule.
        app.MapPost("/api/subscription/pause", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            ILogger<SubscriptionService> logger,
            CancellationToken cancellationToken) =>
            await RunSubscriptionActionAsync(
                principal,
                db,
                subscriptions,
                trialEligibility,
                http,
                logger,
                (service, user, token) => service.PauseAsync(user, token),
                cancellationToken));

        app.MapPost("/api/subscription/resume", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            ILogger<SubscriptionService> logger,
            CancellationToken cancellationToken) =>
            await RunSubscriptionActionAsync(
                principal,
                db,
                subscriptions,
                trialEligibility,
                http,
                logger,
                (service, user, token) => service.ResumeAsync(user, token),
                cancellationToken));

        // Called by the checkout return page: the browser almost always gets back before
        // the webhook lands, so without this the customer would stare at "pendiente"
        // right after paying.
        app.MapPost("/api/subscription/sync", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            SubscriptionService subscriptions,
            TrialEligibilityService trialEligibility,
            HttpContext http,
            ILogger<SubscriptionService> logger,
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
                logger.LogError(exception, "Sync failed for user {UserId}.", user.Id);
                return Results.Ok(await BuildOverviewAsync(
                    user,
                    subscriptions,
                    await trialEligibility.EvaluateAsync(user, http, null, cancellationToken),
                    cancellationToken,
                    warning: ProviderErrorMessage));
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

            // Mercado Pago gives a webhook 22 seconds to answer and treats anything slower
            // as a failure. Handling one notification can chain two calls back to them
            // (read the payment, then re-read the preapproval), each with its own timeout,
            // which together can outlast that window — and a webhook that "fails" often
            // enough stops being delivered at all, which is precisely how a paid
            // subscription ends up stranded. So the work gets a budget that fits inside
            // their limit, and blowing it becomes a deliberate 500: a redelivery we can
            // still act on, instead of a silent timeout on their side.
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            budget.CancelAfter(WebhookBudget);

            try
            {
                await subscriptions.HandleNotificationAsync(
                    notification.Topic,
                    notification.Action,
                    notification.DataId,
                    rawBody,
                    budget.Token);
            }
            catch (OperationCanceledException) when (budget.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(
                    "Gave up on Mercado Pago notification {Topic}/{DataId} after {Seconds}s to answer inside their window; it will be redelivered, and the reconciler covers it either way.",
                    notification.Topic,
                    notification.DataId,
                    WebhookBudget.TotalSeconds);

                return Results.StatusCode(StatusCodes.Status500InternalServerError);
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

    /// <summary>
    /// Pause and resume differ only in which method they call: same auth, same error
    /// translation, same "hand back the whole refreshed overview" ending. Written once so
    /// a third action cannot accidentally answer with a different error shape.
    /// </summary>
    private static async Task<IResult> RunSubscriptionActionAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        SubscriptionService subscriptions,
        TrialEligibilityService trialEligibility,
        HttpContext http,
        ILogger<SubscriptionService> logger,
        Func<SubscriptionService, User, CancellationToken, Task<Subscription>> action,
        CancellationToken cancellationToken)
    {
        var user = await LoadUserAsync(principal, db, cancellationToken);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        try
        {
            await action(subscriptions, user, cancellationToken);
        }
        catch (SubscriptionConflictException exception)
        {
            return Results.Json(
                new { message = exception.Message, code = exception.Code },
                statusCode: StatusCodes.Status409Conflict);
        }
        catch (MercadoPagoException exception)
        {
            logger.LogError(exception, "Subscription action failed for user {UserId}.", user.Id);
            return Results.Json(
                new { message = ProviderErrorMessage, code = "provider_error" },
                statusCode: StatusCodes.Status502BadGateway);
        }

        var eligibility = await trialEligibility.EvaluateAsync(user, http, null, cancellationToken);
        return Results.Ok(await BuildOverviewAsync(user, subscriptions, eligibility, cancellationToken));
    }

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
        string? warning = null,
        CancellationResponse? cancellation = null)
    {
        var current = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user);
        var invoices = await subscriptions.GetInvoicesAsync(user.Id, cancellationToken);
        var events = await subscriptions.GetEventsAsync(user.Id, cancellationToken);

        // The admin override is real access, but it is not a purchase, so the screen must
        // not offer to cancel, pause or resume it.
        var fromAdminOverride = user.IsAdmin && current is null;

        return new SubscriptionOverviewResponse(
            PlanResponse.From(subscriptions.GetPlanInfo()),
            current is null ? null : SubscriptionResponse.From(current),
            SubscriptionAccessEvaluator.HasVipAccess(user),
            user.IsAdmin,
            fromAdminOverride,
            eligibility.IsEligible,
            eligibility.Reason,
            SubscriptionActionsResponse.For(current, fromAdminOverride),
            subscriptions.GetManageUrl(),
            [.. user.Subscriptions
                .OrderByDescending(item => item.CreatedAtUtc)
                .Select(SubscriptionResponse.From)],
            [.. invoices.Select(InvoiceResponse.From)],
            [.. events.Select(EventResponse.From)],
            warning,
            cancellation);
    }
}

internal sealed record WebhookNotification(string Topic, string? Action, string DataId);

public sealed record CheckoutRequest(string? DeviceId);

public sealed record CheckoutStartResponse(string InitPoint, Guid SubscriptionId, bool Resumed);

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
    DateTime? PausedAtUtc,
    DateTime? LastSyncedAtUtc,
    bool TrialWasApplied,
    bool IsDevSimulated,
    bool HasAccess,
    // Whether Mercado Pago will charge this again. Cancelled and paused both keep access
    // for a while, so "¿tenés acceso?" and "¿te van a cobrar?" are different questions
    // and the screen answers both.
    bool AutoRenewEnabled,
    // When Pro ends if nothing else changes. Null when access is not running.
    DateTime? AccessUntilUtc,
    // The unfinished checkout to send the payer back to, when there is one.
    string? CheckoutUrl,
    // Mercado Pago's status_detail for the charge that has not settled — what turns
    // "pendiente" into a sentence that says what to do about it.
    string? PendingReason,
    DateTime CreatedAtUtc)
{
    public static SubscriptionResponse From(Subscription subscription)
    {
        var hasAccess = SubscriptionAccessEvaluator.HasVipAccess(subscription);

        return new SubscriptionResponse(
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
            subscription.PausedAtUtc,
            subscription.LastSyncedAtUtc,
            subscription.TrialWasApplied,
            subscription.IsDevSimulated,
            hasAccess,
            subscription.Status is "trial" or "activa" or "pago_fallido",
            hasAccess ? subscription.NextBillingAtUtc ?? subscription.TrialEndsAtUtc : null,
            subscription.Status == "pendiente" ? subscription.CheckoutUrl : null,
            subscription.LastPaymentStatusDetail,
            subscription.CreatedAtUtc);
    }
}

/// <summary>
/// Which buttons the account screen is allowed to show. Decided here rather than in the
/// UI so the rules cannot drift between web and the mobile shell, and so a request the
/// server would reject with a 409 is never offered in the first place.
/// </summary>
public sealed record SubscriptionActionsResponse(
    bool CanSubscribe,
    bool CanResumeCheckout,
    bool CanCancel,
    bool CanPause,
    bool CanResume)
{
    public static SubscriptionActionsResponse For(Subscription? current, bool fromAdminOverride)
    {
        if (fromAdminOverride)
        {
            return new SubscriptionActionsResponse(false, false, false, false, false);
        }

        if (current is null)
        {
            return new SubscriptionActionsResponse(true, false, false, false, false);
        }

        // Simulated subscriptions exist only to exercise the UI locally; the only real
        // thing that can be done to one is switching it back off, which the dev toolbar
        // owns. Everything that would talk to Mercado Pago is hidden.
        if (current.IsDevSimulated)
        {
            return new SubscriptionActionsResponse(true, false, true, false, false);
        }

        var linked = !string.IsNullOrWhiteSpace(current.ExternalSubscriptionId);
        var canResumeCheckout = current.Status == "pendiente" && !string.IsNullOrWhiteSpace(current.CheckoutUrl);

        return new SubscriptionActionsResponse(
            // A pending row with no link left to resume — a legacy checkout, or one whose
            // URL was cleared — must still offer the plan, or the screen is a dead end:
            // no way forward and nothing to cancel that would help.
            CanSubscribe: current.Status is "inactiva" or "cancelada" || (current.Status == "pendiente" && !canResumeCheckout),
            CanResumeCheckout: canResumeCheckout,
            // "Cancelar" on a pending row means "olvidate de este pago", which is worth
            // offering: otherwise an abandoned checkout blocks the screen forever.
            CanCancel: current.Status is "trial" or "activa" or "pago_fallido" or "pausada" or "pendiente",
            CanPause: linked && current.Status is "activa" or "trial" or "pago_fallido",
            CanResume: linked && current.Status is "pausada");
    }
}

/// <summary>What a cancellation just did, for the confirmation the screen shows once.</summary>
public sealed record CancellationResponse(
    bool NothingWillBeCharged,
    bool AlreadyCancelled,
    DateTime? AccessUntilUtc)
{
    public static CancellationResponse From(CancellationOutcome outcome) =>
        new(outcome.NothingWillBeCharged, outcome.AlreadyCancelled, outcome.AccessUntilUtc);
}

public sealed record InvoiceResponse(
    Guid Id,
    decimal Amount,
    string CurrencyId,
    string Status,
    // Mercado Pago's status_detail, passed through untranslated: the frontend owns the
    // wording, and a value they add tomorrow still arrives instead of being dropped.
    string? StatusDetail,
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
            invoice.StatusDetail,
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
    SubscriptionActionsResponse Actions,
    // Where the payer changes the card. Null when no URL is configured, so the screen can
    // simply not offer it rather than linking somewhere useless.
    string? ManageUrl,
    IReadOnlyList<SubscriptionResponse> History,
    IReadOnlyList<InvoiceResponse> Invoices,
    IReadOnlyList<EventResponse> Events,
    string? Warning,
    // Present only on the response to a cancellation.
    CancellationResponse? Cancellation);
