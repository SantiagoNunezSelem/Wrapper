namespace backend.Options;

public sealed class GoogleAuthOptions
{
    public const string SectionName = "GoogleAuth";

    public string AllowedAudience { get; init; } = string.Empty;
}
