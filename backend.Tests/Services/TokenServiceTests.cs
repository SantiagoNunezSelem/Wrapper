using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.IdentityModel.Tokens;

namespace backend.Tests.Services;

/// <summary>
/// El token que la API acepta como prueba de identidad en todo lo demás. Lo que
/// interesa: que lleve el id de usuario que el resto del código lee, que caduque, y
/// que no se pueda validar con otra clave.
/// </summary>
public class TokenServiceTests
{
    private static readonly JwtOptions Defaults = new()
    {
        Issuer = "WrapperCrm.Api",
        Audience = "WrapperCrm.Frontend",
        SigningKey = "una-clave-de-firma-suficientemente-larga-para-hs256",
        ExpirationMinutes = 720,
    };

    private static TokenService Service(JwtOptions? options = null) => new(Opt.Of(options ?? Defaults));

    private static User SampleUser(bool isAdmin = false) => new()
    {
        Email = "ana@example.com",
        DisplayName = "Ana",
        IsAdmin = isAdmin,
    };

    private static JwtSecurityToken Read(string token) => new JwtSecurityTokenHandler().ReadJwtToken(token);

    [Fact]
    public void Emite_un_JWT_de_tres_partes()
    {
        var token = Service().Create(SampleUser());

        Assert.Equal(3, token.Split('.').Length);
    }

    [Fact]
    public void Lleva_el_id_del_usuario_en_el_claim_que_lee_la_API()
    {
        var user = SampleUser();

        var claims = Read(Service().Create(user)).Claims.ToList();

        // GetRequiredUserId() lee exactamente este claim; si cambia, todo lo autenticado
        // empieza a devolver 401.
        var subject = claims.Single(claim => claim.Type == ClaimTypes.NameIdentifier || claim.Type == "nameid");
        Assert.Equal(user.Id.ToString(), subject.Value);
    }

    [Fact]
    public void Lleva_el_email_y_el_nombre()
    {
        var claims = Read(Service().Create(SampleUser())).Claims.ToList();

        Assert.Contains(claims, claim => claim.Value == "ana@example.com");
        Assert.Contains(claims, claim => claim.Value == "Ana");
    }

    [Fact]
    public void Un_usuario_comun_no_lleva_el_rol_admin()
    {
        var claims = Read(Service().Create(SampleUser())).Claims.ToList();

        Assert.DoesNotContain(claims, claim => claim.Value == "admin");
    }

    [Fact]
    public void Un_admin_lleva_el_rol_admin()
    {
        var claims = Read(Service().Create(SampleUser(isAdmin: true))).Claims.ToList();

        Assert.Contains(claims, claim => claim.Value == "admin");
    }

    [Fact]
    public void Lleva_el_emisor_y_la_audiencia_configurados()
    {
        var token = Read(Service().Create(SampleUser()));

        Assert.Equal("WrapperCrm.Api", token.Issuer);
        Assert.Contains("WrapperCrm.Frontend", token.Audiences);
    }

    [Fact]
    public void Caduca_a_los_minutos_configurados()
    {
        var token = Read(Service(new JwtOptions { SigningKey = Defaults.SigningKey, ExpirationMinutes = 30 }).Create(SampleUser()));

        var minutes = (token.ValidTo - DateTime.UtcNow).TotalMinutes;
        Assert.InRange(minutes, 28, 31);
    }

    [Fact]
    public void Se_firma_con_HS256()
    {
        Assert.Equal(SecurityAlgorithms.HmacSha256, Read(Service().Create(SampleUser())).SignatureAlgorithm);
    }

    [Fact]
    public void Valida_contra_la_clave_configurada()
    {
        var token = Service().Create(SampleUser());

        var principal = new JwtSecurityTokenHandler().ValidateToken(token, Parameters(Defaults.SigningKey), out _);

        Assert.Equal(SampleUser().Email.Length, principal.FindFirstValue(ClaimTypes.Email)!.Length);
    }

    [Fact]
    public void NO_valida_contra_otra_clave()
    {
        var token = Service().Create(SampleUser());

        Assert.Throws<SecurityTokenSignatureKeyNotFoundException>(() =>
            new JwtSecurityTokenHandler().ValidateToken(token, Parameters("otra-clave-de-firma-igual-de-larga-pero-distinta"), out _));
    }

    [Fact]
    public void NO_valida_si_le_pegan_el_payload_de_otro_usuario()
    {
        // El ataque realista: quedarse con una firma válida y cambiarle el cuerpo para
        // hacerse pasar por otra cuenta.
        var service = Service();
        var mine = service.Create(SampleUser()).Split('.');
        var theirs = service.Create(SampleUser()).Split('.');
        var spliced = $"{mine[0]}.{theirs[1]}.{mine[2]}";

        Assert.ThrowsAny<SecurityTokenException>(() =>
            new JwtSecurityTokenHandler().ValidateToken(spliced, Parameters(Defaults.SigningKey), out _));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-10)]
    public void Una_expiración_no_positiva_falla_al_emitir_en_vez_de_producir_un_token_eterno(int minutes)
    {
        var service = Service(new JwtOptions { SigningKey = Defaults.SigningKey, ExpirationMinutes = minutes });

        Assert.Throws<ArgumentException>(() => service.Create(SampleUser()));
    }

    [Fact]
    public void El_token_recién_emitido_todavía_no_venció()
    {
        var token = Service().Create(SampleUser());

        var principal = new JwtSecurityTokenHandler().ValidateToken(token, Parameters(Defaults.SigningKey), out var validated);

        Assert.NotNull(principal);
        Assert.True(validated.ValidTo > DateTime.UtcNow);
    }

    [Fact]
    public void Dos_usuarios_distintos_reciben_tokens_distintos()
    {
        var service = Service();

        Assert.NotEqual(service.Create(SampleUser()), service.Create(SampleUser()));
    }

    private static TokenValidationParameters Parameters(string signingKey) => new()
    {
        ValidateIssuer = true,
        ValidIssuer = Defaults.Issuer,
        ValidateAudience = true,
        ValidAudience = Defaults.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.Zero,
    };
}
