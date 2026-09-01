using System.Net;
using System.Text.Json;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// Decide cuándo vale la pena gastar tokens de Gemini. La regla que gobierna todo:
/// un chat+métrica se juzga una sola vez, para siempre. Cada test de acá describe un
/// camino que NO tiene que llegar a Google.
/// </summary>
public class AiMetricServiceTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();
    private readonly StubHttpMessageHandler _http = new();
    private readonly Guid _userId;

    public AiMetricServiceTests()
    {
        _userId = CreateUser();
    }

    public void Dispose() => _db.Dispose();

    /// <summary>
    /// Los veredictos tienen clave foránea a Users, y SQLite la hace cumplir de verdad
    /// (a diferencia del proveedor InMemory). Sin una cuenta real detrás, cualquier
    /// inserción del test revienta — que es exactamente lo que pasaría en producción.
    /// </summary>
    private Guid CreateUser()
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Test" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user.Id;
    }

    private AiMetricService Service(GoogleAiOptions? options = null)
    {
        var settings = options ?? new GoogleAiOptions { ApiKey = "clave-de-prueba" };
        var gemini = new GoogleAiClient(_http.CreateClient(), Opt.Of(settings), NullLogger<GoogleAiClient>.Instance);

        return new AiMetricService(_db.Context, gemini, Opt.Of(settings), NullLogger<AiMetricService>.Instance);
    }

    /// <summary>Una respuesta de Gemini aceptando los ids indicados.</summary>
    private void GeminiAccepts(params string[] ids)
    {
        var answer = JsonSerializer.Serialize(new { ids });
        _http.Always(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = answer } } } } },
        }));
    }

    private void GeminiFails(HttpStatusCode status = HttpStatusCode.TooManyRequests) =>
        _http.Always(status, "{\"error\":{}}");

    private static List<AiMetricRequestItem> OneMetric(string metricId = "redflags", int snippets = 1) =>
    [
        new(metricId, [.. Enumerable.Range(1, snippets).Select(index =>
            new AiSnippetInput(index.ToString(), "celos", $"*A: mensaje {index}"))]),
    ];

    // -----------------------------------------------------------------------
    // Lectura
    // -----------------------------------------------------------------------

    [Fact]
    public async Task GetAsync_no_llama_nunca_a_Gemini()
    {
        await Service().GetAsync(_userId, "abc", default);

        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task GetAsync_devuelve_los_veredictos_guardados()
    {
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = _userId,
            SourceHash = "abc",
            MetricId = "redflags",
            Status = AiMetricStatus.Ready,
            ResultJson = "[\"1\",\"2\"]",
        });
        await _db.Context.SaveChangesAsync();

        var results = await Service().GetAsync(_userId, "abc", default);

        var result = Assert.Single(results);
        Assert.Equal("redflags", result.MetricId);
        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Equal(["1", "2"], result.AcceptedIds);
    }

    [Fact]
    public async Task GetAsync_no_devuelve_los_veredictos_de_otra_cuenta()
    {
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = CreateUser(),
            SourceHash = "abc",
            MetricId = "redflags",
            Status = AiMetricStatus.Ready,
            ResultJson = "[]",
        });
        await _db.Context.SaveChangesAsync();

        Assert.Empty(await Service().GetAsync(_userId, "abc", default));
    }

    [Fact]
    public async Task GetAsync_marca_las_fechas_como_UTC()
    {
        // SQLite las devuelve con Kind=Unspecified y el JSON saldría sin la "Z": el
        // navegador la leería como hora local y la cuenta regresiva quedaría corrida.
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = _userId,
            SourceHash = "abc",
            MetricId = "redflags",
            Status = AiMetricStatus.Failed,
            ErrorCode = AiErrorCode.Quota,
            RetryAvailableAtUtc = DateTime.UtcNow.AddMinutes(2),
        });
        await _db.Context.SaveChangesAsync();

        var result = Assert.Single(await Service().GetAsync(_userId, "abc", default));

        Assert.Equal(DateTimeKind.Utc, result.RetryAvailableAtUtc!.Value.Kind);
        Assert.Equal(DateTimeKind.Utc, result.UpdatedAtUtc.Kind);
    }

    // -----------------------------------------------------------------------
    // Análisis
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Guarda_el_veredicto_de_Gemini()
    {
        GeminiAccepts("1");

        var results = await Service().AnalyzeAsync(_userId, "abc", OneMetric(), default);

        var result = Assert.Single(results);
        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Equal(["1"], result.AcceptedIds);

        var stored = await _db.NewContext().AiMetricResults.SingleAsync();
        Assert.Equal(AiMetricStatus.Ready, stored.Status);
        Assert.Equal(1, stored.AttemptCount);
    }

    [Fact]
    public async Task Un_id_inventado_por_el_modelo_no_entra_al_veredicto()
    {
        GeminiAccepts("1", "999");

        var results = await Service().AnalyzeAsync(_userId, "abc", OneMetric(snippets: 2), default);

        Assert.Equal(["1"], results[0].AcceptedIds);
    }

    [Fact]
    public async Task Ignora_un_id_de_metrica_que_no_existe()
    {
        GeminiAccepts();

        var results = await Service().AnalyzeAsync(_userId, "abc", OneMetric("spammer"), default);

        Assert.Empty(results);
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Sin_fragmentos_da_un_veredicto_vacio_GRATIS()
    {
        var results = await Service().AnalyzeAsync(_userId, "abc", [new AiMetricRequestItem("redflags", [])], default);

        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
        Assert.Empty(results[0].AcceptedIds);
        Assert.Empty(_http.Requests);

        // Y tampoco cuenta como intento: no hubo llamada que pudiera fallar.
        Assert.Equal(0, (await _db.NewContext().AiMetricResults.SingleAsync()).AttemptCount);
    }

    [Fact]
    public async Task Un_veredicto_ya_guardado_con_los_mismos_fragmentos_NO_vuelve_a_llamar()
    {
        GeminiAccepts("1");
        var service = Service();
        await service.AnalyzeAsync(_userId, "abc", OneMetric(), default);
        var callsAfterFirst = _http.Requests.Count;

        await service.AnalyzeAsync(_userId, "abc", OneMetric(), default);

        Assert.Equal(callsAfterFirst, _http.Requests.Count);
    }

    [Fact]
    public async Task Si_cambian_los_fragmentos_el_veredicto_se_recalcula()
    {
        // Es lo que hace que un cambio en los diccionarios invalide lo cacheado en vez
        // de reusarlo para siempre.
        GeminiAccepts("1");
        var service = Service();
        await service.AnalyzeAsync(_userId, "abc", OneMetric(snippets: 1), default);

        await service.AnalyzeAsync(_userId, "abc", OneMetric(snippets: 2), default);

        Assert.Equal(2, _http.Requests.Count);
    }

    [Fact]
    public async Task El_mismo_chat_para_otra_cuenta_se_analiza_aparte()
    {
        GeminiAccepts("1");
        var service = Service();
        await service.AnalyzeAsync(_userId, "abc", OneMetric(), default);

        await service.AnalyzeAsync(CreateUser(), "abc", OneMetric(), default);

        Assert.Equal(2, _http.Requests.Count);
        Assert.Equal(2, await _db.NewContext().AiMetricResults.CountAsync());
    }

    // -----------------------------------------------------------------------
    // Fallas y enfriamiento
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Una_falla_queda_registrada_con_su_codigo_y_su_espera()
    {
        GeminiFails(HttpStatusCode.Unauthorized);

        var result = (await Service().AnalyzeAsync(_userId, "abc", OneMetric(), default))[0];

        Assert.Equal(AiMetricStatus.Failed, result.Status);
        Assert.Equal(AiErrorCode.Config, result.ErrorCode);
        Assert.NotNull(result.RetryAvailableAtUtc);
        Assert.True(result.RetryAvailableAtUtc > DateTime.UtcNow);
    }

    [Fact]
    public async Task Durante_el_enfriamiento_NO_se_vuelve_a_llamar()
    {
        GeminiFails(HttpStatusCode.Unauthorized);
        var service = Service(new GoogleAiOptions { ApiKey = "k", RetryCooldownSeconds = 120 });
        await service.AnalyzeAsync(_userId, "abc", OneMetric(), default);
        var callsAfterFirst = _http.Requests.Count;

        await service.AnalyzeAsync(_userId, "abc", OneMetric(), default);

        Assert.Equal(callsAfterFirst, _http.Requests.Count);
    }

    [Fact]
    public async Task Pasado_el_enfriamiento_se_reintenta()
    {
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = _userId,
            SourceHash = "abc",
            MetricId = "redflags",
            Status = AiMetricStatus.Failed,
            RetryAvailableAtUtc = DateTime.UtcNow.AddMinutes(-1),
            InputHash = "otro",
        });
        await _db.Context.SaveChangesAsync();
        GeminiAccepts("1");

        var result = (await Service().AnalyzeAsync(_userId, "abc", OneMetric(), default))[0];

        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.NotEmpty(_http.Requests);
    }

    [Fact]
    public async Task Una_falla_limpia_el_veredicto_anterior()
    {
        GeminiAccepts("1");
        var service = Service(new GoogleAiOptions { ApiKey = "k", RetryCooldownSeconds = 0 });
        await service.AnalyzeAsync(_userId, "abc", OneMetric(snippets: 1), default);

        GeminiFails(HttpStatusCode.InternalServerError);
        var result = (await service.AnalyzeAsync(_userId, "abc", OneMetric(snippets: 2), default))[0];

        Assert.Equal(AiMetricStatus.Failed, result.Status);
        Assert.Empty(result.AcceptedIds);
    }

    // -----------------------------------------------------------------------
    // Lotes
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Suaviza_el_vocabulario_de_tonopicante_antes_de_llamar_a_Gemini()
    {
        // El cuerpo que sale al cliente HTTP no debe llevar la palabra cruda: es
        // justamente esa densidad la que puede disparar el piso de seguridad no
        // ajustable de Gemini.
        GeminiAccepts();
        var request = new AiMetricRequestItem("tonopicante", [new AiSnippetInput("1", "verga", "*A: mostrame la verga ahora")]);

        await Service().AnalyzeAsync(_userId, "abc", [request], default);

        var body = _http.LastRequest.Body!;
        Assert.DoesNotContain("verga", body);
        Assert.Contains("miembro", body);
    }

    [Fact]
    public async Task No_suaviza_el_vocabulario_para_redflags()
    {
        GeminiAccepts();
        var request = new AiMetricRequestItem("redflags", [new AiSnippetInput("1", "celos", "*A: sos un celoso de mierda")]);

        await Service().AnalyzeAsync(_userId, "abc", [request], default);

        Assert.Contains("celoso", _http.LastRequest.Body!);
    }

    [Fact]
    public async Task Parte_los_fragmentos_en_lotes_del_tamano_configurado()
    {
        GeminiAccepts();

        await Service(new GoogleAiOptions { ApiKey = "k", BatchSize = 2 })
            .AnalyzeAsync(_userId, "abc", OneMetric(snippets: 5), default);

        Assert.Equal(3, _http.Requests.Count);
    }

    [Fact]
    public async Task Un_lote_fallado_tumba_la_metrica_entera()
    {
        // Un veredicto parcial subcontaría la métrica sin que nadie pueda notarlo.
        _http.Enqueue(HttpStatusCode.OK, "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"{\\\"ids\\\":[]}\"}]}}]}")
             .Always(HttpStatusCode.InternalServerError, "{}");

        var result = (await Service(new GoogleAiOptions { ApiKey = "k", BatchSize = 1 })
            .AnalyzeAsync(_userId, "abc", OneMetric(snippets: 3), default))[0];

        Assert.Equal(AiMetricStatus.Failed, result.Status);
        Assert.Equal(AiErrorCode.Unavailable, result.ErrorCode);
    }

    [Fact]
    public async Task Un_lote_bloqueado_se_parte_al_medio_y_se_reintenta()
    {
        // Verificado contra Gemini: 40 mensajes densos disparan el piso de seguridad
        // aunque estén todos los safetySettings en BLOCK_NONE; partir el lote lo resuelve.
        var blocked = JsonSerializer.Serialize(new { promptFeedback = new { blockReason = "PROHIBITED_CONTENT" } });
        var ok = "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"{\\\"ids\\\":[\\\"1\\\"]}\"}]}}]}";

        _http.Enqueue(HttpStatusCode.OK, blocked)
             .Enqueue(HttpStatusCode.OK, ok)
             .Enqueue(HttpStatusCode.OK, ok);

        var result = (await Service(new GoogleAiOptions { ApiKey = "k", BatchSize = 4 })
            .AnalyzeAsync(_userId, "abc", OneMetric(snippets: 4), default))[0];

        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Equal(3, _http.Requests.Count);
    }

    [Fact]
    public async Task Un_unico_fragmento_bloqueado_de_redflags_se_excluye_sin_fallar()
    {
        // Para redflags el rechazo del piso de seguridad es evidencia débil de un
        // conflicto real dirigido a la otra persona — puede tratarse de odio o una
        // amenaza sobre algo ajeno a la relación — así que sigue rigiendo "ante la
        // duda, excluí": no cuenta, pero tampoco tumba la métrica entera.
        _http.Always(HttpStatusCode.OK, JsonSerializer.Serialize(new { promptFeedback = new { blockReason = "SAFETY" } }));

        var result = (await Service().AnalyzeAsync(_userId, "abc", OneMetric(metricId: "redflags", snippets: 1), default))[0];

        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Empty(result.AcceptedIds);
        Assert.Single(_http.Requests);
    }

    [Fact]
    public async Task Un_unico_fragmento_bloqueado_de_tonopicante_se_cuenta_como_positivo()
    {
        // Este candidato ya pasó el filtro de palabras clave, y el piso de seguridad de
        // Gemini se niega a mirarlo incluso solo, con los 4 safetySettings en BLOCK_NONE.
        // Eso es más evidencia de +18 real que cualquier veredicto que el modelo pudiera
        // devolver, así que ahora cuenta en vez de desaparecer del conteo.
        _http.Always(HttpStatusCode.OK, JsonSerializer.Serialize(new { promptFeedback = new { blockReason = "PROHIBITED_CONTENT" } }));

        var result = (await Service().AnalyzeAsync(_userId, "abc", OneMetric(metricId: "tonopicante", snippets: 1), default))[0];

        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Equal(["1"], result.AcceptedIds);
        Assert.Single(_http.Requests);
    }

    // -----------------------------------------------------------------------
    // Saneado de la entrada
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Descarta_los_fragmentos_sin_id_o_sin_texto()
    {
        GeminiAccepts();
        var request = new AiMetricRequestItem("redflags",
        [
            new AiSnippetInput("", "k", "texto"),
            new AiSnippetInput("2", "k", "   "),
            new AiSnippetInput("3", "k", "texto real"),
        ]);

        await Service().AnalyzeAsync(_userId, "abc", [request], default);

        var stored = await _db.NewContext().AiMetricResults.SingleAsync();
        var snippets = JsonSerializer.Deserialize<List<AiSnippetInput>>(stored.InputJson, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Single(snippets);
        Assert.Equal("3", snippets[0].Id);
    }

    [Fact]
    public async Task Recorta_un_fragmento_gigante_para_que_nadie_nos_haga_pagar_una_novela()
    {
        GeminiAccepts();
        var request = new AiMetricRequestItem("redflags", [new AiSnippetInput("1", "k", new string('x', 5000))]);

        await Service().AnalyzeAsync(_userId, "abc", [request], default);

        var stored = await _db.NewContext().AiMetricResults.SingleAsync();
        var snippets = JsonSerializer.Deserialize<List<AiSnippetInput>>(stored.InputJson, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(1200, snippets[0].Text.Length);
    }

    [Fact]
    public async Task Nunca_manda_mas_fragmentos_que_el_tope_configurado()
    {
        GeminiAccepts();

        await Service(new GoogleAiOptions { ApiKey = "k", MaxSnippetsPerMetric = 3, BatchSize = 100 })
            .AnalyzeAsync(_userId, "abc", OneMetric(snippets: 50), default);

        var stored = await _db.NewContext().AiMetricResults.SingleAsync();
        var snippets = JsonSerializer.Deserialize<List<AiSnippetInput>>(stored.InputJson, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(3, snippets.Count);
    }

    [Fact]
    public async Task Atiende_como_mucho_doce_metricas_por_pedido()
    {
        GeminiAccepts();
        var many = Enumerable.Range(0, 20)
            .Select(index => new AiMetricRequestItem(index % 2 == 0 ? "redflags" : "tonopicante",
                [new AiSnippetInput(index.ToString(), "k", $"texto {index}")]))
            .ToList();

        var results = await Service().AnalyzeAsync(_userId, "abc", many, default);

        Assert.Equal(12, AiMetricService.MaxMetricsPerRequest);
        Assert.True(results.Count <= AiMetricService.MaxMetricsPerRequest);
    }

    // -----------------------------------------------------------------------
    // Tope diario por cuenta
    // -----------------------------------------------------------------------

    private async Task SeedChatsToday(int count)
    {
        for (var index = 0; index < count; index += 1)
        {
            _db.Context.AiMetricResults.Add(new AiMetricResult
            {
                UserId = _userId,
                SourceHash = $"chat-{index}",
                MetricId = "redflags",
                Status = AiMetricStatus.Ready,
                ResultJson = "[]",
                CreatedAtUtc = DateTime.UtcNow,
            });
        }
        await _db.Context.SaveChangesAsync();
    }

    [Fact]
    public async Task Al_llegar_al_tope_diario_rechaza_un_chat_nuevo()
    {
        await SeedChatsToday(10);
        GeminiAccepts();

        await Assert.ThrowsAsync<AiDailyLimitReachedException>(() =>
            Service().AnalyzeAsync(_userId, "chat-nuevo", OneMetric(), default));
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Un_chat_que_ya_conto_hoy_pasa_igual_aunque_este_en_el_tope()
    {
        // El tope no puede dejar a alguien a mitad del chat que está mirando.
        await SeedChatsToday(10);
        GeminiAccepts("1");

        var results = await Service().AnalyzeAsync(_userId, "chat-0", OneMetric("tonopicante"), default);

        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
    }

    [Fact]
    public async Task Debajo_del_tope_no_molesta()
    {
        await SeedChatsToday(9);
        GeminiAccepts("1");

        var results = await Service().AnalyzeAsync(_userId, "chat-nuevo", OneMetric(), default);

        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
    }

    [Fact]
    public async Task Los_chats_de_ayer_no_cuentan_para_el_tope_de_hoy()
    {
        for (var index = 0; index < 10; index += 1)
        {
            _db.Context.AiMetricResults.Add(new AiMetricResult
            {
                UserId = _userId,
                SourceHash = $"viejo-{index}",
                MetricId = "redflags",
                Status = AiMetricStatus.Ready,
                ResultJson = "[]",
                CreatedAtUtc = DateTime.UtcNow.AddDays(-1),
            });
        }
        await _db.Context.SaveChangesAsync();
        GeminiAccepts("1");

        var results = await Service().AnalyzeAsync(_userId, "chat-nuevo", OneMetric(), default);

        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
    }

    [Fact]
    public async Task Un_tope_en_cero_o_menos_desactiva_la_regla()
    {
        await SeedChatsToday(50);
        GeminiAccepts("1");

        var results = await Service(new GoogleAiOptions { ApiKey = "k", MaxChatsPerDay = 0 })
            .AnalyzeAsync(_userId, "chat-nuevo", OneMetric(), default);

        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
    }

    [Fact]
    public async Task El_tope_es_por_cuenta_no_global()
    {
        await SeedChatsToday(10);
        GeminiAccepts("1");

        var results = await Service().AnalyzeAsync(CreateUser(), "chat-nuevo", OneMetric(), default);

        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
    }

    // -----------------------------------------------------------------------
    // Reintento
    // -----------------------------------------------------------------------

    [Fact]
    public async Task RetryFailedAsync_sólo_reintenta_las_fallidas()
    {
        _db.Context.AiMetricResults.AddRange(
            new AiMetricResult
            {
                UserId = _userId, SourceHash = "abc", MetricId = "redflags",
                Status = AiMetricStatus.Ready, ResultJson = "[\"7\"]",
            },
            new AiMetricResult
            {
                UserId = _userId, SourceHash = "abc", MetricId = "tonopicante",
                Status = AiMetricStatus.Failed, ErrorCode = AiErrorCode.Quota,
                InputJson = "[{\"id\":\"1\",\"keyword\":\"k\",\"text\":\"*A: hola\"}]",
            });
        await _db.Context.SaveChangesAsync();
        GeminiAccepts("1");

        var results = await Service().RetryFailedAsync(_userId, "abc", default);

        Assert.Equal(2, results.Count);
        Assert.Equal(["7"], results.Single(item => item.MetricId == "redflags").AcceptedIds);
        Assert.Equal(AiMetricStatus.Ready, results.Single(item => item.MetricId == "tonopicante").Status);
        // Sólo se llamó por la que estaba fallada.
        Assert.Single(_http.Requests);
    }

    [Fact]
    public async Task RetryFailedAsync_reusa_los_fragmentos_guardados()
    {
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = _userId, SourceHash = "abc", MetricId = "redflags",
            Status = AiMetricStatus.Failed,
            InputJson = "[{\"id\":\"9\",\"keyword\":\"celos\",\"text\":\"*A: estas celoso\"}]",
        });
        await _db.Context.SaveChangesAsync();
        GeminiAccepts("9");

        var results = await Service().RetryFailedAsync(_userId, "abc", default);

        Assert.Equal(["9"], results[0].AcceptedIds);
        Assert.Contains("estas celoso", _http.LastRequest.Body);
    }

    [Fact]
    public async Task RetryFailedAsync_sin_nada_guardado_no_hace_nada()
    {
        Assert.Empty(await Service().RetryFailedAsync(_userId, "abc", default));
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task RetryFailedAsync_tolera_un_InputJson_corrupto()
    {
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = _userId, SourceHash = "abc", MetricId = "redflags",
            Status = AiMetricStatus.Failed,
            InputJson = "no es json",
        });
        await _db.Context.SaveChangesAsync();

        var results = await Service().RetryFailedAsync(_userId, "abc", default);

        // Sin fragmentos que reenviar queda como "nada que juzgar", no como error.
        Assert.Equal(AiMetricStatus.Ready, results[0].Status);
        Assert.Empty(_http.Requests);
    }
}
