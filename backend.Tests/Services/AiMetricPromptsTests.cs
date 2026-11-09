using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// Las instrucciones viven en el servidor y el cliente sólo puede nombrar una métrica.
/// Es lo que impide que un usuario Pro convierta el endpoint en un proxy general de
/// Gemini pagado con nuestra key.
/// </summary>
public class AiMetricPromptsTests
{
    [Theory]
    [InlineData("tonopicante")]
    [InlineData("redflags")]
    public void Sólo_hay_dos_métricas_soportadas(string metricId)
    {
        Assert.True(AiMetricPrompts.IsSupported(metricId));
    }

    [Theory]
    [InlineData("spammer")]
    [InlineData("TONOPICANTE")]
    [InlineData("")]
    [InlineData("cualquier-cosa")]
    public void Rechaza_cualquier_otro_id(string metricId)
    {
        Assert.False(AiMetricPrompts.IsSupported(metricId));
    }

    [Fact]
    public void La_lista_publicada_coincide_con_lo_soportado()
    {
        Assert.Equal(["tonopicante", "redflags"], AiMetricPrompts.SupportedMetricIds);
        Assert.All(AiMetricPrompts.SupportedMetricIds, id => Assert.True(AiMetricPrompts.IsSupported(id)));
    }

    [Fact]
    public void Un_id_no_soportado_no_produce_prompt_sino_excepción()
    {
        // Nunca un prompt vacío ni uno "por defecto": si llega acá algo raro, revienta.
        Assert.Throws<ArgumentOutOfRangeException>(() => AiMetricPrompts.SystemInstruction("spammer"));
    }

    [Theory]
    [InlineData("tonopicante")]
    [InlineData("redflags")]
    public void Cada_instrucción_describe_el_formato_de_ida_y_de_vuelta(string metricId)
    {
        var instruction = AiMetricPrompts.SystemInstruction(metricId);

        Assert.Contains("#N", instruction);
        Assert.Contains("\"*\"", instruction);
        Assert.Contains("Ante la duda, excluí.", instruction);
    }

    [Fact]
    public void Las_dos_instrucciones_dicen_cosas_distintas()
    {
        Assert.NotEqual(
            AiMetricPrompts.SystemInstruction("tonopicante"),
            AiMetricPrompts.SystemInstruction("redflags"));
    }

    [Fact]
    public void La_instrucción_picante_nombra_los_falsos_positivos_típicos()
    {
        var instruction = AiMetricPrompts.SystemInstruction("tonopicante");

        Assert.Contains("la comida estaba", instruction);
        Assert.Contains("Excluí", instruction);
    }

    [Fact]
    public void La_instrucción_de_red_flags_excluye_la_broma_entre_amigos()
    {
        var instruction = AiMetricPrompts.SystemInstruction("redflags");

        Assert.Contains("broma o sarcasmo entre amigos", instruction);
    }

    [Fact]
    public void La_instrucción_de_red_flags_explica_el_uso_de_paréntesis_interrogación_como_ironía()
    {
        var instruction = AiMetricPrompts.SystemInstruction("redflags");

        Assert.Contains("\"(?\"", instruction);
        Assert.Contains("ironía", instruction);
    }

    [Fact]
    public void La_instrucción_de_red_flags_nombra_la_manipulación_además_del_conflicto()
    {
        var instruction = AiMetricPrompts.SystemInstruction("redflags");

        foreach (var kind in new[] { "chantaje emocional", "gaslighting", "aislamiento", "presión o coerción", "celos o control" })
        {
            Assert.Contains(kind, instruction);
        }
    }

