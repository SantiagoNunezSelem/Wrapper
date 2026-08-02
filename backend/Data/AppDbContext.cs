using backend.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<SavedAnalysis> Analyses => Set<SavedAnalysis>();
    public DbSet<AiMetricResult> AiMetricResults => Set<AiMetricResult>();

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
            entity.HasOne(item => item.User)
                .WithMany(item => item.Subscriptions)
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
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
