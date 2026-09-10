using System.Net;
using System.Text.Json;
using backend.Tests.Infrastructure;

namespace backend.Tests.Endpoints;

/// <summary>
/// El panel de administración por HTTP, con el pipeline real. Lo que importa sobre todo
/// es el portero: sin sesión, 401; con sesión pero sin ser admin, 404 en todas las rutas,
/// incluida la única que escribe.
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
    public async Task Una_cuenta_comun_recibe_404_en_todo_el_panel(string method, string path)
    {
        // 404 y no 403: el panel no confirma que existe a quien no puede leerlo.
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

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
    public async Task Consultar_a_Mercado_Pago_devuelve_la_ficha_actualizada()
    {
        // La factory arranca sin credenciales de Mercado Pago: la sincronización no sale a
        // la red y devuelve lo que ya hay, que es justo lo que este test necesita.
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var customer = factory.CreateUser(subscriptions: ApiFactory.ActiveSubscription());

        var response = await client.PostAsync($"/api/admin/users/{customer.Id}/sync", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(customer.Email, (await ReadJson(response)).GetProperty("email").GetString());
    }

    [Fact]
    public async Task Consultar_a_Mercado_Pago_por_un_id_desconocido_es_404()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await client.PostAsync($"/api/admin/users/{Guid.NewGuid()}/sync", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
