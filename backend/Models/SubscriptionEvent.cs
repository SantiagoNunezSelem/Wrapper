namespace backend.Models;

/// <summary>
/// Append-only log of everything that ever moved a subscription: checkouts, webhook
/// notifications, cancellations, manual syncs. It does double duty —
///
/// 1. it is the evidence trail when someone disputes a charge, and
/// 2. <see cref="ExternalEventId"/> is unique, which is what makes webhook handling
///    idempotent. Mercado Pago retries a notification until it gets a 2xx, so the same
///    event arriving three times must not bill, credit, or cancel three times.
/// </summary>
public sealed class SubscriptionEvent
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid? SubscriptionId { get; set; }
    public Guid? UserId { get; set; }

    /// <summary>Mercado Pago's preapproval id, kept even when the row could not be
    /// matched to a local subscription (which is itself worth being able to see).</summary>
    public string? ExternalSubscriptionId { get; set; }

    /// <summary>Notification topic (<c>subscription_preapproval</c>,
    /// <c>subscription_authorized_payment</c>, <c>payment</c>) or a local verb
    /// (<c>checkout</c>, <c>cancel</c>, <c>sync</c>, <c>dev</c>).</summary>
    public string Topic { get; set; } = string.Empty;

    /// <summary>The provider's <c>action</c> field, e.g. <c>updated</c>.</summary>
    public string? Action { get; set; }

    /// <summary>Deduplication key. For webhooks: topic + the notified resource id +
    /// the resource's own last-modified stamp, so genuine repeat deliveries collapse
    /// while a real later change still gets through.</summary>
    public string? ExternalEventId { get; set; }

    /// <summary>The subscription status this event produced, for reading the history back.</summary>
    public string? ResultingStatus { get; set; }

    /// <summary>Raw notification body, trimmed. Invaluable when a charge is questioned.</summary>
    public string? PayloadJson { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
}
