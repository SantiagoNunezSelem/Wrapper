using System.Net;
using System.Text.Json;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// La llamada que ESCRIBE en vez de clasificar. Misma regla que el resto del cliente —cada
/// forma de falla se vuelve un <see cref="AiErrorCode"/>, nunca una excepción—, pero con
/// dos diferencias que acá se fijan: la salida es un objeto con etiqueta y resumen, y los
/// filtros de seguridad NO se apagan, porque el modelo ya no solo lee texto hostil sino que
/// escribe sobre personas con nombre.
/// </summary>
public class GoogleAiClientProfileTests
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

    private static string Answer(object profile, object? usage = null) =>
        JsonSerializer.Serialize(new
        {
            candidates = new[]
            {
                new { content = new { parts = new[] { new { text = JsonSerializer.Serialize(profile) } } } },
            },
            usageMetadata = usage,
        });

    private static string GoodAnswer(object? usage = null) =>
        Answer(new { label = "bromista", secondary = "intenso", summary = "Se ríe de todo y arranca la mayoría de las charlas." }, usage);

    private static string RawText(string text) =>
        JsonSerializer.Serialize(new
        {
            candidates = new[] { new { content = new { parts = new[] { new { text } } } } },
        });

    private static Task<AiProfileCallOutcome> Generate(GoogleAiClient client) =>
        client.GenerateProfileAsync("instrucción", "Persona A\n- hola", CancellationToken.None);

    // -----------------------------------------------------------------------
    // Respuestas buenas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Devuelve_la_etiqueta_la_segunda_y_el_resumen()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()));

        var outcome = await Generate(client);

        Assert.True(outcome.IsSuccess);
        Assert.Null(outcome.ErrorCode);
        Assert.Equal("bromista", outcome.Answer!.Label);
        Assert.Equal("intenso", outcome.Answer.Secondary);
        Assert.Equal("Se ríe de todo y arranca la mayoría de las charlas.", outcome.Answer.Summary);
    }

    [Theory]
    [InlineData("{\"label\":\"seco\",\"summary\":\"Contesta en una palabra.\"}")]
    [InlineData("{\"label\":\"seco\",\"secondary\":\"   \",\"summary\":\"Contesta en una palabra.\"}")]
    [InlineData("{\"label\":\"seco\",\"secondary\":null,\"summary\":\"Contesta en una palabra.\"}")]
    [InlineData("{\"label\":\"seco\",\"secondary\":7,\"summary\":\"Contesta en una palabra.\"}")]
    public async Task La_segunda_etiqueta_es_opcional(string json)
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, RawText(json)));

        var outcome = await Generate(client);

        Assert.True(outcome.IsSuccess);
        Assert.Null(outcome.Answer!.Secondary);
    }

    [Fact]
    public async Task Le_recorta_los_espacios_a_lo_que_devuelve()
    {
        var (client, _) = Build(stub => stub.Enqueue(
            HttpStatusCode.OK,
            RawText("{\"label\":\"  lider \",\"summary\":\"  Mueve al grupo.  \"}")));

        var outcome = await Generate(client);

        Assert.Equal("lider", outcome.Answer!.Label);
        Assert.Equal("Mueve al grupo.", outcome.Answer.Summary);
    }

    [Fact]
    public async Task Adjunta_lo_que_costó_la_llamada_sumando_el_razonamiento_a_la_salida()
    {
        var (client, _) = Build(stub => stub.Enqueue(
            HttpStatusCode.OK,
            GoodAnswer(new { promptTokenCount = 1200, candidatesTokenCount = 90, thoughtsTokenCount = 10 })));

        var outcome = await Generate(client);

        Assert.Equal(1200, outcome.InputTokens);
        Assert.Equal(100, outcome.OutputTokens);
    }

    [Fact]
    public async Task Sin_metadata_de_uso_los_tokens_quedan_en_null_y_el_perfil_intacto()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()));

        var outcome = await Generate(client);

        Assert.True(outcome.IsSuccess);
        Assert.Null(outcome.InputTokens);
        Assert.Null(outcome.OutputTokens);
    }

    // -----------------------------------------------------------------------
    // Lo que se le manda a Google
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_API_key_falla_como_config_y_NO_llama_a_Google()
    {
        var (client, http) = Build(_ => { }, new GoogleAiOptions { ApiKey = "" });

        var outcome = await Generate(client);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(AiErrorCode.Config, outcome.ErrorCode);
        Assert.Empty(http.Requests);
    }

    [Fact]
    public async Task Manda_la_key_en_un_encabezado_y_NUNCA_en_la_URL()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()));

        await Generate(client);

        Assert.Equal(ApiKey, http.LastRequest.Headers["x-goog-api-key"]);
        Assert.DoesNotContain(ApiKey, http.LastRequest.Uri.ToString());
    }

    [Fact]
    public async Task Pide_un_objeto_con_etiqueta_y_resumen_obligatorios()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()));

        await Generate(client);

        var body = http.LastRequest.Body!;
        Assert.Contains("\"responseMimeType\":\"application/json\"", body);
        Assert.Contains("\"required\":[\"label\",\"summary\"]", body);
        // La etiqueta se valida contra la lista cerrada de nuestro lado: un `enum` en el
        // esquema que el modelo rechace se leería como una mala configuración.
        Assert.DoesNotContain("\"enum\"", body);
    }

    [Fact]
    public async Task Usa_la_temperatura_configurada()
    {
        var (client, http) = Build(
            stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()),
            new GoogleAiOptions { ApiKey = ApiKey, ProfileTemperature = 0.9 });

        await Generate(client);

        Assert.Contains("\"temperature\":0.9", http.LastRequest.Body);
    }

    [Fact]
    public async Task NO_apaga_los_filtros_de_seguridad_como_hace_la_clasificacion()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()));

        await Generate(client);

        var body = http.LastRequest.Body!;
        Assert.DoesNotContain("BLOCK_NONE", body);
        Assert.Contains("HARM_CATEGORY_HARASSMENT", body);
        Assert.Contains("BLOCK_ONLY_HIGH", body);
        // Contenido sexual: un escalón más estricto, porque el público incluye menores.
        Assert.Contains("BLOCK_MEDIUM_AND_ABOVE", body);
    }

    [Fact]
    public async Task Respeta_el_presupuesto_de_razonamiento()
    {
        var (withBudget, httpWith) = Build(stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()));
        await Generate(withBudget);
        Assert.Contains("\"thinkingBudget\":0", httpWith.LastRequest.Body);

        var (withoutBudget, httpWithout) = Build(
            stub => stub.Enqueue(HttpStatusCode.OK, GoodAnswer()),
            new GoogleAiOptions { ApiKey = ApiKey, ThinkingBudget = -1 });
        await Generate(withoutBudget);
        Assert.DoesNotContain("thinkingConfig", httpWithout.LastRequest.Body);
    }

    // -----------------------------------------------------------------------
    // Rechazos y respuestas inservibles
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Un_prompt_bloqueado_llega_como_200_y_se_traduce_a_blocked()
    {
        var body = JsonSerializer.Serialize(new { promptFeedback = new { blockReason = "PROHIBITED_CONTENT" } });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        Assert.Equal(AiErrorCode.Blocked, (await Generate(client)).ErrorCode);
    }

    [Fact]
    public async Task Una_respuesta_sin_candidatos_es_blocked()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "{\"candidates\":[]}"));

        Assert.Equal(AiErrorCode.Blocked, (await Generate(client)).ErrorCode);
    }

    [Fact]
    public async Task Un_corte_por_seguridad_es_blocked()
    {
        var body = JsonSerializer.Serialize(new { candidates = new[] { new { finishReason = "SAFETY" } } });
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        Assert.Equal(AiErrorCode.Blocked, (await Generate(client)).ErrorCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("esto no es json")]
    [InlineData("[\"bromista\"]")]
    [InlineData("{\"summary\":\"Sin etiqueta.\"}")]
    [InlineData("{\"label\":\"seco\"}")]
    [InlineData("{\"label\":7,\"summary\":\"Etiqueta que no es texto.\"}")]
    [InlineData("{\"label\":\"seco\",\"summary\":\"   \"}")]
    public async Task Una_respuesta_que_no_tiene_la_forma_pedida_es_invalid(string text)
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, RawText(text)));

        var outcome = await Generate(client);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(AiErrorCode.Invalid, outcome.ErrorCode);
    }

    [Fact]
    public async Task Un_cuerpo_que_no_es_json_es_invalid()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "<html>502</html>"));

        Assert.Equal(AiErrorCode.Invalid, (await Generate(client)).ErrorCode);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, AiErrorCode.Config)]
    [InlineData(HttpStatusCode.Unauthorized, AiErrorCode.Config)]
    [InlineData(HttpStatusCode.Forbidden, AiErrorCode.Config)]
    [InlineData(HttpStatusCode.PaymentRequired, AiErrorCode.Quota)]
    [InlineData(HttpStatusCode.NotFound, AiErrorCode.Unknown)]
    public async Task Cada_status_de_error_se_traduce_a_un_codigo_y_no_se_reintenta(HttpStatusCode status, string expected)
    {
        var (client, http) = Build(stub => stub.Always(status, "{\"error\":{}}"));

        var outcome = await Generate(client);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(expected, outcome.ErrorCode);
        Assert.Single(http.Requests);
    }
}
