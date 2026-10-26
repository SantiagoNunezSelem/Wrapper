namespace backend.Models;

/// <summary>
/// A problem a signed-in account reported from the help page (<c>/ayuda</c>). It lands in
/// the admin panel and nowhere else — no mail goes out — so the panel is the one place to
/// read, answer and close them.
/// </summary>
public sealed class SupportReport
{
    public Guid Id { get; init; } = Guid.NewGuid();

    /// <summary>
    /// The code the account is given when it sends the report, and the one the panel shows:
    /// six characters like <c>K7M2QX</c>, random, with no order (see <see cref="backend.Services.TicketCodes"/>).
    /// It exists because a Guid is no way to refer to a problem out loud or in a message.
    /// Unique, and assigned by the service rather than the database so it works the same on the
    /// SQLite file as in the tests.
    /// </summary>
    public string TicketCode { get; set; } = string.Empty;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// Where to answer. Asked for rather than copied from the account: the Google address
    /// someone signs in with is often not the one they read, and the report is usually about
    /// a payment made from yet another one.
    /// </summary>
    public string ContactEmail { get; set; } = string.Empty;

    /// <summary>One of <see cref="SupportReportCategories"/>.</summary>
    public string Category { get; set; } = SupportReportCategories.Other;

    public string Description { get; set; } = string.Empty;

    /// <summary>The browser that sent it, read from the request rather than trusted from the body.</summary>
    public string? UserAgent { get; set; }

    /// <summary>The window size, as "1280x720". Half of "no se ve bien" reports are a narrow screen.</summary>
    public string? Viewport { get; set; }

    public string? Language { get; set; }

    /// <summary>
    /// The subscription state when the report was sent, copied: by the time anyone reads it
    /// the account may have moved on, and "pagué y no tengo Pro" only makes sense next to
    /// what the account looked like then.
    /// </summary>
    public string? SubscriptionState { get; set; }

    /// <summary>One of <see cref="SupportReportStatuses"/>.</summary>
    public string Status { get; set; } = SupportReportStatuses.Open;

    public DateTime CreatedAtUtc { get; init; } = DateTime.UtcNow;
    public DateTime? ResolvedAtUtc { get; set; }

    /// <summary>Copied, not joined, like the author of an admin note.</summary>
    public string? ResolvedByEmail { get; set; }
}

public static class SupportReportStatuses
{
    public const string Open = "nuevo";
    public const string Resolved = "resuelto";

    public static readonly IReadOnlySet<string> All = new HashSet<string> { Open, Resolved };
}

public static class SupportReportCategories
{
    public const string Payments = "pagos";
    public const string Analysis = "analisis";
    public const string Account = "cuenta";
    public const string Other = "otro";

    public static readonly IReadOnlySet<string> All = new HashSet<string> { Payments, Analysis, Account, Other };
}
