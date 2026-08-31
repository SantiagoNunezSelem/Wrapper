using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Models;
using backend.Tests.Infrastructure;

namespace backend.Tests.Endpoints;

/// <summary>
/// Las únicas rutas que gastan plata por llamada. Todas se cierran ANTES de armar
/// cualquier prompt: sin Pro, sin consentimiento o con un hash inválido, la request
/// cuesta cero tokens. Eso es lo que prueba este archivo.
/// </summary>
public sealed class AiEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ValidHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task<string?> CodeOf(HttpResponseMessage response) =>
        (await ReadJson(response)).TryGetProperty("code", out var code) ? code.GetString() : null;

    private static object AnalyzeBody(string sourceHash = ValidHash, object? metrics = null) =>
        new { sourceHash, metrics = metrics ?? new object[0] };

    // -----------------------------------------------------------------------
    // Sin sesión
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("GET", "/api/ai/metrics?sourceHash=" + ValidHash)]
    [InlineData("POST", "/api/ai/metrics")]
    [InlineData("POST", "/api/ai/metrics/retry")]
    [InlineData("POST", "/api/ai/consent")]
    public async Task Todas_las_rutas_de_IA_exigen_sesion(string method, string path)
    {
        var client = factory.CreateClient();

        var response = method == "GET"
            ? await client.GetAsync(path)
            : await client.PostAsJsonAsync(path, AnalyzeBody());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Muro de pago
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_Pro_la_lectura_de_veredictos_es_403_pro_required()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync($"/api/ai/metrics?sourceHash={ValidHash}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("pro_required", await CodeOf(response));
    }

    [Fact]
    public async Task Sin_Pro_el_analisis_es_403_pro_required()
    {
        var (client, _) = factory.CreateAuthenticatedClient(hasAiConsent: true);

        var response = await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("pro_required", await CodeOf(response));
    }

    [Fact]
    public async Task Sin_Pro_el_reintento_es_403_pro_required()
    {
        var (client, _) = factory.CreateAuthenticatedClient(hasAiConsent: true);

        var response = await client.PostAsJsonAsync("/api/ai/metrics/retry", new { sourceHash = ValidHash });

        Assert.Equal("pro_required", await CodeOf(response));
    }

    [Fact]
    public async Task Un_admin_pasa_el_muro_de_pago()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.GetAsync($"/api/ai/metrics?sourceHash={ValidHash}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Consentimiento
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Con_Pro_pero_sin_consentimiento_el_analisis_es_403_consent_required()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("consent_required", await CodeOf(response));
    }

    [Fact]
    public async Task La_LECTURA_de_veredictos_no_exige_consentimiento()
    {
        // Leer lo ya juzgado no manda nada a Google, así que no hay nada que autorizar.
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.GetAsync($"/api/ai/metrics?sourceHash={ValidHash}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task El_consentimiento_se_puede_otorgar_y_queda_guardado()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsync("/api/ai/consent", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True((await ReadJson(response)).GetProperty("hasAiConsent").GetBoolean());

        using var db = factory.NewDbContext();
        Assert.NotNull(db.Users.Find(user.Id)!.AiConsentAtUtc);
    }

    [Fact]
    public async Task Otorgar_el_consentimiento_dos_veces_no_mueve_la_fecha_original()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        await client.PostAsync("/api/ai/consent", null);
        var first = factory.NewDbContext().Users.Find(user.Id)!.AiConsentAtUtc;

        await Task.Delay(15);
        await client.PostAsync("/api/ai/consent", null);

        Assert.Equal(first, factory.NewDbContext().Users.Find(user.Id)!.AiConsentAtUtc);
    }

    // -----------------------------------------------------------------------
    // Validación
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("corto")]
    [InlineData("no-hexadecimal-pero-largo-suficiente-para-pasar-el-largo")]
    public async Task Rechaza_un_sourceHash_invalido_en_la_lectura(string sourceHash)
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.GetAsync($"/api/ai/metrics?sourceHash={sourceHash}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rechaza_un_sourceHash_invalido_en_el_analisis()
    {
        var (client, _) = factory.CreateAuthenticatedClient(
            hasAiConsent: true, subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody(sourceHash: "corto"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rechaza_un_pedido_con_demasiadas_metricas()
    {
        var (client, _) = factory.CreateAuthenticatedClient(
            hasAiConsent: true, subscriptions: ApiFactory.ActiveSubscription());
        var metrics = Enumerable.Range(0, 20)
            .Select(index => new { metricId = "redflags", snippets = new[] { new { id = index.ToString(), keyword = "k", text = "t" } } })
            .ToArray();

        var response = await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody(metrics: metrics));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Too many metrics", await response.Content.ReadAsStringAsync());
    }

    // -----------------------------------------------------------------------
    // Camino con acceso
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_veredictos_guardados_devuelve_una_lista_vacia()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var body = await ReadJson(await client.GetAsync($"/api/ai/metrics?sourceHash={ValidHash}"));

        Assert.Equal(0, body.GetProperty("results").GetArrayLength());
    }

    [Fact]
    public async Task Devuelve_los_veredictos_guardados_de_ESA_cuenta()
    {
        var (client, user) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());
        using (var db = factory.NewDbContext())
        {
            db.AiMetricResults.Add(new AiMetricResult
            {
                UserId = user.Id,
                SourceHash = ValidHash,
                MetricId = "redflags",
                Status = AiMetricStatus.Ready,
                ResultJson = "[\"1\",\"2\"]",
            });
            db.SaveChanges();
        }

        var results = (await ReadJson(await client.GetAsync($"/api/ai/metrics?sourceHash={ValidHash}")))
            .GetProperty("results");

        Assert.Equal(1, results.GetArrayLength());
        Assert.Equal("redflags", results[0].GetProperty("metricId").GetString());
        Assert.Equal(2, results[0].GetProperty("acceptedIds").GetArrayLength());
    }

    [Fact]
    public async Task Un_analisis_sin_fragmentos_no_cuesta_tokens_y_queda_listo()
    {
        // Ningún candidato pasó los filtros de palabras: es un veredicto "no hay nada"
        // perfectamente válido, y gratis.
        var (client, _) = factory.CreateAuthenticatedClient(
            hasAiConsent: true, subscriptions: ApiFactory.ActiveSubscription());
        var metrics = new[] { new { metricId = "redflags", snippets = new object[0] } };

        var response = await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody(metrics: metrics));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var results = (await ReadJson(response)).GetProperty("results");
        Assert.Equal("ready", results[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task Sin_API_key_configurada_la_metrica_falla_con_codigo_config()
    {
        // Falla la métrica, no la pantalla: el cliente muestra un botón de reintento.
        var (client, _) = factory.CreateAuthenticatedClient(
            hasAiConsent: true, subscriptions: ApiFactory.ActiveSubscription());
        var metrics = new[]
        {
            new { metricId = "redflags", snippets = new[] { new { id = "1", keyword = "celos", text = "*A: estas celoso" } } },
        };

        var response = await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody(metrics: metrics));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await ReadJson(response)).GetProperty("results")[0];
        Assert.Equal("failed", result.GetProperty("status").GetString());
        Assert.Equal("config", result.GetProperty("errorCode").GetString());
        Assert.NotEqual(JsonValueKind.Null, result.GetProperty("retryAvailableAtUtc").ValueKind);
    }

    [Fact]
    public async Task Las_fechas_de_reintento_viajan_como_UTC()
    {
        // Sin la "Z" el navegador las leería como hora local y la cuenta regresiva
        // quedaría corrida por el offset — justo al recargar, que es cuando más importa.
        var (client, _) = factory.CreateAuthenticatedClient(
            hasAiConsent: true, subscriptions: ApiFactory.ActiveSubscription());
        var metrics = new[]
        {
            new { metricId = "redflags", snippets = new[] { new { id = "1", keyword = "k", text = "*A: x" } } },
        };
        await client.PostAsJsonAsync("/api/ai/metrics", AnalyzeBody(metrics: metrics));

        var raw = await (await client.GetAsync($"/api/ai/metrics?sourceHash={ValidHash}")).Content.ReadAsStringAsync();

        Assert.Contains("retryAvailableAtUtc", raw);
        Assert.Matches(@"""retryAvailableAtUtc"":""[^""]+Z""", raw);
    }

    [Fact]
    public async Task El_reintento_sin_nada_fallado_devuelve_una_lista_vacia()
    {
        var (client, _) = factory.CreateAuthenticatedClient(
            hasAiConsent: true, subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsJsonAsync("/api/ai/metrics/retry", new { sourceHash = ValidHash });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, (await ReadJson(response)).GetProperty("results").GetArrayLength());
    }
}
