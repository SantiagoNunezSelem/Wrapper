using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;

namespace backend.Tests.Services;

/// <summary>
/// Lo que lee el panel de administración. Todo con un "ahora" fijo, así que las ventanas
/// de tiempo (30 días, 24 horas, el corte en hora argentina) se prueban sin depender del
/// reloj de la máquina.
/// </summary>
public class AdminDashboardServiceTests : IDisposable
{
    private static readonly DateTime Now = new(2026, 9, 10, 15, 0, 0, DateTimeKind.Utc);

    private readonly TestDb _db = TestDb.Create();

    public void Dispose() => _db.Dispose();

    private AdminDashboardService Service(MercadoPagoOptions? options = null, MercadoPagoWebhookLog? log = null) =>
        new(_db.Context, Opt.Of(options ?? new MercadoPagoOptions()), log ?? new MercadoPagoWebhookLog());

    private User AddUser(DateTime? createdAt = null, string? email = null, string name = "Cuenta", params Subscription[] subscriptions)
    {
        var user = new User
        {
            Email = email ?? $"{Guid.NewGuid():N}@example.com",
            DisplayName = name,
            CreatedAtUtc = createdAt ?? Now.AddDays(-100),
        };
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

    // =======================================================================
    // Negocio
    // =======================================================================

    [Fact]
    public async Task Negocio_cuenta_registrados_y_altas_contra_el_periodo_anterior()
    {
        AddUser(Now.AddDays(-1));
        AddUser(Now.AddDays(-5));
        AddUser(Now.AddDays(-40));
        AddUser(Now.AddDays(-90));

        var report = await Service().GetBusinessAsync(30, Now, default);

        Assert.Equal(4, report.RegisteredUsers);
        Assert.Equal(2, report.NewUsers);
        Assert.Equal(1, report.NewUsersPrevious);
    }

    [Fact]
    public async Task Negocio_el_ingreso_suma_solo_suscripciones_reales_activas()
    {
        // El VIP sembrado del admin y el toggle de desarrollo no son clientes: contarlos
        // inflaría el ingreso con plata que nadie paga.
        AddUser(subscriptions: new Subscription { Status = "activa", Amount = 7800 });
        AddUser(subscriptions: new Subscription { Status = "activa", Amount = 7800 });
        AddUser(subscriptions: new Subscription { Status = "activa", Amount = 7800, IsSeededVip = true });
        AddUser(subscriptions: new Subscription { Status = "activa", Amount = 7800, IsDevSimulated = true });
        AddUser(subscriptions: new Subscription { Status = "trial", Amount = 7800 });

        var report = await Service().GetBusinessAsync(30, Now, default);

        Assert.Equal(2, report.ProActive);
        Assert.Equal(15600m, report.MonthlyRecurringRevenue);
        Assert.Equal(1, report.InTrial);
    }

    [Fact]
    public async Task Negocio_las_altas_por_dia_se_cortan_en_hora_argentina()
    {
        // 02:00 UTC del 10 son las 23:00 del 9 en Argentina: es un alta de ayer.
        AddUser(new DateTime(2026, 9, 10, 2, 0, 0, DateTimeKind.Utc));
        AddUser(new DateTime(2026, 9, 10, 4, 0, 0, DateTimeKind.Utc));

        var report = await Service().GetBusinessAsync(30, Now, default);

        Assert.Equal(30, report.SignupsByDay.Count);
        Assert.Equal(1, report.SignupsByDay[^1]);
        Assert.Equal(1, report.SignupsByDay[^2]);
    }

    [Fact]
    public async Task Negocio_la_conversion_es_nula_si_no_termino_ningun_trial()
    {
        // "0%" diría que todos los trials fracasaron; sin trials terminados no hay dato.
        var report = await Service().GetBusinessAsync(30, Now, default);

        Assert.Null(report.TrialConversion);
    }

    [Fact]
    public async Task Negocio_la_conversion_cuenta_los_trials_que_llegaron_a_un_cobro()
    {
        var converted = new Subscription { Status = "activa", TrialWasApplied = true, TrialEndsAtUtc = Now.AddDays(-3) };
        var lost = new Subscription { Status = "cancelada", TrialWasApplied = true, TrialEndsAtUtc = Now.AddDays(-3) };
        var user = AddUser(subscriptions: [converted, lost]);
        Save(new SubscriptionInvoice { SubscriptionId = converted.Id, UserId = user.Id, ExternalPaymentId = "p1", Status = "aprobado", Amount = 7800, PaidAtUtc = Now.AddDays(-3) });

        var report = await Service().GetBusinessAsync(30, Now, default);

        Assert.Equal(0.5, report.TrialConversion);
    }

    [Fact]
    public async Task Negocio_lo_cobrado_se_agrupa_por_mes_y_solo_cuenta_lo_aprobado()
    {
        var subscription = new Subscription { Status = "activa" };
        var user = AddUser(subscriptions: subscription);
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "a", Status = "aprobado", Amount = 7800, PaidAtUtc = new DateTime(2026, 9, 2, 12, 0, 0, DateTimeKind.Utc) });
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "b", Status = "aprobado", Amount = 7800, PaidAtUtc = new DateTime(2026, 8, 15, 12, 0, 0, DateTimeKind.Utc) });
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "c", Status = "rechazado", Amount = 7800, PaidAtUtc = new DateTime(2026, 9, 3, 12, 0, 0, DateTimeKind.Utc) });

        var months = (await Service().GetBusinessAsync(30, Now, default)).CollectedByMonth;

        Assert.Equal(6, months.Count);
        Assert.Equal(new MonthTotal("2026-09", 7800m), months[^1]);
        Assert.Equal(new MonthTotal("2026-08", 7800m), months[^2]);
        Assert.Equal("2026-04", months[0].Month);
    }

    [Fact]
    public async Task Negocio_las_ultimas_suscripciones_traen_el_mail_y_excluyen_el_vip_sembrado()
    {
        AddUser(email: "lucia@example.com", subscriptions: new Subscription { Status = "activa", Amount = 7800 });
        AddUser(subscriptions: new Subscription { Status = "activa", IsSeededVip = true });

        var latest = (await Service().GetBusinessAsync(30, Now, default)).LatestSubscriptions;

        Assert.Equal("lucia@example.com", Assert.Single(latest).Email);
    }

    // =======================================================================
    // Urgencias
    // =======================================================================

    [Fact]
    public async Task Urgencias_un_cobro_sin_cuenta_es_critico_y_va_antes_que_todo()
    {
        AddUser(subscriptions: new Subscription { Status = "pago_fallido", LastPaymentStatusDetail = "cc_rejected_insufficient_amount", GraceEndsAtUtc = Now.AddDays(2) });
        Save(new SubscriptionEvent { Topic = "subscription_preapproval", ExternalSubscriptionId = "pre-x", Notes = "No matching local subscription.", CreatedAtUtc = Now.AddHours(-1) });

        var items = (await Service().GetUrgenciesAsync(Now, default)).Items;

        Assert.Equal(UrgencyKinds.OrphanPayment, items[0].Kind);
        Assert.Equal(UrgencySeverity.Critical, items[0].Severity);
        Assert.Equal("pre-x", items[0].Reference);
        Assert.Equal(UrgencyKinds.PaymentFailed, items[1].Kind);
        Assert.Equal(Now.AddDays(2), items[1].DeadlineUtc);
    }

    [Fact]
    public async Task Urgencias_un_checkout_abandonado_no_es_urgente_pero_un_pago_trabado_si()
    {
        AddUser(email: "abandono@example.com", subscriptions: new Subscription { Status = "pendiente", CreatedAtUtc = Now.AddHours(-5) });
        AddUser(email: "trabado@example.com", subscriptions: new Subscription { Status = "pendiente", LastPaymentStatusDetail = "pending_contingency", CreatedAtUtc = Now.AddHours(-5) });
        AddUser(email: "reciente@example.com", subscriptions: new Subscription { Status = "pendiente", LastPaymentStatusDetail = "pending_contingency", CreatedAtUtc = Now.AddMinutes(-30) });
        AddUser(email: "rechazado@example.com", subscriptions: new Subscription { Status = "pendiente", LastPaymentStatusDetail = "cc_rejected_other_reason", CreatedAtUtc = Now.AddHours(-5) });

        var pending = (await Service().GetUrgenciesAsync(Now, default)).Items
            .Where(item => item.Kind == UrgencyKinds.PaymentPending)
            .ToList();

        Assert.Equal("trabado@example.com", Assert.Single(pending).UserEmail);
    }

    [Fact]
    public async Task Urgencias_un_trial_negado_por_cuenta_repetida_no_cuenta_como_abuso()
    {
        Save(new SubscriptionEvent { Topic = "checkout", Action = "no_trial", Notes = "trial denied: account_used", CreatedAtUtc = Now.AddHours(-2) });
        Save(new SubscriptionEvent { Topic = "checkout", Action = "no_trial", Notes = "trial denied: device_used", CreatedAtUtc = Now.AddHours(-2) });
        Save(new SubscriptionEvent { Topic = "checkout", Action = "no_trial", Notes = "trial denied: device_used", CreatedAtUtc = Now.AddHours(-3) });
        Save(new SubscriptionEvent { Topic = "checkout", Action = "no_trial", Notes = "trial denied: ip_used", CreatedAtUtc = Now.AddDays(-3) });

        var blocked = Assert.Single((await Service().GetUrgenciesAsync(Now, default)).Items, item => item.Kind == UrgencyKinds.TrialBlocked);

        Assert.Equal("device_used", blocked.Detail);
        Assert.Equal(2, blocked.Count);
    }

    [Fact]
    public async Task Urgencias_los_errores_de_IA_se_agrupan_por_metrica_y_codigo()
    {
        var user = AddUser();
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "a", MetricId = "tonopicante", Status = AiMetricStatus.Failed, ErrorCode = AiErrorCode.Blocked, UpdatedAtUtc = Now.AddHours(-1) });
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "b", MetricId = "tonopicante", Status = AiMetricStatus.Failed, ErrorCode = AiErrorCode.Blocked, UpdatedAtUtc = Now.AddHours(-2) });
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "c", MetricId = "redflags", Status = AiMetricStatus.Ready, UpdatedAtUtc = Now.AddHours(-1) });

        var failing = Assert.Single((await Service().GetUrgenciesAsync(Now, default)).Items, item => item.Kind == UrgencyKinds.AiFailing);

        Assert.Equal("tonopicante", failing.Reference);
        Assert.Equal(AiErrorCode.Blocked, failing.Detail);
        Assert.Equal(2, failing.Count);
    }

    [Fact]
    public async Task Urgencias_los_avisos_rechazados_salen_del_registro_y_la_salud_lo_refleja()
    {
        var log = new MercadoPagoWebhookLog();
        log.Record(WebhookOutcomes.Rejected, "payment", "1", "Signature mismatch.");
        log.Record(WebhookOutcomes.Accepted, "payment", "2", null);
        var options = new MercadoPagoOptions { AccessToken = "TEST-1", TestPayerEmail = "test_user_1@testuser.com", WebhookSecret = "s" };

        var report = await Service(options, log).GetUrgenciesAsync(DateTime.UtcNow, default);

        var rejected = Assert.Single(report.Items, item => item.Kind == UrgencyKinds.WebhookRejected);
        Assert.Equal("Signature mismatch.", rejected.Detail);
        Assert.Equal(1, report.Health.NotificationsRejected);
        Assert.Equal(1, report.Health.NotificationsAccepted);
        Assert.True(report.Health.UsingTestCredentials);
        Assert.True(report.Health.WebhookSecretConfigured);
        Assert.Equal("test_user_1@testuser.com", report.Health.TestPayerEmail);
    }

    [Fact]
    public async Task Urgencias_sin_nada_raro_la_bandeja_esta_vacia()
    {
        AddUser(subscriptions: new Subscription { Status = "activa" });

        var report = await Service().GetUrgenciesAsync(Now, default);

        Assert.Empty(report.Items);
        Assert.Null(report.Health.TestPayerEmail);
    }

    // =======================================================================
    // Usuarios
    // =======================================================================

    [Fact]
    public async Task Usuarios_se_buscan_por_mail_por_nombre_o_por_id_de_Mercado_Pago()
    {
        AddUser(email: "lucia@example.com", name: "Lucia Fernandez");
        AddUser(email: "martin@example.com", name: "Martin", subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-9" });

        var service = Service();

        Assert.Equal("lucia@example.com", Assert.Single((await service.SearchUsersAsync("LUCIA", 1, default)).Items).Email);
        Assert.Equal("lucia@example.com", Assert.Single((await service.SearchUsersAsync("fernandez", 1, default)).Items).Email);
        Assert.Equal("martin@example.com", Assert.Single((await service.SearchUsersAsync(" pre-9 ", 1, default)).Items).Email);
        Assert.Equal(2, (await service.SearchUsersAsync(null, 1, default)).Total);
    }

    [Fact]
    public async Task Usuarios_se_paginan_de_a_veinte()
    {
        for (var i = 0; i < 25; i++)
        {
            AddUser(Now.AddMinutes(-i));
        }

        var service = Service();
        var first = await service.SearchUsersAsync(null, 1, default);
        var second = await service.SearchUsersAsync(null, 2, default);

        Assert.Equal(25, first.Total);
        Assert.Equal(20, first.Items.Count);
        Assert.Equal(5, second.Items.Count);
    }

    [Fact]
    public async Task Usuarios_la_ficha_trae_cobros_actividad_y_uso()
    {
        var subscription = new Subscription { Status = "activa", Amount = 7800, ExternalSubscriptionId = "pre-1", NextBillingAtUtc = DateTime.UtcNow.AddDays(10) };
        var user = AddUser(email: "martin@example.com", subscriptions: subscription);
        Save(new SubscriptionInvoice { SubscriptionId = subscription.Id, UserId = user.Id, ExternalPaymentId = "p1", Status = "aprobado", Amount = 7800 });
        Save(new SubscriptionEvent { UserId = user.Id, SubscriptionId = subscription.Id, Topic = "subscription_preapproval", Action = "updated", ResultingStatus = "activa" });
        Save(new SavedAnalysis { UserId = user.Id, ChatName = "Grupo", SourceHash = "h1" });
        Save(new SharedStory { UserId = user.Id, Slug = "abc123", SourceHash = "h1", ExpiresAtUtc = DateTime.UtcNow.AddDays(30) });
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "h1", MetricId = "redflags", Status = AiMetricStatus.Ready });
        Save(new AiMetricResult { UserId = user.Id, SourceHash = "h1", MetricId = "tonopicante", Status = AiMetricStatus.Failed });
        Save(new TrialClaim { UserId = user.Id, CountryCode = "AR" });

        var detail = await Service().GetUserAsync(user.Id, default);

        Assert.NotNull(detail);
        Assert.Equal("martin@example.com", detail.Email);
        Assert.Equal("activa", detail.Current?.Status);
        Assert.True(detail.HasProAccess);
        Assert.Single(detail.Invoices);
        Assert.Equal("subscription_preapproval", Assert.Single(detail.Events).Topic);
        Assert.Equal(new UserUsage(1, 1, 2, 1, 0, 1, ["AR"]).SavedAnalyses, detail.Usage.SavedAnalyses);
        Assert.Equal(2, detail.Usage.AiMetrics);
        Assert.Equal(1, detail.Usage.AiMetricsFailed);
        Assert.Equal(["AR"], detail.Usage.TrialCountries);
    }

    [Fact]
    public async Task Usuarios_un_id_desconocido_no_tiene_ficha()
    {
        Assert.Null(await Service().GetUserAsync(Guid.NewGuid(), default));
    }
}
