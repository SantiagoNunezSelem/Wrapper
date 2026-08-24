using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Thin typed wrapper over the Mercado Pago Subscriptions (preapproval) API. Only the
/// calls this product makes are modelled; everything else is deliberately absent.
///
/// The provider is the source of truth for money — this client never infers a status,
/// it re-reads the resource after every notification. See <see cref="SubscriptionService"/>.
/// </summary>
public sealed class MercadoPagoClient(
    HttpClient httpClient,
    IOptions<MercadoPagoOptions> options,
    ILogger<MercadoPagoClient> logger)
{
    private readonly MercadoPagoOptions _options = options.Value;

    /// <remarks>
    /// Ojo con <see cref="JsonIgnoreCondition.WhenWritingNull"/>: sólo alcanza a las
    /// PROPIEDADES de un POCO, no a los valores de un <c>Dictionary</c>. Los cuerpos de
    /// esta clase se arman como diccionarios, así que un null se serializa igual — una
    /// clave que no corresponda no se agrega, en vez de ponerse en null.
    /// </remarks>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public bool IsConfigured => _options.IsConfigured;

    /// <summary>
    /// Creates the recurring plan every subscriber attaches to: monthly, in the
    /// configured currency, with the free trial declared natively so Mercado Pago itself
    /// charges $0 for the first week and converts to a real debit on day 8. Simulating
    /// the trial locally would break exactly that automatic conversion.
    /// </summary>
    public async Task<PreapprovalPlan> CreatePlanAsync(bool includeFreeTrial, CancellationToken cancellationToken)
    {
        var autoRecurring = new Dictionary<string, object?>
        {
            ["frequency"] = _options.Frequency,
            ["frequency_type"] = _options.FrequencyType,
            ["transaction_amount"] = _options.TransactionAmount,
            ["currency_id"] = _options.CurrencyId,
        };

        // La clave se agrega sólo cuando corresponde, nunca en null: el
        // DefaultIgnoreCondition de JsonOptions no alcanza a los valores de un Dictionary
        // (ver la nota allá), así que un "free_trial": null viajaría tal cual — la misma
        // clase de envío que GoogleAiClient documenta como rechazada por su API.
        if (includeFreeTrial)
        {
            autoRecurring["free_trial"] = new Dictionary<string, object?>
            {
                ["frequency"] = _options.TrialFrequency,
                ["frequency_type"] = _options.TrialFrequencyType,
            };
        }

        var body = new Dictionary<string, object?>
        {
            ["reason"] = includeFreeTrial ? _options.Reason : $"{_options.Reason} (sin prueba gratis)",
            ["auto_recurring"] = autoRecurring,
            ["back_url"] = _options.CheckoutReturnUrl,
        };

        return await SendAsync<PreapprovalPlan>(HttpMethod.Post, "/preapproval_plan", body, cancellationToken)
            ?? throw new MercadoPagoException("Mercado Pago returned an empty plan.");
    }

    public Task<PreapprovalPlan?> GetPlanAsync(string planId, CancellationToken cancellationToken) =>
        SendAsync<PreapprovalPlan>(HttpMethod.Get, $"/preapproval_plan/{planId}", null, cancellationToken);

    public Task<Preapproval?> GetSubscriptionAsync(string preapprovalId, CancellationToken cancellationToken) =>
        SendAsync<Preapproval>(HttpMethod.Get, $"/preapproval/{preapprovalId}", null, cancellationToken);

    /// <summary>
    /// Finds preapprovals Mercado Pago has on file for a payer. There is no card-token
    /// endpoint to create a subscription from a redirect checkout — the plan's own
    /// <c>init_point</c> is what the payer is sent to, and Mercado Pago creates the actual
    /// preapproval on their side once done, with no id we already know to look it up by.
    /// This is how a local "pendiente" row gets linked to it: by the same payer email, the
    /// same signal <see cref="SubscriptionService"/>'s webhook handler already falls back
    /// to when a notification arrives with no matching local row.
    ///
    /// Sorted newest first by the caller, not by this call — Mercado Pago's own <c>sort</c>/
    /// <c>criteria</c> params on this endpoint reject every value tried against them.
    /// </summary>
    public async Task<IReadOnlyList<Preapproval>> SearchSubscriptionsByPayerEmailAsync(
        string payerEmail,
        CancellationToken cancellationToken)
    {
        var result = await SendAsync<PreapprovalSearch>(
            HttpMethod.Get,
            $"/preapproval/search?payer_email={Uri.EscapeDataString(payerEmail)}&limit=10",
            null,
            cancellationToken);

        return result?.Results ?? [];
    }

    /// <summary>
    /// Stops future debits. Mercado Pago has no "un-cancel": a customer who changes their
    /// mind subscribes again (without a second free trial). Access to what they already
    /// paid for is preserved on our side, not theirs.
    /// </summary>
    public Task<Preapproval?> CancelSubscriptionAsync(string preapprovalId, CancellationToken cancellationToken) =>
        SendAsync<Preapproval>(
            HttpMethod.Put,
            $"/preapproval/{preapprovalId}",
            new Dictionary<string, object?> { ["status"] = "cancelled" },
            cancellationToken);

    /// <summary>Suspends debits while keeping the card on file, so it can be resumed.</summary>
    public Task<Preapproval?> PauseSubscriptionAsync(string preapprovalId, CancellationToken cancellationToken) =>
        SendAsync<Preapproval>(
            HttpMethod.Put,
            $"/preapproval/{preapprovalId}",
            new Dictionary<string, object?> { ["status"] = "paused" },
            cancellationToken);

    public Task<Preapproval?> ResumeSubscriptionAsync(string preapprovalId, CancellationToken cancellationToken) =>
        SendAsync<Preapproval>(
            HttpMethod.Put,
            $"/preapproval/{preapprovalId}",
            new Dictionary<string, object?> { ["status"] = "authorized" },
            cancellationToken);

    /// <summary>One scheduled charge against a subscription — what the billing history lists.</summary>
    public Task<AuthorizedPayment?> GetAuthorizedPaymentAsync(string authorizedPaymentId, CancellationToken cancellationToken) =>
        SendAsync<AuthorizedPayment>(HttpMethod.Get, $"/authorized_payments/{authorizedPaymentId}", null, cancellationToken);

    /// <summary>Every charge Mercado Pago has recorded for a subscription. Used by the
    /// reconciliation path, for when a webhook was missed entirely.</summary>
    public async Task<IReadOnlyList<AuthorizedPayment>> SearchAuthorizedPaymentsAsync(
        string preapprovalId,
        CancellationToken cancellationToken)
    {
        var result = await SendAsync<AuthorizedPaymentSearch>(
            HttpMethod.Get,
            $"/authorized_payments/search?preapproval_id={Uri.EscapeDataString(preapprovalId)}&limit=50",
            null,
            cancellationToken);

        return result?.Results ?? [];
    }

    private async Task<T?> SendAsync<T>(
        HttpMethod method,
        string path,
        Dictionary<string, object?>? body,
        CancellationToken cancellationToken)
    {
        if (!_options.IsConfigured)
        {
            throw new MercadoPagoException("Mercado Pago is not configured: set MercadoPago:AccessToken.");
        }

        using var request = new HttpRequestMessage(method, $"{_options.ApiBaseUrl.TrimEnd('/')}{path}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.AccessToken);

        if (body is not null)
        {
            request.Content = JsonContent.Create(body, options: JsonOptions);

            // Mercado Pago deduplicates retried writes by this key. Without it a timeout
            // that actually succeeded server-side would leave the customer with two
            // subscriptions — and two monthly charges.
            request.Headers.TryAddWithoutValidation("X-Idempotency-Key", Guid.NewGuid().ToString());
        }

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new MercadoPagoException($"Mercado Pago did not respond within {_options.TimeoutSeconds}s ({method} {path}).");
        }
        catch (HttpRequestException exception)
        {
            throw new MercadoPagoException($"Could not reach Mercado Pago ({method} {path}).", exception);
        }

        using (response)
        {
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                // 404 on a read is a real answer ("we have no such subscription"), not a
                // failure — the caller decides what that means.
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound && method == HttpMethod.Get)
                {
                    return default;
                }

                logger.LogWarning(
                    "Mercado Pago {Method} {Path} failed with {Status}: {Payload}",
                    method,
                    path,
                    (int)response.StatusCode,
                    Truncate(payload, 800));

                throw new MercadoPagoException(
                    $"Mercado Pago rejected {method} {path} ({(int)response.StatusCode}). {ExtractMessage(payload)}");
            }

            if (string.IsNullOrWhiteSpace(payload))
            {
                return default;
            }

            try
            {
                return JsonSerializer.Deserialize<T>(payload, JsonOptions);
            }
            catch (JsonException exception)
            {
                throw new MercadoPagoException($"Could not read the Mercado Pago response for {method} {path}.", exception);
            }
        }
    }

    private static string ExtractMessage(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (document.RootElement.TryGetProperty("message", out var message))
            {
                return message.GetString() ?? string.Empty;
            }
        }
        catch (JsonException)
        {
            // Not JSON (gateway HTML, empty body) — the status code already said enough.
        }

        return Truncate(payload, 200);
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "…";
}

