namespace PokeStock.Api.Models;

/// <summary>
/// Paramètre de l'application (table app_settings) : une clé et une valeur JSON.
/// Sert notamment à stocker les paramètres fiscaux, sans devoir changer le schéma à chaque ajout.
/// </summary>
public class AppSetting
{
    public string SettingKey { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Article en stock (table inventory_items).
/// Un article est créé soit par un achat (lié via <see cref="PurchaseItem"/>), soit manuellement.
/// </summary>
public class InventoryItem
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>Catégorie libre : série / extension (ex. "EV08 Étincelles Déferlantes").</summary>
    public string? Category { get; set; }
    public string? Language { get; set; }
    public bool IsListedOnCardmarket { get; set; }
    public ItemType Type { get; set; }
    public ItemCondition Condition { get; set; }
    /// <summary>Prix d'achat unitaire.</summary>
    public decimal PurchasePrice { get; set; }
    /// <summary>Quantité achetée à l'origine.</summary>
    public int Quantity { get; set; }
    /// <summary>Quantité encore en stock (décrémentée à chaque vente).</summary>
    public int RemainingQuantity { get; set; }
    public string? Location { get; set; }
    public DateTime PurchaseDate { get; set; }
    /// <summary>Valeur de marché unitaire estimée (saisie manuellement, ex. tendance Cardmarket).</summary>
    public decimal? MarketValue { get; set; }
    /// <summary>Estimation précédente : sert à détecter une hausse de valeur.</summary>
    public decimal? PreviousMarketValue { get; set; }
    public DateTime? MarketValueUpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public PurchaseItem? PurchaseItem { get; set; }
    public List<SaleItem> SaleItems { get; set; } = [];
}

/// <summary>
/// Entrée en stock (table purchases) : achat numéroté A{année}{séquence} (ex. A2026001),
/// ou transfert depuis la collection personnelle numéroté C{année}{séquence} (ex. C2026001).
/// </summary>
public class Purchase
{
    public int Id { get; set; }
    public string PurchaseNumber { get; set; } = string.Empty;
    public PurchaseSource Source { get; set; } = PurchaseSource.Supplier;
    public DateTime PurchaseDate { get; set; }
    public string Supplier { get; set; } = string.Empty;
    public PurchasePlatform? Platform { get; set; }
    public decimal PlatformFees { get; set; }
    public decimal ShippingFees { get; set; }
    /// <summary>Numéro de suivi fourni par le vendeur ou la plateforme.</summary>
    public string? TrackingNumber { get; set; }
    /// <summary>Mode de règlement (registre des achats). Vide pour un transfert de collection.</summary>
    public PaymentMethod? PaymentMethod { get; set; }
    public string? Comment { get; set; }
    public decimal TotalAmount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<PurchaseItem> Items { get; set; } = [];
}

/// <summary>Ligne d'achat (table purchase_items) reliant un achat à l'article de stock créé.</summary>
public class PurchaseItem
{
    public int Id { get; set; }
    public int PurchaseId { get; set; }
    public Purchase Purchase { get; set; } = null!;
    public int ItemId { get; set; }
    public InventoryItem Item { get; set; } = null!;
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}

/// <summary>Vente (table sales), numérotée V{année}{séquence}, ex. V2026001.</summary>
public class Sale
{
    public int Id { get; set; }
    public string SaleNumber { get; set; } = string.Empty;
    public DateTime SaleDate { get; set; }
    public string? Customer { get; set; }
    public SalePlatform Platform { get; set; }
    /// <summary>Mode de règlement (mention obligatoire du livre des recettes).</summary>
    public PaymentMethod PaymentMethod { get; set; } = PaymentMethod.Platform;
    /// <summary>Frais de la vente (commission plateforme, envoi...). Déduits du bénéfice.</summary>
    public decimal Fees { get; set; }
    public string? Comment { get; set; }
    /// <summary>Montant total encaissé (somme quantité × prix de vente), avant remboursements.</summary>
    public decimal TotalAmount { get; set; }
    /// <summary>Total remboursé au client (somme des remboursements).</summary>
    public decimal RefundedAmount { get; set; }
    /// <summary>Bénéfice = total - remboursements - coût des articles non remis en stock - frais.</summary>
    public decimal Profit { get; set; }

    // --- Facturation (clients professionnels) ---
    public string? CustomerAddress { get; set; }
    public string? CustomerSiren { get; set; }
    /// <summary>Numéro de facture (F{année}{séquence}), attribué à la première émission, jamais réutilisé.</summary>
    public string? InvoiceNumber { get; set; }
    public DateTime? InvoiceDate { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<SaleItem> Items { get; set; } = [];
    public List<SaleRefund> Refunds { get; set; } = [];
}

/// <summary>Ligne de vente (table sale_items).</summary>
public class SaleItem
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public Sale Sale { get; set; } = null!;
    public int InventoryItemId { get; set; }
    public InventoryItem InventoryItem { get; set; } = null!;
    public int Quantity { get; set; }
    /// <summary>Prix de vente unitaire.</summary>
    public decimal SalePrice { get; set; }
    /// <summary>Coût d'achat unitaire figé au moment de la vente (historique fiable).</summary>
    public decimal UnitCost { get; set; }
}

/// <summary>
/// Remboursement total ou partiel d'une vente (table sale_refunds).
/// Il est déduit du CA de la période où il a lieu, et peut remettre des articles en stock.
/// </summary>
public class SaleRefund
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public Sale Sale { get; set; } = null!;
    public DateTime RefundDate { get; set; }
    /// <summary>Somme rendue au client.</summary>
    public decimal Amount { get; set; }
    public string? Reason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<SaleRefundItem> Items { get; set; } = [];
}

/// <summary>Article retourné lors d'un remboursement (table sale_refund_items).</summary>
public class SaleRefundItem
{
    public int Id { get; set; }
    public int RefundId { get; set; }
    public SaleRefund Refund { get; set; } = null!;
    public int SaleItemId { get; set; }
    public SaleItem SaleItem { get; set; } = null!;
    public int Quantity { get; set; }
    /// <summary>Vrai si l'article est revendable et a été remis en stock (faux s'il est perdu ou abîmé).</summary>
    public bool Restocked { get; set; }
}

/// <summary>
/// Fichier joint (table attachments) : photo d'article, ticket d'achat, capture d'annonce,
/// preuve d'origine... Le fichier est stocké sur disque (dossier data/uploads).
/// </summary>
public class Attachment
{
    public int Id { get; set; }
    public AttachmentOwner OwnerType { get; set; }
    public int OwnerId { get; set; }
    public AttachmentKind Kind { get; set; }
    /// <summary>Nom d'origine du fichier.</summary>
    public string FileName { get; set; } = string.Empty;
    /// <summary>Nom sur disque (GUID + extension).</summary>
    public string StoredName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long Size { get; set; }
    public int SortOrder { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
