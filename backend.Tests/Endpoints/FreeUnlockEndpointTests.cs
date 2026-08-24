using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// La degustación diaria. Dos alcances se cruzan acá y mantenerlos separados es todo el
/// diseño: el CUPO es por cuenta y por día, contado sobre todos los chats; cada
/// DESBLOQUEO pertenece al chat en el que se gastó.
/// </summary>
public sealed class FreeUnlockEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ChatA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private const string ChatB = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task<string?> CodeOf(HttpResponseMessage response) =>
        (await ReadJson(response)).TryGetProperty("code", out var code) ? code.GetString() : null;

    private static Task<HttpResponseMessage> Spend(HttpClient client, string metricId, string sourceHash = ChatA) =>
        client.PostAsJsonAsync("/api/metric-unlocks", new { metricId, sourceHash });

    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_sesion_es_401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/metric-unlocks")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Spend(factory.CreateClient(), "spammer")).StatusCode);
    }

    [Fact]
    public async Task Una_cuenta_nueva_arranca_con_los_cinco_del_dia()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.GetAsync("/api/metric-unlocks"));

        Assert.Equal(FreeMetricCatalog.DailyLimit, body.GetProperty("dailyLimit").GetInt32());
        Assert.Equal(0, body.GetProperty("used").GetInt32());
        Assert.Equal(5, body.GetProperty("remaining").GetInt32());
        Assert.Equal(0, body.GetProperty("unlockedMetricIds").GetArrayLength());
    }

    [Fact]
    public async Task Sin_chat_igual_responde_cuantos_quedan_hoy()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        await Spend(client, "spammer");

        var body = await ReadJson(await client.GetAsync("/api/metric-unlocks"));

        Assert.Equal(1, body.GetProperty("used").GetInt32());
        // Sin chat no hay lista que reportar.
        Assert.Equal(0, body.GetProperty("unlockedMetricIds").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("sourceHash").ValueKind);
    }

    [Fact]
    public async Task Gastar_un_desbloqueo_descuenta_del_cupo_y_lo_lista_para_ese_chat()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var body = await ReadJson(await Spend(client, "spammer"));

        Assert.Equal(1, body.GetProperty("used").GetInt32());
        Assert.Equal(4, body.GetProperty("remaining").GetInt32());
        Assert.Equal("spammer", body.GetProperty("unlockedMetricIds")[0].GetString());
        Assert.Equal(ChatA, body.GetProperty("sourceHash").GetString());
    }

    [Fact]
    public async Task Pedir_dos_veces_la_MISMA_metrica_del_MISMO_chat_no_cobra_dos_veces()
    {
        // Es lo que deja al cliente reintentar sin que un doble toque queme dos de cinco.
        var (client, _) = factory.CreateAuthenticatedClient();
        await Spend(client, "spammer");

        var body = await ReadJson(await Spend(client, "spammer"));

        Assert.Equal(1, body.GetProperty("used").GetInt32());
    }

    [Fact]
    public async Task La_misma_metrica_en_OTRO_chat_es_otro_desbloqueo()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        await Spend(client, "spammer", ChatA);

        var body = await ReadJson(await Spend(client, "spammer", ChatB));

        Assert.Equal(2, body.GetProperty("used").GetInt32());
        // Y la lista describe sólo el chat preguntado.
        Assert.Equal(1, body.GetProperty("unlockedMetricIds").GetArrayLength());
    }

    [Fact]
    public async Task El_cupo_se_cuenta_sobre_TODOS_los_chats()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        await Spend(client, "spammer", ChatA);
        await Spend(client, "emojis", ChatB);

        var body = await ReadJson(await client.GetAsync($"/api/metric-unlocks?sourceHash={ChatA}"));

        Assert.Equal(2, body.GetProperty("used").GetInt32());
        Assert.Equal(1, body.GetProperty("unlockedMetricIds").GetArrayLength());
    }

    [Fact]
    public async Task Al_sexto_desbloqueo_responde_429_con_la_hora_de_reposicion()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        foreach (var metricId in new[] { "spammer", "emojis", "reloj", "jajaja", "testamento" })
        {
            Assert.Equal(HttpStatusCode.OK, (await Spend(client, metricId)).StatusCode);
        }

        var response = await Spend(client, "multimedia");

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal("daily_limit_reached", await CodeOf(response));
        Assert.True((await ReadJson(response)).TryGetProperty("resetsAtUtc", out _));
    }

    [Fact]
    public async Task Agotado_el_cupo_lo_ya_desbloqueado_sigue_accesible()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        foreach (var metricId in new[] { "spammer", "emojis", "reloj", "jajaja", "testamento" })
        {
            await Spend(client, metricId);
        }

        // Repetir una ya desbloqueada sigue siendo idempotente, no un 429.
        Assert.Equal(HttpStatusCode.OK, (await Spend(client, "spammer")).StatusCode);
    }

    // -----------------------------------------------------------------------
    // Rechazos
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("wordcloud")]
    [InlineData("redflags")]
    [InlineData("tonopicante")]
    [InlineData("clavavistos")]
    public async Task Una_metrica_Pro_NUNCA_se_abre_con_un_desbloqueo_gratis(string metricId)
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await Spend(client, metricId);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("vip_metric", await CodeOf(response));
    }

    [Theory]
    [InlineData("")]
    [InlineData("no-existe")]
    [InlineData("SPAMMER")]
    public async Task Un_id_de_metrica_desconocido_se_rechaza(string metricId)
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        Assert.Equal("vip_metric", await CodeOf(await Spend(client, metricId)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Un_desbloqueo_tiene_que_pertenecer_a_un_chat(string sourceHash)
    {
        // Guardarlo en blanco recrearía el comportamiento viejo, donde un solo desbloqueo
        // abría esa métrica en todos los chats.
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await Spend(client, "spammer", sourceHash);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("source_hash_required", await CodeOf(response));
    }

    [Fact]
    public async Task Un_sourceHash_demasiado_largo_se_rechaza()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await Spend(client, "spammer", new string('a', 65));

        Assert.Equal("source_hash_required", await CodeOf(response));
    }

    [Fact]
    public async Task Una_cuenta_con_Pro_no_puede_gastar_desbloqueos()
    {
        // Refusado y no aceptado en silencio, así que una pestaña vieja no se come un
        // cupo que el usuario va a querer el día que se le venza la suscripción.
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await Spend(client, "spammer");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("vip_active", await CodeOf(response));
    }

    [Fact]
    public async Task Un_admin_tampoco_gasta_desbloqueos()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        Assert.Equal("vip_active", await CodeOf(await Spend(client, "spammer")));
    }

    // -----------------------------------------------------------------------
    // Aislamiento y persistencia
    // -----------------------------------------------------------------------

    [Fact]
    public async Task El_cupo_de_una_cuenta_no_afecta_a_otra()
    {
        var (mine, _) = factory.CreateAuthenticatedClient();
        var (theirs, _) = factory.CreateAuthenticatedClient();
        await Spend(theirs, "spammer");

        var body = await ReadJson(await mine.GetAsync("/api/metric-unlocks"));

        Assert.Equal(0, body.GetProperty("used").GetInt32());
    }

    [Fact]
    public async Task El_desbloqueo_queda_guardado_con_la_clave_del_dia()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        await Spend(client, "spammer");

        using var db = factory.NewDbContext();
        var unlock = await db.FreeMetricUnlocks.SingleAsync(item => item.UserId == user.Id);
        Assert.Equal("spammer", unlock.MetricId);
        Assert.Equal(ChatA, unlock.SourceHash);
        Assert.Equal(FreeMetricCatalog.DayKey(DateTime.UtcNow), unlock.DayKeyUtc);
    }

    [Fact]
    public async Task Los_desbloqueos_de_ayer_no_cuentan_hoy()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        using (var db = factory.NewDbContext())
        {
            for (var index = 0; index < 5; index += 1)
            {
                db.FreeMetricUnlocks.Add(new backend.Models.FreeMetricUnlock
                {
                    UserId = user.Id,
                    MetricId = $"metrica-{index}",
                    SourceHash = ChatA,
                    DayKeyUtc = FreeMetricCatalog.DayKey(DateTime.UtcNow.AddDays(-1)),
                });
            }
            db.SaveChanges();
        }

        var body = await ReadJson(await client.GetAsync("/api/metric-unlocks"));

        Assert.Equal(0, body.GetProperty("used").GetInt32());
    }
}
