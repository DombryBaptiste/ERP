using PokeStock.Api.Models;

namespace PokeStock.Api.Dtos;

public record LoginRequest(string Username, string Password);

public record LoginResponse(string Token, string Username, DateTime ExpiresAt);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

// ----- Inventaire -----
/// <param name="MarketValue">Valeur de marché unitaire estimée (facultative).</param>
public record InventoryItemInput(
    string Name, string? Category, ItemType Type, ItemCondition Condition,
    decimal PurchasePrice, int Quantity, string? Location, DateTime PurchaseDate,
    decimal? MarketValue = null);

public record InventoryItemDto(
    int Id, string Name, string? Category, string? Language, ItemType Type, ItemCondition Condition,
    decimal PurchasePrice, int Quantity, int RemainingQuantity, int SoldQuantity, decimal StockValue,
    string? Location, DateTime PurchaseDate, int? PurchaseId, string? PurchaseNumber, ItemOrigin Origin,
    decimal? MarketValue, decimal? PreviousMarketValue, DateTime? MarketValueUpdatedAt,
    // Plus-value latente sur le stock restant : quantité restante × (valeur de marché − prix d'achat).
    decimal? LatentGain,
    int DaysInStock, int? PhotoId, bool IsListedOnCardmarket);

public record CardmarketListingInput(List<int> ItemIds, bool IsListed);

public record MarketValueInput(decimal? Value);

// ----- Achats -----
/// <summary>Ligne d'achat envoyée par le client. ItemId est renseigné pour une ligne existante (modification).</summary>
public record PurchaseLineInput(
    int? ItemId, string Name, string? Category, string? Language, ItemType Type, ItemCondition Condition,
    int Quantity, decimal UnitPrice, string? Location);

/// <summary>
/// Entrée en stock. Pour un transfert depuis la collection personnelle (Source = PersonalCollection),
/// le fournisseur est facultatif et le prix unitaire est la valeur retenue (0 accepté).
/// </summary>
public record PurchaseInput(
    DateTime PurchaseDate, string? Supplier, string? Comment, List<PurchaseLineInput> Items,
    PurchaseSource Source = PurchaseSource.Supplier, PaymentMethod? PaymentMethod = null,
    PurchasePlatform? Platform = null, decimal PlatformFees = 0, decimal ShippingFees = 0,
    string? TrackingNumber = null);

public record PurchaseLineDto(
    int Id, int ItemId, string Name, string? Category, string? Language, ItemType Type, ItemCondition Condition,
    int Quantity, decimal UnitPrice, decimal LineTotal, string? Location, int RemainingQuantity, int SoldQuantity);

public record PurchaseDto(
    int Id, string PurchaseNumber, PurchaseSource Source, DateTime PurchaseDate, string Supplier,
    PurchasePlatform? Platform, PaymentMethod? PaymentMethod, string? Comment,
    decimal PlatformFees, decimal ShippingFees, string? TrackingNumber,
    decimal TotalAmount, int ItemCount, List<PurchaseLineDto> Items);

// ----- Ventes -----
public record SaleLineInput(int InventoryItemId, int Quantity, decimal SalePrice);

public record SaleInput(
    DateTime SaleDate, string? Customer, SalePlatform Platform, decimal Fees, string? Comment, List<SaleLineInput> Items,
    PaymentMethod PaymentMethod = PaymentMethod.Platform, string? CustomerAddress = null, string? CustomerSiren = null,
    decimal AmountPaid = 0, string? TrackingNumber = null);

public record SaleLineDto(
    int Id, int InventoryItemId, string ItemName, ItemType ItemType, int Quantity,
    decimal SalePrice, decimal UnitCost, decimal LineTotal, decimal LineProfit, int ReturnedQuantity);

public record SaleRefundItemDto(int SaleItemId, string ItemName, int Quantity, bool Restocked);

public record SaleRefundDto(int Id, DateTime RefundDate, decimal Amount, string? Reason, List<SaleRefundItemDto> Items);

