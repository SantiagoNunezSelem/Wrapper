using System.Net;
using System.Security.Cryptography;
using System.Text;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Turns a request into the salted hashes the trial ledger matches on.
///
/// Two deliberate choices: the raw address is never stored (the ledger only needs to
/// answer "seen before?"), and proxy headers are ignored unless the deployment says it
/// sits behind a proxy — otherwise anyone could claim a fresh trial by sending
/// <c>X-Forwarded-For: 1.2.3.4</c>, which would defeat the entire rule.
/// </summary>
public sealed class ClientFingerprint(
    IOptions<TrialGuardOptions> trialGuard,
    IOptions<JwtOptions> jwt)
{
    private readonly TrialGuardOptions _options = trialGuard.Value;

    private readonly byte[] _salt = Encoding.UTF8.GetBytes(
        string.IsNullOrWhiteSpace(trialGuard.Value.HashSalt)
            ? jwt.Value.SigningKey
            : trialGuard.Value.HashSalt);

    public ClientIdentity Describe(HttpContext http, string? deviceId)
    {
        var address = ResolveAddress(http);

        return new ClientIdentity(
            IpHash: address is null ? null : Hash($"ip:{address}"),
            SubnetHash: address is null ? null : Hash($"net:{ToNetworkPrefix(address)}"),
            DeviceHash: string.IsNullOrWhiteSpace(deviceId) ? null : Hash($"device:{deviceId.Trim()}"),
            CountryCode: ResolveCountry(http));
    }

    private IPAddress? ResolveAddress(HttpContext http)
    {
        if (_options.TrustProxyHeaders)
        {
            var forwarded = http.Request.Headers["X-Forwarded-For"].ToString();
            if (!string.IsNullOrWhiteSpace(forwarded))
            {
                // Left-most entry is the original client; the rest are the proxy chain.
                var candidate = forwarded.Split(',')[0].Trim();

                // Some proxies append a port ("1.2.3.4:5678"); IPv6 arrives bracketed.
                if (IPAddress.TryParse(candidate, out var parsed) ||
                    (candidate.Contains(':') && !candidate.Contains("::") &&
                     IPAddress.TryParse(candidate[..candidate.LastIndexOf(':')], out parsed)))
                {
                    return Normalize(parsed);
                }
            }
        }

        return http.Connection.RemoteIpAddress is { } remote ? Normalize(remote) : null;
    }

    private string? ResolveCountry(HttpContext http)
    {
        // Only a CDN/proxy can state this reliably, and only when its headers are
        // trusted. IP-to-country lookups are approximate and a VPN defeats them, so the
        // country is treated as a soft signal that is recorded when known and simply
        // absent otherwise — never guessed, and never the primary gate.
        if (!_options.TrustProxyHeaders)
        {
            return null;
        }

        foreach (var header in (string[])["CF-IPCountry", "X-Vercel-IP-Country", "CloudFront-Viewer-Country", "X-Country-Code"])
        {
            var value = http.Request.Headers[header].ToString();
            if (!string.IsNullOrWhiteSpace(value) && value.Length == 2)
            {
                return value.ToUpperInvariant();
            }
        }

        return null;
    }

    /// <summary>IPv4-mapped IPv6 (::ffff:1.2.3.4, which is what a dual-stack socket
    /// reports for an IPv4 client) collapses to plain IPv4 so the same visitor hashes
    /// identically regardless of how the connection was accepted.</summary>
    private static IPAddress Normalize(IPAddress address) =>
        address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;

    /// <summary>/24 for IPv4, /48 for IPv6 — the block a household or small ISP pool
    /// typically shares.</summary>
    private static string ToNetworkPrefix(IPAddress address)
    {
        var bytes = address.GetAddressBytes();

        return bytes.Length == 4
            ? $"{bytes[0]}.{bytes[1]}.{bytes[2]}.0/24"
            : string.Join(':', Enumerable.Range(0, 3).Select(i => $"{bytes[i * 2]:x2}{bytes[i * 2 + 1]:x2}")) + "::/48";
    }

    private string Hash(string value) =>
        Convert.ToHexString(HMACSHA256.HashData(_salt, Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}

public readonly record struct ClientIdentity(
    string? IpHash,
    string? SubnetHash,
    string? DeviceHash,
    string? CountryCode);
