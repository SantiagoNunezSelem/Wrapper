using backend.Data;
using backend.Services;
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
    public async Task Deja_las_columnas_de_terminos_en_Users()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);

        var columns = await ColumnsOf("Users");
        Assert.Contains("TermsVersion", columns);
        Assert.Contains("TermsAcceptedAtUtc", columns);
    }

    [Fact]
    public async Task Crea_la_tabla_de_reportes_en_una_base_que_no_la_tenia_y_EF_puede_usarla()
    {
        // Una base de antes de la página de ayuda: la tabla no existe.
        await _db.Context.Database.ExecuteSqlRawAsync("""DROP TABLE "SupportReports";""");

        await SchemaUpgrades.ApplyAsync(_db.Context);

        var context = _db.NewContext();
        var user = new backend.Models.User { Email = "caro@example.com", DisplayName = "Caro" };
        context.Users.Add(user);
        context.SupportReports.Add(new backend.Models.SupportReport
        {
            UserId = user.Id,
            ContactEmail = "caro@example.com",
            Category = backend.Models.SupportReportCategories.Payments,
            Description = "Pagué y sigo sin Pro.",
        });
        await context.SaveChangesAsync();

        Assert.Equal(1, await _db.NewContext().SupportReports.CountAsync());
    }

    /// <summary>
    /// Las dos formas viejas que puede tener la tabla en una base de desarrollo: la de antes de
    /// que existieran los reportes con identificador, y la de una versión intermedia de esta
    /// misma rama que los numeraba 1, 2, 3… con una columna y un índice único propios.
    /// </summary>
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Le_da_un_codigo_a_los_reportes_de_una_tabla_vieja_y_quita_el_numero_de_la_version_intermedia(bool withTicketNumber)
    {
        var userId = Guid.NewGuid().ToString().ToUpperInvariant();
        await _db.Context.Database.ExecuteSqlRawAsync("""DROP TABLE "SupportReports";""");
        await _db.Context.Database.ExecuteSqlRawAsync(
            $"""
            CREATE TABLE "SupportReports" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SupportReports" PRIMARY KEY,
                {(withTicketNumber ? "\"TicketNumber\" INTEGER NOT NULL DEFAULT 0," : "")}
                "UserId" TEXT NOT NULL,
                "ContactEmail" TEXT NULL, "Category" TEXT NULL, "Description" TEXT NULL,
                "UserAgent" TEXT NULL, "Viewport" TEXT NULL, "Language" TEXT NULL,
                "SubscriptionState" TEXT NULL, "Status" TEXT NULL,
                "CreatedAtUtc" TEXT NOT NULL, "ResolvedAtUtc" TEXT NULL, "ResolvedByEmail" TEXT NULL
            );
            """);

        if (withTicketNumber)
        {
            await _db.Context.Database.ExecuteSqlRawAsync(
                """CREATE UNIQUE INDEX "IX_SupportReports_TicketNumber" ON "SupportReports" ("TicketNumber");""");
        }

        var numberColumn = withTicketNumber ? ", \"TicketNumber\"" : "";
        string Number(int value) => withTicketNumber ? $", {value}" : "";

        await _db.Context.Database.ExecuteSqlRawAsync(
            $"""
            INSERT INTO "Users" ("Id", "Email", "DisplayName", "PreferredLanguage", "IsAdmin", "HasUsedTrial", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES ('{userId}', 'vieja@example.com', 'Vieja', 'es', 0, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
            INSERT INTO "SupportReports" ("Id", "UserId", "ContactEmail", "Category", "Description", "Status", "CreatedAtUtc"{numberColumn}) VALUES
                ('B0000000-0000-0000-0000-000000000002', '{userId}', 'a@example.com', 'otro', 'segundo', 'nuevo', '2026-03-02 10:00:00'{Number(2)}),
                ('A0000000-0000-0000-0000-000000000001', '{userId}', 'a@example.com', 'otro', 'primero', 'nuevo', '2026-03-01 10:00:00'{Number(1)}),
                ('C0000000-0000-0000-0000-000000000003', '{userId}', 'a@example.com', 'otro', 'tercero', 'nuevo', '2026-03-03 10:00:00'{Number(3)});
            """);

        await SchemaUpgrades.ApplyAsync(_db.Context);
        var afterFirst = await _db.NewContext().SupportReports.OrderBy(item => item.CreatedAtUtc).ToListAsync();
        // Y una segunda vez: no vuelve a repartir códigos ni a fallar.
        await SchemaUpgrades.ApplyAsync(_db.Context);
        var afterSecond = await _db.NewContext().SupportReports.OrderBy(item => item.CreatedAtUtc).ToListAsync();

        Assert.Equal(new[] { "primero", "segundo", "tercero" }, afterSecond.Select(item => item.Description));
        Assert.All(afterSecond, report =>
        {
            Assert.Equal(TicketCodes.Length, report.TicketCode.Length);
            Assert.All(report.TicketCode, character => Assert.Contains(character, TicketCodes.Alphabet));
        });
        Assert.Equal(3, afterSecond.Select(item => item.TicketCode).Distinct().Count());
        Assert.Equal(afterFirst.Select(item => item.TicketCode), afterSecond.Select(item => item.TicketCode));
        Assert.DoesNotContain("TicketNumber", await ColumnsOf("SupportReports"));
        Assert.Contains("TicketCode", await ColumnsOf("SupportReports"));
    }

    [Fact]
    public async Task El_codigo_de_un_reporte_es_unico()
    {
        await SchemaUpgrades.ApplyAsync(_db.Context);
        var context = _db.NewContext();
        var user = new backend.Models.User { Email = "dani@example.com", DisplayName = "Dani" };
        context.Users.Add(user);
        context.SupportReports.Add(new backend.Models.SupportReport { UserId = user.Id, TicketCode = "K7M2QX", Description = "uno" });
        context.SupportReports.Add(new backend.Models.SupportReport { UserId = user.Id, TicketCode = "K7M2QX", Description = "dos" });

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
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
