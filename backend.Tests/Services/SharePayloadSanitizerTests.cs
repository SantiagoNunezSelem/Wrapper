using System.Text.Json;
using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// La línea donde se corta el texto de los mensajes antes de publicarse en una URL sin
/// sesión. El cliente ya recorta por su cuenta; esto vuelve a recortar por si el cliente
/// está manipulado, así que los tests mandan a propósito lo que un cliente honesto nunca
/// mandaría.
/// </summary>
public class SharePayloadSanitizerTests
{
    /// <summary>Una tarjeta tal como la envía el cliente, con todo lo privado adentro.</summary>
    private const string FullCard = """
    [{
      "id": "testamento",
      "title": "El mensaje más largo del chat",
      "description": "El Testamento",
      "tier": "free",
      "accent": "tier-gold",
      "hasData": true,
      "preview": "teaser",
      "basic": {
        "value": "1.240",
        "label": "caracteres en el mensaje más largo, de Ana",
        "note": "\"che te queria contar que ayer me paso algo increible\"",
        "chart": { "kind": "bar", "items": [{ "label": "Ana", "value": 1240 }] }
      },
      "detail": {
        "intro": "Los mensajes más extensos de cada integrante.",
        "chart": { "kind": "timeline", "points": [] },
        "breakdown": [{ "name": "Ana", "value": 1240, "displayValue": "1.240 caracteres", "color": "#a78bfa" }],
        "series": [{ "name": "Ana", "chart": { "kind": "wordCloud", "words": [] } }],
        "groups": [{
          "id": "msg-1",
          "heading": "Ana — 210 palabras",
          "bubbles": [{ "sender": "Ana", "text": "che te queria contar", "timestampLabel": "10 mar", "isHighlight": true }]
        }],
        "paginatedItems": ["\"caliente\" se usó 6 veces"],
        "paginatedItemsLabel": "Palabras más usadas"
      }
    }]
    """;

    private static string SerializeSanitized(string json) =>
        SharePayloadSanitizer.Serialize(SharePayloadSanitizer.Sanitize(json)!);

    // -----------------------------------------------------------------------
    // Lo que nunca puede salir publicado
    // -----------------------------------------------------------------------

    [Fact]
    public void NUNCA_publica_la_cita_textual_del_mensaje_más_largo()
    {
        var output = SerializeSanitized(FullCard);

        Assert.DoesNotContain("me paso algo increible", output);
        Assert.DoesNotContain("\"note\"", output);
    }

    [Fact]
    public void NUNCA_publica_las_burbujas_de_conversación()
    {
        var output = SerializeSanitized(FullCard);

        Assert.DoesNotContain("che te queria contar", output);
        Assert.DoesNotContain("bubbles", output);
    }

    [Fact]
    public void El_payload_se_reconstruye_no_se_filtra()
    {
        // Un campo que el modelo no conoce desaparece por construcción, no por lista
        // negra: una métrica nueva no puede filtrar por olvido.
        var withExtras = """
        [{ "id": "x", "basic": { "value": "1", "label": "y" }, "campoInventado": "secreto", "detail": { "campoNuevo": "otro secreto" } }]
        """;

        var output = SerializeSanitized(withExtras);

        Assert.DoesNotContain("secreto", output);
        Assert.DoesNotContain("campoInventado", output);
    }

    [Fact]
    public void Conserva_el_encabezado_del_grupo_pero_no_su_contenido()
    {
        var group = Assert.Single(SharePayloadSanitizer.Sanitize(FullCard)![0].Detail!.Groups!);

        // Se afirma sobre el modelo y no sobre el JSON crudo porque el serializador
        // escapa la raya larga como —, y buscarla como substring daría un falso
        // negativo que no dice nada sobre privacidad.
        Assert.Equal("msg-1", group.Id);
        Assert.Equal("Ana — 210 palabras", group.Heading);
    }

    // -----------------------------------------------------------------------
    // Lo que sí se publica
    // -----------------------------------------------------------------------

    [Fact]
    public void Conserva_identidad_número_y_desglose()
    {
        var cards = SharePayloadSanitizer.Sanitize(FullCard)!;
        var card = Assert.Single(cards);

        Assert.Equal("testamento", card.Id);
        Assert.Equal("El Testamento", card.Description);
        Assert.Equal("tier-gold", card.Accent);
        Assert.Equal("1.240", card.Basic!.Value);
        Assert.Single(card.Detail!.Breakdown!);
        Assert.Equal("#a78bfa", card.Detail.Breakdown![0].Color);
    }

    [Fact]
    public void Conserva_los_items_paginados_que_son_conteos_de_palabras()
    {
        var card = SharePayloadSanitizer.Sanitize(FullCard)![0];

        Assert.Equal(["\"caliente\" se usó 6 veces"], card.Detail!.PaginatedItems);
        Assert.Equal("Palabras más usadas", card.Detail.PaginatedItemsLabel);
    }

    [Fact]
    public void El_tier_por_defecto_es_free_cuando_no_viene()
    {
        var card = SharePayloadSanitizer.Sanitize("""[{ "id": "x", "basic": { "value": "1", "label": "y" } }]""")![0];

        Assert.Equal("free", card.Tier);
    }

