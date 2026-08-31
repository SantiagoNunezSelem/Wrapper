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
