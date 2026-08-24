using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// Los links públicos: el único rincón de la API que responde sin sesión. Lo que hace
/// que eso no sea una puerta abierta es que se lee por un slug inadivinable, que lo
/// guardado ya viene sin texto de mensajes, y que vence solo.
/// </summary>
public sealed class ShareEndpointTests : IClassFixture<ApiFactory>
{
    private const string ChatHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private static int _addressCounter;

    private readonly ApiFactory _factory;

    /// <summary>
    /// Cada test estrena dirección: crear un link está limitado a 10 por 10 minutos POR
    /// DIRECCIÓN, y con una sola compartida entre todos los tests de la clase los últimos
    /// empezarían a recibir 429 por una razón que no tiene nada que ver con lo que prueban.
    /// </summary>
    public ShareEndpointTests(ApiFactory factory)
    {
        _factory = factory;
        var index = Interlocked.Increment(ref _addressCounter);
        factory.RemoteIpAddress = IPAddress.Parse($"10.{index / 256 % 256}.{index % 256}.1");
    }

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static async Task<string?> CodeOf(HttpResponseMessage response) =>
        (await ReadJson(response)).TryGetProperty("code", out var code) ? code.GetString() : null;

    /// <summary>Una tarjeta con TODO lo privado adentro, como la manda un cliente manipulado.</summary>
    private const string CardsWithPrivateText = """
    [{
      "id": "testamento",
      "title": "El mensaje más largo del chat",
      "description": "El Testamento",
      "tier": "free",
      "accent": "tier-gold",
      "basic": {
        "value": "1240",
        "label": "caracteres, de Ana",
        "note": "SECRETO-NOTA-che te queria contar",
        "chart": { "kind": "bar", "items": [] }
      },
      "detail": {
        "intro": "Los mensajes más extensos.",
        "groups": [{
          "id": "msg-1",
          "heading": "Ana — 210 palabras",
          "bubbles": [{ "sender": "Ana", "text": "SECRETO-BURBUJA-hola como estas" }]
        }]
      }
    }]
    """;

    private static object Payload(string cardsJson = CardsWithPrivateText, string chatName = "Grupo", string sourceHash = ChatHash, string language = "es") =>
        new { chatName, dateRangeLabel = "01 mar - 02 mar", sourceHash, language, messageCount = 100, participantCount = 3, cardsJson };

