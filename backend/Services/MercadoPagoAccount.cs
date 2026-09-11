namespace backend.Services;

/// <summary>
/// Who an access token belongs to, from <c>GET /users/me</c>.
///
/// A test user created in the Mercado Pago panel gets its own application and an
/// <c>APP_USR-</c> token exactly like a real account, so the prefix proves nothing — that
/// is how a test seller sat in production unnoticed. Its generated nickname does:
/// <c>TESTUSER…</c> (older ones <c>TETE…</c>).
/// </summary>
public sealed record MercadoPagoAccount(long? Id, string? Nickname)
{
    public bool IsTestUser =>
        Nickname is { } nickname &&
        (nickname.StartsWith("TESTUSER", StringComparison.OrdinalIgnoreCase) ||
         nickname.StartsWith("TETE", StringComparison.OrdinalIgnoreCase));
}
