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
            .Select(s => new { s.SaleDate, TotalAmount = s.TotalAmount - s.RefundedAmount, s.Profit })
            .ToListAsync();

        // Les transferts depuis la collection personnelle ne sont pas des dépenses : exclus des achats.
        var realPurchases = db.Purchases.Where(p => p.Source == PurchaseSource.Supplier);
        var totalPurchases = await realPurchases.SumAsync(p => (decimal?)p.TotalAmount) ?? 0m;
        var monthPurchases = await realPurchases.Where(p => p.PurchaseDate >= monthStart)
            .SumAsync(p => (decimal?)p.TotalAmount) ?? 0m;

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
            RecentSales: recentSales.Select(s => s.ToSummary()).ToList());
    }

    public async Task<StatisticsDto> GetStatisticsAsync(int? requestedYear)
    {
        var today = DateTime.Today;
        var year = requestedYear ?? today.Year;
        var start = new DateTime(year, 1, 1);
        var end = start.AddYears(1);

        var sales = await db.Sales.AsNoTracking()
            .Where(s => s.SaleDate >= start && s.SaleDate < end)
            .ToListAsync();

        var lines = await db.SaleItems.AsNoTracking()
            .Where(si => si.Sale.SaleDate >= start && si.Sale.SaleDate < end)
            .Select(si => new { si.InventoryItem.Name, si.InventoryItem.Type, si.Quantity, si.SalePrice, si.UnitCost })
            .ToListAsync();

        var annualPurchases = await db.Purchases
            .Where(p => p.Source == PurchaseSource.Supplier && p.PurchaseDate >= start && p.PurchaseDate < end)
            .SumAsync(p => (decimal?)p.TotalAmount) ?? 0m;

        var stockValue = await db.InventoryItems.Where(i => i.RemainingQuantity > 0)
            .SumAsync(i => (decimal?)(i.RemainingQuantity * i.PurchasePrice)) ?? 0m;

        var saleYears = await db.Sales.Select(s => s.SaleDate.Year).Distinct().ToListAsync();
        var purchaseYears = await db.Purchases.Select(p => p.PurchaseDate.Year).Distinct().ToListAsync();
        var years = saleYears.Concat(purchaseYears).Append(today.Year).Append(year)
            .Distinct().OrderByDescending(y => y).ToList();

        var monthly = Enumerable.Range(1, 12).Select(m =>
        {
            var inMonth = sales.Where(s => s.SaleDate.Month == m).ToList();
            return new MonthlyPoint(year, m, inMonth.Sum(s => s.TotalAmount - s.RefundedAmount), inMonth.Sum(s => s.Profit), inMonth.Count);
        }).ToList();

        // Marge brute par produit (hors frais de vente, qui sont portés par la vente entière).
        var products = lines
            .GroupBy(l => new { l.Name, l.Type })
            .Select(g =>
            {
                var revenue = g.Sum(x => x.Quantity * x.SalePrice);
                var profit = g.Sum(x => x.Quantity * (x.SalePrice - x.UnitCost));
                return new ProductStatDto(g.Key.Name, g.Key.Type, g.Sum(x => x.Quantity), revenue, profit, Mappings.Margin(profit, revenue));
            })
            .ToList();

        var annualRevenue = sales.Sum(s => s.TotalAmount - s.RefundedAmount);
        var annualProfit = sales.Sum(s => s.Profit);
        // Nombre de mois écoulés pour la moyenne (12 pour une année passée).
        var monthsElapsed = year < today.Year ? 12 : year == today.Year ? today.Month : 1;
        var currentMonth = year == today.Year ? monthly[today.Month - 1] : null;

        return new StatisticsDto(
            Year: year,
            AvailableYears: years,
            AnnualRevenue: annualRevenue,
            AnnualProfit: annualProfit,
            AnnualPurchases: annualPurchases,
            AnnualSalesCount: sales.Count,
            CurrentMonthRevenue: currentMonth?.Revenue ?? 0,
            CurrentMonthProfit: currentMonth?.Profit ?? 0,
            AverageMonthlyRevenue: Math.Round(annualRevenue / monthsElapsed, 2),
            AverageMonthlyProfit: Math.Round(annualProfit / monthsElapsed, 2),
            StockValue: stockValue,
            Monthly: monthly,
            TopSales: sales.OrderByDescending(s => s.TotalAmount - s.RefundedAmount).Take(10).Select(s => s.ToSummary()).ToList(),
            TopProductsByRevenue: products.OrderByDescending(p => p.Revenue).Take(10).ToList(),
            TopProductsByProfit: products.OrderByDescending(p => p.Profit).Take(10).ToList());
    }
}
