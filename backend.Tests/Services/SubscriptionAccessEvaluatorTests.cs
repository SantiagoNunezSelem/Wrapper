using backend.Models;
using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// La regla que decide si una cuenta ve las métricas Pro. Es el único lugar donde se
/// responde "¿esta persona pagó?", así que cada estado del ciclo de vida tiene su caso.
/// </summary>
public class SubscriptionAccessEvaluatorTests
{
    private static readonly DateTime Future = DateTime.UtcNow.AddDays(10);
    private static readonly DateTime Past = DateTime.UtcNow.AddDays(-10);

    private static Subscription Sub(
        string status,
        DateTime? nextBilling = null,
        DateTime? trialEnds = null,
        DateTime? graceEnds = null,
        DateTime? createdAt = null) =>
        new()
        {
            Status = status,
            NextBillingAtUtc = nextBilling,
            TrialEndsAtUtc = trialEnds,
            GraceEndsAtUtc = graceEnds,
            CreatedAtUtc = createdAt ?? DateTime.UtcNow,
        };

    private static User UserWith(params Subscription[] subscriptions)
    {
        var user = new User { Email = "a@b.com" };
        user.Subscriptions.AddRange(subscriptions);
        return user;
    }

    // -----------------------------------------------------------------------
    // Por suscripción
    // -----------------------------------------------------------------------

