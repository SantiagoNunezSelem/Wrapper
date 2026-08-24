using System.Net;
using System.Text.Json;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// El interruptor local de VIP. Tiene DOS puertas independientes porque cualquiera de
/// las dos, sola, termina fallando algún día: las rutas sólo se mapean en el entorno
/// Development, y además cada llamada tiene que venir de loopback. Un despliegue con
/// ASPNETCORE_ENVIRONMENT mal puesto no puede por eso regalar Pro por internet.
/// </summary>
public sealed class DevEndpointTests : IClassFixture<ApiFactory>, IDisposable
{
    private const string ChatHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private readonly ApiFactory _factory;

    public DevEndpointTests(ApiFactory factory)
    {
        _factory = factory;
        factory.RemoteIpAddress = IPAddress.Loopback;
    }

    // Deja la dirección como estaba para el test siguiente de la clase.
    public void Dispose() => _factory.RemoteIpAddress = IPAddress.Loopback;

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    // -----------------------------------------------------------------------
    // Puerta de loopback
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Desde_loopback_el_estado_dice_que_las_herramientas_estan_activas()
    {
        var body = await ReadJson(await _factory.CreateClient().GetAsync("/api/dev/status"));

        Assert.True(body.GetProperty("devToolsEnabled").GetBoolean());
    }

    [Fact]
    public async Task Un_IPv4_loopback_mapeado_a_IPv6_tambien_pasa()
    {
        // Es lo que reporta un socket dual-stack para un cliente 127.0.0.1.
        _factory.RemoteIpAddress = IPAddress.Parse("::ffff:127.0.0.1");

        Assert.Equal(HttpStatusCode.OK, (await _factory.CreateClient().GetAsync("/api/dev/status")).StatusCode);
    }

    [Fact]
    public async Task Desde_una_direccion_remota_las_rutas_de_dev_NO_EXISTEN()
    {
        _factory.RemoteIpAddress = IPAddress.Parse("203.0.113.7");

        Assert.Equal(HttpStatusCode.NotFound, (await _factory.CreateClient().GetAsync("/api/dev/status")).StatusCode);
    }

    [Fact]
    public async Task Un_X_Original_For_delata_que_la_direccion_fue_reescrita_y_cierra_la_puerta()
    {
        // Con los encabezados reenviados en confianza, el middleware pisa RemoteIpAddress
        // con lo que dijo X-Forwarded-For — y un llamador remoto podría afirmar
        // "127.0.0.1" y entrar al interruptor de Pro gratis. El middleware deja
        // X-Original-For cada vez que reescribe, así que su sola presencia alcanza para
        // no creerle a la dirección.
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Original-For", "203.0.113.7:1234");

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/dev/status")).StatusCode);
    }

    // -----------------------------------------------------------------------
    // Interruptor de suscripción
    // -----------------------------------------------------------------------

    [Fact]
    public async Task El_toggle_exige_sesion()
    {
        var response = await _factory.CreateClient().PostAsync("/api/dev/subscription/toggle", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task El_toggle_desde_una_direccion_remota_es_404_aunque_haya_sesion()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        _factory.RemoteIpAddress = IPAddress.Parse("203.0.113.7");

        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/dev/subscription/toggle", null)).StatusCode);
    }

    [Fact]
    public async Task El_toggle_enciende_un_Pro_simulado_que_el_backend_ve_como_real()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.PostAsync("/api/dev/subscription/toggle", null));

        Assert.True(body.GetProperty("simulatedSubscriptionActive").GetBoolean());
        Assert.True(body.GetProperty("hasVipAccess").GetBoolean());
        Assert.Equal("activa", body.GetProperty("subscriptionState").GetString());

