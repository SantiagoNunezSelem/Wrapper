using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// El piso de seguridad de Gemini puede rechazar un lote de "tonopicante" solo por la
/// densidad de vocabulario crudo, aun con los 4 safetySettings en BLOCK_NONE. Estos tests
/// verifican que el reemplazo mantenga el significado (mismo referente, palabra más
/// suave) sin tocar texto que no está en el diccionario.
/// </summary>
public class TonoPicanteVocabularyTests
{
    [Theory]
    [InlineData("verga", "miembro")]
    [InlineData("culo", "trasero")]
    [InlineData("tetas", "bustos")]
    [InlineData("concha", "zona íntima")]
    [InlineData("puta", "provocadora")]
    [InlineData("follar", "intimar")]
    [InlineData("pussy", "intimate area")]
    [InlineData("boobs", "chest")]
    public void Reemplaza_la_palabra_cruda_por_su_sinonimo(string crudo, string suave)
    {
        var snippet = new AiSnippetInput("1", crudo, $"*A: qué {crudo} tenés");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal($"*A: qué {suave} tenés", softened.Text);
        Assert.Equal(suave, softened.Keyword);
    }

    [Fact]
    public void Preserva_la_mayuscula_inicial()
    {
        var snippet = new AiSnippetInput("1", "Culo", "*A: Culo bonito");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal("*A: Trasero bonito", softened.Text);
    }

    [Fact]
    public void No_toca_palabras_fuera_del_diccionario()
    {
        var snippet = new AiSnippetInput("1", "caliente", "*A: hoy hace mucho calor y estoy re caliente");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal(snippet.Text, softened.Text);
        Assert.Equal(snippet.Keyword, softened.Keyword);
    }

    [Fact]
    public void No_reemplaza_dentro_de_otra_palabra()
    {
        // "orto" no debe dispararse dentro de "ortodoncia".
        var snippet = new AiSnippetInput("1", "ortodoncia", "*A: tengo turno con la ortodoncista");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal(snippet.Text, softened.Text);
    }

    [Fact]
    public void Reemplaza_mas_de_una_palabra_en_el_mismo_mensaje()
    {
        var snippet = new AiSnippetInput("1", "verga", "*A: quiero ver tu verga y tu culo ya");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal("*A: quiero ver tu miembro y tu trasero ya", softened.Text);
    }

    [Fact]
    public void Un_texto_vacio_queda_vacio()
    {
        var snippet = new AiSnippetInput("1", "", "");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal("", softened.Text);
        Assert.Equal("", softened.Keyword);
    }

    [Fact]
    public void El_id_nunca_cambia()
    {
        var snippet = new AiSnippetInput("42", "sexo", "*A: sexo");

        var softened = TonoPicanteVocabulary.Soften(snippet);

        Assert.Equal("42", softened.Id);
    }
}
