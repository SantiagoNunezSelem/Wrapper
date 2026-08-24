using backend.Data;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Data;

/// <summary>
/// El proyecto usa <c>EnsureCreatedAsync</c> en vez de migraciones, y eso NO agrega
/// columnas a una base que ya existe. Estos parches idempotentes son lo único que
/// mantiene actualizada la <c>wrapper-crm.db</c> de un usuario sin borrarle sus
/// análisis guardados — así que lo que hay que probar es justamente que se puedan
/// aplicar dos veces sin romper nada.
/// </summary>
public class SchemaUpgradesTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();

    public void Dispose() => _db.Dispose();

    private async Task<HashSet<string>> ColumnsOf(string table)
    {
        var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var connection = _db.Context.Database.GetDbConnection();

        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }

        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info(\"{table}\");";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            columns.Add(reader.GetString(1));
        }

        return columns;
    }

    [Fact]
    public async Task Se_aplica_sobre_un_esquema_recien_creado_sin_romper()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);
    }

    [Fact]
    public async Task Es_idempotente_correrlo_dos_veces_no_falla()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);
        await SchemaUpgrades.ApplyAsync(_db.Context);
    }

    [Fact]
    public async Task No_borra_los_datos_que_ya_estaban()
    {
        var user = new backend.Models.User { Email = "ana@example.com", DisplayName = "Ana" };
        _db.Context.Users.Add(user);
        _db.Context.Analyses.Add(new backend.Models.SavedAnalysis
        {
            UserId = user.Id,
            ChatName = "Grupo",
            ResultsJson = "{}",
            SourceHash = new string('a', 64),
        });
        await _db.Context.SaveChangesAsync();

        await SchemaUpgrades.ApplyAsync(_db.Context);

        Assert.Equal(1, await _db.NewContext().Analyses.CountAsync());
        Assert.Equal(1, await _db.NewContext().Users.CountAsync());
    }

    [Fact]
    public async Task Deja_la_columna_de_consentimiento_de_IA_en_Users()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);

        Assert.Contains("AiConsentAtUtc", await ColumnsOf("Users"));
    }

    [Theory]
    [InlineData("ExternalPlanId")]
    [InlineData("ExternalPayerId")]
    [InlineData("Amount")]
    [InlineData("CurrencyId")]
    [InlineData("PaymentMethodLabel")]
    [InlineData("LastPaymentAtUtc")]
    [InlineData("GraceEndsAtUtc")]
    public async Task Deja_las_columnas_de_Mercado_Pago_en_Subscriptions(string column)
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);

        Assert.Contains(column, await ColumnsOf("Subscriptions"));
    }

    [Fact]
    public async Task Deja_la_tabla_de_veredictos_de_IA()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);

        var columns = await ColumnsOf("AiMetricResults");
        Assert.Contains("SourceHash", columns);
        Assert.Contains("MetricId", columns);
        Assert.Contains("InputHash", columns);
        Assert.Contains("Status", columns);
    }

    [Fact]
    public async Task El_esquema_sigue_siendo_usable_por_EF_despues_del_parche()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);

        var context = _db.NewContext();
        var user = new backend.Models.User { Email = "beto@example.com", DisplayName = "Beto" };
        context.Users.Add(user);
        context.AiMetricResults.Add(new backend.Models.AiMetricResult
        {
            UserId = user.Id,
            SourceHash = "abc",
            MetricId = "redflags",
            Status = backend.Models.AiMetricStatus.Ready,
            ResultJson = "[]",
        });
        await context.SaveChangesAsync();

        Assert.Equal(1, await _db.NewContext().AiMetricResults.CountAsync());
    }
}
