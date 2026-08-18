namespace backend.Options;

/// <summary>
/// reCAPTCHA v3 runs invisibly on every login attempt and returns a risk score; v2 (the
/// checkbox) is the fallback shown only when that score comes back low. Two secrets
/// because they are two separate Google site/secret key pairs — v3's score-based key
/// cannot verify a v2 checkbox token or vice versa.
/// </summary>
public sealed class RecaptchaOptions
{
    public const string SectionName = "Recaptcha";

    /// <summary>
    /// Secret key for the v3 site. Left empty, <see cref="IsConfigured"/> is false and
    /// login behaves exactly as it did before this existed — nobody is blocked from
    /// signing in just because a deployment hasn't set this up yet.
    /// </summary>
    public string SecretKeyV3 { get; set; } = string.Empty;

    /// <summary>Secret key for the v2 checkbox site, used only to verify the fallback
    /// challenge shown after a low v3 score.</summary>
    public string SecretKeyV2 { get; set; } = string.Empty;

    /// <summary>
    /// Minimum v3 score (0.0-1.0) accepted without a challenge. 0.5 is Google's own
    /// suggested default: low enough to not flag ordinary traffic, high enough to catch
    /// obvious automation.
    /// </summary>
    public double ScoreThreshold { get; set; } = 0.5;

    /// <summary>
    /// The action name the v3 token must have been minted for. Google echoes the action
    /// back in the siteverify response, and checking it is what stops a token harvested
    /// from some other action on the same site key from being replayed against login.
    /// </summary>
    public string LoginAction { get; set; } = "login";

    /// <summary>
    /// What to do when Google's siteverify cannot be reached at all (timeout, DNS, 5xx).
    /// <para>
    /// True (default) lets the login through: reCAPTCHA is a secondary anti-abuse signal,
    /// not the thing that proves identity — Google's own ID token validation does that —
    /// and an outage at Google would otherwise lock every real user out. The rate limiter
    /// is what remains standing in that window.
    /// </para>
    /// <para>
    /// Set false to reject instead, if locking everyone out is preferable to letting
    /// unscored traffic through during an outage.
    /// </para>
    /// </summary>
    public bool FailOpenOnProviderOutage { get; set; } = true;

    public int TimeoutSeconds { get; set; } = 10;

    /// <summary>
    /// Both secrets are required, deliberately. The login flow lets the client say which
    /// of the two checks it is answering, so a deployment with only one key configured
    /// would leave the other path with nothing to verify against — and "nothing to verify
    /// against" must never mean "let it through". Requiring both makes a half-finished
    /// setup disable the feature loudly (and log a warning at boot) instead of leaving a
    /// silent hole open.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(SecretKeyV3) && !string.IsNullOrWhiteSpace(SecretKeyV2);

    /// <summary>True when someone started configuring this but did not finish — worth
    /// shouting about at boot, because it silently means "reCAPTCHA is off".</summary>
    public bool IsPartiallyConfigured =>
        !IsConfigured &&
        (!string.IsNullOrWhiteSpace(SecretKeyV3) || !string.IsNullOrWhiteSpace(SecretKeyV2));
}
