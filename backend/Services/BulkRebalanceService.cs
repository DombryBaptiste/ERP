using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Recalcul des ventes de bulk déjà enregistrées avec la règle « achats d'abord ».
///
/// Une vente de bulk prélève d'abord les lots ACHETÉS (du plus ancien au plus récent), puis ceux de la
/// collection (0 €) : on récupère d'abord l'argent réellement dépensé. Les ventes enregistrées avec une
/// autre règle (FIFO pur, puis prorata) sont rejouées dans l'ordre chronologique avec cette règle, puis
/// les lignes des ventes, le stock restant de chaque lot et le bénéfice sont mis à jour.
///
/// Ne change jamais : le montant des ventes (CA, URSSAF, livre des recettes), les frais, les achats.
/// Ventes laissées telles quelles (mais prises en compte dans le stock) : celles avec un remboursement
/// portant sur le bulk, et celles où le bulk d'une même catégorie est vendu à plusieurs prix différents.
/// </summary>
public class BulkRebalanceService(AppDbContext db)
{
    /// <summary>Aperçu : calcule le recalcul sans rien enregistrer.</summary>
    public async Task<BulkRebalanceDto> PreviewAsync() => await RunAsync(apply: false);

    /// <summary>Applique le recalcul (en un seul SaveChanges, donc dans une transaction).</summary>
    public async Task<BulkRebalanceDto> ApplyAsync() => await RunAsync(apply: true);

    private async Task<BulkRebalanceDto> RunAsync(bool apply)
    {
        var lots = await db.InventoryItems
            .Include(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase)
            .Where(i => i.Type == ItemType.Bulk)
            .ToListAsync();
        var sales = await db.Sales
            .Include(s => s.Items).ThenInclude(i => i.InventoryItem)
            .Include(s => s.Refunds).ThenInclude(r => r.Items)
            .Include(s => s.ShippingUsages)
            .Where(s => s.Items.Any(i => i.InventoryItem.Type == ItemType.Bulk))
            .OrderBy(s => s.SaleDate).ThenBy(s => s.Id)
            .AsSplitQuery()
            .ToListAsync();

        var changes = new List<BulkRebalanceSaleDto>();
        var skipped = new List<string>();
        var newLines = new Dictionary<(int SaleId, string Product), List<(InventoryItem Lot, int Quantity, decimal Price)>>();
        var finalRemaining = new Dictionary<int, int>();

        foreach (var product in lots.GroupBy(ProductKey))
        {
            // Ordre de prélèvement : lots achetés (du plus ancien au plus récent), puis collection.
            var productLots = product.OrderBy(l => IsCollection(l) ? 1 : 0).ThenBy(l => l.PurchaseDate).ThenBy(l => l.Id).ToList();
            var ids = productLots.Select(l => l.Id).ToHashSet();
            var remaining = productLots.ToDictionary(l => l.Id, l => l.Quantity);
            var plan = new Dictionary<int, List<(InventoryItem Lot, int Quantity, decimal Price)>>();
            string? failure = null;

            foreach (var sale in sales)
            {
                var lines = sale.Items.Where(i => ids.Contains(i.InventoryItemId)).ToList();
                if (lines.Count == 0) continue;

                var hasRefund = sale.Refunds.SelectMany(r => r.Items).Any(ri => lines.Any(l => l.Id == ri.SaleItemId));
                var prices = lines.Select(l => l.SalePrice).Distinct().Count();
                if (hasRefund || prices > 1)
                {
                    // Vente laissée telle quelle : ses lignes prélèvent leurs lots actuels.
                    skipped.Add($"{sale.SaleNumber} ({product.First().Name}) : "
                                + (hasRefund ? "remboursement sur le bulk" : "plusieurs prix pour la même catégorie"));
                    foreach (var line in lines)
                        remaining[line.InventoryItemId] -= line.Quantity - sale.RestockedQuantity(line.Id);
                    if (remaining.Values.Any(r => r < 0)) { failure = $"stock incohérent à la vente {sale.SaleNumber}"; break; }
                    continue;
                }

                var quantity = lines.Sum(l => l.Quantity);
                if (quantity <= 0) continue;
                // Lots déjà achetés à la date de la vente ; à défaut (dates saisies après coup), tous les lots.
                var available = productLots.Where(l => l.PurchaseDate.Date <= sale.SaleDate.Date && remaining[l.Id] > 0).ToList();
                if (available.Sum(l => remaining[l.Id]) < quantity)
                    available = productLots.Where(l => remaining[l.Id] > 0).ToList();
                var allocation = Allocate(available, quantity, l => remaining[l.Id]);
                if (allocation is null) { failure = $"stock insuffisant à la vente {sale.SaleNumber}"; break; }

                foreach (var (lot, qty) in allocation) remaining[lot.Id] -= qty;
                plan[sale.Id] = allocation.Select(a => (a.Lot, a.Quantity, lines[0].SalePrice)).ToList();
            }

            // Garde-fou : le stock restant total de la catégorie doit rester le même (seule sa répartition change).
            if (failure is null && remaining.Values.Sum() != productLots.Sum(l => l.RemainingQuantity))
                failure = "le stock restant ne correspond pas à l'historique des ventes";
            if (failure is not null)
            {
                skipped.Add($"Catégorie « {product.First().Name} » non recalculée : {failure}.");
                continue;
            }
            foreach (var (saleId, lines) in plan) newLines[(saleId, product.Key)] = lines;
            foreach (var (lotId, left) in remaining) finalRemaining[lotId] = left;
        }

        // Nouveau bénéfice de chaque vente modifiée.
        foreach (var sale in sales)
        {
            var keys = newLines.Keys.Where(k => k.SaleId == sale.Id).ToList();
            if (keys.Count == 0) continue;

            var oldProfit = sale.Profit;
            var oldCost = 0m;
            var newCost = 0m;
            var rewritten = false;
            foreach (var key in keys)
            {
                var replaced = sale.Items.Where(i => ProductKey(i.InventoryItem) == key.Product).ToList();
                oldCost += replaced.Sum(i => i.Quantity * i.UnitCost);
                newCost += newLines[key].Sum(l => l.Quantity * l.Lot.PurchasePrice);
                if (!apply || SameLines(replaced, newLines[key])) continue;
                rewritten = true;
                foreach (var line in replaced)
                {
                    sale.Items.Remove(line);
                    db.SaleItems.Remove(line);
                }
                foreach (var (lot, qty, price) in newLines[key])
                    sale.Items.Add(new SaleItem { InventoryItem = lot, InventoryItemId = lot.Id, Quantity = qty, SalePrice = price, UnitCost = lot.PurchasePrice });
            }
            var newProfit = Math.Round(oldProfit + oldCost - newCost, 2);
            if (rewritten)
            {
                var total = sale.TotalAmount;
                SaleService.Recalculate(sale);
                // Sécurité : le montant de la vente (CA) ne doit jamais changer.
                if (sale.TotalAmount != total)
                    throw new BusinessException($"Recalcul annulé : le montant de la vente {sale.SaleNumber} changerait.");
                newProfit = sale.Profit;
            }
            if (Math.Round(oldCost, 2) == Math.Round(newCost, 2)) continue;
            changes.Add(new BulkRebalanceSaleDto(sale.Id, sale.SaleNumber, sale.SaleDate,
                string.Join(", ", keys.Select(k => sale.Items.First(i => ProductKey(i.InventoryItem) == k.Product).InventoryItem.Name).Distinct()),
                sale.Items.Where(i => i.InventoryItem.Type == ItemType.Bulk).Sum(i => i.Quantity),
                Math.Round(oldCost, 2), Math.Round(newCost, 2), oldProfit, newProfit));
        }

        if (apply)
        {
            foreach (var lot in lots)
                if (finalRemaining.TryGetValue(lot.Id, out var left)) lot.RemainingQuantity = left;
            await db.SaveChangesAsync();
        }

        return new BulkRebalanceDto(
            apply,
            changes,
            Math.Round(changes.Sum(c => c.NewProfit - c.OldProfit), 2),
            skipped);
    }

