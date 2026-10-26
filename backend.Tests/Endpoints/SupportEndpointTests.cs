using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using backend.Models;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace backend.Tests.Endpoints;

/// <summary>
/// La página de ayuda y los términos, por HTTP. Lo que importa: un reporte sólo lo manda
/// una cuenta con sesión, queda en la base (no sale ningún mail) y el panel lo ve y lo
/// cierra; y aceptar los términos deja registrada la edición y la fecha una sola vez.
/// </summary>
public sealed class SupportEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static object ValidReport(string email = "ana@example.com") => new
    {
        contactEmail = email,
        category = "pagos",
        description = "Pagué la suscripción y la app me sigue mostrando el plan gratis.",
        viewport = "390x844",
        language = "es",
    };

    [Fact]
    public async Task Sin_sesion_no_se_puede_mandar_un_reporte()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/support/reports", ValidReport());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Un_reporte_valido_queda_guardado_con_el_navegador_y_el_estado_de_la_cuenta()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("TestBrowser/1.0");

        var response = await client.PostAsJsonAsync("/api/support/reports", ValidReport("otro.mail@example.com"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var id = (await ReadJson(response)).GetProperty("id").GetGuid();

        using var db = factory.NewDbContext();
        var report = await db.SupportReports.SingleAsync(item => item.Id == id);
        Assert.Equal(user.Id, report.UserId);
        Assert.Equal("otro.mail@example.com", report.ContactEmail);
        Assert.Equal(SupportReportCategories.Payments, report.Category);
        Assert.Equal(SupportReportStatuses.Open, report.Status);
        Assert.Equal("390x844", report.Viewport);
        Assert.Contains("TestBrowser/1.0", report.UserAgent);
        Assert.Equal("inactiva", report.SubscriptionState);
    }

    [Theory]
    [InlineData("no-es-un-mail", "pagos", "Una descripción suficientemente larga.", "invalid_email")]
    [InlineData("Ana <ana@example.com>", "pagos", "Una descripción suficientemente larga.", "invalid_email")]
    [InlineData("ana@example.com", "inventada", "Una descripción suficientemente larga.", "invalid_category")]
    [InlineData("ana@example.com", "pagos", "corta", "description_too_short")]
    public async Task Un_reporte_incompleto_se_rechaza_con_un_codigo(string email, string category, string description, string code)
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/support/reports", new { contactEmail = email, category, description });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(code, (await ReadJson(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Una_descripcion_demasiado_larga_se_rechaza()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync(
            "/api/support/reports",
            new { contactEmail = "ana@example.com", category = "otro", description = new string('a', 4001) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("description_too_long", (await ReadJson(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Un_cliente_que_insiste_con_pedidos_invalidos_termina_frenado_por_el_limitador_de_la_ruta()
    {
        // La red de abajo de los topes de verdad: cuenta todo pedido, válido o no.
        var (client, _) = factory.CreateAuthenticatedClient();
        var invalid = new { contactEmail = "no-es-un-mail", category = "pagos", description = "Una descripción suficientemente larga." };

        for (var attempt = 0; attempt < 20; attempt++)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/support/reports", invalid)).StatusCode);
        }

        var next = await client.PostAsJsonAsync("/api/support/reports", invalid);

        Assert.Equal(HttpStatusCode.TooManyRequests, next.StatusCode);
    }

    // -------------------------------------------------------------------------
    // Códigos y topes: dos por día, cinco por semana
    // -------------------------------------------------------------------------

    /// <summary>Deja reportes viejos de la cuenta, con la antigüedad y el estado que se pidan. Devuelve sus códigos.</summary>
    private List<string> SeedReports(Guid userId, params (double HoursAgo, string Status)[] reports)
    {
        using var db = factory.NewDbContext();
        var codes = new List<string>();

        foreach (var (hoursAgo, status) in reports)
        {
            var code = TicketCodes.Generate();
            db.SupportReports.Add(new SupportReport
            {
                UserId = userId,
                TicketCode = code,
                ContactEmail = "ana@example.com",
                Category = SupportReportCategories.Other,
                Description = "Un reporte anterior, de prueba.",
                Status = status,
                CreatedAtUtc = DateTime.UtcNow.AddHours(-hoursAgo),
            });
            codes.Add(code);
        }

        db.SaveChanges();
        return codes;
    }

    private static async Task<string> SendAndReadCode(HttpClient client) =>
        (await ReadJson(await client.PostAsJsonAsync("/api/support/reports", ValidReport()))).GetProperty("ticketCode").GetString()!;

    [Fact]
    public async Task Cada_reporte_recibe_un_codigo_corto_y_distinto_y_se_lo_devuelve_a_quien_lo_mando()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        var first = await SendAndReadCode(client);
        var second = await SendAndReadCode(client);

        Assert.NotEqual(first, second);
        foreach (var code in new[] { first, second })
        {
            Assert.Equal(TicketCodes.Length, code.Length);
            Assert.All(code, character => Assert.Contains(character, TicketCodes.Alphabet));
        }

        using var db = factory.NewDbContext();
        var stored = await db.SupportReports.Where(item => item.UserId == user.Id).Select(item => item.TicketCode).ToListAsync();
        Assert.Equivalent(new[] { first, second }, stored);
    }

    [Fact]
    public async Task El_tercer_reporte_en_un_dia_se_rechaza_con_el_codigo_que_ya_tiene_y_no_se_guarda()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/support/reports", ValidReport());
        var latest = await SendAndReadCode(client);

        var third = await client.PostAsJsonAsync("/api/support/reports", ValidReport());

        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        var body = await ReadJson(third);
        Assert.Equal("daily_limit", body.GetProperty("code").GetString());
        Assert.Equal(latest, body.GetProperty("ticketCode").GetString());
        Assert.Equal("nuevo", body.GetProperty("ticketStatus").GetString());
        Assert.Contains(latest, body.GetProperty("message").GetString());
        Assert.Contains("monitore", body.GetProperty("message").GetString());
        // Un código, no un "ticket #N": no hay número que le diga a nadie cuántos escribieron antes.
        Assert.DoesNotContain("#", body.GetProperty("message").GetString());

        using var db = factory.NewDbContext();
        Assert.Equal(2, await db.SupportReports.CountAsync(item => item.UserId == user.Id));
    }

    [Fact]
    public async Task El_tope_diario_se_libera_cuando_los_reportes_cumplen_24_horas()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        SeedReports(user.Id, (25, "nuevo"), (26, "nuevo"));

        var response = await client.PostAsJsonAsync("/api/support/reports", ValidReport());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Con_un_solo_reporte_en_el_dia_todavia_se_puede_mandar_otro()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        SeedReports(user.Id, (2, "nuevo"), (30, "nuevo"));

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/support/reports", ValidReport())).StatusCode);
    }

    [Fact]
    public async Task El_sexto_reporte_en_una_semana_se_rechaza_aunque_ninguno_sea_de_hoy()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        // Cinco en la semana, uno solo en las últimas 24 horas: no alcanza el tope diario.
        var codes = SeedReports(user.Id, (2, "resuelto"), (26, "resuelto"), (50, "resuelto"), (74, "resuelto"), (98, "resuelto"));

        var response = await client.PostAsJsonAsync("/api/support/reports", ValidReport());

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        var body = await ReadJson(response);
        Assert.Equal("weekly_limit", body.GetProperty("code").GetString());
        Assert.Equal(codes[0], body.GetProperty("ticketCode").GetString());
    }

    [Fact]
    public async Task El_tope_semanal_se_libera_cuando_el_mas_viejo_pasa_los_7_dias()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        SeedReports(user.Id, (2, "nuevo"), (26, "nuevo"), (50, "nuevo"), (74, "nuevo"), (7 * 24 + 1, "nuevo"));

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/support/reports", ValidReport())).StatusCode);
    }

    [Fact]
    public async Task El_rechazo_cita_el_codigo_abierto_mas_reciente_y_no_uno_resuelto_mas_nuevo()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        // Orden de llegada: abierto (hace 5 h), resuelto (hace 1 h). Los dos cuentan para el día.
        var codes = SeedReports(user.Id, (5, "nuevo"), (1, "resuelto"));

        var body = await ReadJson(await client.PostAsJsonAsync("/api/support/reports", ValidReport()));

        Assert.Equal("daily_limit", body.GetProperty("code").GetString());
        Assert.Equal(codes[0], body.GetProperty("ticketCode").GetString());
        Assert.Equal("nuevo", body.GetProperty("ticketStatus").GetString());
    }

    [Fact]
    public async Task Si_todos_estan_resueltos_el_rechazo_cita_el_mas_reciente_y_dice_que_figura_como_resuelto()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        var codes = SeedReports(user.Id, (5, "resuelto"), (1, "resuelto"));

        var body = await ReadJson(await client.PostAsJsonAsync("/api/support/reports", ValidReport()));

        Assert.Equal(codes[1], body.GetProperty("ticketCode").GetString());
        Assert.Equal("resuelto", body.GetProperty("ticketStatus").GetString());
        Assert.Contains("figura como resuelta", body.GetProperty("message").GetString());
        Assert.Contains(codes[1], body.GetProperty("message").GetString());
        Assert.DoesNotContain("monitore", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Los_topes_son_por_cuenta_otra_cuenta_no_se_ve_afectada()
    {
        var (_, busy) = factory.CreateAuthenticatedClient();
        SeedReports(busy.Id, (1, "nuevo"), (2, "nuevo"));
        var (other, _) = factory.CreateAuthenticatedClient();

        Assert.Equal(HttpStatusCode.OK, (await other.PostAsJsonAsync("/api/support/reports", ValidReport())).StatusCode);
    }

    [Fact]
    public async Task Quien_esta_en_el_tope_escucha_eso_antes_que_los_errores_del_formulario()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        SeedReports(user.Id, (1, "nuevo"), (2, "nuevo"));

        var response = await client.PostAsJsonAsync("/api/support/reports", new { contactEmail = "no-es-un-mail", category = "x", description = "corta" });

        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
    }

    [Fact]
    public async Task El_admin_ve_el_reporte_y_lo_puede_cerrar_y_reabrir()
    {
        var (userClient, user) = factory.CreateAuthenticatedClient();
        var sent = await ReadJson(await userClient.PostAsJsonAsync("/api/support/reports", ValidReport()));
        var id = sent.GetProperty("id").GetGuid();
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var page = await ReadJson(await admin.GetAsync("/api/admin/support-reports?status=nuevo"));
        var row = page.GetProperty("items").EnumerateArray().Single(item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal(sent.GetProperty("ticketCode").GetString(), row.GetProperty("ticketCode").GetString());
        Assert.Equal(user.Email, row.GetProperty("accountEmail").GetString());
        Assert.Equal("ana@example.com", row.GetProperty("contactEmail").GetString());
        Assert.True(page.GetProperty("countsByStatus").GetProperty("nuevo").GetInt32() >= 1);

        var resolved = await admin.PostAsJsonAsync($"/api/admin/support-reports/{id}/status", new { status = "resuelto" });
        Assert.Equal(HttpStatusCode.OK, resolved.StatusCode);
        var resolvedBody = await ReadJson(resolved);
        Assert.Equal("resuelto", resolvedBody.GetProperty("status").GetString());
        Assert.NotEqual(JsonValueKind.Null, resolvedBody.GetProperty("resolvedAtUtc").ValueKind);

        var reopened = await ReadJson(await admin.PostAsJsonAsync($"/api/admin/support-reports/{id}/status", new { status = "nuevo" }));
        Assert.Equal("nuevo", reopened.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, reopened.GetProperty("resolvedAtUtc").ValueKind);

        using var db = factory.NewDbContext();
        var actions = await db.AdminAuditEvents.Where(item => item.TargetUserId == user.Id).Select(item => item.Action).ToListAsync();
        Assert.Contains("report_resolved", actions);
        Assert.Contains("report_reopened", actions);
    }

    [Fact]
    public async Task Un_estado_inventado_se_rechaza_y_un_reporte_inexistente_es_404()
    {
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var invalid = await admin.PostAsJsonAsync($"/api/admin/support-reports/{Guid.NewGuid()}/status", new { status = "borrado" });
        var missing = await admin.PostAsJsonAsync($"/api/admin/support-reports/{Guid.NewGuid()}/status", new { status = "resuelto" });

        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Los_reportes_abiertos_aparecen_en_urgencias()
    {
        var (userClient, _) = factory.CreateAuthenticatedClient();
        await userClient.PostAsJsonAsync("/api/support/reports", ValidReport());
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var body = await ReadJson(await admin.GetAsync("/api/admin/urgencies"));

        var item = body.GetProperty("items").EnumerateArray().Single(entry => entry.GetProperty("kind").GetString() == "support_reports");
        Assert.True(item.GetProperty("count").GetInt32() >= 1);
    }

    // -------------------------------------------------------------------------
    // Términos y condiciones
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Una_cuenta_nueva_no_acepto_ningun_termino()
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var me = await ReadJson(await client.GetAsync("/api/auth/me"));

        Assert.Equal(JsonValueKind.Null, me.GetProperty("acceptedTermsVersion").ValueKind);
    }

    [Fact]
    public async Task Aceptar_los_terminos_guarda_la_edicion_y_la_fecha_una_sola_vez()
    {
        var (client, user) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/user/terms", new { version = "2026-10-25" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("2026-10-25", (await ReadJson(response)).GetProperty("acceptedTermsVersion").GetString());

        DateTime? firstAcceptance;
        using (var db = factory.NewDbContext())
        {
            firstAcceptance = (await db.Users.SingleAsync(item => item.Id == user.Id)).TermsAcceptedAtUtc;
        }
        Assert.NotNull(firstAcceptance);

        await client.PostAsJsonAsync("/api/user/terms", new { version = "2026-10-25" });

        using var reread = factory.NewDbContext();
        Assert.Equal(firstAcceptance, (await reread.Users.SingleAsync(item => item.Id == user.Id)).TermsAcceptedAtUtc);
        Assert.Equal("2026-10-25", (await ReadJson(await client.GetAsync("/api/auth/me"))).GetProperty("acceptedTermsVersion").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("v2")]
    [InlineData("2026-13-40")]
    [InlineData("2026-10-25; DROP TABLE Users")]
    public async Task Una_edicion_que_no_es_una_fecha_se_rechaza(string version)
    {
        var (client, _) = factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/user/terms", new { version });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Sin_sesion_no_se_aceptan_terminos()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/user/terms", new { version = "2026-10-25" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task La_ficha_del_admin_muestra_cuando_acepto_los_terminos()
    {
        var (client, user) = factory.CreateAuthenticatedClient();
        await client.PostAsJsonAsync("/api/user/terms", new { version = "2026-10-25" });
        var (admin, _) = factory.CreateAuthenticatedClient(isAdmin: true);

        var detail = await ReadJson(await admin.GetAsync($"/api/admin/users/{user.Id}"));

        Assert.Equal("2026-10-25", detail.GetProperty("termsVersion").GetString());
        Assert.NotEqual(JsonValueKind.Null, detail.GetProperty("termsAcceptedAtUtc").ValueKind);
    }
}
