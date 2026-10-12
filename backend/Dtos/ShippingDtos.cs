using PokeStock.Api.Models;

namespace PokeStock.Api.Dtos;

// ----- Fournitures d'envoi -----

/// <summary>Achat de fournitures d'envoi (création / modification).</summary>
public record ShippingSupplyInput(
    DateTime PurchaseDate, ShippingSupplyKind Kind, ShippingCarrier? Carrier, string Name,
    int Quantity, decimal TotalAmount, string? Supplier, PaymentMethod? PaymentMethod, string? Comment);

public record ShippingSupplyDto(
    int Id, string SupplyNumber, DateTime PurchaseDate, ShippingSupplyKind Kind, ShippingCarrier? Carrier, string Name,
    int Quantity, int RemainingQuantity, int UsedQuantity, decimal TotalAmount, decimal UnitCost,
    // Valeur des unités encore disponibles.
    decimal StockValue,
    string? Supplier, PaymentMethod? PaymentMethod, string? Comment);

/// <summary>Fourniture consommée par l'envoi d'une vente.</summary>
public record ShippingUsageInput(int SupplyId, int Quantity);

public record ShippingUsageDto(int Id, int SupplyId, string SupplyNumber, string Name, ShippingSupplyKind Kind,
    int Quantity, decimal UnitCost, decimal Cost);

/// <summary>Stock d'une fourniture (lots de même nom et même nature regroupés).</summary>
public record ShippingStockDto(string Name, ShippingSupplyKind Kind, ShippingCarrier? Carrier,
    int Remaining, decimal AverageUnitCost, decimal StockValue, int UsedThisYear, bool Low);

public record ShippingMonthDto(int Month, decimal Spent, decimal Used, decimal PaidByBuyers, int ShippedSales);

/// <summary>Tableau de bord des frais d'envoi pour une année.</summary>
public record ShippingSummaryDto(
    int Year, List<int> AvailableYears, int LowStockThreshold,
    // Achats de fournitures sur l'année / le mois en cours.
    decimal SpentThisYear, decimal SpentThisMonth,
    // Coût réel des envois des ventes de l'année, et port facturé aux acheteurs.
    decimal UsedThisYear, decimal PaidByBuyersThisYear, int ShippedSalesThisYear, decimal AverageCostPerShipment,
    decimal StockValue,
    List<ShippingStockDto> Stock, List<ShippingMonthDto> Monthly,
    List<CarrierStatDto> Carriers);

public record CarrierStatDto(ShippingCarrier? Carrier, int Shipments, decimal Cost, decimal PaidByBuyers);
