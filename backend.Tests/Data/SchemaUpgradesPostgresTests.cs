using System.Text.RegularExpressions;
using backend.Data;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Data;

/// <summary>
/// Producción corre sobre Postgres, y ahí <c>EnsureCreatedAsync</c> sólo arma una base que no
/// existe: a una que ya tiene tablas no le agrega nada. Una columna nueva en <c>Users</c> que no
/// llegó a la base real rompe cada lectura de <c>Users</c> —el seed del arranque incluido— y el
/// deploy se cae: así se rompió el de "Quién es Quién", y los tests con SQLite no lo vieron porque
/// SQLite sí recibe sus parches.
///
/// Cada tabla o columna que entra al modelo después del primer deploy tiene que estar en
/// <see cref="SchemaUpgrades.PostgresStatements"/>, con los tipos EXACTOS que genera EF. Estos
/// tests comparan lo que hay en esa lista contra el script que el propio EF genera para Npgsql,
/// así que cambiar una entidad sin tocar la lista falla acá y no en el arranque de producción.
/// </summary>
public class SchemaUpgradesPostgresTests
{
    private static readonly string EfScript = BuildEfScript();

    private static string BuildEfScript()
    {
        // El mismo interruptor que Program.cs prende antes de crear la base. Sin él EF mapearía las
        // fechas a "timestamp with time zone" y el script no sería el de producción; y como es un
        // interruptor de todo el proceso, dejarlo librado al orden de los tests hacía que este
        // archivo pasara solo y fallara en la suite completa.
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=x;Username=x;Password=x")
            .Options;

        using var db = new AppDbContext(options);
        return db.Database.GenerateCreateScript();
    }

    private static string Collapse(string sql) => Regex.Replace(sql, @"\s+", " ").Trim();

    private static string EfTableBody(string table)
    {
        var match = Regex.Match(
            EfScript,
            $@"CREATE TABLE ""{Regex.Escape(table)}"" \((?<body>.*?)\);",
            RegexOptions.Singleline);

        Assert.True(match.Success, $"EF no genera la tabla {table} para Postgres.");
        return match.Groups["body"].Value;
    }

    private static string EfIndex(string name)
    {
        var match = Regex.Match(
            EfScript,
            $@"CREATE (UNIQUE )?INDEX ""{Regex.Escape(name)}"" ON [^;]+;",
            RegexOptions.Singleline);

        Assert.True(match.Success, $"EF no genera el índice {name} para Postgres.");
        return Collapse(match.Value);
    }

    private static IEnumerable<string> Statements(string startsWith) =>
        SchemaUpgrades.PostgresStatements
            .Select(Collapse)
            .Where(statement => statement.StartsWith(startsWith, StringComparison.Ordinal));

    [Fact]
    public void Hay_algo_para_aplicar()
    {
        Assert.NotEmpty(SchemaUpgrades.PostgresStatements);
    }

    [Fact]
    public void Toda_sentencia_es_idempotente_porque_corre_en_cada_arranque()
    {
        foreach (var statement in SchemaUpgrades.PostgresStatements)
        {
            Assert.Contains("IF NOT EXISTS", statement);
        }
    }

    [Fact]
    public void Cada_tabla_es_identica_a_la_que_genera_EF()
    {
        var tables = Statements("CREATE TABLE IF NOT EXISTS").ToList();
        Assert.NotEmpty(tables);

        foreach (var statement in tables)
        {
            var match = Regex.Match(statement, @"^CREATE TABLE IF NOT EXISTS ""(?<name>\w+)"" \((?<body>.*)\);$");
            Assert.True(match.Success, $"No pude leer la sentencia: {statement}");

            var name = match.Groups["name"].Value;
            Assert.Equal(Collapse(EfTableBody(name)), Collapse(match.Groups["body"].Value));
        }
    }

    [Fact]
    public void Cada_columna_nueva_tiene_el_mismo_tipo_que_en_EF()
    {
        var columns = Statements("ALTER TABLE").ToList();
        Assert.NotEmpty(columns);

        foreach (var statement in columns)
        {
            var match = Regex.Match(
                statement,
                @"^ALTER TABLE ""(?<table>\w+)"" ADD COLUMN IF NOT EXISTS ""(?<column>\w+)"" (?<definition>[^;]+);$");
            Assert.True(match.Success, $"No pude leer la sentencia: {statement}");

            var table = match.Groups["table"].Value;
            var column = match.Groups["column"].Value;

            var efLine = EfTableBody(table)
                .Split('\n')
                .Select(line => line.Trim().TrimEnd(','))
                .FirstOrDefault(line => line.StartsWith($"\"{column}\" ", StringComparison.Ordinal));

            Assert.True(efLine is not null, $"EF no genera la columna {table}.{column} para Postgres.");
            // Una columna agregada a una tabla con filas no puede ser NOT NULL sin un valor por
            // defecto: si el modelo la exige, la sentencia tiene que decirlo explícitamente.
            Assert.Equal(efLine, $"\"{column}\" {match.Groups["definition"].Value}");
        }
    }

    [Fact]
    public void Cada_indice_es_identico_al_que_genera_EF()
    {
        var indexes = Statements("CREATE UNIQUE INDEX IF NOT EXISTS").Concat(Statements("CREATE INDEX IF NOT EXISTS")).ToList();
        Assert.NotEmpty(indexes);

        foreach (var statement in indexes)
        {
            var match = Regex.Match(statement, @"^CREATE (UNIQUE )?INDEX IF NOT EXISTS ""(?<name>\w+)""");
            Assert.True(match.Success, $"No pude leer la sentencia: {statement}");

            Assert.Equal(EfIndex(match.Groups["name"].Value), statement.Replace(" IF NOT EXISTS", string.Empty, StringComparison.Ordinal));
        }
    }

    [Fact]
    public void Las_sentencias_de_perfiles_cubren_lo_que_el_modelo_agrego()
    {
        // El modelo tiene la columna y la tabla; si alguien las saca de la lista, producción
        // vuelve a romperse en el primer SELECT de Users.
        Assert.Contains("\"AiProfileConsentAtUtc\"", EfTableBody("Users"));
        Assert.Contains(SchemaUpgrades.PostgresStatements, statement => statement.Contains("\"AiProfileConsentAtUtc\"", StringComparison.Ordinal));
        Assert.Contains(SchemaUpgrades.PostgresStatements, statement => statement.Contains("CREATE TABLE IF NOT EXISTS \"AiProfileResults\"", StringComparison.Ordinal));
    }
}
