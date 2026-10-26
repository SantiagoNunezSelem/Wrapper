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
        await AddColumnIfMissingAsync(db, "Users", "PreferredLanguage", "TEXT NULL DEFAULT 'es'", cancellationToken);

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
                     ("CheckoutUrl", "TEXT NULL"),
                     ("LastPaymentStatusDetail", "TEXT NULL"),
                     ("PausedAtUtc", "TEXT NULL"),
                     ("PayerEmail", "TEXT NULL"),
                     ("LastPaymentStatus", "TEXT NULL"),
                     ("ProviderStatus", "TEXT NULL"),
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
                "StatusDetail" TEXT NULL,
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

        // Only reached by databases created before StatusDetail existed; the CREATE TABLE
        // above already carries it for new ones.
        await AddColumnIfMissingAsync(db, "SubscriptionInvoices", "StatusDetail", "TEXT NULL", cancellationToken);

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

        // ---------------------------------------------------------------------
        // Free daily metric unlocks
        // ---------------------------------------------------------------------

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "FreeMetricUnlocks" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_FreeMetricUnlocks" PRIMARY KEY,
                "UserId" TEXT NOT NULL,
                "MetricId" TEXT NULL,
                "SourceHash" TEXT NULL,
                "DayKeyUtc" TEXT NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                CONSTRAINT "FK_FreeMetricUnlocks_Users_UserId" FOREIGN KEY ("UserId")
                    REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        // Unlocks started out keyed by (user, metric, day) — one unlock opened a metric
        // across every chat. They are now per chat as well, so the column is added and
        // the old constraint dropped: leaving it in place would reject the second chat's
        // row as a duplicate of the first.
        await AddColumnIfMissingAsync(db, "FreeMetricUnlocks", "SourceHash", "TEXT NULL", cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            DROP INDEX IF EXISTS "IX_FreeMetricUnlocks_UserId_DayKeyUtc_MetricId";
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_FreeMetricUnlocks_UserId_DayKeyUtc_SourceHash_MetricId"
                ON "FreeMetricUnlocks" ("UserId", "DayKeyUtc", "SourceHash", "MetricId");
            """,
            cancellationToken);

        // ---------------------------------------------------------------------
        // Public share links
        // ---------------------------------------------------------------------

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE TABLE IF NOT EXISTS "SharedStories" (
                "Id" TEXT NOT NULL CONSTRAINT "PK_SharedStories" PRIMARY KEY,
                "Slug" TEXT NULL,
                "UserId" TEXT NOT NULL,
                "SourceHash" TEXT NULL,
                "ChatName" TEXT NULL,
                "DateRangeLabel" TEXT NULL,
                "MessageCount" INTEGER NOT NULL DEFAULT 0,
                "ParticipantCount" INTEGER NOT NULL DEFAULT 0,
                "Language" TEXT NULL,
                "PayloadJson" TEXT NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                "ExpiresAtUtc" TEXT NOT NULL,
                "ViewCount" INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT "FK_SharedStories_Users_UserId" FOREIGN KEY ("UserId")
                    REFERENCES "Users" ("Id") ON DELETE CASCADE
            );
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_SharedStories_Slug" ON "SharedStories" ("Slug");
            """,
            cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_SharedStories_UserId_SourceHash"
                ON "SharedStories" ("UserId", "SourceHash");
            """,
            cancellationToken);

        // Expired rows are dead weight — nothing can read them again (see the read
        // endpoint, which treats expired as missing), so they are cleared on startup
        // rather than left to grow the file forever. No background job: a restart is
        // frequent enough for a table this small, and it keeps the cleanup somewhere
        // obvious instead of in a timer nobody remembers.
        await db.Database.ExecuteSqlRawAsync(
            """
            DELETE FROM "SharedStories" WHERE "ExpiresAtUtc" <= datetime('now');
            """,
            cancellationToken);

        // ---------------------------------------------------------------------
        // Admin panel: all additive. Columns only the panel writes, null everywhere
        // else — and null means exactly what the app did before they existed.
        // ---------------------------------------------------------------------

        await AddColumnIfMissingAsync(db, "Users", "LastSeenAtUtc", "TEXT NULL", cancellationToken);
        await AddColumnIfMissingAsync(db, "Users", "VipUntilUtc", "TEXT NULL", cancellationToken);
        await AddColumnIfMissingAsync(db, "Users", "TrialGrantedAtUtc", "TEXT NULL", cancellationToken);
        await AddColumnIfMissingAsync(db, "Subscriptions", "AccessRevokedAtUtc", "TEXT NULL", cancellationToken);

        foreach (var statement in new[]
                 {
                     """
                     CREATE TABLE IF NOT EXISTS "AiUsage" (
                         "Id" TEXT NOT NULL CONSTRAINT "PK_AiUsage" PRIMARY KEY,
                         "UserId" TEXT NOT NULL,
                         "MetricId" TEXT NULL,
                         "InputTokens" INTEGER NOT NULL DEFAULT 0,
                         "OutputTokens" INTEGER NOT NULL DEFAULT 0,
                         "Succeeded" INTEGER NOT NULL DEFAULT 0,
                         "CreatedAtUtc" TEXT NOT NULL
                     );
                     """,
                     """CREATE INDEX IF NOT EXISTS "IX_AiUsage_CreatedAtUtc" ON "AiUsage" ("CreatedAtUtc");""",
                     """CREATE INDEX IF NOT EXISTS "IX_AiUsage_UserId" ON "AiUsage" ("UserId");""",
                     """
                     CREATE TABLE IF NOT EXISTS "WebhookRejections" (
                         "Id" TEXT NOT NULL CONSTRAINT "PK_WebhookRejections" PRIMARY KEY,
                         "Topic" TEXT NULL,
                         "DataId" TEXT NULL,
                         "Reason" TEXT NULL,
                         "ReceivedAtUtc" TEXT NOT NULL
                     );
                     """,
                     """CREATE INDEX IF NOT EXISTS "IX_WebhookRejections_ReceivedAtUtc" ON "WebhookRejections" ("ReceivedAtUtc");""",
                     // Two weeks is plenty to notice a rotated secret, and keeps a flood of
                     // forged notifications from growing the file for good.
                     """DELETE FROM "WebhookRejections" WHERE "ReceivedAtUtc" <= datetime('now', '-14 days');""",
                     """
                     CREATE TABLE IF NOT EXISTS "AdminNotes" (
                         "Id" TEXT NOT NULL CONSTRAINT "PK_AdminNotes" PRIMARY KEY,
                         "UserId" TEXT NOT NULL,
                         "AuthorId" TEXT NOT NULL,
                         "AuthorEmail" TEXT NULL,
                         "Text" TEXT NULL,
                         "CreatedAtUtc" TEXT NOT NULL,
                         CONSTRAINT "FK_AdminNotes_Users_UserId" FOREIGN KEY ("UserId")
                             REFERENCES "Users" ("Id") ON DELETE CASCADE
                     );
                     """,
                     """CREATE INDEX IF NOT EXISTS "IX_AdminNotes_UserId" ON "AdminNotes" ("UserId");""",
                     """
                     CREATE TABLE IF NOT EXISTS "AdminAuditEvents" (
                         "Id" TEXT NOT NULL CONSTRAINT "PK_AdminAuditEvents" PRIMARY KEY,
                         "AdminId" TEXT NOT NULL,
                         "AdminEmail" TEXT NULL,
                         "Action" TEXT NULL,
                         "TargetUserId" TEXT NULL,
                         "Details" TEXT NULL,
                         "CreatedAtUtc" TEXT NOT NULL
                     );
                     """,
                     """CREATE INDEX IF NOT EXISTS "IX_AdminAuditEvents_CreatedAtUtc" ON "AdminAuditEvents" ("CreatedAtUtc");""",
                 })
        {
            await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
        }

        // ---------------------------------------------------------------------
        // Help page and terms: both additive. A null TermsVersion is exactly an
        // account that has not accepted yet, which is every account before this.
        // ---------------------------------------------------------------------

        await AddColumnIfMissingAsync(db, "Users", "TermsVersion", "TEXT NULL", cancellationToken);
        await AddColumnIfMissingAsync(db, "Users", "TermsAcceptedAtUtc", "TEXT NULL", cancellationToken);

        foreach (var statement in new[]
                 {
                     """
                     CREATE TABLE IF NOT EXISTS "SupportReports" (
                         "Id" TEXT NOT NULL CONSTRAINT "PK_SupportReports" PRIMARY KEY,
                         "TicketCode" TEXT NOT NULL DEFAULT '',
                         "UserId" TEXT NOT NULL,
                         "ContactEmail" TEXT NULL,
                         "Category" TEXT NULL,
                         "Description" TEXT NULL,
                         "UserAgent" TEXT NULL,
                         "Viewport" TEXT NULL,
                         "Language" TEXT NULL,
                         "SubscriptionState" TEXT NULL,
                         "Status" TEXT NULL,
                         "CreatedAtUtc" TEXT NOT NULL,
                         "ResolvedAtUtc" TEXT NULL,
                         "ResolvedByEmail" TEXT NULL,
                         CONSTRAINT "FK_SupportReports_Users_UserId" FOREIGN KEY ("UserId")
                             REFERENCES "Users" ("Id") ON DELETE CASCADE
                     );
                     """,
                     """CREATE INDEX IF NOT EXISTS "IX_SupportReports_CreatedAtUtc" ON "SupportReports" ("CreatedAtUtc");""",
                     // Superseded by the (UserId, CreatedAtUtc) one below, which serves the same
                     // lookups; only a database made by an earlier build of this branch has it.
                     """DROP INDEX IF EXISTS "IX_SupportReports_UserId";""",
                     """CREATE INDEX IF NOT EXISTS "IX_SupportReports_UserId_CreatedAtUtc" ON "SupportReports" ("UserId", "CreatedAtUtc");""",
                 })
        {
            await db.Database.ExecuteSqlRawAsync(statement, cancellationToken);
        }

        // Report codes. This branch first numbered reports 1, 2, 3…; a database made by that
        // build still has the column and its unique index, which would refuse the second
        // report now that nothing fills it. Neither shipped, so they are simply removed.
        await db.Database.ExecuteSqlRawAsync("""DROP INDEX IF EXISTS "IX_SupportReports_TicketNumber";""", cancellationToken);
        await DropColumnIfPresentAsync(db, "SupportReports", "TicketNumber", cancellationToken);

        // A table made before codes existed has none on its rows. They are given one, and only
        // then is the column made unique: the other way round, every old row (all empty)
        // would collide with the next.
        await AddColumnIfMissingAsync(db, "SupportReports", "TicketCode", "TEXT NOT NULL DEFAULT ''", cancellationToken);
        await GiveCodesToReportsWithoutOneAsync(db, cancellationToken);

        await db.Database.ExecuteSqlRawAsync(
            """CREATE UNIQUE INDEX IF NOT EXISTS "IX_SupportReports_TicketCode" ON "SupportReports" ("TicketCode");""",
            cancellationToken);
    }

    /// <summary>
    /// Fills in the code of every report that has none, oldest first. A code is checked against
    /// all those already taken — including the ones handed out in this same pass — because the
    /// unique index goes on right after, and an index that cannot be built stops the app from
    /// starting.
    /// </summary>
    private static async Task GiveCodesToReportsWithoutOneAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            var taken = new HashSet<string>(StringComparer.Ordinal);
            var withoutCode = new List<string>();

            await using (var select = connection.CreateCommand())
            {
                select.CommandText = """SELECT "Id", "TicketCode" FROM "SupportReports" ORDER BY "CreatedAtUtc", "Id";""";
                await using var reader = await select.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var code = reader.GetString(1);
                    if (code.Length == 0)
                    {
                        withoutCode.Add(reader.GetString(0));
                    }
                    else
                    {
                        taken.Add(code);
                    }
                }
            }

            foreach (var id in withoutCode)
            {
                string code;
                do
                {
                    code = backend.Services.TicketCodes.Generate();
                }
                while (!taken.Add(code));

                await using var update = connection.CreateCommand();
                update.CommandText = """UPDATE "SupportReports" SET "TicketCode" = $code WHERE "Id" = $id;""";

                var codeParameter = update.CreateParameter();
                codeParameter.ParameterName = "$code";
                codeParameter.Value = code;
                update.Parameters.Add(codeParameter);

                var idParameter = update.CreateParameter();
                idParameter.ParameterName = "$id";
                idParameter.Value = id;
                update.Parameters.Add(idParameter);

                await update.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    private static async Task DropColumnIfPresentAsync(
        AppDbContext db,
        string table,
        string column,
        CancellationToken cancellationToken)
    {
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}';";

            if (Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)) == 0)
            {
                return;
            }

            await using var alter = connection.CreateCommand();
            alter.CommandText = $"ALTER TABLE \"{table}\" DROP COLUMN \"{column}\";";
            await alter.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
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
