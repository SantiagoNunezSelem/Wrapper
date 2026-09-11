using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// El panel de administración por HTTP, con el pipeline real. Lo que importa sobre todo
/// es el portero: sin sesión, 401; con sesión pero sin ser admin, 404 en todas las rutas,
/// incluidas las que escriben o exportan.
/// </summary>
public sealed class AdminEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task Sin_sesion_el_panel_responde_401()
    {
        var response = await factory.CreateClient().GetAsync("/api/admin/business");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/admin/business")]
    [InlineData("GET", "/api/admin/urgencies")]
    [InlineData("GET", "/api/admin/users")]
    [InlineData("GET", "/api/admin/users/00000000-0000-0000-0000-000000000001")]
    [InlineData("POST", "/api/admin/users/00000000-0000-0000-0000-000000000001/sync")]
    [InlineData("POST", "/api/admin/users/00000000-0000-0000-0000-000000000001/notes")]
    [InlineData("GET", "/api/admin/invoices")]
    [InlineData("GET", "/api/admin/ai")]
    [InlineData("GET", "/api/admin/product")]
    [InlineData("GET", "/api/admin/system")]
    [InlineData("GET", "/api/admin/export/users.csv")]
    [InlineData("GET", "/api/admin/export/invoices.csv")]
    public async Task Una_cuenta_comun_recibe_404_en_todo_el_panel(string method, string path)
    {
        // 404 y no 403: el panel no confirma que existe a quien no puede leerlo.
        var (client, _) = factory.CreateAuthenticatedClient();
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "POST")
        {
            request.Content = JsonContent.Create(new { text = "hola" });
        }

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Un_admin_ve_el_negocio()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var body = await ReadJson(await client.GetAsync("/api/admin/business?days=7"));

        Assert.Equal(7, body.GetProperty("days").GetInt32());
        Assert.True(body.GetProperty("registeredUsers").GetInt32() >= 1);
        Assert.Equal(7, body.GetProperty("signupsByDay").GetArrayLength());
        Assert.Equal(JsonValueKind.Object, body.GetProperty("funnel").ValueKind);
        Assert.Equal(6, body.GetProperty("proMovements").GetArrayLength());
    }

    [Fact]
    public async Task Un_admin_ve_las_urgencias_y_la_salud_de_pagos()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var body = await ReadJson(await client.GetAsync("/api/admin/urgencies"));

        Assert.Equal(JsonValueKind.Array, body.GetProperty("items").ValueKind);
        Assert.False(body.GetProperty("health").GetProperty("webhookSecretConfigured").GetBoolean());
    }

    [Fact]
    public async Task Un_admin_busca_usuarios_y_abre_su_ficha()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser(subscriptions: ApiFactory.ActiveSubscription());

        var page = await ReadJson(await client.GetAsync($"/api/admin/users?q={customer.Email}"));
        var detail = await ReadJson(await client.GetAsync($"/api/admin/users/{customer.Id}"));

        Assert.Equal(1, page.GetProperty("total").GetInt32());
        Assert.Equal(customer.Email, detail.GetProperty("email").GetString());
        Assert.Equal("activa", detail.GetProperty("current").GetProperty("status").GetString());
    }

    [Fact]
    public async Task La_ficha_de_un_id_desconocido_es_404()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.GetAsync($"/api/admin/users/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Consultar_a_Mercado_Pago_devuelve_la_ficha_y_deja_rastro()
    {
        // La factory arranca sin credenciales de Mercado Pago: la sincronización no sale a
        // la red y devuelve lo que ya hay, que es justo lo que este test necesita.
        var (client, admin) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsync($"/api/admin/users/{customer.Id}/sync", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(customer.Email, (await ReadJson(response)).GetProperty("email").GetString());
        using var db = factory.NewDbContext();
        Assert.True(await db.AdminAuditEvents.AnyAsync(item => item.Action == AdminActions.Sync && item.TargetUserId == customer.Id && item.AdminId == admin.Id));
    }

    [Fact]
    public async Task Consultar_a_Mercado_Pago_por_un_id_desconocido_es_404()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.PostAsync($"/api/admin/users/{Guid.NewGuid()}/sync", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Una_nota_vacia_se_rechaza_y_una_con_texto_aparece_en_la_ficha()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser();

        var empty = await client.PostAsJsonAsync($"/api/admin/users/{customer.Id}/notes", new { text = "   " });
        var saved = await client.PostAsJsonAsync($"/api/admin/users/{customer.Id}/notes", new { text = "Pidió factura." });
        var detail = await ReadJson(await client.GetAsync($"/api/admin/users/{customer.Id}"));

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal("Pidió factura.", detail.GetProperty("notes")[0].GetProperty("text").GetString());
    }

    [Fact]
    public async Task Una_nota_para_una_cuenta_que_no_existe_es_404()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.PostAsJsonAsync($"/api/admin/users/{Guid.NewGuid()}/notes", new { text = "hola" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/admin/invoices", "items")]
    [InlineData("/api/admin/ai?days=7", "tokensByDay")]
    [InlineData("/api/admin/product?days=7", "analysesByDay")]
    [InlineData("/api/admin/system", "integrations")]
    public async Task Un_admin_ve_las_secciones_secundarias(string path, string listProperty)
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(JsonValueKind.Array, (await ReadJson(response)).GetProperty(listProperty).ValueKind);
    }

    [Fact]
    public async Task Exportar_usuarios_baja_un_CSV_y_deja_rastro()
    {
        var (client, admin) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.GetAsync("/api/admin/export/users.csv");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("id,email,nombre", body);
        Assert.Contains(admin.Email, body);
        using var db = factory.NewDbContext();
        Assert.True(await db.AdminAuditEvents.AnyAsync(item => item.Action == AdminActions.ExportUsers && item.AdminId == admin.Id));
    }

    [Fact]
    public async Task Exportar_cobros_baja_un_CSV()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.GetAsync("/api/admin/export/invoices.csv");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("id,email,estado", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Abrir_la_app_registra_el_ultimo_ingreso()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        await client.GetAsync("/api/auth/me");

        using var db = factory.NewDbContext();
        Assert.NotNull((await db.Users.SingleAsync(item => item.Id == user.Id)).LastSeenAtUtc);
    }

    [Fact]
    public async Task Un_aviso_rechazado_queda_guardado_en_la_base()
    {
        // La factory no tiene secreto de webhook: todo aviso se rechaza, que es lo que hace
        // falta para ver que el rechazo sobrevive fuera de la memoria.
        var body = new StringContent("""{"type":"payment","data":{"id":"rechazo-1"}}""", Encoding.UTF8, "application/json");

        var response = await factory.CreateClient().PostAsync("/api/webhooks/mercadopago", body);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        using var db = factory.NewDbContext();
        Assert.True(await db.WebhookRejections.AnyAsync(item => item.DataId == "rechazo-1"));
    }
}
