using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<SavedAnalysis> Analyses => Set<SavedAnalysis>();
    public DbSet<AiMetricResult> AiMetricResults => Set<AiMetricResult>();
    public DbSet<SubscriptionInvoice> SubscriptionInvoices => Set<SubscriptionInvoice>();
    public DbSet<SubscriptionEvent> SubscriptionEvents => Set<SubscriptionEvent>();
    public DbSet<TrialClaim> TrialClaims => Set<TrialClaim>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.Email).IsUnique();
            entity.HasIndex(item => item.GoogleSubject).IsUnique();
            entity.Property(item => item.Email).HasMaxLength(320);
            entity.Property(item => item.DisplayName).HasMaxLength(200);
            entity.Property(item => item.AvatarUrl).HasMaxLength(1000);
            entity.Property(item => item.PreferredLanguage).HasMaxLength(10);
        });

        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasMaxLength(40);
            entity.Property(item => item.PaymentProvider).HasMaxLength(50);
            entity.Property(item => item.PlanType).HasMaxLength(50);
            entity.Property(item => item.ExternalSubscriptionId).HasMaxLength(200);
            entity.Property(item => item.ExternalPlanId).HasMaxLength(200);
            entity.Property(item => item.ExternalPayerId).HasMaxLength(100);
            entity.Property(item => item.CurrencyId).HasMaxLength(10);
            entity.Property(item => item.PaymentMethodLabel).HasMaxLength(120);
            // SQLite has no decimal type; EF maps it to TEXT by default, which sorts and
            // compares as a string. Money is small and fixed-scale here, so REAL is the
            // pragmatic choice — but it is stated explicitly rather than left to warn.
            entity.Property(item => item.Amount).HasColumnType("REAL");
            // Webhooks arrive keyed by the provider's id and nothing else.
            entity.HasIndex(item => item.ExternalSubscriptionId);
            entity.HasOne(item => item.User)
                .WithMany(item => item.Subscriptions)
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SubscriptionInvoice>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ExternalPaymentId).HasMaxLength(100);
            entity.Property(item => item.ExternalTransactionId).HasMaxLength(100);
            entity.Property(item => item.Status).HasMaxLength(30);
            entity.Property(item => item.RawStatus).HasMaxLength(60);
            entity.Property(item => item.CurrencyId).HasMaxLength(10);
            entity.Property(item => item.PaymentMethodLabel).HasMaxLength(120);
            entity.Property(item => item.Amount).HasColumnType("REAL");
            // One row per provider charge: the constraint, not just the lookup, is what
            // keeps a redelivered notification from duplicating someone's billing history.
            entity.HasIndex(item => item.ExternalPaymentId).IsUnique();
            entity.HasIndex(item => item.UserId);
            entity.HasOne(item => item.Subscription)
                .WithMany(item => item.Invoices)
                .HasForeignKey(item => item.SubscriptionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SubscriptionEvent>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Topic).HasMaxLength(60);
            entity.Property(item => item.Action).HasMaxLength(60);
            entity.Property(item => item.ExternalSubscriptionId).HasMaxLength(200);
            entity.Property(item => item.ExternalEventId).HasMaxLength(200);
            entity.Property(item => item.ResultingStatus).HasMaxLength(40);
            entity.Property(item => item.Notes).HasMaxLength(500);
            entity.Property(item => item.PayloadJson).HasColumnType("TEXT");
            // Unique, so a redelivered webhook cannot be applied twice even if two
            // instances process it concurrently.
            entity.HasIndex(item => item.ExternalEventId).IsUnique();
            entity.HasIndex(item => item.UserId);
        });

        modelBuilder.Entity<TrialClaim>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.IpHash).HasMaxLength(64);
            entity.Property(item => item.SubnetHash).HasMaxLength(64);
            entity.Property(item => item.DeviceHash).HasMaxLength(64);
            entity.Property(item => item.CountryCode).HasMaxLength(2);
            entity.HasIndex(item => item.IpHash);
            entity.HasIndex(item => item.SubnetHash);
            entity.HasIndex(item => item.DeviceHash);
            entity.HasIndex(item => item.UserId);
            // No relationship to Users on purpose — see the note on the entity. A cascade
            // here would let "delete account, sign up again" reset the free week.
        });

        modelBuilder.Entity<AppSetting>(entity =>
        {
            entity.HasKey(item => item.Key);
            entity.Property(item => item.Key).HasMaxLength(120);
            entity.Property(item => item.Value).HasMaxLength(500);
        });

        modelBuilder.Entity<SavedAnalysis>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ChatName).HasMaxLength(250);
            entity.Property(item => item.DateRangeLabel).HasMaxLength(120);
            entity.Property(item => item.ResultsJson).HasColumnType("TEXT");
            entity.Property(item => item.SourceHash).HasMaxLength(64);
            entity.HasIndex(item => new { item.UserId, item.SourceHash });
            entity.HasOne(item => item.User)
                .WithMany(item => item.Analyses)
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AiMetricResult>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.SourceHash).HasMaxLength(64);
            entity.Property(item => item.MetricId).HasMaxLength(60);
            entity.Property(item => item.InputHash).HasMaxLength(64);
            entity.Property(item => item.InputJson).HasColumnType("TEXT");
            entity.Property(item => item.ResultJson).HasColumnType("TEXT");
            entity.Property(item => item.Status).HasMaxLength(20);
            entity.Property(item => item.ErrorCode).HasMaxLength(30);
            // One verdict per user + chat + metric: the lookup that lets a second
            // upload of the same export cost zero tokens.
            entity.HasIndex(item => new { item.UserId, item.SourceHash, item.MetricId }).IsUnique();
            entity.HasOne(item => item.User)
                .WithMany(item => item.AiMetricResults)
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
