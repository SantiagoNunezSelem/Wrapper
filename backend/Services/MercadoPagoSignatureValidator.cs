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

        foreach (var candidate in BuildIdCandidates(request, dataId))
        {
            if (Matches(BuildManifest(candidate, requestId, timestamp), hash))
            {
                return SignatureCheck.Ok();
            }
        }

        logger.LogWarning(
            "Rejected a Mercado Pago webhook: signature mismatch. Tried the manifest with query data.id={QueryDataId}, query id={QueryId} and body data.id={BodyDataId}.",
            request.Query["data.id"].ToString(),
            request.Query["id"].ToString(),
            dataId);

        return SignatureCheck.Fail("Signature mismatch.");
    }

    /// <summary>
    /// Which value to put in the manifest's <c>id:</c> slot, best first.
    ///
    /// Mercado Pago signs the id <b>as it travels in the query string</b> — their template
    /// is literally <c>id:[data.id_url]</c> — not the one inside the JSON body. The two
    /// usually carry the same value, but not always: some notifications still arrive in
    /// the older IPN shape, whose query is <c>?topic=…&amp;id=…</c> with no <c>data.id</c>
    /// at all, and there the documented manifest has <b>no id part whatsoever</b>. Signing
    /// over the body's id in that case yields a hash that can never match, so every
    /// delivery comes back 401, Mercado Pago eventually stops retrying, and a subscription
    /// that was genuinely paid sits on "pendiente" forever. That is why each shape they
    /// actually send is tried rather than assuming one.
    ///
    /// The body's id is kept as a tolerance, and the id-less manifest is offered only when
    /// the query carries no <c>data.id</c> — precisely the case where Mercado Pago's own
    /// template drops it. Every candidate is still HMAC'd with our own secret, so none of
    /// this widens what an outsider can forge.
    /// </summary>
    private static List<string?> BuildIdCandidates(HttpRequest request, string? bodyDataId)
    {
        var queryDataId = request.Query["data.id"].ToString();
        var queryId = request.Query["id"].ToString();

        var candidates = new List<string?>(4);

        void Offer(string? value)
        {
            if (!candidates.Contains(value))
            {
                candidates.Add(value);
            }
        }

        if (!string.IsNullOrWhiteSpace(queryDataId))
        {
            Offer(queryDataId);
        }

        if (!string.IsNullOrWhiteSpace(queryId))
        {
            Offer(queryId);
        }

        if (!string.IsNullOrWhiteSpace(bodyDataId))
        {
            Offer(bodyDataId);
        }

        // The template keys on `data.id` specifically, so its absence — not the absence of
        // any id at all — is what makes the id-less manifest the right one to try.
        if (string.IsNullOrWhiteSpace(queryDataId))
        {
            Offer(null);
        }

        return candidates;
    }

    /// <summary>
    /// The documented manifest: <c>id:{data.id};request-id:{x-request-id};ts:{ts};</c>.
    /// Pairs whose value is absent are left out entirely rather than sent empty.
    /// </summary>
    private static string BuildManifest(string? dataId, string? requestId, string timestamp)
    {
        var manifest = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(dataId))
        {
            manifest.Append("id:").Append(dataId.ToLowerInvariant()).Append(';');
        }

        if (!string.IsNullOrWhiteSpace(requestId))
        {
            manifest.Append("request-id:").Append(requestId).Append(';');
        }

        return manifest.Append("ts:").Append(timestamp).Append(';').ToString();
    }

    private bool Matches(string manifest, string hash)
    {
        var expected = Convert.ToHexString(
                HMACSHA256.HashData(
                    Encoding.UTF8.GetBytes(_options.WebhookSecret),
                    Encoding.UTF8.GetBytes(manifest)))
            .ToLowerInvariant();

        // Constant-time: a length-or-content-dependent comparison leaks the expected
        // digest one byte at a time to anyone willing to measure.
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(hash.ToLowerInvariant()));
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
