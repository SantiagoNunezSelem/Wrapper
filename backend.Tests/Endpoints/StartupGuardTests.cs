using backend.Tests.Infrastructure;

namespace backend.Tests.Endpoints;

/// <summary>
/// La app se niega a arrancar en producción con una clave de firma que cualquiera puede
/// leer en el repositorio. Fallar el arranque es la única forma confiable de atajar eso:
/// una advertencia en un log que nadie mira es exactamente cómo se termina desplegando.
/// </summary>
public sealed class StartupGuardTests
{
    private static ApiFactory Production(string signingKey)
    {
        var factory = new ApiFactory { Environment = "Production" };
        factory.Settings["Jwt:SigningKey"] = signingKey;
        // Sin esto, la comprobación de secretos ni siquiera llega a correr.
        factory.Settings["Cors:AllowedOrigins:0"] = "https://vistazo.app";
        return factory;
    }

    [Theory]
    [InlineData("change-this-before-production-use-a-long-random-secret-key")]
    [InlineData("wrapper-crm-development-signing-key-change-me-before-production")]
    public void No_arranca_en_produccion_con_una_clave_del_repositorio(string placeholder)
    {
        using var factory = Production(placeholder);

        var error = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Assert.Contains("placeholder", Unwrap(error).Message);
    }

    [Fact]
    public void No_arranca_en_produccion_con_una_clave_demasiado_corta()
    {
        // Menos de 32 bytes es forzable offline a partir de un solo token capturado.
        using var factory = Production("corta");

        var error = Assert.ThrowsAny<Exception>(() => factory.CreateClient());

        Assert.Contains("32 bytes", Unwrap(error).Message);
    }

    [Fact]
    public void Arranca_en_produccion_con_una_clave_propia_y_larga()
    {
        using var factory = Production("una-clave-aleatoria-de-produccion-suficientemente-larga-2026");

        var client = factory.CreateClient();

        Assert.NotNull(client);
    }

    [Fact]
    public void En_desarrollo_la_comprobacion_no_aplica()
    {
        // Un clone fresco tiene que poder correr sin configurar nada.
        using var factory = new ApiFactory();
        factory.Settings["Jwt:SigningKey"] = "change-this-before-production-use-a-long-random-secret-key";

        Assert.NotNull(factory.CreateClient());
    }

    /// <summary>El host envuelve la excepción original; el mensaje útil está adentro.</summary>
    private static Exception Unwrap(Exception error)
    {
        while (error.InnerException is not null)
        {
            error = error.InnerException;
        }

        return error;
    }
}
