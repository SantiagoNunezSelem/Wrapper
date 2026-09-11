using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace backend.Tests.Services;

/// <summary>Las secciones secundarias del panel (Cobros, IA, Producto, Sistema) y los CSV.</summary>
public class AdminReportsServiceTests : IDisposable
{
    private static readonly DateTime Now = new(2026, 9, 10, 15, 0, 0, DateTimeKind.Utc);

    private readonly TestDb _db = TestDb.Create();

    public void Dispose() => _db.Dispose();

    private sealed class FakeEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "backend";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private AdminReportsService Service(MercadoPagoOptions? mp = null, GoogleAiOptions? ai = null, RecaptchaOptions? captcha = null) =>
        new(_db.Context, Opt.Of(mp ?? new MercadoPagoOptions()), Opt.Of(ai ?? new GoogleAiOptions()), Opt.Of(captcha ?? new RecaptchaOptions()), new FakeEnvironment());

    private User AddUser(string email, params Subscription[] subscriptions)
    {
        var user = new User { Email = email, DisplayName = "Cuenta" };
        user.Subscriptions.AddRange(subscriptions);
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user;
    }

    private void Save<T>(T entity) where T : class
    {
        _db.Context.Add(entity);
        _db.Context.SaveChanges();
    }

    // --- CSV ----------------------------------------------------------------

    [Fact]
    public void El_CSV_escapa_comas_comillas_y_saltos()
    {
        var csv = AdminReportsService.Csv(["a", "b"], [["x,y", "dijo \"hola\""], ["línea\nnueva", "ok"]]);

        Assert.StartsWith("﻿a,b\r\n", csv);
        Assert.Contains("\"x,y\",\"dijo \"\"hola\"\"\"", csv);
        Assert.Contains("\"línea\nnueva\",ok", csv);
    }

    [Theory]
    [InlineData("=HYPERLINK(\"http://x\")")]
    [InlineData("+54 11")]
    [InlineData("-1")]
    [InlineData("@SUM(A1)")]
    public void El_CSV_neutraliza_lo_que_Excel_ejecutaria_como_formula(string value)
    {
        // Un nombre como "=HYPERLINK(...)" se ejecuta al abrir el archivo en Excel o Sheets.
        var csv = AdminReportsService.Csv(["nombre"], [[value]]);

        Assert.Contains("'" + value.Replace("\"", "\"\""), csv);
    }

    [Fact]
    public async Task El_CSV_de_usuarios_trae_encabezado_y_una_fila_por_cuenta()
    {
        AddUser("lucia@example.com");

        var csv = await Service().ExportUsersCsvAsync(default);

        Assert.Contains("id,email,nombre,alta_utc,ultimo_ingreso_utc,estado,admin", csv);
        Assert.Contains("lucia@example.com", csv);
    }

