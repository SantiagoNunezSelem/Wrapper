using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using backend.Tests.Infrastructure;

namespace backend.Tests.Endpoints;

/// <summary>
/// Salud y sesión. El camino feliz del login con Google no se puede probar acá: valida
/// el id token contra los servidores de Google, y ningún test debe salir a la red. Lo
/// que sí se prueba es todo lo que rodea a esa validación, que es donde están los
/// rechazos.
/// </summary>
public sealed class HealthAndAuthEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task El_healthcheck_responde_sin_sesion()
    {
        var response = await factory.CreateClient().GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", (await ReadJson(response)).GetProperty("status").GetString());
    }

    // -----------------------------------------------------------------------
    // Login con Google
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Un_login_sin_id_token_es_400()
    {
        var response = await factory.CreateClient()
            .PostAsJsonAsync("/api/auth/google", new { idToken = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Missing Google ID token", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Un_id_token_que_no_valida_es_400_y_no_crea_cuenta()
    {
        var before = factory.NewDbContext().Users.Count();

        var response = await factory.CreateClient()
            .PostAsJsonAsync("/api/auth/google", new { idToken = "no-es-un-jwt-de-google" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(before, factory.NewDbContext().Users.Count());
    }

    [Fact]
    public async Task El_login_acepta_el_cuerpo_con_los_campos_de_reCAPTCHA()
    {
        // Con reCAPTCHA sin configurar la verificación se saltea entera y el flujo se
        // comporta igual que antes de que existiera.
        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/google",
            new { idToken = "invalido", recaptchaToken = "rc", recaptchaIsFallback = true });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Un_cuerpo_que_no_es_JSON_no_tumba_el_servidor()
    {
        var response = await factory.CreateClient().PostAsync(
            "/api/auth/google",
            new StringContent("esto no es json", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Sesión actual
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Sin_token_la_sesion_actual_es_401()
    {
        var response = await factory.CreateClient().GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Con_un_token_invalido_es_401()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer token.completamente.falso");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Con_un_token_valido_devuelve_el_perfil()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        var response = await client.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal(user.Id, body.GetProperty("id").GetGuid());
        Assert.Equal(user.Email, body.GetProperty("email").GetString());
        Assert.False(body.GetProperty("isAdmin").GetBoolean());
        Assert.False(body.GetProperty("hasVipAccess").GetBoolean());
        Assert.Equal("inactiva", body.GetProperty("subscriptionState").GetString());
    }

    [Fact]
    public async Task El_perfil_informa_que_la_IA_y_los_pagos_no_estan_configurados()
    {
        // Sirve para que la app esconda el flujo entero en vez de mostrar un botón de
        // reintento para lo que en realidad es una config faltante del servidor.
        var (client, _) = factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.GetAsync("/api/auth/me"));

        Assert.False(body.GetProperty("aiEnabled").GetBoolean());
        Assert.False(body.GetProperty("paymentsEnabled").GetBoolean());
    }

    [Fact]
    public async Task El_perfil_refleja_el_acceso_Pro()
    {
        var (client, _) = factory.CreateAuthenticatedClient(subscriptions: ApiFactory.ActiveSubscription());

        var body = await ReadJson(await client.GetAsync("/api/auth/me"));

        Assert.True(body.GetProperty("hasVipAccess").GetBoolean());
        Assert.Equal("activa", body.GetProperty("subscriptionState").GetString());
    }

    [Fact]
    public async Task El_perfil_de_un_admin_tiene_acceso_sin_suscripcion()
    {
        var (client, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var body = await ReadJson(await client.GetAsync("/api/auth/me"));

        Assert.True(body.GetProperty("isAdmin").GetBoolean());
        Assert.True(body.GetProperty("hasVipAccess").GetBoolean());
    }

    [Fact]
    public async Task El_perfil_expone_si_ya_dio_consentimiento_para_la_IA()
    {
        var (withConsent, _) = factory.CreateAuthenticatedClient(hasAiConsent: true);
        var (without, _) = factory.CreateAuthenticatedClient();

        Assert.True((await ReadJson(await withConsent.GetAsync("/api/auth/me"))).GetProperty("hasAiConsent").GetBoolean());
        Assert.False((await ReadJson(await without.GetAsync("/api/auth/me"))).GetProperty("hasAiConsent").GetBoolean());
    }

    [Fact]
    public async Task Un_token_de_una_cuenta_borrada_es_401()
    {
        var user = factory.CreateUser();
        var token = factory.TokenFor(user);

        using (var db = factory.NewDbContext())
        {
            db.Users.Remove(db.Users.Find(user.Id)!);
            db.SaveChanges();
        }

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {token}");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }
}