    /// <summary>Lignes actuelles identiques à la nouvelle répartition (mêmes lots, quantités, prix et coûts) : rien à réécrire.</summary>
    private static bool SameLines(List<SaleItem> current, List<(InventoryItem Lot, int Quantity, decimal Price)> planned) =>
        current.Count == planned.Count
        && current.OrderBy(i => i.InventoryItemId).Zip(planned.OrderBy(p => p.Lot.Id))
            .All(x => x.First.InventoryItemId == x.Second.Lot.Id && x.First.Quantity == x.Second.Quantity
                      && x.First.SalePrice == x.Second.Price && x.First.UnitCost == x.Second.Lot.PurchasePrice);

    /// <summary>Prélèvement dans l'ordre des lots (achats d'abord, puis collection) ; null si stock insuffisant.</summary>
    private static List<(InventoryItem Lot, int Quantity)>? Allocate(List<InventoryItem> lots, int quantity, Func<InventoryItem, int> stock)
    {
        if (quantity <= 0) return [];
        if (lots.Sum(stock) < quantity) return null;
        var result = new List<(InventoryItem Lot, int Quantity)>();
        var wanted = quantity;
        foreach (var lot in lots)
        {
            if (wanted == 0) break;
            var take = Math.Min(wanted, stock(lot));
            if (take <= 0) continue;
            result.Add((lot, take));
            wanted -= take;
        }
        return result;
    }

    private static bool IsCollection(InventoryItem lot) =>
        lot.PurchaseItem?.Purchase.Source == PurchaseSource.PersonalCollection;

    /// <summary>Même clé produit que l'application : nom sans accents ni majuscules + état.</summary>
    private static string ProductKey(InventoryItem item)
    {
        var decomposed = item.Name.Normalize(NormalizationForm.FormD);
        var name = new string(decomposed.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray());
        name = string.Join(' ', name.ToLowerInvariant().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return $"{name}|{item.Type}|{item.Condition}";
    }
}