public sealed class MercadoPagoException : Exception
{
    public MercadoPagoException(string message) : base(message) { }
    public MercadoPagoException(string message, Exception inner) : base(message, inner) { }
}

// --------------------------------------------------------------------------------
// Response shapes. Only the fields this app reads are declared; Mercado Pago sends
// considerably more.
// --------------------------------------------------------------------------------

public sealed record PreapprovalPlan(
    string? Id,
    string? Status,
    string? Reason,
    [property: JsonPropertyName("init_point")] string? InitPoint,
    [property: JsonPropertyName("auto_recurring")] AutoRecurring? AutoRecurring);

public sealed record Preapproval(
    string? Id,
    string? Status,
    string? Reason,
    [property: JsonPropertyName("payer_id")] long? PayerId,
    [property: JsonPropertyName("payer_email")] string? PayerEmail,
    [property: JsonPropertyName("external_reference")] string? ExternalReference,
    [property: JsonPropertyName("preapproval_plan_id")] string? PreapprovalPlanId,
    [property: JsonPropertyName("init_point")] string? InitPoint,
    [property: JsonPropertyName("sandbox_init_point")] string? SandboxInitPoint,
    [property: JsonPropertyName("date_created")] DateTime? DateCreated,
    [property: JsonPropertyName("last_modified")] DateTime? LastModified,
    [property: JsonPropertyName("next_payment_date")] DateTime? NextPaymentDate,
    [property: JsonPropertyName("payment_method_id")] string? PaymentMethodId,
    [property: JsonPropertyName("auto_recurring")] AutoRecurring? AutoRecurring,
    [property: JsonPropertyName("summarized")] PreapprovalSummary? Summarized);

