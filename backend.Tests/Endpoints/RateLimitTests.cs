using System.Net;
using System.Net.Http.Json;
using backend.Tests.Infrastructure;

namespace backend.Tests.Endpoints;

/// <summary>
/// El rate limiter. Cada test estrena su propia factory: el estado de las ventanas vive
/// en el proceso de la app, así que compartir una instancia haría que un test gastara la
/// cuota del siguiente y el resultado dependiera del orden de ejecución.
/// </summary>
public sealed class RateLimitTests
{
    [Fact]
    public async Task El_login_se_corta_al_noveno_intento_por_minuto()
    {
        // Es el único POST sin autenticar de toda la API: el que pegaría directo un
        // script que se saltea el frontend (y su token de reCAPTCHA).
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var body = new { idToken = "invalido" };

        for (var attempt = 0; attempt < 8; attempt += 1)
        {
            var allowed = await client.PostAsJsonAsync("/api/auth/google", body);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, allowed.StatusCode);
        }

        var blocked = await client.PostAsJsonAsync("/api/auth/google", body);

        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
    }

    [Fact]
    public async Task El_rechazo_dice_cuándo_reintentar()
    {
        // Sin Retry-After el cliente sólo aprende "demasiadas peticiones", nunca cuándo
        // volver a probar.
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var body = new { idToken = "invalido" };

        HttpResponseMessage? blocked = null;
        for (var attempt = 0; attempt < 12 && blocked is null; attempt += 1)
        {
            var response = await client.PostAsJsonAsync("/api/auth/google", body);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                blocked = response;
            }
        }

        Assert.NotNull(blocked);
        Assert.Equal("60", blocked.Headers.GetValues("Retry-After").Single());
    }

    [Fact]
    public async Task El_limite_del_login_particiona_por_direccion()
    {
        using var factory = new ApiFactory();
        var body = new { idToken = "invalido" };

        factory.RemoteIpAddress = IPAddress.Parse("203.0.113.10");
        for (var attempt = 0; attempt < 9; attempt += 1)
        {
            await factory.CreateClient().PostAsJsonAsync("/api/auth/google", body);
        }

        // Otra dirección arranca con su cuota entera.
        factory.RemoteIpAddress = IPAddress.Parse("203.0.113.20");
        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/google", body);

        Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Fact]
    public async Task Crear_links_compartidos_se_corta_al_undecimo()
    {
        // Es el endpoint que hace crecer la base a pedido: cada link guarda cientos de
        // kilobytes de JSON.
        using var factory = new ApiFactory();
        var (client, _) = factory.CreateAuthenticatedClient();
        object Payload(int index) => new
        {
            chatName = "Grupo",
            dateRangeLabel = "01 mar",
            sourceHash = index.ToString("x64"),
            language = "es",
            messageCount = 10,
            participantCount = 2,
            cardsJson = """[{"id":"spammer","basic":{"value":"1","label":"x"}}]""",
        };

        for (var attempt = 0; attempt < 10; attempt += 1)
        {
            var allowed = await client.PostAsJsonAsync("/api/shares", Payload(attempt));
            Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        }

        var blocked = await client.PostAsJsonAsync("/api/shares", Payload(99));

        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
    }

    [Fact]
    public async Task Las_rutas_de_lectura_no_comparten_la_cuota_del_login()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();
        for (var attempt = 0; attempt < 9; attempt += 1)
        {
            await client.PostAsJsonAsync("/api/auth/google", new { idToken = "invalido" });
        }

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
