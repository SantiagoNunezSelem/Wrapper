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

        // ---------------------------------------------------------------------
        // Subscriptions / Mercado Pago
        // ---------------------------------------------------------------------

        foreach (var (column, definition) in new (string, string)[]
                 {
                     ("ExternalPlanId", "TEXT NULL"),
                     ("ExternalPayerId", "TEXT NULL"),
                     ("Amount", "REAL NOT NULL DEFAULT 0"),
                     ("CurrencyId", "TEXT NULL"),
                     ("PaymentMethodLabel", "TEXT NULL"),
                     ("LastPaymentAtUtc", "TEXT NULL"),
                     ("GraceEndsAtUtc", "TEXT NULL"),
                     ("TrialWasApplied", "INTEGER NOT NULL DEFAULT 0"),
                     ("LastSyncedAtUtc", "TEXT NULL"),
                     ("IsDevSimulated", "INTEGER NOT NULL DEFAULT 0"),
                 })
        {
            await AddColumnIfMissingAsync(db, "Subscriptions", column, definition, cancellationToken);
        }

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_Subscriptions_ExternalSubscriptionId"
                ON "Subscriptions" ("ExternalSubscriptionId");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "SubscriptionInvoices" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SubscriptionInvoices" PRIMARY KEY,
                "SubscriptionId" TEXT NOT NULL,
                "UserId" TEXT NOT NULL,
                "ExternalPaymentId" TEXT NULL,
                "ExternalTransactionId" TEXT NULL,
                "Amount" REAL NOT NULL DEFAULT 0,
                "CurrencyId" TEXT NULL,
                "Status" TEXT NULL,
                "RawStatus" TEXT NULL,
                "PaymentMethodLabel" TEXT NULL,
                "PeriodStartUtc" TEXT NULL,
                "PeriodEndUtc" TEXT NULL,
                "PaidAtUtc" TEXT NULL,
                "DebitScheduledAtUtc" TEXT NULL,
                "AttemptNumber" INTEGER NOT NULL DEFAULT 0,
                "CreatedAtUtc" TEXT NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL,
                CONSTRAINT "FK_SubscriptionInvoices_Subscriptions_SubscriptionId" FOREIGN KEY ("SubscriptionId")
                    REFERENCES "Subscriptions" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_SubscriptionInvoices_ExternalPaymentId"
                ON "SubscriptionInvoices" ("ExternalPaymentId");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_SubscriptionInvoices_UserId"
                ON "SubscriptionInvoices" ("UserId");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "SubscriptionEvents" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SubscriptionEvents" PRIMARY KEY,
                "SubscriptionId" TEXT NULL,
                "UserId" TEXT NULL,
                "ExternalSubscriptionId" TEXT NULL,
                "Topic" TEXT NULL,
                "Action" TEXT NULL,
                "ExternalEventId" TEXT NULL,
                "ResultingStatus" TEXT NULL,
                "PayloadJson" TEXT NULL,
                "Notes" TEXT NULL,
                "CreatedAtUtc" TEXT NOT NULL
            );
            """,
            cancellationToken);

        // SQLite treats NULLs as distinct in a unique index, which is exactly what this
        // needs: locally-raised events (checkout, cancel) carry no provider event id and
        // must not collide with each other.
        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_SubscriptionEvents_ExternalEventId"
                ON "SubscriptionEvents" ("ExternalEventId");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_SubscriptionEvents_UserId"
                ON "SubscriptionEvents" ("UserId");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "TrialClaims" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_TrialClaims" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "IpHash" TEXT NULL,
                "SubnetHash" TEXT NULL,
                "DeviceHash" TEXT NULL,
                "CountryCode" TEXT NULL,
                "SubscriptionId" TEXT NULL,
                "ClaimedAtUtc" TEXT NOT NULL
            );
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_TrialClaims_IpHash" ON "TrialClaims" ("IpHash");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_TrialClaims_SubnetHash" ON "TrialClaims" ("SubnetHash");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_TrialClaims_DeviceHash" ON "TrialClaims" ("DeviceHash");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE INDEX IF NOT EXISTS "IX_TrialClaims_UserId" ON "TrialClaims" ("UserId");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "AppSettings" (
                "Key" TEXT NOT NULL CONSTRAINT "PK_AppSettings" PRIMARY KEY,
                "Value" TEXT NULL,
                "UpdatedAtUtc" TEXT NOT NULL
            );
            """,
            cancellationToken);
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
