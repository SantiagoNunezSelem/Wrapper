namespace backend.Models;

/// <summary>
/// Tiny key/value store for values the app derives at runtime and must not lose — today
/// only the Mercado Pago plan ids it creates on first use. Kept in the database rather
/// than in configuration so pasting an access token is genuinely the only manual step.
/// </summary>
public sealed class AppSetting
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
