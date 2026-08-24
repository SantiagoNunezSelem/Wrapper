using System.Net;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;

namespace backend.Tests.Services;

/// <summary>
/// Convierte una request en los hashes con los que el registro de trials decide si ya
/// vio a este visitante. Dos propiedades importan y se prueban por separado: la
/// dirección cruda nunca se guarda, y los encabezados de proxy sólo se creen cuando el
/// despliegue lo declara — si no, cualquiera se regala un trial nuevo mandando
/// <c>X-Forwarded-For</c>.
/// </summary>
public class ClientFingerprintTests
{
    private static ClientFingerprint Build(TrialGuardOptions? options = null, string signingKey = "clave-de-firma-de-los-tests") =>
        new(
            Opt.Of(options ?? new TrialGuardOptions()),
            Opt.Of(new JwtOptions { SigningKey = signingKey }));

    private static HttpContext Context(string? remoteIp = "203.0.113.7", params (string Name, string Value)[] headers)
    {
        var context = new DefaultHttpContext();
        if (remoteIp is not null)
        {
            context.Connection.RemoteIpAddress = IPAddress.Parse(remoteIp);
        }
        foreach (var (name, value) in headers)
        {
            context.Request.Headers[name] = value;
        }
        return context;
    }

    // -----------------------------------------------------------------------
    // Sin confiar en el proxy (default)
    // -----------------------------------------------------------------------

    [Fact]
    public void Usa_la_direccion_del_socket()
    {
        var identity = Build().Describe(Context(), null);

        Assert.NotNull(identity.IpHash);
        Assert.NotNull(identity.SubnetHash);
    }

    [Fact]
    public void Nunca_guarda_la_direccion_en_claro()
    {
        var identity = Build().Describe(Context("203.0.113.7"), "device-abc");

        Assert.DoesNotContain("203.0.113.7", identity.IpHash);
        Assert.DoesNotContain("203.0.113", identity.SubnetHash);
        Assert.DoesNotContain("device-abc", identity.DeviceHash);
    }

    [Fact]
    public void Los_hashes_son_hexadecimales_de_64_caracteres()
    {
        var identity = Build().Describe(Context(), "device-abc");

        Assert.Matches("^[0-9a-f]{64}$", identity.IpHash);
        Assert.Matches("^[0-9a-f]{64}$", identity.SubnetHash);
        Assert.Matches("^[0-9a-f]{64}$", identity.DeviceHash);
    }

    [Fact]
    public void IGNORA_el_X_Forwarded_For_cuando_no_se_confia_en_el_proxy()
    {
        var direct = Build().Describe(Context("203.0.113.7"), null);
        var forged = Build().Describe(Context("203.0.113.7", ("X-Forwarded-For", "1.2.3.4")), null);

        Assert.Equal(direct.IpHash, forged.IpHash);
    }

    [Fact]
    public void No_reporta_pais_cuando_no_se_confia_en_el_proxy()
    {
        var identity = Build().Describe(Context("203.0.113.7", ("CF-IPCountry", "AR")), null);

        Assert.Null(identity.CountryCode);
    }

    // -----------------------------------------------------------------------
    // Confiando en el proxy
    // -----------------------------------------------------------------------

    private static ClientFingerprint Trusting() => Build(new TrialGuardOptions { TrustProxyHeaders = true });

    [Fact]
    public void Con_proxy_confiable_lee_el_X_Forwarded_For()
    {
        var viaProxy = Trusting().Describe(Context("10.0.0.1", ("X-Forwarded-For", "203.0.113.7")), null);
        var direct = Trusting().Describe(Context("203.0.113.7"), null);

        Assert.Equal(direct.IpHash, viaProxy.IpHash);
    }

    [Fact]
    public void Toma_la_entrada_de_mas_a_la_izquierda_de_la_cadena()
    {
        var identity = Trusting().Describe(Context("10.0.0.1", ("X-Forwarded-For", "203.0.113.7, 10.0.0.5, 10.0.0.1")), null);
        var expected = Trusting().Describe(Context("203.0.113.7"), null);

        Assert.Equal(expected.IpHash, identity.IpHash);
    }

    [Fact]
    public void Descarta_el_puerto_que_agregan_algunos_proxies()
    {
        var withPort = Trusting().Describe(Context("10.0.0.1", ("X-Forwarded-For", "203.0.113.7:51234")), null);
        var plain = Trusting().Describe(Context("203.0.113.7"), null);

        Assert.Equal(plain.IpHash, withPort.IpHash);
    }

    [Fact]
    public void Cae_al_socket_si_el_encabezado_no_es_una_direccion()
    {
        var garbage = Trusting().Describe(Context("203.0.113.7", ("X-Forwarded-For", "no-es-una-ip")), null);
        var direct = Trusting().Describe(Context("203.0.113.7"), null);

        Assert.Equal(direct.IpHash, garbage.IpHash);
    }

    [Fact]
    public void Cae_al_socket_con_el_encabezado_vacio()
    {
        var empty = Trusting().Describe(Context("203.0.113.7", ("X-Forwarded-For", "")), null);
        var direct = Trusting().Describe(Context("203.0.113.7"), null);

        Assert.Equal(direct.IpHash, empty.IpHash);
    }

