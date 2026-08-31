using backend.Services;

namespace backend.Tests.Services;

/// <summary>
/// Qué métricas puede abrir un desbloqueo gratuito y cuántos hay por día.
///
/// Esta lista duplica a propósito el split de tiers del frontend
/// (<c>freeMetricEntries</c> en <c>lib/metrics.ts</c>): el navegador calcula todo
/// localmente, así que el servidor no tiene otra forma de saber qué id es gratis. El
/// test de abajo que enumera los 13 ids es el que hace ruidoso el desfasaje si alguien
/// cambia una métrica de tier en un solo lado.
/// </summary>
public class FreeMetricCatalogTests
{
    private static readonly string[] ExpectedFreeIds =
    [
        "spammer", "monologuista", "reloj", "jajaja", "emojis", "racha-dias", "testamento",
        "multimedia", "poliglota", "velocista", "heatmap-anual", "termometro", "arrepentido",
    ];

    private static readonly string[] VipIds =
    [
        "clavavistos", "inactividad", "wordcloud", "redflags", "rompehielo", "top-dias",
        "metralleta", "interrogador", "dramatico", "tonopicante", "curador",
    ];

    [Fact]
    public void El_limite_diario_es_cinco()
    {
        Assert.Equal(5, FreeMetricCatalog.DailyLimit);
    }

    [Theory]
    [MemberData(nameof(FreeIds))]
    public void Reconoce_las_metricas_gratis(string metricId)
    {
        Assert.True(FreeMetricCatalog.IsFreeMetric(metricId));
    }

    [Theory]
    [MemberData(nameof(PaidIds))]
    public void Rechaza_las_metricas_Pro(string metricId)
    {
        Assert.False(FreeMetricCatalog.IsFreeMetric(metricId));
    }

    [Fact]
    public void El_catalogo_tiene_exactamente_las_trece_metricas_gratis()
    {
        Assert.All(ExpectedFreeIds, id => Assert.True(FreeMetricCatalog.IsFreeMetric(id)));
        Assert.All(VipIds, id => Assert.False(FreeMetricCatalog.IsFreeMetric(id)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-existe")]
    public void Rechaza_lo_que_no_es_una_metrica(string? metricId)
    {
        Assert.False(FreeMetricCatalog.IsFreeMetric(metricId));
    }

    [Theory]
    [InlineData("Spammer")]
    [InlineData("SPAMMER")]
    [InlineData(" spammer")]
    public void La_comparacion_es_exacta_no_tolerante(string metricId)
    {
        // Se compara con StringComparer.Ordinal: nada de normalizar por las dudas, para
        // que un id que el cliente no manda tal cual no abra nada.
        Assert.False(FreeMetricCatalog.IsFreeMetric(metricId));
    }

    [Fact]
    public void La_clave_del_dia_es_la_fecha_UTC()
    {
        Assert.Equal("2025-03-10", FreeMetricCatalog.DayKey(new DateTime(2025, 3, 10, 23, 59, 59, DateTimeKind.Utc)));
        Assert.Equal("2025-03-11", FreeMetricCatalog.DayKey(new DateTime(2025, 3, 11, 0, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void La_clave_del_dia_usa_el_formato_invariante()
    {
        // Sin CultureInfo.InvariantCulture, un runner con cultura árabe o tailandesa
        // escribiría otro calendario y la clave dejaría de coincidir con las guardadas.
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", FreeMetricCatalog.DayKey(new DateTime(2025, 1, 5, 12, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void El_saldo_se_repone_a_la_medianoche_UTC_siguiente()
    {
        var reset = FreeMetricCatalog.NextResetUtc(new DateTime(2025, 3, 10, 14, 30, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2025, 3, 11, 0, 0, 0), reset);
    }

    [Fact]
    public void Un_minuto_antes_de_medianoche_el_reset_sigue_siendo_manana()
    {
        var reset = FreeMetricCatalog.NextResetUtc(new DateTime(2025, 3, 10, 23, 59, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2025, 3, 11, 0, 0, 0), reset);
    }

    [Fact]
    public void El_reset_siempre_esta_en_el_futuro()
    {
        var now = DateTime.UtcNow;

        Assert.True(FreeMetricCatalog.NextResetUtc(now) > now);
    }

    public static TheoryData<string> FreeIds()
    {
        var data = new TheoryData<string>();
        foreach (var id in ExpectedFreeIds)
        {
            data.Add(id);
        }
        return data;
    }

    public static TheoryData<string> PaidIds()
    {
        var data = new TheoryData<string>();
        foreach (var id in VipIds)
        {
            data.Add(id);
        }
        return data;
    }
}
