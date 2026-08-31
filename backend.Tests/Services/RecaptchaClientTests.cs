using System.Net;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// Envoltorio de <c>siteverify</c>. Lo único que esta clase decide es la distinción que
/// después usa el endpoint de login: <em>"Google dijo que no"</em> (un veredicto, hay que
/// respetarlo) contra <em>"Google no contestó"</em> (una caída, y sólo el operador decide
/// qué significa). Colapsar las dos dejaría pasar bots o bloquearía a todos los usuarios
/// reales durante un hipo de Google.
/// </summary>
public class RecaptchaClientTests
{
    private static (RecaptchaClient Client, StubHttpMessageHandler Http) Build(Action<StubHttpMessageHandler> setup)
    {
        var http = new StubHttpMessageHandler();
        setup(http);

        var client = new RecaptchaClient(
            http.CreateClient(),
            Opt.Of(new RecaptchaOptions { TimeoutSeconds = 5 }),
            NullLogger<RecaptchaClient>.Instance);

        return (client, http);
    }

    private static Task<RecaptchaVerification?> Verify(RecaptchaClient client) =>
        client.VerifyAsync("secreto", "token", CancellationToken.None);

    [Fact]
    public async Task Un_token_válido_devuelve_score_y_acción()
    {
        var (client, _) = Build(stub => stub.Enqueue(
            HttpStatusCode.OK,
            """{"success":true,"score":0.9,"action":"login"}"""));

        var verification = await Verify(client);

        Assert.NotNull(verification);
        Assert.True(verification.Success);
        Assert.Equal(0.9, verification.Score);
        Assert.Equal("login", verification.Action);
    }

    [Fact]
    public async Task Un_rechazo_de_Google_es_un_veredicto_no_un_null()
    {
        var (client, _) = Build(stub => stub.Enqueue(
            HttpStatusCode.OK,
            """{"success":false,"error-codes":["invalid-input-response"]}"""));

        var verification = await Verify(client);

        Assert.NotNull(verification);
        Assert.False(verification.Success);
    }

    [Fact]
    public async Task Un_checkbox_v2_resuelto_no_trae_score_ni_acción()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"success":true}"""));

        var verification = await Verify(client);

        Assert.NotNull(verification);
        Assert.True(verification.Success);
        Assert.Null(verification.Score);
        Assert.Null(verification.Action);
    }

    [Fact]
    public async Task Manda_el_secreto_y_el_token_como_formulario()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"success":true}"""));

        await Verify(client);

        Assert.Equal("https://www.google.com/recaptcha/api/siteverify", http.LastRequest.Uri.ToString());
        Assert.Equal(HttpMethod.Post, http.LastRequest.Method);
        Assert.Contains("secret=secreto", http.LastRequest.Body);
        Assert.Contains("response=token", http.LastRequest.Body);
    }

    // -----------------------------------------------------------------------
    // "Google no contestó" → null
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task Un_código_de_error_HTTP_no_es_un_veredicto(HttpStatusCode status)
    {
        var (client, _) = Build(stub => stub.Enqueue(status, "algo salió mal"));

        Assert.Null(await Verify(client));
    }

    [Fact]
    public async Task Un_fallo_de_red_no_es_un_veredicto()
    {
        var (client, _) = Build(stub => stub.EnqueueTransportFailure());

        Assert.Null(await Verify(client));
    }

    [Fact]
    public async Task Un_timeout_no_es_un_veredicto()
    {
        var (client, _) = Build(stub => stub.EnqueueTimeout());

        Assert.Null(await Verify(client));
    }

    [Fact]
    public async Task Una_respuesta_ilegible_no_es_un_veredicto()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "<html>", "text/html"));

        Assert.Null(await Verify(client));
    }

    [Fact]
    public async Task Un_cuerpo_literalmente_null_no_es_un_veredicto()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "null"));

        Assert.Null(await Verify(client));
    }

    [Fact]
    public async Task Una_cancelación_del_llamador_sí_se_propaga()
    {
        var (client, _) = Build(stub => stub.EnqueueTimeout());
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            client.VerifyAsync("secreto", "token", cts.Token));
    }
}
