using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Indicateurs du tableau de bord et statistiques.
/// Les volumes d'une micro-entreprise étant modestes, les agrégations par mois se font en mémoire.
/// </summary>
public class ReportingService(AppDbContext db)
{
    public async Task<DashboardDto> GetDashboardAsync()
    {
        var today = DateTime.Today;
        var monthStart = new DateTime(today.Year, today.Month, 1);
        var periodStart = monthStart.AddMonths(-11);

        var stock = await db.InventoryItems.AsNoTracking()
            .Where(i => i.RemainingQuantity > 0)
            .Select(i => new { i.Name, i.Type, i.Condition, i.RemainingQuantity, i.PurchasePrice, i.MarketValue })
            .ToListAsync();

        var sales = await db.Sales.AsNoTracking()
            .Where(s => s.SaleDate >= periodStart)
            // CA net des remboursements (rattachés à la date de la vente pour les statistiques).
            .Select(s => new { s.SaleDate, TotalAmount = s.TotalAmount + s.AmountPaid - s.RefundedAmount, s.Profit })
            .ToListAsync();

        // Les transferts depuis la collection personnelle ne sont pas des dépenses : exclus des achats.
        var realPurchases = db.Purchases.Where(p => p.Source == PurchaseSource.Supplier);
        var totalPurchases = await realPurchases.SumAsync(p => (decimal?)p.TotalAmount) ?? 0m;
        var monthPurchases = await realPurchases.Where(p => p.PurchaseDate >= monthStart)
            .SumAsync(p => (decimal?)p.TotalAmount) ?? 0m;

        // Frais d'envoi du mois : fournitures achetées, coût réel des envois et port payé par les acheteurs.
        var monthShippingSpent = await db.ShippingSupplies.Where(s => s.PurchaseDate >= monthStart)
            .SumAsync(s => (decimal?)s.TotalAmount) ?? 0m;
        var monthShipments = await db.Sales.AsNoTracking()
            .Where(s => s.SaleDate >= monthStart && (s.ShippingCost > 0 || (s.Carrier != null && s.Carrier != ShippingCarrier.HandDelivery)))
            .Select(s => new { s.ShippingCost, s.AmountPaid })
            .ToListAsync();

        var months = Enumerable.Range(0, 12).Select(i => periodStart.AddMonths(i)).Select(m =>
        {
            var inMonth = sales.Where(s => s.SaleDate.Year == m.Year && s.SaleDate.Month == m.Month).ToList();
            return new MonthlyPoint(m.Year, m.Month, inMonth.Sum(s => s.TotalAmount), inMonth.Sum(s => s.Profit), inMonth.Count);
        }).ToList();
        var current = months[^1];

        var distribution = new[] { "Cartes", "Scellés" }.Select(label =>
        {
            var group = stock.Where(s => s.Type.IsCard() == (label == "Cartes")).ToList();
            return new DistributionSlice(label, group.Sum(g => g.RemainingQuantity), group.Sum(g => g.RemainingQuantity * g.PurchasePrice));
        }).ToList();

        var recentSales = await db.Sales.AsNoTracking()
            .OrderByDescending(s => s.SaleDate).ThenByDescending(s => s.Id)
            .Take(5).ToListAsync();

        return new DashboardDto(
            StockItemCount: stock.Sum(s => s.RemainingQuantity),
            // Produits distincts : les lots d'un même produit (même nom, type et état) comptent une fois.
            StockReferenceCount: stock.Select(s => (Name: s.Name.Trim().ToLowerInvariant(), s.Type, s.Condition)).Distinct().Count(),
            StockValue: stock.Sum(s => s.RemainingQuantity * s.PurchasePrice),
            // Valeur de marché : estimation si renseignée, sinon prix d'achat.
            StockMarketValue: stock.Sum(s => s.RemainingQuantity * (s.MarketValue ?? s.PurchasePrice)),
            LatentGain: stock.Where(s => s.MarketValue.HasValue).Sum(s => s.RemainingQuantity * (s.MarketValue!.Value - s.PurchasePrice)),
            MonthSalesCount: current.SalesCount,
            MonthRevenue: current.Revenue,
            MonthProfit: current.Profit,
            MonthPurchases: monthPurchases,
            TotalPurchases: totalPurchases,
            Last12Months: months,
            StockDistribution: distribution,
            RecentSales: recentSales.Select(s => s.ToSummary()).ToList(),
            MonthShippingSpent: monthShippingSpent,
            MonthShippingCost: monthShipments.Sum(s => s.ShippingCost),
            MonthShippingPaid: monthShipments.Sum(s => s.AmountPaid));
    }

