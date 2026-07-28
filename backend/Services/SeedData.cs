using backend.Data;
using backend.Models;
using backend.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Net.Mail;

namespace backend.Services;

public static class SeedData
{
    public static async Task InitializeAsync(IServiceProvider services, AppDbContext db)
    {
        var options = services.GetRequiredService<IOptions<AdminSeedOptions>>().Value;

        if (string.IsNullOrWhiteSpace(options.Email))
        {
            return;
        }

        var normalizedEmail = options.Email.Trim().ToLowerInvariant();
        if (!IsValidEmail(normalizedEmail))
        {
            return;
        }

        var adminUser = await db.Users
            .Include(user => user.Subscriptions)
            .FirstOrDefaultAsync(user => user.Email == normalizedEmail);

        if (adminUser is null)
        {
            adminUser = new User
            {
                Email = normalizedEmail,
                DisplayName = options.DisplayName,
                PreferredLanguage = options.PreferredLanguage,
                IsAdmin = true,
            };

            db.Users.Add(adminUser);
        }

        EnsureAdminVip(adminUser, db);
        await db.SaveChangesAsync();
    }

    public static void ApplyAdminVipIfNeeded(User user, AppDbContext db, IConfiguration configuration)
    {
        var options = configuration.GetSection(AdminSeedOptions.SectionName).Get<AdminSeedOptions>() ?? new AdminSeedOptions();
        var normalizedAdminEmail = options.Email.Trim().ToLowerInvariant();

        if (!IsValidEmail(normalizedAdminEmail) || !string.Equals(user.Email, normalizedAdminEmail, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(user.DisplayName))
        {
            user.DisplayName = options.DisplayName;
        }

        EnsureAdminVip(user, db);
    }

    private static void EnsureAdminVip(User user, AppDbContext db)
    {
        user.IsAdmin = true;
        user.UpdatedAtUtc = DateTime.UtcNow;

        var existingVipSubscription = user.Subscriptions.FirstOrDefault(item => item.IsSeededVip);
        if (existingVipSubscription is not null)
        {
            existingVipSubscription.Status = "activa";
            existingVipSubscription.PlanType = "anual";
            existingVipSubscription.PaymentProvider = "seed";
            existingVipSubscription.SubscriptionStartsAtUtc ??= DateTime.UtcNow;
            existingVipSubscription.NextBillingAtUtc = new DateTime(2099, 12, 31, 0, 0, 0, DateTimeKind.Utc);
            existingVipSubscription.UpdatedAtUtc = DateTime.UtcNow;
            return;
        }

        var subscription = new Subscription
        {
            User = user,
            Status = "activa",
            PlanType = "anual",
            PaymentProvider = "seed",
            SubscriptionStartsAtUtc = DateTime.UtcNow,
            NextBillingAtUtc = new DateTime(2099, 12, 31, 0, 0, 0, DateTimeKind.Utc),
            IsSeededVip = true,
        };

        user.Subscriptions.Add(subscription);
        db.Subscriptions.Add(subscription);
    }

    private static bool IsValidEmail(string value)
    {
        try
        {
            var parsed = new MailAddress(value);
            return parsed.Address == value;
        }
        catch
        {
            return false;
        }
    }
}
