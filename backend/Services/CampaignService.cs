using System.Security.Cryptography;
using backend.Data;
using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Services;

/// <summary>
/// QR campaigns: the links printed on flyers, the visits they bring and what those
/// visitors went on to do — sign up, start the free week, pay.
///
/// The funnel is counted from data the app already keeps (accounts, subscriptions,
/// invoices); the only new facts are "this account came from that link" and "someone
/// opened that link".
/// </summary>
public sealed class CampaignService(AppDbContext db, ClientFingerprint fingerprint)
{
    public const int MaxTitleLength = 120;
    public const int UsersListLimit = 200;

    /// <summary>No 0/o, 1/l/i: a code someone has to read off a flyer must not be ambiguous.</summary>
    private const string CodeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    private const int CodeLength = 6;

    /// <summary>A reload, or the browser reopening the tab, is not a second visit.</summary>
    private static readonly TimeSpan RepeatVisitWindow = TimeSpan.FromMinutes(30);

    public static string? NormalizeCode(string? code)
    {
        var trimmed = code?.Trim().ToLowerInvariant();
        return trimmed is { Length: >= 4 and <= 16 } && trimmed.All(char.IsAsciiLetterOrDigit) ? trimmed : null;
    }

    public static string? NormalizeTitle(string? title)
    {
        var trimmed = title?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length > MaxTitleLength ? trimmed[..MaxTitleLength] : trimmed;
    }

    // ---------------------------------------------------------------------------
    // Public: the link was opened, an account was created
    // ---------------------------------------------------------------------------

    /// <summary>
    /// Records that someone opened a campaign link. An unknown code is ignored quietly —
    /// the caller answers the same either way, so the endpoint cannot be used to probe
    /// which codes exist.
    /// </summary>
    public async Task RecordVisitAsync(string? code, string? deviceId, HttpContext http, CancellationToken cancellationToken)
    {
        var campaignId = await ResolveIdAsync(code, cancellationToken);
        if (campaignId is null)
        {
            return;
        }

        var visitor = fingerprint.CampaignVisitorHash(http, deviceId);
        var now = DateTime.UtcNow;
        if (visitor is not null)
        {
            var since = now - RepeatVisitWindow;
            var repeat = await db.CampaignVisits.AnyAsync(
                item => item.CampaignId == campaignId && item.VisitorHash == visitor && item.CreatedAtUtc >= since,
                cancellationToken);
            if (repeat)
            {
                return;
            }
        }

        db.CampaignVisits.Add(new CampaignVisit { CampaignId = campaignId.Value, VisitorHash = visitor, CreatedAtUtc = now });
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<Guid?> ResolveIdAsync(string? code, CancellationToken cancellationToken)
    {
        var normalized = NormalizeCode(code);
        if (normalized is null)
        {
            return null;
        }

        return await db.Campaigns
            .Where(item => item.Code == normalized)
            .Select(item => (Guid?)item.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    // ---------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------

    public async Task<IReadOnlyList<CampaignSummary>> ListAsync(CancellationToken cancellationToken)
    {
        var campaigns = await db.Campaigns.OrderByDescending(item => item.CreatedAtUtc).ToListAsync(cancellationToken);
        if (campaigns.Count == 0)
        {
            return [];
        }

        var visits = await db.CampaignVisits
            .GroupBy(item => item.CampaignId)
            .Select(group => new { group.Key, Count = group.Count(), Last = group.Max(item => item.CreatedAtUtc) })
            .ToListAsync(cancellationToken);

        // Distinct pairs first, counted here: small, and it sidesteps how differently each
        // provider translates a distinct count inside a GROUP BY.
        var uniques = (await db.CampaignVisits
                .Select(item => new { item.CampaignId, item.VisitorHash })
                .Distinct()
                .ToListAsync(cancellationToken))
            .GroupBy(item => item.CampaignId)
            .ToDictionary(group => group.Key, group => group.Count());

        var funnel = await FunnelAsync(null, cancellationToken);

        return [.. campaigns.Select(campaign =>
        {
            var visit = visits.FirstOrDefault(item => item.Key == campaign.Id);
            var people = funnel.Where(item => item.CampaignId == campaign.Id).ToList();
            return new CampaignSummary(
                campaign.Id,
                campaign.Code,
                campaign.Title,
                campaign.CreatedAtUtc,
                campaign.VisitsResetAtUtc,
                visit?.Count ?? 0,
                uniques.GetValueOrDefault(campaign.Id),
                visit?.Last,
                people.Count,
                people.Count(item => item.Trial),
                people.Count(item => item.Paid),
                people.Sum(item => item.Revenue));
        })];
    }

    /// <summary>The accounts a campaign brought in, newest first. Null when the campaign does not exist.</summary>
    public async Task<IReadOnlyList<CampaignUser>?> GetUsersAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!await db.Campaigns.AnyAsync(item => item.Id == id, cancellationToken))
        {
            return null;
        }

        var funnel = await FunnelAsync(id, cancellationToken);
        return [.. funnel
            .OrderByDescending(item => item.CreatedAtUtc)
            .Take(UsersListLimit)
            .Select(item => new CampaignUser(item.UserId, item.Email, item.DisplayName, item.CreatedAtUtc, item.Trial, item.Paid, item.Revenue))];
    }

    public async Task<Campaign> CreateAsync(string title, CancellationToken cancellationToken)
    {
        // A collision is one in hundreds of millions, but the unique index would turn it into
        // a 500 — so the code is checked first, and drawn again if taken.
        string code;
        do
        {
            code = GenerateCode();
        }
        while (await db.Campaigns.AnyAsync(item => item.Code == code, cancellationToken));

        var campaign = new Campaign { Code = code, Title = title };
        db.Campaigns.Add(campaign);
        await db.SaveChangesAsync(cancellationToken);
        return campaign;
    }

    /// <summary>Only the title moves. The code — the printed link — is never touched.</summary>
    public async Task<Campaign?> RenameAsync(Guid id, string title, CancellationToken cancellationToken)
    {
        var campaign = await db.Campaigns.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (campaign is null)
        {
            return null;
        }

        campaign.Title = title;
        campaign.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return campaign;
    }

    /// <summary>
    /// Wipes the visits — meant for the ones you made yourself testing the QR. Signups and
    /// payments are accounts, not visits, and stay attributed.
    /// </summary>
    public async Task<Campaign?> ResetVisitsAsync(Guid id, CancellationToken cancellationToken)
    {
        var campaign = await db.Campaigns.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (campaign is null)
        {
            return null;
        }

        await db.CampaignVisits.Where(item => item.CampaignId == id).ExecuteDeleteAsync(cancellationToken);
        campaign.VisitsResetAtUtc = DateTime.UtcNow;
        campaign.UpdatedAtUtc = campaign.VisitsResetAtUtc.Value;
        await db.SaveChangesAsync(cancellationToken);
        return campaign;
    }

    /// <summary>
    /// Removes the campaign and its visits. The accounts it brought stay, simply no longer
    /// attributed to anything. After this the printed link still opens the site; it just
    /// counts for nobody.
    /// </summary>
    public async Task<Campaign?> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        var campaign = await db.Campaigns.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (campaign is null)
        {
            return null;
        }

        await db.CampaignVisits.Where(item => item.CampaignId == id).ExecuteDeleteAsync(cancellationToken);
        await db.Users
            .Where(item => item.CampaignId == id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(item => item.CampaignId, (Guid?)null), cancellationToken);
        db.Campaigns.Remove(campaign);
        await db.SaveChangesAsync(cancellationToken);
        return campaign;
    }

