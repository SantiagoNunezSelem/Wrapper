namespace backend.Options;

/// <summary>
/// Anti-abuse rules for the one-week free trial. The trial is the only thing in the
/// product that can be taken without paying, so it is also the only thing worth
/// gaming — signing out and creating a second Google account costs nothing.
/// </summary>
public sealed class TrialGuardOptions
{
    public const string SectionName = "TrialGuard";

    /// <summary>
    /// One trial per public IP address. The per-account rule is always on and cannot be
    /// switched off here; this is the one that stops the same person from collecting a
    /// second week by signing in with a different Google account.
    /// </summary>
    public bool LockByIp { get; set; } = true;

    /// <summary>
    /// One trial per browser profile, via a random id kept in localStorage. Weaker than
    /// the IP rule (clearing site data resets it) but it catches the case the IP rule
    /// misses: same person, same device, mobile network that hands out a new address.
    /// </summary>
    public bool LockByDevice { get; set; } = true;

    /// <summary>
    /// Widen the IP rule to the whole /24 (IPv4) or /48 (IPv6) block. Off by default:
    /// Argentine mobile carriers put thousands of unrelated customers behind one CGNAT
    /// range, so this trades a little abuse prevention for real customers being told
    /// they already used a trial they never had.
    /// </summary>
    public bool LockBySubnet { get; set; }

    /// <summary>
    /// ISO-3166 alpha-2 codes allowed to start a trial (e.g. <c>["AR"]</c>). Empty means
    /// no country restriction. Only enforced when the country is actually known — see
    /// <see cref="TrustProxyHeaders"/> — never guessed.
    /// </summary>
    public string[] AllowedCountries { get; set; } = [];

    /// <summary>
    /// Read the client address and country from <c>X-Forwarded-For</c> /
    /// <c>CF-IPCountry</c> style headers. Off by default because any client can send
    /// those headers: switch it on only once the app sits behind a proxy or CDN that
    /// overwrites them. Left off, the socket address is used instead.
    /// <para>
    /// This setting reaches further than the trial guard it is named for: the rate limiter
    /// partitions by the same resolved address. Left off behind a real proxy, every
    /// visitor shares one partition and a handful of requests can exhaust the login limit
    /// for everybody — so getting this right is an availability concern, not only an
    /// anti-abuse one.
    /// </para>
    /// </summary>
    public bool TrustProxyHeaders { get; set; }

    /// <summary>
    /// Addresses of the proxies whose forwarded headers may be believed, e.g.
    /// <c>["10.0.0.7"]</c>. Empty means "believe them from anywhere", which is only safe
    /// when the app cannot be reached except through the proxy — otherwise anyone can
    /// forge <c>X-Forwarded-For</c> and hand themselves a private rate-limit bucket and an
    /// endless supply of free trials. Ignored unless <see cref="TrustProxyHeaders"/> is on.
    /// </summary>
    public string[] KnownProxies { get; set; } = [];

    /// <summary>Salt for the stored IP/device hashes. Falls back to the JWT signing key
    /// when empty, so the raw address is never written to disk either way.</summary>
    public string HashSalt { get; set; } = string.Empty;

    /// <summary>How far back the IP/device ledger is consulted. 0 means forever.</summary>
    public int WindowDays { get; set; }
}
