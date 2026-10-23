using backend.Endpoints;
using backend.Models;
using backend.Services;

namespace backend.Tests.Endpoints;

/// <summary>
/// En qué situación está una suscripción para la pantalla. "pendiente" y "cancelada"
/// cubren cada uno casos que piden frases opuestas, y decir la equivocada es justo lo que
/// se vio en producción: "no se te cobró nada" a alguien que acababa de pagar, y "conservás
/// el acceso hasta que termine el período" semanas después de que terminó.
/// </summary>
public class SubscriptionPhaseTests
{
    private static string Phase(Subscription subscription) =>
        SubscriptionResponse.PhaseOf(subscription, SubscriptionAccessEvaluator.HasVipAccess(subscription));

    [Fact]
    public void Autorizada_y_esperando_el_primer_cobro_es_procesando_no_pago_sin_terminar()
    {
        var subscription = new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1", ProviderStatus = "authorized" };

        Assert.Equal("processing", Phase(subscription));
    }

    [Fact]
    public void Un_checkout_abierto_que_nadie_termino_se_puede_retomar()
    {
        var subscription = new Subscription
        {
            Status = "pendiente",
            ExternalSubscriptionId = "pre-1",
            ProviderStatus = "pending",
            CheckoutUrl = "https://mp.test/subscribe/pre-1",
        };

        Assert.Equal("checkout_open", Phase(subscription));
    }

    [Fact]
    public void Un_rechazo_es_un_rechazo_aunque_Mercado_Pago_ya_haya_cancelado_el_intento()
    {
        var pending = new Subscription { Status = "pendiente", LastPaymentStatus = "rejected", LastPaymentStatusDetail = "cc_rejected_other_reason" };
        var cancelled = new Subscription { Status = "cancelada", LastPaymentStatus = "rejected", LastPaymentStatusDetail = "cc_rejected_other_reason" };

        Assert.Equal("declined", Phase(pending));
        Assert.Equal("declined", Phase(cancelled));
    }

    [Fact]
    public void Un_intento_descartado_que_nunca_cobro_no_es_una_suscripcion_que_termino()
    {
        var subscription = new Subscription { Status = "cancelada", CancelledAtUtc = DateTime.UtcNow.AddDays(-2) };

        Assert.Equal("abandoned", Phase(subscription));
    }

    [Fact]
    public void Cancelada_con_el_periodo_pago_corriendo_conserva_el_acceso()
    {
        var subscription = new Subscription
        {
            Status = "cancelada",
            LastPaymentAtUtc = DateTime.UtcNow.AddDays(-10),
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
        };

        Assert.Equal("cancelled", Phase(subscription));
    }

    [Fact]
    public void Cancelada_con_el_periodo_ya_vencido_termino()
    {
        var subscription = new Subscription
        {
            Status = "cancelada",
            LastPaymentAtUtc = DateTime.UtcNow.AddDays(-40),
            NextBillingAtUtc = DateTime.UtcNow.AddDays(-10),
        };

        Assert.Equal("ended", Phase(subscription));
        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(UserWith(subscription)));
    }

    [Fact]
    public void Quitarle_el_Pro_desde_el_panel_la_termina_aunque_el_periodo_siga()
    {
        var subscription = new Subscription
        {
            Status = "cancelada",
            LastPaymentAtUtc = DateTime.UtcNow.AddDays(-2),
            NextBillingAtUtc = DateTime.UtcNow.AddDays(28),
            AccessRevokedAtUtc = DateTime.UtcNow.AddDays(-1),
        };

        Assert.Equal("ended", Phase(subscription));
        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(UserWith(subscription)));
    }

    [Theory]
    [InlineData("trial")]
    [InlineData("activa")]
    [InlineData("pago_fallido")]
    [InlineData("pausada")]
    public void Los_demas_estados_se_dicen_como_son(string status)
    {
        Assert.Equal(status, Phase(new Subscription { Status = status }));
    }

    private static User UserWith(Subscription subscription)
    {
        var user = new User { Email = "a@b.com" };
        user.Subscriptions.Add(subscription);
        return user;
    }
}
