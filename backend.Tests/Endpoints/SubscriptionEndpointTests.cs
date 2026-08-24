using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using backend.Models;
using backend.Tests.Infrastructure;

namespace backend.Tests.Endpoints;

/// <summary>
/// Suscripciones y webhook. La factory arranca SIN credenciales de Mercado Pago a
/// propósito: ningún test puede salir a la red, y el comportamiento sin proveedor
/// configurado es en sí mismo algo que hay que garantizar (la app tiene que explicarlo,
/// no romperse).
/// </summary>
public sealed class SubscriptionEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task<string?> CodeOf(HttpResponseMessage response) =>
        (await ReadJson(response)).TryGetProperty("code", out var code) ? code.GetString() : null;

    // -----------------------------------------------------------------------
    // Plan público
    // -----------------------------------------------------------------------

    [Fact]
    public async Task El_plan_se_puede_consultar_SIN_sesion()
    {
        // La landing necesita un precio que mostrar antes de que nadie inicie sesión.
        var response = await factory.CreateClient().GetAsync("/api/subscription/plan");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        Assert.True(body.GetProperty("amount").GetDecimal() > 0);
        Assert.Equal("ARS", body.GetProperty("currencyId").GetString());
        Assert.Equal(7, body.GetProperty("trialFrequency").GetInt32());
    }

    [Fact]
    public async Task El_plan_avisa_que_el_proveedor_no_esta_configurado()
    {
        var body = await ReadJson(await factory.CreateClient().GetAsync("/api/subscription/plan"));

        Assert.False(body.GetProperty("providerConfigured").GetBoolean());
    }

    // -----------------------------------------------------------------------
    // Vista general
    // -----------------------------------------------------------------------

    [Fact]
    public async Task La_vista_general_exige_sesion()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/subscription")).StatusCode);
    }

    [Fact]
    public async Task Una_cuenta_nueva_no_tiene_suscripcion_y_puede_probar_gratis()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.GetAsync("/api/subscription"));

        Assert.Equal(JsonValueKind.Null, body.GetProperty("current").ValueKind);
        Assert.False(body.GetProperty("hasVipAccess").GetBoolean());
        Assert.True(body.GetProperty("trialAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("trialDeniedReason").ValueKind);
    }

    [Fact]
    public async Task Una_cuenta_que_ya_uso_el_trial_lo_dice_con_su_motivo()
    {
        var (client, _) = factory.CreateAuthenticatedClient(hasUsedTrial: true);

        var body = await ReadJson(await client.GetAsync("/api/subscription"));

        Assert.False(body.GetProperty("trialAvailable").GetBoolean());
        Assert.Equal("account_used", body.GetProperty("trialDeniedReason").GetString());
    }

    [Fact]
    public async Task La_vista_general_describe_la_suscripcion_vigente()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var body = await ReadJson(await client.GetAsync("/api/subscription"));

        Assert.True(body.GetProperty("hasVipAccess").GetBoolean());
        var current = body.GetProperty("current");
        Assert.Equal("activa", current.GetProperty("status").GetString());
        Assert.True(current.GetProperty("hasAccess").GetBoolean());
        Assert.Equal(1, body.GetProperty("history").GetArrayLength());
    }

    [Fact]
    public async Task Un_admin_ve_su_acceso_como_override_no_como_compra()
    {
        // La pantalla no debe ofrecerle cancelar algo que nunca compró.
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var body = await ReadJson(await client.GetAsync("/api/subscription"));

        Assert.True(body.GetProperty("isAdmin").GetBoolean());
        Assert.True(body.GetProperty("hasVipAccess").GetBoolean());
        Assert.True(body.GetProperty("accessFromAdminOverride").GetBoolean());
    }

    [Fact]
    public async Task La_vista_general_trae_las_listas_vacias_en_vez_de_nulls()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.GetAsync("/api/subscription"));

        foreach (var property in new[] { "history", "invoices", "events" })
        {
            Assert.Equal(JsonValueKind.Array, body.GetProperty(property).ValueKind);
        }
    }

    // -----------------------------------------------------------------------
    // Checkout
    // -----------------------------------------------------------------------

    [Fact]
    public async Task El_checkout_exige_sesion()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/subscription/checkout", new { deviceId = "d" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Sin_credenciales_el_checkout_devuelve_502_provider_error()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/subscription/checkout", new { deviceId = "device-abc" });

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Equal("provider_error", await CodeOf(response));
    }

    [Fact]
    public async Task Con_una_suscripcion_vigente_el_checkout_es_409_already_active()
    {
        // Hace falta una factory propia con credenciales: la comprobación de "ya tenés
        // una suscripción" viene DESPUÉS de la de "el proveedor está configurado", así
        // que sin token el checkout muere antes con un 502 y este caso nunca se alcanza.
        // No llega a haber llamada HTTP: el conflicto se detecta antes de pedir el plan.
        using var configured = new ApiFactory();
        configured.Settings["MercadoPago:AccessToken"] = "TEST-token-de-prueba";
        var (client, _) = configured.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsJsonAsync("/api/subscription/checkout", new { deviceId = "device-abc" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("already_active", await CodeOf(response));
    }

    [Fact]
    public async Task Sin_proveedor_configurado_el_502_gana_incluso_con_suscripcion_vigente()
    {
        // Documenta el orden de las comprobaciones: primero el proveedor, después el
        // estado de la cuenta.
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsJsonAsync("/api/subscription/checkout", new { deviceId = "device-abc" });

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Cancelación
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Cancelar_exige_sesion()
    {
        var response = await factory.CreateClient().PostAsync("/api/subscription/cancel", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Cancelar_sin_suscripcion_es_409_no_subscription()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsync("/api/subscription/cancel", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("no_subscription", await CodeOf(response));
    }

    [Fact]
    public async Task Cancelar_una_suscripcion_simulada_funciona_sin_tocar_Mercado_Pago()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            IsDevSimulated = true,
        });

        var response = await client.PostAsync("/api/subscription/cancel", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        Assert.False(body.GetProperty("hasVipAccess").GetBoolean());
    }

    [Fact]
    public async Task Cancelar_una_suscripcion_sin_vincular_es_409_not_linked()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: new Subscription
        {
            Status = "activa",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
        });

        Assert.Equal("not_linked", await CodeOf(await client.PostAsync("/api/subscription/cancel", null)));
    }

    // -----------------------------------------------------------------------
    // Sincronización
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sincronizar_exige_sesion()
    {
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await factory.CreateClient().PostAsync("/api/subscription/sync", null)).StatusCode);
    }

    [Fact]
    public async Task Sin_credenciales_sincronizar_devuelve_el_estado_local_sin_romper()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsync("/api/subscription/sync", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True((await ReadJson(response)).GetProperty("hasVipAccess").GetBoolean());
    }

    // -----------------------------------------------------------------------
    // Webhook
    // -----------------------------------------------------------------------

    /// <summary>
    /// Se arma con reemplazo de marcadores y no con interpolación: el JSON cierra con
    /// dos llaves seguidas y eso choca con el delimitador de interpolación de C#.
    /// </summary>
    private static HttpContent Notification(string topic = "preapproval", string dataId = "pre-1") =>
        new StringContent(
            """{"type":"@topic@","action":"updated","data":{"id":"@dataId@"}}"""
                .Replace("@topic@", topic)
                .Replace("@dataId@", dataId),
            Encoding.UTF8,
            "application/json");

    [Fact]
    public async Task El_webhook_NO_pide_sesion_pero_SI_firma()
    {
        // Mercado Pago no puede llevar un JWT: la firma es lo que lo autentica.
        var response = await factory.CreateClient().PostAsync("/api/webhooks/mercadopago", Notification());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Sin_secreto_configurado_TODA_notificacion_se_rechaza()
    {
        // Aceptar sin verificar "hasta que carguen el secreto" es el estado en el que un
        // webhook forjado funciona.
        var client = factory.CreateClient();
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        var hash = Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes("cualquier-secreto"),
            Encoding.UTF8.GetBytes($"id:pre-1;ts:{ts};"))).ToLowerInvariant();
        client.DefaultRequestHeaders.Add("x-signature", $"ts={ts},v1={hash}");

        var response = await client.PostAsync("/api/webhooks/mercadopago", Notification());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Una_notificacion_ilegible_es_400_no_401()
    {
        // Se descarta por forma antes de gastar una verificación de firma.
        var response = await factory.CreateClient().PostAsync(
            "/api/webhooks/mercadopago",
            new StringContent("{}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Acepta_la_forma_vieja_de_IPN_por_query_string()
    {
        // Un panel configurado a la vieja usanza tiene que seguir funcionando: llega a la
        // verificación de firma (y ahí rebota, porque no hay secreto).
        var response = await factory.CreateClient().PostAsync(
            "/api/webhooks/mercadopago?topic=preapproval&id=pre-1",
            new StringContent("", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Deriva_el_topico_del_campo_action_cuando_falta()
    {
        var response = await factory.CreateClient().PostAsync(
            "/api/webhooks/mercadopago",
            new StringContent("""{"action":"payment.updated","data":{"id":"123"}}""", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Una_notificacion_sin_id_es_400()
    {
        var response = await factory.CreateClient().PostAsync(
            "/api/webhooks/mercadopago",
            new StringContent("""{"type":"preapproval"}""", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
