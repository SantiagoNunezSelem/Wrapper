using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// What the three core sections of the admin panel read: the business numbers, what needs
/// attention, and one account in full. Read-only by design — the only write the panel has
/// is a re-read from Mercado Pago, which the endpoint does through
/// <see cref="SubscriptionService.SyncAsync"/>.
///
/// Lists are paginated and aggregates are computed here, never in the browser: the panel
/// has to keep working when "all users" stops fitting in a response.
/// </summary>
public sealed class AdminDashboardService(
    AppDbContext db,
    IOptions<MercadoPagoOptions> options,
    IOptions<GoogleAiOptions> aiOptions,
    MercadoPagoWebhookLog webhookLog)
{
    /// <summary>Days are cut in Argentina's time, where the customers are. It has had no
    /// daylight saving since 2009, so a fixed offset is exact.</summary>
    public static readonly TimeSpan ReportingOffset = TimeSpan.FromHours(-3);

    public const int PageSize = 20;

    /// <summary>A charge Mercado Pago is working on counts as stuck after this long.</summary>
    public static readonly TimeSpan PendingTooLong = TimeSpan.FromHours(2);

    /// <summary>How far ahead a free week ending counts as worth a look.</summary>
    public static readonly TimeSpan TrialEndingSoon = TimeSpan.FromHours(48);

    private const string OrphanNote = "No matching local subscription";
    private const string TrialDeniedPrefix = "trial denied: ";

    private readonly MercadoPagoOptions _options = options.Value;
    private readonly GoogleAiOptions _aiOptions = aiOptions.Value;

    public static DateTime Local(DateTime utc) => utc + ReportingOffset;

    /// <summary>Start of the local calendar month that contains <paramref name="now"/>, in UTC.</summary>
    public static DateTime MonthStartUtc(DateTime now)
    {
        var local = Local(now);
        return new DateTime(local.Year, local.Month, 1) - ReportingOffset;
    }

    /// <summary>What the configured prices say those tokens cost. Null when no price is set.</summary>
    public static decimal? CostUsd(long inputTokens, long outputTokens, GoogleAiOptions prices) =>
        prices.InputPricePerMillionUsd <= 0 && prices.OutputPricePerMillionUsd <= 0
            ? null
            : (inputTokens * prices.InputPricePerMillionUsd + outputTokens * prices.OutputPricePerMillionUsd) / 1_000_000m;

    /// <summary>The seeded admin VIP and the dev toggle are not customers.</summary>
    private IQueryable<Subscription> RealSubscriptions() =>
        db.Subscriptions.Where(item => !item.IsSeededVip && !item.IsDevSimulated);

    // ---------------------------------------------------------------------------
    // Negocio
    // ---------------------------------------------------------------------------

    public async Task<BusinessReport> GetBusinessAsync(int days, DateTime now, CancellationToken cancellationToken)
    {
        days = Math.Clamp(days, 7, 90);
        var from = now.AddDays(-days);
        var previousFrom = from.AddDays(-days);

        var registered = await db.Users.CountAsync(cancellationToken);

        // Bounded by the window, not by the size of the user table.
        var signups = await db.Users
            .Where(user => user.CreatedAtUtc >= previousFrom)
            .Select(user => new { user.Id, user.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        var cohort = signups.Where(item => item.CreatedAtUtc >= from).Select(item => item.Id).ToList();

        // SQLite cannot sum decimals in SQL, so the handful of active amounts come back
        // and are added up here.
        var activeAmounts = await RealSubscriptions()
            .Where(item => item.Status == "activa")
            .Select(item => item.Amount)
            .ToListAsync(cancellationToken);

        var inTrial = await RealSubscriptions().CountAsync(item => item.Status == "trial", cancellationToken);
        var newPro = await RealSubscriptions().CountAsync(item => item.SubscriptionStartsAtUtc >= from, cancellationToken);

        var today = Local(now).Date;
        var signupsByDay = new int[days];
        foreach (var item in signups)
        {
            var index = days - 1 - (today - Local(item.CreatedAtUtc).Date).Days;
            if (index >= 0 && index < days)
            {
                signupsByDay[index]++;
            }
        }

        var firstMonth = new DateTime(today.Year, today.Month, 1).AddMonths(-5);
        var firstMonthUtc = firstMonth - ReportingOffset;
        var paid = await db.SubscriptionInvoices
            .Where(invoice => invoice.Status == "aprobado" && invoice.PaidAtUtc != null && invoice.PaidAtUtc >= firstMonthUtc)
            .Select(invoice => new { invoice.PaidAtUtc, invoice.Amount })
            .ToListAsync(cancellationToken);

        var months = Enumerable.Range(0, 6).Select(offset => firstMonth.AddMonths(offset)).ToList();
        static bool InMonth(DateTime? utc, DateTime month) =>
            utc is { } value && Local(value) is var local && local.Year == month.Year && local.Month == month.Month;

        var collectedByMonth = months
            .Select(month => new MonthTotal(month.ToString("yyyy-MM"), paid.Where(item => InMonth(item.PaidAtUtc, month)).Sum(item => item.Amount)))
            .ToList();

        var movements = await RealSubscriptions()
            .Where(item => item.SubscriptionStartsAtUtc >= firstMonthUtc || item.CancelledAtUtc >= firstMonthUtc)
            .Select(item => new { item.SubscriptionStartsAtUtc, item.CancelledAtUtc })
            .ToListAsync(cancellationToken);

        var proMovements = months
            .Select(month => new ProMovement(
                month.ToString("yyyy-MM"),
                movements.Count(item => InMonth(item.SubscriptionStartsAtUtc, month)),
                movements.Count(item => InMonth(item.CancelledAtUtc, month))))
            .ToList();

        var latest = await RealSubscriptions()
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(8)
            .Select(item => new LatestSubscription(item.UserId, item.User!.Email, item.Status, item.Amount, item.CurrencyId, item.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        // Null until the first account is seen: "0 activos" would read as a dead app, when
        // it only means nobody has opened it since the column existed.
        var tracked = await db.Users.AnyAsync(user => user.LastSeenAtUtc != null, cancellationToken);
        int? active7 = tracked ? await db.Users.CountAsync(user => user.LastSeenAtUtc >= now.AddDays(-7), cancellationToken) : null;
        int? active30 = tracked ? await db.Users.CountAsync(user => user.LastSeenAtUtc >= now.AddDays(-30), cancellationToken) : null;

        var monthStart = MonthStartUtc(now);
        var tokens = await db.AiUsage
            .Where(item => item.CreatedAtUtc >= monthStart)
            .GroupBy(_ => 1)
            .Select(group => new { Input = group.Sum(item => (long)item.InputTokens), Output = group.Sum(item => (long)item.OutputTokens) })
            .FirstOrDefaultAsync(cancellationToken);

        var funnel = new FunnelReport(
            cohort.Count,
            await db.Analyses.Where(item => cohort.Contains(item.UserId)).Select(item => item.UserId).Distinct().CountAsync(cancellationToken),
            await RealSubscriptions().Where(item => cohort.Contains(item.UserId)).Select(item => item.UserId).Distinct().CountAsync(cancellationToken),
            await db.SubscriptionInvoices.Where(item => cohort.Contains(item.UserId) && item.Status == "aprobado").Select(item => item.UserId).Distinct().CountAsync(cancellationToken));

        return new BusinessReport(
            days,
            registered,
            cohort.Count,
            signups.Count - cohort.Count,
            activeAmounts.Count,
            inTrial,
            newPro,
            activeAmounts.Sum(),
            await ConversionAsync(from, now, cancellationToken),
            await ConversionAsync(previousFrom, from, cancellationToken),
            signupsByDay,
            collectedByMonth,
            latest,
            active7,
            active30,
            tokens?.Input ?? 0,
            tokens?.Output ?? 0,
            CostUsd(tokens?.Input ?? 0, tokens?.Output ?? 0, _aiOptions),
            funnel,
            proMovements);
    }

    /// <summary>
    /// Of the free trials that ended in the window, the share that went on to an approved
    /// charge. Null when none ended: "0%" would claim every trial failed.
    /// </summary>
    private async Task<double?> ConversionAsync(DateTime from, DateTime to, CancellationToken cancellationToken)
    {
        var ended = await db.Subscriptions
            .Where(item => item.TrialWasApplied && !item.IsDevSimulated && item.TrialEndsAtUtc >= from && item.TrialEndsAtUtc < to)
            .Select(item => item.Id)
            .ToListAsync(cancellationToken);

        if (ended.Count == 0)
        {
            return null;
        }

        var converted = await db.SubscriptionInvoices
            .Where(invoice => ended.Contains(invoice.SubscriptionId) && invoice.Status == "aprobado")
            .Select(invoice => invoice.SubscriptionId)
            .Distinct()
            .CountAsync(cancellationToken);

        return (double)converted / ended.Count;
    }

    // ---------------------------------------------------------------------------
    // Urgencias
    // ---------------------------------------------------------------------------

    /// <param name="seller">
    /// Who the configured access token belongs to, when that could be asked — passed in
    /// rather than fetched here, so this stays a query over the database.
    /// </param>
    public async Task<UrgencyReport> GetUrgenciesAsync(DateTime now, MercadoPagoAccount? seller, CancellationToken cancellationToken)
    {
        var items = new List<Urgency>();
        var dayAgo = now.AddDays(-1);

        // A charge Mercado Pago took that matches no account: the payer is paying and has
        // nothing to show for it. The most expensive thing on this list to miss.
        var orphans = await db.SubscriptionEvents
            .Where(item => item.SubscriptionId == null && item.CreatedAtUtc >= now.AddDays(-7) && item.Notes != null && item.Notes.StartsWith(OrphanNote))
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(20)
            .ToListAsync(cancellationToken);
        items.AddRange(orphans.Select(item => new Urgency(
            UrgencyKinds.OrphanPayment, UrgencySeverity.Critical, item.CreatedAtUtc, 1, null, null, item.ExternalSubscriptionId, item.Topic, null)));

        // From the database, not the in-memory log: that one resets on deploy, which is
        // exactly when a rotated secret starts bouncing everything.
        var rejected = await db.WebhookRejections
            .Where(item => item.ReceivedAtUtc >= dayAgo)
            .OrderByDescending(item => item.ReceivedAtUtc)
            .Select(item => new { item.ReceivedAtUtc, item.Reason })
            .ToListAsync(cancellationToken);
        if (rejected.Count > 0)
        {
            items.Add(new Urgency(
                UrgencyKinds.WebhookRejected, UrgencySeverity.Critical, rejected[0].ReceivedAtUtc, rejected.Count, null, null, null, rejected[0].Reason, null));
        }

        var pendingCutoff = now - PendingTooLong;
        var pending = await RealSubscriptions()
            .Include(item => item.User)
            .Where(item => item.Status == "pendiente" && item.LastPaymentStatusDetail != null && item.CreatedAtUtc <= pendingCutoff)
            .ToListAsync(cancellationToken);
        items.AddRange(pending
            .Where(SubscriptionAccessEvaluator.HasPaymentInFlight)
            .Select(item => new Urgency(
                UrgencyKinds.PaymentPending, UrgencySeverity.Warning, item.CreatedAtUtc, 1, item.UserId, item.User?.Email, item.ExternalSubscriptionId, item.LastPaymentStatusDetail, null)));

        var failed = await RealSubscriptions()
            .Include(item => item.User)
            .Where(item => item.Status == "pago_fallido")
            .ToListAsync(cancellationToken);
        items.AddRange(failed.Select(item => new Urgency(
            UrgencyKinds.PaymentFailed, UrgencySeverity.Warning, item.UpdatedAtUtc, 1, item.UserId, item.User?.Email, item.ExternalSubscriptionId, item.LastPaymentStatusDetail, item.GraceEndsAtUtc)));

        // Revenue about to be decided: the first real charge of these runs within two days.
        var trialHorizon = now + TrialEndingSoon;
        var endingTrials = await RealSubscriptions()
            .Include(item => item.User)
            .Where(item => item.Status == "trial" && item.TrialEndsAtUtc >= now && item.TrialEndsAtUtc <= trialHorizon)
            .ToListAsync(cancellationToken);
        items.AddRange(endingTrials.Select(item => new Urgency(
            UrgencyKinds.TrialEnding, UrgencySeverity.Info, item.CreatedAtUtc, 1, item.UserId, item.User?.Email, item.ExternalSubscriptionId, null, item.TrialEndsAtUtc)));

        // "account_used" is someone asking for a second free week on the same account —
        // ordinary, and answered by the paid price. The other reasons are a new account
        // coming from somewhere that already had one, which is what abuse looks like.
        var denials = await db.SubscriptionEvents
            .Where(item => item.Topic == "checkout" && item.Action == "no_trial" && item.Notes != null && item.CreatedAtUtc >= dayAgo)
            .Select(item => new { item.Notes, item.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        items.AddRange(denials
            .Where(item => item.Notes!.StartsWith(TrialDeniedPrefix, StringComparison.Ordinal))
            .Select(item => new { Reason = item.Notes![TrialDeniedPrefix.Length..], item.CreatedAtUtc })
            .Where(item => item.Reason != "account_used")
            .GroupBy(item => item.Reason)
            .Select(group => new Urgency(
                UrgencyKinds.TrialBlocked, UrgencySeverity.Info, group.Max(item => item.CreatedAtUtc), group.Count(), null, null, null, group.Key, null)));

        var aiFailures = await db.AiMetricResults
            .Where(item => item.Status == AiMetricStatus.Failed && item.UpdatedAtUtc >= dayAgo)
            .Select(item => new { item.MetricId, item.ErrorCode, item.UpdatedAtUtc })
            .ToListAsync(cancellationToken);
        items.AddRange(aiFailures
            .GroupBy(item => new { item.MetricId, item.ErrorCode })
            .Select(group => new Urgency(
                UrgencyKinds.AiFailing, UrgencySeverity.Info, group.Max(item => item.UpdatedAtUtc), group.Count(), null, null, group.Key.MetricId, group.Key.ErrorCode, null)));

        var ordered = items
            .OrderBy(item => UrgencySeverity.Rank(item.Severity))
            .ThenByDescending(item => item.AtUtc)
            .ToList();

        var log = webhookLog.Snapshot();
        var health = new PaymentsHealth(
            log.StartedAtUtc,
            log.Received,
            log.Accepted,
            log.Rejected,
            log.LastAcceptedAtUtc,
            _options.ReconcileIntervalMinutes,
            !string.IsNullOrWhiteSpace(_options.WebhookSecret),
            _options.IsTestCredential || seller?.IsTestUser == true,
            string.IsNullOrWhiteSpace(_options.TestPayerEmail) ? null : _options.TestPayerEmail,
            seller?.Nickname,
            rejected.Count);

        return new UrgencyReport(ordered, health);
    }

    // ---------------------------------------------------------------------------
    // Usuarios
    // ---------------------------------------------------------------------------

    public async Task<UserPage> SearchUsersAsync(string? query, int page, CancellationToken cancellationToken)
    {
        page = Math.Max(1, page);
        var users = db.Users.AsQueryable();

        if (!string.IsNullOrWhiteSpace(query))
        {
            var exact = query.Trim();
            var lowered = exact.ToLowerInvariant();

            // Mail and name for people; the preapproval id for "Mercado Pago says this
            // one paid" — the lookup a support case usually starts from.
            users = users.Where(user =>
                user.Email.Contains(lowered) ||
                user.DisplayName.ToLower().Contains(lowered) ||
                user.Subscriptions.Any(item => item.ExternalSubscriptionId == exact));
        }

        var total = await users.CountAsync(cancellationToken);
        var rows = await users
            .OrderByDescending(user => user.CreatedAtUtc)
            .Skip((page - 1) * PageSize)
            .Take(PageSize)
            .Include(user => user.Subscriptions)
            .ToListAsync(cancellationToken);

        return new UserPage(
            total,
            page,
            PageSize,
            [.. rows.Select(user => new UserRow(user.Id, user.Email, user.DisplayName, user.CreatedAtUtc, SubscriptionAccessEvaluator.GetVisibleState(user), user.IsAdmin))]);
    }

    public Task<User?> LoadUserAsync(Guid id, CancellationToken cancellationToken) =>
        db.Users.Include(user => user.Subscriptions).FirstOrDefaultAsync(user => user.Id == id, cancellationToken);

    public async Task<UserDetail?> GetUserAsync(Guid id, CancellationToken cancellationToken)
    {
        var user = await LoadUserAsync(id, cancellationToken);
        if (user is null)
        {
            return null;
        }

        var invoices = await db.SubscriptionInvoices
            .Where(invoice => invoice.UserId == id)
            .OrderByDescending(invoice => invoice.PaidAtUtc ?? invoice.DebitScheduledAtUtc ?? invoice.CreatedAtUtc)
            .Take(24)
            .Select(invoice => new AdminInvoice(invoice.Id, invoice.Status, invoice.StatusDetail, invoice.Amount, invoice.CurrencyId, invoice.PaidAtUtc, invoice.DebitScheduledAtUtc, invoice.CreatedAtUtc, invoice.AttemptNumber))
            .ToListAsync(cancellationToken);

        var events = await db.SubscriptionEvents
            .Where(item => item.UserId == id)
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(60)
            .Select(item => new AdminEvent(item.Id, item.Topic, item.Action, item.ResultingStatus, item.Notes, item.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        var aiStatuses = await db.AiMetricResults
            .Where(item => item.UserId == id)
            .Select(item => item.Status)
            .ToListAsync(cancellationToken);

        var trialCountries = await db.TrialClaims
            .Where(item => item.UserId == id)
            .Select(item => item.CountryCode)
            .ToListAsync(cancellationToken);

        var tokens = await db.AiUsage
            .Where(item => item.UserId == id)
            .Select(item => (long)item.InputTokens + item.OutputTokens)
            .ToListAsync(cancellationToken);

        var notes = await db.AdminNotes
            .Where(item => item.UserId == id)
            .OrderByDescending(item => item.CreatedAtUtc)
            .Select(item => new AdminNoteDto(item.Id, item.AuthorEmail, item.Text, item.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        var usage = new UserUsage(
            await db.Analyses.CountAsync(item => item.UserId == id, cancellationToken),
            await db.SharedStories.CountAsync(item => item.UserId == id, cancellationToken),
            aiStatuses.Count,
            aiStatuses.Count(status => status == AiMetricStatus.Failed),
            await db.FreeMetricUnlocks.CountAsync(item => item.UserId == id, cancellationToken),
            trialCountries.Count,
            [.. trialCountries.Where(code => code is not null).Select(code => code!).Distinct()],
            tokens.Sum());

        var current = SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user);

        return new UserDetail(
            user.Id,
            user.Email,
            user.DisplayName,
            user.PreferredLanguage,
            user.CreatedAtUtc,
            user.IsAdmin,
            user.HasUsedTrial,
            user.AiConsentAtUtc,
            SubscriptionAccessEvaluator.GetVisibleState(user),
            SubscriptionAccessEvaluator.HasVipAccess(user),
            current is null ? null : AdminSubscription.From(current),
            [.. user.Subscriptions.OrderByDescending(item => item.CreatedAtUtc).Select(AdminSubscription.From)],
            invoices,
            events,
            usage,
            user.LastSeenAtUtc,
            notes);
    }
}

public static class UrgencyKinds
{
    public const string OrphanPayment = "orphan_payment";
    public const string WebhookRejected = "webhook_rejected";
    public const string PaymentPending = "payment_pending";
    public const string PaymentFailed = "payment_failed";
    public const string TrialEnding = "trial_ending";
    public const string TrialBlocked = "trial_blocked";
    public const string AiFailing = "ai_failing";
}

public static class UrgencySeverity
{
    public const string Critical = "critical";
    public const string Warning = "warning";
    public const string Info = "info";

    public static int Rank(string severity) => severity switch
    {
        Critical => 0,
        Warning => 1,
        _ => 2,
    };
}

public sealed record BusinessReport(
    int Days,
    int RegisteredUsers,
    int NewUsers,
    int NewUsersPrevious,
    int ProActive,
    int InTrial,
    int NewPro,
    decimal MonthlyRecurringRevenue,
    double? TrialConversion,
    double? TrialConversionPrevious,
    IReadOnlyList<int> SignupsByDay,
    IReadOnlyList<MonthTotal> CollectedByMonth,
    IReadOnlyList<LatestSubscription> LatestSubscriptions,
    int? ActiveUsers7,
    int? ActiveUsers30,
    long AiInputTokensMonth,
    long AiOutputTokensMonth,
    decimal? AiCostMonthUsd,
    FunnelReport Funnel,
    IReadOnlyList<ProMovement> ProMovements);

public sealed record MonthTotal(string Month, decimal Amount);

public sealed record ProMovement(string Month, int Started, int Cancelled);

/// <summary>Of the accounts created in the window: how many got to each step.</summary>
public sealed record FunnelReport(int Registered, int SavedAnalysis, int OpenedCheckout, int Paid);

public sealed record LatestSubscription(Guid UserId, string Email, string Status, decimal Amount, string CurrencyId, DateTime CreatedAtUtc);

/// <summary>
/// One thing that needs a look. <c>Reference</c> and <c>Detail</c> mean different things
/// per kind — a preapproval id and a topic, a metric and an error code — and the panel
/// words each kind itself.
/// </summary>
public sealed record Urgency(
    string Kind,
    string Severity,
    DateTime AtUtc,
    int Count,
    Guid? UserId,
    string? UserEmail,
    string? Reference,
    string? Detail,
    DateTime? DeadlineUtc);

public sealed record PaymentsHealth(
    DateTime InstanceStartedAtUtc,
    long NotificationsReceived,
    long NotificationsAccepted,
    long NotificationsRejected,
    DateTime? LastAcceptedAtUtc,
    int ReconcileIntervalMinutes,
    bool WebhookSecretConfigured,
    bool UsingTestCredentials,
    string? TestPayerEmail,
    string? SellerNickname,
    int RejectedLastDay);

public sealed record UrgencyReport(IReadOnlyList<Urgency> Items, PaymentsHealth Health);

public sealed record UserPage(int Total, int Page, int PageSize, IReadOnlyList<UserRow> Items);

public sealed record UserRow(Guid Id, string Email, string DisplayName, DateTime CreatedAtUtc, string State, bool IsAdmin);

public sealed record AdminSubscription(
    Guid Id,
    string Status,
    string PlanType,
    decimal Amount,
    string CurrencyId,
    string? PaymentMethodLabel,
    string? ExternalSubscriptionId,
    string? LastPaymentStatusDetail,
    DateTime? TrialEndsAtUtc,
    DateTime? NextBillingAtUtc,
    DateTime? GraceEndsAtUtc,
    DateTime? CancelledAtUtc,
    DateTime? LastSyncedAtUtc,
    DateTime CreatedAtUtc,
    bool IsSeededVip,
    bool IsDevSimulated)
{
    public static AdminSubscription From(Subscription item) =>
        new(item.Id, item.Status, item.PlanType, item.Amount, item.CurrencyId, item.PaymentMethodLabel, item.ExternalSubscriptionId,
            item.LastPaymentStatusDetail, item.TrialEndsAtUtc, item.NextBillingAtUtc, item.GraceEndsAtUtc, item.CancelledAtUtc,
            item.LastSyncedAtUtc, item.CreatedAtUtc, item.IsSeededVip, item.IsDevSimulated);
}

public sealed record AdminInvoice(
    Guid Id,
    string Status,
    string? StatusDetail,
    decimal Amount,
    string CurrencyId,
    DateTime? PaidAtUtc,
    DateTime? DebitScheduledAtUtc,
    DateTime CreatedAtUtc,
    int AttemptNumber);

/// <summary>The provider trail as recorded. Never the raw payload: that can carry the
/// payer's details, and nothing on this screen needs it.</summary>
public sealed record AdminEvent(Guid Id, string Topic, string? Action, string? ResultingStatus, string? Notes, DateTime CreatedAtUtc);

public sealed record AdminNoteDto(Guid Id, string AuthorEmail, string Text, DateTime CreatedAtUtc);

public sealed record UserUsage(
    int SavedAnalyses,
    int SharedStories,
    int AiMetrics,
    int AiMetricsFailed,
    int FreeUnlocks,
    int TrialClaims,
    IReadOnlyList<string> TrialCountries,
    long AiTokens = 0);

/// <summary>One account in full — never anything from inside a chat. The AI snippets
/// (<c>AiMetricResult.InputJson</c>) are message text and are deliberately left out.</summary>
public sealed record UserDetail(
    Guid Id,
    string Email,
    string DisplayName,
    string PreferredLanguage,
    DateTime CreatedAtUtc,
    bool IsAdmin,
    bool HasUsedTrial,
    DateTime? AiConsentAtUtc,
    string State,
    bool HasProAccess,
    AdminSubscription? Current,
    IReadOnlyList<AdminSubscription> Subscriptions,
    IReadOnlyList<AdminInvoice> Invoices,
    IReadOnlyList<AdminEvent> Events,
    UserUsage Usage,
    DateTime? LastSeenAtUtc,
    IReadOnlyList<AdminNoteDto> Notes);
