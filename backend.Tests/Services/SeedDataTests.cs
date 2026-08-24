using backend.Models;
using backend.Options;
using backend.Services;
using backend.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace backend.Tests.Services;

/// <summary>
/// La cuenta admin sembrada: la que hace que el desarrollador tenga acceso Pro completo
/// sin pasar plata por Mercado Pago. Los tests cubren sobre todo lo que NO tiene que
/// pasar — que un email mal escrito en la config regale VIP a cualquiera.
/// </summary>
public class SeedDataTests : IDisposable
{
    private readonly TestDb _db = TestDb.Create();

    public void Dispose() => _db.Dispose();

    private static IServiceProvider Services(AdminSeedOptions options)
    {
        var collection = new ServiceCollection();
        collection.AddSingleton(Opt.Of(options));
        return collection.BuildServiceProvider();
    }

    private static IConfiguration Configuration(string email, string displayName = "Admin") =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AdminSeed:Email"] = email,
                ["AdminSeed:DisplayName"] = displayName,
            })
            .Build();

    // -----------------------------------------------------------------------
    // Siembra al arrancar
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Crea_la_cuenta_admin_con_su_suscripcion_VIP()
    {
        await SeedData.InitializeAsync(
            Services(new AdminSeedOptions { Email = "admin@example.com", DisplayName = "Santi" }),
            _db.Context);

        var user = await _db.NewContext().Users.Include(item => item.Subscriptions).SingleAsync();
        Assert.Equal("admin@example.com", user.Email);
        Assert.Equal("Santi", user.DisplayName);
        Assert.True(user.IsAdmin);

        var subscription = Assert.Single(user.Subscriptions);
        Assert.True(subscription.IsSeededVip);
        Assert.Equal("activa", subscription.Status);
        Assert.Equal("seed", subscription.PaymentProvider);
        Assert.True(SubscriptionAccessEvaluator.HasVipAccess(user));
    }

    [Fact]
    public async Task Normaliza_el_email_a_minusculas()
    {
        await SeedData.InitializeAsync(Services(new AdminSeedOptions { Email = "  Admin@Example.COM  " }), _db.Context);

        Assert.Equal("admin@example.com", (await _db.NewContext().Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task Sin_email_configurado_no_siembra_nada()
    {
        await SeedData.InitializeAsync(Services(new AdminSeedOptions { Email = "" }), _db.Context);

        Assert.Equal(0, await _db.NewContext().Users.CountAsync());
    }

    [Theory]
    [InlineData("no-es-un-email")]
    [InlineData("@example.com")]
    [InlineData("admin@")]
    [InlineData("admin example.com")]
    public async Task Un_email_invalido_NO_siembra_una_cuenta_admin(string email)
    {
        // Un typo en la config no puede terminar creando una cuenta con VIP.
        await SeedData.InitializeAsync(Services(new AdminSeedOptions { Email = email }), _db.Context);

        Assert.Equal(0, await _db.NewContext().Users.CountAsync());
    }

    [Fact]
    public async Task Sembrar_dos_veces_no_duplica_ni_la_cuenta_ni_la_suscripcion()
    {
        var services = Services(new AdminSeedOptions { Email = "admin@example.com" });

        await SeedData.InitializeAsync(services, _db.Context);
        await SeedData.InitializeAsync(services, _db.Context);

        Assert.Equal(1, await _db.NewContext().Users.CountAsync());
        Assert.Equal(1, await _db.NewContext().Subscriptions.CountAsync());
    }

    [Fact]
    public async Task Promueve_una_cuenta_ya_existente_en_vez_de_crear_otra()
    {
        _db.Context.Users.Add(new User { Email = "admin@example.com", DisplayName = "Ana" });
        await _db.Context.SaveChangesAsync();

        await SeedData.InitializeAsync(Services(new AdminSeedOptions { Email = "admin@example.com" }), _db.Context);

        var user = await _db.NewContext().Users.Include(item => item.Subscriptions).SingleAsync();
        Assert.True(user.IsAdmin);
        // No le pisa el nombre que ya tenía.
        Assert.Equal("Ana", user.DisplayName);
        Assert.Single(user.Subscriptions);
    }

    [Fact]
    public async Task Reactiva_una_suscripcion_semilla_que_alguien_habia_cancelado()
    {
        var user = new User { Email = "admin@example.com", DisplayName = "Ana" };
        user.Subscriptions.Add(new Subscription { Status = "cancelada", IsSeededVip = true });
        _db.Context.Users.Add(user);
        await _db.Context.SaveChangesAsync();

        await SeedData.InitializeAsync(Services(new AdminSeedOptions { Email = "admin@example.com" }), _db.Context);

        var subscription = await _db.NewContext().Subscriptions.SingleAsync();
        Assert.Equal("activa", subscription.Status);
        Assert.True(subscription.NextBillingAtUtc > DateTime.UtcNow.AddYears(50));
    }

    // -----------------------------------------------------------------------
    // Promoción en el login
    // -----------------------------------------------------------------------

    [Fact]
    public void ApplyAdminVipIfNeeded_promueve_al_email_configurado()
    {
        var user = new User { Email = "admin@example.com", DisplayName = "Ana" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();

        SeedData.ApplyAdminVipIfNeeded(user, _db.Context, Configuration("admin@example.com"));
        _db.Context.SaveChanges();

        Assert.True(user.IsAdmin);
        Assert.Single(user.Subscriptions);
    }

    [Fact]
    public void ApplyAdminVipIfNeeded_NO_toca_a_cualquier_otra_cuenta()
    {
        var user = new User { Email = "otra@example.com", DisplayName = "Beto" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();

        SeedData.ApplyAdminVipIfNeeded(user, _db.Context, Configuration("admin@example.com"));
        _db.Context.SaveChanges();

        Assert.False(user.IsAdmin);
        Assert.Empty(user.Subscriptions);
    }

    [Fact]
    public void ApplyAdminVipIfNeeded_compara_sin_distinguir_mayusculas()
    {
        var user = new User { Email = "admin@example.com", DisplayName = "Ana" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();

        SeedData.ApplyAdminVipIfNeeded(user, _db.Context, Configuration("ADMIN@EXAMPLE.COM"));

        Assert.True(user.IsAdmin);
    }

    [Fact]
    public void ApplyAdminVipIfNeeded_con_un_email_invalido_no_promueve_a_nadie()
    {
        var user = new User { Email = "otra@example.com", DisplayName = "Beto" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();

        SeedData.ApplyAdminVipIfNeeded(user, _db.Context, Configuration("no-es-un-email"));

        Assert.False(user.IsAdmin);
    }

    [Fact]
    public void ApplyAdminVipIfNeeded_completa_el_nombre_solo_si_falta()
    {
        var user = new User { Email = "admin@example.com", DisplayName = "" };
        _db.Context.Users.Add(user);
        _db.Context.SaveChanges();

        SeedData.ApplyAdminVipIfNeeded(user, _db.Context, Configuration("admin@example.com", "Santi"));

        Assert.Equal("Santi", user.DisplayName);
    }
}
