using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Models;

namespace PokeStock.Api.Data;

/// <summary>
/// Contexte Entity Framework. Le schéma MySQL est créé automatiquement au démarrage
/// (voir <see cref="DbInitializer"/>) ; le script équivalent est dans database/schema.sql.
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<InventoryItem> InventoryItems => Set<InventoryItem>();
    public DbSet<Purchase> Purchases => Set<Purchase>();
    public DbSet<PurchaseItem> PurchaseItems => Set<PurchaseItem>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleItem> SaleItems => Set<SaleItem>();
    public DbSet<SaleRefund> SaleRefunds => Set<SaleRefund>();
    public DbSet<SaleRefundItem> SaleRefundItems => Set<SaleRefundItem>();
    public DbSet<Attachment> Attachments => Set<Attachment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasCharSet("utf8mb4");

        b.Entity<AppSetting>(e =>
        {
            e.ToTable("app_settings");
            e.HasKey(x => x.SettingKey);
            e.Property(x => x.SettingKey).HasMaxLength(100);
            e.Property(x => x.Value).HasColumnType("longtext").IsRequired();
        });

        b.Entity<InventoryItem>(e =>
        {
            e.ToTable("inventory_items");
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
            e.Property(x => x.Category).HasMaxLength(100);
            e.Property(x => x.Language).HasMaxLength(50);
            e.Property(x => x.IsListedOnCardmarket).HasDefaultValue(false);
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Condition).HasConversion<string>().HasMaxLength(30);
            // 6 décimales : le bulk se compte à la carte (ex. 15 € pour 700 cartes = 0,021429 € la carte).
            e.Property(x => x.PurchasePrice).HasPrecision(14, 6);
            e.Property(x => x.Location).HasMaxLength(100);
            e.Property(x => x.PurchaseDate).HasColumnType("date");
            e.Property(x => x.MarketValue).HasPrecision(10, 2);
            e.Property(x => x.PreviousMarketValue).HasPrecision(10, 2);
            e.HasIndex(x => x.Name);
        });

        b.Entity<Purchase>(e =>
        {
            e.ToTable("purchases");
            e.Property(x => x.PurchaseNumber).HasMaxLength(20).IsRequired();
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.PurchaseDate).HasColumnType("date");
            e.Property(x => x.Supplier).HasMaxLength(150).IsRequired();
            e.Property(x => x.Platform).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.PlatformFees).HasPrecision(10, 2);
            e.Property(x => x.ShippingFees).HasPrecision(10, 2);
            e.Property(x => x.TrackingNumber).HasMaxLength(100);
            e.Property(x => x.PaymentMethod).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Comment).HasMaxLength(1000);
            e.Property(x => x.TotalAmount).HasPrecision(10, 2);
            e.HasIndex(x => x.PurchaseNumber).IsUnique();
        });

        b.Entity<PurchaseItem>(e =>
        {
            e.ToTable("purchase_items");
            e.Property(x => x.UnitPrice).HasPrecision(14, 6);
            e.HasOne(x => x.Purchase).WithMany(p => p.Items)
                .HasForeignKey(x => x.PurchaseId).OnDelete(DeleteBehavior.Cascade);
            // Chaque article de stock provient d'au plus une ligne d'achat (index unique sur item_id).
            e.HasOne(x => x.Item).WithOne(i => i.PurchaseItem)
                .HasForeignKey<PurchaseItem>(x => x.ItemId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Sale>(e =>
        {
            e.ToTable("sales");
            e.Property(x => x.SaleNumber).HasMaxLength(20).IsRequired();
            e.Property(x => x.SaleDate).HasColumnType("date");
            e.Property(x => x.Customer).HasMaxLength(150);
            e.Property(x => x.Platform).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.PaymentMethod).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Fees).HasPrecision(10, 2);
            e.Property(x => x.Comment).HasMaxLength(1000);
            e.Property(x => x.TotalAmount).HasPrecision(10, 2);
            e.Property(x => x.RefundedAmount).HasPrecision(10, 2);
            e.Property(x => x.Profit).HasPrecision(10, 2);
            e.Property(x => x.CustomerAddress).HasMaxLength(500);
            e.Property(x => x.CustomerSiren).HasMaxLength(20);
            e.Property(x => x.InvoiceNumber).HasMaxLength(20);
            e.Property(x => x.InvoiceDate).HasColumnType("date");
            e.HasIndex(x => x.SaleNumber).IsUnique();
            e.HasIndex(x => x.SaleDate);
        });

        b.Entity<SaleRefund>(e =>
        {
            e.ToTable("sale_refunds");
            e.Property(x => x.RefundDate).HasColumnType("date");
            e.Property(x => x.Amount).HasPrecision(10, 2);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.HasOne(x => x.Sale).WithMany(s => s.Refunds)
                .HasForeignKey(x => x.SaleId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SaleRefundItem>(e =>
        {
            e.ToTable("sale_refund_items");
            e.HasOne(x => x.Refund).WithMany(r => r.Items)
                .HasForeignKey(x => x.RefundId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.SaleItem).WithMany()
                .HasForeignKey(x => x.SaleItemId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Attachment>(e =>
        {
            e.ToTable("attachments");
            e.Property(x => x.OwnerType).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(30);
            e.Property(x => x.FileName).HasMaxLength(255).IsRequired();
            e.Property(x => x.StoredName).HasMaxLength(100).IsRequired();
            e.Property(x => x.ContentType).HasMaxLength(100).IsRequired();
            e.HasIndex(x => new { x.OwnerType, x.OwnerId });
        });

        b.Entity<SaleItem>(e =>
        {
            e.ToTable("sale_items");
            e.Property(x => x.SalePrice).HasPrecision(14, 6);
            e.Property(x => x.UnitCost).HasPrecision(14, 6);
            e.HasOne(x => x.Sale).WithMany(s => s.Items)
                .HasForeignKey(x => x.SaleId).OnDelete(DeleteBehavior.Cascade);
            // Un article vendu ne peut pas être supprimé tant que la vente existe.
            e.HasOne(x => x.InventoryItem).WithMany(i => i.SaleItems)
                .HasForeignKey(x => x.InventoryItemId).OnDelete(DeleteBehavior.Restrict);
        });

        // Colonnes en snake_case (purchase_price, remaining_quantity...) comme dans le cahier des charges.
        foreach (var entity in b.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                property.SetColumnName(ToSnakeCase(property.Name));
    }

    private static string ToSnakeCase(string name) =>
        Regex.Replace(name, "(?<=[a-z0-9])([A-Z])", "_$1").ToLowerInvariant();
}