    // -----------------------------------------------------------------------
    // Pareja o grupo
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(2, ChatBond.Pair)]
    [InlineData(3, ChatBond.Group)]
    [InlineData(1, ChatBond.Group)]
    [InlineData(null, ChatBond.Group)]
    public void Dos_participantes_son_una_pareja_y_todo_lo_demás_un_grupo(int? participants, ChatBond expected)
    {
        Assert.Equal(expected, AiMetricPrompts.BondFor(participants));
    }

    [Theory]
    [InlineData("redflags")]
    [InlineData("redflags-scan-1")]
    public void Entre_dos_personas_los_celos_y_el_chantaje_no_se_toman_como_broma(string metricId)
    {
        var pair = AiMetricPrompts.SystemInstruction(metricId, ChatBond.Pair);
        var group = AiMetricPrompts.SystemInstruction(metricId, ChatBond.Group);

        Assert.Contains("entre dos personas", pair);
        Assert.DoesNotContain("entre dos personas", group);
        Assert.Contains("El chat es un grupo", group);
        Assert.DoesNotContain("El chat es un grupo", pair);
    }

    [Fact]
    public void Sin_decir_nada_la_instrucción_es_la_del_grupo()
    {
        Assert.Equal(
            AiMetricPrompts.SystemInstruction("redflags", ChatBond.Group),
            AiMetricPrompts.SystemInstruction("redflags"));
    }

    [Fact]
    public void El_tono_picante_no_cambia_según_el_vínculo()
    {
        Assert.Equal(
            AiMetricPrompts.SystemInstruction("tonopicante", ChatBond.Pair),
            AiMetricPrompts.SystemInstruction("tonopicante", ChatBond.Group));
    }

    // -----------------------------------------------------------------------
    // La lectura
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("redflags-scan-1", true, 1)]
    [InlineData("redflags-scan-8", true, 8)]
    [InlineData("redflags-scan-0", false, 0)]
    [InlineData("redflags-scan-9", false, 0)]
    [InlineData("redflags-scan-", false, 0)]
    [InlineData("redflags-scan-x", false, 0)]
    [InlineData("redflags-scan--1", false, 0)]
    [InlineData("redflags", false, 0)]
    [InlineData("REDFLAGS-SCAN-1", false, 0)]
    public void Las_partes_de_la_lectura_se_reconocen_por_su_número(string metricId, bool isScan, int part)
    {
        Assert.Equal(isScan, AiMetricPrompts.IsScan(metricId));
        Assert.Equal(isScan, AiMetricPrompts.TryGetScanPart(metricId, out var found));
        Assert.Equal(part, found);
    }

    [Fact]
    public void Una_parte_de_la_lectura_es_soportada_pero_no_es_una_tarjeta()
    {
        Assert.True(AiMetricPrompts.IsSupported("redflags-scan-3"));
        Assert.DoesNotContain("redflags-scan-3", AiMetricPrompts.SupportedMetricIds);
    }

    [Fact]
    public void La_lectura_tiene_su_propia_instrucción_con_los_nueve_códigos()
    {
        var instruction = AiMetricPrompts.SystemInstruction("redflags-scan-2");

        Assert.NotEqual(AiMetricPrompts.SystemInstruction("redflags"), instruction);
        Assert.Contains("número:código", instruction);
        Assert.Contains("Ante la duda, excluí.", instruction);

        foreach (var code in AiMetricPrompts.ScanCodes)
        {
            Assert.Contains($"{code} =", instruction);
        }

        Assert.Equal(9, AiMetricPrompts.ScanCodes.Count);
    }

    [Fact]
    public void Todas_las_partes_de_la_lectura_comparten_la_misma_instrucción()
    {
        Assert.Equal(
            AiMetricPrompts.SystemInstruction("redflags-scan-1"),
            AiMetricPrompts.SystemInstruction("redflags-scan-4"));
    }

    // -----------------------------------------------------------------------
    // Renderizado del lote
    // -----------------------------------------------------------------------

    [Fact]
    public void Renderiza_un_fragmento_con_su_id_y_su_palabra_clave()
    {
        var rendered = AiMetricPrompts.RenderBatch([new AiSnippetInput("1", "caliente", "A: hola\n*B: que caliente")]);

        Assert.Equal("#1 [caliente]\nA: hola\n*B: que caliente", rendered);
    }

    [Fact]
    public void Omite_los_corchetes_cuando_no_hay_palabra_clave()
    {
        var rendered = AiMetricPrompts.RenderBatch([new AiSnippetInput("1", "", "*A: texto")]);

        Assert.Equal("#1\n*A: texto", rendered);
    }

    [Fact]
    public void Separa_los_fragmentos_con_una_línea_en_blanco()
    {
        var rendered = AiMetricPrompts.RenderBatch(
        [
            new AiSnippetInput("1", "a", "*A: uno"),
            new AiSnippetInput("2", "b", "*A: dos"),
        ]);

        Assert.Equal("#1 [a]\n*A: uno\n\n#2 [b]\n*A: dos", rendered);
    }

    [Fact]
    public void No_deja_líneas_en_blanco_al_final()
    {
        var rendered = AiMetricPrompts.RenderBatch([new AiSnippetInput("1", "a", "*A: uno")]);

        Assert.Equal(rendered.TrimEnd(), rendered);
    }

    [Fact]
    public void Recorta_los_espacios_del_texto_del_fragmento()
    {
        var rendered = AiMetricPrompts.RenderBatch([new AiSnippetInput("1", "a", "  *A: uno  \n")]);

        Assert.Equal("#1 [a]\n*A: uno", rendered);
    }

    [Fact]
    public void Un_lote_vacío_produce_un_texto_vacío()
    {
        Assert.Equal("", AiMetricPrompts.RenderBatch([]));
    }
}
