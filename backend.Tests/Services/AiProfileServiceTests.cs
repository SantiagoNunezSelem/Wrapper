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
/// Decide cuándo vale la pena gastar tokens en el perfil de una persona. Mismo principio
/// que <see cref="AiMetricServiceTests"/> —una persona de un chat se perfila una sola vez,
/// para siempre— con una diferencia: la unidad de falla es la PERSONA, no la métrica.
/// </summary>
public class AiProfileServiceTests : IDisposable
{
    private const string Hash = "0123456789abcdef0123456789abcdef";
    private const string OtherHash = "fedcba9876543210fedcba9876543210";

    private const string GoodSummary =
        "Arranca casi todas las conversaciones y responde en pocos minutos, siempre con un tono muy cercano.";

    private readonly TestDb _db = TestDb.Create();
    private readonly StubHttpMessageHandler _http = new();
    private readonly Guid _userId;

    public AiProfileServiceTests()
    {
        _userId = CreateUser();
    }

    public void Dispose() => _db.Dispose();

    private Guid CreateUser()
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Test" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user.Id;
    }

    private static GoogleAiOptions Settings() => new() { ApiKey = "clave-de-prueba" };

    private GoogleAiClient Gemini(GoogleAiOptions settings) =>
        new(_http.CreateClient(), Opt.Of(settings), NullLogger<GoogleAiClient>.Instance);

    private AiProfileService Service(GoogleAiOptions? options = null)
    {
        var settings = options ?? Settings();
        return new AiProfileService(_db.Context, Gemini(settings), Opt.Of(settings), NullLogger<AiProfileService>.Instance);
    }

    /// <summary>Una respuesta de Gemini con el perfil indicado y lo que costó la llamada.</summary>
    private static string GeminiProfile(
        string label = "bromista",
        string? secondary = null,
        string? summary = null,
        int input = 0,
        int output = 0) =>
        JsonSerializer.Serialize(new
        {
            candidates = new[]
            {
                new
                {
                    content = new
                    {
                        parts = new[] { new { text = JsonSerializer.Serialize(new { label, secondary, summary = summary ?? GoodSummary }) } },
                    },
                },
            },
            usageMetadata = input + output == 0 ? null : new { promptTokenCount = input, candidatesTokenCount = output },
        });

    private static string GeminiBlocked() =>
        JsonSerializer.Serialize(new { promptFeedback = new { blockReason = "PROHIBITED_CONTENT" } });

    private void GeminiAlwaysWritesAProfile() => _http.Always(HttpStatusCode.OK, GeminiProfile());

    /// <summary>
    /// El texto que le llegó al modelo, ya decodificado. El cuerpo crudo trae los acentos
    /// escapados (<c>á</c>), así que comparar contra él con una "á" nunca encontraría nada.
    /// </summary>
    private static string TextOf(CapturedRequest request, string section)
    {
        using var document = JsonDocument.Parse(request.Body!);
        var node = section == "instruction"
            ? document.RootElement.GetProperty("systemInstruction")
            : document.RootElement.GetProperty("contents")[0];

        return node.GetProperty("parts")[0].GetProperty("text").GetString()!;
    }

    private static AiProfilePersonInput Person(string? id, int messages = 15, string word = "escribe", int? features = 2) =>
        new(
            id,
            features is null
                ? null
                : new Dictionary<string, double> { ["share"] = 0.3, ["initiative"] = 0.5 },
            Enumerable.Range(1, messages).Select(index => $"{id} {word} {index} en el grupo").ToList());

    private static Dictionary<string, double> Group() => new() { ["share"] = 0.25, ["initiative"] = 0.4 };

    private Task<List<AiProfileStateDto>> Analyze(
        AiProfileService service,
        params AiProfilePersonInput[] people) =>
        service.AnalyzeAsync(_userId, Hash, "es", Group(), people, default);

    // -----------------------------------------------------------------------
    // Lectura
    // -----------------------------------------------------------------------

    [Fact]
    public async Task GetAsync_no_llama_nunca_a_Gemini()
    {
        await Service().GetAsync(_userId, Hash, "es", default);

        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task GetAsync_devuelve_solo_lo_de_esa_cuenta_ese_chat_y_ese_idioma()
    {
        var other = CreateUser();
        _db.Context.AiProfileResults.AddRange(
            Row(_userId, Hash, "B", "es"),
            Row(_userId, Hash, "A", "es"),
            Row(_userId, Hash, "A", "en"),
            Row(_userId, OtherHash, "A", "es"),
            Row(other, Hash, "A", "es"));
        await _db.Context.SaveChangesAsync();

        var results = await Service().GetAsync(_userId, Hash, "es", default);

        // Ordenado por la letra: el navegador las busca por id, pero un orden estable
        // evita que la pantalla baraje las tarjetas entre dos lecturas.
        Assert.Equal(["A", "B"], results.Select(item => item.PersonId));
    }

    [Fact]
    public async Task GetAsync_trata_cualquier_idioma_que_no_sea_en_como_es()
    {
        _db.Context.AiProfileResults.Add(Row(_userId, Hash, "A", "es"));
        await _db.Context.SaveChangesAsync();

        Assert.Single(await Service().GetAsync(_userId, Hash, "fr", default));
        Assert.Single(await Service().GetAsync(_userId, Hash, null, default));
        Assert.Empty(await Service().GetAsync(_userId, Hash, "en", default));
    }

    private static AiProfileResult Row(Guid userId, string hash, string person, string language) => new()
    {
        UserId = userId,
        SourceHash = hash,
        PersonId = person,
        Language = language,
        Status = AiMetricStatus.Ready,
        LabelId = "seco",
        Summary = GoodSummary,
    };

    // -----------------------------------------------------------------------
    // El camino feliz
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Guarda_el_perfil_y_lo_devuelve()
    {
        _http.Always(HttpStatusCode.OK, GeminiProfile("lider", "curioso"));

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal("A", result.PersonId);
        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Equal("lider", result.LabelId);
        Assert.Equal("curioso", result.SecondaryLabelId);
        Assert.Equal(GoodSummary, result.Summary);
        Assert.Null(result.ErrorCode);
        Assert.Null(result.RetryAvailableAtUtc);

        var stored = await _db.NewContext().AiProfileResults.SingleAsync();
        Assert.Equal(_userId, stored.UserId);
        Assert.Equal(Hash, stored.SourceHash);
        Assert.Equal("es", stored.Language);
        Assert.Equal(1, stored.AttemptCount);
        Assert.False(string.IsNullOrEmpty(stored.InputHash));
    }

    [Fact]
    public async Task Guarda_lo_que_escribió_el_modelo_y_NUNCA_la_muestra_que_leyó()
    {
        GeminiAlwaysWritesAProfile();

        await Analyze(Service(), Person("A"));

        var stored = await _db.NewContext().AiProfileResults.SingleAsync();
        var everything = string.Join(' ', stored.Id, stored.PersonId, stored.InputHash, stored.LabelId, stored.Summary);
        Assert.DoesNotContain("escribe 1 en el grupo", everything);
    }

    [Fact]
    public async Task Le_manda_a_Gemini_la_instruccion_del_servidor_y_la_muestra_de_la_persona()
    {
        GeminiAlwaysWritesAProfile();

        await Analyze(Service(), Person("A", messages: 12, word: "mensajito"));

        Assert.Contains("Armás perfiles de personalidad", TextOf(_http.LastRequest, "instruction"));

        var content = TextOf(_http.LastRequest, "content");
        Assert.Contains("A mensajito 1 en el grupo", content);
        Assert.Contains("Persona A, en un grupo de 1 personas", content);
    }

    [Fact]
    public async Task Una_segunda_llamada_igual_no_llega_a_Google()
    {
        GeminiAlwaysWritesAProfile();
        await Analyze(Service(), Person("A"));
        var callsAfterFirst = _http.Requests.Count;

        var again = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal(callsAfterFirst, _http.Requests.Count);
        Assert.Equal(AiMetricStatus.Ready, again.Status);
        Assert.Equal(1, await _db.NewContext().AiProfileResults.CountAsync());
    }

    [Fact]
    public async Task Si_cambia_la_muestra_se_vuelve_a_pedir_el_perfil_en_la_misma_fila()
    {
        GeminiAlwaysWritesAProfile();
        await Analyze(Service(), Person("A", word: "escribe"));

        await Analyze(Service(), Person("A", word: "cambió"));

        Assert.Equal(2, _http.Requests.Count);
        var stored = await _db.NewContext().AiProfileResults.SingleAsync();
        Assert.Equal(2, stored.AttemptCount);
    }

    [Fact]
    public async Task Si_cambian_los_numeros_tambien_se_vuelve_a_pedir()
    {
        GeminiAlwaysWritesAProfile();
        await Analyze(Service(), Person("A"));

        var changed = Person("A") with { Features = new Dictionary<string, double> { ["share"] = 0.9 } };
        await Analyze(Service(), changed);

        Assert.Equal(2, _http.Requests.Count);
    }

    [Fact]
    public async Task Cada_idioma_tiene_su_propio_perfil()
    {
        GeminiAlwaysWritesAProfile();
        var service = Service();

        await service.AnalyzeAsync(_userId, Hash, "es", Group(), [Person("A")], default);
        await service.AnalyzeAsync(_userId, Hash, "en", Group(), [Person("A")], default);
        await service.AnalyzeAsync(_userId, Hash, "es", Group(), [Person("A")], default);

        Assert.Equal(2, _http.Requests.Count);
        Assert.Contains("inglés", TextOf(_http.LastRequest, "instruction"));
        Assert.Equal(2, await _db.NewContext().AiProfileResults.CountAsync());
    }

    [Fact]
    public async Task Devuelve_los_resultados_en_el_orden_de_la_request()
    {
        GeminiAlwaysWritesAProfile();

        var results = await Analyze(Service(), Person("C"), Person("A"), Person("B"));

        Assert.Equal(["C", "A", "B"], results.Select(item => item.PersonId));
    }

    [Fact]
    public async Task Sin_gente_que_perfilar_no_llama_a_nadie_ni_escribe_nada()
    {
        var results = await Analyze(Service());

        Assert.Empty(results);
        Assert.Empty(_http.Requests);
        Assert.Equal(0, await _db.NewContext().AiProfileResults.CountAsync());
    }

    [Fact]
    public async Task Una_lista_nula_tambien_se_trata_como_nada_que_perfilar()
    {
        var results = await Service().AnalyzeAsync(_userId, Hash, "es", null, null, default);

        Assert.Empty(results);
        Assert.Empty(_http.Requests);
    }

    // -----------------------------------------------------------------------
    // La falla es de la persona, no de la métrica
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Una_persona_bloqueada_no_le_saca_el_perfil_a_las_demas()
    {
        // El stub ya guardó el cuerpo de esta request antes de llamar al respondedor.
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                _http.LastRequest.Body!.Contains("BLOQUEAR") ? GeminiBlocked() : GeminiProfile()),
        });

        var results = await Analyze(Service(), Person("A"), Person("B", word: "BLOQUEAR"));

        var a = results.Single(item => item.PersonId == "A");
        var b = results.Single(item => item.PersonId == "B");
        Assert.Equal(AiMetricStatus.Ready, a.Status);
        Assert.Equal(AiMetricStatus.Failed, b.Status);
        Assert.Equal(AiErrorCode.Blocked, b.ErrorCode);
        Assert.Null(b.LabelId);
        Assert.Null(b.Summary);
        Assert.True(b.RetryAvailableAtUtc > DateTime.UtcNow.AddSeconds(100));
    }

    [Fact]
    public async Task Una_falla_de_configuracion_se_guarda_como_failed_con_su_cooldown()
    {
        _http.Always(HttpStatusCode.BadRequest, "{\"error\":{}}");

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal(AiMetricStatus.Failed, result.Status);
        Assert.Equal(AiErrorCode.Config, result.ErrorCode);
        Assert.NotNull(result.RetryAvailableAtUtc);
        // Un 400 no se reintenta adentro: no lo arregla una segunda llamada idéntica.
        Assert.Single(_http.Requests);
    }

    [Fact]
    public async Task Una_persona_en_enfriamiento_no_llega_a_Google()
    {
        var person = Person("A");
        _db.Context.AiProfileResults.Add(new AiProfileResult
        {
            UserId = _userId,
            SourceHash = Hash,
            PersonId = "A",
            Language = "es",
            Status = AiMetricStatus.Failed,
            ErrorCode = AiErrorCode.Quota,
            RetryAvailableAtUtc = DateTime.UtcNow.AddMinutes(2),
        });
        await _db.Context.SaveChangesAsync();

        var result = Assert.Single(await Analyze(Service(), person));

        Assert.Empty(_http.Requests);
        Assert.Equal(AiMetricStatus.Failed, result.Status);
        Assert.Equal(AiErrorCode.Quota, result.ErrorCode);
        Assert.NotNull(result.RetryAvailableAtUtc);
    }

    [Fact]
    public async Task Pasado_el_enfriamiento_se_reintenta_y_la_fila_pasa_a_ready()
    {
        _db.Context.AiProfileResults.Add(new AiProfileResult
        {
            UserId = _userId,
            SourceHash = Hash,
            PersonId = "A",
            Language = "es",
            Status = AiMetricStatus.Failed,
            ErrorCode = AiErrorCode.Quota,
            RetryAvailableAtUtc = DateTime.UtcNow.AddSeconds(-5),
            AttemptCount = 1,
        });
        await _db.Context.SaveChangesAsync();
        GeminiAlwaysWritesAProfile();

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Null(result.ErrorCode);
        Assert.Null(result.RetryAvailableAtUtc);

        var stored = await _db.NewContext().AiProfileResults.SingleAsync();
        Assert.Equal(2, stored.AttemptCount);
    }

    // -----------------------------------------------------------------------
    // Validar lo que escribió el modelo
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Una_etiqueta_fuera_de_la_lista_se_reintenta_una_vez_con_la_correccion()
    {
        _http.Enqueue(HttpStatusCode.OK, GeminiProfile("tóxico"));
        _http.Enqueue(HttpStatusCode.OK, GeminiProfile("seco"));

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal(AiMetricStatus.Ready, result.Status);
        Assert.Equal("seco", result.LabelId);
        Assert.Equal(2, _http.Requests.Count);
        Assert.DoesNotContain("Tu respuesta anterior", _http.Requests[0].Body);
        Assert.Contains("Tu respuesta anterior no se pudo usar (la etiqueta no es un id de la lista)", _http.Requests[1].Body);
    }

    [Fact]
    public async Task Si_el_reintento_tampoco_sirve_la_persona_queda_en_invalid()
    {
        _http.Always(HttpStatusCode.OK, GeminiProfile("narcisista"));

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal(AiMetricStatus.Failed, result.Status);
        Assert.Equal(AiErrorCode.Invalid, result.ErrorCode);
        Assert.Equal(2, _http.Requests.Count);
        Assert.Null(result.LabelId);
    }

    [Fact]
    public async Task Un_resumen_que_copia_una_frase_del_chat_se_descarta()
    {
        var copied = "Dice que A escribe 3 en el grupo cada vez que puede, siempre con un tono muy cercano.";
        _http.Always(HttpStatusCode.OK, GeminiProfile(summary: copied));

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal(AiErrorCode.Invalid, result.ErrorCode);
    }

    [Fact]
    public async Task Normaliza_la_etiqueta_con_acento_y_descarta_la_segunda_si_repite_la_primera()
    {
        _http.Always(HttpStatusCode.OK, GeminiProfile("Cariñoso", "CARIÑOSO"));

        var result = Assert.Single(await Analyze(Service(), Person("A")));

        Assert.Equal("carinoso", result.LabelId);
        Assert.Null(result.SecondaryLabelId);
    }

    [Fact]
    public void Validate_acepta_un_perfil_bien_formado_y_le_limpia_los_espacios()
    {
        var person = new AiProfilePerson("A", new Dictionary<string, double>(), ["hola que tal"]);

        var (valid, reason) = AiProfileService.Validate(
            new AiProfileAnswer("Líder", "bromista", "  Mueve   al grupo y propone planes   casi todos los fines de semana.  "),
            person);

        Assert.Null(reason);
        Assert.Equal("lider", valid!.Label);
        Assert.Equal("bromista", valid.Secondary);
        Assert.Equal("Mueve al grupo y propone planes casi todos los fines de semana.", valid.Summary);
    }

    [Theory]
    [InlineData("Habla poco.", "demasiado corto")]
    [InlineData("Mira https://ejemplo.com/perfil y comparte links con todo el grupo a toda hora.", "links, mails o teléfonos")]
    [InlineData("Mandá un mail a ana@ejemplo.com para saber como escribe en este chat de amigos.", "links, mails o teléfonos")]
    [InlineData("Llamalo al +54 9 11 5555 1234 y vas a ver que responde rápido a cualquier hora.", "links, mails o teléfonos")]
    public void Validate_rechaza_los_resúmenes_inservibles(string summary, string expectedReason)
    {
        var person = new AiProfilePerson("A", new Dictionary<string, double>(), ["hola que tal"]);

        var (valid, reason) = AiProfileService.Validate(new AiProfileAnswer("seco", null, summary), person);

        Assert.Null(valid);
        Assert.Contains(expectedReason, reason);
    }

    [Fact]
    public void Validate_rechaza_un_resumen_demasiado_largo()
    {
        var person = new AiProfilePerson("A", new Dictionary<string, double>(), ["hola"]);

        var (valid, reason) = AiProfileService.Validate(
            new AiProfileAnswer("seco", null, string.Join(' ', Enumerable.Repeat("palabra", 120))),
            person);

        Assert.Null(valid);
        Assert.Contains("demasiado largo", reason);
    }

    [Fact]
    public void Validate_deja_pasar_palabras_sueltas_del_chat_pero_no_frases()
    {
        var person = new AiProfilePerson(
            "A",
            new Dictionary<string, double>(),
            ["che hermano mirá lo que me pasó ayer con el colectivo"]);

        // Tres palabras seguidas: es "palabras sueltas", la cuota que se permite.
        var (loose, _) = AiProfileService.Validate(
            new AiProfileAnswer("confianzudo", null, "Arranca con \"che hermano mirá\" casi siempre y trata a todos como amigos de toda la vida."),
            person);
        // Cuatro seguidas: ya es copiar la frase.
        var (copied, reason) = AiProfileService.Validate(
            new AiProfileAnswer("confianzudo", null, "Dice \"che hermano mirá lo\" todo el tiempo y trata a todos como amigos de toda la vida."),
            person);

        Assert.NotNull(loose);
        Assert.Null(copied);
        Assert.Contains("copia frases completas", reason);
    }

    // -----------------------------------------------------------------------
    // Acotar lo que manda el navegador
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Descarta_los_ids_que_no_son_una_sola_letra_mayuscula_o_que_se_repiten()
    {
        GeminiAlwaysWritesAProfile();

        var results = await Analyze(
            Service(),
            Person("a"),
            Person("AB"),
            Person(""),
            Person(null),
            Person("1"),
            Person("C"),
            Person("C"));

        Assert.Equal(["C"], results.Select(item => item.PersonId));
        Assert.Single(_http.Requests);
    }

    [Fact]
    public async Task Descarta_a_quien_manda_menos_mensajes_que_el_minimo()
    {
        GeminiAlwaysWritesAProfile();

        var results = await Analyze(Service(), Person("A", messages: 9), Person("B", messages: 10));

        Assert.Equal(["B"], results.Select(item => item.PersonId));
    }

    [Fact]
    public async Task Ignora_los_mensajes_vacios_al_contar_el_minimo()
    {
        GeminiAlwaysWritesAProfile();
        var padded = new AiProfilePersonInput(
            "A",
            null,
            [.. Enumerable.Repeat("", 20), .. Enumerable.Range(1, 5).Select(index => $"mensaje {index}")]);

        var results = await Analyze(Service(), padded);

        Assert.Empty(results);
    }

    [Fact]
    public async Task Recorta_la_cantidad_de_personas_y_de_mensajes_al_tope_configurado()
    {
        GeminiAlwaysWritesAProfile();
        var settings = new GoogleAiOptions { ApiKey = "clave", MaxProfilePeople = 2, MaxProfileMessages = 12 };

        var results = await Analyze(
            Service(settings),
            Person("A", messages: 30, word: "tope"),
            Person("B", messages: 30, word: "tope"),
            Person("C", messages: 30, word: "tope"));

        Assert.Equal(["A", "B"], results.Select(item => item.PersonId));
        Assert.Equal(2, _http.Requests.Count);

        var occurrences = _http.Requests[0].Body!.Split("tope").Length - 1;
        Assert.Equal(12, occurrences);
    }

    [Fact]
    public async Task Recorta_cada_mensaje_largo_y_junta_los_saltos_de_linea()
    {
        GeminiAlwaysWritesAProfile();
        var settings = new GoogleAiOptions { ApiKey = "clave", MaxProfileMessageChars = 50 };
        var messages = Enumerable.Range(1, 12).Select(_ => "x" + new string('y', 500) + "\n\nfinal").ToList();

        await Analyze(Service(settings), new AiProfilePersonInput("A", null, messages));

        var body = _http.LastRequest.Body!;
        Assert.Contains(new string('y', 49), body);
        Assert.DoesNotContain(new string('y', 50), body);
        Assert.DoesNotContain("final", body);
    }

    [Fact]
    public async Task Acota_los_numeros_fuera_de_rango_y_deja_afuera_las_claves_desconocidas()
    {
        GeminiAlwaysWritesAProfile();
        var person = new AiProfilePersonInput(
            "A",
            new Dictionary<string, double> { ["avgWords"] = 1_000_000_000, ["claveInventada"] = 777, ["share"] = -4 },
            Enumerable.Range(1, 12).Select(index => $"mensaje {index}").ToList());

        await Analyze(Service(), person);

        var body = _http.LastRequest.Body!;
        Assert.Contains("100000", body);
        Assert.DoesNotContain("1000000000", body);
        Assert.DoesNotContain("claveInventada", body);
        Assert.DoesNotContain("777", body);
        // Un porcentaje negativo se acota a cero.
        Assert.Contains("que escribe: 0%", body);
    }

    [Fact]
    public async Task Acepta_a_alguien_sin_numeros_solo_con_la_muestra()
    {
        GeminiAlwaysWritesAProfile();

        var result = Assert.Single(await Analyze(Service(), Person("A", features: null)));

        Assert.Equal(AiMetricStatus.Ready, result.Status);
    }

    // -----------------------------------------------------------------------
    // Presupuesto diario
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Frena_un_chat_nuevo_cuando_se_agoto_el_tope_diario_pero_no_el_que_ya_estaba_contado()
    {
        GeminiAlwaysWritesAProfile();
        var settings = new GoogleAiOptions { ApiKey = "clave", MaxChatsPerDay = 1 };
        var service = Service(settings);

        await service.AnalyzeAsync(_userId, Hash, "es", Group(), [Person("A")], default);
        var callsBefore = _http.Requests.Count;

        await Assert.ThrowsAsync<AiDailyLimitReachedException>(() =>
            service.AnalyzeAsync(_userId, OtherHash, "es", Group(), [Person("A")], default));

        // El chat que ya contaba hoy pasa de largo: el tope nunca deja a alguien a mitad
        // del chat que está mirando. (Y como ya estaba perfilado, no cuesta nada.)
        var again = Assert.Single(await service.AnalyzeAsync(_userId, Hash, "es", Group(), [Person("A")], default));

        Assert.Equal(AiMetricStatus.Ready, again.Status);
        Assert.Equal(callsBefore, _http.Requests.Count);
    }

    [Fact]
    public async Task Los_chats_analizados_por_las_metricas_de_palabras_clave_cuentan_en_el_mismo_tope()
    {
        _db.Context.AiMetricResults.Add(new AiMetricResult
        {
            UserId = _userId,
            SourceHash = OtherHash,
            MetricId = "redflags",
            Status = AiMetricStatus.Ready,
        });
        await _db.Context.SaveChangesAsync();
        var settings = new GoogleAiOptions { ApiKey = "clave", MaxChatsPerDay = 1 };

        await Assert.ThrowsAsync<AiDailyLimitReachedException>(() =>
            Service(settings).AnalyzeAsync(_userId, Hash, "es", Group(), [Person("A")], default));

        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Y_los_chats_perfilados_cuentan_para_las_metricas_de_palabras_clave()
    {
        GeminiAlwaysWritesAProfile();
        var settings = new GoogleAiOptions { ApiKey = "clave", MaxChatsPerDay = 1 };
        await Service(settings).AnalyzeAsync(_userId, OtherHash, "es", Group(), [Person("A")], default);

        var metrics = new AiMetricService(
            _db.Context,
            Gemini(settings),
            Opt.Of(settings),
            NullLogger<AiMetricService>.Instance);

        await Assert.ThrowsAsync<AiDailyLimitReachedException>(() =>
            metrics.AnalyzeAsync(_userId, Hash, [new AiMetricRequestItem("redflags", [new("1", "celos", "*A: hola")])], default));
    }

    [Fact]
    public async Task Un_tope_en_cero_o_negativo_lo_desactiva()
    {
        GeminiAlwaysWritesAProfile();
        var settings = new GoogleAiOptions { ApiKey = "clave", MaxChatsPerDay = 0 };
        var service = Service(settings);

        await service.AnalyzeAsync(_userId, Hash, "es", Group(), [Person("A")], default);
        await service.AnalyzeAsync(_userId, OtherHash, "es", Group(), [Person("A")], default);

        Assert.Equal(2, _http.Requests.Count);
    }

    // -----------------------------------------------------------------------
    // Contabilidad de tokens
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Registra_los_tokens_de_cada_llamada_a_nombre_de_la_cuenta()
    {
        _http.Always(HttpStatusCode.OK, GeminiProfile(input: 1500, output: 120));

        await Analyze(Service(), Person("A"), Person("B"));

        var usage = await _db.NewContext().AiUsage.ToListAsync();
        Assert.Equal(2, usage.Count);
        Assert.All(usage, item =>
        {
            Assert.Equal("personalidades", item.MetricId);
            Assert.Equal(_userId, item.UserId);
            Assert.Equal(1500, item.InputTokens);
            Assert.Equal(120, item.OutputTokens);
            Assert.True(item.Succeeded);
        });
    }

    [Fact]
    public async Task El_reintento_por_contenido_invalido_tambien_se_cobra()
    {
        _http.Enqueue(HttpStatusCode.OK, GeminiProfile("tóxico", input: 900, output: 60));
        _http.Enqueue(HttpStatusCode.OK, GeminiProfile("seco", input: 1000, output: 70));

        await Analyze(Service(), Person("A"));

        var usage = await _db.NewContext().AiUsage.OrderBy(item => item.InputTokens).ToListAsync();
        Assert.Equal([900, 1000], usage.Select(item => item.InputTokens));
        Assert.All(usage, item => Assert.True(item.Succeeded));
    }

    [Fact]
    public async Task Sin_metadata_de_uso_no_inventa_filas_de_gasto()
    {
        _http.Always(HttpStatusCode.OK, GeminiProfile());

        await Analyze(Service(), Person("A"));

        Assert.Equal(0, await _db.NewContext().AiUsage.CountAsync());
    }

    [Fact]
    public async Task Respeta_el_tope_de_concurrencia_aunque_sea_uno()
    {
        GeminiAlwaysWritesAProfile();
        var settings = new GoogleAiOptions { ApiKey = "clave", ProfileConcurrency = 0 };

        var results = await Analyze(Service(settings), Person("A"), Person("B"), Person("C"));

        Assert.Equal(3, results.Count);
        Assert.All(results, item => Assert.Equal(AiMetricStatus.Ready, item.Status));
    }
}
