namespace backend.Models;

/// <summary>
/// One charge attempt against a subscription — Mercado Pago calls these
/// <c>authorized_payments</c>. This is the billing history the account screen shows,
/// stored locally so opening it costs no API call and still works if Mercado Pago is
/// briefly unreachable.
/// </summary>
public sealed class SubscriptionInvoice
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid SubscriptionId { get; set; }
    public Subscription? Subscription { get; set; }
    public Guid UserId { get; set; }

    /// <summary>Mercado Pago's authorized_payment id. Unique — see the webhook dedup note
    /// on <see cref="SubscriptionEvent"/>.</summary>
    public string ExternalPaymentId { get; set; } = string.Empty;

    /// <summary>The underlying payment id, when the charge actually reached a card.</summary>
    public string? ExternalTransactionId { get; set; }

    public decimal Amount { get; set; }
    public string CurrencyId { get; set; } = "ARS";

    /// <summary>Normalised for the UI: <c>aprobado</c>, <c>rechazado</c>, <c>pendiente</c>,
    /// <c>reintentando</c>, <c>devuelto</c>.</summary>
    public string Status { get; set; } = "pendiente";

    /// <summary>Provider status verbatim, so a surprising value can still be traced.</summary>
    public string? RawStatus { get; set; }

    public string? PaymentMethodLabel { get; set; }

    /// <summary>The period this charge paid for.</summary>
    public DateTime? PeriodStartUtc { get; set; }
    public DateTime? PeriodEndUtc { get; set; }

    public DateTime? PaidAtUtc { get; set; }
    public DateTime? DebitScheduledAtUtc { get; set; }

    /// <summary>Which retry this was; Mercado Pago re-attempts a rejected debit.</summary>
    public int AttemptNumber { get; set; }

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
