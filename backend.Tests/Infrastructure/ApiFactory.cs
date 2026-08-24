using System.Net;
using System.Net.Http.Headers;
using backend.Data;
using backend.Models;
using backend.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace backend.Tests.Infrastructure;

/// <summary>
/// Levanta la API entera en memoria — con su pipeline real: autenticación JWT, CORS,
/// rate limiting, serialización y los 22 endpoints — contra una SQLite en memoria.
///
/// <para>Es deliberadamente la app de verdad y no una copia: un test que llamara a los
/// handlers a mano se saltearía justo las partes que más se rompen (el <c>[Authorize]</c>,
/// el binding del body, los códigos de estado).</para>
///
/// <para>Cada instancia tiene su propia base Y su propio estado de rate limiter, así que
/// dos clases de test que corren en paralelo no se gastan las cuotas entre sí. Por eso se
/// usa <c>IClassFixture</c> y no un fixture compartido.</para>
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    /// <summary>
    /// Se abre en el constructor, no dentro de <c>ConfigureTestServices</c>: ese callback
    /// recién corre cuando se construye el host (en el primer <c>CreateClient()</c>), y un
    /// test que prepara datos antes de eso necesita la conexión ya viva. Además, una base
    /// <c>:memory:</c> se borra en cuanto se cierra la última conexión, así que ésta queda
    /// abierta mientras viva la factory.
    /// </summary>
    private readonly SqliteConnection _connection = OpenSharedConnection();

    private static SqliteConnection OpenSharedConnection()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        return connection;
    }

    /// <summary>
    /// Dirección que verá el servidor como origen de la request. TestServer no abre un
    /// socket real, así que sin esto <c>RemoteIpAddress</c> es null y las rutas de dev
    /// (que exigen loopback) responderían 404 siempre.
    /// </summary>
    public IPAddress RemoteIpAddress { get; set; } = IPAddress.Loopback;

    /// <summary>Ajustes que pisan a los de <c>appsettings.json</c> en este arranque.</summary>
    public Dictionary<string, string?> Settings { get; } = new()
    {
        ["ConnectionStrings:DefaultConnection"] = "DataSource=:memory:",
        ["Jwt:Issuer"] = "WrapperCrm.Api",
        ["Jwt:Audience"] = "WrapperCrm.Frontend",
        ["Jwt:SigningKey"] = "clave-de-firma-para-los-tests-de-integracion-larga",
        ["Jwt:ExpirationMinutes"] = "60",
        // Vacío: que la siembra del admin no invente cuentas VIP en medio de un test.
        ["AdminSeed:Email"] = "",
        ["GoogleAuth:AllowedAudience"] = "test-client-id.apps.googleusercontent.com",
        // Sin credenciales de terceros por defecto: ningún test debe poder salir a la red.
        ["GoogleAi:ApiKey"] = "",
        ["MercadoPago:AccessToken"] = "",
        ["Recaptcha:SecretKeyV3"] = "",
        ["Recaptcha:SecretKeyV2"] = "",
    };

    /// <summary>
    /// Entorno de la app. Development por defecto — es el que mapea las rutas de dev y
    /// saltea la comprobación de secretos de producción. Ponerlo en "Production" es lo
    /// que permite probar esa comprobación.
    /// </summary>
    public string Environment { get; set; } = "Development";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environment);
        builder.UseSetting("https_port", string.Empty);

        // `UseSetting` y no `ConfigureAppConfiguration`: los callbacks de configuración se
        // aplican al construir el host, o sea DESPUÉS de que los top-level statements de
        // Program.cs ya leyeron `builder.Configuration` para armar la validación del JWT y
        // las opciones del trial guard. Con eso, el token que firma TokenService (que lee
        // IOptions de forma perezosa, ya con la config nueva) quedaba firmado con una clave
        // distinta de la que valida el middleware, y toda ruta autenticada respondía 401.
        // `UseSetting` entra en la configuración del host, que es de donde
        // `WebApplication.CreateBuilder` parte, así que se ve desde la primera línea.
        foreach (var (key, value) in Settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.RemoveAll<DbContextOptions>();
            services.AddDbContext<AppDbContext>(options => options.UseSqlite(_connection));

            // TestServer no tiene socket, así que la dirección del cliente se inyecta.
            services.AddSingleton<IStartupFilter>(new RemoteIpStartupFilter(() => RemoteIpAddress));
        });
    }

    /// <summary>
    /// Un contexto nuevo sobre la misma base, para preparar datos o releerlos.
    ///
    /// Toca <c>Services</c> primero para forzar el arranque del host: el esquema lo crea
    /// la propia app (<c>EnsureCreatedAsync</c> + <c>SchemaUpgrades</c>), así que antes de
    /// eso la base está vacía y cualquier consulta falla con "no such table".
    /// </summary>
    public AppDbContext NewDbContext()
    {
        _ = Services;
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
    }

    /// <summary>Crea una cuenta y devuelve un cliente ya autenticado como ella.</summary>
    public (HttpClient Client, User User) CreateAuthenticatedClient(
        bool isAdmin = false,
        bool hasUsedTrial = false,
        bool hasAiConsent = false,
        params Subscription[] subscriptions)
    {
        var user = CreateUser(isAdmin, hasUsedTrial, hasAiConsent, subscriptions);
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", TokenFor(user));
        return (client, user);
    }

    public User CreateUser(
        bool isAdmin = false,
        bool hasUsedTrial = false,
        bool hasAiConsent = false,
        params Subscription[] subscriptions)
    {
        using var db = NewDbContext();
        var user = new User
        {
            Email = $"{Guid.NewGuid():N}@example.com",
            DisplayName = "Cuenta de prueba",
            IsAdmin = isAdmin,
            HasUsedTrial = hasUsedTrial,
            AiConsentAtUtc = hasAiConsent ? DateTime.UtcNow : null,
        };
        user.Subscriptions.AddRange(subscriptions);
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    /// <summary>Un JWT válido para esa cuenta, firmado con la misma clave que valida la API.</summary>
    public string TokenFor(User user)
    {
        using var scope = Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<TokenService>().Create(user);
    }

    /// <summary>Una suscripción Pro vigente, para probar lo que hay detrás del paywall.</summary>
    public static Subscription ActiveSubscription() => new()
    {
        Status = "activa",
        PlanType = "mensual",
        PaymentProvider = "mercadopago",
        NextBillingAtUtc = DateTime.UtcNow.AddDays(20),
        ExternalSubscriptionId = "pre-1",
    };

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            _connection.Dispose();
        }
    }

    /// <summary>
    /// Middleware de test que estampa la dirección del cliente antes que cualquier otra
    /// cosa del pipeline la lea — el rate limiter la particiona y las rutas de dev la
    /// exigen loopback.
    /// </summary>
    private sealed class RemoteIpStartupFilter(Func<IPAddress> address) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => builder =>
        {
            builder.Use(async (context, following) =>
            {
                context.Connection.RemoteIpAddress = address();
                await following();
            });

            next(builder);
        };
    }
}