    [Fact]
    public void Trial_vigente_da_acceso()
    {
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(Sub("trial", trialEnds: Future)));
    }

    [Fact]
    public void Trial_vencido_no_da_acceso()
    {
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub("trial", trialEnds: Past)));
    }

    [Fact]
    public void Trial_sin_fecha_de_fin_no_da_acceso()
    {
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub("trial")));
    }

    [Fact]
    public void Activa_con_proximo_cobro_en_el_futuro_da_acceso()
    {
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(Sub("activa", nextBilling: Future)));
    }

    [Fact]
    public void Activa_sin_proximo_cobro_da_acceso()
    {
        // Sin fecha de renovación no hay motivo para cortar: es lo que devuelve Mercado
        // Pago mientras todavía no programó el siguiente débito.
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(Sub("activa")));
    }

    [Fact]
    public void Activa_con_cobro_vencido_no_da_acceso()
    {
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub("activa", nextBilling: Past)));
    }

    [Fact]
    public void Pago_fallido_dentro_de_la_gracia_conserva_el_acceso()
    {
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(Sub("pago_fallido", graceEnds: Future)));
    }

    [Fact]
    public void Pago_fallido_pasada_la_gracia_lo_pierde()
    {
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub("pago_fallido", graceEnds: Past)));
    }

    [Fact]
    public void Pago_fallido_sin_ventana_de_gracia_no_da_acceso()
    {
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub("pago_fallido")));
    }

    [Theory]
    [InlineData("cancelada")]
    [InlineData("pausada")]
    public void Cancelada_o_pausada_conservan_el_periodo_ya_pagado(string status)
    {
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(Sub(status, nextBilling: Future)));
    }

    [Theory]
    [InlineData("cancelada")]
    [InlineData("pausada")]
    public void Cancelada_o_pausada_durante_el_trial_lo_conservan_hasta_el_final(string status)
    {
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(Sub(status, trialEnds: Future)));
    }

    [Theory]
    [InlineData("cancelada")]
    [InlineData("pausada")]
    public void Cancelada_o_pausada_con_el_periodo_terminado_no_dan_acceso(string status)
    {
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub(status, nextBilling: Past, trialEnds: Past)));
    }

    [Theory]
    [InlineData("pendiente")]
    [InlineData("inactiva")]
    [InlineData("")]
    [InlineData("un_estado_que_no_existe")]
    public void Un_estado_sin_regla_nunca_da_acceso(string status)
    {
        // El `_ => false` del switch: cualquier estado nuevo que Mercado Pago invente
        // arranca cerrado, no abierto.
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(Sub(status, nextBilling: Future)));
    }

    // -----------------------------------------------------------------------
    // Por usuario
    // -----------------------------------------------------------------------

    [Fact]
    public void Un_admin_siempre_tiene_acceso_aunque_no_tenga_suscripciones()
    {
        var user = UserWith();
        user.IsAdmin = true;

        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(user));
        Assert.Equal("activa", SubscriptionAccessEvaluator.GetVisibleState(user));
    }

    [Fact]
    public void Un_usuario_sin_suscripciones_figura_inactivo()
    {
        var user = UserWith();

        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(user));
        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(user));
    }

    [Fact]
    public void Con_varias_suscripciones_gana_la_que_hoy_da_acceso()
    {
        var cancelled = Sub("cancelada", nextBilling: Past, createdAt: DateTime.UtcNow.AddDays(-1));
        var active = Sub("activa", nextBilling: Future, createdAt: DateTime.UtcNow.AddDays(-100));
        var user = UserWith(cancelled, active);

        Assert.Same(active, SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user));
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(user));
        Assert.Equal("activa", SubscriptionAccessEvaluator.GetVisibleState(user));
    }

    [Fact]
    public void Sin_ninguna_vigente_describe_la_mas_reciente()
    {
        var old = Sub("cancelada", nextBilling: DateTime.UtcNow.AddDays(-200), createdAt: DateTime.UtcNow.AddDays(-300));
        var recent = Sub("pago_fallido", graceEnds: Past, createdAt: DateTime.UtcNow.AddDays(-5));
        var user = UserWith(old, recent);

        Assert.Same(recent, SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user));
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(user));
        Assert.Equal("pago_fallido", SubscriptionAccessEvaluator.GetVisibleState(user));
    }

    // -----------------------------------------------------------------------
    // "pendiente" son dos cosas distintas
    //
    // Adentro se guardan igual: un cobro que Mercado Pago está procesando y un checkout
    // que alguien abrió y cerró sin pagar. Para quien lo lee no se parecen en nada — uno
    // es "tu plata está en camino" y el otro es "no pasó nada" — así que el estado que
    // ven los shells al lado del nombre no puede ser el mismo.
    // -----------------------------------------------------------------------

    [Fact]
    public void Un_checkout_abandonado_NO_figura_como_pago_pendiente()
    {
        // Abrir el pago y cerrar la pestaña no le debe poner a nadie un cartel diciendo
        // que tiene plata dando vueltas.
        var user = UserWith(Sub("pendiente"));

        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(user));
        Assert.False(SubscriptionAccessEvaluator.HasPaymentInFlight(user.Subscriptions[0]));
    }

    [Fact]
    public void Un_cobro_que_Mercado_Pago_esta_procesando_SI_figura_pendiente()
    {
        var pending = Sub("pendiente");
        pending.LastPaymentStatusDetail = "pending_contingency";

        Assert.Equal("pendiente", SubscriptionAccessEvaluator.GetVisibleState(UserWith(pending)));
        Assert.True(SubscriptionAccessEvaluator.HasPaymentInFlight(pending));
    }

    [Fact]
    public void Una_tarjeta_rechazada_tampoco_es_un_pago_en_curso()
    {
        // El intento terminó y no se cobró nada. Decir "procesando" prometería que Pro
        // está por prenderse solo; lo cierto es que hay que volver a intentarlo — y el
        // motivo real ya se muestra aparte.
        var declined = Sub("pendiente");
        declined.LastPaymentStatusDetail = "cc_rejected_insufficient_amount";

        Assert.False(SubscriptionAccessEvaluator.HasPaymentInFlight(declined));
        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(UserWith(declined)));
    }

    [Fact]
    public void Un_status_detail_desconocido_se_asume_en_curso()
    {
        // De los dos errores posibles con un código nuevo, decirle "lo seguimos" a alguien
        // cuyo pago ya murió es mucho más barato que decirle "no pasó nada" a alguien que
        // tiene la plata en movimiento.
        var unknown = Sub("pendiente");
        unknown.LastPaymentStatusDetail = "algo_que_mercado_pago_agregue";

        Assert.True(SubscriptionAccessEvaluator.HasPaymentInFlight(unknown));
    }

    // -----------------------------------------------------------------------
    // Qué pasó con el cobro: lo decide el `status` del pago, no la redacción del
    // `status_detail`. Los casos salen de la tabla de Mercado Pago ("Consulta sobre el
    // estado de un pago").
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("in_process", "pending_contingency", PaymentOutcomes.InProgress)]
    [InlineData("pending", "pending_challenge", PaymentOutcomes.InProgress)]
    [InlineData("in_process", "deferred_retry", PaymentOutcomes.InProgress)]
    [InlineData("authorized", "pending_capture", PaymentOutcomes.InProgress)]
    [InlineData("rejected", "cc_rejected_insufficient_amount", PaymentOutcomes.Declined)]
    [InlineData("rejected", "cc_amount_rate_limit_exceeded", PaymentOutcomes.Declined)]
    [InlineData("rejected", "insufficient_amount", PaymentOutcomes.Declined)]
    [InlineData("rejected", "bank_error", PaymentOutcomes.Declined)]
    [InlineData("rejected", "algo_que_mercado_pago_agregue", PaymentOutcomes.Declined)]
    [InlineData("cancelled", "expired", PaymentOutcomes.Cancelled)]
    [InlineData("refunded", "by_admin", PaymentOutcomes.Refunded)]
    [InlineData("charged_back", "in_process", PaymentOutcomes.Disputed)]
    [InlineData("in_mediation", "pending", PaymentOutcomes.Disputed)]
    public void El_status_del_pago_decide_que_paso(string status, string detail, string expected)
    {
        var subscription = Sub("pendiente");
        subscription.LastPaymentStatus = status;
        subscription.LastPaymentStatusDetail = detail;

        Assert.Equal(expected, SubscriptionAccessEvaluator.DescribeLastPayment(subscription));
    }

    [Theory]
    // Los que antes se leían como "procesando" por no empezar con cc_rejected/rejected:
    // le decían a la persona que esperara una plata que nunca iba a llegar.
    [InlineData("cc_amount_rate_limit_exceeded")]
    [InlineData("insufficient_amount")]
    [InlineData("refunded")]
    [InlineData("charged_back")]
    public void Un_limite_de_tarjeta_una_devolucion_o_una_disputa_no_son_un_pago_en_curso(string status)
    {
        var subscription = Sub("pendiente");
        subscription.LastPaymentStatus = status is "refunded" or "charged_back" ? status : "rejected";
        subscription.LastPaymentStatusDetail = status is "refunded" or "charged_back" ? "by_admin" : status;

        Assert.False(SubscriptionAccessEvaluator.HasPaymentInFlight(subscription));
        Assert.Equal("inactiva", SubscriptionAccessEvaluator.GetVisibleState(UserWith(subscription)));
    }

    [Theory]
    // Filas guardadas antes de que se guardara el status: se lee el detail según la tabla.
    [InlineData("cc_amount_rate_limit_exceeded", PaymentOutcomes.Declined)]
    [InlineData("bank_error", PaymentOutcomes.Declined)]
    [InlineData("by_payer", PaymentOutcomes.Cancelled)]
    [InlineData("refunded", PaymentOutcomes.Refunded)]
    [InlineData("settled", PaymentOutcomes.Disputed)]
    [InlineData("pending_contingency", PaymentOutcomes.InProgress)]
    [InlineData("algo_que_mercado_pago_agregue", PaymentOutcomes.InProgress)]
    public void Sin_status_guardado_se_lee_el_detail(string detail, string expected)
    {
        var subscription = Sub("pendiente");
        subscription.LastPaymentStatusDetail = detail;

        Assert.Equal(expected, SubscriptionAccessEvaluator.DescribeLastPayment(subscription));
    }

    [Fact]
    public void Sin_ningun_cobro_reportado_no_hay_nada_que_describir()
    {
        var subscription = Sub("pendiente");
        subscription.LastPaymentStatus = "rejected";

        Assert.Null(SubscriptionAccessEvaluator.DescribeLastPayment(subscription));
    }

    [Fact]
    public void Ninguno_de_los_dos_da_acceso_Pro()
    {
        var pending = Sub("pendiente");
        pending.LastPaymentStatusDetail = "pending_contingency";

        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(UserWith(Sub("pendiente"))));
        Assert.False(SubscriptionAccessEvaluator.HasVipAccess(UserWith(pending)));
    }

    [Fact]
    public void Desempata_por_fecha_de_creacion_cuando_no_hay_fechas_de_periodo()
    {
        var older = Sub("inactiva", createdAt: DateTime.UtcNow.AddDays(-10));
        var newer = Sub("pendiente", createdAt: DateTime.UtcNow.AddDays(-1));
        var user = UserWith(older, newer);

        Assert.Same(newer, SubscriptionAccessEvaluator.GetLatestRelevantSubscription(user));
    }

    [Fact]
    public void El_admin_no_necesita_que_su_suscripcion_semilla_este_vigente()
    {
        var user = UserWith(Sub("cancelada", nextBilling: Past));
        user.IsAdmin = true;

        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(user));
    }
}
