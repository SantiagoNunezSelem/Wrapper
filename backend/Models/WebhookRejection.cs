namespace backend.Models;

/// <summary>
/// A Mercado Pago notification the signature check threw away. The in-memory log already
/// shows these, but it resets on every deploy — exactly when a rotated secret starts
/// bouncing everything. Kept for two weeks, then pruned.
/// </summary>
public sealed class WebhookRejection
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string? Topic { get; set; }
    public string? DataId { get; set; }
    public string? Reason { get; set; }
    public DateTime ReceivedAtUtc { get; init; } = DateTime.UtcNow;
}
