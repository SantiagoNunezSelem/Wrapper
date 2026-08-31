using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// Lo único que esta API guarda por cuenta de un usuario. Todo lo que entra acá es texto
/// controlado por el cliente que se escribe a disco y se conserva, así que la mitad de
/// los tests son sobre los topes que impiden que una cuenta cualquiera llene el volumen.
/// </summary>
public sealed class AnalysesEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ValidHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private static object Payload(
        string chatName = "Grupo de la facu",
        string dateRange = "01 mar 2025 - 02 mar 2025",
        string resultsJson = "{\"freeMetrics\":[]}",
        string sourceHash = ValidHash,
        int messageCount = 100,
        int participantCount = 3) =>
        new { chatName, dateRangeLabel = dateRange, messageCount, participantCount, resultsJson, sourceHash };

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    // -----------------------------------------------------------------------
    // Autenticación
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Listar_sin_sesion_es_401()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/analyses")).StatusCode);
    }

    [Fact]
    public async Task Guardar_sin_sesion_es_401()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/analyses", Payload());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Guardado
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Guarda_un_analisis_y_devuelve_201()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/analyses", Payload());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal("Grupo de la facu", body.GetProperty("chatName").GetString());
        Assert.Equal(100, body.GetProperty("messageCount").GetInt32());

        using var db = factory.NewDbContext();
        Assert.Equal(1, await db.Analyses.CountAsync(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task Recorta_los_espacios_del_nombre_y_del_rango()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/analyses",
            Payload(chatName: "  Grupo  ", dateRange: "  01 mar  "));

        Assert.Equal("Grupo", (await ReadJson(response)).GetProperty("chatName").GetString());
        Assert.Equal("01 mar", (await ReadJson(response)).GetProperty("dateRangeLabel").GetString());
    }

    [Fact]
    public async Task Volver_a_subir_el_mismo_export_ACTUALIZA_en_vez_de_duplicar()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/analyses", Payload(chatName: "Primera vez"));

        var second = await client.PostAsJsonAsync("/api/analyses", Payload(chatName: "Segunda vez"));

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        using var db = factory.NewDbContext();
        var stored = await db.Analyses.SingleAsync(item => item.UserId == user.Id);
        Assert.Equal("Segunda vez", stored.ChatName);
        Assert.True(stored.UpdatedAtUtc >= stored.CreatedAtUtc);
    }

    [Fact]
    public async Task Dos_chats_distintos_son_dos_filas()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        await client.PostAsJsonAsync("/api/analyses", Payload(sourceHash: new string('a', 64)));
        await client.PostAsJsonAsync("/api/analyses", Payload(sourceHash: new string('b', 64)));

        using var db = factory.NewDbContext();
        Assert.Equal(2, await db.Analyses.CountAsync(item => item.UserId == user.Id));
    }

    // -----------------------------------------------------------------------
    // Validación
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Rechaza_un_nombre_de_chat_vacio(string chatName)
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(chatName: chatName));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rechaza_resultados_vacios()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(resultsJson: ""));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("corto")]
    [InlineData("no-es-hexadecimal-pero-tiene-largo-suficiente-si-si-si")]
    public async Task Rechaza_un_sourceHash_con_forma_invalida(string sourceHash)
    {
        // El hash es clave de búsqueda Y de caché: una cadena libre deja generar un miss
        // nuevo en cada request y engorda el índice de paso.
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(sourceHash: sourceHash));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("0123456789abcdef")]
    [InlineData("0123456789ABCDEF0123456789abcdef")]
    public async Task Acepta_un_sourceHash_hexadecimal_de_16_a_64(string sourceHash)
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(sourceHash: sourceHash));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Rechaza_un_resultsJson_mas_grande_que_el_tope()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        var huge = new string('x', SavedAnalysisLimits.MaxResultsJsonChars + 1);

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(resultsJson: huge));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("too large", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Rechaza_un_nombre_de_chat_demasiado_largo()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        var longName = new string('x', SavedAnalysisLimits.MaxChatNameChars + 1);

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(chatName: longName));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rechaza_un_rango_de_fechas_demasiado_largo()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        var longRange = new string('x', SavedAnalysisLimits.MaxDateRangeLabelChars + 1);

        var response = await client.PostAsJsonAsync("/api/analyses", Payload(dateRange: longRange));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // -----------------------------------------------------------------------
    // Listado y aislamiento entre cuentas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Lista_vacia_para_una_cuenta_nueva()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var body = await ReadJson(await client.GetAsync("/api/analyses"));

        Assert.Equal(JsonValueKind.Array, body.ValueKind);
        Assert.Equal(0, body.GetArrayLength());
    }

    [Fact]
    public async Task Una_cuenta_NUNCA_ve_los_analisis_de_otra()
    {
        var (mine, _) = factory.CreateAuthenticatedClient();
        var (theirs, _) = factory.CreateAuthenticatedClient();
        await theirs.PostAsJsonAsync("/api/analyses", Payload(chatName: "Chat privado ajeno"));

        var body = await ReadJson(await mine.GetAsync("/api/analyses"));

        Assert.Equal(0, body.GetArrayLength());
    }

    [Fact]
    public async Task Lista_del_mas_reciente_al_mas_viejo()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/analyses", Payload(chatName: "Viejo", sourceHash: new string('c', 64)));
        await Task.Delay(15);
        await client.PostAsJsonAsync("/api/analyses", Payload(chatName: "Nuevo", sourceHash: new string('d', 64)));

        var body = await ReadJson(await client.GetAsync("/api/analyses"));

        Assert.Equal("Nuevo", body[0].GetProperty("chatName").GetString());
    }

    // -----------------------------------------------------------------------
    // Borrado
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Borrar_sin_sesion_es_401()
    {
        var response = await factory.CreateClient().DeleteAsync($"/api/analyses/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Borra_un_analisis_propio_y_devuelve_204()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        var created = await ReadJson(await client.PostAsJsonAsync("/api/analyses", Payload()));
        var id = created.GetProperty("id").GetGuid();

        var response = await client.DeleteAsync($"/api/analyses/{id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        using var db = factory.NewDbContext();
        Assert.Equal(0, await db.Analyses.CountAsync(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task Despues_de_borrar_el_analisis_ya_no_aparece_en_el_listado()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/analyses", Payload(chatName: "Queda", sourceHash: new string('a', 64)));
        var doomed = await ReadJson(
            await client.PostAsJsonAsync("/api/analyses", Payload(chatName: "Se va", sourceHash: new string('b', 64))));

        await client.DeleteAsync($"/api/analyses/{doomed.GetProperty("id").GetGuid()}");

        var body = await ReadJson(await client.GetAsync("/api/analyses"));
        Assert.Equal(1, body.GetArrayLength());
        Assert.Equal("Queda", body[0].GetProperty("chatName").GetString());
    }

    [Fact]
    public async Task Una_cuenta_NUNCA_puede_borrar_el_analisis_de_otra()
    {
        var (mine, _) = factory.CreateAuthenticatedClient();
        var (theirs, other) = factory.CreateAuthenticatedClient();
        var created = await ReadJson(await theirs.PostAsJsonAsync("/api/analyses", Payload()));

        var response = await mine.DeleteAsync($"/api/analyses/{created.GetProperty("id").GetGuid()}");

        // 404 y no 403: confirmar que ese id existe ya sería contar algo de la otra cuenta.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var db = factory.NewDbContext();
        Assert.Equal(1, await db.Analyses.CountAsync(item => item.UserId == other.Id));
    }

    [Fact]
    public async Task Borrar_algo_que_no_existe_es_404_con_codigo()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.DeleteAsync($"/api/analyses/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("analysis_not_found", (await ReadJson(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Borrar_hace_lugar_cuando_la_cuenta_llego_al_tope()
    {
        // El tope existe para que una cuenta no llene el volumen; sin borrado, llegar a él
        // dejaba al usuario sin ninguna salida.
        var (client, user) = factory.CreateAuthenticatedClient();
        var created = await ReadJson(await client.PostAsJsonAsync("/api/analyses", Payload()));

        await client.DeleteAsync($"/api/analyses/{created.GetProperty("id").GetGuid()}");
        var again = await client.PostAsJsonAsync("/api/analyses", Payload());

        Assert.Equal(HttpStatusCode.Created, again.StatusCode);
        using var db = factory.NewDbContext();
        Assert.Equal(1, await db.Analyses.CountAsync(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task El_listado_devuelve_todos_los_campos_que_el_cliente_usa()
    {
        var (client, _) = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/analyses", Payload());

        var item = (await ReadJson(await client.GetAsync("/api/analyses")))[0];

        foreach (var property in new[]
                 {
                     "id", "chatName", "dateRangeLabel", "messageCount", "participantCount",
                     "resultsJson", "sourceHash", "createdAtUtc", "updatedAtUtc",
                 })
        {
            Assert.True(item.TryGetProperty(property, out _), $"falta {property}");
        }
    }
}
