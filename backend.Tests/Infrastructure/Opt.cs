using Microsoft.Extensions.Options;

namespace backend.Tests.Infrastructure;

/// <summary>
/// Envuelve un objeto de configuración en <see cref="IOptions{T}"/>.
///
/// Existe por una colisión de nombres molesta: el proyecto tiene su propio namespace
/// <c>backend.Options</c>, así que dentro de un test que usa <c>JwtOptions</c> o
/// <c>TrialGuardOptions</c> el identificador <c>Options</c> ya no resuelve a la clase
/// estática de Microsoft y habría que escribir el nombre completo en cada línea.
/// </summary>
internal static class Opt
{
    public static IOptions<T> Of<T>(T value) where T : class =>
        Microsoft.Extensions.Options.Options.Create(value);
}
