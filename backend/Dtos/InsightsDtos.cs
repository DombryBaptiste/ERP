namespace PokeStock.Api.Dtos;

// ----- Statistiques détaillées (onglets Ventes, Rentabilité, Stock, Évolution) -----

/// <summary>
/// Ligne d'une répartition (plateforme, type, série, langue…). <c>Sales</c> = nombre de ventes concernées,
/// <c>Quantity</c> = articles vendus. CA, bénéfice et frais incluent la part de la vente (port, remboursements, frais).
/// </summary>
public record StatRowDto(string Label, int Sales, int Quantity, decimal Revenue, decimal Profit, decimal Margin, decimal Fees);

public record BasketDto(
    int SalesCount, decimal AverageBasket, decimal AverageProfit, decimal AverageItems,
    decimal MedianBasket, decimal LargestBasket);

public record CustomerStatDto(string Name, int Sales, decimal Revenue, decimal Profit, DateTime LastSale);

public record CustomersDto(int CustomerCount, int ReturningCustomers, decimal ReturningRevenueShare,
    int AnonymousSales, List<CustomerStatDto> TopCustomers);

public record BulkStatsDto(int CardsSold, int Sales, decimal Revenue, decimal Profit, decimal Margin,
    decimal AveragePricePerCard, decimal AverageCostPerCard, List<StatRowDto> ByOrigin,
    int CardsInStock, decimal StockCost);

public record MarginStatsDto(decimal Revenue, decimal Profit, decimal Margin, decimal PlatformFees, decimal FeesShare,
    decimal Refunds, int RefundedSales, decimal ShippingCost, decimal ShippingPaid, decimal CostOfGoods);

public record PurchaseRoiDto(int PurchaseId, string PurchaseNumber, DateTime PurchaseDate, string Supplier,
    decimal Cost, decimal Recovered, decimal Profit, decimal RecoveredPercent, int Quantity, int Sold, decimal RemainingStockCost);

public record PurchasesRoiDto(int PurchaseCount, int FullyRecovered, decimal TotalCost, decimal TotalRecovered,
    decimal TotalProfit, List<PurchaseRoiDto> Best, List<PurchaseRoiDto> Worst);

public record DaysRowDto(string Label, int Quantity, decimal AverageDays);

public record StockAgeRowDto(string Label, int Quantity, decimal Value);

/// <summary>
/// Année précédente. <c>*ToDate</c> = N-1 arrêtée au même jour que aujourd'hui quand l'année choisie est
/// l'année en cours (sinon identiques aux totaux annuels).
/// </summary>
public record ComparisonDto(int PreviousYear, decimal Revenue, decimal Profit, int SalesCount,
    List<MonthlyPoint> Monthly, decimal? ProjectedRevenue, decimal? ProjectedProfit,
    decimal RevenueToDate, decimal ProfitToDate, int SalesCountToDate);

public record InsightsDto(
    int Year,
    BasketDto Basket,
    List<StatRowDto> ByPlatform,
    List<StatRowDto> ByType,
    CustomersDto Customers,
    BulkStatsDto Bulk,
    List<StatRowDto> ByOrigin,
    MarginStatsDto Margins,
    PurchasesRoiDto Purchases,
    decimal AverageDaysToSell,
    List<DaysRowDto> DaysToSellByType,
    List<StockAgeRowDto> StockAge,
    List<StatRowDto> BySeries,
    List<StatRowDto> ByLanguage,
    List<StatRowDto> ByCondition,
    ComparisonDto Comparison,
    List<StatRowDto> ByWeekday,
    List<StatRowDto> ByPriceBand);
