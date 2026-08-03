using System.Security.Cryptography;
using System.Text;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Verifies the <c>x-signature</c> header Mercado Pago attaches to every webhook.
///
/// This is the security boundary of the whole billing system. The webhook is a public,
/// unauthenticated endpoint that grants and revokes paid access; without this check
/// anyone who guesses the URL could POST themselves a subscription — or cancel someone
/// else's. A notification that fails validation is dropped, never processed.
/// </summary>
public sealed class MercadoPagoSignatureValidator(
    IOptions<MercadoPagoOptions> options,
    ILogger<MercadoPagoSignatureValidator> logger)
{
    private readonly MercadoPagoOptions _options = options.Value;

    /// <summary>Tolerance for the notification timestamp, to blunt replay attempts while
    /// still allowing for ordinary clock drift and delivery delay.</summary>
    private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(15);

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_options.WebhookSecret);

    public SignatureCheck Validate(HttpRequest request, string? dataId)
    {
        if (!IsConfigured)
        {
            // Refusing here is deliberate. Accepting unverified notifications "until the
            // secret is set" is precisely the state in which a forged webhook works.
            return SignatureCheck.Fail("MercadoPago:WebhookSecret is not set — notifications cannot be verified.");
        }

        var signatureHeader = request.Headers["x-signature"].ToString();
        if (string.IsNullOrWhiteSpace(signatureHeader))
        {
            return SignatureCheck.Fail("Missing x-signature header.");
        }

        var requestId = request.Headers["x-request-id"].ToString();

        string? timestamp = null;
        string? hash = null;

        foreach (var part in signatureHeader.Split(','))
        {
            var separator = part.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var key = part[..separator].Trim();
            var value = part[(separator + 1)..].Trim();

            if (key.Equals("ts", StringComparison.OrdinalIgnoreCase))
            {
                timestamp = value;
            }
            else if (key.Equals("v1", StringComparison.OrdinalIgnoreCase))
            {
                hash = value;
            }
        }

        if (string.IsNullOrWhiteSpace(timestamp) || string.IsNullOrWhiteSpace(hash))
        {
            return SignatureCheck.Fail("x-signature is missing its ts or v1 part.");
        }

        if (!IsFresh(timestamp))
        {
            return SignatureCheck.Fail("Notification timestamp is outside the accepted window.");
        }

        // Documented manifest: id:{data.id};request-id:{x-request-id};ts:{ts};
        // Pairs whose value is absent are left out entirely rather than sent empty.
        var manifest = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(dataId))
        {
            manifest.Append("id:").Append(dataId.ToLowerInvariant()).Append(';');
        }

        if (!string.IsNullOrWhiteSpace(requestId))
        {
            manifest.Append("request-id:").Append(requestId).Append(';');
        }

        manifest.Append("ts:").Append(timestamp).Append(';');

        var expected = Convert.ToHexString(
                HMACSHA256.HashData(
                    Encoding.UTF8.GetBytes(_options.WebhookSecret),
                    Encoding.UTF8.GetBytes(manifest.ToString())))
            .ToLowerInvariant();

        // Constant-time: a length-or-content-dependent comparison leaks the expected
        // digest one byte at a time to anyone willing to measure.
        var matches = CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(hash.ToLowerInvariant()));

        if (!matches)
        {
            logger.LogWarning("Rejected a Mercado Pago webhook: signature mismatch for data.id {DataId}.", dataId);
            return SignatureCheck.Fail("Signature mismatch.");
        }

        return SignatureCheck.Ok();
    }

    private static bool IsFresh(string timestamp)
    {
        if (!long.TryParse(timestamp, out var value))
        {
            return false;
        }

        // The header carries milliseconds; older integrations saw seconds. Accept both
        // rather than reject a valid notification over a unit.
        var moment = value > 100_000_000_000L
            ? DateTimeOffset.FromUnixTimeMilliseconds(value)
            : DateTimeOffset.FromUnixTimeSeconds(value);

        var drift = DateTimeOffset.UtcNow - moment;
        return drift.Duration() <= MaxAge;
    }
}

public readonly record struct SignatureCheck(bool IsValid, string? Reason)
{
    public static SignatureCheck Ok() => new(true, null);
    public static SignatureCheck Fail(string reason) => new(false, reason);
}
