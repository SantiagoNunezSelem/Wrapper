using System.Security.Cryptography;
using System.Text;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace backend.Tests.Services;

/// <summary>
/// La frontera de seguridad de toda la facturación: el webhook es público y sin sesión,
/// y otorga y revoca acceso pagado. Cada test de acá describe una forma concreta en la
/// que una notificación forjada tiene que rebotar.
/// </summary>
public class MercadoPagoSignatureValidatorTests
{
    private const string Secret = "un-secreto-de-webhook-para-los-tests";

    private static MercadoPagoSignatureValidator Validator(string secret = Secret) =>
        new(
            Opt.Of(new MercadoPagoOptions { WebhookSecret = secret }),
            NullLogger<MercadoPagoSignatureValidator>.Instance);

    /// <summary>El manifiesto documentado: <c>id:{data.id};request-id:{x-request-id};ts:{ts};</c></summary>
    private static string Sign(string manifest, string secret = Secret) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(manifest)))
            .ToLowerInvariant();

    private static HttpRequest Request(string? signature, string? requestId = "req-1", string? query = null)
    {
        var context = new DefaultHttpContext();
        if (signature is not null)
        {
            context.Request.Headers["x-signature"] = signature;
        }
        if (requestId is not null)
        {
            context.Request.Headers["x-request-id"] = requestId;
        }
        if (query is not null)
        {
            context.Request.QueryString = new QueryString(query);
        }
        return context.Request;
    }

    private static string NowTs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();

    // -----------------------------------------------------------------------

    [Fact]
    public void Acepta_una_firma_valida()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        var result = Validator().Validate(Request($"ts={ts},v1={hash}"), "12345");

        Assert.True(result.IsValid);
        Assert.Null(result.Reason);
    }

    [Fact]
    public void Rechaza_todo_cuando_no_hay_secreto_configurado()
    {
        // Aceptar sin verificar "hasta que carguen el secreto" es exactamente el estado
        // en el que un webhook forjado funciona.
        var ts = NowTs();

        var result = Validator(secret: "").Validate(Request($"ts={ts},v1=loquesea"), "12345");

        Assert.False(result.IsValid);
        Assert.Contains("WebhookSecret", result.Reason);
    }

    [Fact]
    public void IsConfigured_refleja_si_hay_secreto()
    {
        Assert.True(Validator().IsConfigured);
        Assert.False(Validator(secret: "   ").IsConfigured);
    }

    [Fact]
    public void Rechaza_sin_encabezado_x_signature()
    {
        var result = Validator().Validate(Request(null), "12345");

        Assert.False(result.IsValid);
        Assert.Contains("Missing x-signature", result.Reason);
    }

    [Theory]
    [InlineData("v1=abc")]
    [InlineData("ts=123")]
    [InlineData("basura")]
    [InlineData("=sinclave")]
    public void Rechaza_una_firma_incompleta(string signature)
    {
        var result = Validator().Validate(Request(signature), "12345");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Rechaza_un_hash_que_no_coincide()
    {
        var ts = NowTs();

        var result = Validator().Validate(Request($"ts={ts},v1={new string('a', 64)}"), "12345");

        Assert.False(result.IsValid);
        Assert.Equal("Signature mismatch.", result.Reason);
    }

    [Fact]
    public void Rechaza_una_firma_hecha_con_otro_secreto()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};", "el-secreto-del-atacante");

        var result = Validator().Validate(Request($"ts={ts},v1={hash}"), "12345");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Rechaza_una_firma_valida_reapuntada_a_otro_recurso()
    {
        // Reusar la firma de la notificación de otra suscripción es el ataque obvio.
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        var result = Validator().Validate(Request($"ts={ts},v1={hash}"), "99999");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Rechaza_una_notificacion_vieja()
    {
        var stale = DateTimeOffset.UtcNow.AddMinutes(-20).ToUnixTimeMilliseconds().ToString();
        var hash = Sign($"id:12345;request-id:req-1;ts:{stale};");

        var result = Validator().Validate(Request($"ts={stale},v1={hash}"), "12345");

        Assert.False(result.IsValid);
        Assert.Contains("outside the accepted window", result.Reason);
    }

    [Fact]
    public void Rechaza_una_notificacion_del_futuro()
    {
        var ahead = DateTimeOffset.UtcNow.AddMinutes(20).ToUnixTimeMilliseconds().ToString();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ahead};");

        var result = Validator().Validate(Request($"ts={ahead},v1={hash}"), "12345");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Tolera_la_deriva_de_reloj_dentro_de_la_ventana()
    {
        var drifted = DateTimeOffset.UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds().ToString();
        var hash = Sign($"id:12345;request-id:req-1;ts:{drifted};");

        Assert.True(Validator().Validate(Request($"ts={drifted},v1={hash}"), "12345").IsValid);
    }

    [Fact]
    public void Acepta_el_timestamp_en_segundos_de_las_integraciones_viejas()
    {
        var seconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var hash = Sign($"id:12345;request-id:req-1;ts:{seconds};");

        Assert.True(Validator().Validate(Request($"ts={seconds},v1={hash}"), "12345").IsValid);
    }

    [Fact]
    public void Rechaza_un_timestamp_que_no_es_un_numero()
    {
        var result = Validator().Validate(Request("ts=ayer,v1=abc"), "12345");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Omite_del_manifiesto_las_partes_ausentes()
    {
        // Documentado así: los pares sin valor no viajan vacíos, se van del manifiesto.
        var ts = NowTs();
        var hash = Sign($"ts:{ts};");

        var result = Validator().Validate(Request($"ts={ts},v1={hash}", requestId: null), dataId: null);

        Assert.True(result.IsValid);
    }

    [Fact]
    public void El_data_id_entra_al_manifiesto_en_minusculas()
    {
        var ts = NowTs();
        var hash = Sign($"id:abc-def;request-id:req-1;ts:{ts};");

        Assert.True(Validator().Validate(Request($"ts={ts},v1={hash}"), "ABC-DEF").IsValid);
    }

    [Fact]
    public void El_hash_recibido_se_compara_sin_distinguir_mayusculas()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};").ToUpperInvariant();

        Assert.True(Validator().Validate(Request($"ts={ts},v1={hash}"), "12345").IsValid);
    }

    [Fact]
    public void Tolera_espacios_y_orden_invertido_en_el_encabezado()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        Assert.True(Validator().Validate(Request($" v1 = {hash} , ts = {ts} "), "12345").IsValid);
    }

    [Fact]
    public void Las_claves_del_encabezado_no_distinguen_mayusculas()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        Assert.True(Validator().Validate(Request($"TS={ts},V1={hash}"), "12345").IsValid);
    }

    // -----------------------------------------------------------------------
    // De dónde sale el id del manifiesto
    //
    // Mercado Pago firma el id TAL COMO VIAJA EN LA QUERY (su plantilla dice
    // literalmente `id:[data.id_url]`), no el que va adentro del JSON. Casi siempre son
    // el mismo valor, pero cuando no lo son la diferencia no es cosmética: el hash no
    // coincide, la notificación se contesta 401, Mercado Pago la reintenta hasta
    // rendirse, y una suscripción realmente pagada se queda en "pendiente" para siempre.
    // -----------------------------------------------------------------------

    [Fact]
    public void Firma_contra_el_data_id_de_la_query_y_no_contra_el_del_cuerpo()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        // El cuerpo dice otra cosa; manda la query, que es lo que ellos firmaron.
        var result = Validator().Validate(Request($"ts={ts},v1={hash}", query: "?data.id=12345&type=payment"), "99999");

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Acepta_la_forma_IPN_en_la_que_Mercado_Pago_no_manda_data_id()
    {
        // `?topic=…&id=…` sin `data.id`: la plantilla documentada se queda SIN la parte
        // `id:`. Firmar igual con el id del cuerpo es rechazar una notificación legítima.
        var ts = NowTs();
        var hash = Sign($"request-id:req-1;ts:{ts};");

        var result = Validator().Validate(
            Request($"ts={ts},v1={hash}", query: "?topic=preapproval&id=pre-1"),
            "pre-1");

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Toma_el_id_suelto_de_la_query_cuando_no_hay_data_id()
    {
        var ts = NowTs();
        var hash = Sign($"id:pre-1;request-id:req-1;ts:{ts};");

        var result = Validator().Validate(
            Request($"ts={ts},v1={hash}", query: "?topic=preapproval&id=pre-1"),
            "pre-1");

        Assert.True(result.IsValid);
    }

    [Fact]
    public void Con_id_en_la_query_no_acepta_un_manifiesto_sin_id()
    {
        // La tolerancia con el manifiesto sin `id:` es sólo para cuando Mercado Pago
        // tampoco lo manda. Si viaja en la query, omitirlo sería aflojar la firma.
        var ts = NowTs();
        var hash = Sign($"request-id:req-1;ts:{ts};");

        var result = Validator().Validate(Request($"ts={ts},v1={hash}", query: "?data.id=12345"), "12345");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Sigue_rechazando_la_firma_de_otro_recurso_aunque_venga_por_query()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        var result = Validator().Validate(Request($"ts={ts},v1={hash}", query: "?data.id=99999"), "99999");

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Ignora_las_claves_que_no_conoce()
    {
        var ts = NowTs();
        var hash = Sign($"id:12345;request-id:req-1;ts:{ts};");

        Assert.True(Validator().Validate(Request($"ts={ts},v1={hash},v2=algo"), "12345").IsValid);
    }
}
