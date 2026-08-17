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

    /// <summary>
    /// The <c>preapproval_plan</c> new subscribers with a free week are attached to.
    /// Left empty it is created automatically on the first checkout and persisted into
    /// the database, so a fresh account only ever needs the access token pasted in.
    /// </summary>
    public string PreapprovalPlanId { get; set; } = string.Empty;

    /// <summary>
    /// Separate plan for anyone who already used their trial. Mercado Pago applies a
    /// plan's <c>free_trial</c> to every subscriber of that plan, so "no second free
    /// week" has to be a different plan — it cannot be switched off per subscriber.
    /// Auto-created alongside the other one when left empty.
    /// </summary>
    public string PreapprovalPlanIdNoTrial { get; set; } = string.Empty;

    /// <summary>
    /// The frontend's own origin (no trailing slash) — <c>https://vistazo.app</c> in
    /// production, <c>http://localhost:5173</c> while developing. Checkout is a redirect
    /// to Mercado Pago's hosted page, and this is where they send the payer back once
    /// it's done: <c>{BackUrl}/suscripcion?checkout=return</c>, which the frontend reads
    /// to re-sync the subscription immediately instead of waiting on the webhook. Also
    /// used as the <c>preapproval_plan</c>'s own <c>back_url</c> when one has to be
    /// auto-created (see <see cref="AutoCreatePlan"/>).
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

    /// <summary>Create the plan on demand when <see cref="PreapprovalPlanId"/> is empty.</summary>
    public bool AutoCreatePlan { get; set; } = true;

    public int TimeoutSeconds { get; set; } = 20;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(AccessToken);

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
            return url.Contains("localhost", StringComparison.OrdinalIgnoreCase) ? "https://www.mercadopago.com/" : url;
        }
    }
}