        using var db = _factory.NewDbContext();
        var subscription = await db.Subscriptions.SingleAsync(item => item.UserId == user.Id);
        // Es una fila real con IsDevSimulated, no un flag del cliente: el propio muro de
        // pago de las rutas de IA ve exactamente lo que vería con un cliente que paga.
        Assert.True(subscription.IsDevSimulated);
        Assert.Equal("dev", subscription.PaymentProvider);
        Assert.Equal(0m, subscription.Amount);
    }

    [Fact]
    public async Task El_toggle_deja_un_evento_marcado_como_dev()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();

        await client.PostAsync("/api/dev/subscription/toggle", null);

        using var db = _factory.NewDbContext();
        var record = await db.SubscriptionEvents.SingleAsync(item => item.UserId == user.Id);
        Assert.Equal("dev", record.Topic);
        Assert.Equal("activate", record.Action);
    }

    [Fact]
    public async Task El_segundo_toggle_lo_apaga_de_inmediato()
    {
        // Se borra la fila en vez de marcarla cancelada: una cancelación conserva el acceso
        // hasta el fin del período, que es lo contrario de lo que un interruptor debe hacer.
        var (client, user) = _factory.CreateAuthenticatedClient();
        await client.PostAsync("/api/dev/subscription/toggle", null);

        var body = await ReadJson(await client.PostAsync("/api/dev/subscription/toggle", null));

        Assert.False(body.GetProperty("simulatedSubscriptionActive").GetBoolean());
        Assert.False(body.GetProperty("hasVipAccess").GetBoolean());
        using var db = _factory.NewDbContext();
        Assert.Equal(0, await db.Subscriptions.CountAsync(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task El_Pro_simulado_abre_de_verdad_las_rutas_de_IA()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();

        await client.PostAsync("/api/dev/subscription/toggle", null);

        var response = await client.GetAsync($"/api/ai/metrics?sourceHash={ChatHash}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Reset de desbloqueos
    // -----------------------------------------------------------------------

    [Fact]
    public async Task El_reset_exige_sesion()
    {
        var response = await _factory.CreateClient().PostAsync("/api/dev/free-unlocks/reset", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task El_reset_devuelve_el_cupo_completo()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();
        using (var db = _factory.NewDbContext())
        {
            db.FreeMetricUnlocks.Add(new backend.Models.FreeMetricUnlock
            {
                UserId = user.Id,
                MetricId = "spammer",
                SourceHash = ChatHash,
                DayKeyUtc = FreeMetricCatalog.DayKey(DateTime.UtcNow),
            });
            db.SaveChanges();
        }

        var body = await ReadJson(await client.PostAsync($"/api/dev/free-unlocks/reset?sourceHash={ChatHash}", null));

        Assert.Equal(0, body.GetProperty("used").GetInt32());
        Assert.Equal(FreeMetricCatalog.DailyLimit, body.GetProperty("remaining").GetInt32());
        Assert.Equal(ChatHash, body.GetProperty("sourceHash").GetString());
    }

    [Fact]
    public async Task El_reset_borra_TODOS_los_dias_no_solo_hoy()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();
        using (var db = _factory.NewDbContext())
        {
            db.FreeMetricUnlocks.AddRange(
                new backend.Models.FreeMetricUnlock
                {
                    UserId = user.Id, MetricId = "spammer", SourceHash = ChatHash,
                    DayKeyUtc = FreeMetricCatalog.DayKey(DateTime.UtcNow),
                },
                new backend.Models.FreeMetricUnlock
                {
                    UserId = user.Id, MetricId = "emojis", SourceHash = ChatHash,
                    DayKeyUtc = FreeMetricCatalog.DayKey(DateTime.UtcNow.AddDays(-3)),
                });
            db.SaveChanges();
        }

        await client.PostAsync("/api/dev/free-unlocks/reset", null);

        using var reread = _factory.NewDbContext();
        Assert.Equal(0, await reread.FreeMetricUnlocks.CountAsync(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task El_reset_no_toca_los_desbloqueos_de_otra_cuenta()
    {
        var (mine, _) = _factory.CreateAuthenticatedClient();
        var other = _factory.CreateUser();
        using (var db = _factory.NewDbContext())
        {
            db.FreeMetricUnlocks.Add(new backend.Models.FreeMetricUnlock
            {
                UserId = other.Id, MetricId = "spammer", SourceHash = ChatHash,
                DayKeyUtc = FreeMetricCatalog.DayKey(DateTime.UtcNow),
            });
            db.SaveChanges();
        }

        await mine.PostAsync("/api/dev/free-unlocks/reset", null);

        using var reread = _factory.NewDbContext();
        Assert.Equal(1, await reread.FreeMetricUnlocks.CountAsync(item => item.UserId == other.Id));
    }

    [Fact]
    public async Task El_reset_desde_una_direccion_remota_es_404()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        _factory.RemoteIpAddress = IPAddress.Parse("203.0.113.7");

        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/dev/free-unlocks/reset", null)).StatusCode);
    }
}
