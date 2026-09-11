using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Models;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// Las acciones de acceso del panel por HTTP, con el pipeline real: la ficha vuelve al día,
/// la cuenta afectada se entera en la app, y sin Mercado Pago nada pago se corta.
/// </summary>
public sealed class AdminAccessEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private HttpClient ClientFor(User user)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.TokenFor(user));
        return client;
    }

    [Fact]
    public async Task Dar_VIP_devuelve_la_ficha_y_la_cuenta_ve_su_Pro_de_regalo()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser();

        var response = await admin.PostAsJsonAsync($"/api/admin/users/{customer.Id}/vip", new { days = 30 });
        var detail = await ReadJson(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(detail.GetProperty("hasProAccess").GetBoolean());
        Assert.Equal("courtesy", detail.GetProperty("access").GetProperty("source").GetString());

        var me = await ReadJson(await ClientFor(customer).GetAsync("/api/auth/me"));
        Assert.True(me.GetProperty("hasVipAccess").GetBoolean());
        Assert.Equal("activa", me.GetProperty("subscriptionState").GetString());

        // La pantalla de suscripción lo dice y no le ofrece pagar por días que ya tiene.
        var overview = await ReadJson(await ClientFor(customer).GetAsync("/api/subscription"));
        Assert.Equal(JsonValueKind.String, overview.GetProperty("courtesyUntilUtc").ValueKind);
        Assert.False(overview.GetProperty("actions").GetProperty("canSubscribe").GetBoolean());
    }

    [Fact]
    public async Task Sin_vencimiento_hay_que_pedirlo_y_una_duracion_inventada_se_rechaza()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser();

        var empty = await admin.PostAsJsonAsync($"/api/admin/users/{customer.Id}/vip", new { });
        var odd = await admin.PostAsJsonAsync($"/api/admin/users/{customer.Id}/vip", new { days = 45 });
        var forever = await ReadJson(await admin.PostAsJsonAsync($"/api/admin/users/{customer.Id}/vip", new { forever = true }));

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, odd.StatusCode);
        Assert.StartsWith("2099-12-31", forever.GetProperty("access").GetProperty("courtesyUntilUtc").GetString());
    }

    [Fact]
    public async Task Quitar_el_VIP_de_regalo_devuelve_la_ficha_sin_Pro_y_deja_rastro()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser();
        await admin.PostAsJsonAsync($"/api/admin/users/{customer.Id}/vip", new { days = 7 });

        var detail = await ReadJson(await admin.DeleteAsync($"/api/admin/users/{customer.Id}/vip"));

        Assert.False(detail.GetProperty("hasProAccess").GetBoolean());
        Assert.Equal("none", detail.GetProperty("access").GetProperty("source").GetString());

        using var db = factory.NewDbContext();
        var actions = await db.AdminAuditEvents
            .Where(item => item.TargetUserId == customer.Id)
            .Select(item => item.Action)
            .ToListAsync();
        Assert.Equal(["grant_vip", "revoke_vip"], actions.Order());
    }

    [Fact]
    public async Task Quitar_VIP_a_quien_no_tiene_Pro_es_409()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser();

        var response = await admin.DeleteAsync($"/api/admin/users/{customer.Id}/vip");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("no_access", (await ReadJson(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Sin_Mercado_Pago_una_suscripcion_paga_no_pierde_el_acceso()
    {
        // La factory arranca sin credenciales: no hay forma de frenar los cobros, así que
        // tampoco se corta el acceso.
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser(subscriptions: ApiFactory.ActiveSubscription());

        var response = await admin.DeleteAsync($"/api/admin/users/{customer.Id}/vip");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        using var db = factory.NewDbContext();
        var stored = await db.Subscriptions.SingleAsync(item => item.UserId == customer.Id);
        Assert.Equal("activa", stored.Status);
        Assert.Null(stored.AccessRevokedAtUtc);
    }

    [Fact]
    public async Task Habilitar_la_semana_gratis_la_deja_lista_para_el_proximo_checkout()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser(hasUsedTrial: true);

        var detail = await ReadJson(await admin.PostAsync($"/api/admin/users/{customer.Id}/trial", null));

        Assert.Equal("granted", detail.GetProperty("access").GetProperty("trialState").GetString());
        Assert.False(detail.GetProperty("hasUsedTrial").GetBoolean());
        var overview = await ReadJson(await ClientFor(customer).GetAsync("/api/subscription"));
        Assert.True(overview.GetProperty("trialAvailable").GetBoolean());
    }

    [Fact]
    public async Task A_una_cuenta_admin_no_se_le_da_ni_se_le_quita_nada()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var other = factory.CreateUser(isAdmin: true);

        var response = await admin.PostAsJsonAsync($"/api/admin/users/{other.Id}/vip", new { days = 7 });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("admin", (await ReadJson(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Las_acciones_sobre_un_id_desconocido_son_404()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var id = Guid.NewGuid();

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/admin/users/{id}/vip", new { days = 7 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/admin/users/{id}/vip")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/admin/users/{id}/trial", null)).StatusCode);
    }

    [Fact]
    public async Task Una_fila_revocada_se_muestra_cortada_el_dia_que_se_quito()
    {
        // Mercado Pago sigue teniendo una próxima fecha de cobro para esa preapproval: la
        // pantalla no puede decir "termina el" esa fecha a quien ya no tiene Pro.
        var revokedAt = DateTime.UtcNow.AddHours(-2);
        var customer = factory.CreateUser(subscriptions: new Subscription
        {
            Status = "cancelada",
            PaymentProvider = "mercadopago",
            ExternalSubscriptionId = "pre-9",
            NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
            AccessRevokedAtUtc = revokedAt,
        });

        var overview = await ReadJson(await ClientFor(customer).GetAsync("/api/subscription"));
        var current = overview.GetProperty("current");
        var actions = overview.GetProperty("actions");

        Assert.False(current.GetProperty("hasAccess").GetBoolean());
        Assert.False(current.GetProperty("autoRenewEnabled").GetBoolean());
        Assert.Equal(revokedAt, current.GetProperty("nextBillingAtUtc").GetDateTime(), TimeSpan.FromSeconds(1));
        Assert.True(actions.GetProperty("canSubscribe").GetBoolean());
        Assert.False(actions.GetProperty("canCancel").GetBoolean());
    }
}
