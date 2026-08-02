using System.Text;

namespace backend.Services;

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

    public static bool IsSupported(string metricId) =>
        metricId is TonoPicante or RedFlags;

    public static IReadOnlyList<string> SupportedMetricIds => [TonoPicante, RedFlags];

    // Shared preamble: describes the wire format once. Kept terse because it is
    // re-sent with every batch and every token is billed.
    private const string FormatPreamble =
        "Clasificás fragmentos de un chat. Cada fragmento tiene un id (mostrado como #N), entre " +
        "corchetes la palabra clave que disparó el filtro, el mensaje a clasificar marcado con \"*\" " +
        "y, a veces, mensajes de contexto marcados con \"-\". Solo se clasifica el mensaje \"*\"; el " +
        "contexto está para entender la conversación. Los mensajes pueden estar en español o en " +
        "inglés. Devolvé únicamente los ids (N) que cumplen, sin el símbolo \"#\" — por ejemplo \"2\", " +
        "no \"#2\". Ante la duda, excluí.\n";

    public static string SystemInstruction(string metricId) => metricId switch
    {
        TonoPicante => FormatPreamble +
            "Incluí un id cuando el mensaje \"*\" tenga carga sexual, erótica o de coqueteo real (+18) " +
            "entre las personas del chat. " +
            "Excluí cuando la palabra clave se use en sentido literal o cotidiano (\"la comida estaba " +
            "caliente\", \"hace calor\"), como insulto o muletilla sin intención sexual, como broma " +
            "sin contenido sexual, o como cita de una canción, película o de un tercero.",

        RedFlags => FormatPreamble +
            "Incluí un id cuando el mensaje \"*\" sea una señal real de conflicto o tensión dirigida a " +
            "la otra persona: celos o control, reproche o culpabilización, insulto, o amenaza de " +
            "terminar el vínculo. " +
            "Excluí cuando sea broma o sarcasmo entre amigos, cariño exagerado, cita de una canción, " +
            "película o de un tercero, o cuando la frase se refiera a algo que no es la relación " +
            "(\"odio este trabajo\", \"terminamos el proyecto\").",

        _ => throw new ArgumentOutOfRangeException(nameof(metricId), metricId, "Unsupported AI metric."),
    };

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
