using System.Text;

namespace backend.Services;

/// <summary>
/// Who the chat is between, as far as the prompt needs to know. The same sentence between
/// two people in a relationship and inside a group of friends is not the same sentence, and
/// the model cannot tell which one it is reading unless it is told.
/// </summary>
public enum ChatBond
{
    /// <summary>Three or more people, or a client that did not say: the safer reading, where banter is normal.</summary>
    Group,

    /// <summary>Exactly two people: a couple, or something close to one.</summary>
    Pair,
}

/// <summary>
/// The instructions live here, on the server, and never travel from the browser.
/// The client may only name a metric id and hand over already-filtered snippets —
/// it can't hand us a prompt, so a signed-in VIP can't turn this endpoint into a
/// free general-purpose Gemini proxy paid for with our key.
/// </summary>
public static class AiMetricPrompts
{
    public const string TonoPicante = "tonopicante";
    public const string RedFlags = "redflags";

    /// <summary>
    /// The scan reads the chat itself instead of judging the keyword hits, so it needs far more
    /// text than one request should carry: the browser splits it into numbered parts, each its own
    /// request and its own stored verdict — <c>redflags-scan-1</c>, <c>redflags-scan-2</c>…
    /// </summary>
    public const string RedFlagsScanPrefix = "redflags-scan-";

    /// <summary>More parts than the biggest chat the browser sends could need.</summary>
    public const int MaxScanParts = 8;

    /// <summary>
    /// What the scan answers with for each kind of finding. The browser maps the same three
    /// letters back to its categories (<c>scanCode</c> in metrics.ts).
    /// </summary>
    public static readonly IReadOnlySet<string> ScanCodes = new HashSet<string>(StringComparer.Ordinal)
    {
        "ins", "cel", "cul", "rup", "cha", "gas", "ais", "ame", "pre",
    };

    public static bool IsScan(string metricId) => TryGetScanPart(metricId, out _);

    public static bool TryGetScanPart(string metricId, out int part)
    {
        part = 0;

        if (!metricId.StartsWith(RedFlagsScanPrefix, StringComparison.Ordinal)
            || !int.TryParse(metricId.AsSpan(RedFlagsScanPrefix.Length), out var parsed)
            || parsed is < 1 or > MaxScanParts)
        {
            return false;
        }

        part = parsed;
        return true;
    }

    public static bool IsSupported(string metricId) =>
        metricId is TonoPicante or RedFlags || IsScan(metricId);

    public static IReadOnlyList<string> SupportedMetricIds => [TonoPicante, RedFlags];

    /// <summary>Two participants is a pair; anything else, including "unknown", is a group.</summary>
    public static ChatBond BondFor(int? participants) => participants == 2 ? ChatBond.Pair : ChatBond.Group;

    // Shared preamble: describes the wire format once. Kept terse because it is
    // re-sent with every batch and every token is billed.
    private const string FormatPreamble =
        "Clasificás fragmentos de un chat. Cada fragmento tiene un id (mostrado como #N), entre " +
        "corchetes la palabra clave que disparó el filtro, el mensaje a clasificar marcado con \"*\" " +
        "y, a veces, mensajes de contexto marcados con \"-\". Solo se clasifica el mensaje \"*\"; el " +
        "contexto está para entender la conversación. Los mensajes pueden estar en español o en " +
        "inglés. Devolvé únicamente los ids (N) que cumplen, sin el símbolo \"#\" — por ejemplo \"2\", " +
        "no \"#2\". Ante la duda, excluí.\n";

    /// <summary>What counts as a red flag, shared by the keyword-hit prompt and the scan.</summary>
    private const string RedFlagKinds =
        "celos o control (vigilar, pedir explicaciones, revisar el celular, prohibir amistades), " +
        "reproche o culpabilización, insulto o humillación, amenaza de terminar el vínculo, " +
        "chantaje emocional (amenazar con hacerse daño o con irse para conseguir algo, \"si me quisieras…\"), " +
        "gaslighting (negar lo que pasó o hacer dudar a la otra persona de lo que siente o recuerda), " +
        "aislamiento (alejar a la otra persona de su gente), presión o coerción, " +
        "o amenaza de hacer daño o de exponer a alguien";

