namespace backend.Options;

/// <summary>
/// Everything the Mercado Pago subscription flow needs. Prices and periods live here
/// (not in code) so the plan can be repriced from configuration without a re-deploy,
/// as the monetisation brief asks for.
/// </summary>
public sealed class MercadoPagoOptions
{
    public const string SectionName = "MercadoPago";

    /// <summary>
    /// Private access token (<c>APP_USR-…</c> in production, <c>TEST-…</c> while testing).
    /// Keep it out of the repo: <c>dotnet user-secrets set "MercadoPago:AccessToken" "…"</c>.
    /// </summary>
    public string AccessToken { get; set; } = string.Empty;

    /// <summary>Public key. Not needed by the redirect checkout — Mercado Pago's own
    /// hosted page handles the card form — but useful to confirm both halves of the
    /// credential pair come from the same application.</summary>
    public string PublicKey { get; set; } = string.Empty;

    /// <summary>
    /// The secret shown in the Mercado Pago panel when the webhook URL is registered.
    /// Without it every notification is rejected: an unsigned webhook is an open door to
    /// anyone who can guess a subscription id.
    /// </summary>
    public string WebhookSecret { get; set; } = string.Empty;

    public string ApiBaseUrl { get; set; } = "https://api.mercadopago.com";

    // No plan ids here on purpose: checkout creates one preapproval per payer and declares
    // the free trial on it, so there is no shared plan to attach anyone to. See
    // SubscriptionService.OpenProviderCheckoutAsync.

    /// <summary>
    /// The frontend's own origin (no trailing slash) — <c>https://vistazo.app</c> in
    /// production, <c>http://localhost:5173</c> while developing. Checkout is a redirect
    /// to Mercado Pago's hosted page, and this is where they send the payer back once
    /// it's done: <c>{BackUrl}/suscripcion?checkout=return</c>, which the frontend reads
    /// to re-sync the subscription immediately instead of waiting on the webhook.
    /// </summary>
    public string BackUrl { get; set; } = "http://localhost:5173";

    /// <summary>Public webhook URL, only used to print a setup hint on boot.</summary>
    public string WebhookUrl { get; set; } = string.Empty;

    /// <summary>Shown to the payer on the Mercado Pago checkout and on their card summary.</summary>
    public string Reason { get; set; } = "Vistazo Pro";

    public string CurrencyId { get; set; } = "ARS";

    public decimal TransactionAmount { get; set; } = 7900m;

    public int Frequency { get; set; } = 1;

    /// <summary><c>months</c> or <c>days</c>.</summary>
    public string FrequencyType { get; set; } = "months";

    public int TrialFrequency { get; set; } = 7;

    public string TrialFrequencyType { get; set; } = "days";

    /// <summary>
    /// How long Pro access survives a rejected charge. Mercado Pago retries a failed
    /// debit for a few days before giving up, so cutting access on the first failure
    /// would lock out people whose card recovers on its own.
    /// </summary>
    public int FailedPaymentGraceDays { get; set; } = 3;

    /// <summary>
    /// How often the background reconciler re-reads subscriptions that Mercado Pago may
    /// have moved without us hearing about it. Webhooks get lost — a deploy mid-delivery,
    /// a secret rotated, a topic never enabled in the panel — and without this a paying
    /// customer stays locked out until they happen to press "Actualizar estado".
    /// Zero disables it.
    /// </summary>
    public int ReconcileIntervalMinutes { get; set; } = 15;

    /// <summary>
    /// How long an unfinished checkout keeps being polled before it is written off. A
    /// payer who closed the tab should not be re-read every quarter of an hour forever.
    /// </summary>
    public int PendingCheckoutHours { get; set; } = 48;

    /// <summary>
    /// Where the payer manages the card behind the subscription. Mercado Pago exposes no
    /// API to replace a card on an existing preapproval — it happens on their site, in
    /// the payer's own account — so the account screen links there instead of pretending
    /// to offer it.
    /// </summary>
    public string ManageUrl { get; set; } = "https://www.mercadopago.com.ar/subscriptions";

    public int TimeoutSeconds { get; set; } = 20;

    /// <summary>
    /// Sends this as the <c>payer_email</c> instead of the signed-in user's own address.
    /// <b>For testing only — must be empty in production</b>, where it would bill every
    /// checkout to one person.
    ///
    /// It exists because Mercado Pago refuses a preapproval whose payer and collector are
    /// not <i>both</i> real or <i>both</i> test accounts, and a test buyer's address is a
    /// generated <c>@testuser.com</c> one that nobody can sign into Google with. Without
    /// this there is no way to exercise checkout end to end against a test seller: every
    /// attempt arrives with a real payer and comes back
    /// <c>400 Both payer and collector must be real or test users</c>.
    ///
    /// Nothing downstream depends on the address matching the account: a preapproval is
    /// linked by its own id and by <c>external_reference</c>, both stored before the
    /// redirect.
    /// </summary>
    public string TestPayerEmail { get; set; } = string.Empty;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(AccessToken);

    /// <summary>
    /// Whether the access token is one of the app's own <c>TEST-</c> credentials.
    ///
    /// This does <b>not</b> catch every test setup, and the gap is worth knowing: a test
    /// user created in the panel gets its own application, whose token starts with
    /// <c>APP_USR-</c> exactly like a production one. Such a seller reads as production
    /// here. Telling them apart needs <c>GET /users/me</c> — a test user's nickname is a
    /// generated <c>TESTUSER…</c> — which is a network call, not a property.
    /// </summary>
    public bool IsTestCredential => AccessToken.StartsWith("TEST-", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Where Mercado Pago sends the payer back after the hosted checkout. Mercado Pago
    /// rejects <c>back_url</c> outright when it points at <c>localhost</c> — there is no
    /// way to hand it a working one until this is deployed under a real domain — so this
    /// falls back to their own site rather than failing plan creation while developing.
    /// The payer still completes the payment fine in that case; only the "land back on
    /// /suscripcion automatically" convenience is unavailable until <see cref="BackUrl"/>
    /// is a real HTTPS domain — the account page's "Actualizar estado" still finds and
    /// links it by searching Mercado Pago for the payer's email (see SubscriptionService).
    /// </summary>
    public string CheckoutReturnUrl
    {
        get
        {
            var url = $"{BackUrl.TrimEnd('/')}/suscripcion?checkout=return";
            return HasPublicBackUrl ? url : "https://www.mercadopago.com/";
        }
    }

    /// <summary>
    /// Whether <see cref="BackUrl"/> is a real public origin Mercado Pago will accept.
    /// Worth knowing beyond plan creation: without it the payer is never sent back to
    /// <c>/suscripcion?checkout=return</c>, so the immediate post-checkout sync never
    /// runs and the only thing left to move the row off "pendiente" is the webhook or the
    /// background reconciler.
    /// </summary>
    public bool HasPublicBackUrl =>
        !string.IsNullOrWhiteSpace(BackUrl) &&
        !BackUrl.Contains("localhost", StringComparison.OrdinalIgnoreCase) &&
        !BackUrl.Contains("127.0.0.1", StringComparison.Ordinal);
}