public record SaleDto(
    int Id, string SaleNumber, DateTime SaleDate, string? Customer, SalePlatform Platform, PaymentMethod PaymentMethod,
    decimal Fees, string? Comment, decimal AmountPaid, string? TrackingNumber,
    // Montant initial, total remboursé et montant net (encaissé définitivement).
    decimal TotalAmount, decimal RefundedAmount, decimal NetAmount,
    decimal Profit, decimal Margin,
    string? CustomerAddress, string? CustomerSiren, string? InvoiceNumber, DateTime? InvoiceDate,
    List<SaleLineDto> Items, List<SaleRefundDto> Refunds);

/// <summary>Article retourné : quantité à reprendre sur une ligne de vente.</summary>
public record RefundLineInput(int SaleItemId, int Quantity);

/// <param name="Amount">Somme rendue au client (0 accepté pour un simple retour sans remboursement).</param>
/// <param name="Restock">Remettre les articles retournés en stock (faux s'ils sont perdus ou abîmés).</param>
public record RefundInput(DateTime RefundDate, decimal Amount, string? Reason, bool Restock, List<RefundLineInput>? Items);

// ----- Tableau de bord & statistiques -----
public record MonthlyPoint(int Year, int Month, decimal Revenue, decimal Profit, int SalesCount);

public record DistributionSlice(string Label, int Quantity, decimal Value);

public record RecentSaleDto(int Id, string SaleNumber, DateTime SaleDate, string? Customer,
    SalePlatform Platform, decimal TotalAmount, decimal NetAmount, decimal Profit);

public record DashboardDto(
    int StockItemCount, int StockReferenceCount, decimal StockValue,
    decimal StockMarketValue, decimal LatentGain,
    int MonthSalesCount, decimal MonthRevenue, decimal MonthProfit, decimal MonthPurchases,
    decimal TotalPurchases, List<MonthlyPoint> Last12Months, List<DistributionSlice> StockDistribution,
    List<RecentSaleDto> RecentSales);

public record ProductStatDto(string Name, ItemType Type, int QuantitySold, decimal Revenue, decimal Profit, decimal Margin);

public record StatisticsDto(
    int Year, List<int> AvailableYears,
    decimal AnnualRevenue, decimal AnnualProfit, decimal AnnualPurchases, int AnnualSalesCount,
    decimal CurrentMonthRevenue, decimal CurrentMonthProfit, decimal AverageMonthlyRevenue, decimal AverageMonthlyProfit,
    decimal StockValue, List<MonthlyPoint> Monthly, List<RecentSaleDto> TopSales,
    List<ProductStatDto> TopProductsByRevenue, List<ProductStatDto> TopProductsByProfit);

// ----- Alertes -----
/// <param name="Reason">"gain" : forte plus-value par rapport au prix d'achat ; "rise" : hausse depuis la dernière estimation.</param>
public record MarketAlertDto(InventoryItemDto Item, decimal? GainPercent, decimal? RisePercent, decimal LatentGain, string Reason);

/// <param name="Level">"warning" (à baisser) ou "critical" (à liquider).</param>
public record DormantItemDto(InventoryItemDto Item, int DaysInStock, string Level, string Suggestion);

public record AlertsDto(
    AlertSettings Settings,
    decimal StockCost, decimal StockMarketValue, decimal LatentGain,
    int ItemsWithMarketValue, int ItemsWithoutMarketValue,
    List<MarketAlertDto> MarketAlerts, List<DormantItemDto> Dormant);

// ----- Fichiers joints -----
public record AttachmentDto(
    int Id, AttachmentOwner OwnerType, int OwnerId, AttachmentKind Kind,
    string FileName, string ContentType, long Size, int SortOrder, bool IsImage, DateTime UploadedAt, string Url);

public record ReorderAttachmentsInput(AttachmentOwner OwnerType, int OwnerId, List<int> AttachmentIds);

/// <summary>Formulaire d'envoi d'un fichier (multipart/form-data).</summary>
public class UploadAttachmentForm
{
    public AttachmentOwner OwnerType { get; set; }
    public int OwnerId { get; set; }
    public AttachmentKind Kind { get; set; }
    public IFormFile File { get; set; } = null!;
}
