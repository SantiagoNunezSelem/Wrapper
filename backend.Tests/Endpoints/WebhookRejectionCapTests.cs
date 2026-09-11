using System.Net;
using System.Text;
using backend.Models;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// El registro de avisos rechazados en la base, que alimenta Urgencias. Clase aparte con su
/// propia base a propósito: este test la llena hasta el tope, y compartida dejaría sin lugar
/// al test que comprueba que un rechazo sí se guarda.
/// </summary>
public sealed class WebhookRejectionCapTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Pasado_el_tope_por_hora_un_rechazo_ya_no_se_guarda()
    {
        // El endpoint es público: sin tope, un script que manda avisos sin firma llenaría la
        // tabla tan rápido como lo deje el límite global de pedidos.
        using (var db = factory.NewDbContext())
        {
            for (var i = 0; i < 100; i++)
            {
                db.WebhookRejections.Add(new WebhookRejection { Topic = "payment", DataId = $"relleno-{i}", Reason = "test", ReceivedAtUtc = DateTime.UtcNow });
            }

            await db.SaveChangesAsync();
        }

        var body = new StringContent("""{"type":"payment","data":{"id":"rechazo-de-mas"}}""", Encoding.UTF8, "application/json");
        var response = await factory.CreateClient().PostAsync("/api/webhooks/mercadopago", body);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        using var check = factory.NewDbContext();
        Assert.False(await check.WebhookRejections.AnyAsync(item => item.DataId == "rechazo-de-mas"));
    }

    [Fact]
    public async Task Los_rechazos_viejos_no_cuentan_para_el_tope()
    {
        using (var db = factory.NewDbContext())
        {
            for (var i = 0; i < 100; i++)
            {
                db.WebhookRejections.Add(new WebhookRejection { Topic = "payment", DataId = $"viejo-{i}", Reason = "test", ReceivedAtUtc = DateTime.UtcNow.AddHours(-2) });
            }

            await db.SaveChangesAsync();
        }

        // Si el test anterior corrió antes, la última hora ya está llena: se vacía para que
        // lo único que quede sean los cien viejos.
        using (var db = factory.NewDbContext())
        {
            var hourAgo = DateTime.UtcNow.AddHours(-1);
            db.WebhookRejections.RemoveRange(db.WebhookRejections.Where(item => item.ReceivedAtUtc >= hourAgo));
            await db.SaveChangesAsync();
        }

        var body = new StringContent("""{"type":"payment","data":{"id":"rechazo-nuevo"}}""", Encoding.UTF8, "application/json");
        await factory.CreateClient().PostAsync("/api/webhooks/mercadopago", body);

        using var check = factory.NewDbContext();
        Assert.True(await check.WebhookRejections.AnyAsync(item => item.DataId == "rechazo-nuevo"));
    }
}
