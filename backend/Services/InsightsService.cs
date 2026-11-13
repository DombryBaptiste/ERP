using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Statistiques détaillées de l'onglet Statistiques (panier moyen, plateformes, types, clients, bulk,
/// collection / achats, marges, rentabilité des achats, rotation, âge du stock, séries, langue, état,
/// comparaison N-1, jours de la semaine, tranches de prix).
///
/// Tout part des lignes de vente : chaque ligne reçoit sa part (au prorata de son montant) du port payé,
/// des remboursements, des frais et de la marge d'envoi de sa vente. La somme des bénéfices des lignes
/// d'une vente est donc exactement le bénéfice de la vente, et toutes les répartitions sont cohérentes
/// avec le bénéfice annuel. Sans la collection, ses lignes sont simplement retirées.
/// </summary>
public class InsightsService(AppDbContext db)
{
    private const string CollectionLabel = "Ma collection";
    private const string PurchasesLabel = "Achats";

    /// <summary>Ligne de vente avec sa part de la vente.</summary>
    private sealed record Line(
        Sale Sale, SaleItem Item, InventoryItem Stock, bool FromCollection,
        int Quantity, decimal Gross, decimal Revenue, decimal Profit, decimal Fees, decimal Cost, decimal Refund)
    {
        /// <summary>Somme réellement revenue : CA − remboursements − frais ± envoi (= bénéfice + coût des articles).</summary>
        public decimal Recovered => Profit + Cost;
    }

    public async Task<InsightsDto> GetAsync(int? requestedYear, bool includePersonalCollection = true)
    {
        var today = DateTime.Today;
        var year = requestedYear ?? today.Year;

        var sales = await db.Sales.AsNoTracking()
            .Include(s => s.Items).ThenInclude(i => i.InventoryItem)
                .ThenInclude(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase)
            .Include(s => s.Refunds).ThenInclude(r => r.Items)
            .Include(s => s.ShippingUsages)
            .AsSplitQuery()
            .ToListAsync();

        var allLines = sales.SelectMany(ToLines)
            .Where(l => includePersonalCollection || !l.FromCollection)
            .ToList();
        var lines = allLines.Where(l => l.Sale.SaleDate.Year == year).ToList();
        var previousLines = allLines.Where(l => l.Sale.SaleDate.Year == year - 1).ToList();
        var yearSales = lines.GroupBy(l => l.Sale).ToList();

        var stock = await db.InventoryItems.AsNoTracking()
            .Include(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase)
            .Where(i => i.RemainingQuantity > 0)
            .ToListAsync();
        if (!includePersonalCollection) stock = stock.Where(i => !IsCollection(i)).ToList();

        var revenue = lines.Sum(l => l.Revenue);
        var profit = lines.Sum(l => l.Profit);

        return new InsightsDto(
            Year: year,
            Basket: Basket(yearSales),
            ByPlatform: Rows(lines, l => l.Sale.Platform.Label()).OrderByDescending(r => r.Revenue).ToList(),
            ByType: Rows(lines, l => TypeLabel(l.Stock.Type)).OrderByDescending(r => r.Revenue).ToList(),
            Customers: Customers(yearSales),
            Bulk: Bulk(lines, stock),
            ByOrigin: Rows(lines, l => l.FromCollection ? CollectionLabel : PurchasesLabel).OrderByDescending(r => r.Revenue).ToList(),
            Margins: Margins(lines, yearSales, revenue, profit),
            Purchases: await PurchasesAsync(year, allLines),
            AverageDaysToSell: AverageDays(lines.Where(l => l.Stock.Type != ItemType.Bulk)),
            DaysToSellByType: lines.GroupBy(l => TypeLabel(l.Stock.Type))
                .Select(g => new DaysRowDto(g.Key, g.Sum(l => l.Quantity), AverageDays(g)))
                .OrderBy(r => r.AverageDays).ToList(),
            StockAge: StockAge(stock, today),
            BySeries: Rows(lines.Where(l => IsSingleCard(l.Stock.Type)), l => l.Stock.Category ?? "Hors catégorie")
                .OrderByDescending(r => r.Profit).Take(15).ToList(),
            ByLanguage: Rows(lines.Where(l => IsSingleCard(l.Stock.Type)), l => string.IsNullOrWhiteSpace(l.Stock.Language) ? "Non renseignée" : l.Stock.Language!)
                .OrderByDescending(r => r.Revenue).ToList(),
            ByCondition: Rows(lines.Where(l => l.Stock.Type == ItemType.RawCard), l => ConditionLabel(l.Stock.Condition))
                .OrderBy(r => ConditionOrder(r.Label)).ToList(),
            Comparison: Comparison(year, today, previousLines, revenue, profit),
            ByWeekday: Weekdays(lines),
            ByPriceBand: PriceBands(lines.Where(l => l.Stock.Type != ItemType.Bulk)));
    }

