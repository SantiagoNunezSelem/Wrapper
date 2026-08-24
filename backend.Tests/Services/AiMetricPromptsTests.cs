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
