using System.Net;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// El cliente HTTP contra Mercado Pago. Lo que se prueba acá es el contrato de la
/// llamada (autenticación, idempotencia, timeouts) y la traducción de cada respuesta,
/// nunca la red: todo pasa por <see cref="StubHttpMessageHandler"/>.
/// </summary>
public class MercadoPagoClientTests
{
    private const string Token = "TEST-1234567890";

    private static (MercadoPagoClient Client, StubHttpMessageHandler Http) Build(
        Action<StubHttpMessageHandler> setup,
        MercadoPagoOptions? options = null)
    {
        var http = new StubHttpMessageHandler();
        setup(http);

        var client = new MercadoPagoClient(
            http.CreateClient(),
            Opt.Of(options ?? new MercadoPagoOptions { AccessToken = Token }),
            NullLogger<MercadoPagoClient>.Instance);

        return (client, http);
    }

    // -----------------------------------------------------------------------
    // Configuración
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_access_token_falla_antes_de_llamar()
    {
        var (client, http) = Build(_ => { }, new MercadoPagoOptions { AccessToken = "" });

        await Assert.ThrowsAsync<MercadoPagoException>(() => client.GetSubscriptionAsync("abc", default));
        Assert.Empty(http.Requests);
    }

    [Fact]
    public void IsConfigured_refleja_si_hay_token()
    {
        var (configured, _) = Build(_ => { });
        var (missing, _) = Build(_ => { }, new MercadoPagoOptions { AccessToken = "" });

        Assert.True(configured.IsConfigured);
        Assert.False(missing.IsConfigured);
    }