    // ---------------------------------------------------------------

    private static IEnumerable<Line> ToLines(Sale s)
    {
        var gross = s.Items.Sum(i => i.Quantity * i.SalePrice);
        var quantity = s.Items.Sum(i => i.Quantity);
        var restocked = s.Refunds.SelectMany(r => r.Items).Where(i => i.Restocked)
            .GroupBy(i => i.SaleItemId).ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity));
        // Ajustements de la vente répartis sur ses lignes (mêmes règles que SaleService.Recalculate).
        var shippingMargin = s.ShippingUsages.Count > 0 ? s.AmountPaid - s.ShippingCost : 0m;
        var adjustments = -s.RefundedAmount - s.Fees + shippingMargin;

        foreach (var item in s.Items)
        {
            var lineGross = item.Quantity * item.SalePrice;
            var share = gross > 0 ? lineGross / gross : quantity > 0 ? item.Quantity / (decimal)quantity : 0m;
            var cost = (item.Quantity - restocked.GetValueOrDefault(item.Id)) * item.UnitCost;
            yield return new Line(
                s, item, item.InventoryItem, IsCollection(item.InventoryItem),
                item.Quantity, lineGross,
                Revenue: lineGross + (s.AmountPaid - s.RefundedAmount) * share,
                Profit: lineGross - cost + adjustments * share,
                Fees: s.Fees * share,
                Cost: cost,
                Refund: s.RefundedAmount * share);
        }
    }

    private static bool IsCollection(InventoryItem item) =>
        item.PurchaseItem?.Purchase.Source == PurchaseSource.PersonalCollection;

    private static bool IsSingleCard(ItemType type) => type is ItemType.RawCard or ItemType.GradedCard;

    private static List<StatRowDto> Rows(IEnumerable<Line> lines, Func<Line, string> key) =>
        lines.GroupBy(key).Select(g => Row(g.Key, g.ToList())).ToList();

    private static StatRowDto Row(string label, List<Line> lines)
    {
        var revenue = lines.Sum(l => l.Revenue);
        var profit = lines.Sum(l => l.Profit);
        return new StatRowDto(label, lines.Select(l => l.Sale.Id).Distinct().Count(), lines.Sum(l => l.Quantity),
            Math.Round(revenue, 2), Math.Round(profit, 2), Mappings.Margin(profit, revenue), Math.Round(lines.Sum(l => l.Fees), 2));
    }

    private static BasketDto Basket(List<IGrouping<Sale, Line>> sales)
    {
        if (sales.Count == 0) return new BasketDto(0, 0, 0, 0, 0, 0);
        var baskets = sales.Select(g => g.Sum(l => l.Revenue)).OrderBy(v => v).ToList();
        var middle = baskets.Count / 2;
        var median = baskets.Count % 2 == 1 ? baskets[middle] : (baskets[middle - 1] + baskets[middle]) / 2;
        // Une ligne de bulk compte pour un seul article (un lot de 500 cartes n'est pas 500 articles).
        var items = sales.Sum(g => g.Sum(l => l.Stock.Type == ItemType.Bulk ? 1 : l.Quantity));
        return new BasketDto(
            sales.Count,
            Math.Round(baskets.Sum() / sales.Count, 2),
            Math.Round(sales.Sum(g => g.Sum(l => l.Profit)) / sales.Count, 2),
            Math.Round((decimal)items / sales.Count, 1),
            Math.Round(median, 2),
            Math.Round(baskets[^1], 2));
    }

    private static CustomersDto Customers(List<IGrouping<Sale, Line>> sales)
    {
        var named = sales.Where(g => !string.IsNullOrWhiteSpace(g.Key.Customer)).ToList();
        var customers = named
            .GroupBy(g => g.Key.Customer!.Trim().ToLowerInvariant())
            .Select(c => new CustomerStatDto(
                c.First().Key.Customer!.Trim(),
                c.Count(),
                Math.Round(c.Sum(g => g.Sum(l => l.Revenue)), 2),
                Math.Round(c.Sum(g => g.Sum(l => l.Profit)), 2),
                c.Max(g => g.Key.SaleDate)))
            .ToList();
        var returning = customers.Where(c => c.Sales > 1).ToList();
        var namedRevenue = customers.Sum(c => c.Revenue);
        return new CustomersDto(
            customers.Count,
            returning.Count,
            namedRevenue > 0 ? Math.Round(returning.Sum(c => c.Revenue) / namedRevenue * 100, 1) : 0,
            sales.Count - named.Count,
            customers.OrderByDescending(c => c.Revenue).Take(10).ToList());
    }

    private static BulkStatsDto Bulk(List<Line> lines, List<InventoryItem> stock)
    {
        var bulk = lines.Where(l => l.Stock.Type == ItemType.Bulk).ToList();
        var cards = bulk.Sum(l => l.Quantity);
        var revenue = bulk.Sum(l => l.Revenue);
        var profit = bulk.Sum(l => l.Profit);
        var bulkStock = stock.Where(i => i.Type == ItemType.Bulk).ToList();
        return new BulkStatsDto(
            cards,
            bulk.Select(l => l.Sale.Id).Distinct().Count(),
            Math.Round(revenue, 2),
            Math.Round(profit, 2),
            Mappings.Margin(profit, revenue),
            cards > 0 ? Math.Round(bulk.Sum(l => l.Gross) / cards, 4) : 0,
            cards > 0 ? Math.Round(bulk.Sum(l => l.Cost) / cards, 4) : 0,
            Rows(bulk, l => l.FromCollection ? CollectionLabel : PurchasesLabel).OrderByDescending(r => r.Quantity).ToList(),
            bulkStock.Sum(i => i.RemainingQuantity),
            Math.Round(bulkStock.Sum(i => i.RemainingQuantity * i.PurchasePrice), 2));
    }

    private static MarginStatsDto Margins(List<Line> lines, List<IGrouping<Sale, Line>> sales, decimal revenue, decimal profit)
    {
        var fees = lines.Sum(l => l.Fees);
        // Part de chaque vente retenue (toute la vente, ou seulement ses lignes hors collection).
        decimal Weight(IGrouping<Sale, Line> g)
        {
            var gross = g.Key.Items.Sum(i => i.Quantity * i.SalePrice);
            return gross > 0 ? g.Sum(l => l.Gross) / gross : 1m;
        }
        var shipped = sales.Where(g => ShippingService.IsShipped(g.Key.ShippingCost, g.Key.Carrier)).ToList();
        return new MarginStatsDto(
            Math.Round(revenue, 2),
            Math.Round(profit, 2),
            Mappings.Margin(profit, revenue),
            Math.Round(fees, 2),
            revenue > 0 ? Math.Round(fees / revenue * 100, 1) : 0,
            Math.Round(lines.Sum(l => l.Refund), 2),
            sales.Count(g => g.Key.RefundedAmount > 0),
            Math.Round(shipped.Sum(g => g.Key.ShippingCost * Weight(g)), 2),
            Math.Round(shipped.Sum(g => g.Key.AmountPaid * Weight(g)), 2),
            Math.Round(lines.Sum(l => l.Cost), 2));
    }

    /// <summary>
    /// Achats (hors collection) de l'année : coût payé (frais compris) face à ce que leurs articles ont déjà
    /// rapporté, toutes ventes confondues (y compris les années suivantes).
    /// </summary>
    private async Task<PurchasesRoiDto> PurchasesAsync(int year, List<Line> allLines)
    {
        var (start, end) = ServiceHelpers.YearRange(year);
        var purchases = await db.Purchases.AsNoTracking()
            .Include(p => p.Items).ThenInclude(pi => pi.Item)
            .Where(p => p.Source == PurchaseSource.Supplier && p.PurchaseDate >= start && p.PurchaseDate < end)
            .ToListAsync();
        var recoveredByItem = allLines.GroupBy(l => l.Stock.Id).ToDictionary(g => g.Key, g => g.Sum(l => l.Recovered));

        var rows = purchases.Select(p =>
        {
            var recovered = Math.Round(p.Items.Sum(i => recoveredByItem.GetValueOrDefault(i.ItemId)), 2);
            var quantity = p.Items.Sum(i => i.Quantity);
            var remaining = p.Items.Sum(i => i.Item.RemainingQuantity);
            return new PurchaseRoiDto(p.Id, p.PurchaseNumber, p.PurchaseDate, p.Supplier,
                p.TotalAmount, recovered, recovered - p.TotalAmount,
                p.TotalAmount > 0 ? Math.Round(recovered / p.TotalAmount * 100, 1) : 0,
                quantity, quantity - remaining,
                Math.Round(p.Items.Sum(i => i.Item.RemainingQuantity * i.Item.PurchasePrice), 2));
        }).ToList();

        return new PurchasesRoiDto(
            rows.Count,
            rows.Count(r => r.Recovered >= r.Cost),
            rows.Sum(r => r.Cost),
            rows.Sum(r => r.Recovered),
            rows.Sum(r => r.Profit),
            rows.OrderByDescending(r => r.Profit).Take(8).ToList(),
            rows.Where(r => r.Recovered < r.Cost).OrderBy(r => r.RecoveredPercent).Take(8).ToList());
    }

    /// <summary>Nombre moyen de jours entre l'achat et la vente, pondéré par la quantité.</summary>
    private static decimal AverageDays(IEnumerable<Line> lines)
    {
        var list = lines.ToList();
        var quantity = list.Sum(l => l.Quantity);
        if (quantity == 0) return 0;
        var days = list.Sum(l => l.Quantity * (decimal)Math.Max(0, (l.Sale.SaleDate.Date - l.Stock.PurchaseDate.Date).TotalDays));
        return Math.Round(days / quantity, 1);
    }

    private static List<StockAgeRowDto> StockAge(List<InventoryItem> stock, DateTime today)
    {
        (string Label, int MaxDays)[] buckets =
            [("Moins d'un mois", 30), ("1 à 3 mois", 91), ("3 à 6 mois", 182), ("6 à 12 mois", 365), ("Plus d'un an", int.MaxValue)];
        return buckets.Select((b, index) =>
        {
            // Premier palier sans borne basse (une date d'achat future ne doit pas faire disparaître l'article).
            var min = index == 0 ? int.MinValue : buckets[index - 1].MaxDays;
            var items = stock.Where(i =>
            {
                var age = (today - i.PurchaseDate.Date).TotalDays;
                return age > min && age <= b.MaxDays;
            }).ToList();
            return new StockAgeRowDto(b.Label, items.Sum(i => i.RemainingQuantity),
                Math.Round(items.Sum(i => i.RemainingQuantity * i.PurchasePrice), 2));
        }).ToList();
    }

    private static ComparisonDto Comparison(int year, DateTime today, List<Line> previous, decimal revenue, decimal profit)
    {
        var monthly = Enumerable.Range(1, 12).Select(m =>
        {
            var inMonth = previous.Where(l => l.Sale.SaleDate.Month == m).ToList();
            return new MonthlyPoint(year - 1, m, Math.Round(inMonth.Sum(l => l.Revenue), 2),
                Math.Round(inMonth.Sum(l => l.Profit), 2), inMonth.Select(l => l.Sale.Id).Distinct().Count());
        }).ToList();

        // Projection de fin d'année au rythme actuel (année en cours seulement).
        decimal? projectedRevenue = null, projectedProfit = null;
        if (year == today.Year)
        {
            var ratio = (decimal)(DateTime.IsLeapYear(year) ? 366 : 365) / today.DayOfYear;
            projectedRevenue = Math.Round(revenue * ratio, 2);
            projectedProfit = Math.Round(profit * ratio, 2);
        }
        // Année en cours : N-1 arrêtée à la même date, pour comparer des périodes équivalentes.
        var cutoff = year == today.Year ? today.AddYears(-1).Date : DateTime.MaxValue;
        var toDate = previous.Where(l => l.Sale.SaleDate.Date <= cutoff).ToList();
        return new ComparisonDto(year - 1,
            Math.Round(previous.Sum(l => l.Revenue), 2), Math.Round(previous.Sum(l => l.Profit), 2),
            previous.Select(l => l.Sale.Id).Distinct().Count(), monthly, projectedRevenue, projectedProfit,
            Math.Round(toDate.Sum(l => l.Revenue), 2), Math.Round(toDate.Sum(l => l.Profit), 2),
            toDate.Select(l => l.Sale.Id).Distinct().Count());
    }

    private static List<StatRowDto> Weekdays(List<Line> lines)
    {
        string[] names = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
        return names.Select((name, index) =>
            Row(name, lines.Where(l => ((int)l.Sale.SaleDate.DayOfWeek + 6) % 7 == index).ToList())).ToList();
    }

    private static List<StatRowDto> PriceBands(IEnumerable<Line> lines)
    {
        (string Label, decimal Max)[] bands =
            [("Moins de 1 €", 1), ("1 à 5 €", 5), ("5 à 20 €", 20), ("20 à 50 €", 50), ("50 à 100 €", 100), ("100 € et plus", decimal.MaxValue)];
        var list = lines.ToList();
        return bands.Select((b, index) =>
        {
            var min = index == 0 ? decimal.MinValue : bands[index - 1].Max;
            return Row(b.Label, list.Where(l => l.Item.SalePrice >= min && l.Item.SalePrice < b.Max).ToList());
        }).ToList();
    }

    private static string TypeLabel(ItemType type) => type switch
    {
        ItemType.RawCard => "Cartes à l'unité",
        ItemType.GradedCard => "Cartes gradées",
        ItemType.Bulk => "Bulk",
        ItemType.Booster => "Boosters",
        ItemType.Blister => "Blisters",
        ItemType.Etb => "ETB",
        ItemType.Box => "Coffrets",
        ItemType.Display => "Displays",
        ItemType.MiniTin => "Mini-tins",
        ItemType.Pokebox => "Pokébox",
        ItemType.Bundle => "Bundles",
        _ => "Autre"
    };

    private static readonly string[] Conditions = ["Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];

    private static string ConditionLabel(ItemCondition condition) => Conditions[(int)condition];

    private static int ConditionOrder(string label) => Array.IndexOf(Conditions, label);
}
