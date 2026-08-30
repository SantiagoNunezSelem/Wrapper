namespace backend.Models;

public sealed class Subscription
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// <c>pendiente</c> (checkout opened, payer has not authorised yet), <c>trial</c>,
    /// <c>activa</c>, <c>pago_fallido</c>, <c>pausada</c>, <c>cancelada</c>,
    /// <c>inactiva</c>. See <see cref="Services.SubscriptionAccessEvaluator"/> for which
    /// of these still grant Pro.
    /// </summary>
    public string Status { get; set; } = "inactiva";
    public string? PaymentProvider { get; set; }
    public string PlanType { get; set; } = "mensual";
    public DateTime? TrialStartsAtUtc { get; set; }
    public DateTime? TrialEndsAtUtc { get; set; }
    public DateTime? SubscriptionStartsAtUtc { get; set; }
    public DateTime? NextBillingAtUtc { get; set; }
    public DateTime? CancelledAtUtc { get; set; }

    /// <summary>Mercado Pago's <c>preapproval</c> id.</summary>
    public string? ExternalSubscriptionId { get; set; }

    /// <summary>The <c>preapproval_plan</c> this subscription was created from.</summary>
    public string? ExternalPlanId { get; set; }

    /// <summary>Mercado Pago's payer id, for support lookups.</summary>
    public string? ExternalPayerId { get; set; }

    /// <summary>
    /// The checkout this subscription was opened with, kept so an interrupted payment can
    /// be resumed from the account screen instead of starting over. Mercado Pago's
    /// <c>init_point</c> for a <c>pending</c> preapproval stays valid until it is
    /// authorised, which is exactly the window in which someone closes the tab.
    /// </summary>
    public string? CheckoutUrl { get; set; }

    /// <summary>
    /// Why the last charge is not settled yet, verbatim from Mercado Pago
    /// (<c>pending_contingency</c>, <c>pending_challenge</c>, <c>cc_rejected_…</c>).
    /// A payment sitting in "pendiente" is not one thing — it can be the issuer asking
    /// for confirmation, an offline method awaiting the payer, or Mercado Pago's own
    /// two-day review — and the account screen is useless if it cannot say which.
    /// </summary>
    public string? LastPaymentStatusDetail { get; set; }

    /// <summary>When the subscription was paused, so "reanudar" can say since when.</summary>
    public DateTime? PausedAtUtc { get; set; }

    public decimal Amount { get; set; }
    public string CurrencyId { get; set; } = "ARS";

    /// <summary>Human label for the card on file, e.g. "Visa ···· 6411".</summary>
    public string? PaymentMethodLabel { get; set; }

    public DateTime? LastPaymentAtUtc { get; set; }

    /// <summary>
    /// While a charge is failing, Pro stays on until this moment. Set from
    /// <c>MercadoPago:FailedPaymentGraceDays</c> on the first rejection so a card that
    /// recovers on Mercado Pago's own retry never causes a visible outage.
    /// </summary>
    public DateTime? GraceEndsAtUtc { get; set; }

    /// <summary>Whether this subscription consumed the account's one free week.</summary>
    public bool TrialWasApplied { get; set; }

    public DateTime? LastSyncedAtUtc { get; set; }

    /// <summary>Seeded VIP for the configured admin account.</summary>
    public bool IsSeededVip { get; set; }

    /// <summary>
    /// Granted by the local dev toggle, never by a real payment. Flagged so it can be
    /// told apart in the history and so production data can be audited for it.
    /// </summary>
    public bool IsDevSimulated { get; set; }

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

    public List<SubscriptionInvoice> Invoices { get; init; } = [];
}