    [Fact]
    public async Task Manda_el_token_como_bearer()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "{}"));

        await client.GetSubscriptionAsync("abc", default);

        Assert.Equal($"Bearer {Token}", http.LastRequest.Headers["Authorization"]);
    }

    [Fact]
    public async Task Usa_la_URL_base_configurada()
    {
        var (client, http) = Build(
            stub => stub.Enqueue(HttpStatusCode.OK, "{}"),
            new MercadoPagoOptions { AccessToken = Token, ApiBaseUrl = "https://mp.example/" });

        await client.GetSubscriptionAsync("abc", default);

        Assert.Equal("https://mp.example/preapproval/abc", http.LastRequest.Uri.ToString());
    }

    [Fact]
    public async Task Toda_escritura_lleva_clave_de_idempotencia()
    {
        // Sin ella, un timeout que en realidad funcionó del lado de Mercado Pago deja al
        // cliente con dos suscripciones y dos cobros mensuales.
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "{}"));

        await client.CancelSubscriptionAsync("abc", default);

        Assert.True(http.LastRequest.Headers.ContainsKey("X-Idempotency-Key"));
        Assert.True(Guid.TryParse(http.LastRequest.Headers["X-Idempotency-Key"], out _));
    }

    [Fact]
    public async Task Dos_escrituras_llevan_claves_de_idempotencia_distintas()
    {
        var (client, http) = Build(stub => stub.Always(HttpStatusCode.OK, "{}"));

        await client.CancelSubscriptionAsync("abc", default);
        await client.CancelSubscriptionAsync("def", default);

        Assert.NotEqual(
            http.Requests[0].Headers["X-Idempotency-Key"],
            http.Requests[1].Headers["X-Idempotency-Key"]);
    }

    [Fact]
    public async Task Una_lectura_no_lleva_clave_de_idempotencia()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "{}"));

        await client.GetSubscriptionAsync("abc", default);

        Assert.False(http.LastRequest.Headers.ContainsKey("X-Idempotency-Key"));
    }

    // -----------------------------------------------------------------------
    // Creación del plan
    // -----------------------------------------------------------------------

    [Fact]
    public async Task El_plan_con_trial_declara_la_prueba_gratis_de_forma_nativa()
    {
        // Simular el trial localmente rompería la conversión automática al día 8.
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"plan-1","init_point":"https://mp/x"}"""));

        await client.CreatePlanAsync(includeFreeTrial: true, default);

        Assert.Contains("\"free_trial\"", http.LastRequest.Body);
        Assert.Contains("\"frequency\":7", http.LastRequest.Body);
        Assert.Contains("\"frequency_type\":\"days\"", http.LastRequest.Body);
        Assert.EndsWith("/preapproval_plan", http.LastRequest.Uri.AbsolutePath);
    }

    [Fact]
    public async Task El_plan_sin_trial_se_distingue_por_nombre()
    {
        // Mercado Pago aplica el free_trial del plan a TODOS sus suscriptores, así que
        // "sin segunda semana gratis" tiene que ser un plan distinto.
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"plan-2"}"""));

        await client.CreatePlanAsync(includeFreeTrial: false, default);

        Assert.Contains("sin prueba gratis", http.LastRequest.Body);
    }

    [Fact]
    public async Task El_plan_sin_trial_manda_hoy_free_trial_en_null_documenta_el_bug()
    {
        // Bug abierto. `SendAsync` serializa con DefaultIgnoreCondition.WhenWritingNull,
        // pero esa opción NO se aplica a los valores de un Dictionary<string, object?>:
        // sólo a propiedades de un POCO. El resultado es que el plan sin prueba gratis
        // viaja con "free_trial": null en vez de sin el campo — exactamente la clase de
        // envío que el propio GoogleAiClient documenta como rechazado por su API.
        // Ver "Hallazgos" en TESTING.md.
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"plan-2"}"""));

        await client.CreatePlanAsync(includeFreeTrial: false, default);

        Assert.Contains("\"free_trial\":null", http.LastRequest.Body);
    }

    [Fact(Skip = "Bug abierto: el campo se manda en null en vez de omitirse. Ver TESTING.md.")]
    public async Task El_plan_sin_trial_DEBERIA_omitir_el_campo_free_trial()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"plan-2"}"""));

        await client.CreatePlanAsync(includeFreeTrial: false, default);

        Assert.DoesNotContain("free_trial", http.LastRequest.Body);
    }

    [Fact]
    public async Task El_plan_lleva_el_precio_y_la_moneda_configurados()
    {
        var options = new MercadoPagoOptions { AccessToken = Token, TransactionAmount = 9900m, CurrencyId = "UYU" };
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"plan-3"}"""), options);

        await client.CreatePlanAsync(includeFreeTrial: true, default);

        Assert.Contains("9900", http.LastRequest.Body);
        Assert.Contains("\"currency_id\":\"UYU\"", http.LastRequest.Body);
    }

    [Fact]
    public async Task Un_plan_sin_cuerpo_de_respuesta_es_un_error_explicito()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, ""));

        await Assert.ThrowsAsync<MercadoPagoException>(() => client.CreatePlanAsync(true, default));
    }

    [Fact]
    public async Task En_localhost_el_back_url_cae_al_sitio_de_Mercado_Pago()
    {
        // Mercado Pago rechaza un back_url que apunte a localhost.
        var options = new MercadoPagoOptions { AccessToken = Token, BackUrl = "http://localhost:5173" };
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"p"}"""), options);

        await client.CreatePlanAsync(true, default);

        Assert.Contains("mercadopago.com", http.LastRequest.Body);
        Assert.DoesNotContain("localhost", http.LastRequest.Body);
    }

    [Fact]
    public void Con_un_dominio_real_el_back_url_vuelve_a_la_pantalla_de_suscripcion()
    {
        var options = new MercadoPagoOptions { BackUrl = "https://vistazo.app/" };

        Assert.Equal("https://vistazo.app/suscripcion?checkout=return", options.CheckoutReturnUrl);
    }

    // -----------------------------------------------------------------------
    // Lecturas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Deserializa_la_suscripcion_con_los_nombres_de_Mercado_Pago()
    {
        var body = """
        {
          "id": "pre-1",
          "status": "authorized",
          "payer_id": 987654,
          "payer_email": "ana@example.com",
          "external_reference": "abc",
          "preapproval_plan_id": "plan-1",
          "next_payment_date": "2025-04-10T00:00:00.000-03:00",
          "payment_method_id": "visa",
          "auto_recurring": { "transaction_amount": 7900, "currency_id": "ARS", "free_trial": { "frequency": 7 } },
          "summarized": { "charged_quantity": 2, "last_charged_date": "2025-03-10T00:00:00.000-03:00" }
        }
        """;
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        var preapproval = await client.GetSubscriptionAsync("pre-1", default);

        Assert.NotNull(preapproval);
        Assert.Equal("pre-1", preapproval.Id);
        Assert.Equal("authorized", preapproval.Status);
        Assert.Equal(987654, preapproval.PayerId);
        Assert.Equal("ana@example.com", preapproval.PayerEmail);
        Assert.Equal("plan-1", preapproval.PreapprovalPlanId);
        Assert.Equal(7900m, preapproval.AutoRecurring!.TransactionAmount);
        Assert.NotNull(preapproval.AutoRecurring.FreeTrial);
        Assert.Equal(2, preapproval.Summarized!.ChargedQuantity);
    }

    [Fact]
    public async Task Un_404_en_una_lectura_es_una_respuesta_valida_no_un_error()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.NotFound, """{"message":"not found"}"""));

        Assert.Null(await client.GetSubscriptionAsync("no-existe", default));
    }

    [Fact]
    public async Task Un_404_en_una_escritura_SI_es_un_error()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.NotFound, """{"message":"not found"}"""));

        await Assert.ThrowsAsync<MercadoPagoException>(() => client.CancelSubscriptionAsync("no-existe", default));
    }

    [Fact]
    public async Task Una_busqueda_sin_resultados_devuelve_lista_vacia()
    {
        var (client, _) = Build(stub => stub.Always(HttpStatusCode.OK, """{"results":[]}"""));

        Assert.Empty(await client.SearchSubscriptionsByPayerEmailAsync("ana@example.com", default));
        Assert.Empty(await client.SearchAuthorizedPaymentsAsync("pre-1", default));
    }

    [Fact]
    public async Task Una_busqueda_sin_el_campo_results_tampoco_rompe()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "{}"));

        Assert.Empty(await client.SearchSubscriptionsByPayerEmailAsync("ana@example.com", default));
    }

    [Fact]
    public async Task Escapa_el_email_en_la_busqueda()
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"results":[]}"""));

        await client.SearchSubscriptionsByPayerEmailAsync("ana+test@example.com", default);

        Assert.Contains("ana%2Btest%40example.com", http.LastRequest.Uri.Query);
    }

    [Fact]
    public async Task Deserializa_un_cobro_con_su_detalle_de_pago()
    {
        var body = """
        {
          "id": 555,
          "preapproval_id": "pre-1",
          "status": "processed",
          "transaction_amount": 7900,
          "currency_id": "ARS",
          "retry_attempt": 2,
          "period": { "start_date": "2025-03-10T00:00:00Z", "end_date": "2025-04-10T00:00:00Z" },
          "payment": { "id": 999, "status": "approved", "payment_method_id": "visa", "last_four_digits": "6411" }
        }
        """;
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, body));

        var payment = await client.GetAuthorizedPaymentAsync("555", default);

        Assert.Equal(555, payment!.Id);
        Assert.Equal("pre-1", payment.PreapprovalId);
        Assert.Equal(2, payment.RetryAttempt);
        Assert.Equal("6411", payment.Payment!.LastFourDigits);
    }

    // -----------------------------------------------------------------------
    // Escrituras de estado
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("cancel", "cancelled")]
    [InlineData("pause", "paused")]
    [InlineData("resume", "authorized")]
    public async Task Cada_cambio_de_estado_manda_su_status(string action, string expected)
    {
        var (client, http) = Build(stub => stub.Enqueue(HttpStatusCode.OK, """{"id":"pre-1"}"""));

        _ = action switch
        {
            "cancel" => await client.CancelSubscriptionAsync("pre-1", default),
            "pause" => await client.PauseSubscriptionAsync("pre-1", default),
            _ => await client.ResumeSubscriptionAsync("pre-1", default),
        };

        Assert.Equal(HttpMethod.Put, http.LastRequest.Method);
        Assert.Contains($"\"status\":\"{expected}\"", http.LastRequest.Body);
    }

    // -----------------------------------------------------------------------
    // Errores
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Un_error_de_Mercado_Pago_conserva_su_mensaje()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.BadRequest, """{"message":"invalid preapproval_plan_id"}"""));

        var error = await Assert.ThrowsAsync<MercadoPagoException>(() => client.CancelSubscriptionAsync("x", default));

        Assert.Contains("invalid preapproval_plan_id", error.Message);
        Assert.Contains("400", error.Message);
    }

    [Fact]
    public async Task Un_error_sin_JSON_igual_produce_un_mensaje_util()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.BadGateway, "<html>Bad Gateway</html>"));

        var error = await Assert.ThrowsAsync<MercadoPagoException>(() => client.CancelSubscriptionAsync("x", default));

        Assert.Contains("502", error.Message);
    }

    [Fact]
    public async Task Un_fallo_de_red_se_traduce_a_MercadoPagoException()
    {
        var (client, _) = Build(stub => stub.EnqueueTransportFailure());

        var error = await Assert.ThrowsAsync<MercadoPagoException>(() => client.GetSubscriptionAsync("x", default));

        Assert.Contains("Could not reach Mercado Pago", error.Message);
    }

    [Fact]
    public async Task Un_timeout_se_traduce_a_MercadoPagoException()
    {
        var (client, _) = Build(stub => stub.EnqueueTimeout());

        var error = await Assert.ThrowsAsync<MercadoPagoException>(() => client.GetSubscriptionAsync("x", default));

        Assert.Contains("did not respond", error.Message);
    }

    [Fact]
    public async Task Una_respuesta_ilegible_se_traduce_a_MercadoPagoException()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, "no es json"));

        await Assert.ThrowsAsync<MercadoPagoException>(() => client.GetSubscriptionAsync("x", default));
    }

    [Fact]
    public async Task Un_cuerpo_vacio_con_200_no_es_un_error()
    {
        var (client, _) = Build(stub => stub.Enqueue(HttpStatusCode.OK, ""));

        Assert.Null(await client.GetSubscriptionAsync("x", default));
    }

    [Fact]
    public async Task Una_cancelacion_del_llamador_se_propaga()
    {
        var (client, _) = Build(stub => stub.EnqueueTimeout());
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.GetSubscriptionAsync("x", cts.Token));
    }

    [Fact]
    public void Distingue_credenciales_de_prueba_de_las_de_produccion()
    {
        Assert.True(new MercadoPagoOptions { AccessToken = "TEST-123" }.IsTestCredential);
        Assert.False(new MercadoPagoOptions { AccessToken = "APP_USR-123" }.IsTestCredential);
    }
}
