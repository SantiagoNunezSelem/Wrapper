using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Models;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// Las rutas de los perfiles de personalidad. Igual que las de las métricas con IA, todas
/// se cierran ANTES de armar cualquier prompt —sin sesión, sin Pro, sin consentimiento o con
/// un hash inválido la request cuesta cero tokens— pero con un consentimiento propio: esta
/// ruta manda una muestra de mensajes, no solo los que pegaron en un diccionario.
/// </summary>
public sealed class AiProfilesEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ValidHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task<string?> CodeOf(HttpResponseMessage response) =>
        (await ReadJson(response)).TryGetProperty("code", out var code) ? code.GetString() : null;

    private static object Body(string sourceHash = ValidHash, int people = 1, int messages = 12, string language = "es") => new
    {
        sourceHash,
        language,
        group = new Dictionary<string, double> { ["share"] = 0.3 },
        people = Enumerable.Range(0, people).Select(index => new
        {
            id = ((char)('A' + index)).ToString(),
            features = new Dictionary<string, double> { ["share"] = 0.3 },
            messages = Enumerable.Range(1, messages).Select(number => $"mensaje {number} de la persona {index}").ToList(),
        }).ToList(),
    };

    /// <summary>Una cuenta con Pro y con el consentimiento de perfiles (o sin él).</summary>
    private (HttpClient Client, User User) ProAccount(bool profileConsent = true, bool metricsConsent = true)
    {
        var (client, user) = factory.CreateAuthenticatedClient(
            hasAiConsent: metricsConsent,
            subscriptions: ApiFactory.ActiveSubscription());

        if (profileConsent)
        {
            using var db = factory.NewDbContext();
            db.Users.Find(user.Id)!.AiProfileConsentAtUtc = DateTime.UtcNow;
            db.SaveChanges();
        }

        return (client, user);
    }

    // -----------------------------------------------------------------------
    // Sin sesión y sin Pro
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("GET", "/api/ai/profiles?sourceHash=" + ValidHash)]
    [InlineData("POST", "/api/ai/profiles")]
    public async Task Las_rutas_de_perfiles_exigen_sesion(string method, string path)
    {
        var client = factory.CreateClient();

        var response = method == "GET"
            ? await client.GetAsync(path)
            : await client.PostAsJsonAsync(path, Body());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Sin_Pro_la_lectura_es_403_pro_required()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync($"/api/ai/profiles?sourceHash={ValidHash}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("pro_required", await CodeOf(response));
    }

    [Fact]
    public async Task Sin_Pro_el_analisis_es_403_pro_required_aunque_haya_consentimiento()
    {
        var (client, user) = factory.CreateAuthenticatedClient(hasAiConsent: true);
        using (var db = factory.NewDbContext())
        {
            db.Users.Find(user.Id)!.AiProfileConsentAtUtc = DateTime.UtcNow;
            db.SaveChanges();
        }

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("pro_required", await CodeOf(response));
    }

    // -----------------------------------------------------------------------
    // Consentimiento
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Con_Pro_pero_sin_el_consentimiento_de_perfiles_el_analisis_es_403_consent_required()
    {
        var (client, _) = ProAccount(profileConsent: false, metricsConsent: false);

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("consent_required", await CodeOf(response));
    }

    [Fact]
    public async Task Haber_aceptado_solo_las_metricas_de_antes_NO_alcanza_para_los_perfiles()
    {
        // El consentimiento viejo se dio para algo más chico —fragmentos cortos ya marcados—
        // y no se arrastra a mandar una muestra de mensajes.
        var (client, _) = ProAccount(profileConsent: false, metricsConsent: true);

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("consent_required", await CodeOf(response));
    }

    [Fact]
    public async Task La_LECTURA_de_perfiles_no_exige_consentimiento()
    {
        var (client, _) = ProAccount(profileConsent: false, metricsConsent: false);

        var response = await client.GetAsync($"/api/ai/profiles?sourceHash={ValidHash}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await ReadJson(response)).GetProperty("results").EnumerateArray());
    }

    [Fact]
    public async Task El_perfil_de_la_cuenta_dice_si_dio_el_consentimiento_de_perfiles()
    {
        var (withBoth, _) = ProAccount();
        var (onlyOld, _) = ProAccount(profileConsent: false, metricsConsent: true);

        var both = await ReadJson(await withBoth.GetAsync("/api/auth/me"));
        var old = await ReadJson(await onlyOld.GetAsync("/api/auth/me"));

        Assert.True(both.GetProperty("hasAiProfileConsent").GetBoolean());
        Assert.True(old.GetProperty("hasAiConsent").GetBoolean());
        Assert.False(old.GetProperty("hasAiProfileConsent").GetBoolean());
    }

    [Fact]
    public async Task Aceptar_en_el_modal_otorga_las_dos_cosas()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsync("/api/ai/consent", null);

        var json = await ReadJson(response);
        Assert.True(json.GetProperty("hasAiConsent").GetBoolean());
        Assert.True(json.GetProperty("hasAiProfileConsent").GetBoolean());

        using var db = factory.NewDbContext();
        var stored = db.Users.Find(user.Id)!;
        Assert.NotNull(stored.AiConsentAtUtc);
        Assert.NotNull(stored.AiProfileConsentAtUtc);
    }

    [Fact]
    public async Task Quien_ya_habia_aceptado_lo_viejo_conserva_esa_fecha_y_suma_la_nueva()
    {
        var (client, user) = ProAccount(profileConsent: false, metricsConsent: true);
        var original = factory.NewDbContext().Users.Find(user.Id)!.AiConsentAtUtc;

        await client.PostAsync("/api/ai/consent", null);

        using var db = factory.NewDbContext();
        var stored = db.Users.Find(user.Id)!;
        Assert.Equal(original, stored.AiConsentAtUtc);
        Assert.NotNull(stored.AiProfileConsentAtUtc);
    }

    [Fact]
    public async Task Aceptar_dos_veces_no_mueve_la_fecha_del_consentimiento_de_perfiles()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        await client.PostAsync("/api/ai/consent", null);
        var first = factory.NewDbContext().Users.Find(user.Id)!.AiProfileConsentAtUtc;

        await Task.Delay(15);
        await client.PostAsync("/api/ai/consent", null);

        Assert.Equal(first, factory.NewDbContext().Users.Find(user.Id)!.AiProfileConsentAtUtc);
    }

    // -----------------------------------------------------------------------
    // Validación
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("corto")]
    [InlineData("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")]
    public async Task Un_hash_invalido_es_400_en_la_lectura_y_en_el_analisis(string hash)
    {
        var (client, _) = ProAccount();

        var read = await client.GetAsync($"/api/ai/profiles?sourceHash={hash}");
        var analyze = await client.PostAsJsonAsync("/api/ai/profiles", Body(sourceHash: hash));

        Assert.Equal(HttpStatusCode.BadRequest, read.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, analyze.StatusCode);
    }

    [Fact]
    public async Task Una_lista_de_personas_absurdamente_larga_es_400()
    {
        var (client, _) = ProAccount();

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body(people: 17));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Sin_personas_con_muestra_suficiente_devuelve_una_lista_vacia_sin_gastar()
    {
        var (client, _) = ProAccount();

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body(people: 2, messages: 3));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await ReadJson(response)).GetProperty("results").EnumerateArray());
    }

    // -----------------------------------------------------------------------
    // De punta a punta, sin red
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Con_todo_en_regla_pero_sin_key_cada_persona_queda_failed_por_config()
    {
        // Los tests no tienen key de Google (ver ApiFactory): es el camino real de una
        // instalación mal configurada, y prueba que el cableado llega hasta la base.
        var (client, user) = ProAccount();

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body(people: 2));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var results = (await ReadJson(response)).GetProperty("results").EnumerateArray().ToList();
        Assert.Equal(2, results.Count);
        Assert.All(results, item =>
        {
            Assert.Equal("failed", item.GetProperty("status").GetString());
            Assert.Equal("config", item.GetProperty("errorCode").GetString());
            Assert.NotEqual(JsonValueKind.Null, item.GetProperty("retryAvailableAtUtc").ValueKind);
        });

        using var db = factory.NewDbContext();
        Assert.Equal(2, db.AiProfileResults.Count(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task Una_segunda_request_dentro_del_enfriamiento_no_vuelve_a_intentar()
    {
        var (client, user) = ProAccount();
        await client.PostAsJsonAsync("/api/ai/profiles", Body());

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var db = factory.NewDbContext();
        Assert.Equal(1, db.AiProfileResults.Single(item => item.UserId == user.Id).AttemptCount);
    }

    [Fact]
    public async Task La_lectura_devuelve_lo_guardado_filtrado_por_idioma()
    {
        var (client, user) = ProAccount();
        using (var db = factory.NewDbContext())
        {
            db.AiProfileResults.AddRange(
                new AiProfileResult
                {
                    UserId = user.Id,
                    SourceHash = ValidHash,
                    PersonId = "A",
                    Language = "es",
                    Status = AiMetricStatus.Ready,
                    LabelId = "lider",
                    Summary = "Mueve al grupo y propone planes casi todos los fines de semana.",
                },
                new AiProfileResult
                {
                    UserId = user.Id,
                    SourceHash = ValidHash,
                    PersonId = "A",
                    Language = "en",
                    Status = AiMetricStatus.Ready,
                    LabelId = "lider",
                    Summary = "Moves the group and suggests plans almost every weekend.",
                });
            db.SaveChanges();
        }

        var spanish = await ReadJson(await client.GetAsync($"/api/ai/profiles?sourceHash={ValidHash}"));
        var english = await ReadJson(await client.GetAsync($"/api/ai/profiles?sourceHash={ValidHash}&language=en"));

        var es = Assert.Single(spanish.GetProperty("results").EnumerateArray());
        var en = Assert.Single(english.GetProperty("results").EnumerateArray());
        Assert.Equal("lider", es.GetProperty("labelId").GetString());
        Assert.StartsWith("Mueve", es.GetProperty("summary").GetString());
        Assert.StartsWith("Moves", en.GetProperty("summary").GetString());
    }

    [Fact]
    public async Task Agotado_el_tope_diario_de_chats_un_chat_nuevo_responde_429()
    {
        var (client, user) = ProAccount();
        using (var db = factory.NewDbContext())
        {
            for (var index = 0; index < 10; index++)
            {
                db.AiMetricResults.Add(new AiMetricResult
                {
                    UserId = user.Id,
                    SourceHash = $"{index:x2}".PadLeft(32, 'a'),
                    MetricId = "redflags",
                    Status = AiMetricStatus.Ready,
                });
            }

            db.SaveChanges();
        }

        var response = await client.PostAsJsonAsync("/api/ai/profiles", Body());

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.Equal("ai_daily_limit_reached", await CodeOf(response));
    }
}
