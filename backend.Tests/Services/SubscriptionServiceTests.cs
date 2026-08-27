using System.Net;
using System.Text;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// El ciclo de vida completo de una suscripción. La regla que gobierna todo el archivo:
/// <b>Mercado Pago decide, nosotros registramos</b> — nada de avanzar el estado local de
/// forma optimista después de un redirect, porque lo único que mueve plata está del otro
/// lado.
/// </summary>
public class SubscriptionServiceTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();
    private readonly StubHttpMessageHandler _http = new();

    public void Dispose() => _db.Dispose();

    private SubscriptionService Service(MercadoPagoOptions? options = null)
    {
        var settings = options ?? new MercadoPagoOptions { AccessToken = "TEST-123" };
        var client = new MercadoPagoClient(_http.CreateClient(), Opt.Of(settings), NullLogger<MercadoPagoClient>.Instance);
        var fingerprint = new ClientFingerprint(Opt.Of(new TrialGuardOptions()), Opt.Of(new JwtOptions()));
        var trials = new TrialEligibilityService(
            _db.Context,
            fingerprint,
            Opt.Of(new TrialGuardOptions()),
            NullLogger<TrialEligibilityService>.Instance);

        return new SubscriptionService(_db.Context, client, trials, Opt.Of(settings), NullLogger<SubscriptionService>.Instance);
    }

    private User CreateUser(bool hasUsedTrial = false, params Subscription[] subscriptions)
    {
        var user = new User
        {
            Email = $"{Guid.NewGuid():N}@example.com",
            DisplayName = "Test",
            HasUsedTrial = hasUsedTrial,
        };
        user.Subscriptions.AddRange(subscriptions);
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
        return user;
    }

    private static HttpContext Context()
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("203.0.113.7");
        return context;
    }

    /// <summary>
    /// Arma un JSON de prueba reemplazando marcadores <c>@nombre@</c>.
    ///
    /// No se usa interpolación de cadenas: las respuestas de Mercado Pago están llenas de
    /// llaves anidadas, y un <c>}}</c> de cierre choca con el delimitador de interpolación
    /// de C#. Con marcadores, el JSON queda escrito tal cual llega por la red.
    /// </summary>
    private static string Json(string template, params (string Token, object Value)[] values)
    {
        foreach (var (token, value) in values)
        {
            var text = value is DateTime date ? date.ToString("yyyy-MM-ddTHH:mm:ssZ") : value.ToString();
            template = template.Replace($"@{token}@", text);
        }

        return template;
    }

    /// <summary>Responde según la ruta, que es lo que hace falta cuando un solo flujo
    /// pega a `/preapproval_plan`, `/preapproval` y `/authorized_payments`.</summary>
    private void RouteMercadoPago(
        string? plan = null,
        string? preapproval = null,
        string? createdPreapproval = null,
        string? preapprovalSearch = null,
        string? paymentsSearch = null,
        string? payment = null,
        string? authorizedPayment = null)
    {
        _http.Route(request =>
        {
            var path = request.RequestUri!.AbsolutePath;

            // POST /preapproval (abrir una suscripcion) y GET /preapproval/{id} (leerla)
            // comparten prefijo pero son cosas distintas, asi que el metodo tambien decide.
            var isCreate = path.TrimEnd('/').EndsWith("/preapproval") && request.Method == HttpMethod.Post;

            var body = path switch
            {
                var p when p.Contains("preapproval_plan") => plan ?? """{"id":"plan-1","init_point":"https://mp.test/checkout"}""",
                var p when p.Contains("/preapproval/search") => preapprovalSearch ?? """{"results":[]}""",
                _ when isCreate => createdPreapproval ?? """{"id":"pre-1","status":"pending","init_point":"https://mp.test/subscribe/pre-1"}""",
                var p when p.Contains("/preapproval") => preapproval ?? """{"id":"pre-1","status":"pending"}""",
                var p when p.Contains("/authorized_payments/search") => paymentsSearch ?? """{"results":[]}""",
                var p when p.Contains("/v1/payments/") => payment ?? """{"id":1,"status":"approved","status_detail":"accredited"}""",
                _ => authorizedPayment ?? "{}",
            };

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
        });
    }

    /// <summary>
    /// El camino viejo: mandar a todos al init_point compartido del plan en vez de crear
    /// un preapproval por pagador. Sigue existiendo como fallback (hay cuentas donde
    /// <c>POST /preapproval</c> es rechazado), asi que se prueba explicitamente.
    /// </summary>
    private static MercadoPagoOptions PlanCheckout(Action<MercadoPagoOptions>? configure = null)
    {
        var options = new MercadoPagoOptions { AccessToken = "TEST-1", UseDirectPreapproval = false };
        configure?.Invoke(options);
        return options;
    }

    // =======================================================================
    // Plan publicado
    // =======================================================================

    [Fact]
    public void GetPlanInfo_devuelve_lo_configurado()
    {
        var options = new MercadoPagoOptions
        {
            AccessToken = "TEST-1", TransactionAmount = 7900m, CurrencyId = "ARS",
            Frequency = 1, FrequencyType = "months", TrialFrequency = 7, TrialFrequencyType = "days",
            Reason = "Vistazo Pro",
        };

        var plan = Service(options).GetPlanInfo();

        Assert.Equal(7900m, plan.Amount);
        Assert.Equal("ARS", plan.CurrencyId);
        Assert.Equal("Vistazo Pro", plan.Reason);
        Assert.True(plan.ProviderConfigured);
    }

    [Fact]
    public void GetPlanInfo_avisa_cuando_el_proveedor_no_esta_configurado()
    {
        // La landing tiene que poder mostrar el precio igual y explicar que el checkout
        // todavía no está disponible, en vez de abrir un flujo condenado a fallar.
        Assert.False(Service(new MercadoPagoOptions { AccessToken = "" }).GetPlanInfo().ProviderConfigured);
    }

    // =======================================================================
    // Checkout
    // =======================================================================

    [Fact]
    public async Task Sin_credenciales_el_checkout_falla_explicitamente()
    {
        var user = CreateUser();

        await Assert.ThrowsAsync<MercadoPagoException>(() =>
            Service(new MercadoPagoOptions { AccessToken = "" }).StartCheckoutAsync(user, Context(), null, default));
    }

    [Fact]
    public async Task El_checkout_crea_una_fila_pendiente_y_devuelve_el_init_point()
    {
        RouteMercadoPago();
        var user = CreateUser();

        var result = await Service().StartCheckoutAsync(user, Context(), "device-abc", default);

        Assert.Equal("pendiente", result.Status);
        Assert.Equal("https://mp.test/subscribe/pre-1", result.RedirectUrl);
        Assert.True(result.TrialApplied);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("pendiente", stored.Status);
        Assert.Equal("mercadopago", stored.PaymentProvider);
        // El id externo YA está, antes de mandar a nadie a pagar: es lo que hace que la
        // notificación posterior encuentre esta fila en vez de quedar huérfana.
        Assert.Equal("pre-1", stored.ExternalSubscriptionId);
        Assert.Equal("https://mp.test/subscribe/pre-1", stored.CheckoutUrl);
    }

    [Fact]
    public async Task El_checkout_quema_el_trial_aunque_el_pagador_abandone()
    {
        RouteMercadoPago();
        var user = CreateUser();

        await Service().StartCheckoutAsync(user, Context(), "device-abc", default);

        var reread = _db.NewContext();
        Assert.True(await reread.Users.Where(item => item.Id == user.Id).Select(item => item.HasUsedTrial).SingleAsync());
        Assert.Equal(1, await reread.TrialClaims.CountAsync());
    }

    [Fact]
    public async Task Sin_trial_disponible_no_se_registra_ningun_reclamo()
    {
        RouteMercadoPago();
        var user = CreateUser(hasUsedTrial: true);

        var result = await Service().StartCheckoutAsync(user, Context(), null, default);

        Assert.False(result.TrialApplied);
        Assert.Equal("account_used", result.TrialDeniedReason);
        Assert.Equal(0, await _db.NewContext().TrialClaims.CountAsync());
    }

    [Fact]
    public async Task El_checkout_deja_un_evento_en_el_historial()
    {
        RouteMercadoPago();
        var user = CreateUser();

        await Service().StartCheckoutAsync(user, Context(), null, default);

        var record = await _db.NewContext().SubscriptionEvents.SingleAsync();
        Assert.Equal("checkout", record.Topic);
        Assert.Equal("trial", record.Action);
        Assert.Equal("pendiente", record.ResultingStatus);
    }

    [Fact]
    public async Task El_evento_anota_por_que_se_negó_el_trial()
    {
        RouteMercadoPago();
        var user = CreateUser(hasUsedTrial: true);

        await Service().StartCheckoutAsync(user, Context(), null, default);

        var record = await _db.NewContext().SubscriptionEvents.SingleAsync();
        Assert.Equal("no_trial", record.Action);
        Assert.Contains("account_used", record.Notes);
    }

    [Theory]
    [InlineData("activa")]
    [InlineData("trial")]
    public async Task No_se_puede_abrir_un_checkout_con_una_suscripcion_vigente(string status)
    {
        RouteMercadoPago();
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = status,
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            TrialEndsAtUtc = DateTime.UtcNow.AddDays(5),
        });

        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().StartCheckoutAsync(user, Context(), null, default));

        Assert.Equal("already_active", error.Code);
    }

    [Fact]
    public async Task Una_suscripcion_simulada_no_bloquea_el_checkout_real()
    {
        RouteMercadoPago();
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            IsDevSimulated = true,
        });

        var result = await Service().StartCheckoutAsync(user, Context(), null, default);

        Assert.Equal("pendiente", result.Status);
    }

    [Fact]
    public async Task Una_suscripcion_cancelada_no_bloquea_un_checkout_nuevo()
    {
        RouteMercadoPago();
        var user = CreateUser(subscriptions: new Subscription { Status = "cancelada", NextBillingAtUtc = DateTime.UtcNow.AddDays(-1) });

        var result = await Service().StartCheckoutAsync(user, Context(), null, default);

        Assert.Equal("pendiente", result.Status);
    }

    [Fact]
    public async Task Un_plan_sin_init_point_es_un_error_explicito()
    {
        RouteMercadoPago(plan: """{"id":"plan-1"}""");
        var user = CreateUser();

        await Assert.ThrowsAsync<MercadoPagoException>(() =>
            Service(PlanCheckout()).StartCheckoutAsync(user, Context(), null, default));
    }

    // =======================================================================
    // Resolución del plan
    // =======================================================================

    [Fact]
    public async Task Usa_el_plan_configurado_sin_crear_ninguno()
    {
        RouteMercadoPago();
        var options = PlanCheckout(item => item.PreapprovalPlanId = "plan-configurado");

        await Service(options).StartCheckoutAsync(CreateUser(), Context(), null, default);

        Assert.DoesNotContain(_http.Requests, request => request.Method == HttpMethod.Post);
        Assert.Contains(_http.Requests, request => request.Uri.AbsolutePath.EndsWith("plan-configurado"));
    }

    [Fact]
    public async Task Una_cuenta_sin_trial_usa_el_plan_sin_prueba_gratis()
    {
        RouteMercadoPago();
        var options = PlanCheckout(item =>
        {
            item.PreapprovalPlanId = "plan-con-trial";
            item.PreapprovalPlanIdNoTrial = "plan-sin-trial";
        });

        await Service(options).StartCheckoutAsync(CreateUser(hasUsedTrial: true), Context(), null, default);

        Assert.Contains(_http.Requests, request => request.Uri.AbsolutePath.EndsWith("plan-sin-trial"));
    }

    [Fact]
    public async Task Sin_plan_configurado_lo_crea_y_lo_guarda()
    {
        RouteMercadoPago();

        await Service(PlanCheckout()).StartCheckoutAsync(CreateUser(), Context(), null, default);

        var setting = await _db.NewContext().AppSettings.SingleAsync();
        Assert.StartsWith("mercadopago.plan.trial.", setting.Key);
        Assert.Equal("plan-1", setting.Value);
    }

    [Fact]
    public async Task El_plan_creado_se_reusa_en_el_siguiente_checkout()
    {
        RouteMercadoPago();
        var service = Service(PlanCheckout());
        // Las dos cuentas ya usaron su trial, así que ambas resuelven el MISMO plan (el
        // que no tiene prueba gratis). Con una elegible y otra no, cada una resolvería un
        // plan distinto y el test no probaría nada sobre la caché.
        await service.StartCheckoutAsync(CreateUser(hasUsedTrial: true), Context(), null, default);
        var creations = _http.Requests.Count(request => request.Method == HttpMethod.Post);
        Assert.Equal(1, creations);

        await service.StartCheckoutAsync(CreateUser(hasUsedTrial: true), Context(), null, default);

        Assert.Equal(creations, _http.Requests.Count(request => request.Method == HttpMethod.Post));
    }

    [Fact]
    public async Task Cambiar_el_precio_produce_un_plan_nuevo_en_vez_de_cobrar_el_viejo()
    {
        RouteMercadoPago();
        await Service(PlanCheckout(item => item.TransactionAmount = 7900m))
            .StartCheckoutAsync(CreateUser(), Context(), null, default);

        await Service(PlanCheckout(item => item.TransactionAmount = 9900m))
            .StartCheckoutAsync(CreateUser(), Context(), null, default);

        Assert.Equal(2, await _db.NewContext().AppSettings.CountAsync());
    }

    [Fact]
    public async Task Con_la_creacion_automatica_apagada_y_sin_plan_falla()
    {
        RouteMercadoPago();
        var options = PlanCheckout(item => item.AutoCreatePlan = false);

        await Assert.ThrowsAsync<MercadoPagoException>(() =>
            Service(options).StartCheckoutAsync(CreateUser(), Context(), null, default));
    }

    // =======================================================================
    // Cancelación
    // =======================================================================

    [Fact]
    public async Task Cancelar_sin_suscripcion_es_un_conflicto()
    {
        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() =>
            Service().CancelAsync(CreateUser(), default));

        Assert.Equal("no_subscription", error.Code);
    }

    [Fact]
    public async Task Cancelar_una_suscripcion_ya_cancelada_no_hace_nada()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "cancelada", ExternalSubscriptionId = "pre-1" });

        var result = await Service().CancelAsync(user, default);

        Assert.Equal("cancelada", result.Status);
        Assert.True(result.AlreadyCancelled);
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Cancelar_una_simulada_no_toca_Mercado_Pago()
    {
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            IsDevSimulated = true,
        });

        await Service().CancelAsync(user, default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("cancelada", stored.Status);
        Assert.NotNull(stored.CancelledAtUtc);
        // Y a diferencia de una cancelación real, corta el acceso de una: es un
        // interruptor de prueba, no una política de facturación.
        Assert.Null(stored.NextBillingAtUtc);
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task No_se_puede_cancelar_una_suscripcion_sin_vincular()
    {
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
        });

        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() => Service().CancelAsync(user, default));

        Assert.Equal("not_linked", error.Code);
    }

    [Fact]
    public async Task Cancelar_llama_a_Mercado_Pago_y_CONSERVA_el_periodo_pagado()
    {
        var nextBilling = DateTime.UtcNow.AddDays(20);
        RouteMercadoPago(preapproval: Json(
            """{"id":"pre-1","status":"cancelled","next_payment_date":"@next@"}""",
            ("next", nextBilling)));
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = nextBilling,
            ExternalSubscriptionId = "pre-1",
        });

        var result = await Service().CancelAsync(user, default);

        Assert.Equal("cancelada", result.Status);
        // Lo que ya pagó no se achica por apagar la renovación.
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(user.Subscriptions.Single()));
        Assert.NotNull(result.AccessUntilUtc);
        // Cancelar en medio de un mes pago SÍ implica que ya se cobró algo.
        Assert.False(result.NothingWillBeCharged);
        Assert.Contains(_http.Requests, request => request.Method == HttpMethod.Put);
    }

    [Fact]
    public async Task Cancelar_deja_un_evento_en_el_historial()
    {
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"cancelled"}""");
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            ExternalSubscriptionId = "pre-1",
        });

        await Service().CancelAsync(user, default);

        var record = await _db.NewContext().SubscriptionEvents.SingleAsync();
        Assert.Equal("cancel", record.Topic);
        Assert.Equal("user_requested", record.Action);
    }

    // =======================================================================
    // Reconciliación
    // =======================================================================

    [Fact]
    public async Task Sin_credenciales_el_sync_devuelve_el_estado_local()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "activa", NextBillingAtUtc = DateTime.UtcNow.AddDays(10) });

        var result = await Service(new MercadoPagoOptions { AccessToken = "" }).SyncAsync(user, default);

        Assert.Equal("activa", result!.Status);
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task El_sync_vincula_una_fila_pendiente_buscando_por_email_del_pagador()
    {
        // El redirect casi siempre llega antes que el webhook: sin esto, el cliente
        // vería "pendiente" justo después de pagar.
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalPlanId = "plan-1" });
        RouteMercadoPago(
            preapprovalSearch: """{"results":[{"id":"pre-99","preapproval_plan_id":"plan-1","date_created":"2025-03-10T10:00:00Z"}]}""",
            preapproval: """{"id":"pre-99","status":"authorized"}""");

        var result = await Service().SyncAsync(user, default);

        Assert.Equal("pre-99", result!.ExternalSubscriptionId);
        Assert.Equal("activa", result.Status);
    }

    [Fact]
    public async Task El_sync_ignora_un_preapproval_de_otro_plan()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalPlanId = "plan-1" });
        RouteMercadoPago(preapprovalSearch: """{"results":[{"id":"pre-99","preapproval_plan_id":"OTRO-plan"}]}""");

        var result = await Service().SyncAsync(user, default);

        Assert.Null(result!.ExternalSubscriptionId);
        Assert.Equal("pendiente", result.Status);
    }

    [Fact]
    public async Task El_sync_registra_los_cobros_como_facturas()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(
            preapproval: """{"id":"pre-1","status":"authorized"}""",
            paymentsSearch: """
            {"results":[{"id":555,"status":"processed","transaction_amount":7900,"currency_id":"ARS",
              "payment":{"id":999,"status":"approved","payment_method_id":"visa","last_four_digits":"6411"}}]}
            """);

        await Service().SyncAsync(user, default);

        var invoice = await _db.NewContext().SubscriptionInvoices.SingleAsync();
        Assert.Equal("aprobado", invoice.Status);
        Assert.Equal(7900m, invoice.Amount);
        Assert.Equal("visa ···· 6411", invoice.PaymentMethodLabel);
    }

    [Fact]
    public async Task El_sync_deja_un_evento_solo_cuando_el_estado_cambia()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized"}""");
        var service = Service();

        await service.SyncAsync(user, default);
        Assert.Equal(1, await _db.NewContext().SubscriptionEvents.CountAsync());

        await service.SyncAsync(user, default);
        Assert.Equal(1, await _db.NewContext().SubscriptionEvents.CountAsync());
    }

    [Fact]
    public async Task Un_preapproval_que_no_se_puede_leer_deja_el_estado_como_estaba()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("{}") });

        var result = await Service().SyncAsync(user, default);

        Assert.Equal("activa", result!.Status);
    }

    // =======================================================================
    // Mapeo de estados de Mercado Pago
    // =======================================================================

    [Theory]
    [InlineData("pending", "pendiente")]
    [InlineData("paused", "pausada")]
    [InlineData("cancelled", "cancelada")]
    [InlineData("canceled", "cancelada")]
    public async Task Traduce_el_estado_de_Mercado_Pago(string providerStatus, string expected)
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: Json("""{"id":"pre-1","status":"@status@"}""", ("status", providerStatus)));

        var result = await Service().SyncAsync(user, default);

        Assert.Equal(expected, result!.Status);
    }

    [Fact]
    public async Task Un_estado_desconocido_no_pisa_el_local()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"algo_nuevo"}""");

        var result = await Service().SyncAsync(user, default);

        Assert.Equal("activa", result!.Status);
    }

    [Fact]
    public async Task Un_plan_con_prueba_gratis_y_sin_cobros_se_lee_como_trial()
    {
        // Mercado Pago no expone un estado "trialing": se deriva.
        var trialEnd = DateTime.UtcNow.AddDays(5);
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: Json(
            """
            {"id":"pre-1","status":"authorized","next_payment_date":"@trialEnd@",
             "auto_recurring":{"free_trial":{"frequency":7,"frequency_type":"days"}},
             "summarized":{"charged_quantity":0}}
            """,
            ("trialEnd", trialEnd)));

        var result = await Service().SyncAsync(user, default);

        Assert.Equal("trial", result!.Status);
        Assert.True(result.TrialWasApplied);
        Assert.NotNull(result.TrialEndsAtUtc);
    }

    [Fact]
    public async Task Con_un_cobro_hecho_el_trial_ya_terminó()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "trial", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: Json(
            """
            {"id":"pre-1","status":"authorized","next_payment_date":"@next@",
             "auto_recurring":{"free_trial":{"frequency":7}},
             "summarized":{"charged_quantity":1}}
            """,
            ("next", DateTime.UtcNow.AddDays(25))));

        var result = await Service().SyncAsync(user, default);

        Assert.Equal("activa", result!.Status);
    }

    [Fact]
    public async Task Un_plan_sin_prueba_gratis_arranca_activo()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized"}""");

        var result = await Service().SyncAsync(user, default);

        Assert.Equal("activa", result!.Status);
    }

    // =======================================================================
    // Webhooks
    // =======================================================================

    [Fact]
    public async Task Un_topico_desconocido_se_ignora_sin_romper()
    {
        await Service().HandleNotificationAsync("point_integration_wh", "state_FINISHED", "123", "{}", default);

        Assert.Empty(_http.Requests);
        Assert.Equal(0, await _db.NewContext().SubscriptionEvents.CountAsync());
    }

    [Theory]
    [InlineData("subscription_preapproval")]
    [InlineData("preapproval")]
    public async Task Una_notificacion_de_preapproval_aplica_el_estado(string topic)
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync(topic, "updated", "pre-1", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("activa", stored.Status);
        Assert.Equal(user.Id, stored.UserId);
    }

    [Fact]
    public async Task El_cuerpo_del_webhook_es_un_timbre_no_un_dato()
    {
        // Aunque el payload afirme "activa", lo que vale es lo que devuelve la API.
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"cancelled","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("preapproval", "updated", "pre-1", """{"status":"authorized"}""", default);

        Assert.Equal("cancelada", (await _db.NewContext().Subscriptions.SingleAsync()).Status);
        Assert.NotNull(user);
    }

    [Fact]
    public async Task Una_notificacion_repetida_se_aplica_una_sola_vez()
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");
        var service = Service();

        await service.HandleNotificationAsync("preapproval", "updated", "pre-1", "{}", default);
        await service.HandleNotificationAsync("preapproval", "updated", "pre-1", "{}", default);

        Assert.Equal(1, await _db.NewContext().SubscriptionEvents.CountAsync());
    }

    [Fact]
    public async Task Un_cambio_posterior_del_mismo_recurso_SI_se_aplica()
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        var service = Service();

        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");
        await service.HandleNotificationAsync("preapproval", "updated", "pre-1", "{}", default);

        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"cancelled","last_modified":"2025-03-11T10:00:00Z"}""");
        await service.HandleNotificationAsync("preapproval", "updated", "pre-1", "{}", default);

        Assert.Equal(2, await _db.NewContext().SubscriptionEvents.CountAsync());
        Assert.Equal("cancelada", (await _db.NewContext().Subscriptions.SingleAsync()).Status);
    }

    [Fact]
    public async Task Una_notificacion_sin_suscripcion_local_deja_un_evento_huerfano()
    {
        RouteMercadoPago(preapproval: """{"id":"pre-desconocido","status":"authorized"}""");

        await Service().HandleNotificationAsync("preapproval", "updated", "pre-desconocido", """{"raw":true}""", default);

        var record = await _db.NewContext().SubscriptionEvents.SingleAsync();
        Assert.Null(record.SubscriptionId);
        Assert.Contains("No matching local subscription", record.Notes);
    }

    [Fact]
    public async Task Vincula_por_external_reference_cuando_todavia_no_hay_id()
    {
        var subscription = new Subscription { Status = "pendiente" };
        CreateUser(subscriptions: subscription);
        RouteMercadoPago(preapproval: Json(
            """{"id":"pre-1","status":"authorized","external_reference":"@ref@","last_modified":"2025-03-10T10:00:00Z"}""",
            ("ref", subscription.Id)));

        await Service().HandleNotificationAsync("preapproval", "updated", "pre-1", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("pre-1", stored.ExternalSubscriptionId);
        Assert.Equal("activa", stored.Status);
    }

    [Fact]
    public async Task Vincula_por_email_del_pagador_como_ultimo_recurso()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "pendiente" });
        RouteMercadoPago(preapproval: Json(
            """{"id":"pre-1","status":"authorized","payer_email":"@email@","last_modified":"2025-03-10T10:00:00Z"}""",
            ("email", user.Email.ToUpperInvariant())));

        await Service().HandleNotificationAsync("preapproval", "updated", "pre-1", "{}", default);

        Assert.Equal("pre-1", (await _db.NewContext().Subscriptions.SingleAsync()).ExternalSubscriptionId);
    }

    // -----------------------------------------------------------------------
    // Cobros
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("subscription_authorized_payment")]
    [InlineData("authorized_payment")]
    public async Task Un_cobro_aprobado_activa_la_suscripcion(string topic)
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        var periodEnd = DateTime.UtcNow.AddDays(30);
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(Json(
                """
                {"id":555,"preapproval_id":"pre-1","status":"processed","transaction_amount":7900,
                 "last_modified":"2025-03-10T10:00:00Z",
                 "period":{"start_date":"2025-03-10T00:00:00Z","end_date":"@periodEnd@"},
                 "payment":{"id":999,"status":"approved","payment_method_id":"visa","last_four_digits":"6411"}}
                """,
                ("periodEnd", periodEnd)), Encoding.UTF8, "application/json"),
        });

        await Service().HandleNotificationAsync(topic, "created", "555", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("activa", stored.Status);
        Assert.Null(stored.GraceEndsAtUtc);
        Assert.NotNull(stored.LastPaymentAtUtc);
        Assert.Equal("visa ···· 6411", stored.PaymentMethodLabel);
    }

    [Fact]
    public async Task Un_cobro_rechazado_abre_la_ventana_de_gracia()
    {
        CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""
            {"id":556,"preapproval_id":"pre-1","status":"rejected","last_modified":"2025-03-10T10:00:00Z",
             "payment":{"id":1000,"status":"rejected"}}
            """, Encoding.UTF8, "application/json"),
        });

        await Service(new MercadoPagoOptions { AccessToken = "TEST-1", FailedPaymentGraceDays = 3 })
            .HandleNotificationAsync("authorized_payment", "updated", "556", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("pago_fallido", stored.Status);
        Assert.NotNull(stored.GraceEndsAtUtc);
        // Y sigue con acceso mientras dure la gracia: una tarjeta que se recupera sola
        // no puede producir un corte visible.
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(stored));
    }

    [Fact]
    public async Task Los_reintentos_de_Mercado_Pago_no_estiran_la_gracia_indefinidamente()
    {
        CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        var service = Service();
        var attempt = 0;
        _http.Route(_ =>
        {
            attempt += 1;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(Json(
                    """
                    {"id":@id@,"preapproval_id":"pre-1","status":"rejected",
                     "last_modified":"2025-03-1@n@T10:00:00Z","payment":{"id":@paymentId@,"status":"rejected"}}
                    """,
                    ("id", 500 + attempt), ("n", attempt), ("paymentId", 900 + attempt)),
                    Encoding.UTF8, "application/json"),
            };
        });

        await service.HandleNotificationAsync("authorized_payment", "updated", "501", "{}", default);
        var firstGrace = (await _db.NewContext().Subscriptions.SingleAsync()).GraceEndsAtUtc;

        await service.HandleNotificationAsync("authorized_payment", "updated", "502", "{}", default);

        Assert.Equal(firstGrace, (await _db.NewContext().Subscriptions.SingleAsync()).GraceEndsAtUtc);
    }

    [Fact]
    public async Task Un_cobro_que_no_se_puede_leer_se_descarta()
    {
        CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}", Encoding.UTF8, "application/json") });

        await Service().HandleNotificationAsync("authorized_payment", "updated", "555", "{}", default);

        Assert.Equal("activa", (await _db.NewContext().Subscriptions.SingleAsync()).Status);
        Assert.Equal(0, await _db.NewContext().SubscriptionEvents.CountAsync());
    }

    [Theory]
    [InlineData("approved", "aprobado")]
    [InlineData("accredited", "aprobado")]
    [InlineData("processed", "aprobado")]
    [InlineData("rejected", "rechazado")]
    [InlineData("cancelled", "rechazado")]
    [InlineData("refunded", "devuelto")]
    [InlineData("charged_back", "devuelto")]
    [InlineData("recycling", "reintentando")]
    [InlineData("in_process", "pendiente")]
    public async Task Traduce_el_estado_de_un_cobro(string providerStatus, string expected)
    {
        CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(Json(
                """
                {"id":555,"preapproval_id":"pre-1","last_modified":"2025-03-10T10:00:00Z",
                 "payment":{"id":999,"status":"@status@"}}
                """,
                ("status", providerStatus)), Encoding.UTF8, "application/json"),
        });

        await Service().HandleNotificationAsync("authorized_payment", "updated", "555", "{}", default);

        Assert.Equal(expected, (await _db.NewContext().SubscriptionInvoices.SingleAsync()).Status);
    }

    [Fact]
    public async Task Un_cobro_repetido_no_duplica_la_factura()
    {
        CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        var service = Service();
        var modified = 10;
        _http.Route(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(Json(
                """
                {"id":555,"preapproval_id":"pre-1","status":"processed","last_modified":"2025-03-@day@T10:00:00Z",
                 "payment":{"id":999,"status":"approved"}}
                """,
                ("day", modified)), Encoding.UTF8, "application/json"),
        });

        await service.HandleNotificationAsync("authorized_payment", "updated", "555", "{}", default);
        modified = 11;
        await service.HandleNotificationAsync("authorized_payment", "updated", "555", "{}", default);

        Assert.Equal(1, await _db.NewContext().SubscriptionInvoices.CountAsync());
    }


    // =======================================================================
    // Checkout directo (POST /preapproval) — el arreglo del "pago pendiente"
    // =======================================================================

    [Fact]
    public async Task El_checkout_crea_el_preapproval_con_nuestra_referencia_y_el_mail_del_pagador()
    {
        RouteMercadoPago();
        var user = CreateUser();

        var result = await Service().StartCheckoutAsync(user, Context(), null, default);

        var create = _http.Requests.Single(request =>
            request.Method == HttpMethod.Post && request.Uri.AbsolutePath.EndsWith("/preapproval"));

        // external_reference es LO que hace que la notificación posterior encuentre esta
        // fila. Sin él, el único vínculo es el mail de la cuenta de Mercado Pago del
        // pagador, que muy seguido no es con el que se logueó acá — y ahí es donde una
        // suscripción realmente pagada se queda para siempre en "pendiente".
        Assert.Contains(result.SubscriptionId.ToString(), create.Body);
        Assert.Contains(user.Email, create.Body);
        Assert.Contains("\"status\":\"pending\"", create.Body);
        // Sin card_token_id: ese es el flujo "authorized", el que devuelve
        // "Card token service not found" cuando el token se generó en otro lado.
        Assert.DoesNotContain("card_token_id", create.Body);
    }

    [Fact]
    public async Task El_trial_viaja_en_el_preapproval_de_cada_pagador()
    {
        RouteMercadoPago();

        await Service().StartCheckoutAsync(CreateUser(), Context(), null, default);

        var create = _http.Requests.Single(request =>
            request.Method == HttpMethod.Post && request.Uri.AbsolutePath.EndsWith("/preapproval"));

        Assert.Contains("free_trial", create.Body);
    }

    [Fact]
    public async Task Sin_trial_disponible_el_preapproval_no_lleva_free_trial()
    {
        RouteMercadoPago();

        await Service().StartCheckoutAsync(CreateUser(hasUsedTrial: true), Context(), null, default);

        var create = _http.Requests.Single(request =>
            request.Method == HttpMethod.Post && request.Uri.AbsolutePath.EndsWith("/preapproval"));

        // Nunca en null: un "free_trial": null se serializaría igual y Mercado Pago lo
        // rechaza. La clave directamente no está.
        Assert.DoesNotContain("free_trial", create.Body);
    }

    [Fact]
    public async Task Si_Mercado_Pago_rechaza_el_preapproval_el_checkout_cae_al_plan()
    {
        // Hay cuentas donde POST /preapproval no está habilitado. Perder el id de arranque
        // es malo; perder el checkout entero es peor.
        _http.Route(request =>
        {
            var path = request.RequestUri!.AbsolutePath;

            if (path.TrimEnd('/').EndsWith("/preapproval") && request.Method == HttpMethod.Post)
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound)
                {
                    Content = new StringContent("""{"message":"not found"}""", Encoding.UTF8, "application/json"),
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"id":"plan-1","init_point":"https://mp.test/checkout"}""",
                    Encoding.UTF8,
                    "application/json"),
            };
        });

        var result = await Service().StartCheckoutAsync(CreateUser(), Context(), null, default);

        Assert.Equal("https://mp.test/checkout", result.RedirectUrl);
        Assert.Null((await _db.NewContext().Subscriptions.SingleAsync()).ExternalSubscriptionId);
    }

    [Fact]
    public async Task Un_checkout_a_medias_se_retoma_en_vez_de_duplicarse()
    {
        // Dos checkouts abiertos a la vez son dos suscripciones autorizables — o sea, el
        // riesgo de dos cobros mensuales por la misma cuenta.
        RouteMercadoPago();
        var service = Service();
        var user = CreateUser();

        var first = await service.StartCheckoutAsync(user, Context(), null, default);
        var second = await service.StartCheckoutAsync(user, Context(), null, default);

        Assert.True(second.Resumed);
        Assert.Equal(first.SubscriptionId, second.SubscriptionId);
        Assert.Equal(first.RedirectUrl, second.RedirectUrl);
        Assert.Equal(1, await _db.NewContext().Subscriptions.CountAsync());
    }

    [Fact]
    public async Task Un_checkout_viejo_no_se_retoma()
    {
        RouteMercadoPago();
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "pendiente",
            CheckoutUrl = "https://mp.test/viejo",
            CreatedAtUtc = DateTime.UtcNow.AddDays(-30),
        });

        var result = await Service().StartCheckoutAsync(user, Context(), null, default);

        Assert.False(result.Resumed);
        Assert.Equal("https://mp.test/subscribe/pre-1", result.RedirectUrl);
    }

    // =======================================================================
    // Notificaciones de pago (topic `payment`)
    // =======================================================================

    [Fact]
    public async Task Un_pago_aprobado_activa_una_suscripcion_pendiente()
    {
        // Este es el agujero que dejaba todo en "pendiente": el topic `payment` —el que la
        // documentación de Mercado Pago pide habilitar junto a los dos de suscripción— se
        // descartaba, y para un primer cobro suele ser la ÚNICA notificación que llega.
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(
            payment: """
            {"id":9001,"status":"approved","status_detail":"accredited","operation_type":"recurring_payment",
             "date_approved":"2025-03-10T10:00:00Z","date_last_updated":"2025-03-10T10:00:00Z",
             "payment_method_id":"visa","card":{"last_four_digits":"6411"},
             "metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9001", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("activa", stored.Status);
        Assert.Equal("visa ···· 6411", stored.PaymentMethodLabel);
        Assert.Null(stored.LastPaymentStatusDetail);
        Assert.NotNull(stored.LastPaymentAtUtc);
    }

    [Fact]
    public async Task Un_pago_en_proceso_guarda_el_motivo_para_poder_explicarlo()
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(
            payment: """
            {"id":9002,"status":"in_process","status_detail":"pending_contingency",
             "date_last_updated":"2025-03-10T10:00:00Z","metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"pending","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9002", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("pendiente", stored.Status);
        // "Pendiente" a secas no le sirve a nadie; "lo está procesando Mercado Pago, hasta
        // 2 días hábiles" sí.
        Assert.Equal("pending_contingency", stored.LastPaymentStatusDetail);
    }

    [Fact]
    public async Task Un_pago_rechazado_abre_la_ventana_de_gracia()
    {
        CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            ExternalSubscriptionId = "pre-1",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(-1),
        });
        RouteMercadoPago(
            payment: """
            {"id":9003,"status":"rejected","status_detail":"cc_rejected_insufficient_amount",
             "date_last_updated":"2025-03-10T10:00:00Z","metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9003", "{}", default);

        var stored = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("cc_rejected_insufficient_amount", stored.LastPaymentStatusDetail);
        Assert.NotNull(stored.GraceEndsAtUtc);
    }

    [Fact]
    public async Task Un_pago_se_vincula_por_external_reference_cuando_no_hay_metadata()
    {
        var subscription = new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" };
        CreateUser(subscriptions: subscription);
        RouteMercadoPago(
            payment: Json(
                """
                {"id":9004,"status":"approved","status_detail":"accredited","external_reference":"@ref@",
                 "date_approved":"2025-03-10T10:00:00Z","date_last_updated":"2025-03-10T10:00:00Z"}
                """,
                ("ref", subscription.Id)),
            preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9004", "{}", default);

        Assert.Equal("activa", (await _db.NewContext().Subscriptions.SingleAsync()).Status);
    }

    [Fact]
    public async Task Un_pago_ajeno_a_toda_suscripcion_se_ignora_sin_romper()
    {
        CreateUser();
        RouteMercadoPago(payment: """{"id":9005,"status":"approved","status_detail":"accredited"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9005", "{}", default);

        Assert.Equal(0, await _db.NewContext().SubscriptionEvents.CountAsync());
    }

    [Fact]
    public async Task Una_notificacion_de_pago_repetida_se_aplica_una_sola_vez()
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(
            payment: """
            {"id":9006,"status":"approved","status_detail":"accredited",
             "date_last_updated":"2025-03-10T10:00:00Z","metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");
        var service = Service();

        await service.HandleNotificationAsync("payment", "payment.updated", "9006", "{}", default);
        await service.HandleNotificationAsync("payment", "payment.updated", "9006", "{}", default);

        Assert.Equal(1, await _db.NewContext().SubscriptionEvents.CountAsync(item => item.Topic == "payment"));
    }


    [Fact]
    public async Task La_clave_de_idempotencia_del_checkout_sale_de_nuestra_suscripcion()
    {
        // Un Guid nuevo por llamada no deduplica nada: si esta llamada expira DESPUÉS de
        // que Mercado Pago la aceptó, reintentar tiene que caer sobre el mismo preapproval
        // en vez de dejarle al pagador un segundo para autorizar.
        RouteMercadoPago();

        var result = await Service().StartCheckoutAsync(CreateUser(), Context(), null, default);

        var create = _http.Requests.Single(request =>
            request.Method == HttpMethod.Post && request.Uri.AbsolutePath.EndsWith("/preapproval"));

        Assert.Equal($"preapproval:{result.SubscriptionId}", create.Headers["X-Idempotency-Key"]);
    }

    [Fact]
    public async Task Un_pago_notificado_aparece_en_el_historial_de_cobros()
    {
        // Para un primer cobro, `payment` suele ser la única notificación que llega. Sin
        // esto la cuenta pasaba a "activa" con el historial de pagos vacío — justo la
        // pantalla que alguien abre para confirmar que le cobraron bien.
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(
            payment: """
            {"id":9100,"status":"approved","status_detail":"accredited","transaction_amount":7800,
             "currency_id":"ARS","date_approved":"2025-03-10T10:00:00Z","date_last_updated":"2025-03-10T10:00:00Z",
             "payment_method_id":"visa","card":{"last_four_digits":"6411"},
             "metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9100", "{}", default);

        var invoice = await _db.NewContext().SubscriptionInvoices.SingleAsync();
        Assert.Equal("aprobado", invoice.Status);
        Assert.Equal(7800m, invoice.Amount);
        Assert.Equal("visa ···· 6411", invoice.PaymentMethodLabel);
        Assert.NotNull(invoice.PaidAtUtc);
    }

    [Fact]
    public async Task Un_pago_pendiente_queda_como_factura_pendiente_con_su_motivo()
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(
            payment: """
            {"id":9101,"status":"in_process","status_detail":"pending_contingency",
             "date_last_updated":"2025-03-10T10:00:00Z","metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"pending","last_modified":"2025-03-10T10:00:00Z"}""");

        await Service().HandleNotificationAsync("payment", "payment.updated", "9101", "{}", default);

        var invoice = await _db.NewContext().SubscriptionInvoices.SingleAsync();
        // `in_process` es Mercado Pago decidiendo todavía, no un fracaso.
        Assert.Equal("pendiente", invoice.Status);
        Assert.Equal("pending_contingency", invoice.StatusDetail);
        Assert.Null(invoice.PaidAtUtc);
    }

    [Fact]
    public async Task El_mismo_cobro_por_los_dos_topicos_es_UNA_sola_linea()
    {
        // El mismo movimiento de plata llega con dos ids distintos: `payment` conoce el
        // pago, `subscription_authorized_payment` conoce el débito programado que lo
        // envuelve. Duplicarlo sería mostrarle a alguien dos cobros donde hubo uno.
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        var service = Service();

        RouteMercadoPago(
            payment: """
            {"id":999,"status":"approved","status_detail":"accredited",
             "date_last_updated":"2025-03-10T10:00:00Z","metadata":{"preapproval_id":"pre-1"}}
            """,
            preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");
        await service.HandleNotificationAsync("payment", "payment.updated", "999", "{}", default);

        // Ahora el débito programado, con SU id (555) y el mismo pago adentro (999).
        RouteMercadoPago(authorizedPayment: """
            {"id":555,"preapproval_id":"pre-1","status":"processed","last_modified":"2025-03-10T11:00:00Z",
             "payment":{"id":999,"status":"approved","status_detail":"accredited"}}
            """);
        await service.HandleNotificationAsync("authorized_payment", "updated", "555", "{}", default);

        var invoice = await _db.NewContext().SubscriptionInvoices.SingleAsync();
        // La fila se adopta y se re-clava con el id del débito, no se duplica.
        Assert.Equal("555", invoice.ExternalPaymentId);
        Assert.Equal("999", invoice.ExternalTransactionId);
    }

    // =======================================================================
    // Cancelar, pausar, reanudar
    // =======================================================================

    [Fact]
    public async Task Cancelar_durante_la_prueba_promete_que_NO_se_cobra_nada()
    {
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"cancelled"}""");
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "trial",
            ExternalSubscriptionId = "pre-1",
            TrialEndsAtUtc = DateTime.UtcNow.AddDays(4),
            NextBillingAtUtc = DateTime.UtcNow.AddDays(4),
        });

        var result = await Service().CancelAsync(user, default);

        // El motor de Mercado Pago es el que agenda el primer débito: si el preapproval ya
        // no está cuando llega la fecha, el cobro no se intenta. Eso es más fuerte que
        // "te lo devolvemos", y por eso la pantalla puede decirlo.
        Assert.True(result.NothingWillBeCharged);
        Assert.NotNull(result.AccessUntilUtc);
    }

    [Fact]
    public async Task Cancelar_un_checkout_abandonado_lo_cierra_sin_llamar_a_Mercado_Pago()
    {
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "pendiente",
            CheckoutUrl = "https://mp.test/subscribe/pre-1",
        });

        var result = await Service().CancelAsync(user, default);

        Assert.Equal("cancelada", result.Status);
        Assert.Empty(_http.Requests);
        // El link deja de ofrecerse: si no, la pantalla seguiría invitando a terminar un
        // pago que el usuario acaba de descartar.
        Assert.Null((await _db.NewContext().Subscriptions.SingleAsync()).CheckoutUrl);
    }

    [Fact]
    public async Task Abandonar_un_checkout_DEVUELVE_la_semana_gratis()
    {
        // La semana se quema al abrir el checkout, no al convertir. Cancelar es la única
        // salida de un pago del que alguien se arrepintió, así que sin esto cerrar una
        // pestaña le costaría su única semana gratis sin haber usado ni un día.
        RouteMercadoPago();
        var service = Service();
        var user = CreateUser();

        await service.StartCheckoutAsync(user, Context(), "device-abc", default);
        // Se abre sin id externo: Mercado Pago nunca llegó a autorizar nada.
        user.Subscriptions[0].ExternalSubscriptionId = null;
        await _db.Context.SaveChangesAsync();

        await service.CancelAsync(user, default);

        var reread = _db.NewContext();
        Assert.False(await reread.Users.Where(item => item.Id == user.Id).Select(item => item.HasUsedTrial).SingleAsync());
        Assert.Equal(0, await reread.TrialClaims.CountAsync());
    }

    [Fact]
    public async Task Cancelar_una_suscripcion_YA_autorizada_no_devuelve_la_semana()
    {
        // Acá sí la usó: el reintegro es sólo para el checkout que nunca llegó a existir
        // del lado de Mercado Pago.
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"cancelled"}""");
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "trial",
            ExternalSubscriptionId = "pre-1",
            TrialWasApplied = true,
            TrialEndsAtUtc = DateTime.UtcNow.AddDays(3),
        });
        user.HasUsedTrial = true;
        _db.Context.TrialClaims.Add(new TrialClaim { UserId = user.Id, SubscriptionId = user.Subscriptions[0].Id });
        await _db.Context.SaveChangesAsync();

        await Service().CancelAsync(user, default);

        var reread = _db.NewContext();
        Assert.True(await reread.Users.Where(item => item.Id == user.Id).Select(item => item.HasUsedTrial).SingleAsync());
        Assert.Equal(1, await reread.TrialClaims.CountAsync());
    }

    [Fact]
    public async Task Devolver_la_semana_no_borra_el_reclamo_de_otra_suscripcion()
    {
        // El registro tiene que sobrevivir: si no, abandonar un checkout nuevo limpiaría
        // la semana que la cuenta YA usó, y ahí sí se regalarían dos.
        var used = new Subscription
        {
            Status = "cancelada",
            TrialWasApplied = true,
            CreatedAtUtc = DateTime.UtcNow.AddMonths(-6),
        };
        var abandoned = new Subscription
        {
            Status = "pendiente",
            TrialWasApplied = true,
            CreatedAtUtc = DateTime.UtcNow,
        };

        var user = CreateUser(hasUsedTrial: true, subscriptions: [used, abandoned]);
        _db.Context.TrialClaims.Add(new TrialClaim { UserId = user.Id, SubscriptionId = used.Id });
        _db.Context.TrialClaims.Add(new TrialClaim { UserId = user.Id, SubscriptionId = abandoned.Id });
        await _db.Context.SaveChangesAsync();

        await Service().CancelAsync(user, default);

        var reread = _db.NewContext();
        Assert.True(await reread.Users.Where(item => item.Id == user.Id).Select(item => item.HasUsedTrial).SingleAsync());
        Assert.Equal(1, await reread.TrialClaims.CountAsync());
    }

    [Fact]
    public async Task Pausar_suspende_los_cobros_y_conserva_el_acceso()
    {
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"paused"}""");
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            ExternalSubscriptionId = "pre-1",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(12),
        });

        var result = await Service().PauseAsync(user, default);

        Assert.Equal("pausada", result.Status);
        Assert.NotNull(result.PausedAtUtc);
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(result));
        Assert.Contains(_http.Requests, request => request.Method == HttpMethod.Put && request.Body!.Contains("paused"));
    }

    [Fact]
    public async Task No_se_puede_pausar_algo_que_ya_esta_cancelado()
    {
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "cancelada",
            ExternalSubscriptionId = "pre-1",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(5),
        });

        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() => Service().PauseAsync(user, default));

        Assert.Equal("not_pausable", error.Code);
    }

    [Fact]
    public async Task Reanudar_vuelve_a_poner_la_suscripcion_en_marcha()
    {
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized"}""");
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "pausada",
            ExternalSubscriptionId = "pre-1",
            PausedAtUtc = DateTime.UtcNow.AddDays(-3),
            NextBillingAtUtc = DateTime.UtcNow.AddDays(10),
        });

        var result = await Service().ResumeAsync(user, default);

        Assert.Equal("activa", result.Status);
        Assert.Null(result.PausedAtUtc);
        Assert.Contains(_http.Requests, request => request.Method == HttpMethod.Put && request.Body!.Contains("authorized"));
    }

    [Fact]
    public async Task Solo_se_reanuda_lo_que_estaba_pausado()
    {
        var user = CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            ExternalSubscriptionId = "pre-1",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(10),
        });

        var error = await Assert.ThrowsAsync<SubscriptionConflictException>(() => Service().ResumeAsync(user, default));

        Assert.Equal("not_paused", error.Code);
    }

    // =======================================================================
    // Reconciliación en segundo plano
    // =======================================================================

    [Fact]
    public async Task El_reconciliador_levanta_una_suscripcion_que_quedo_colgada()
    {
        // El webhook se pierde de maneras que no dejan rastro de este lado: el topic nunca
        // se habilitó en el panel, el secreto rotó, un deploy se comió la entrega. Todas
        // terminan igual: cobrada la tarjeta y la app diciendo "pendiente".
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });
        RouteMercadoPago(preapproval: """{"id":"pre-1","status":"authorized","last_modified":"2025-03-10T10:00:00Z"}""");

        var changed = await Service().ReconcileAsync(10, default);

        Assert.Equal(1, changed);
        Assert.Equal("activa", (await _db.NewContext().Subscriptions.SingleAsync()).Status);
        Assert.Contains(await _db.NewContext().SubscriptionEvents.ToListAsync(), item => item.Topic == "reconcile");
    }

    [Fact]
    public async Task El_reconciliador_no_toca_lo_que_esta_tranquilo()
    {
        CreateUser(subscriptions: new Subscription
        {
            Status = "activa",
            ExternalSubscriptionId = "pre-1",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
        });
        RouteMercadoPago();

        Assert.Equal(0, await Service().ReconcileAsync(10, default));
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task El_reconciliador_abandona_un_checkout_lo_bastante_viejo()
    {
        // Alguien que cerró la pestaña hace una semana no es un pago en curso.
        CreateUser(subscriptions: new Subscription
        {
            Status = "pendiente",
            ExternalSubscriptionId = "pre-1",
            CreatedAtUtc = DateTime.UtcNow.AddDays(-7),
        });
        RouteMercadoPago();

        Assert.Equal(0, await Service().ReconcileAsync(10, default));
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Sin_credenciales_el_reconciliador_no_hace_nada()
    {
        CreateUser(subscriptions: new Subscription { Status = "pendiente", ExternalSubscriptionId = "pre-1" });

        Assert.Equal(0, await Service(new MercadoPagoOptions { AccessToken = "" }).ReconcileAsync(10, default));
    }

    // =======================================================================
    // Historial
    // =======================================================================

    [Fact]
    public async Task Las_facturas_y_eventos_se_leen_por_usuario()
    {
        var user = CreateUser(subscriptions: new Subscription { Status = "activa", ExternalSubscriptionId = "pre-1" });
        var other = CreateUser();
        _db.Context.SubscriptionInvoices.Add(new SubscriptionInvoice
        {
            SubscriptionId = user.Subscriptions[0].Id,
            UserId = other.Id,
            ExternalPaymentId = "otro",
            Status = "aprobado",
        });
        await _db.Context.SaveChangesAsync();

        Assert.Empty(await Service().GetInvoicesAsync(user.Id, default));
        Assert.Single(await Service().GetInvoicesAsync(other.Id, default));
        Assert.Empty(await Service().GetEventsAsync(user.Id, default));
    }
}
