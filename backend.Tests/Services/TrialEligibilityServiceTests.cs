using System.Net;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// Quién puede empezar la semana gratis. Las reglas están en capas porque cada una por
/// separado es débil, así que los tests las prueban de a una: la de cuenta es absoluta,
/// la de IP tapa el "me hago otra cuenta de Google", y la de dispositivo tapa el "me
/// cambia la IP en la red móvil".
/// </summary>
public class TrialEligibilityServiceTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();

    public void Dispose() => _db.Dispose();

    private TrialEligibilityService Service(TrialGuardOptions? options = null)
    {
        var settings = options ?? new TrialGuardOptions();
        var fingerprint = new ClientFingerprint(Opt.Of(settings), Opt.Of(new JwtOptions()));

        return new TrialEligibilityService(
            _db.Context,
            fingerprint,
            Opt.Of(settings),
            NullLogger<TrialEligibilityService>.Instance);
    }

    private User CreateUser(bool hasUsedTrial = false)
    {
        var user = new User
        {
            Email = $"{Guid.NewGuid():N}@example.com",
            DisplayName = "Test",
            HasUsedTrial = hasUsedTrial,
        };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user;
    }

    private static HttpContext Context(string ip = "203.0.113.7", string? country = null)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(ip);
        if (country is not null)
        {
            context.Request.Headers["CF-IPCountry"] = country;
        }
        return context;
    }

    /// <summary>Registra un trial ya usado por OTRA cuenta desde esa IP/dispositivo.</summary>
    private async Task SeedClaimFromAnotherUser(
        string ip = "203.0.113.7",
        string? deviceId = null,
        DateTime? claimedAt = null,
        TrialGuardOptions? options = null)
    {
        var other = CreateUser();
        var identity = new ClientFingerprint(
            Opt.Of(options ?? new TrialGuardOptions()),
            Opt.Of(new JwtOptions())).Describe(Context(ip), deviceId);

        _db.Context.TrialClaims.Add(new TrialClaim
        {
            UserId = other.Id,
            SubscriptionId = Guid.NewGuid(),
            IpHash = identity.IpHash,
            SubnetHash = identity.SubnetHash,
            DeviceHash = identity.DeviceHash,
            ClaimedAtUtc = claimedAt ?? DateTime.UtcNow,
        });
        await _db.Context.SaveChangesAsync();
    }

    // -----------------------------------------------------------------------

    [Fact]
    public async Task Una_cuenta_limpia_puede_empezar_el_trial()
    {
        var result = await Service().EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.True(result.IsEligible);
        Assert.Null(result.Reason);
    }

    [Fact]
    public async Task La_regla_de_cuenta_es_absoluta_y_va_primero()
    {
        var result = await Service().EvaluateAsync(CreateUser(hasUsedTrial: true), Context(), null, default);

        Assert.False(result.IsEligible);
        Assert.Equal("account_used", result.Reason);
    }

    [Fact]
    public async Task Bloquea_una_IP_que_ya_reclamo_un_trial_con_otra_cuenta()
    {
        await SeedClaimFromAnotherUser();

        var result = await Service().EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.False(result.IsEligible);
        Assert.Equal("ip_used", result.Reason);
    }

    [Fact]
    public async Task El_reclamo_previo_de_la_MISMA_cuenta_no_la_descalifica()
    {
        // Ya lo cubre HasUsedTrial; volver a matchearlo acá bloquearía un reintento
        // legítimo después de un checkout abandonado.
        var user = CreateUser();
        var identity = new ClientFingerprint(Opt.Of(new TrialGuardOptions()), Opt.Of(new JwtOptions()))
            .Describe(Context(), null);
        _db.Context.TrialClaims.Add(new TrialClaim
        {
            UserId = user.Id,
            SubscriptionId = Guid.NewGuid(),
            IpHash = identity.IpHash,
            SubnetHash = identity.SubnetHash,
        });
        await _db.Context.SaveChangesAsync();

        var result = await Service().EvaluateAsync(user, Context(), null, default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Con_la_regla_de_IP_apagada_deja_pasar()
    {
        await SeedClaimFromAnotherUser();

        var result = await Service(new TrialGuardOptions { LockByIp = false })
            .EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Otra_IP_del_mismo_bloque_pasa_por_defecto()
    {
        // LockBySubnet está apagado a propósito: el CGNAT de las telcos argentinas mete
        // miles de personas sin relación en un mismo /24.
        await SeedClaimFromAnotherUser("203.0.113.7");

        var result = await Service().EvaluateAsync(CreateUser(), Context("203.0.113.200"), null, default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Con_la_regla_de_subred_encendida_bloquea_el_bloque_entero()
    {
        var options = new TrialGuardOptions { LockBySubnet = true, LockByIp = false };
        await SeedClaimFromAnotherUser("203.0.113.7", options: options);

        var result = await Service(options).EvaluateAsync(CreateUser(), Context("203.0.113.200"), null, default);

        Assert.False(result.IsEligible);
        Assert.Equal("network_used", result.Reason);
    }

    [Fact]
    public async Task Bloquea_un_navegador_que_ya_reclamo_desde_otra_IP()
    {
        await SeedClaimFromAnotherUser("198.51.100.1", deviceId: "device-abc");

        var result = await Service().EvaluateAsync(CreateUser(), Context("203.0.113.7"), "device-abc", default);

        Assert.False(result.IsEligible);
        Assert.Equal("device_used", result.Reason);
    }

    [Fact]
    public async Task Con_la_regla_de_dispositivo_apagada_deja_pasar()
    {
        await SeedClaimFromAnotherUser("198.51.100.1", deviceId: "device-abc");

        var result = await Service(new TrialGuardOptions { LockByDevice = false })
            .EvaluateAsync(CreateUser(), Context("203.0.113.7"), "device-abc", default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Sin_device_id_la_regla_de_dispositivo_no_aplica()
    {
        await SeedClaimFromAnotherUser("198.51.100.1", deviceId: "device-abc");

        var result = await Service().EvaluateAsync(CreateUser(), Context("203.0.113.7"), null, default);

        Assert.True(result.IsEligible);
    }

    // -----------------------------------------------------------------------
    // Ventana temporal
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Un_reclamo_fuera_de_la_ventana_ya_no_cuenta()
    {
        await SeedClaimFromAnotherUser(claimedAt: DateTime.UtcNow.AddDays(-100));

        var result = await Service(new TrialGuardOptions { WindowDays = 30 })
            .EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Un_reclamo_dentro_de_la_ventana_sigue_bloqueando()
    {
        await SeedClaimFromAnotherUser(claimedAt: DateTime.UtcNow.AddDays(-5));

        var result = await Service(new TrialGuardOptions { WindowDays = 30 })
            .EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.False(result.IsEligible);
    }

    [Fact]
    public async Task Con_ventana_cero_el_registro_se_consulta_para_siempre()
    {
        await SeedClaimFromAnotherUser(claimedAt: DateTime.UtcNow.AddYears(-5));

        var result = await Service(new TrialGuardOptions { WindowDays = 0 })
            .EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.False(result.IsEligible);
    }

    // -----------------------------------------------------------------------
    // País
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Bloquea_un_pais_fuera_de_la_lista()
    {
        var options = new TrialGuardOptions { TrustProxyHeaders = true, AllowedCountries = ["AR"] };

        var result = await Service(options).EvaluateAsync(CreateUser(), Context(country: "BR"), null, default);

        Assert.False(result.IsEligible);
        Assert.Equal("country_not_allowed", result.Reason);
    }

    [Fact]
    public async Task Deja_pasar_un_pais_de_la_lista_sin_importar_mayusculas()
    {
        var options = new TrialGuardOptions { TrustProxyHeaders = true, AllowedCountries = ["ar"] };

        var result = await Service(options).EvaluateAsync(CreateUser(), Context(country: "AR"), null, default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Nunca_bloquea_por_un_pais_que_no_conoce()
    {
        // El país es una señal blanda: se registra cuando se sabe y se ignora si no.
        var options = new TrialGuardOptions { TrustProxyHeaders = true, AllowedCountries = ["AR"] };

        var result = await Service(options).EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task Con_la_lista_de_paises_vacia_no_hay_restriccion()
    {
        var options = new TrialGuardOptions { TrustProxyHeaders = true };

        var result = await Service(options).EvaluateAsync(CreateUser(), Context(country: "BR"), null, default);

        Assert.True(result.IsEligible);
    }

    // -----------------------------------------------------------------------
    // Consumo del trial
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Claim_quema_el_trial_de_la_cuenta_y_deja_registro()
    {
        var user = CreateUser();
        var subscription = new Subscription { UserId = user.Id, Status = "pendiente" };
        _db.Context.Subscriptions.Add(subscription);
        await _db.Context.SaveChangesAsync();

        var eligibility = await Service().EvaluateAsync(user, Context(), "device-abc", default);
        Service().Claim(user, subscription, eligibility.Identity);
        await _db.Context.SaveChangesAsync();

        var reread = _db.NewContext();
        Assert.True(await reread.Users.Where(item => item.Id == user.Id).Select(item => item.HasUsedTrial).SingleAsync());

        var claim = await reread.TrialClaims.SingleAsync();
        Assert.Equal(user.Id, claim.UserId);
        Assert.Equal(subscription.Id, claim.SubscriptionId);
        Assert.NotNull(claim.IpHash);
        Assert.NotNull(claim.DeviceHash);
    }

    [Fact]
    public async Task Despues_de_Claim_la_misma_cuenta_ya_no_es_elegible()
    {
        var user = CreateUser();
        var subscription = new Subscription { UserId = user.Id, Status = "pendiente" };
        _db.Context.Subscriptions.Add(subscription);
        await _db.Context.SaveChangesAsync();
        var service = Service();

        var first = await service.EvaluateAsync(user, Context(), null, default);
        service.Claim(user, subscription, first.Identity);
        await _db.Context.SaveChangesAsync();

        var second = await service.EvaluateAsync(user, Context(), null, default);

        Assert.False(second.IsEligible);
        Assert.Equal("account_used", second.Reason);
    }

    [Fact]
    public async Task Despues_de_Claim_otra_cuenta_desde_la_misma_IP_queda_bloqueada()
    {
        var user = CreateUser();
        var subscription = new Subscription { UserId = user.Id, Status = "pendiente" };
        _db.Context.Subscriptions.Add(subscription);
        await _db.Context.SaveChangesAsync();
        var service = Service();

        var first = await service.EvaluateAsync(user, Context(), null, default);
        service.Claim(user, subscription, first.Identity);
        await _db.Context.SaveChangesAsync();

        var result = await service.EvaluateAsync(CreateUser(), Context(), null, default);

        Assert.False(result.IsEligible);
        Assert.Equal("ip_used", result.Reason);
    }
}
