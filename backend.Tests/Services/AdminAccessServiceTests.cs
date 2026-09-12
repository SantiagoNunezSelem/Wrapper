using System.Net;
using System.Text;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// Las acciones de acceso del panel: dar Pro sin cobro, quitarlo y devolver la semana
/// gratis. Lo que más importa es lo que no se ve: que quitar el Pro no deje a nadie pagando
/// algo que no puede usar, y que ningún aviso tardío de Mercado Pago lo devuelva.
/// </summary>
public class AdminAccessServiceTests : IDisposable
{
    private static readonly Guid AdminId = Guid.NewGuid();
    private const string AdminEmail = "admin@example.com";

    private readonly TestDb _db = TestDb.Create();
    private readonly StubHttpMessageHandler _http = new();

    public void Dispose() => _db.Dispose();

    private TrialEligibilityService Trials(TrialGuardOptions? options = null)
    {
        var settings = options ?? new TrialGuardOptions();
        return new TrialEligibilityService(
            _db.Context,
            new ClientFingerprint(Opt.Of(settings), Opt.Of(new JwtOptions())),
            Opt.Of(settings),
            NullLogger<TrialEligibilityService>.Instance);
    }

    private SubscriptionService Subscriptions()
    {
        var settings = new MercadoPagoOptions { AccessToken = "TEST-123" };
        var client = new MercadoPagoClient(_http.CreateClient(), Opt.Of(settings), NullLogger<MercadoPagoClient>.Instance);
        return new SubscriptionService(_db.Context, client, Trials(), Opt.Of(settings), NullLogger<SubscriptionService>.Instance);
    }

    private AdminAccessService Service() => new(Subscriptions(), Trials(), new AdminAuditService(_db.Context));

    private User CreateUser(bool isAdmin = false, bool hasUsedTrial = false, params Subscription[] subscriptions)
    {
        var user = new User
        {
            Email = $"{Guid.NewGuid():N}@example.com",
            DisplayName = "Test",
            IsAdmin = isAdmin,
            HasUsedTrial = hasUsedTrial,
        };
        user.Subscriptions.AddRange(subscriptions);
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user;
    }

    private static Subscription Paid(string status = "activa") => new()
    {
        Status = status,
        PaymentProvider = "mercadopago",
        NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
        ExternalSubscriptionId = "pre-1",
        // Una suscripción que cobró tiene la fecha del cobro. No es adorno: sin ella
        // la fila es indistinguible de un checkout rechazado, y las fechas que proyecta
        // Mercado Pago sobre una que nunca cobró se descartan a propósito.
        LastPaymentAtUtc = DateTime.UtcNow.AddDays(-10),
    };

