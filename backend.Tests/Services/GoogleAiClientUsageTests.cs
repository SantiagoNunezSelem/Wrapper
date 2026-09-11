using System.Net;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// Lo que cuesta cada llamada a Gemini, leído de su <c>usageMetadata</c>. La regla: el costo
/// se registra si viene, y nunca cambia el veredicto.
/// </summary>
public class GoogleAiClientUsageTests
{
    private static GoogleAiClient Build(StubHttpMessageHandler http) =>
        new(http.CreateClient(), Opt.Of(new GoogleAiOptions { ApiKey = "clave" }), NullLogger<GoogleAiClient>.Instance);

    [Fact]
    public async Task Lee_los_tokens_y_suma_el_razonamiento_a_la_salida()
    {
        // Gemini cobra los tokens de razonamiento como salida.
        var http = new StubHttpMessageHandler();
        http.Enqueue(HttpStatusCode.OK, """
            {"candidates":[{"content":{"parts":[{"text":"{\"ids\":[\"1\"]}"}]}}],
             "usageMetadata":{"promptTokenCount":120,"candidatesTokenCount":8,"thoughtsTokenCount":30}}
            """);

        var outcome = await Build(http).ClassifyAsync("sistema", "usuario", default);

        Assert.True(outcome.IsSuccess);
        Assert.Equal(["1"], outcome.AcceptedIds);
        Assert.Equal(120, outcome.InputTokens);
        Assert.Equal(38, outcome.OutputTokens);
    }

    [Fact]
    public async Task Sin_usageMetadata_los_tokens_quedan_nulos_y_el_veredicto_igual()
    {
        var http = new StubHttpMessageHandler();
        http.Enqueue(HttpStatusCode.OK, """{"candidates":[{"content":{"parts":[{"text":"{\"ids\":[]}"}]}}]}""");

        var outcome = await Build(http).ClassifyAsync("sistema", "usuario", default);

        Assert.True(outcome.IsSuccess);
        Assert.Null(outcome.InputTokens);
        Assert.Null(outcome.OutputTokens);
    }

    [Fact]
    public async Task Un_bloqueo_igual_cuenta_los_tokens_que_consumio()
    {
        // Un rechazo por el filtro de seguridad llega como 200 y también se cobra.
        var http = new StubHttpMessageHandler();
        http.Enqueue(HttpStatusCode.OK, """
            {"promptFeedback":{"blockReason":"PROHIBITED_CONTENT"},"usageMetadata":{"promptTokenCount":90}}
            """);

        var outcome = await Build(http).ClassifyAsync("sistema", "usuario", default);

        Assert.False(outcome.IsSuccess);
        Assert.Equal(AiErrorCode.Blocked, outcome.ErrorCode);
        Assert.Equal(90, outcome.InputTokens);
        Assert.Equal(0, outcome.OutputTokens);
    }

    [Fact]
    public void Un_cuerpo_que_no_es_JSON_no_rompe_la_lectura_del_costo()
    {
        var outcome = GoogleAiClient.WithUsage(AiCallOutcome.Success(["1"]), "no es json");

        Assert.True(outcome.IsSuccess);
        Assert.Null(outcome.InputTokens);
    }
}