    public async Task<StatisticsDto> GetStatisticsAsync(int? requestedYear, bool includePersonalCollection = true)
    {
        var today = DateTime.Today;
        var year = requestedYear ?? today.Year;
        var (start, end) = ServiceHelpers.YearRange(year);

        List<Sale> sales;
        List<SaleStatistic> salesForStatistics;
        var salesQuery = db.Sales.AsNoTracking()
            .Where(s => s.SaleDate >= start && s.SaleDate < end);
        if (includePersonalCollection)
        {
            sales = await salesQuery.ToListAsync();
            salesForStatistics = sales
                .Select(s => new SaleStatistic(s, 1m, Mappings.SaleRevenue(s) - s.RefundedAmount, s.Profit, true))
                .ToList();
        }
        else
        {
            sales = await salesQuery
                .Include(s => s.Items).ThenInclude(i => i.InventoryItem)
                    .ThenInclude(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase)
                .Include(s => s.Refunds).ThenInclude(r => r.Items)
                .Include(s => s.ShippingUsages)
                .ToListAsync();

            salesForStatistics = sales.Select(s =>
            {
                var eligibleItems = s.Items
                    .Where(i => i.InventoryItem.PurchaseItem?.Purchase.Source != PurchaseSource.PersonalCollection)
                    .ToList();
                var totalGross = s.Items.Sum(i => i.Quantity * i.SalePrice);
                var eligibleGross = eligibleItems.Sum(i => i.Quantity * i.SalePrice);
                var totalQuantity = s.Items.Sum(i => i.Quantity);
                var eligibleQuantity = eligibleItems.Sum(i => i.Quantity);
                var weight = totalGross > 0
                    ? eligibleGross / totalGross
                    : totalQuantity > 0 ? eligibleQuantity / (decimal)totalQuantity : 0m;
                var restockedByLine = s.Refunds.SelectMany(r => r.Items)
                    .Where(i => i.Restocked)
                    .GroupBy(i => i.SaleItemId)
                    .ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity));
                var itemProfit = eligibleItems.Sum(i =>
                {
                    var restocked = restockedByLine.GetValueOrDefault(i.Id);
                    return i.Quantity * i.SalePrice - (i.Quantity - restocked) * i.UnitCost;
                });
                var saleAdjustments = -s.RefundedAmount - s.Fees
                    + (s.ShippingUsages.Count > 0 ? s.AmountPaid - s.ShippingCost : 0m);
                var revenue = (Mappings.SaleRevenue(s) - s.RefundedAmount) * weight;
                var profit = itemProfit + saleAdjustments * weight;
                return new SaleStatistic(s, weight, revenue, profit, eligibleItems.Count > 0);
            }).Where(s => s.HasEligibleItems).ToList();
        }

        var saleItemsQuery = db.SaleItems.AsNoTracking()
            .Where(si => si.Sale.SaleDate >= start && si.Sale.SaleDate < end);
        if (!includePersonalCollection)
        {
            saleItemsQuery = saleItemsQuery.Where(si =>
                si.InventoryItem.PurchaseItem == null
                || si.InventoryItem.PurchaseItem.Purchase.Source != PurchaseSource.PersonalCollection);
        }

        var lines = await saleItemsQuery
            .Select(si => new
            {
                si.InventoryItem.Name,
                si.InventoryItem.Type,
                si.Quantity,
                si.SalePrice,
                si.UnitCost,
                si.Sale.TotalAmount,
                si.Sale.AmountPaid
            })
            .ToListAsync();

        var purchasesQuery = db.Purchases
            .Where(p => p.PurchaseDate >= start && p.PurchaseDate < end);
        if (!includePersonalCollection)
            purchasesQuery = purchasesQuery.Where(p => p.Source == PurchaseSource.Supplier);
        var annualPurchases = await purchasesQuery
            .SumAsync(p => (decimal?)p.TotalAmount) ?? 0m;

        var stockQuery = db.InventoryItems.Where(i => i.RemainingQuantity > 0);
        if (!includePersonalCollection)
        {
            stockQuery = stockQuery.Where(i =>
                i.PurchaseItem == null || i.PurchaseItem.Purchase.Source != PurchaseSource.PersonalCollection);
        }
        var stockValue = await stockQuery.SumAsync(i => (decimal?)(i.RemainingQuantity * i.PurchasePrice)) ?? 0m;

        // Frais d'envoi de l'année.
        var annualShippingSpent = await db.ShippingSupplies
            .Where(s => s.PurchaseDate >= start && s.PurchaseDate < end)
            .SumAsync(s => (decimal?)s.TotalAmount) ?? 0m;
        var shipped = salesForStatistics.Where(s => ShippingService.IsShipped(s.Sale.ShippingCost, s.Sale.Carrier)).ToList();

        var saleYearsQuery = db.Sales.AsQueryable();
        if (!includePersonalCollection)
        {
            saleYearsQuery = saleYearsQuery.Where(s => s.Items.Any(i =>
                i.InventoryItem.PurchaseItem == null
                || i.InventoryItem.PurchaseItem.Purchase.Source != PurchaseSource.PersonalCollection));
        }
        var saleYears = await saleYearsQuery.Select(s => s.SaleDate.Year).Distinct().ToListAsync();
        var purchaseYearsQuery = db.Purchases.AsQueryable();
        if (!includePersonalCollection)
            purchaseYearsQuery = purchaseYearsQuery.Where(p => p.Source == PurchaseSource.Supplier);
        var purchaseYears = await purchaseYearsQuery.Select(p => p.PurchaseDate.Year).Distinct().ToListAsync();
        var years = saleYears.Concat(purchaseYears).Append(today.Year).Append(year)
            .Distinct().OrderByDescending(y => y).ToList();

        var monthly = Enumerable.Range(1, 12).Select(m =>
        {
            var inMonth = salesForStatistics.Where(s => s.Sale.SaleDate.Month == m).ToList();
            return new MonthlyPoint(year, m,
                inMonth.Sum(s => s.Revenue),
                inMonth.Sum(s => s.Profit), inMonth.Count);
        }).ToList();

        // CA et bénéfice par produit (lots de même nom et même type regroupés).
        var products = lines
            .GroupBy(l => new { l.Name, l.Type })
            .Select(g =>
            {
                var revenue = g.Sum(x =>
                {
                    // CA de la ligne + sa part du port payé par l'acheteur (au prorata du montant).
                    // La commission n'est pas retirée : c'est une charge, pas une baisse du CA.
                    var lineAmount = x.Quantity * x.SalePrice;
                    return lineAmount + (x.TotalAmount > 0 ? lineAmount * x.AmountPaid / x.TotalAmount : 0m);
                });
                var profit = g.Sum(x => x.Quantity * (x.SalePrice - x.UnitCost));
                return new ProductStatDto(g.Key.Name, g.Key.Type, g.Sum(x => x.Quantity), revenue, profit, Mappings.Margin(profit, revenue));
            })
            .ToList();

        var annualRevenue = salesForStatistics.Sum(s => s.Revenue);
        var annualProfit = salesForStatistics.Sum(s => s.Profit);
        // Nombre de mois écoulés pour la moyenne (12 pour une année passée).
        var monthsElapsed = year < today.Year ? 12 : year == today.Year ? today.Month : 1;
        var currentMonth = year == today.Year ? monthly[today.Month - 1] : null;

        return new StatisticsDto(
            Year: year,
            AvailableYears: years,
            AnnualRevenue: annualRevenue,
            AnnualProfit: annualProfit,
            AnnualPurchases: annualPurchases,
            AnnualSalesCount: salesForStatistics.Count,
            CurrentMonthRevenue: currentMonth?.Revenue ?? 0,
            CurrentMonthProfit: currentMonth?.Profit ?? 0,
            AverageMonthlyRevenue: Math.Round(annualRevenue / monthsElapsed, 2),
            AverageMonthlyProfit: Math.Round(annualProfit / monthsElapsed, 2),
            StockValue: stockValue,
            Monthly: monthly,
            TopSales: salesForStatistics.OrderByDescending(s => s.Revenue).Take(10)
                .Select(s => s.Sale.ToSummary() with
                {
                    TotalAmount = Math.Round(s.Sale.TotalAmount * s.Weight, 2),
                    NetAmount = s.Revenue,
                    Profit = s.Profit
                }).ToList(),
            TopProductsByRevenue: products.OrderByDescending(p => p.Revenue).Take(10).ToList(),
            TopProductsByProfit: products.OrderByDescending(p => p.Profit).Take(10).ToList(),
            AnnualShippingSpent: annualShippingSpent,
            AnnualShippingCost: shipped.Sum(s => s.Sale.ShippingCost * s.Weight),
            AnnualShippingPaid: shipped.Sum(s => s.Sale.AmountPaid * s.Weight),
            ShippedSalesCount: shipped.Count);
    }

    private sealed record SaleStatistic(Sale Sale, decimal Weight, decimal Revenue, decimal Profit, bool HasEligibleItems);
}
