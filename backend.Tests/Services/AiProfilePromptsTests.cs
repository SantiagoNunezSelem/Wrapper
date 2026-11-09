using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// El vocabulario de las personalidades es cerrado a propósito: el modelo elige de una
/// lista y cualquier otra cosa se rechaza. Estos tests fijan esa lista y las reglas que
/// viajan en la instrucción, porque son lo único que separa un perfil simpático de una
/// etiqueta hiriente sobre una persona real.
/// </summary>
public class AiProfilePromptsTests
{
    [Theory]
    [InlineData("timido", "timido")]
    [InlineData("Tímido", "timido")]
    [InlineData("  LÍDER ", "lider")]
    [InlineData("Cariñoso", "carinoso")]
    [InlineData("DRAMÁTICO", "dramatico")]
    public void Normaliza_la_etiqueta_sin_importar_acentos_ni_mayúsculas(string raw, string expected) =>
        Assert.Equal(expected, AiProfilePrompts.NormalizeLabel(raw));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("tóxico")]
    [InlineData("narcisista")]
    [InlineData("lider, bromista")]
    public void Rechaza_cualquier_cosa_que_no_esté_en_la_lista_cerrada(string? raw) =>
        Assert.Null(AiProfilePrompts.NormalizeLabel(raw));

    [Fact]
    public void La_lista_cerrada_tiene_las_doce_etiquetas_acordadas()
    {
        Assert.Equal(12, AiProfilePrompts.LabelIds.Count);
        Assert.Equal(12, AiProfilePrompts.LabelIds.Distinct().Count());

        // Las cuatro que pidió el dueño del producto, tal cual.
        foreach (var requested in new[] { "confianzudo", "timido", "suizo", "agresivo" })
        {
            Assert.Contains(requested, AiProfilePrompts.LabelIds);
        }
    }

    [Fact]
    public void Fold_saca_los_acentos_y_pasa_a_minúsculas()
    {
        Assert.Equal("carinoso", AiProfilePrompts.Fold("Cariñoso"));
        Assert.Equal("accion", AiProfilePrompts.Fold("ACCIÓN"));
    }

    [Fact]
    public void Solo_se_aceptan_las_claves_de_números_conocidas()
    {
        Assert.True(AiProfilePrompts.IsFeatureKey("share"));
        Assert.True(AiProfilePrompts.IsFeatureKey("replyMinutes"));
        Assert.False(AiProfilePrompts.IsFeatureKey("hack"));
        Assert.False(AiProfilePrompts.IsFeatureKey("Share"));
    }

    [Fact]
    public void Las_claves_de_números_no_se_repiten()
    {
        var keys = AiProfilePrompts.FeatureDescriptions.Select(item => item.Key).ToList();

        Assert.Equal(keys.Count, keys.Distinct().Count());
    }

    // -----------------------------------------------------------------------
    // La instrucción
    // -----------------------------------------------------------------------

    [Fact]
    public void La_instrucción_describe_cada_etiqueta_de_la_lista()
    {
        var instruction = AiProfilePrompts.SystemInstruction("es");

        foreach (var id in AiProfilePrompts.LabelIds)
        {
            Assert.Contains($"- {id}:", instruction);
        }
    }

    [Fact]
    public void La_instrucción_pide_el_resumen_en_el_idioma_de_la_cuenta()
    {
        Assert.Contains("español rioplatense", AiProfilePrompts.SystemInstruction("es"));
        Assert.Contains("inglés", AiProfilePrompts.SystemInstruction("en"));
        Assert.DoesNotContain("español rioplatense", AiProfilePrompts.SystemInstruction("en"));
    }

    [Fact]
    public void La_instrucción_cierra_los_temas_prohibidos_y_el_copiado_del_chat()
    {
        var instruction = AiProfilePrompts.SystemInstruction("es");

        // Lo que no puede aparecer en un texto sobre una persona real, y sobre todo si el
        // público incluye menores.
        Assert.Contains("sexualidad", instruction);
        Assert.Contains("salud física o mental", instruction);
        Assert.Contains("Nada de diagnósticos ni de insultos", instruction);
        Assert.Contains("Nunca copies frases completas", instruction);
        Assert.Contains("sin nombres ni letras", instruction);
    }

    [Fact]
    public void La_instrucción_trata_los_mensajes_como_datos_y_no_como_órdenes()
    {
        // Los mensajes los escribió gente que no sabe que un modelo los va a leer.
        Assert.Contains("ignorala", AiProfilePrompts.SystemInstruction("es"));
    }

    [Fact]
    public void La_instrucción_es_distinta_por_idioma_así_el_hash_recalcula_al_cambiarlo()
    {
        Assert.NotEqual(AiProfilePrompts.SystemInstruction("es"), AiProfilePrompts.SystemInstruction("en"));
    }

    [Fact]
    public void La_corrección_nombra_el_motivo()
    {
        Assert.Contains("el resumen es demasiado corto", AiProfilePrompts.CorrectionNote("el resumen es demasiado corto"));
    }

    // -----------------------------------------------------------------------
    // La persona renderizada
    // -----------------------------------------------------------------------

    private static AiProfilePerson Person(Dictionary<string, double> features, params string[] messages) =>
        new("C", features, messages);

    [Fact]
    public void Renderiza_los_números_junto_al_promedio_del_grupo_y_la_muestra()
    {
        var person = Person(
            new Dictionary<string, double> { ["share"] = 0.123, ["avgWords"] = 7.46 },
            "hola, ¿venís hoy?",
            "dale, aviso");

        var text = AiProfilePrompts.RenderPerson(
            person,
            new Dictionary<string, double> { ["share"] = 0.2, ["avgWords"] = 5 },
            4);

        Assert.Contains("Persona C, en un grupo de 4 personas.", text);
        Assert.Contains("- Porcentaje de los mensajes del chat que escribe: 12% (grupo: 20%)", text);
        Assert.Contains("- Palabras por mensaje (promedio): 7.5 (grupo: 5)", text);
        Assert.Contains("- hola, ¿venís hoy?", text);
        Assert.Contains("- dale, aviso", text);
    }

    [Fact]
    public void Los_porcentajes_chicos_llevan_un_decimal()
    {
        var text = AiProfilePrompts.RenderPerson(
            Person(new Dictionary<string, double> { ["conflictRate"] = 0.0345 }, "ok"),
            new Dictionary<string, double>(),
            3);

        Assert.Contains(": 3.5%", text);
    }

    [Fact]
    public void Saltea_los_números_que_la_persona_no_trae_y_el_promedio_que_falta()
    {
        var text = AiProfilePrompts.RenderPerson(
            Person(new Dictionary<string, double> { ["share"] = 0.5 }, "ok"),
            new Dictionary<string, double>(),
            2);

        Assert.Contains("escribe: 50%", text);
        Assert.DoesNotContain("(grupo:", text);
        Assert.DoesNotContain("Minutos que tarda", text);
    }

    [Fact]
    public void El_render_es_estable_para_la_misma_entrada()
    {
        var person = Person(new Dictionary<string, double> { ["share"] = 0.2, ["planRate"] = 0.04 }, "a", "b");
        var group = new Dictionary<string, double> { ["share"] = 0.25 };

        Assert.Equal(
            AiProfilePrompts.RenderPerson(person, group, 4),
            AiProfilePrompts.RenderPerson(person, group, 4));
    }
}