    private const string RedFlagExclusions =
        "Excluí el humor y las cargadas entre amigos, el sarcasmo, el cariño exagerado, las citas de una " +
        "canción, película o de un tercero, y todo lo que no se refiera a la relación entre las personas " +
        "del chat (\"odio este trabajo\", \"terminamos el proyecto\"). ";

    private const string IronyNote =
        "En el chat, terminar una frase con \"(?\" es un recurso para marcar ironía o sarcasmo " +
        "(por ejemplo, \"sos un capo (?\" es sarcástico, no un halago real) — tenelo en cuenta al " +
        "interpretar el mensaje.";

    private static string BondGuidance(ChatBond bond) => bond == ChatBond.Pair
        ? "El chat es entre dos personas, probablemente una pareja o un vínculo cercano: ahí los celos, el " +
          "control, el chantaje y la manipulación son señales reales aunque estén dichos con cariño, y no " +
          "los tomes como broma salvo que el contexto lo deje clarísimo. "
        : "El chat es un grupo: las cargadas, los insultos en broma y el humor entre amigos son lo normal, " +
          "así que incluí solo lo claramente agresivo, humillante, amenazante o manipulador. ";

    public static string SystemInstruction(string metricId, ChatBond bond = ChatBond.Group) => metricId switch
    {
        TonoPicante => FormatPreamble +
            "Incluí un id cuando el mensaje \"*\" tenga carga sexual, erótica o de coqueteo real (+18) " +
            "entre las personas del chat. " +
            "Excluí cuando la palabra clave se use en sentido literal o cotidiano (\"la comida estaba " +
            "caliente\", \"hace calor\"), como insulto o muletilla sin intención sexual, como broma " +
            "sin contenido sexual, o como cita de una canción, película o de un tercero.",

        RedFlags => FormatPreamble +
            "Incluí un id cuando el mensaje \"*\" sea una señal real de conflicto, tensión o manipulación " +
            "dirigida a la otra persona: " + RedFlagKinds + ". " +
            "Excluí cuando sea broma o sarcasmo entre amigos, cariño exagerado, cita de una canción, " +
            "película o de un tercero, o cuando la frase se refiera a algo que no es la relación " +
            "(\"odio este trabajo\", \"terminamos el proyecto\"). " +
            BondGuidance(bond) +
            IronyNote,

        _ when IsScan(metricId) => ScanInstruction(bond),

        _ => throw new ArgumentOutOfRangeException(nameof(metricId), metricId, "Unsupported AI metric."),
    };

    private static string ScanInstruction(ChatBond bond) =>
        "Leés tramos de un chat. Cada línea empieza con su número, una letra que identifica a quien " +
        "escribe y el mensaje. Los bloques separados por una línea en blanco son tramos distintos del chat, " +
        "sin relación entre sí. Los mensajes pueden estar en español o en inglés. " +
        "Devolvé en \"ids\" una entrada por cada mensaje que sea una señal real de tensión o manipulación " +
        "dirigida a la otra persona, con el formato \"número:código\" — por ejemplo \"412:ins\". " +
        "Códigos: ins = insulto o humillación; cel = celos o control (vigilar, pedir explicaciones, revisar " +
        "el celular, prohibir amistades); cul = culpa o reproche; rup = amenaza de terminar el vínculo; " +
        "cha = chantaje emocional (amenazar con hacerse daño o con irse para conseguir algo, " +
        "\"si me quisieras…\"); gas = gaslighting (negar lo que pasó o hacer dudar a la otra persona de lo " +
        "que siente o recuerda); ais = aislamiento (alejar a la otra persona de su gente); ame = amenaza de " +
        "hacer daño o de exponer a alguien; pre = presión o coerción. " +
        "Una sola entrada por mensaje, con el código que mejor lo describa. " +
        RedFlagExclusions +
        BondGuidance(bond) +
        "Ante la duda, excluí. " +
        IronyNote;

    /// <summary>Renders one batch of snippets into the compact block format the instruction describes.</summary>
    public static string RenderBatch(IEnumerable<AiSnippetInput> snippets)
    {
        var builder = new StringBuilder();

        foreach (var snippet in snippets)
        {
            builder.Append('#').Append(snippet.Id);

            if (!string.IsNullOrWhiteSpace(snippet.Keyword))
            {
                builder.Append(" [").Append(snippet.Keyword).Append(']');
            }

            builder.Append('\n').Append(snippet.Text.Trim()).Append("\n\n");
        }

        return builder.ToString().TrimEnd();
    }
}