    // -----------------------------------------------------------------------
    // Lista blanca de gráficos
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("bar")]
    [InlineData("donut")]
    [InlineData("hourHeatmap")]
    [InlineData("yearHeatmap")]
    [InlineData("monthHeatmap")]
    [InlineData("radar")]
    [InlineData("calendarStreak")]
    [InlineData("timeline")]
    [InlineData("activityWave")]
    [InlineData("wordCloud")]
    [InlineData("histogram")]
    public void Deja_pasar_los_gráficos_conocidos(string kind)
    {
        var json = $$"""[{ "id": "x", "basic": { "value": "1", "label": "y", "chart": { "kind": "{{kind}}" } } }]""";

        Assert.NotNull(SharePayloadSanitizer.Sanitize(json)![0].Basic!.Chart);
    }

    [Theory]
    [InlineData("chatBubbles")]
    [InlineData("")]
    [InlineData("BAR")]
    public void Descarta_un_tipo_de_gráfico_que_no_conoce(string kind)
    {
        // Una familia de gráficos nueva tiene que pasar por revisión acá antes de poder
        // llegar a una página pública.
        var json = $$"""[{ "id": "x", "basic": { "value": "1", "label": "y", "chart": { "kind": "{{kind}}", "secreto": "texto de un mensaje" } } }]""";

        var card = SharePayloadSanitizer.Sanitize(json)![0];

        Assert.Null(card.Basic!.Chart);
        Assert.DoesNotContain("texto de un mensaje", SharePayloadSanitizer.Serialize([card]));
    }

    [Fact]
    public void Descarta_un_chart_sin_kind()
    {
        var json = """[{ "id": "x", "basic": { "value": "1", "label": "y", "chart": { "items": [] } } }]""";

        Assert.Null(SharePayloadSanitizer.Sanitize(json)![0].Basic!.Chart);
    }

    [Fact]
    public void Descarta_un_chart_que_no_es_un_objeto()
    {
        var json = """[{ "id": "x", "basic": { "value": "1", "label": "y", "chart": "bar" } }]""";

        Assert.Null(SharePayloadSanitizer.Sanitize(json)![0].Basic!.Chart);
    }

    [Fact]
    public void Filtra_también_los_gráficos_de_las_series_por_participante()
    {
        var json = """
        [{ "id": "x", "basic": { "value": "1", "label": "y" }, "detail": { "series": [
          { "name": "Ana", "chart": { "kind": "radar" } },
          { "name": "Beto", "chart": { "kind": "inventado" } }
        ] } }]
        """;

        var series = SharePayloadSanitizer.Sanitize(json)![0].Detail!.Series!;

        // La serie con gráfico descartado se va entera: sin chart no tiene nada que mostrar.
        Assert.Single(series);
        Assert.Equal("Ana", series[0].Name);
    }

    // -----------------------------------------------------------------------
    // Entradas inválidas
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("no es json")]
    [InlineData("{}")]
    [InlineData("[{")]
    public void Devuelve_null_ante_un_JSON_inválido(string json)
    {
        Assert.Null(SharePayloadSanitizer.Sanitize(json));
    }

    [Fact]
    public void Devuelve_null_cuando_la_lista_llega_vacía()
    {
        Assert.Null(SharePayloadSanitizer.Sanitize("[]"));
    }

    [Fact]
    public void Devuelve_null_para_el_literal_null()
    {
        Assert.Null(SharePayloadSanitizer.Sanitize("null"));
    }

    [Fact]
    public void Descarta_una_tarjeta_sin_número_para_mostrar()
    {
        var json = """[{ "id": "x", "detail": { "intro": "algo" } }]""";

        Assert.Null(SharePayloadSanitizer.Sanitize(json));
    }

    [Theory]
    [InlineData("\"\"")]
    [InlineData("\"   \"")]
    [InlineData("null")]
    public void Descarta_una_tarjeta_sin_id(string idJson)
    {
        var json = $$"""[{ "id": {{idJson}}, "basic": { "value": "1", "label": "y" } }]""";

        Assert.Null(SharePayloadSanitizer.Sanitize(json));
    }

    [Fact]
    public void Mantiene_las_tarjetas_buenas_y_tira_las_inservibles()
    {
        var json = """
        [
          { "id": "buena", "basic": { "value": "1", "label": "y" } },
          { "id": "sin-stat", "detail": { "intro": "algo" } },
          { "id": "", "basic": { "value": "2", "label": "z" } }
        ]
        """;

        var cards = SharePayloadSanitizer.Sanitize(json)!;

        Assert.Equal(["buena"], cards.Select(card => card.Id));
    }

    // -----------------------------------------------------------------------
    // Serialización
    // -----------------------------------------------------------------------

    [Fact]
    public void Serializa_en_camelCase_como_espera_el_cliente()
    {
        var output = SerializeSanitized(FullCard);

        Assert.Contains("\"paginatedItemsLabel\"", output);
        Assert.DoesNotContain("\"PaginatedItemsLabel\"", output);
    }

    [Fact]
    public void No_escribe_las_propiedades_nulas()
    {
        var output = SharePayloadSanitizer.Serialize(
            SharePayloadSanitizer.Sanitize("""[{ "id": "x", "basic": { "value": "1", "label": "y" } }]""")!);

        Assert.DoesNotContain("null", output);
        Assert.DoesNotContain("\"detail\"", output);
    }

    [Fact]
    public void Lo_serializado_vuelve_a_pasar_intacto_por_el_saneador()
    {
        var once = SerializeSanitized(FullCard);
        var twice = SerializeSanitized(once);

        Assert.Equal(once, twice);
    }

    [Fact]
    public void Lo_serializado_es_JSON_válido()
    {
        using var document = JsonDocument.Parse(SerializeSanitized(FullCard));

        Assert.Equal(JsonValueKind.Array, document.RootElement.ValueKind);
    }
}
