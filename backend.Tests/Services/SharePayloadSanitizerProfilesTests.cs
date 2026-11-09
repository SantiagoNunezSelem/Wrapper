using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// Las personalidades son el único lugar donde una tarjeta publicada lleva prosa escrita por
/// un modelo sobre una persona con nombre. El dueño decidió compartir la tarjeta completa, así
/// que lo que se defiende acá es lo que sí se puede: que el perfil se RECONSTRUYA campo por
/// campo —la etiqueta tiene que ser de la lista cerrada, todo texto tiene tope, los números
/// se acotan— y que un resumen con datos de contacto no llegue a una URL sin sesión.
/// </summary>
public class SharePayloadSanitizerProfilesTests
{
    private static string Card(string profilesJson) => $$"""
    [{
      "id": "personalidades",
      "title": "La personalidad de cada integrante",
      "description": "Quién es quién",
      "tier": "vip",
      "accent": "tier-violet",
      "basic": { "value": "Bromista", "label": "la personalidad de Ana" },
      "detail": { "intro": "Cada integrante.", "profiles": {{profilesJson}} }
    }]
    """;

    private static string Profile(
        string name = "Ana",
        string labelId = "bromista",
        string summary = "Se ríe de todo y arranca la mayoría de las charlas con apodos.",
        string extras = "") => $$"""
    {
      "name": "{{name}}", "color": "hsl(210, 70%, 50%)",
      "labelId": "{{labelId}}", "label": "Bromista",
      "summary": "{{summary}}", "source": "ai", "messageCount": 812,
      "radar": [{ "axis": "Presencia", "value": 64 }, { "axis": "Iniciativa", "value": 31 }]
      {{extras}}
    }
    """;

    private static IReadOnlyList<SharedProfile> Profiles(string profilesJson) =>
        SharePayloadSanitizer.Sanitize(Card(profilesJson))![0].Detail!.Profiles!;

    // -----------------------------------------------------------------------
    // Lo que se conserva
    // -----------------------------------------------------------------------

    [Fact]
    public void Conserva_un_perfil_bien_formado_completo()
    {
        var profile = Assert.Single(Profiles($"[{Profile()}]"));

        Assert.Equal("Ana", profile.Name);
        Assert.Equal("bromista", profile.LabelId);
        Assert.Equal("Bromista", profile.Label);
        Assert.Equal("Se ríe de todo y arranca la mayoría de las charlas con apodos.", profile.Summary);
        Assert.Equal("ai", profile.Source);
        Assert.Equal(812, profile.MessageCount);
        Assert.Equal("hsl(210, 70%, 50%)", profile.Color);
        Assert.Equal(["Presencia", "Iniciativa"], profile.Radar!.Select(axis => axis.Axis));
        Assert.Equal([64d, 31d], profile.Radar!.Select(axis => axis.Value));
    }

    [Fact]
    public void Sin_perfiles_el_campo_no_aparece_en_lo_publicado()
    {
        var cards = SharePayloadSanitizer.Sanitize("""
        [{ "id": "x", "basic": { "value": "1", "label": "y" }, "detail": { "intro": "z" } }]
        """)!;

        Assert.Null(cards[0].Detail!.Profiles);
        Assert.DoesNotContain("profiles", SharePayloadSanitizer.Serialize(cards));
    }

    [Fact]
    public void Normaliza_la_etiqueta_con_acento_y_mayúsculas()
    {
        var profile = Assert.Single(Profiles($"[{Profile(labelId: "Tímido")}]"));

        Assert.Equal("timido", profile.LabelId);
    }

    [Fact]
    public void La_segunda_etiqueta_se_conserva_si_es_de_la_lista_y_distinta_de_la_primera()
    {
        var kept = Assert.Single(Profiles($"""[{Profile(extras: ", \"secondaryLabelId\": \"intenso\", \"secondaryLabel\": \"Intenso\"")}]"""));
        var same = Assert.Single(Profiles($"""[{Profile(extras: ", \"secondaryLabelId\": \"bromista\", \"secondaryLabel\": \"Bromista\"")}]"""));
        var unknown = Assert.Single(Profiles($"""[{Profile(extras: ", \"secondaryLabelId\": \"tóxico\", \"secondaryLabel\": \"Tóxico\"")}]"""));

        Assert.Equal("intenso", kept.SecondaryLabelId);
        Assert.Equal("Intenso", kept.SecondaryLabel);
        Assert.Null(same.SecondaryLabelId);
        Assert.Null(same.SecondaryLabel);
        Assert.Null(unknown.SecondaryLabelId);
        Assert.Null(unknown.SecondaryLabel);
    }

