using System.Globalization;

namespace backend.Services;

/// <summary>
/// Which metrics a non-Pro account may spend a daily free unlock on, and how many it
/// gets. The paid metrics are the product — the free ones are only being shown off — so
/// the split is enforced here rather than trusted from the request body.
///
/// This duplicates the tier split declared in <c>frontend/src/lib/metrics.ts</c>
/// (<c>freeMetricEntries</c>). That is deliberate: the browser computes every metric
/// locally, so the server has no other way to know which id is free, and a check that
/// only ran in the client would be no check at all. Keep the two lists in step when a
/// metric changes tier.
/// </summary>
public static class FreeMetricCatalog
{
    /// <summary>Free detail unlocks an account gets per UTC day.</summary>
    public const int DailyLimit = 5;

    private static readonly HashSet<string> Ids = new(StringComparer.Ordinal)
    {
        "spammer",
        "monologuista",
        "reloj",
        "jajaja",
        "emojis",
        "racha-dias",
        "testamento",
        "multimedia",
        "poliglota",
        "velocista",
        "heatmap-anual",
        "termometro",
        "arrepentido",
    };

    public static bool IsFreeMetric(string? metricId) =>
        !string.IsNullOrWhiteSpace(metricId) && Ids.Contains(metricId);

    /// <summary>The bucket a moment falls into. UTC, so the reset is the same instant for everyone.</summary>
    public static string DayKey(DateTime utcNow) => utcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Next UTC midnight — the exact moment the allowance refills, for the countdown.</summary>
    public static DateTime NextResetUtc(DateTime utcNow) => utcNow.Date.AddDays(1);
}
