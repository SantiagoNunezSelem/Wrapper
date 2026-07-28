namespace backend.Options;

public sealed class AdminSeedOptions
{
    public const string SectionName = "AdminSeed";

    public string Email { get; init; } = string.Empty;
    public string DisplayName { get; init; } = "VIP Admin";
    public string PreferredLanguage { get; init; } = "es";
}
