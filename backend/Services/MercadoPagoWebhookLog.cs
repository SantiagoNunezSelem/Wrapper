namespace backend.Services;

/// <summary>
/// A short, in-memory record of what has actually arrived at the webhook endpoint.
///
/// It exists because the two failure modes that strand a paid subscription on
/// "pendiente" are indistinguishable from outside: a notification that never arrives
/// (wrong URL registered, topic not ticked in the panel) and one that arrives and is
/// thrown away (missing or wrong signing secret) leave exactly the same trace — none.
/// A rejected notification never reaches <see cref="SubscriptionService"/>, so it writes
/// no <c>SubscriptionEvent</c> either, and the only evidence is a log line on a host
/// whose logs are not always at hand.
///
/// Deliberately in memory and deliberately small: it is a diagnosis aid, not an audit
/// trail — the events table is the audit trail. It resets on deploy and is per-instance,
/// which is fine for answering "is anything reaching us at all?".
/// </summary>
public sealed class MercadoPagoWebhookLog
{
    private const int Capacity = 50;

    private readonly Queue<WebhookDelivery> _recent = new(Capacity);
    private readonly Lock _gate = new();

    /// <summary>When this instance started counting. Without it, "0 notifications" cannot
    /// be told apart from "deployed thirty seconds ago".</summary>
    public DateTime StartedAtUtc { get; } = DateTime.UtcNow;

    private long _received;
    private long _accepted;
    private long _rejected;
    private DateTime? _lastReceivedAtUtc;
    private DateTime? _lastAcceptedAtUtc;

    public void Record(string outcome, string? topic, string? dataId, string? reason)
    {
        var entry = new WebhookDelivery(DateTime.UtcNow, outcome, topic, dataId, reason);

        lock (_gate)
        {
            _received++;
            _lastReceivedAtUtc = entry.ReceivedAtUtc;

            if (outcome == WebhookOutcomes.Accepted)
            {
                _accepted++;
                _lastAcceptedAtUtc = entry.ReceivedAtUtc;
            }
            else if (outcome == WebhookOutcomes.Rejected)
            {
                _rejected++;
            }

            if (_recent.Count == Capacity)
            {
                _recent.Dequeue();
            }

            _recent.Enqueue(entry);
        }
    }

    public WebhookLogSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new WebhookLogSnapshot(
                StartedAtUtc,
                _received,
                _accepted,
                _rejected,
                _lastReceivedAtUtc,
                _lastAcceptedAtUtc,
                [.. _recent.Reverse()]);
        }
    }
}

/// <summary>What happened to one delivery. Strings rather than an enum so they can be
/// read straight off the diagnostics response without a lookup table.</summary>
public static class WebhookOutcomes
{
    /// <summary>Signature verified and the notification was handled.</summary>
    public const string Accepted = "accepted";

    /// <summary>Signature check failed — see the reason. Mercado Pago got a 401 and will retry.</summary>
    public const string Rejected = "rejected";

    /// <summary>Neither the body nor the query said which resource changed.</summary>
    public const string Unparseable = "unparseable";

    /// <summary>Verified, but handling it threw. Mercado Pago got a 500 and will retry.</summary>
    public const string Failed = "failed";

    /// <summary>Verified, but handling it ran past the budget that fits inside Mercado Pago's window.</summary>
    public const string TimedOut = "timed_out";
}

public sealed record WebhookDelivery(
    DateTime ReceivedAtUtc,
    string Outcome,
    string? Topic,
    string? DataId,
    string? Reason);

public sealed record WebhookLogSnapshot(
    DateTime StartedAtUtc,
    long Received,
    long Accepted,
    long Rejected,
    DateTime? LastReceivedAtUtc,
    DateTime? LastAcceptedAtUtc,
    IReadOnlyList<WebhookDelivery> Recent);
