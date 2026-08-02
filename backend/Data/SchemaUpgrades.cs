using Microsoft.EntityFrameworkCore;

namespace backend.Data;

/// <summary>
/// The project uses <c>EnsureCreatedAsync</c> rather than EF migrations, and that only
/// builds the schema when the database file does not exist yet — it will never add a
/// table or column to the <c>wrapper-crm.db</c> that is already sitting on disk. These
/// idempotent statements bring an existing database up to date without dropping the
/// user's saved analyses. Swap this for real migrations when the schema starts moving
/// often.
/// </summary>
public static class SchemaUpgrades
{
    public static async Task ApplyAsync(AppDbContext db, CancellationToken cancellationToken = default)
    {
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "AiMetricResults" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_AiMetricResults" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "SourceHash" TEXT NULL,
                "MetricId" TEXT NULL,
                "InputHash" TEXT NULL,
                "InputJson" TEXT NULL,
                "Status" TEXT NULL,
                "ResultJson" TEXT NULL,
                "ErrorCode" TEXT NULL,
                "RetryAvailableAtUtc" TEXT NULL,
                "AttemptCount" INTEGER NOT NULL DEFAULT 0,
                "CreatedAtUtc" TEXT NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL,
                CONSTRAINT "FK_AiMetricResults_Users_UserId" FOREIGN KEY ("UserId")
                    REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_AiMetricResults_UserId_SourceHash_MetricId"
                ON "AiMetricResults" ("UserId", "SourceHash", "MetricId");
            """,
            cancellationToken);

        await AddColumnIfMissingAsync(db, "Users", "AiConsentAtUtc", "TEXT NULL", cancellationToken);
    }

    private static async Task AddColumnIfMissingAsync(
        AppDbContext db,
        string table,
        string column,
        string definition,
        CancellationToken cancellationToken)
    {
        // SQLite has no "ADD COLUMN IF NOT EXISTS", so ask the catalog first.
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}';";

            var exists = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)) > 0;
            if (exists)
            {
                return;
            }

            await using var alter = connection.CreateCommand();
            alter.CommandText = $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition};";
            await alter.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }
}
