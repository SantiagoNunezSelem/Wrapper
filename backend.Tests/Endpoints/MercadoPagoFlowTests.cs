using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace backend.Tests.Endpoints;

public sealed class MercadoPagoFlowTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task Checkout_autorizacion_pago_y_cancelacion(bool recoverWithSync, bool hasUsedTrial)
    {
        using var factory = new PaymentFactory();
        var (client, user) = factory.CreateAuthenticatedClient(hasUsedTrial: hasUsedTrial);

        Assert.False(await HasAccess(client));
        (await client.PostAsJsonAsync("/api/subscription/checkout", new { payerEmail = "payer@example.com" })).EnsureSuccessStatusCode();
        Assert.False(await HasAccess(client));
        Assert.Equal("payer@example.com", factory.Provider.Checkout.GetProperty("payer_email").GetString());
        Assert.Equal("ARS", factory.Provider.Checkout.GetProperty("auto_recurring").GetProperty("currency_id").GetString());
        Assert.Equal(!hasUsedTrial, factory.Provider.Checkout.GetProperty("auto_recurring").TryGetProperty("free_trial", out _));
        using (var db = factory.NewDbContext())
        {
            var subscription = Assert.Single(db.Subscriptions);
            Assert.Equal(subscription.Id.ToString(), factory.Provider.Reference);
            Assert.Equal("pre-1", subscription.ExternalSubscriptionId);
        }

        factory.Provider.Status = "authorized";
        if (recoverWithSync)
            (await client.PostAsJsonAsync("/api/subscription/sync", new { })).EnsureSuccessStatusCode();
        else
            (await Notify(client, "subscription_preapproval", "pre-1")).EnsureSuccessStatusCode();
        Assert.Equal(!hasUsedTrial, await HasAccess(client));

        (await Notify(client, "subscription_authorized_payment", "123")).EnsureSuccessStatusCode();
        (await Notify(client, "subscription_authorized_payment", "123")).EnsureSuccessStatusCode();
        DateTime paidPeriodEnd;
        using (var db = factory.NewDbContext())
        {
            var subscription = Assert.Single(db.Subscriptions);
            var invoice = Assert.Single(db.SubscriptionInvoices);
            Assert.Equal(user.Id, invoice.UserId);
            Assert.Equal(subscription.Id, invoice.SubscriptionId);
            Assert.Equal("aprobado", invoice.Status);
            Assert.NotNull(invoice.PaidAtUtc);
            Assert.Equal("activa", subscription.Status);
            Assert.Equal(invoice.PaidAtUtc, subscription.LastPaymentAtUtc);
            paidPeriodEnd = Assert.IsType<DateTime>(invoice.PeriodEndUtc);
            Assert.Equal(paidPeriodEnd, subscription.NextBillingAtUtc);
        }
        Assert.True(await HasAccess(client));

        var cancellation = await client.PostAsJsonAsync("/api/subscription/cancel", new { });
        cancellation.EnsureSuccessStatusCode();
        Assert.Equal("cancelled", factory.Provider.Status);
        Assert.True(await HasAccess(client));
        using (var db = factory.NewDbContext())
        {
            var subscription = Assert.Single(db.Subscriptions);
            Assert.Equal("cancelada", subscription.Status);
            Assert.Equal(paidPeriodEnd, subscription.NextBillingAtUtc);
        }
    }

    [Fact]
    public async Task Primer_pago_rechazado_sin_trial_no_regala_Pro()
    {
        using var factory = new PaymentFactory();
        var (client, user) = factory.CreateAuthenticatedClient(hasUsedTrial: true);
        (await client.PostAsJsonAsync("/api/subscription/checkout", new { payerEmail = "payer@example.com" })).EnsureSuccessStatusCode();
        Assert.False(factory.Provider.Checkout.GetProperty("auto_recurring").TryGetProperty("free_trial", out _));

        factory.Provider.Status = "authorized";
        (await Notify(client, "subscription_preapproval", "pre-1")).EnsureSuccessStatusCode();
        Assert.False(await HasAccess(client));

        factory.Provider.PaymentStatus = "rejected";
        (await Notify(client, "subscription_authorized_payment", "123")).EnsureSuccessStatusCode();
        (await Notify(client, "subscription_authorized_payment", "123")).EnsureSuccessStatusCode();
        Assert.False(await HasAccess(client));

        using var db = factory.NewDbContext();
        var subscription = Assert.Single(db.Subscriptions);
        Assert.Equal("pendiente", subscription.Status);
        Assert.Null(subscription.TrialEndsAtUtc);
        Assert.Null(subscription.GraceEndsAtUtc);
        Assert.Null(subscription.LastPaymentAtUtc);

        var invoice = Assert.Single(db.SubscriptionInvoices);
        Assert.Equal(user.Id, invoice.UserId);
        Assert.Equal(subscription.Id, invoice.SubscriptionId);
        Assert.Equal("rechazado", invoice.Status);
        Assert.Equal("cc_rejected_insufficient_amount", invoice.StatusDetail);
        Assert.Null(invoice.PaidAtUtc);

        var overview = await client.GetFromJsonAsync<JsonElement>("/api/subscription");
        Assert.Equal("declined", overview.GetProperty("current").GetProperty("phase").GetString());
    }

    [Fact]
    public async Task Firma_invalida_no_consulta_el_proveedor()
    {
        using var factory = new PaymentFactory();
        var client = factory.CreateClient();
        var response = await Notify(client, "subscription_preapproval", "pre-1", "wrong-secret");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, factory.Provider.Calls);
        using var db = factory.NewDbContext();
        Assert.Empty(db.Subscriptions);
    }

    private static async Task<bool> HasAccess(HttpClient client) =>
        (await client.GetFromJsonAsync<JsonElement>("/api/subscription")).GetProperty("hasVipAccess").GetBoolean();

    private static Task<HttpResponseMessage> Notify(HttpClient client, string topic, string id, string secret = "flow-secret")
    {
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var hash = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),
            Encoding.UTF8.GetBytes($"id:{id};request-id:flow;ts:{ts};"))).ToLowerInvariant();
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/webhooks/mercadopago?data.id={id}")
        { Content = JsonContent.Create(new { type = topic, action = "updated", data = new { id } }) };
        request.Headers.Add("x-request-id", "flow");
        request.Headers.Add("x-signature", $"ts={ts},v1={hash}");
        return client.SendAsync(request);
    }

    private sealed class PaymentFactory : ApiFactory
    {
        public ProviderHandler Provider { get; } = new();
        public PaymentFactory()
        {
            Settings["MercadoPago:AccessToken"] = "TEST-local";
            Settings["MercadoPago:WebhookSecret"] = "flow-secret";
            Settings["MercadoPago:ReconcileIntervalMinutes"] = "0";
        }
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services => services.AddHttpClient<MercadoPagoClient>()
                .ConfigurePrimaryHttpMessageHandler(() => Provider));
        }
    }

    private sealed class ProviderHandler : HttpMessageHandler
    {
        public JsonElement Checkout { get; private set; }
        public string? Reference { get; private set; }
        public string Status { get; set; } = "pending";
        public int Calls { get; private set; }
        public string PaymentStatus { get; set; } = "approved";
        private readonly DateTime _now = DateTime.UtcNow;
        private DateTime? _paidPeriodEnd;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            var path = request.RequestUri!.AbsolutePath;
            object body;
            if (request.Method == HttpMethod.Post && path == "/preapproval")
            {
                using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                Checkout = document.RootElement.Clone();
                Reference = Checkout.GetProperty("external_reference").GetString();
            }
            else if (request.Method == HttpMethod.Put && path == "/preapproval/pre-1")
            {
                var update = await request.Content!.ReadFromJsonAsync<JsonElement>(cancellationToken);
                Status = update.GetProperty("status").GetString()!;
            }
            else if (request.Method != HttpMethod.Get)
                throw new InvalidOperationException($"Unexpected provider request: {request.Method} {path}");
            if (path is "/preapproval" or "/preapproval/pre-1")
                body = new { id = "pre-1", status = Status, external_reference = Reference,
                    payer_email = "payer@example.com", init_point = "https://mp.test/checkout", date_created = _now,
                    next_payment_date = _paidPeriodEnd ?? _now.AddDays(7), auto_recurring = Checkout.GetProperty("auto_recurring") };
            else if (path == "/authorized_payments/123")
            {
                if (PaymentStatus == "approved")
                    _paidPeriodEnd = _now.AddMonths(1);
                body = new { id = 123, preapproval_id = "pre-1", status = "processed", transaction_amount = 7800,
                    currency_id = "ARS", date_created = _now, last_modified = _now, debit_date = _now,
                    period = new { start_date = _now, end_date = _now.AddMonths(1) },
                    payment = new { id = 456, status = PaymentStatus, status_detail = PaymentStatus == "approved" ? "accredited" : "cc_rejected_insufficient_amount" } };
            }
            else if (path is "/authorized_payments/search" or "/v1/payments/search")
                body = new { results = Array.Empty<object>() };
            else throw new InvalidOperationException($"Unexpected provider request: {request.Method} {path}");
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(body) };
        }
    }
}
