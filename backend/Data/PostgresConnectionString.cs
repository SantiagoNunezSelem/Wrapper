using Npgsql;

namespace backend.Data;

/// <summary>
/// Hosts such as Render give the database as a <c>postgres://user:pass@host/db</c> URL, which
/// Npgsql does not read; it wants <c>Host=...;Username=...</c>. Anything already in the
/// key/value form passes through untouched.
/// </summary>
public static class PostgresConnectionString
{
    public static string Normalize(string value)
    {
        if (!value.StartsWith("postgres", StringComparison.OrdinalIgnoreCase) || !value.Contains("://"))
        {
            return value;
        }

        var uri = new Uri(value);
        var credentials = uri.UserInfo.Split(':', 2);

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port < 0 ? 5432 : uri.Port,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : null,
            SslMode = SslMode.Require,
        };

        return builder.ConnectionString;
    }
}
