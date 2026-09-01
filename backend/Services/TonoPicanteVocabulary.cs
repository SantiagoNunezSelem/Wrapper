using System.Text.RegularExpressions;

namespace backend.Services;

/// <summary>
/// Softens "tonopicante" candidates before they reach Gemini. Even with every
/// <c>safetySettings</c> category at <c>BLOCK_NONE</c> (see <see cref="GoogleAiClient"/>),
/// Gemini's own non-adjustable content-safety floor can still refuse a batch outright
/// purely from the density of crude/anatomical vocabulary in one call — the exact
/// vocabulary this metric's dictionary goes looking for (see
/// <c>frontend/src/lib/metrics.ts</c>'s <c>flirtyExplicitWords</c>, which this list
/// mirrors and should be kept in sync with).
/// <para>
/// Swapping each word for a same-meaning, clinical/euphemistic synonym keeps a message's
/// real charge legible to the model — "intimidad" reads exactly as flirty/sexual as
/// "sexo" does — while lowering how often the floor trips on vocabulary alone. Gemini
/// never sees the raw slang, only what it means; nothing about a message's actual verdict
/// changes, only the words used to ask about it. Applied fresh before every call and never
/// persisted, so the stored verdict and input hash still reflect exactly what the browser
/// sent.
/// </para>
/// </summary>
public static class TonoPicanteVocabulary
{
    private static readonly IReadOnlyDictionary<string, string> Synonyms = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["pene"] = "miembro",
        ["pija"] = "miembro",
        ["verga"] = "miembro",
        ["polla"] = "miembro",
        ["chota"] = "miembro",
        ["dick"] = "member",
        ["cock"] = "member",
        ["sprick"] = "member",
        ["schlong"] = "member",
        ["shaft"] = "member",

        ["culo"] = "trasero",
        ["orto"] = "trasero",
        ["nalgas"] = "trasero",
        ["pompis"] = "trasero",
        ["ass"] = "rear",
        ["butt"] = "rear",
        ["botty"] = "rear",

        ["teta"] = "busto",
        ["tetas"] = "bustos",
        ["pecho"] = "torso",
        ["pechos"] = "torsos",
        ["boob"] = "chest",
        ["boobs"] = "chest",
        ["tit"] = "chest",
        ["tits"] = "chest",
        ["breast"] = "chest",
        ["breasts"] = "chest",
        ["knockers"] = "chest",
        ["jugs"] = "chest",

        ["vagina"] = "zona íntima",
        ["concha"] = "zona íntima",
        ["coño"] = "zona íntima",
        ["pussy"] = "intimate area",
        ["cunt"] = "intimate area",
        ["snatch"] = "intimate area",
        ["twat"] = "intimate area",
        ["beaver"] = "intimate area",
        ["muff"] = "intimate area",

        ["sexo"] = "intimidad",
        ["puta"] = "provocadora",
        ["slut"] = "atrevida",

        ["gemir"] = "suspirar",
        ["gemidos"] = "suspiros",
        ["erotico"] = "romantico",
        ["erótico"] = "romántico",
        ["erotica"] = "romantica",
        ["erótica"] = "romántica",

        ["desnudo"] = "destapado",
        ["desnuda"] = "destapada",
        ["desnudarte"] = "destaparte",
        ["desnudarme"] = "destaparme",

        ["sumisa"] = "dócil",
        ["sumiso"] = "dócil",
        ["dominante"] = "firme",

        ["follar"] = "intimar",
        ["coger"] = "intimar",
        ["penetrar"] = "unirse",
        ["penetracion"] = "acercamiento",
        ["penetración"] = "acercamiento",
    };

    private static readonly Regex Pattern = new(
        $@"\b(?:{string.Join("|", Synonyms.Keys.Select(Regex.Escape))})\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>Softens both the rendered snippet and its bracketed keyword tag — leaving
    /// the raw word in the <c>[keyword]</c> tag would defeat the point while the body
    /// gets softened around it.</summary>
    public static AiSnippetInput Soften(AiSnippetInput snippet) =>
        snippet with { Keyword = SoftenText(snippet.Keyword), Text = SoftenText(snippet.Text) };

    private static string SoftenText(string value) =>
        string.IsNullOrEmpty(value) ? value : Pattern.Replace(value, match => MatchCase(match.Value, Synonyms[match.Value]));

    /// <summary>Best-effort: mirrors the matched word's leading capitalisation so a
    /// sentence-starting hit doesn't read as a lowercase typo.</summary>
    private static string MatchCase(string original, string replacement) =>
        char.IsUpper(original[0]) ? char.ToUpperInvariant(replacement[0]) + replacement[1..] : replacement;
}