    // -----------------------------------------------------------------------
    // Lo que se descarta
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("tóxico")]
    [InlineData("narcisista")]
    [InlineData("")]
    public void Descarta_el_perfil_entero_si_la_etiqueta_no_es_de_la_lista_cerrada(string labelId)
    {
        var profiles = Profiles($"[{Profile(labelId: labelId)}, {Profile(name: "Beto", labelId: "seco")}]");

        // Un perfil a medias no se publica: queda el otro, entero.
        var kept = Assert.Single(profiles);
        Assert.Equal("Beto", kept.Name);
    }

    [Fact]
    public void Descarta_el_perfil_sin_nombre()
    {
        Assert.Empty(Profiles($"[{Profile(name: "   ")}]"));
    }

    [Theory]
    [InlineData("Mirá https://ejemplo.com/ana para ver como escribe en este chat de amigos.")]
    [InlineData("Escribile a ana@ejemplo.com para ver como responde en este chat de amigos.")]
    [InlineData("Llamala al +54 9 11 5555 1234 y vas a ver que contesta rápido a cualquier hora.")]
    public void Vacía_el_resumen_que_trae_un_link_un_mail_o_un_teléfono_sin_tirar_el_perfil(string summary)
    {
        var profile = Assert.Single(Profiles($"[{Profile(summary: summary)}]"));

        Assert.Equal(string.Empty, profile.Summary);
        Assert.Equal("bromista", profile.LabelId);
    }

    [Fact]
    public void Un_color_que_podría_inyectar_estilo_se_descarta()
    {
        var profile = Assert.Single(Profiles($"[{Profile().Replace("hsl(210, 70%, 50%)", "red; background:url(x)")}]"));

        Assert.Null(profile.Color);
    }

    [Fact]
    public void Una_fuente_desconocida_se_publica_como_local()
    {
        var profile = Assert.Single(Profiles($"[{Profile().Replace("\"ai\"", "\"oracle\"")}]"));

        Assert.Equal("local", profile.Source);
    }

    // -----------------------------------------------------------------------
    // Topes
    // -----------------------------------------------------------------------

    [Fact]
    public void Recorta_el_nombre_el_resumen_y_la_etiqueta_a_sus_topes()
    {
        var profile = Assert.Single(Profiles($"[{Profile(name: new string('N', 300), summary: new string('s', 5000))}]"));

        Assert.Equal(80, profile.Name.Length);
        Assert.Equal(600, profile.Summary.Length);
    }

    [Fact]
    public void Publica_a_lo_sumo_doce_perfiles()
    {
        var many = string.Join(',', Enumerable.Range(0, 30).Select(index => Profile(name: $"Persona {index}")));

        Assert.Equal(12, Profiles($"[{many}]").Count);
    }

    [Fact]
    public void Acota_los_ejes_del_radar_su_cantidad_su_nombre_y_su_valor()
    {
        var axes = string.Join(',', Enumerable.Range(0, 12).Select(index => $$"""{ "axis": "Eje {{index}}", "value": {{index * 400}} }"""));
        var json = Profile().Replace(
            "\"radar\": [{ \"axis\": \"Presencia\", \"value\": 64 }, { \"axis\": \"Iniciativa\", \"value\": 31 }]",
            $"\"radar\": [{{ \"axis\": \"   \", \"value\": 5 }}, {axes}]");

        var profile = Assert.Single(Profiles($"[{json}]"));

        // El eje sin nombre se va; de los doce restantes quedan ocho, con el valor tope.
        Assert.Equal(8, profile.Radar!.Count);
        Assert.All(profile.Radar, axis => Assert.InRange(axis.Value, 0, 1000));
        Assert.DoesNotContain(profile.Radar, axis => string.IsNullOrWhiteSpace(axis.Axis));
    }

    [Fact]
    public void Acota_la_cantidad_de_mensajes_a_un_rango_razonable()
    {
        var huge = Assert.Single(Profiles($"[{Profile().Replace("812", "2000000000")}]"));
        var negative = Assert.Single(Profiles($"[{Profile().Replace("812", "-5")}]"));

        Assert.Equal(10_000_000, huge.MessageCount);
        Assert.Equal(0, negative.MessageCount);
    }

    // -----------------------------------------------------------------------
    // El perfil se reconstruye, no se filtra
    // -----------------------------------------------------------------------

    [Fact]
    public void Un_campo_que_el_modelo_no_conoce_desaparece_por_construccion()
    {
        var output = SharePayloadSanitizer.Serialize(SharePayloadSanitizer.Sanitize(
            Card($"[{Profile(extras: ", \"sampleMessages\": [\"che te queria contar algo\"], \"campoInventado\": \"secreto\"")}]"))!);

        Assert.DoesNotContain("sampleMessages", output);
        Assert.DoesNotContain("che te queria contar", output);
        Assert.DoesNotContain("secreto", output);
    }

    [Fact]
    public void Una_lista_de_perfiles_vacia_sale_como_lista_vacia_no_como_nula()
    {
        var output = Profiles("[]");

        Assert.Empty(output);
    }
}
