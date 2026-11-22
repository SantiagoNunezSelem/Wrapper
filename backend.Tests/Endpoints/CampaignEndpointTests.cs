using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Models;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// Las campañas de QR por HTTP: el link que se imprime, las visitas que trae y lo que esas
/// personas hicieron después. Lo que más importa: el código nunca cambia, una recarga no es
/// otra visita, y reiniciar o borrar no se lleva puestas las cuentas.
/// </summary>
public sealed class CampaignEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task<(string Id, string Code)> Create(HttpClient admin, string title)
    {
        var body = await ReadJson(await admin.PostAsJsonAsync("/api/admin/campaigns", new { title }));
        return (body.GetProperty("id").GetString()!, body.GetProperty("code").GetString()!);
    }

    private static async Task<JsonElement> Summary(HttpClient admin, string id)
    {
        var list = await ReadJson(await admin.GetAsync("/api/admin/campaigns"));
        return list.EnumerateArray().Single(item => item.GetProperty("id").GetString() == id);
    }

    private Task<HttpResponseMessage> Visit(string code, string deviceId) =>
        factory.CreateClient().PostAsJsonAsync("/api/campaigns/visit", new { code, deviceId });

    [Theory]
    [InlineData("GET", "/api/admin/campaigns")]
    [InlineData("POST", "/api/admin/campaigns")]
    [InlineData("PUT", "/api/admin/campaigns/00000000-0000-0000-0000-000000000001")]
    [InlineData("DELETE", "/api/admin/campaigns/00000000-0000-0000-0000-000000000001")]
    [InlineData("POST", "/api/admin/campaigns/00000000-0000-0000-0000-000000000001/reset-visits")]
    [InlineData("GET", "/api/admin/campaigns/00000000-0000-0000-0000-000000000001/users")]
    public async Task Una_cuenta_comun_recibe_404_en_las_campanas(string method, string path)
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
        {
            request.Content = JsonContent.Create(new { title = "x" });
        }

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Renombrar_no_cambia_el_codigo_del_link()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var (id, code) = await Create(admin, "Folleto red flags");

        var renamed = await ReadJson(await admin.PutAsJsonAsync($"/api/admin/campaigns/{id}", new { title = "Red flags · facultad" }));

        Assert.Matches("^[a-z2-9]{6}$", code);
        Assert.Equal(code, renamed.GetProperty("code").GetString());
        Assert.Equal("Red flags · facultad", (await Summary(admin, id)).GetProperty("title").GetString());
    }

    [Fact]
    public async Task Sin_titulo_no_se_crea()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var response = await admin.PostAsJsonAsync("/api/admin/campaigns", new { title = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Una_recarga_no_es_otra_visita_pero_otro_telefono_si()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var (id, code) = await Create(admin, "Visitas");

        Assert.Equal(HttpStatusCode.NoContent, (await Visit(code, "telefono-a")).StatusCode);
        await Visit(code.ToUpperInvariant(), "telefono-a");
        await Visit(code, "telefono-b");

        var summary = await Summary(admin, id);
        Assert.Equal(2, summary.GetProperty("visits").GetInt32());
        Assert.Equal(2, summary.GetProperty("uniqueVisitors").GetInt32());
    }

    [Fact]
    public async Task Un_codigo_desconocido_responde_igual_y_no_guarda_nada()
    {
        int before;
        using (var db = factory.NewDbContext())
        {
            before = await db.CampaignVisits.CountAsync();
        }

        var response = await Visit("zzzzzz", "telefono-x");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var after = factory.NewDbContext();
        Assert.Equal(before, await after.CampaignVisits.CountAsync());
    }

    [Fact]
    public async Task El_embudo_cuenta_registros_trial_y_pagos_de_la_campana()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var (id, _) = await Create(admin, "Embudo");
        var campaignId = Guid.Parse(id);

        var payer = Attribute(factory.CreateUser(subscriptions: ApiFactory.ActiveSubscription()), campaignId);
        Attribute(factory.CreateUser(), campaignId);
        using (var db = factory.NewDbContext())
        {
            var subscription = await db.Subscriptions.SingleAsync(item => item.UserId == payer.Id);
            subscription.TrialWasApplied = true;
            db.SubscriptionInvoices.Add(new SubscriptionInvoice
            {
                SubscriptionId = subscription.Id,
                UserId = payer.Id,
                ExternalPaymentId = Guid.NewGuid().ToString("N"),
                Amount = 4500,
                Status = "aprobado",
                PaidAtUtc = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var summary = await Summary(admin, id);
        var users = await ReadJson(await admin.GetAsync($"/api/admin/campaigns/{id}/users"));

        Assert.Equal(2, summary.GetProperty("signups").GetInt32());
        Assert.Equal(1, summary.GetProperty("trials").GetInt32());
        Assert.Equal(1, summary.GetProperty("paid").GetInt32());
        Assert.Equal(4500m, summary.GetProperty("revenue").GetDecimal());
        Assert.Equal(2, users.GetArrayLength());
    }

    [Fact]
    public async Task Reiniciar_borra_las_visitas_y_deja_los_registros()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var (id, code) = await Create(admin, "Reinicio");
        await Visit(code, "telefono-c");
        Attribute(factory.CreateUser(), Guid.Parse(id));

        var response = await admin.PostAsync($"/api/admin/campaigns/{id}/reset-visits", null);

        var summary = await Summary(admin, id);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(0, summary.GetProperty("visits").GetInt32());
        Assert.Equal(1, summary.GetProperty("signups").GetInt32());
        Assert.Equal(JsonValueKind.String, summary.GetProperty("visitsResetAtUtc").ValueKind);
    }

    [Fact]
    public async Task Borrar_la_campana_deja_las_cuentas_sin_atribuir()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);
        var (id, code) = await Create(admin, "Borrar");
        await Visit(code, "telefono-d");
        var user = Attribute(factory.CreateUser(), Guid.Parse(id));

        var response = await admin.DeleteAsync($"/api/admin/campaigns/{id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var db = factory.NewDbContext();
        Assert.False(await db.Campaigns.AnyAsync(item => item.Id == Guid.Parse(id)));
        Assert.False(await db.CampaignVisits.AnyAsync(item => item.CampaignId == Guid.Parse(id)));
        Assert.Null((await db.Users.SingleAsync(item => item.Id == user.Id)).CampaignId);
    }

    private User Attribute(User user, Guid campaignId)
    {
        using var db = factory.NewDbContext();
        var row = db.Users.Single(item => item.Id == user.Id);
        row.CampaignId = campaignId;
        db.SaveChanges();
        return row;
    }
}