    private static string GenerateCode() =>
        string.Create(CodeLength, 0, (span, _) =>
        {
            for (var index = 0; index < span.Length; index++)
            {
                span[index] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
            }
        });

    /// <summary>
    /// Every attributed account with what it went on to do. "Trial" and "paid" leave out the
    /// seeded admin VIP and the dev toggle, like the business funnel does; "paid" is an
    /// approved charge, not a status, so an account that paid and later cancelled still counts.
    /// </summary>
    private async Task<List<FunnelRow>> FunnelAsync(Guid? campaignId, CancellationToken cancellationToken)
    {
        var users = await db.Users
            .Where(item => item.CampaignId != null && (campaignId == null || item.CampaignId == campaignId))
            .Select(item => new { item.Id, CampaignId = item.CampaignId!.Value, item.Email, item.DisplayName, item.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        if (users.Count == 0)
        {
            return [];
        }

        var ids = users.Select(item => item.Id).ToList();
        var real = db.Subscriptions.Where(item => ids.Contains(item.UserId) && !item.IsSeededVip && !item.IsDevSimulated);

        var trial = (await real
                .Where(item => item.TrialWasApplied)
                .Select(item => item.UserId)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        // Amounts summed here: SQLite stores money as REAL and EF will not SUM a decimal there.
        var charges = (await db.SubscriptionInvoices
                .Where(invoice => invoice.Status == "aprobado" && real.Any(subscription => subscription.Id == invoice.SubscriptionId))
                .Select(invoice => new { invoice.UserId, invoice.Amount })
                .ToListAsync(cancellationToken))
            .GroupBy(item => item.UserId)
            .ToDictionary(group => group.Key, group => group.Sum(item => item.Amount));

        return [.. users.Select(item => new FunnelRow(
            item.Id,
            item.CampaignId,
            item.Email,
            item.DisplayName,
            item.CreatedAtUtc,
            trial.Contains(item.Id),
            charges.ContainsKey(item.Id),
            charges.GetValueOrDefault(item.Id)))];
    }

    private sealed record FunnelRow(
        Guid UserId,
        Guid CampaignId,
        string Email,
        string DisplayName,
        DateTime CreatedAtUtc,
        bool Trial,
        bool Paid,
        decimal Revenue);
}

public sealed record CampaignSummary(
    Guid Id,
    string Code,
    string Title,
    DateTime CreatedAtUtc,
    DateTime? VisitsResetAtUtc,
    int Visits,
    int UniqueVisitors,
    DateTime? LastVisitAtUtc,
    int Signups,
    int Trials,
    int Paid,
    decimal Revenue);

public sealed record CampaignUser(
    Guid Id,
    string Email,
    string DisplayName,
    DateTime CreatedAtUtc,
    bool Trial,
    bool Paid,
    decimal Revenue);
