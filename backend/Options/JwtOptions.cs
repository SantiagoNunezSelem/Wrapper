namespace backend.Options;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; init; } = "WrapperCrm.Api";
    public string Audience { get; init; } = "WrapperCrm.Frontend";
    public string SigningKey { get; init; } = "replace-this-development-signing-key-with-a-longer-one";
    public int ExpirationMinutes { get; init; } = 720;
}
