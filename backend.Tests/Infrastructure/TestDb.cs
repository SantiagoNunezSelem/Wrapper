using backend.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Infrastructure;

/// <summary>
/// Una base SQLite en memoria por test, con el esquema real creado desde
/// <see cref="AppDbContext"/>.
///
/// <para>SQLite y no el proveedor InMemory de EF a propósito: la app depende de cosas que
/// InMemory no implementa — los índices únicos (que son lo que hace idempotente el gasto
/// de un desbloqueo gratuito y lo que evita que un webhook redelivered duplique una
/// factura), el mapeo de <c>decimal</c> a REAL, y el comportamiento de las fechas. Un test
/// sobre InMemory pasaría verde justo donde la base de verdad falla.</para>
///
/// <para>La conexión queda abierta mientras viva la instancia: una base
/// <c>:memory:</c> desaparece en cuanto se cierra la última conexión.</para>
/// </summary>
public sealed class TestDb : IDisposable
{
    private readonly SqliteConnection _connection;

    private TestDb(SqliteConnection connection, AppDbContext context)
    {
        _connection = connection;
        Context = context;
    }

    public AppDbContext Context { get; }

    public static TestDb Create()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();

        var context = NewContext(connection);
        context.Database.EnsureCreated();

        return new TestDb(connection, context);
    }

    /// <summary>
    /// Un contexto nuevo sobre la misma base. Sirve para releer sin el change tracker
    /// del contexto que escribió — la única forma de comprobar que algo se persistió de
    /// verdad y no quedó sólo en memoria.
    /// </summary>
    public AppDbContext NewContext() => NewContext(_connection);

    private static AppDbContext NewContext(SqliteConnection connection) =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);

    public void Dispose()
    {
        Context.Dispose();
        _connection.Dispose();
    }
}
