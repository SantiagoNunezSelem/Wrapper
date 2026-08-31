using System.Net;
using System.Text.Json;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// El único lugar que conoce la API key de Google. Además de traducir la respuesta,
/// tiene que degradar cada forma de falla en un <see cref="AiErrorCode"/> — una métrica
/// de IA rota se convierte en un botón de reintento, nunca en una pantalla caída.
/// </summary>
public class GoogleAiClientTests
{
    private const string ApiKey = "AIza-clave-de-prueba";

    private static (GoogleAiClient Client, StubHttpMessageHandler Http) Build(
        Action<StubHttpMessageHandler> setup,
        GoogleAiOptions? options = null)
    {
        var http = new StubHttpMessageHandler();
        setup(http);

        var client = new GoogleAiClient(
            http.CreateClient(),
            Opt.Of(options ?? new GoogleAiOptions { ApiKey = ApiKey }),
            NullLogger<GoogleAiClient>.Instance);

        return (client, http);
    }

    /// <summary>Una respuesta feliz de Gemini con la lista de ids aceptados.</summary>
    private static string Answer(params string[] ids)
    {
        var payload = JsonSerializer.Serialize(new { ids });
        return JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = payload } } } } },
        });
    }

    private static Task<AiCallOutcome> Classify(GoogleAiClient client) =>
        client.ClassifyAsync("instrucción", "#1 [x]\n*A: hola", CancellationToken.None);

    // -----------------------------------------------------------------------
    // Configuración
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_API_key_falla_como_config_y_NO_llama_a_Google()
    {
        var (client, http) = Build(_ => { }, new GoogleAiOptions { ApiKey = "" });

        var outcome = await Classify(client);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(AiErrorCode.Config, outcome.ErrorCode);
        Assert.Empty(http.Requests);
    }

    [Fact]
    public async Task Manda_la_key_en_un_encabezado_y_NUNCA_en_la_URL()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer("1")));

        await Classify(client);

        Assert.Equal(ApiKey, http.LastRequest.Headers["x-goog-api-key"]);
        Assert.DoesNotContain(ApiKey, http.LastRequest.Uri.ToString());
    }

    [Fact]
    public async Task Arma_la_URL_con_el_endpoint_y_el_modelo_configurados()
    {
        var (client, http) = Build(
            stub => stub.Enqueue(HttpStatusCode.OK, Answer("1")),
            new GoogleAiOptions { ApiKey = ApiKey, Endpoint = "https://ai.example/v1beta/", Model = "gemini-x" });

        await Classify(client);

        Assert.Equal("https://ai.example/v1beta/models/gemini-x:generateContent", http.LastRequest.Uri.ToString());
    }

    [Fact]
    public async Task Pide_salida_estructurada_y_desactiva_los_filtros_de_contenido()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer("1")));

        await Classify(client);

        var body = http.LastRequest.Body!;
        Assert.Contains("\"responseMimeType\":\"application/json\"", body);
        Assert.Contains("\"required\":[\"ids\"]", body);
        // El trabajo es justamente clasificar lenguaje subido de tono u hostil: con los
        // filtros por defecto, Gemini se negaría a mirar exactamente lo que hay que mirar.
        Assert.Contains("HARM_CATEGORY_SEXUALLY_EXPLICIT", body);
        Assert.Contains("BLOCK_NONE", body);
        Assert.Contains("\"temperature\":0", body);
    }

    [Fact]
    public async Task Incluye_el_presupuesto_de_razonamiento_cuando_es_cero_o_mas()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer("1")));

        await Classify(client);

        Assert.Contains("\"thinkingBudget\":0", http.LastRequest.Body);
    }

    [Fact]
    public async Task Omite_el_presupuesto_de_razonamiento_cuando_es_negativo()
    {
        // -1 significa "este modelo rechaza el campo": hay que no mandarlo, no mandarlo
        // en null, que la API también rechaza.
        var (client, http) = Build(
            stub => stub.Enqueue(HttpStatusCode.OK, Answer("1")),
            new GoogleAiOptions { ApiKey = ApiKey, ThinkingBudget = -1 });

        await Classify(client);

        Assert.DoesNotContain("thinkingConfig", http.LastRequest.Body);
    }

    // -----------------------------------------------------------------------
    // Respuestas buenas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Devuelve_los_ids_aceptados()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer("1", "3")));

        var outcome = await Classify(client);

        Assert.True(outcome.IsSuccess);
        Assert.Equal(["1", "3"], outcome.AcceptedIds);
        Assert.Null(outcome.ErrorCode);
    }

    [Fact]
    public async Task Una_lista_vacía_es_un_veredicto_válido()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer()));

        var outcome = await Classify(client);

        Assert.True(outcome.IsSuccess);
        Assert.Empty(outcome.AcceptedIds);
    }

    [Fact]
    public async Task Le_saca_el_numeral_a_los_ids_que_el_modelo_devuelve_como_en_el_prompt()
    {
        // Verificado contra gemini-3.1-flash-lite: responde "#2" para el candidato "2".
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer("#2", " #3 ")));

        var outcome = await Classify(client);

        Assert.Equal(["2", "3"], outcome.AcceptedIds);
    }

    [Fact]
    public async Task Descarta_los_ids_vacíos()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, Answer("1", "", "   ")));

        var outcome = await Classify(client);

        Assert.Equal(["1"], outcome.AcceptedIds);
    }

    [Fact]
    public async Task Une_las_partes_cuando_el_modelo_parte_la_respuesta()
    {
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[]
            {
                new { content = new { parts = new[] { new { text = "{\"ids\":[\"1\"," }, new { text = "\"2\"]}" } } } },
            },
        });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        var outcome = await Classify(client);

        Assert.Equal(["1", "2"], outcome.AcceptedIds);
    }

    [Fact]
    public async Task Acepta_ids_numéricos_además_de_strings()
    {
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = "{\"ids\":[1,2]}" } } } } },
        });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        var outcome = await Classify(client);

        Assert.Equal(["1", "2"], outcome.AcceptedIds);
    }

    // -----------------------------------------------------------------------
    // Rechazos del modelo
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Un_prompt_bloqueado_llega_como_200_y_se_traduce_a_blocked()
    {
        var body = JsonSerializer.Serialize(new { promptFeedback = new { blockReason = "PROHIBITED_CONTENT" } });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        var outcome = await Classify(client);

        Assert.Equal(AiErrorCode.Blocked, outcome.ErrorCode);
    }

    [Fact]
    public async Task Una_respuesta_sin_candidatos_es_blocked()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "{\"candidates\":[]}"));

        var outcome = await Classify(client);

        Assert.Equal(AiErrorCode.Blocked, outcome.ErrorCode);
    }

    [Theory]
    [InlineData("SAFETY")]
    [InlineData("PROHIBITED_CONTENT")]
    [InlineData("BLOCKLIST")]
    public async Task Un_corte_temprano_por_seguridad_es_blocked(string finishReason)
    {
        var body = JsonSerializer.Serialize(new { candidates = new[] { new { finishReason } } });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        var outcome = await Classify(client);

        Assert.Equal(AiErrorCode.Blocked, outcome.ErrorCode);
    }

    [Fact]
    public async Task Un_corte_normal_no_es_blocked()
    {
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[]
            {
                new { finishReason = "STOP", content = new { parts = new[] { new { text = "{\"ids\":[\"1\"]}" } } } },
            },
        });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        Assert.True((await Classify(client)).IsSuccess);
    }

    // -----------------------------------------------------------------------
    // Respuestas mal formadas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Una_respuesta_con_texto_vacío_es_invalid()
    {
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = "  " } } } } },
        });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        Assert.Equal(AiErrorCode.Invalid, (await Classify(client)).ErrorCode);
    }

    [Fact]
    public async Task Una_respuesta_que_no_es_JSON_es_invalid()
    {
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = "claro, acá tenés:" } } } } },
        });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        Assert.Equal(AiErrorCode.Invalid, (await Classify(client)).ErrorCode);
    }

    [Fact]
    public async Task Una_respuesta_sin_el_array_ids_es_invalid()
    {
        var body = JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text = "{\"otra\":1}" } } } } },
        });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        Assert.Equal(AiErrorCode.Invalid, (await Classify(client)).ErrorCode);
    }

    [Fact]
    public async Task Un_cuerpo_que_no_es_JSON_es_invalid()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "<html>error</html>"));

        Assert.Equal(AiErrorCode.Invalid, (await Classify(client)).ErrorCode);
    }

    // -----------------------------------------------------------------------
    // Códigos de estado
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, AiErrorCode.Config)]
    [InlineData(HttpStatusCode.Forbidden, AiErrorCode.Config)]
    [InlineData(HttpStatusCode.BadRequest, AiErrorCode.Config)]
    [InlineData(HttpStatusCode.PaymentRequired, AiErrorCode.Quota)]
    [InlineData(HttpStatusCode.InternalServerError, AiErrorCode.Unavailable)]
    [InlineData(HttpStatusCode.ServiceUnavailable, AiErrorCode.Unavailable)]
    [InlineData(HttpStatusCode.NotFound, AiErrorCode.Unknown)]
    public async Task Traduce_el_código_de_estado_a_un_error_que_el_usuario_entiende(
        HttpStatusCode status,
        string expected)
    {
        var (client, _) = Build(stub => stub.Enqueue(status, "{\"error\":{}}"));

        var outcome = await Classify(client);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(expected, outcome.ErrorCode);
    }

    [Fact]
    public async Task Un_429_se_reintenta_una_sola_vez_y_después_es_quota()
    {
        var retryInfo = """
        {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0s"}]}}
        """;
        var (client, http) = Build(stub => stub
            .Enqueue(HttpStatusCode.TooManyRequests, retryInfo)
            .Enqueue(HttpStatusCode.TooManyRequests, retryInfo));

        var outcome = await Classify(client);

        Assert.Equal(AiErrorCode.Quota, outcome.ErrorCode);
        Assert.Equal(2, http.Requests.Count);
    }

    [Fact]
    public async Task Un_429_que_se_recupera_en_el_reintento_devuelve_el_veredicto()
    {
        var retryInfo = """
        {"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0s"}]}}
        """;
        var (client, http) = Build(stub => stub
            .Enqueue(HttpStatusCode.TooManyRequests, retryInfo)
            .Enqueue(HttpStatusCode.OK, Answer("1")));

        var outcome = await Classify(client);

        Assert.True(outcome.IsSuccess);
        Assert.Equal(["1"], outcome.AcceptedIds);
        Assert.Equal(2, http.Requests.Count);
    }

    // -----------------------------------------------------------------------
    // Fallas de transporte
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Un_fallo_de_red_es_unavailable_y_no_una_excepción()
    {
        var (client, _) = Build(stub => stub.EnqueueTransportFailure());

        var outcome = await Classify(client);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(AiErrorCode.Unavailable, outcome.ErrorCode);
    }

    [Fact]
    public async Task Un_timeout_propio_es_unavailable()
    {
        var (client, _) = Build(stub => stub.EnqueueTimeout());

        Assert.Equal(AiErrorCode.Unavailable, (await Classify(client)).ErrorCode);
    }

    [Fact]
    public async Task Una_cancelación_del_llamador_sí_se_propaga()
    {
        // Si el usuario abandonó la request, no hay que fingir un error de Gemini.
        var (client, _) = Build(stub => stub.EnqueueTimeout());
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            client.ClassifyAsync("instrucción", "contenido", cts.Token));
    }
}
