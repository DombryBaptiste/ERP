using Microsoft.EntityFrameworkCore;

namespace PokeStock.Api.Data;

/// <summary>Crée le schéma MySQL s'il n'existe pas.</summary>
public static class DbInitializer
{
    public static async Task InitializeAsync(IServiceProvider services, ILogger logger)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // MySQL peut mettre quelques secondes à démarrer (notamment sous Docker) : on réessaie.
        const int maxAttempts = 10;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.Database.EnsureCreatedAsync();
                break;
            }
            catch (Exception ex) when (attempt < maxAttempts)
            {
                logger.LogWarning("Connexion à MySQL impossible (tentative {Attempt}/{Max}) : {Message}",
                    attempt, maxAttempts, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }

        // EnsureCreated ne modifie pas une base existante : les tables ajoutées après la première
        // version sont créées ici si besoin.
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS app_settings (
              setting_key VARCHAR(100) NOT NULL,
              value       LONGTEXT     NOT NULL,
              updated_at  DATETIME(6)  NOT NULL,
              PRIMARY KEY (setting_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """);

        // Colonnes ajoutées après la première version.
        await EnsureColumnAsync(db, "purchases", "source", "VARCHAR(30) NOT NULL DEFAULT 'Supplier' AFTER purchase_number");
        await EnsureColumnAsync(db, "purchases", "payment_method", "VARCHAR(30) NULL");
        await EnsureColumnAsync(db, "inventory_items", "market_value", "DECIMAL(10,2) NULL");
        await EnsureColumnAsync(db, "inventory_items", "previous_market_value", "DECIMAL(10,2) NULL");
        await EnsureColumnAsync(db, "inventory_items", "market_value_updated_at", "DATETIME(6) NULL");
        await EnsureColumnAsync(db, "sales", "payment_method", "VARCHAR(30) NOT NULL DEFAULT 'Platform'");
        await EnsureColumnAsync(db, "sales", "refunded_amount", "DECIMAL(10,2) NOT NULL DEFAULT 0");
        await EnsureColumnAsync(db, "sales", "customer_address", "VARCHAR(500) NULL");
        await EnsureColumnAsync(db, "sales", "customer_siren", "VARCHAR(20) NULL");
        await EnsureColumnAsync(db, "sales", "invoice_number", "VARCHAR(20) NULL");
        await EnsureColumnAsync(db, "sales", "invoice_date", "DATE NULL");
        await EnsureColumnAsync(db, "inventory_items", "language", "VARCHAR(50) NULL AFTER category");
        await EnsureColumnAsync(db, "inventory_items", "is_listed_on_cardmarket", "TINYINT(1) NOT NULL DEFAULT 0");
        await EnsureColumnAsync(db, "purchases", "platform", "VARCHAR(30) NULL AFTER source");
        await EnsureColumnAsync(db, "purchases", "platform_fees", "DECIMAL(10,2) NOT NULL DEFAULT 0");
        await EnsureColumnAsync(db, "purchases", "shipping_fees", "DECIMAL(10,2) NOT NULL DEFAULT 0");
        await EnsureColumnAsync(db, "purchases", "tracking_number", "VARCHAR(100) NULL AFTER shipping_fees");

        // États des articles : anciennes valeurs (New, Excellent…) converties au format Cardmarket (NM, EXC…).
        // Sans effet une fois la conversion faite.
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE inventory_items SET `condition` = CASE `condition`
              WHEN 'New' THEN 'NM' WHEN 'Excellent' THEN 'EXC' WHEN 'VeryGood' THEN 'GOOD'
              WHEN 'Good' THEN 'LP' WHEN 'Fair' THEN 'PL' WHEN 'Poor' THEN 'PO' END
            WHERE `condition` IN ('New', 'Excellent', 'VeryGood', 'Good', 'Fair', 'Poor');
            """);

        // Prix unitaires à 6 décimales (bulk vendu et acheté à la carte).
        await EnsureDecimalScaleAsync(db, "inventory_items", "purchase_price", "DECIMAL(14,6) NOT NULL");
        await EnsureDecimalScaleAsync(db, "purchase_items", "unit_price", "DECIMAL(14,6) NOT NULL");
        await EnsureDecimalScaleAsync(db, "sale_items", "sale_price", "DECIMAL(14,6) NOT NULL");
        await EnsureDecimalScaleAsync(db, "sale_items", "unit_cost", "DECIMAL(14,6) NOT NULL");

        // Tables ajoutées après la première version.
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS sale_refunds (
              id          INT           NOT NULL AUTO_INCREMENT,
              sale_id     INT           NOT NULL,
              refund_date DATE          NOT NULL,
              amount      DECIMAL(10,2) NOT NULL,
              reason      VARCHAR(500)  NULL,
              created_at  DATETIME(6)   NOT NULL,
              PRIMARY KEY (id),
              KEY IX_sale_refunds_sale_id (sale_id),
              CONSTRAINT FK_sale_refunds_sales_sale_id FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS sale_refund_items (
              id           INT        NOT NULL AUTO_INCREMENT,
              refund_id    INT        NOT NULL,
              sale_item_id INT        NOT NULL,
              quantity     INT        NOT NULL,
              restocked    TINYINT(1) NOT NULL,
              PRIMARY KEY (id),
              KEY IX_sale_refund_items_refund_id (refund_id),
              KEY IX_sale_refund_items_sale_item_id (sale_item_id),
              CONSTRAINT FK_sale_refund_items_sale_refunds_refund_id FOREIGN KEY (refund_id) REFERENCES sale_refunds (id) ON DELETE CASCADE,
              CONSTRAINT FK_sale_refund_items_sale_items_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """);
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS attachments (
              id           INT          NOT NULL AUTO_INCREMENT,
              owner_type   VARCHAR(30)  NOT NULL,
              owner_id     INT          NOT NULL,
              kind         VARCHAR(30)  NOT NULL,
              file_name    VARCHAR(255) NOT NULL,
              stored_name  VARCHAR(100) NOT NULL,
              content_type VARCHAR(100) NOT NULL,
              size         BIGINT       NOT NULL,
              sort_order   INT          NOT NULL DEFAULT 0,
              uploaded_at  DATETIME(6)  NOT NULL,
              PRIMARY KEY (id),
              KEY IX_attachments_owner_type_owner_id (owner_type, owner_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """);
        await EnsureColumnAsync(db, "attachments", "sort_order", "INT NOT NULL DEFAULT 0 AFTER size");
    }

    /// <summary>Élargit une colonne décimale à 6 décimales si elle en a moins (les valeurs sont conservées).</summary>
    private static async Task EnsureDecimalScaleAsync(AppDbContext db, string table, string column, string definition)
    {
        var scale = await db.Database.SqlQueryRaw<long>(
                "SELECT COALESCE(MAX(NUMERIC_SCALE), 6) AS Value FROM information_schema.COLUMNS " +
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = {0} AND COLUMN_NAME = {1}", table, column)
            .SingleAsync();
        if (scale >= 6) return;
        var sql = $"ALTER TABLE `{table}` MODIFY COLUMN `{column}` {definition}";
        await db.Database.ExecuteSqlRawAsync(sql);
    }

    /// <summary>Ajoute une colonne à une table existante si elle n'existe pas encore.</summary>
    private static async Task EnsureColumnAsync(AppDbContext db, string table, string column, string definition)
    {
        var exists = await db.Database.SqlQueryRaw<long>(
                "SELECT COUNT(*) AS Value FROM information_schema.COLUMNS " +
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = {0} AND COLUMN_NAME = {1}", table, column)
            .SingleAsync();
        if (exists > 0) return;
        // Noms et définition fixés dans le code (pas de saisie utilisateur).
        var sql = $"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}";
        await db.Database.ExecuteSqlRawAsync(sql);
    }
}