    [Theory]
    [InlineData("CF-IPCountry")]
    [InlineData("X-Vercel-IP-Country")]
    [InlineData("CloudFront-Viewer-Country")]
    [InlineData("X-Country-Code")]
    public void Lee_el_pais_de_los_encabezados_de_CDN_conocidos(string header)
    {
        var identity = Trusting().Describe(Context("203.0.113.7", (header, "ar")), null);

        Assert.Equal("AR", identity.CountryCode);
    }

    [Theory]
    [InlineData("ARG")]
    [InlineData("A")]
    [InlineData("")]
    public void Descarta_un_pais_que_no_sea_de_dos_letras(string value)
    {
        var identity = Trusting().Describe(Context("203.0.113.7", ("CF-IPCountry", value)), null);

        Assert.Null(identity.CountryCode);
    }

    // -----------------------------------------------------------------------
    // Normalización y subredes
    // -----------------------------------------------------------------------

    [Fact]
    public void Un_IPv4_mapeado_a_IPv6_hashea_igual_que_el_IPv4()
    {
        // Es lo que reporta un socket dual-stack para un cliente IPv4.
        var mapped = Build().Describe(Context("::ffff:203.0.113.7"), null);
        var plain = Build().Describe(Context("203.0.113.7"), null);

        Assert.Equal(plain.IpHash, mapped.IpHash);
    }

    [Fact]
    public void Dos_direcciones_del_mismo_bloque_24_comparten_subred_pero_no_IP()
    {
        var first = Build().Describe(Context("203.0.113.7"), null);
        var second = Build().Describe(Context("203.0.113.200"), null);

        Assert.Equal(first.SubnetHash, second.SubnetHash);
        Assert.NotEqual(first.IpHash, second.IpHash);
    }

    [Fact]
    public void Dos_bloques_24_distintos_no_comparten_subred()
    {
        var first = Build().Describe(Context("203.0.113.7"), null);
        var second = Build().Describe(Context("203.0.114.7"), null);

        Assert.NotEqual(first.SubnetHash, second.SubnetHash);
    }

    [Fact]
    public void IPv6_agrupa_por_bloque_48()
    {
        var first = Build().Describe(Context("2001:db8:1234:5678::1"), null);
        var second = Build().Describe(Context("2001:db8:1234:9999::2"), null);
        var other = Build().Describe(Context("2001:db8:9999:5678::1"), null);

        Assert.Equal(first.SubnetHash, second.SubnetHash);
        Assert.NotEqual(first.SubnetHash, other.SubnetHash);
    }

    [Fact]
    public void Sin_direccion_no_hay_hash_de_IP_ni_de_subred()
    {
        var identity = Build().Describe(Context(remoteIp: null), "device-abc");

        Assert.Null(identity.IpHash);
        Assert.Null(identity.SubnetHash);
        Assert.NotNull(identity.DeviceHash);
    }

    // -----------------------------------------------------------------------
    // Device id y sal
    // -----------------------------------------------------------------------

    [Fact]
    public void Sin_device_id_no_hay_hash_de_dispositivo()
    {
        Assert.Null(Build().Describe(Context(), null).DeviceHash);
        Assert.Null(Build().Describe(Context(), "   ").DeviceHash);
    }

    [Fact]
    public void El_device_id_se_recorta_antes_de_hashear()
    {
        var padded = Build().Describe(Context(), "  device-abc  ");
        var clean = Build().Describe(Context(), "device-abc");

        Assert.Equal(clean.DeviceHash, padded.DeviceHash);
    }

    [Fact]
    public void El_mismo_visitante_hashea_igual_en_dos_requests()
    {
        var first = Build().Describe(Context("203.0.113.7"), "device-abc");
        var second = Build().Describe(Context("203.0.113.7"), "device-abc");

        Assert.Equal(first.IpHash, second.IpHash);
        Assert.Equal(first.DeviceHash, second.DeviceHash);
    }

    [Fact]
    public void La_IP_y_el_dispositivo_no_colisionan_entre_si()
    {
        // Los prefijos "ip:" / "net:" / "device:" existen justamente para esto.
        var identity = Build().Describe(Context("203.0.113.7"), "203.0.113.7");

        Assert.NotEqual(identity.IpHash, identity.DeviceHash);
        Assert.NotEqual(identity.IpHash, identity.SubnetHash);
    }

    [Fact]
    public void Una_sal_propia_cambia_todos_los_hashes()
    {
        var withJwtKey = Build().Describe(Context("203.0.113.7"), "device-abc");
        var withOwnSalt = Build(new TrialGuardOptions { HashSalt = "otra-sal-distinta" })
            .Describe(Context("203.0.113.7"), "device-abc");

        Assert.NotEqual(withJwtKey.IpHash, withOwnSalt.IpHash);
    }

    [Fact]
    public void Sin_sal_propia_cae_a_la_clave_de_firma_del_JWT()
    {
        var first = Build(signingKey: "clave-uno").Describe(Context("203.0.113.7"), null);
        var second = Build(signingKey: "clave-dos").Describe(Context("203.0.113.7"), null);

        Assert.NotEqual(first.IpHash, second.IpHash);
    }
}
