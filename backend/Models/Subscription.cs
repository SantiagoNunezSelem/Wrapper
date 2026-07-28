namespace backend.Models;

public sealed class Subscription
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public User? User { get; set; }
    public string Status { get; set; } = "vencida";
    public string? PaymentProvider { get; set; }
    public string PlanType { get; set; } = "semanal";
    public DateTime? TrialStartsAtUtc { get; set; }
    public DateTime? TrialEndsAtUtc { get; set; }
    public DateTime? SubscriptionStartsAtUtc { get; set; }
    public DateTime? NextBillingAtUtc { get; set; }
    public DateTime? CancelledAtUtc { get; set; }
    public string? ExternalSubscriptionId { get; set; }
    public bool IsSeededVip { get; set; }
    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
