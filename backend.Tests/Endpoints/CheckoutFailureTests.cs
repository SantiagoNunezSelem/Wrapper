using backend.Endpoints;
using backend.Services;

namespace backend.Tests.Endpoints;

/// <summary>
/// Por qué no se abrió el checkout, dicho de forma que la persona sepa si le sirve
/// reintentar. Sólo "Mercado Pago no respondió" se arregla solo; una integración mal
/// armada no, y mandarla a reintentar es mandarla a dar vueltas.
/// </summary>
public class CheckoutFailureTests
{
    [Fact]
    public void Si_Mercado_Pago_no_contesta_vale_la_pena_reintentar()
    {
        var timeout = new MercadoPagoException("Mercado Pago did not respond within 20s (POST /preapproval).");
        var network = new MercadoPagoException("Could not reach Mercado Pago (POST /preapproval).", new HttpRequestException("reset"));
        var serverError = new MercadoPagoException("Mercado Pago rejected POST /preapproval (503).", 503, "Service unavailable");

        Assert.Equal("provider_unreachable", SubscriptionEndpoints.DescribeCheckoutFailure(timeout).Code);
        Assert.Equal("provider_unreachable", SubscriptionEndpoints.DescribeCheckoutFailure(network).Code);
        Assert.Equal("provider_unreachable", SubscriptionEndpoints.DescribeCheckoutFailure(serverError).Code);
    }

    [Theory]
    [InlineData(400, "Both payer and collector must be real or test users")]
    [InlineData(400, "card_token_id is required")]
    [InlineData(404, "Card token service not found")]
    [InlineData(401, "invalid access token")]
    public void Una_integracion_mal_armada_no_se_arregla_reintentando(int status, string said)
    {
        var failure = new MercadoPagoException($"Mercado Pago rejected POST /preapproval ({status}). {said}", status, said);

        var (code, message) = SubscriptionEndpoints.DescribeCheckoutFailure(failure);

        Assert.Equal("provider_misconfigured", code);
        Assert.DoesNotContain("Probá de nuevo", message);
    }

    [Fact]
    public void Sin_credenciales_tambien_es_configuracion()
    {
        var failure = new MercadoPagoException("Mercado Pago is not configured: set MercadoPago:AccessToken.");

        Assert.Equal("provider_misconfigured", SubscriptionEndpoints.DescribeCheckoutFailure(failure).Code);
    }

    [Fact]
    public void Lo_que_no_se_reconoce_queda_con_el_mensaje_de_siempre()
    {
        var failure = new MercadoPagoException("Mercado Pago rejected POST /preapproval (400). Something new", 400, "Something new");

        var (code, message) = SubscriptionEndpoints.DescribeCheckoutFailure(failure);

        Assert.Equal("provider_error", code);
        Assert.Contains("No se te cobró nada", message);
    }
}
