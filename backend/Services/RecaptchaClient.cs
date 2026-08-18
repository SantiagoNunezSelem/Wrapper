using System.Text.Json;
using System.Text.Json.Serialization;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>
/// Thin wrapper over Google's <c>siteverify</c> endpoint. Verifies one token against one
/// secret and hands back what Google said — the caller (the login endpoint) decides what
/// score threshold or action name to require, since that policy differs between the
/// silent v3 check and the v2 fallback challenge.
///
/// The one distinction this class is careful about is <em>"Google said no"</em> versus
/// <em>"Google did not answer"</em>. A rejected token is a real verdict and must be
/// honoured; an unreachable siteverify is an outage, and only the caller — via
/// <see cref="RecaptchaOptions.FailOpenOnProviderOutage"/> — gets to decide what that
/// means. Collapsing the two would either let bots through on a rejection or lock every
/// real user out during a Google hiccup.
/// </summary>
public sealed class RecaptchaClient(
    HttpClient httpClient,
    IOptions<RecaptchaOptions> options,
    ILogger<RecaptchaClient> logger)
{
    private const string VerifyUrl = "https://www.google.com/recaptcha/api/siteverify";

    private readonly RecaptchaOptions _options = options.Value;

    /// <returns>
    /// Google's verdict, or <c>null</c> only when Google could not be reached at all.
    /// A reachable Google that rejects the token returns a verdict with
    /// <see cref="RecaptchaVerification.Success"/> false — never null.
    /// </returns>
    public async Task<RecaptchaVerification?> VerifyAsync(string secret, string token, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

        HttpResponseMessage response;
        try
        {
            response = await httpClient.PostAsync(
                VerifyUrl,
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["secret"] = secret,
                    ["response"] = token,
                }),
                cts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("reCAPTCHA siteverify timed out after {Timeout}s.", _options.TimeoutSeconds);
            return null;
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(exception, "Could not reach reCAPTCHA siteverify.");
            return null;
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("reCAPTCHA siteverify responded with {Status}.", (int)response.StatusCode);
                return null;
            }

            try
            {
                var payload = await response.Content.ReadFromJsonAsync<SiteVerifyResponse>(cancellationToken: cancellationToken);
                if (payload is null)
                {
                    return null;
                }

                if (!payload.Success)
                {
                    // Google's own reason codes (invalid-input-response, timeout-or-duplicate,
                    // …). Logged because a sudden flood of one specific code is the difference
                    // between "we are under attack" and "our key is misconfigured".
                    logger.LogInformation(
                        "reCAPTCHA rejected a token: {ErrorCodes}",
                        payload.ErrorCodes is { Count: > 0 } codes ? string.Join(", ", codes) : "no reason given");
                }

                return new RecaptchaVerification(payload.Success, payload.Score, payload.Action);
            }
            catch (JsonException exception)
            {
                logger.LogWarning(exception, "Could not parse the reCAPTCHA siteverify response.");
                return null;
            }
        }
    }

    private sealed record SiteVerifyResponse(
        bool Success,
        double? Score,
        string? Action,
        [property: JsonPropertyName("error-codes")] List<string>? ErrorCodes);
}

public sealed record RecaptchaVerification(bool Success, double? Score, string? Action);