    /// <summary>La preapproval para cualquier lectura o escritura de /preapproval; listas vacías para las búsquedas.</summary>
    private void MercadoPagoAnswers(string preapproval) =>
        _http.Route(request => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                request.RequestUri!.AbsolutePath.Contains("/search") ? """{"results":[]}""" : preapproval,
                Encoding.UTF8,
                "application/json"),
        });

    private static string Cancelled(DateTime next) =>
        $$"""{"id":"pre-1","status":"cancelled","next_payment_date":"{{next:yyyy-MM-ddTHH:mm:ssZ}}"}""";

    // -----------------------------------------------------------------------
    // Reglas de acceso
    // -----------------------------------------------------------------------

    [Fact]
    public void El_Pro_de_regalo_da_acceso_hasta_su_fecha_y_no_despues()
    {
        var vigente = new User { VipUntilUtc = DateTime.UtcNow.AddDays(3) };
        var vencido = new User { VipUntilUtc = DateTime.UtcNow.AddDays(-1) };

        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(vigente));
        Assert.Equal("activa", SubscriptionAccessEvaluator.GetVisibleState(vigente));
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(vencido));
        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(vencido));
    }

    [Fact]
    public void Con_Pro_de_regalo_una_suscripcion_vieja_no_le_cambia_el_rotulo()
    {
        var user = new User { VipUntilUtc = DateTime.UtcNow.AddDays(3) };
        user.Subscriptions.Add(new Subscription { Status = "cancelada", NextBillingAtUtc = DateTime.UtcNow.AddDays(-5) });

        Assert.Equal("activa", SubscriptionAccessEvaluator.GetVisibleState(user));
    }

    [Fact]
    public void Una_fila_revocada_no_da_acceso_aunque_diga_activa()
    {
        // Es lo que deja un webhook tardío: estado y fechas reescritos. La revocación no se toca.
        var revoked = new Subscription
        {
            Status = "activa",
            ExternalSubscriptionId = "pre-1",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            AccessRevokedAtUtc = DateTime.UtcNow.AddMinutes(-5),
        };

        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(revoked));
        Assert.False(SubscriptionAccessEvaluator.BillsAtProvider(revoked));
    }

    [Theory]
    [InlineData("activa", true)]
    [InlineData("trial", true)]
    [InlineData("pago_fallido", true)]
    [InlineData("pausada", true)]
    [InlineData("cancelada", false)]
    [InlineData("pendiente", false)]
    public void Cobra_en_Mercado_Pago_solo_lo_vinculado_y_vivo(string status, bool bills)
    {
        Assert.Equal(bills, SubscriptionAccessEvaluator.BillsAtProvider(new Subscription { Status = status, ExternalSubscriptionId = "pre-1" }));
        Assert.False(SubscriptionAccessEvaluator.BillsAtProvider(new Subscription { Status = status }));
        Assert.False(SubscriptionAccessEvaluator.BillsAtProvider(
            new Subscription { Status = status, ExternalSubscriptionId = "pre-1", IsDevSimulated = true }));
    }

    [Fact]
    public void Un_pendiente_con_un_cobro_en_camino_cuenta_como_que_cobra()
    {
        Assert.True(SubscriptionAccessEvaluator.BillsAtProvider(new Subscription
        {
            Status = "pendiente",
            ExternalSubscriptionId = "pre-1",
            LastPaymentStatusDetail = "pending_contingency",
        }));
    }

    // -----------------------------------------------------------------------
    // Dar VIP
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Dar_VIP_da_Pro_por_los_dias_elegidos_y_deja_rastro()
    {
        var user = CreateUser();

        await Service().GrantVipAsync(user, 30, AdminId, AdminEmail, default);

        var stored = await _db.NewContext().Users.SingleAsync(item => item.Id == user.Id);
        Assert.InRange(stored.VipUntilUtc!.Value, DateTime.UtcNow.AddDays(29.9), DateTime.UtcNow.AddDays(30.1));
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(stored));

        var trail = await _db.NewContext().AdminAuditEvents.SingleAsync();
        Assert.Equal(AdminActions.GrantVip, trail.Action);
        Assert.Equal(user.Id, trail.TargetUserId);
        Assert.StartsWith("30 días", trail.Details);
    }

    [Fact]
    public async Task Un_segundo_VIP_se_suma_al_que_ya_tenia()
    {
        var end = DateTime.UtcNow.AddDays(10);
        var user = CreateUser();
        user.VipUntilUtc = end;

        await Service().GrantVipAsync(user, 7, AdminId, AdminEmail, default);

        Assert.Equal(end.AddDays(7), user.VipUntilUtc);
    }

    [Fact]
    public async Task VIP_sin_vencimiento_usa_la_misma_fecha_que_el_VIP_sembrado()
    {
        var user = CreateUser();

        await Service().GrantVipAsync(user, null, AdminId, AdminEmail, default);

        Assert.Equal(AdminAccessService.Forever, user.VipUntilUtc);
        Assert.Equal("sin vencimiento", (await _db.NewContext().AdminAuditEvents.SingleAsync()).Details);
    }

    [Fact]
    public async Task Sumar_dias_a_un_VIP_sin_vencimiento_no_pasa_del_tope()
    {
        var user = CreateUser();
        user.VipUntilUtc = AdminAccessService.Forever;

        await Service().GrantVipAsync(user, 90, AdminId, AdminEmail, default);

        Assert.Equal(AdminAccessService.Forever, user.VipUntilUtc);
    }

    [Fact]
    public async Task No_se_da_VIP_encima_de_una_suscripcion_que_Mercado_Pago_cobra()
    {
        // No frenaría ni un cobro; sólo taparía la fila que los hace.
        var user = CreateUser(subscriptions: Paid());

        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().GrantVipAsync(user, 30, AdminId, AdminEmail, default));

        Assert.Equal("paid_active", error.Code);
        Assert.Null(user.VipUntilUtc);
        Assert.Empty(_db.NewContext().AdminAuditEvents);
    }

    [Fact]
    public async Task Con_la_renovacion_cancelada_si_se_puede_dar_VIP()
    {
        var user = CreateUser(subscriptions: Paid("cancelada"));

        await Service().GrantVipAsync(user, 30, AdminId, AdminEmail, default);

        Assert.NotNull(user.VipUntilUtc);
    }

    [Fact]
    public async Task A_un_admin_no_se_le_toca_el_acceso()
    {
        var user = CreateUser(isAdmin: true);

        Assert.Equal("admin", (await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().GrantVipAsync(user, 30, AdminId, AdminEmail, default))).Code);
        Assert.Equal("admin", (await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().RevokeVipAsync(user, AdminId, AdminEmail, default))).Code);
        Assert.Equal("admin", (await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().GrantTrialAsync(user, AdminId, AdminEmail, default))).Code);
    }

    [Fact]
    public async Task Con_Pro_de_regalo_no_se_puede_abrir_un_checkout()
    {
        // Sería pagar por días que ya tiene, lo mismo que comprar con la renovación cancelada.
        var user = CreateUser();
        user.VipUntilUtc = DateTime.UtcNow.AddDays(5);

        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Subscriptions().StartCheckoutAsync(user, new DefaultHttpContext(), null, default));

        Assert.Equal("already_active", error.Code);
        Assert.Empty(_http.Requests);
    }

    // -----------------------------------------------------------------------
    // Quitar VIP
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Quitar_el_VIP_de_regalo_no_toca_Mercado_Pago()
    {
        var user = CreateUser();
        user.VipUntilUtc = DateTime.UtcNow.AddDays(5);
        await _db.Context.SaveChangesAsync();

        await Service().RevokeVipAsync(user, AdminId, AdminEmail, default);

        var stored = await _db.NewContext().Users.SingleAsync(item => item.Id == user.Id);
        Assert.Null(stored.VipUntilUtc);
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(stored));
        Assert.Empty(_http.Requests);
        Assert.Equal(AdminActions.RevokeVip, (await _db.NewContext().AdminAuditEvents.SingleAsync()).Action);
    }

    [Fact]
    public async Task Quitar_VIP_a_una_suscripcion_paga_la_cancela_en_Mercado_Pago_y_corta_el_acceso_ya()
    {
        MercadoPagoAnswers(Cancelled(DateTime.UtcNow.AddDays(20)));
        var user = CreateUser(subscriptions: Paid());

        await Service().RevokeVipAsync(user, AdminId, AdminEmail, default);

        var cancel = Assert.Single(_http.Requests);
        Assert.Equal(HttpMethod.Put, cancel.Method);
        Assert.EndsWith("/preapproval/pre-1", cancel.Uri.AbsolutePath);
        Assert.Contains("cancelled", cancel.Body);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("cancelada", stored.Status);
        Assert.NotNull(stored.AccessRevokedAtUtc);
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(stored));
        Assert.Contains("pre-1", (await _db.NewContext().AdminAuditEvents.SingleAsync()).Details);
        Assert.Equal("revoke_access", (await _db.NewContext().SubscriptionEvents.SingleAsync()).Action);
    }

    [Fact]
    public async Task Un_aviso_tardio_de_Mercado_Pago_no_devuelve_el_acceso_quitado()
    {
        // Mercado Pago confirma la cancelación y sigue informando la próxima fecha de cobro.
        // Sin una marca propia, esa fecha volvía a dar Pro hasta entonces.
        var next = DateTime.UtcNow.AddDays(20);
        MercadoPagoAnswers(Cancelled(next));
        var user = CreateUser(subscriptions: Paid());
        await Service().RevokeVipAsync(user, AdminId, AdminEmail, default);

        await Subscriptions().SyncAsync(user, default);

        Assert.Equal(next, user.Subscriptions.Single().NextBillingAtUtc!.Value, TimeSpan.FromSeconds(1));
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(user));
    }

    [Fact]
    public async Task Si_Mercado_Pago_no_cancela_no_cambia_nada()
    {
        // Cobrarle todos los meses a alguien que no puede usar lo que paga es peor que
        // dejarle el Pro un rato más.
        _http.Always(HttpStatusCode.InternalServerError, """{"message":"boom"}""");
        var user = CreateUser(subscriptions: Paid());
        user.VipUntilUtc = DateTime.UtcNow.AddDays(3);
        await _db.Context.SaveChangesAsync();

        await Assert.ThrowsAsync<MercadoPagoException>(() => Service().RevokeVipAsync(user, AdminId, AdminEmail, default));

        using var check = _db.NewContext();
        var stored = await check.Subscriptions.SingleAsync();
        Assert.Equal("activa", stored.Status);
        Assert.Null(stored.AccessRevokedAtUtc);
        Assert.NotNull((await check.Users.SingleAsync(item => item.Id == user.Id)).VipUntilUtc);
        Assert.Empty(check.AdminAuditEvents);
    }

    [Fact]
    public async Task Una_suscripcion_ya_cancelada_con_dias_pagos_se_corta_sin_llamar_a_Mercado_Pago()
    {
        var user = CreateUser(subscriptions: Paid("cancelada"));

        await Service().RevokeVipAsync(user, AdminId, AdminEmail, default);

        Assert.Empty(_http.Requests);
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(user));
        Assert.Null((await _db.NewContext().AdminAuditEvents.SingleAsync()).Details);
    }

    [Fact]
    public async Task Una_simulada_se_corta_en_el_lugar()
    {
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            ExternalSubscriptionId = "sim-1",
            IsDevSimulated = true,
        });

        await Service().RevokeVipAsync(user, AdminId, AdminEmail, default);

        Assert.Empty(_http.Requests);
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(user));
    }

    [Fact]
    public async Task Quitar_VIP_a_quien_no_tiene_Pro_es_un_conflicto()
    {
        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().RevokeVipAsync(CreateUser(), AdminId, AdminEmail, default));

        Assert.Equal("no_access", error.Code);
    }

    // -----------------------------------------------------------------------
    // Semana gratis
    // -----------------------------------------------------------------------

    [Fact]
    public async Task La_semana_habilitada_saltea_las_reglas_de_red_y_de_dispositivo()
    {
        var options = new TrialGuardOptions { LockByIp = true, LockByDevice = true };
        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.7");
        var trials = Trials(options);

        // Otra cuenta ya usó la semana desde la misma red y el mismo dispositivo.
        var other = CreateUser(subscriptions: new Subscription { Status = "trial" });
        var identity = new ClientFingerprint(Opt.Of(options), Opt.Of(new JwtOptions())).Describe(http, "device-1");
        trials.Claim(other, other.Subscriptions.Single(), identity);
        await _db.Context.SaveChangesAsync();

        var user = CreateUser();
        Assert.False((await trials.EvaluateAsync(user, http, "device-1", default)).IsEligible);

        await Service().GrantTrialAsync(user, AdminId, AdminEmail, default);

        Assert.True((await trials.EvaluateAsync(user, http, "device-1", default)).IsEligible);
        Assert.NotNull(user.TrialGrantedAtUtc);
        Assert.Equal(AdminActions.GrantTrial, (await _db.NewContext().AdminAuditEvents.SingleAsync()).Action);
    }

    [Fact]
    public async Task Habilitarla_devuelve_la_semana_a_quien_ya_la_uso()
    {
        var user = CreateUser(hasUsedTrial: true);

        await Service().GrantTrialAsync(user, AdminId, AdminEmail, default);

        Assert.False((await _db.NewContext().Users.SingleAsync(item => item.Id == user.Id)).HasUsedTrial);
        Assert.True((await Trials().EvaluateAsync(user, new DefaultHttpContext(), null, default)).IsEligible);
    }

    [Fact]
    public async Task Una_semana_habilitada_y_usada_ya_no_se_vuelve_a_ofrecer()
    {
        var user = CreateUser();
        await Service().GrantTrialAsync(user, AdminId, AdminEmail, default);
        user.HasUsedTrial = true;

        var eligibility = await Trials().EvaluateAsync(user, new DefaultHttpContext(), null, default);

        Assert.False(eligibility.IsEligible);
        Assert.Equal("account_used", eligibility.Reason);
    }

    // -----------------------------------------------------------------------
    // Lo que el panel ofrece
    // -----------------------------------------------------------------------

    [Fact]
    public void A_una_cuenta_sin_nada_le_ofrece_dar_VIP_y_la_semana()
    {
        var access = AdminAccessService.Describe(new User());

        Assert.Equal("none", access.Source);
        Assert.True(access.CanGrantVip);
        Assert.Null(access.GrantVipBlockedReason);
        Assert.False(access.CanRevokeVip);
        Assert.Equal("unused", access.TrialState);
        Assert.True(access.CanGrantTrial);
    }

    [Fact]
    public void Con_una_suscripcion_que_cobra_avisa_que_quitar_la_cancela_y_no_ofrece_dar_VIP()
    {
        var user = new User();
        user.Subscriptions.Add(Paid());

        var access = AdminAccessService.Describe(user);

        Assert.Equal("subscription", access.Source);
        Assert.False(access.CanGrantVip);
        Assert.Equal("paid_active", access.GrantVipBlockedReason);
        Assert.True(access.CanRevokeVip);
        Assert.True(access.RevokeCancelsBilling);
    }

    [Fact]
    public void Con_Pro_de_regalo_dice_hasta_cuando_y_deja_quitarlo()
    {
        var until = DateTime.UtcNow.AddDays(9);

        var access = AdminAccessService.Describe(new User { VipUntilUtc = until, HasUsedTrial = true });

        Assert.Equal("courtesy", access.Source);
        Assert.Equal(until, access.CourtesyUntilUtc);
        Assert.True(access.CanRevokeVip);
        Assert.False(access.RevokeCancelsBilling);
        Assert.Equal("used", access.TrialState);
    }

    [Fact]
    public void A_un_admin_no_le_ofrece_nada()
    {
        var access = AdminAccessService.Describe(new User { IsAdmin = true });

        Assert.Equal("admin", access.Source);
        Assert.False(access.CanGrantVip);
        Assert.Equal("admin", access.GrantVipBlockedReason);
        Assert.False(access.CanRevokeVip);
        Assert.False(access.CanGrantTrial);
    }

    [Fact]
    public void Una_semana_habilitada_sin_usar_no_se_ofrece_de_nuevo()
    {
        var access = AdminAccessService.Describe(new User { TrialGrantedAtUtc = DateTime.UtcNow });

        Assert.Equal("granted", access.TrialState);
        Assert.False(access.CanGrantTrial);
    }
}
