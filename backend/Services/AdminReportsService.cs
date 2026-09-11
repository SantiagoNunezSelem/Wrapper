using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text;
using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// The panel's secondary sections — Cobros, IA, Producto, Sistema — and the CSV exports.
/// Read-only, and every list is bounded: by a page, or by the time window asked for.
/// </summary>
public sealed class AdminReportsService(
    AppDbContext db,
    IOptions<MercadoPagoOptions> mercadoPago,
    IOptions<GoogleAiOptions> googleAi,
    IOptions<RecaptchaOptions> recaptcha,
    IHostEnvironment environment)
{
    public const int PageSize = 25;
    private const string TrialDeniedPrefix = "trial denied: ";

    private static int[] Buckets<T>(IEnumerable<T> rows, Func<T, DateTime> moment, Func<T, int> weight, int days, DateTime now)
    {
        var today = AdminDashboardService.Local(now).Date;
        var buckets = new int[days];
        foreach (var row in rows)
        {
            var index = days - 1 - (today - AdminDashboardService.Local(moment(row)).Date).Days;
            if (index >= 0 && index < days)
            {
                buckets[index] += weight(row);
            }
        }

        return buckets;
    }

    // ---------------------------------------------------------------------------
    // Cobros
    // ---------------------------------------------------------------------------

    public async Task<InvoicePage> GetInvoicesAsync(string? status, int page, DateTime now, CancellationToken cancellationToken)
    {
        page = Math.Max(1, page);
        var invoices = db.SubscriptionInvoices.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
        {
            invoices = invoices.Where(item => item.Status == status);
        }

        var total = await invoices.CountAsync(cancellationToken);
        var rows = await invoices
            .OrderByDescending(item => item.PaidAtUtc ?? item.DebitScheduledAtUtc ?? item.CreatedAtUtc)
            .Skip((page - 1) * PageSize)
            .Take(PageSize)
            .Join(
                db.Users,
                invoice => invoice.UserId,
                user => user.Id,
                (invoice, user) => new InvoiceRow(
                    invoice.Id, invoice.UserId, user.Email, invoice.Status, invoice.StatusDetail, invoice.Amount,
                    invoice.CurrencyId, invoice.PaidAtUtc, invoice.DebitScheduledAtUtc, invoice.CreatedAtUtc, invoice.AttemptNumber))
            .ToListAsync(cancellationToken);

        var counts = await db.SubscriptionInvoices
            .GroupBy(item => item.Status)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var monthStart = AdminDashboardService.MonthStartUtc(now);
        var approved = await db.SubscriptionInvoices
            .Where(item => item.Status == "aprobado" && item.PaidAtUtc >= monthStart)
            .Select(item => item.Amount)
            .ToListAsync(cancellationToken);

        return new InvoicePage(
            total,
            page,
            PageSize,
            rows,
            counts.ToDictionary(item => item.Key ?? "?", item => item.Count),
            approved.Sum());
    }

    // ---------------------------------------------------------------------------
    // IA
    // ---------------------------------------------------------------------------

    public async Task<AiReport> GetAiReportAsync(int days, DateTime now, CancellationToken cancellationToken)
    {
        days = Math.Clamp(days, 7, 90);
        var from = now.AddDays(-days);
        var prices = googleAi.Value;

        var usage = await db.AiUsage
            .Where(item => item.CreatedAtUtc >= from)
            .Select(item => new { item.MetricId, item.InputTokens, item.OutputTokens, item.Succeeded, item.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        var errors = await db.AiMetricResults
            .Where(item => item.Status == AiMetricStatus.Failed && item.UpdatedAtUtc >= from)
            .GroupBy(item => item.ErrorCode)
            .Select(group => new { group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        long input = usage.Sum(item => (long)item.InputTokens);
        long output = usage.Sum(item => (long)item.OutputTokens);

        return new AiReport(
            days,
            await db.AiUsage.AnyAsync(cancellationToken),
            prices.Model,
            prices.InputPricePerMillionUsd > 0 || prices.OutputPricePerMillionUsd > 0,
            input,
            output,
            AdminDashboardService.CostUsd(input, output, prices),
            Buckets(usage, item => item.CreatedAtUtc, item => item.InputTokens + item.OutputTokens, days, now),
            [.. usage
                .GroupBy(item => item.MetricId)
                .Select(group => new AiMetricUsage(
                    group.Key,
                    group.Count(),
                    group.Count(item => !item.Succeeded),
                    group.Sum(item => (long)item.InputTokens),
                    group.Sum(item => (long)item.OutputTokens)))
                .OrderByDescending(item => item.InputTokens + item.OutputTokens)],
            [.. errors.Select(item => new CountByKey(item.Key ?? AiErrorCode.Unknown, item.Count)).OrderByDescending(item => item.Count)]);
    }

    // ---------------------------------------------------------------------------
    // Producto
    // ---------------------------------------------------------------------------

    public async Task<ProductReport> GetProductReportAsync(int days, DateTime now, CancellationToken cancellationToken)
    {
        days = Math.Clamp(days, 7, 90);
        var from = now.AddDays(-days);

        var analyses = await db.Analyses
            .Where(item => item.CreatedAtUtc >= from)
            .Select(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var unlocked = await db.FreeMetricUnlocks
            .Where(item => item.CreatedAtUtc >= from)
            .GroupBy(item => item.MetricId)
            .Select(group => new { group.Key, Count = group.Count() })
            .OrderByDescending(item => item.Count)
            .Take(10)
            .ToListAsync(cancellationToken);

        var aiMetrics = await db.AiMetricResults
            .Where(item => item.Status == AiMetricStatus.Ready && item.UpdatedAtUtc >= from)
            .GroupBy(item => item.MetricId)
            .Select(group => new { group.Key, Count = group.Count() })
            .OrderByDescending(item => item.Count)
            .Take(10)
            .ToListAsync(cancellationToken);

        return new ProductReport(
            days,
            Buckets(analyses, moment => moment, _ => 1, days, now),
            [.. unlocked.Select(item => new CountByKey(item.Key, item.Count))],
            [.. aiMetrics.Select(item => new CountByKey(item.Key, item.Count))],
            await db.SharedStories.CountAsync(item => item.CreatedAtUtc >= from, cancellationToken),
            await db.SharedStories.CountAsync(item => item.ExpiresAtUtc > now, cancellationToken),
            await db.SharedStories.Where(item => item.ExpiresAtUtc > now).SumAsync(item => (long)item.ViewCount, cancellationToken));
    }

    // ---------------------------------------------------------------------------
    // Sistema
    // ---------------------------------------------------------------------------

    public async Task<SystemReport> GetSystemReportAsync(
        MercadoPagoAccount? seller,
        IReadOnlyList<AdminAuditDto> audit,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var mp = mercadoPago.Value;
        var ai = googleAi.Value;
        var captcha = recaptcha.Value;

        var integrations = new List<IntegrationStatus>
        {
            !mp.IsConfigured
                ? new("mercadopago", IntegrationStates.Bad, null)
                : mp.IsTestCredential || seller?.IsTestUser == true
                    ? new("mercadopago", IntegrationStates.Warn, seller?.Nickname ?? "TEST-")
                    : new("mercadopago", IntegrationStates.Ok, seller?.Nickname),
            new("webhook_secret", string.IsNullOrWhiteSpace(mp.WebhookSecret) ? IntegrationStates.Bad : IntegrationStates.Ok, null),
            new("back_url", mp.HasPublicBackUrl ? IntegrationStates.Ok : IntegrationStates.Warn, mp.BackUrl),
            new("test_payer", string.IsNullOrWhiteSpace(mp.TestPayerEmail) ? IntegrationStates.Ok : IntegrationStates.Warn, mp.TestPayerEmail is { Length: > 0 } email ? email : null),
            new("google_ai", ai.IsConfigured ? IntegrationStates.Ok : IntegrationStates.Bad, ai.Model),
            new("ai_prices", ai.InputPricePerMillionUsd > 0 || ai.OutputPricePerMillionUsd > 0 ? IntegrationStates.Ok : IntegrationStates.Off, null),
            new("recaptcha", captcha.IsConfigured ? IntegrationStates.Ok : captcha.IsPartiallyConfigured ? IntegrationStates.Bad : IntegrationStates.Off, null),
        };

        var denials = await db.SubscriptionEvents
            .Where(item => item.Topic == "checkout" && item.Action == "no_trial" && item.Notes != null && item.CreatedAtUtc >= now.AddDays(-30))
            .Select(item => item.Notes!)
            .ToListAsync(cancellationToken);

        // Railway stamps the deployed commit into the environment; locally there is none,
        // and the assembly's informational version is the next best thing.
        var commit = Environment.GetEnvironmentVariable("RAILWAY_GIT_COMMIT_SHA");
        var version = commit is { Length: >= 7 }
            ? commit[..7]
            : Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;

        return new SystemReport(
            environment.EnvironmentName,
            version,
            Process.GetCurrentProcess().StartTime.ToUniversalTime(),
            integrations,
            [.. denials
                .Where(note => note.StartsWith(TrialDeniedPrefix, StringComparison.Ordinal))
                .GroupBy(note => note[TrialDeniedPrefix.Length..])
                .Select(group => new CountByKey(group.Key, group.Count()))
                .OrderByDescending(item => item.Count)],
            audit);
    }

    // ---------------------------------------------------------------------------
    // CSV
    // ---------------------------------------------------------------------------

    public async Task<string> ExportUsersCsvAsync(CancellationToken cancellationToken)
    {
        var users = await db.Users
            .Include(user => user.Subscriptions)
            .OrderByDescending(user => user.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return Csv(
            ["id", "email", "nombre", "alta_utc", "ultimo_ingreso_utc", "estado", "admin"],
            users.Select(user => new[]
            {
                user.Id.ToString(),
                user.Email,
                user.DisplayName,
                Iso(user.CreatedAtUtc),
                Iso(user.LastSeenAtUtc),
                SubscriptionAccessEvaluator.GetVisibleState(user),
                user.IsAdmin ? "si" : "no",
            }));
    }

    public async Task<string> ExportInvoicesCsvAsync(CancellationToken cancellationToken)
    {
        var rows = await db.SubscriptionInvoices
            .OrderByDescending(item => item.CreatedAtUtc)
            .Join(db.Users, invoice => invoice.UserId, user => user.Id, (invoice, user) => new { invoice, user.Email })
            .ToListAsync(cancellationToken);

        return Csv(
            ["id", "email", "estado", "detalle", "monto", "moneda", "intento", "pagado_utc", "debito_utc", "creado_utc"],
            rows.Select(item => new[]
            {
                item.invoice.Id.ToString(),
                item.Email,
                item.invoice.Status,
                item.invoice.StatusDetail,
                item.invoice.Amount.ToString(CultureInfo.InvariantCulture),
                item.invoice.CurrencyId,
                item.invoice.AttemptNumber.ToString(CultureInfo.InvariantCulture),
                Iso(item.invoice.PaidAtUtc),
                Iso(item.invoice.DebitScheduledAtUtc),
                Iso(item.invoice.CreatedAtUtc),
            }));
    }

    private static string Iso(DateTime? value) =>
        value is { } moment ? moment.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture) : string.Empty;

    /// <summary>
    /// RFC 4180 quoting, plus a guard against formula injection: a name or mail starting
    /// with <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c> is run as a formula by Excel and Sheets
    /// the moment the file is opened, so it is prefixed with a quote and stays text. The BOM
    /// makes Excel read the accents as UTF-8 instead of mangling them.
    /// </summary>
    public static string Csv(IReadOnlyList<string> header, IEnumerable<IReadOnlyList<string?>> rows)
    {
        static string Cell(string? value)
        {
            var text = value ?? string.Empty;
            if (text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
            {
                text = "'" + text;
            }

            return text.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{text.Replace("\"", "\"\"")}\"" : text;
        }

        var builder = new StringBuilder("﻿");
        builder.AppendJoin(',', header.Select(Cell)).Append("\r\n");
        foreach (var row in rows)
        {
            builder.AppendJoin(',', row.Select(Cell)).Append("\r\n");
        }

        return builder.ToString();
    }
}

public static class IntegrationStates
{
    public const string Ok = "ok";
    public const string Warn = "warn";
    public const string Bad = "bad";
    public const string Off = "off";
}

public sealed record InvoiceRow(
    Guid Id,
    Guid UserId,
    string Email,
    string Status,
    string? StatusDetail,
    decimal Amount,
    string CurrencyId,
    DateTime? PaidAtUtc,
    DateTime? DebitScheduledAtUtc,
    DateTime CreatedAtUtc,
    int AttemptNumber);

public sealed record InvoicePage(
    int Total,
    int Page,
    int PageSize,
    IReadOnlyList<InvoiceRow> Items,
    IReadOnlyDictionary<string, int> CountsByStatus,
    decimal ApprovedThisMonth);

public sealed record CountByKey(string Key, int Count);

public sealed record AiMetricUsage(string MetricId, int Calls, int FailedCalls, long InputTokens, long OutputTokens);

public sealed record AiReport(
    int Days,
    bool Tracked,
    string Model,
    bool PricesConfigured,
    long InputTokens,
    long OutputTokens,
    decimal? CostUsd,
    IReadOnlyList<int> TokensByDay,
    IReadOnlyList<AiMetricUsage> ByMetric,
    IReadOnlyList<CountByKey> ErrorsByCode);

public sealed record ProductReport(
    int Days,
    IReadOnlyList<int> AnalysesByDay,
    IReadOnlyList<CountByKey> TopUnlocked,
    IReadOnlyList<CountByKey> TopAiMetrics,
    int SharedInPeriod,
    int LiveShares,
    long LiveShareViews);

public sealed record IntegrationStatus(string Key, string State, string? Value);

public sealed record SystemReport(
    string Environment,
    string? Version,
    DateTime StartedAtUtc,
    IReadOnlyList<IntegrationStatus> Integrations,
    IReadOnlyList<CountByKey> TrialDenials30d,
    IReadOnlyList<AdminAuditDto> Audit);