public sealed record AutoRecurring(
    int? Frequency,
    [property: JsonPropertyName("frequency_type")] string? FrequencyType,
    [property: JsonPropertyName("transaction_amount")] decimal? TransactionAmount,
    [property: JsonPropertyName("currency_id")] string? CurrencyId,
    [property: JsonPropertyName("start_date")] DateTime? StartDate,
    [property: JsonPropertyName("end_date")] DateTime? EndDate,
    [property: JsonPropertyName("free_trial")] FreeTrial? FreeTrial);

public sealed record FreeTrial(
    int? Frequency,
    [property: JsonPropertyName("frequency_type")] string? FrequencyType,
    [property: JsonPropertyName("first_invoice_offset")] int? FirstInvoiceOffset);

public sealed record PreapprovalSummary(
    [property: JsonPropertyName("charged_quantity")] int? ChargedQuantity,
    [property: JsonPropertyName("charged_amount")] decimal? ChargedAmount,
    [property: JsonPropertyName("pending_charge_quantity")] int? PendingChargeQuantity,
    [property: JsonPropertyName("last_charged_date")] DateTime? LastChargedDate,
    [property: JsonPropertyName("last_charged_amount")] decimal? LastChargedAmount,
    [property: JsonPropertyName("semaphore")] string? Semaphore);

public sealed record AuthorizedPayment(
    [property: JsonPropertyName("id")] long? Id,
    [property: JsonPropertyName("preapproval_id")] string? PreapprovalId,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("transaction_amount")] decimal? TransactionAmount,
    [property: JsonPropertyName("currency_id")] string? CurrencyId,
    [property: JsonPropertyName("date_created")] DateTime? DateCreated,
    [property: JsonPropertyName("last_modified")] DateTime? LastModified,
    [property: JsonPropertyName("debit_date")] DateTime? DebitDate,
    [property: JsonPropertyName("retry_attempt")] int? RetryAttempt,
    [property: JsonPropertyName("period")] AuthorizedPaymentPeriod? Period,
    [property: JsonPropertyName("payment")] AuthorizedPaymentDetail? Payment);

public sealed record AuthorizedPaymentPeriod(
    [property: JsonPropertyName("start_date")] DateTime? StartDate,
    [property: JsonPropertyName("end_date")] DateTime? EndDate);

public sealed record AuthorizedPaymentDetail(
    [property: JsonPropertyName("id")] long? Id,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("status_detail")] string? StatusDetail,
    [property: JsonPropertyName("payment_method_id")] string? PaymentMethodId,
    [property: JsonPropertyName("payment_type_id")] string? PaymentTypeId,
    [property: JsonPropertyName("last_four_digits")] string? LastFourDigits);

public sealed record AuthorizedPaymentSearch(
    [property: JsonPropertyName("results")] List<AuthorizedPayment>? Results);

public sealed record PreapprovalSearch(
    [property: JsonPropertyName("results")] List<Preapproval>? Results);