    // -----------------------------------------------------------------------
    // Publicar
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Publicar_sin_sesion_es_401()
    {
        var response = await _factory.CreateClient().PostAsJsonAsync("/api/shares", Payload());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Publicar_devuelve_un_slug_y_una_fecha_de_vencimiento()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()));

        var slug = body.GetProperty("slug").GetString()!;
        Assert.Equal(12, slug.Length);
        // Base58: sin los caracteres que se leen mal al dictar un link (0/O, 1/l/I).
        Assert.DoesNotContain(slug, "0OlI");
        Assert.True(body.GetProperty("expiresAtUtc").GetDateTime() > DateTime.UtcNow.AddDays(80));
    }

    [Fact]
    public async Task Dos_links_distintos_tienen_slugs_distintos()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();

        var first = await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload(sourceHash: new string('a', 64))));
        var second = await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload(sourceHash: new string('b', 64))));

        Assert.NotEqual(first.GetProperty("slug").GetString(), second.GetProperty("slug").GetString());
    }

    [Fact]
    public async Task Volver_a_compartir_el_MISMO_chat_reemplaza_el_link_en_vez_de_crear_otro()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();
        var first = await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload(chatName: "Primera")));

        var second = await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload(chatName: "Segunda")));

        Assert.Equal(first.GetProperty("slug").GetString(), second.GetProperty("slug").GetString());
        using var db = _factory.NewDbContext();
        var story = await db.SharedStories.SingleAsync(item => item.UserId == user.Id);
        Assert.Equal("Segunda", story.ChatName);
    }

    [Fact]
    public async Task Volver_a_compartir_reinicia_el_reloj_de_los_90_dias()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/shares", Payload());
        using (var db = _factory.NewDbContext())
        {
            var story = await db.SharedStories.SingleAsync(item => item.UserId == user.Id);
            story.ExpiresAtUtc = DateTime.UtcNow.AddDays(2);
            await db.SaveChangesAsync();
        }

        var body = await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()));

        Assert.True(body.GetProperty("expiresAtUtc").GetDateTime() > DateTime.UtcNow.AddDays(80));
    }

    // -----------------------------------------------------------------------
    // Privacidad
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Lo_guardado_NUNCA_contiene_texto_de_mensajes()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();

        await client.PostAsJsonAsync("/api/shares", Payload());

        using var db = _factory.NewDbContext();
        var stored = await db.SharedStories.SingleAsync(item => item.UserId == user.Id);
        Assert.DoesNotContain("SECRETO-NOTA", stored.PayloadJson);
        Assert.DoesNotContain("SECRETO-BURBUJA", stored.PayloadJson);
        Assert.DoesNotContain("bubbles", stored.PayloadJson);
    }

    [Fact]
    public async Task La_lectura_publica_NUNCA_devuelve_texto_de_mensajes()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()))).GetProperty("slug").GetString();

        var raw = await (await _factory.CreateClient().GetAsync($"/api/shares/{slug}")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("SECRETO-NOTA", raw);
        Assert.DoesNotContain("SECRETO-BURBUJA", raw);
    }

    [Fact]
    public async Task El_encabezado_del_grupo_SI_se_publica()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()))).GetProperty("slug").GetString();

        var body = await ReadJson(await _factory.CreateClient().GetAsync($"/api/shares/{slug}"));

        var group = body.GetProperty("cards")[0].GetProperty("detail").GetProperty("groups")[0];
        Assert.Equal("Ana — 210 palabras", group.GetProperty("heading").GetString());
        Assert.False(group.TryGetProperty("bubbles", out _));
    }

    // -----------------------------------------------------------------------
    // Validación
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Rechaza_un_nombre_de_chat_vacio()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/shares", Payload(chatName: "  "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_request", await CodeOf(response));
    }

    [Fact]
    public async Task Rechaza_un_sourceHash_ausente_o_demasiado_largo()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();

        Assert.Equal("source_hash_required", await CodeOf(await client.PostAsJsonAsync("/api/shares", Payload(sourceHash: " "))));
        Assert.Equal("source_hash_required", await CodeOf(await client.PostAsJsonAsync("/api/shares", Payload(sourceHash: new string('a', 65)))));
    }

    [Fact]
    public async Task Rechaza_un_payload_demasiado_grande()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var huge = "[{\"id\":\"x\",\"basic\":{\"value\":\"1\",\"label\":\"" + new string('y', 400_000) + "\"}}]";

        var response = await client.PostAsJsonAsync("/api/shares", Payload(cardsJson: huge));

        Assert.Equal("payload_too_large", await CodeOf(response));
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("no es json")]
    [InlineData("[{\"id\":\"x\"}]")]
    public async Task Rechaza_un_payload_sin_nada_publicable(string cardsJson)
    {
        var (client, _) = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/shares", Payload(cardsJson: cardsJson));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("nothing_to_share", await CodeOf(response));
    }

    [Fact]
    public async Task Un_idioma_desconocido_cae_a_español()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload(language: "fr")))).GetProperty("slug").GetString();

        var body = await ReadJson(await _factory.CreateClient().GetAsync($"/api/shares/{slug}"));

        Assert.Equal("es", body.GetProperty("language").GetString());
    }

    [Fact]
    public async Task El_idioma_ingles_se_respeta()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload(language: "en")))).GetProperty("slug").GetString();

        var body = await ReadJson(await _factory.CreateClient().GetAsync($"/api/shares/{slug}"));

        Assert.Equal("en", body.GetProperty("language").GetString());
    }

    // -----------------------------------------------------------------------
    // Lectura pública
    // -----------------------------------------------------------------------

    [Fact]
    public async Task La_lectura_NO_pide_sesion()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()))).GetProperty("slug").GetString();

        var response = await _factory.CreateClient().GetAsync($"/api/shares/{slug}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal("Grupo", body.GetProperty("chatName").GetString());
        Assert.Equal(100, body.GetProperty("messageCount").GetInt32());
        Assert.Equal(1, body.GetProperty("cards").GetArrayLength());
    }

    [Theory]
    [InlineData("corto")]
    [InlineData("estoesdemasiadolargoparaunslug")]
    [InlineData("con-guiones1")]
    [InlineData("0OlI23456789")]
    public async Task Un_slug_con_forma_invalida_es_404_sin_tocar_la_base(string slug)
    {
        var response = await _factory.CreateClient().GetAsync($"/api/shares/{slug}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("share_not_found", await CodeOf(response));
    }

    [Fact]
    public async Task Un_slug_bien_formado_pero_inexistente_es_404()
    {
        var response = await _factory.CreateClient().GetAsync("/api/shares/abcdefghjkmn");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Un_link_vencido_se_lee_como_inexistente()
    {
        // Decirle a un visitante anónimo que el slug existe pero está vencido le confirma
        // que adivinó — lo único que un link no listado no se puede permitir.
        var (client, user) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()))).GetProperty("slug").GetString();
        using (var db = _factory.NewDbContext())
        {
            var story = await db.SharedStories.SingleAsync(item => item.UserId == user.Id);
            story.ExpiresAtUtc = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }

        var response = await _factory.CreateClient().GetAsync($"/api/shares/{slug}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("share_not_found", await CodeOf(response));
    }

    [Fact]
    public async Task Cada_lectura_suma_una_visita()
    {
        var (client, user) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()))).GetProperty("slug").GetString();

        await _factory.CreateClient().GetAsync($"/api/shares/{slug}");
        await _factory.CreateClient().GetAsync($"/api/shares/{slug}");

        using var db = _factory.NewDbContext();
        Assert.Equal(2, (await db.SharedStories.SingleAsync(item => item.UserId == user.Id)).ViewCount);
    }

    [Fact]
    public async Task La_respuesta_publica_es_JSON_plano_bien_formado()
    {
        var (client, _) = _factory.CreateAuthenticatedClient();
        var slug = (await ReadJson(await client.PostAsJsonAsync("/api/shares", Payload()))).GetProperty("slug").GetString();

        var response = await _factory.CreateClient().GetAsync($"/api/shares/{slug}");

        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var body = await ReadJson(response);
        Assert.Equal(JsonValueKind.Object, body.ValueKind);
        foreach (var property in new[] { "chatName", "dateRangeLabel", "messageCount", "participantCount", "language", "createdAtUtc", "expiresAtUtc", "cards" })
        {
            Assert.True(body.TryGetProperty(property, out _), $"falta {property}");
        }
    }
}
