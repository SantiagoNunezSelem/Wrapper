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
    /// How stale a "pendiente" row may be before simply opening the account screen re-asks
    /// Mercado Pago about it. Reading the overview is otherwise a pure local read, which is
    /// exactly what leaves someone who has already paid staring at "pendiente" whenever the
    /// webhook did not land and they did not come back through the checkout's return URL.
    /// Short enough that a reload feels live, long enough that a screen polling itself does
    /// not turn one visit into a dozen calls to Mercado Pago.
    /// </summary>
    private static readonly TimeSpan PendingRefreshAfter = TimeSpan.FromSeconds(20);

    /// <summary>
    /// Shown to the customer whenever a <see cref="MercadoPagoException"/> reaches an
    /// endpoint. <see cref="MercadoPagoException.Message"/> is not safe to forward as-is —
    /// on a rejected request it embeds Mercado Pago's own raw error text, and on others the
    /// HTTP method and path we called — so every catch site logs the real exception and
    /// hands the customer this instead.
    /// </summary>
    // No "try again in a moment": the most common reason checkout refuses to open is a
    // rejected preapproval, which is a configuration fault that retrying never clears.
    // Sending the payer around that loop is how a broken setup looks like a flaky network.
    private const string ProviderErrorMessage = "No pudimos abrir el checkout de Mercado Pago. No se te cobró nada.";

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
            ILogger<SubscriptionService> logger,
            string? deviceId,
            CancellationToken cancellationToken) =>
        {
            var user = await LoadUserAsync(principal, db, cancellationToken);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            await RefreshStalePendingAsync(user, subscriptions, logger, cancellationToken);

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

        MapDiagnostics(app);
        MapWebhook(app);
    }

    /// <summary>
    /// Answers, for the account that owns the app, the one question the billing screens
    /// cannot: <b>is the webhook working at all?</b>
    ///
    /// Every way this integration fails silently converges on the same visible symptom —
    /// a subscription that stays on "pendiente" — while the causes could not be more
    /// different: the URL in the Mercado Pago panel points somewhere else, a topic is not
    /// ticked, the signing secret does not match, the payer was never sent back. From
    /// outside they are indistinguishable, and none of them leaves a row in the events
    /// table, because a notification has to be verified before anything is written. This
    /// puts the configuration and what has actually arrived side by side so the difference
    /// is one request away instead of a guess.
    /// </summary>
    private static void MapDiagnostics(WebApplication app)
    {
        app.MapGet("/api/subscription/diagnostics", [Authorize] async (
            ClaimsPrincipal principal,
            AppDbContext db,
            MercadoPagoWebhookLog webhookLog,
            IOptions<MercadoPagoOptions> options,
            CancellationToken cancellationToken) =>
        {
            var userId = principal.GetRequiredUserId();
            var isAdmin = await db.Users
                .Where(candidate => candidate.Id == userId)
                .Select(candidate => candidate.IsAdmin)
                .FirstOrDefaultAsync(cancellationToken);

            // 404 rather than 403: an endpoint that describes the payment configuration
            // should not confirm its own existence to an account that cannot read it.
            if (!isAdmin)
            {
                return Results.NotFound();
            }

            return Results.Ok(WebhookDiagnosticsResponse.Build(options.Value, webhookLog.Snapshot()));
        });
    }

    private static void MapWebhook(WebApplication app)
    {
        // Anonymous by necessity — Mercado Pago cannot hold a JWT. The signature is what
        // authenticates it; see MercadoPagoSignatureValidator.
        app.MapPost("/api/webhooks/mercadopago", async (
            HttpContext http,
            MercadoPagoSignatureValidator validator,
            SubscriptionService subscriptions,
            MercadoPagoWebhookLog webhookLog,
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
                webhookLog.Record(
                    WebhookOutcomes.Unparseable,
                    null,
                    null,
                    "Neither the body nor the query said which resource changed.");

                return Results.BadRequest(new { message = "Unrecognised notification payload." });
            }

            var check = validator.Validate(http.Request, notification.DataId);
            if (!check.IsValid)
            {
                logger.LogWarning("Rejected a Mercado Pago notification: {Reason}", check.Reason);

                // Recorded, not just logged. A rejected notification never reaches
                // SubscriptionService, so it writes no event either — which leaves
                // "nothing ever arrived" and "everything arrived and bounced" looking
                // identical from the account screen, and those two have completely
                // different fixes.
                webhookLog.Record(WebhookOutcomes.Rejected, notification.Topic, notification.DataId, check.Reason);

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

                webhookLog.Record(
                    WebhookOutcomes.TimedOut,
                    notification.Topic,
                    notification.DataId,
                    $"Ran past the {WebhookBudget.TotalSeconds}s budget.");

                return Results.StatusCode(StatusCodes.Status500InternalServerError);
            }
            catch (Exception exception)
            {
                // 500 asks Mercado Pago to redeliver, which is what we want for a
                // transient fault — the handler is idempotent, so a repeat is harmless.
                logger.LogError(exception, "Failed to process Mercado Pago notification {Topic}/{DataId}.", notification.Topic, notification.DataId);
                webhookLog.Record(WebhookOutcomes.Failed, notification.Topic, notification.DataId, exception.Message);

                return Results.StatusCode(StatusCodes.Status500InternalServerError);
            }

            webhookLog.Record(WebhookOutcomes.Accepted, notification.Topic, notification.DataId, notification.Action);

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

    /// <summary>
    /// Re-asks Mercado Pago about a checkout that is still sitting on "pendiente".
    ///
    /// Everything that moves a subscription off that state — the webhook, the return
    /// page's sync, the background reconciler — can be late or missing, and the one thing
    /// a customer who has just paid actually does is open the app. Doing nothing there is
    /// what turns a delivery problem into "pagué y la app dice que no". Bounded on both
    /// sides: only a pending row, and only when the last look is older than
    /// <see cref="PendingRefreshAfter"/>.
    ///
    /// A provider failure is swallowed on purpose — the stored state is still worth
    /// showing, and this is a convenience layered on top of it, not the path that decides
    /// anything.
    /// </summary>
    private static async Task RefreshStalePendingAsync(
        User user,
        SubscriptionService subscriptions,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var current = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user);

        if (current is null ||
            current.Status != "pendiente" ||
            current.IsDevSimulated ||
            (current.LastSyncedAtUtc is { } lastSynced && DateTime.UtcNow - lastSynced < PendingRefreshAfter))
        {
            return;
        }

        try
        {
            await subscriptions.SyncAsync(user, cancellationToken);
        }
        catch (MercadoPagoException exception)
        {
            logger.LogWarning(exception, "Could not refresh the pending subscription for user {UserId}.", user.Id);
        }
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

        // The provider trail — webhook topics, status transitions, internal notes — is a
        // diagnostic for whoever runs billing, not something a customer can read. Still
        // recorded for every account; only sent to admins.
        IReadOnlyList<SubscriptionEvent> events = user.IsAdmin
            ? await subscriptions.GetEventsAsync(user.Id, cancellationToken)
            : [];

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
    // Whether Mercado Pago still has this charge going somewhere. The local status says
    // "pendiente" both for that and for a checkout the payer opened and walked away from
    // (a declined card included), and those are opposite messages: one is "tu plata está
    // en camino", the other is "no pasó nada, no se te cobró". See
    // SubscriptionAccessEvaluator.HasPaymentInFlight for how the two are told apart.
    bool PaymentInProgress,
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
            SubscriptionAccessEvaluator.HasPaymentInFlight(subscription),
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
            // A checkout the payer opened and abandoned is not a subscription in progress:
            // nothing was authorised and nothing will be charged, so the plan stays on
            // offer rather than the screen holding them hostage to a payment that never
            // started. A pending row with no link left to resume — a legacy checkout, or
            // one whose URL was cleared — needs the same, or it is a dead end: no way
            // forward and nothing to cancel that would help.
            CanSubscribe: current.Status is "inactiva" or "cancelada" ||
                          (current.Status == "pendiente" &&
                           (!canResumeCheckout || !SubscriptionAccessEvaluator.HasPaymentInFlight(current))),
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

/// <summary>
/// The configuration that decides whether payments can complete, next to what has
/// actually reached the webhook. Admin-only: it names no customer, but it does describe
/// how the money side of the app is wired.
/// </summary>
public sealed record WebhookDiagnosticsResponse(
    bool AccessTokenConfigured,
    bool UsingTestCredentials,
    bool WebhookSecretConfigured,
    // The path Mercado Pago has to be pointed at, so the value in the panel can be
    // compared against it without going to look for it in the code.
    string WebhookPath,
    string? ConfiguredWebhookUrl,
    string BackUrl,
    bool BackUrlIsPublic,
    string CheckoutReturnUrl,
    int ReconcileIntervalMinutes,
    DateTime InstanceStartedAtUtc,
    long NotificationsReceived,
    long NotificationsAccepted,
    long NotificationsRejected,
    DateTime? LastNotificationAtUtc,
    DateTime? LastAcceptedNotificationAtUtc,
    IReadOnlyList<WebhookDelivery> Recent,
    // What is wrong, in the order worth fixing it. Empty means the settings this endpoint
    // can see are sound and notifications are being accepted.
    IReadOnlyList<string> Findings)
{
    public static WebhookDiagnosticsResponse Build(MercadoPagoOptions options, WebhookLogSnapshot log)
    {
        var findings = new List<string>();

        if (!options.IsConfigured)
        {
            findings.Add("MercadoPago:AccessToken is empty — checkout cannot even open.");
        }
        else if (options.IsTestCredential)
        {
            findings.Add(
                "The access token is a TEST credential. Real payments made against production Mercado Pago " +
                "will not be visible to it, so nothing will ever move off 'pendiente'.");
        }

        if (!string.IsNullOrWhiteSpace(options.WebhookSecret))
        {
            if (log.Received == 0)
            {
                findings.Add(
                    "No notification has reached this instance since it started. Check that the URL registered in " +
                    "the Mercado Pago panel ends in /api/webhooks/mercadopago and points at THIS API, not at the " +
                    "site's own domain — a static host that rewrites unknown paths to index.html answers 200, so " +
                    "the panel reports every delivery as successful while nothing is ever processed.");
            }
            else if (log.Accepted == 0)
            {
                findings.Add(
                    "Notifications are arriving but every one of them is being rejected. The usual cause is a " +
                    "MercadoPago:WebhookSecret that is not the secret shown for this webhook in the panel " +
                    "(they are per-integration, and the test and production ones differ).");
            }
        }
        else
        {
            findings.Add(
                "MercadoPago:WebhookSecret is empty — every notification is answered with 401 and discarded, so " +
                "no subscription can activate on its own.");
        }

        if (!options.HasPublicBackUrl)
        {
            findings.Add(
                $"MercadoPago:BackUrl is '{options.BackUrl}', which Mercado Pago will not redirect back to. The " +
                "payer never lands on /suscripcion after paying, so the immediate re-check does not run and the " +
                "screen keeps whatever it had until the reconciler catches up.");
        }

        if (options.ReconcileIntervalMinutes <= 0)
        {
            findings.Add(
                "Reconciliation is off (MercadoPago:ReconcileIntervalMinutes = 0), so a lost notification stays " +
                "lost until someone presses 'Actualizar estado'.");
        }

        return new WebhookDiagnosticsResponse(
            options.IsConfigured,
            options.IsTestCredential,
            !string.IsNullOrWhiteSpace(options.WebhookSecret),
            "/api/webhooks/mercadopago",
            string.IsNullOrWhiteSpace(options.WebhookUrl) ? null : options.WebhookUrl,
            options.BackUrl,
            options.HasPublicBackUrl,
            options.CheckoutReturnUrl,
            options.ReconcileIntervalMinutes,
            log.StartedAtUtc,
            log.Received,
            log.Accepted,
            log.Rejected,
            log.LastReceivedAtUtc,
            log.LastAcceptedAtUtc,
            log.Recent,
            findings);
    }
}
