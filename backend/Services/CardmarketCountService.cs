using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Comptage du bulk avec l'export Cardmarket (extension du navigateur).
///
/// Les cartes en vente sur Cardmarket sont comptées par groupe (communes / peu communes / rares non holo,
/// holo, reverses, V / EX / GX) et comparées au stock de la catégorie de bulk associée à chaque groupe.
/// En cas d'écart, la différence est ajoutée à la collection personnelle (transfert C… à 0 €), ou retirée
/// des lots de collection de la catégorie. Les lots achetés ne sont jamais modifiés : leur coût et le
/// registre des achats restent intacts. Les cartes spéciales (Illustration Rare, Secret, promos…) et celles
/// suivies une par une dans l'inventaire sont listées à part, sans être comptées.
/// </summary>
public partial class CardmarketCountService(AppDbContext db, BulkSettingsService bulkSettings)
{
    public const string CommonGroup = "Communes / Peu communes / Rares";
    public const string HoloGroup = "Holo";
    public const string ReverseGroup = "Reverses";
    public const string BigGroup = "V / EX / GX";
    private static readonly string[] Groups = [CommonGroup, HoloGroup, ReverseGroup, BigGroup];

    /// <summary>Codes des séries Écarlate et Violet et suivantes (rares holo), si le catalogue ne les connaît pas.</summary>
    private static readonly HashSet<string> ModernSetCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "SVI", "PAL", "OBF", "MEW", "PAR", "PAF", "TEF", "TWM", "SFA", "SCR", "SSP", "PRE", "JTG", "DRI",
        "BLK", "WHT", "BLW", "RSV", "SVP", "SVE", "MEG", "PFL", "ASC", "MEE", "MEP"
    };

    private sealed record Counted(CardmarketRowInput Row, string? Group, string Reason);

    public async Task<CardmarketCountDto> AnalyzeAsync(CardmarketCountRequest request)
    {
        var (counted, ignored) = await ClassifyAsync(request.Rows);
        var categories = await CategoriesAsync();
        var mappings = Mappings(request, categories);

        var groups = Groups.Select(group =>
        {
            var rows = counted.Where(c => c.Group == group).ToList();
            var cards = rows.Sum(c => c.Row.Amount);
            var category = mappings.GetValueOrDefault(group);
            var stock = category is null ? null : categories.First(c => c.Name == category);
            return new CardmarketGroupDto(group, cards, Math.Round(rows.Sum(c => c.Row.Amount * c.Row.Price), 2),
                category, stock?.Cards, stock?.CollectionCards, stock is null ? null : cards - stock.Cards);
        }).ToList();

        var apart = counted.Where(c => c.Group is null)
            .Select(c => new CardmarketCountedCardDto(c.Row.Name, c.Row.SetCode, c.Row.Number, c.Row.Rarity?.Trim(), c.Row.Reverse,
                c.Row.Price, c.Row.Amount, c.Reason))
            .OrderByDescending(c => c.Price)
            .ToList();
        return new CardmarketCountDto(groups, categories, apart, ignored);
    }

    public async Task<CardmarketCountResultDto> ApplyAsync(CardmarketCountRequest request)
    {
        var analysis = await AnalyzeAsync(request);
        var today = DateTime.Today;
        var adjustments = new List<CardmarketAdjustmentDto>();
        Purchase? transfer = null;
        // Lots de collection chargés une seule fois (suivis) : chaque groupe a sa catégorie, mais un transfert
        // peut contenir des lots de plusieurs catégories.
        List<InventoryItem>? collectionLots = null;
        var touched = new HashSet<Purchase>();

        foreach (var group in analysis.Groups.Where(g => g.Category is not null && g.Difference is not null and not 0))
        {
            var category = group.Category!;
            var difference = group.Difference!.Value;
            if (difference > 0)
            {
                // Plus de cartes sur Cardmarket : la différence entre dans le bulk depuis la collection (0 €).
                transfer ??= new Purchase
                {
                    PurchaseNumber = await NumberGenerator.NextAsync(db.Purchases.Select(p => p.PurchaseNumber), "C", today.Year),
                    Source = PurchaseSource.PersonalCollection,
                    PurchaseDate = today,
                    Supplier = PurchaseService.CollectionSupplier,
                    Comment = "Ajustement du bulk d'après le comptage Cardmarket"
                };
                var item = new InventoryItem
                {
                    Name = category, Type = ItemType.Bulk, Condition = ItemCondition.EXC,
                    Quantity = difference, RemainingQuantity = difference, PurchasePrice = 0m, PurchaseDate = today
                };
                transfer.Items.Add(new PurchaseItem { Item = item, Quantity = difference, UnitPrice = 0m });
                adjustments.Add(new CardmarketAdjustmentDto(group.Group, category, difference, 0, 0));
            }
            else
            {
                collectionLots ??= await CollectionLotsAsync();
                var (removed, notRemoved) = await RemoveFromCollectionAsync(collectionLots, touched, category, -difference);
                adjustments.Add(new CardmarketAdjustmentDto(group.Group, category, 0, removed, notRemoved));
            }
        }

        await CleanUpPurchasesAsync(touched);
        if (transfer is not null) db.Purchases.Add(transfer);
        await db.SaveChangesAsync();
        return new CardmarketCountResultDto(adjustments, transfer?.PurchaseNumber);
    }

    // ---------------------------------------------------------------

    /// <summary>Range chaque ligne de l'export dans un groupe, ou à part (avec la raison).</summary>
    private async Task<(List<Counted> Counted, int Ignored)> ClassifyAsync(List<CardmarketRowInput>? rows)
    {
        if (rows is null || rows.Count == 0) throw new BusinessException("Le fichier ne contient aucune carte.");
        var valid = rows.Where(r => r.Amount > 0 && !string.IsNullOrWhiteSpace(r.Name)).ToList();

        // Séries : Écarlate et Violet et suivantes (rares holo) d'après le bloc du catalogue, sinon d'après le code.
        var codes = valid.Where(r => !string.IsNullOrWhiteSpace(r.SetCode)).Select(r => r.SetCode!.Trim().ToUpperInvariant()).Distinct().ToList();
        var catalog = await db.CatalogCards.AsNoTracking()
            .Where(c => c.SetCode != null && codes.Contains(c.SetCode))
            .Select(c => new { c.Id, c.SetCode, c.SerieName, c.Number, c.CardmarketId, c.Language })
            .ToListAsync();
        var modern = codes.ToDictionary(code => code, code =>
        {
            var serie = catalog.FirstOrDefault(c => string.Equals(c.SetCode, code, StringComparison.OrdinalIgnoreCase) && c.SerieName != null)?.SerieName;
            return serie is not null ? ModernSerieRegex().IsMatch(serie) : ModernSetCodes.Contains(code);
        });

        // Cartes suivies une par une dans l'inventaire (liées au catalogue) : pas du bulk.
        var tracked = await db.InventoryItems.AsNoTracking()
            .Where(i => i.Type == ItemType.RawCard && i.RemainingQuantity > 0 && i.CatalogCardId != null)
            .Select(i => i.CatalogCardId!.Value)
            .Distinct()
            .ToListAsync();
        var trackedCards = catalog.Where(c => tracked.Contains(c.Id)).ToList();
        bool IsTracked(CardmarketRowInput r) => trackedCards.Any(c =>
            c.CardmarketId == r.IdProduct
            || (c.CardmarketId == null && r.Number is not null && string.Equals(c.SetCode, r.SetCode?.Trim(), StringComparison.OrdinalIgnoreCase)
                && CatalogService.SameNumber(c.Number, r.Number)));

        var counted = valid.Select(r =>
        {
            if (IsTracked(r)) return new Counted(r, null, "Suivie une par une dans l'inventaire");
            var isModern = r.SetCode is not null && modern.GetValueOrDefault(r.SetCode.Trim().ToUpperInvariant());
            return Classify(r, isModern);
        }).ToList();
        return (counted, rows.Count - valid.Count);
    }

    /// <summary>
    /// Règles : reverse -> Reverses ; V, VMAX, VSTAR, EX, GX, ex (ou Double / Ultra Rare) -> V / EX / GX ;
    /// commune, peu commune -> Communes ; rare : holo à partir d'Écarlate et Violet, sinon Communes ; rare holo -> Holo.
    /// Les autres raretés (Illustration Rare, Secret, promo…) sont mises à part.
    /// </summary>
    private static Counted Classify(CardmarketRowInput row, bool modern)
    {
        var rarity = (row.Rarity ?? "").Trim().ToLowerInvariant();
        var name = CleanName(row.Name);
        var basic = rarity is "common" or "uncommon" or "rare" or "holo rare" or "rare holo" or "commune" or "peu commune";
        var big = rarity is "double rare" or "ultra rare" || rarity.StartsWith("rare holo v") || rarity.Contains("gx")
                  || (rarity is "rare" or "holo rare" or "rare holo" && BigNameRegex().IsMatch(name));

        if (row.Reverse && basic) return new Counted(row, ReverseGroup, "Reverse");
        if (big) return new Counted(row, BigGroup, "V / EX / GX");
        return rarity switch
        {
            "common" or "uncommon" or "commune" or "peu commune" => new Counted(row, CommonGroup, "Commune / peu commune"),
            "rare" => modern ? new Counted(row, HoloGroup, "Rare (holo depuis Écarlate et Violet)") : new Counted(row, CommonGroup, "Rare non holo"),
            "holo rare" or "rare holo" => new Counted(row, HoloGroup, "Rare holo"),
            "" => new Counted(row, null, "Rareté non renseignée"),
            _ => new Counted(row, null, $"Rareté « {row.Rarity!.Trim()} »")
        };
    }

    /// <summary>Catégories de bulk de l'appli : stock total et part venant de la collection.</summary>
    private async Task<List<CardmarketBulkCategoryDto>> CategoriesAsync()
    {
        var lots = await db.InventoryItems.AsNoTracking()
            .Where(i => i.Type == ItemType.Bulk && i.RemainingQuantity > 0)
            .Select(i => new { i.Name, i.RemainingQuantity, Collection = i.PurchaseItem != null && i.PurchaseItem.Purchase.Source == PurchaseSource.PersonalCollection })
            .ToListAsync();
        var settings = await bulkSettings.GetAsync();
        var names = (settings.Categories ?? [])
            .Where(c => !string.IsNullOrWhiteSpace(c?.Name))
            .Select(c => c.Name.Trim())
            .Concat(lots.Select(l => l.Name.Trim()))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return names.Select(name =>
        {
            var inCategory = lots.Where(l => string.Equals(l.Name.Trim(), name, StringComparison.OrdinalIgnoreCase)).ToList();
            return new CardmarketBulkCategoryDto(name, inCategory.Sum(l => l.RemainingQuantity),
                inCategory.Where(l => l.Collection).Sum(l => l.RemainingQuantity));
        }).ToList();
    }

    /// <summary>Associations groupe -> catégorie demandées (catégorie existante, une catégorie par groupe).</summary>
    private static Dictionary<string, string> Mappings(CardmarketCountRequest request, List<CardmarketBulkCategoryDto> categories)
    {
        var result = new Dictionary<string, string>();
        foreach (var mapping in request.Mappings ?? [])
        {
            if (!Groups.Contains(mapping.Group) || string.IsNullOrWhiteSpace(mapping.Category)) continue;
            var category = categories.FirstOrDefault(c => string.Equals(c.Name, mapping.Category.Trim(), StringComparison.OrdinalIgnoreCase))
                           ?? throw new BusinessException($"La catégorie de bulk « {mapping.Category} » n'existe pas.");
            if (result.ContainsValue(category.Name))
                throw new BusinessException($"« {category.Name} » est associée à deux groupes : une catégorie par groupe.");
            result[mapping.Group] = category.Name;
        }
        return result;
    }

    /// <summary>Lots de bulk encore en stock venant d'un transfert de collection (suivis, avec leur transfert complet).</summary>
    private Task<List<InventoryItem>> CollectionLotsAsync() =>
        db.InventoryItems
            .Include(i => i.PurchaseItem!).ThenInclude(pi => pi.Purchase).ThenInclude(p => p.Items)
            .Where(i => i.Type == ItemType.Bulk && i.RemainingQuantity > 0
                        && i.PurchaseItem != null && i.PurchaseItem.Purchase.Source == PurchaseSource.PersonalCollection)
            .OrderByDescending(i => i.PurchaseDate).ThenByDescending(i => i.Id)
            .ToListAsync();

    /// <summary>
    /// Retire des cartes des lots de collection d'une catégorie, les plus récents d'abord.
    /// Renvoie le nombre retiré et ce qui n'a pas pu l'être (pas assez de cartes de collection).
    /// </summary>
    private async Task<(int Removed, int NotRemoved)> RemoveFromCollectionAsync(
        List<InventoryItem> collectionLots, HashSet<Purchase> touched, string category, int quantity)
    {
        var lots = collectionLots
            .Where(l => l.RemainingQuantity > 0 && string.Equals(l.Name.Trim(), category, StringComparison.OrdinalIgnoreCase))
            .ToList();

        var left = quantity;
        foreach (var lot in lots)
        {
            if (left == 0) break;
            var line = lot.PurchaseItem!;
            var take = Math.Min(left, lot.RemainingQuantity);
            lot.Quantity -= take;
            lot.RemainingQuantity -= take;
            line.Quantity -= take;
            left -= take;
            touched.Add(line.Purchase);

            // Lot vidé, jamais vendu et sans photo : sa ligne disparaît (le transfert vide est traité ensuite).
            if (lot.Quantity == 0
                && !await db.SaleItems.AnyAsync(s => s.InventoryItemId == lot.Id)
                && !await db.Attachments.AnyAsync(a => a.OwnerType == AttachmentOwner.InventoryItem && a.OwnerId == lot.Id))
            {
                db.PurchaseItems.Remove(line);
                db.InventoryItems.Remove(lot);
            }
        }
        return (quantity - left, left);
    }

    /// <summary>
    /// Transferts modifiés : total recalculé sur les lignes restantes ; un transfert sans ligne et sans pièce jointe
    /// est supprimé. La collection Items n'est pas modifiée pendant le retrait (lignes supprimées repérées par leur état).
    /// </summary>
    private async Task CleanUpPurchasesAsync(HashSet<Purchase> touched)
    {
        foreach (var purchase in touched)
        {
            var remaining = purchase.Items.Where(pi => db.Entry(pi).State != EntityState.Deleted).ToList();
            if (remaining.Count == 0
                && !await db.Attachments.AnyAsync(a => a.OwnerType == AttachmentOwner.Purchase && a.OwnerId == purchase.Id))
            {
                db.Purchases.Remove(purchase);
                continue;
            }
            purchase.TotalAmount = Math.Round(
                remaining.Sum(pi => pi.Quantity * pi.UnitPrice) + purchase.PlatformFees + purchase.ShippingFees, 2);
        }
    }

    /// <summary>« Abra (MEW 063) » -> « Abra ».</summary>
    private static string CleanName(string name) => TrailingParenthesisRegex().Replace(name.Trim(), "");

    [GeneratedRegex(@"\s*\([^()]*\)\s*$")]
    private static partial Regex TrailingParenthesisRegex();

    /// <summary>Cartes V / EX / GX d'après le nom : « Mew V », « Palkia Originel VSTAR », « Dracaufeu ex », « Mewtwo GX ».</summary>
    [GeneratedRegex(@"(^|\s)(V|VMAX|VSTAR|V-UNION|EX|ex|GX|TAG TEAM)(\s|$)")]
    private static partial Regex BigNameRegex();

    [GeneratedRegex(@"carlate|Scarlet|M[ée]ga", RegexOptions.IgnoreCase)]
    private static partial Regex ModernSerieRegex();
}
