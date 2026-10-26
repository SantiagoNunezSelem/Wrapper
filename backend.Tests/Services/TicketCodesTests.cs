using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// El código con el que se conoce un reporte. Lo que importa: que sea corto, que se pueda
/// leer en voz alta sin confusiones, que no pueda formar palabras y que no tenga orden.
/// </summary>
public sealed class TicketCodesTests
{
    [Fact]
    public void Un_codigo_tiene_seis_caracteres_del_alfabeto()
    {
        var code = TicketCodes.Generate();

        Assert.Equal(6, TicketCodes.Length);
        Assert.Equal(TicketCodes.Length, code.Length);
        Assert.All(code, character => Assert.Contains(character, TicketCodes.Alphabet));
    }

    [Fact]
    public void El_alfabeto_no_tiene_vocales_asi_que_ningun_codigo_puede_formar_una_palabra()
    {
        Assert.DoesNotContain(TicketCodes.Alphabet, character => "AEIOUY".Contains(character));
    }

    [Fact]
    public void El_alfabeto_no_tiene_caracteres_que_se_confundan_entre_si()
    {
        // 0/O y 1/I/L: en un celular, o dictados por teléfono, son el mismo.
        Assert.DoesNotContain(TicketCodes.Alphabet, character => "01OIL".Contains(character));
    }

    [Fact]
    public void El_alfabeto_son_27_simbolos_distintos_y_mayusculas()
    {
        Assert.Equal(27, TicketCodes.Alphabet.Length);
        Assert.Equal(TicketCodes.Alphabet.Length, TicketCodes.Alphabet.Distinct().Count());
        Assert.Equal(TicketCodes.Alphabet, TicketCodes.Alphabet.ToUpperInvariant());
    }

    [Fact]
    public void Los_codigos_no_siguen_ningun_orden_ni_se_repiten_seguidos()
    {
        // Doscientos de 387 millones posibles: un choque acá sería casi imposible (menos de 1 en 10 mil)
        // y señalaría un generador que repite o que sigue una secuencia.
        var codes = Enumerable.Range(0, 200).Select(_ => TicketCodes.Generate()).ToList();

        Assert.Equal(codes.Count, codes.Distinct().Count());
        Assert.NotEqual(codes.OrderBy(code => code, StringComparer.Ordinal), codes);
    }

    [Fact]
    public void Usa_todo_el_alfabeto_y_no_arranca_siempre_igual()
    {
        var codes = Enumerable.Range(0, 400).Select(_ => TicketCodes.Generate()).ToList();

        Assert.True(codes.Select(code => code[0]).Distinct().Count() > 10);
        Assert.Equal(TicketCodes.Alphabet.Length, codes.SelectMany(code => code).Distinct().Count());
    }
}