    [Fact]
    public async Task El_CSV_de_cobros_trae_mail_monto_y_estado()
    {
        var subscription = new Subscription { Status = "activa" };
        var user = AddUser("martin@example.com", subscription);
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "p1", Status = "aprobado", Amount = 7800 });

        var csv = await Service().ExportInvoicesCsvAsync(default);

        Assert.Contains("martin@example.com,aprobado,,7800,ARS", csv);
    }

    // --- Cobros -------------------------------------------------------------

    [Fact]
    public async Task Cobros_pagina_filtra_por_estado_y_suma_lo_aprobado_del_mes()
    {
        var subscription = new Subscription { Status = "activa" };
        var user = AddUser("martin@example.com", subscription);
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "a", Status = "aprobado", Amount = 7800, PaidAtUtc = Now.AddDays(-2) });
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "b", Status = "rechazado", Amount = 7800 });
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "c", Status = "aprobado", Amount = 7800, PaidAtUtc = Now.AddDays(-40) });

        var all = await Service().GetInvoicesAsync(null, 1, Now, default);
        var rejected = await Service().GetInvoicesAsync("rechazado", 1, Now, default);

        Assert.Equal(3, all.Total);
        Assert.Equal(2, all.CountsByStatus["aprobado"]);
        Assert.Equal(7800m, all.ApprovedThisMonth);
        Assert.Equal("martin@example.com", Assert.Single(rejected.Items).Email);
    }

    // --- IA -----------------------------------------------------------------

    [Fact]
    public async Task IA_suma_tokens_por_dia_y_por_metrica_y_agrupa_errores()
    {
        var user = AddUser("a@example.com");
        Save(new AiUsage { UserId = user.Id, MetricId = "redflags", InputTokens = 100, OutputTokens = 10, Succeeded = true, CreatedAtUtc = Now.AddHours(-1) });
        Save(new AiUsage { UserId = user.Id, MetricId = "redflags", InputTokens = 50, OutputTokens = 5, Succeeded = false, CreatedAtUtc = Now.AddHours(-2) });
        Save(new AiUsage { UserId = user.Id, MetricId = "tonopicante", InputTokens = 1000, OutputTokens = 100, Succeeded = true, CreatedAtUtc = Now.AddDays(-2) });
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "h", MetricId = "tonopicante", Status = AiMetricStatus.Failed, ErrorCode = AiErrorCode.Quota, UpdatedAtUtc = Now.AddDays(-1) });

        var report = await Service().GetAiReportAsync(7, Now, default);

        Assert.True(report.Tracked);
        Assert.Equal(1150, report.InputTokens);
        Assert.Equal(115, report.OutputTokens);
        Assert.Equal(165, report.TokensByDay[^1]);
        Assert.Null(report.CostUsd);
        Assert.False(report.PricesConfigured);
        Assert.Equal("tonopicante", report.ByMetric[0].MetricId);
        var redflags = Assert.Single(report.ByMetric, item => item.MetricId == "redflags");
        Assert.Equal(2, redflags.Calls);
        Assert.Equal(1, redflags.FailedCalls);
        Assert.Equal(new CountByKey(AiErrorCode.Quota, 1), Assert.Single(report.ErrorsByCode));
    }

    [Fact]
    public async Task IA_sin_nada_registrado_lo_dice()
    {
        var report = await Service().GetAiReportAsync(30, Now, default);

        Assert.False(report.Tracked);
        Assert.Equal(30, report.TokensByDay.Count);
    }

    // --- Producto -----------------------------------------------------------

    [Fact]
    public async Task Producto_cuenta_analisis_desbloqueos_IA_e_historias()
    {
        var user = AddUser("a@example.com");
        Save(new SavedAnalysis { UserId = user.Id, ChatName = "a", SourceHash = "h1", CreatedAtUtc = Now.AddHours(-1) });
        Save(new FreeMetricUnlock { UserId = user.Id, MetricId = "ghosting", SourceHash = "h1", DayKeyUtc = "2026-09-10", CreatedAtUtc = Now.AddHours(-1) });
        Save(new FreeMetricUnlock { UserId = user.Id, MetricId = "ghosting", SourceHash = "h2", DayKeyUtc = "2026-09-10", CreatedAtUtc = Now.AddHours(-1) });
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "h1", MetricId = "redflags", Status = AiMetricStatus.Ready, UpdatedAtUtc = Now.AddHours(-1) });
        Save(new SharedStory { UserId = user.Id, Slug = "s1", SourceHash = "h1", CreatedAtUtc = Now.AddDays(-1), ExpiresAtUtc = Now.AddDays(10), ViewCount = 7 });

        var report = await Service().GetProductReportAsync(30, Now, default);

        Assert.Equal(1, report.AnalysesByDay[^1]);
        Assert.Equal(new CountByKey("ghosting", 2), Assert.Single(report.TopUnlocked));
        Assert.Equal(new CountByKey("redflags", 1), Assert.Single(report.TopAiMetrics));
        Assert.Equal(1, report.SharedInPeriod);
        Assert.Equal(1, report.LiveShares);
        Assert.Equal(7, report.LiveShareViews);
    }

    // --- Sistema ------------------------------------------------------------

    [Fact]
    public async Task Sistema_marca_cada_integracion_con_su_estado()
    {
        var mp = new MercadoPagoOptions { AccessToken = "APP_USR-1", BackUrl = "http://localhost:5173" };
        Save(new SubscriptionEvent { Topic = "checkout", Action = "no_trial", Notes = "trial denied: device_used", CreatedAtUtc = DateTime.UtcNow.AddDays(-1) });

        var report = await Service(mp).GetSystemReportAsync(new MercadoPagoAccount(1, "TESTUSER1"), [], DateTime.UtcNow, default);
        var state = report.Integrations.ToDictionary(item => item.Key, item => item.State);

        Assert.Equal("Testing", report.Environment);
        Assert.Equal(IntegrationStates.Warn, state["mercadopago"]);
        Assert.Equal("TESTUSER1", report.Integrations.Single(item => item.Key == "mercadopago").Value);
        Assert.Equal(IntegrationStates.Bad, state["webhook_secret"]);
        Assert.Equal(IntegrationStates.Warn, state["back_url"]);
        Assert.Equal(IntegrationStates.Ok, state["test_payer"]);
        Assert.Equal(IntegrationStates.Bad, state["google_ai"]);
        Assert.Equal(IntegrationStates.Off, state["ai_prices"]);
        Assert.Equal(IntegrationStates.Off, state["recaptcha"]);
        Assert.Equal(new CountByKey("device_used", 1), Assert.Single(report.TrialDenials30d));
    }

    [Fact]
    public async Task Sistema_sin_credenciales_de_Mercado_Pago_lo_marca_como_error()
    {
        var report = await Service().GetSystemReportAsync(null, [], DateTime.UtcNow, default);

        Assert.Equal(IntegrationStates.Bad, report.Integrations.Single(item => item.Key == "mercadopago").State);
    }
}
