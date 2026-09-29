using System.Net;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// La fila "Prueba gratis en Mercado Pago" del panel. El checkout manda
/// <c>auto_recurring.free_trial</c> en un preapproval sin plan, y la referencia de la API
/// sólo lo documenta en los planes: si Mercado Pago lo tirara, se cobraría el día uno a
/// gente a la que le prometimos una semana gratis. Esto lo relee de Mercado Pago.
/// </summary>
public class FreeTrialProbeTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();
    private readonly StubHttpMessageHandler _http = new();

    public FreeTrialProbeTests() => FreeTrialProbe.ResetCache();

    public void Dispose()
    {
        FreeTrialProbe.ResetCache();
        _db.Dispose();
    }

    private FreeTrialProbe Probe(string accessToken = "TEST-1")
    {
        var client = new MercadoPagoClient(
            _http.CreateClient(),
            Opt.Of(new MercadoPagoOptions { AccessToken = accessToken }),
            NullLogger<MercadoPagoClient>.Instance);

        return new FreeTrialProbe(_db.Context, client, NullLogger<FreeTrialProbe>.Instance);
    }

    private void AddSubscription(Subscription subscription)
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Test" };
        user.Subscriptions.Add(subscription);
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();
    }

    private static Subscription WithTrial(string preapprovalId, DateTime? createdAt = null) => new()
    {
        Status = "pendiente",
        TrialWasApplied = true,
        ExternalSubscriptionId = preapprovalId,
        CreatedAtUtc = createdAt ?? DateTime.UtcNow,
    };

    [Fact]
    public async Task Si_Mercado_Pago_guardo_la_prueba_esta_OK_y_dice_cuanto_dura()
    {
        AddSubscription(WithTrial("pre-1"));
        _http.Enqueue(HttpStatusCode.OK, """
            {"id":"pre-1","status":"pending","auto_recurring":{"frequency":1,"frequency_type":"months",
             "free_trial":{"frequency":7,"frequency_type":"days","first_invoice_offset":7}}}
            """);

        var status = await Probe().CheckAsync(default);

        Assert.Equal(IntegrationStates.Ok, status.State);
        Assert.Equal("pre-1 · 7 days", status.Value);
        Assert.EndsWith("/preapproval/pre-1", _http.LastRequest.Uri.AbsolutePath);
    }

    [Fact]
    public async Task Si_Mercado_Pago_la_tiro_es_un_error()
    {
        // El caso que existe para detectar: el checkout prometió la semana y Mercado Pago
        // no la tiene, así que el primer cobro no va a esperar.
        AddSubscription(WithTrial("pre-1"));
        _http.Enqueue(HttpStatusCode.OK, """
            {"id":"pre-1","status":"pending","auto_recurring":{"frequency":1,"frequency_type":"months"}}
            """);

        var status = await Probe().CheckAsync(default);

        Assert.Equal(IntegrationStates.Bad, status.State);
        Assert.Equal("pre-1", status.Value);
    }

    [Fact]
    public async Task Mira_el_checkout_con_prueba_mas_nuevo()
    {
        AddSubscription(WithTrial("pre-viejo", DateTime.UtcNow.AddDays(-3)));
        AddSubscription(WithTrial("pre-nuevo"));
        _http.Enqueue(HttpStatusCode.OK, """{"id":"pre-nuevo","auto_recurring":{"free_trial":{"frequency":7,"frequency_type":"days"}}}""");

        await Probe().CheckAsync(default);

        Assert.EndsWith("/preapproval/pre-nuevo", _http.LastRequest.Uri.AbsolutePath);
    }

    [Fact]
    public async Task Ignora_los_simulados_y_los_que_devolvieron_la_semana()
    {
        // Un checkout descartado o reemplazado devuelve la semana (TrialWasApplied = false):
        // no prueba nada, para ningún lado. Uno simulado nunca pasó por Mercado Pago.
        AddSubscription(new Subscription { Status = "cancelada", TrialWasApplied = false, ExternalSubscriptionId = "pre-1" });
        AddSubscription(new Subscription { Status = "activa", TrialWasApplied = true, IsDevSimulated = true, ExternalSubscriptionId = "pre-2" });

        var status = await Probe().CheckAsync(default);

        Assert.Equal(IntegrationStates.Off, status.State);
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Sin_credenciales_no_pregunta_nada()
    {
        AddSubscription(WithTrial("pre-1"));

        var status = await Probe(accessToken: "").CheckAsync(default);

        Assert.Equal(IntegrationStates.Off, status.State);
        Assert.Empty(_http.Requests);
    }

    [Fact]
    public async Task Si_no_se_puede_leer_avisa_sin_dar_veredicto()
    {
        AddSubscription(WithTrial("pre-1"));
        _http.Enqueue(HttpStatusCode.InternalServerError, "{}");

        var status = await Probe().CheckAsync(default);

        Assert.Equal(IntegrationStates.Warn, status.State);
    }

    [Fact]
    public async Task La_respuesta_se_guarda_para_no_preguntar_en_cada_visita()
    {
        AddSubscription(WithTrial("pre-1"));
        _http.Enqueue(HttpStatusCode.OK, """{"id":"pre-1","auto_recurring":{"free_trial":{"frequency":7,"frequency_type":"days"}}}""");

        await Probe().CheckAsync(default);
        var second = await Probe().CheckAsync(default);

        Assert.Equal(IntegrationStates.Ok, second.State);
        Assert.Single(_http.Requests);
    }
}
