using System.Text.Json;
using System.Text.Json.Serialization;

namespace backend.Services;

/// <summary>
/// Rebuilds a Wrapped run into the reduced shape that is safe to publish at an unlisted,
/// sign-in-free URL.
///
/// <para><b>What this defends against.</b> The app's own metric cards carry real message
/// text in exactly two places: <c>basic.note</c> (which for "El Testamento" is the longest
/// message, quoted verbatim) and <c>detail.groups</c> (the WhatsApp-style bubbles, complete
/// with the messages around the highlighted one for context). Publishing those would expose
/// conversations belonging to people who never agreed to anything. Neither field is modeled
/// below, and the payload is *rebuilt* from these types rather than filtered — so the text
/// cannot survive the round trip even if a tampered client sends it, and a metric added
/// later cannot leak by being forgotten in a blocklist.</para>
///
/// <para><b>What this deliberately does not defend against.</b> Titles, stat labels and
/// intros are free text by design ("mensajes seguidos de Fran sin respuesta"), so a
/// determined signed-in user could always publish arbitrary words of their own — through a
/// hand-edited label just as easily as through the chat name. That is inherent to any share
/// feature and is bounded by authentication, rate limits and the size cap, not by this
/// class. The job here is narrower and worth stating plainly: the ordinary flow must never
/// publish a conversation by accident.</para>
/// </summary>
public static class SharePayloadSanitizer
{
    /// <summary>
    /// Chart shapes the client is allowed to publish. Every one of these carries only
    /// aggregates and short labels — participant names, emojis, weekday names, single
    /// vocabulary words, bucket counts — never message bodies, which is why charts pass
    /// through whole (see <see cref="SharedChart"/>). An unrecognized <c>kind</c> is
    /// dropped rather than trusted: a new chart family has to be reviewed here before it
    /// can reach a public page.
    /// </summary>
    private static readonly HashSet<string> AllowedChartKinds =
    [
        "bar", "donut", "hourHeatmap", "yearHeatmap", "monthHeatmap",
        "radar", "calendarStreak", "timeline", "activityWave", "wordCloud", "histogram",
    ];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// Parses the cards a client submitted and returns the publishable subset, or
    /// <c>null</c> when the input is not valid JSON or holds nothing worth sharing.
    /// </summary>
    public static IReadOnlyList<SharedCard>? Sanitize(string cardsJson)
    {
        List<SharedCard>? cards;

        try
        {
            cards = JsonSerializer.Deserialize<List<SharedCard>>(cardsJson, Json);
        }
        catch (JsonException)
        {
            return null;
        }

        if (cards is null)
        {
            return null;
        }

        // A story screen exists to show one number, so a card without a headline stat has
        // nothing to display and is dropped rather than published as a blank screen.
        var usable = cards
            .Where(card => !string.IsNullOrWhiteSpace(card.Id) && card.Basic is not null)
            .Select(Clean)
            .ToList();

        return usable.Count == 0 ? null : usable;
    }

    public static string Serialize(IReadOnlyList<SharedCard> cards) => JsonSerializer.Serialize(cards, Json);

    private static SharedCard Clean(SharedCard card) => card with
    {
        Basic = card.Basic is null ? null : card.Basic with { Chart = KeepChart(card.Basic.Chart) },
        Detail = card.Detail is null
            ? null
            : card.Detail with
            {
                Chart = KeepChart(card.Detail.Chart),
                Series = card.Detail.Series?
                    .Select(entry => entry with { Chart = KeepChart(entry.Chart) })
                    .Where(entry => entry.Chart is not null)
                    .ToList(),
            },
    };

    private static JsonElement? KeepChart(JsonElement? chart)
    {
        if (chart is not { ValueKind: JsonValueKind.Object } element)
        {
            return null;
        }

        return element.TryGetProperty("kind", out var kind) &&
               kind.ValueKind == JsonValueKind.String &&
               AllowedChartKinds.Contains(kind.GetString()!)
            ? element
            : null;
    }
}

/// <summary>
/// One publishable metric card. Mirrors the client's <c>MetricCard</c> minus everything
/// that is either private (see <see cref="SharePayloadSanitizer"/>) or meaningless once
/// frozen: <c>hasData</c> (only cards with data are ever sent), <c>preview</c> and
/// <c>ai</c> (both describe a locked or pending state, and a shared card is neither).
/// </summary>
public sealed record SharedCard
{
    public string Id { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Tier { get; init; } = "free";
    public string Accent { get; init; } = string.Empty;
    public SharedStat? Basic { get; init; }
    public SharedDetail? Detail { get; init; }
}

/// <summary>The headline stat. <c>note</c> is absent on purpose — it is the field that
/// quotes a real message verbatim.</summary>
public sealed record SharedStat
{
    public string Value { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public JsonElement? Chart { get; init; }
}

/// <summary>The expanded view. <c>groups</c>/<c>groupsLabel</c> are absent on purpose —
/// those are the chat bubbles. <c>paginatedItems</c> stays: it is documented client-side as
/// the list for metrics with no messages to quote, and in practice only ever holds word
/// tallies ("\"caliente\" se usó 6 veces").</summary>
public sealed record SharedDetail
{
    public string? Intro { get; init; }
    public JsonElement? Chart { get; init; }
    public List<SharedBreakdownEntry>? Breakdown { get; init; }
    public List<SharedSeriesEntry>? Series { get; init; }
    public List<string>? PaginatedItems { get; init; }
    public string? PaginatedItemsLabel { get; init; }
}

public sealed record SharedBreakdownEntry
{
    public string Name { get; init; } = string.Empty;
    public double Value { get; init; }
    public string DisplayValue { get; init; } = string.Empty;
    public string? Color { get; init; }
}

public sealed record SharedSeriesEntry
{
    public string Name { get; init; } = string.Empty;
    public JsonElement? Chart { get; init; }
}
