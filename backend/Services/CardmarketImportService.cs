using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Rapprochement du stock avec l'export Cardmarket (extension du navigateur) : cartes à l'unité uniquement.
///
/// L'export dit ce qui est EN VENTE, pas ce que les cartes ont coûté. L'import ne fait donc jamais baisser le
/// stock tout seul (une carte absente peut être vendue, retirée ou perdue) :
///  - carte en vente sur Cardmarket mais absente de l'appli (ou en plus grand nombre) : elle est ajoutée, soit
///    « sortie du bulk » (elle quitte une catégorie de bulk et garde le coût de son lot, donc aucun prix à saisir),
///    soit depuis la collection (0 €) ;
///  - carte déjà dans l'appli : cochée « en vente sur Cardmarket », le prix Cardmarket devient sa valeur de marché ;
///  - carte de l'appli absente de l'export : listée et décochée « en vente sur Cardmarket ».
///
/// Sortir N cartes d'un lot de bulk : le lot (et sa ligne d'achat) perd N cartes, et autant de cartes à l'unité
/// sont ajoutées au MÊME achat au même prix unitaire. Le total de l'achat ne change pas (registre intact).
/// Les cartes sont prises au prorata de chaque lot de la catégorie, comme les ventes de bulk.
/// </summary>
public partial class CardmarketImportService(AppDbContext db)
{
    private const string Bulk = "bulk";
    private const string Collection = "collection";

    /// <summary>Lignes de l'export regroupées (même produit, version normale/reverse, état et langue).</summary>
    private sealed class Group
    {
        public required string Key { get; init; }
        public required long IdProduct { get; init; }
        public required string Name { get; init; }
        public string? SetCode { get; init; }
        public string? Number { get; init; }
        public string? Expansion { get; init; }
        public string? Rarity { get; init; }
        public required string LanguageLabel { get; init; }
        /// <summary>Code de langue du catalogue (fr, ja…) ; null si la langue n'existe pas dans le catalogue.</summary>
        public string? LanguageCode { get; init; }
        public required ItemCondition Condition { get; init; }
        public required bool Reverse { get; init; }
        public decimal Price { get; set; }
        public int Amount { get; set; }
        public CatalogCard? Card { get; set; }
        /// <summary>Lots de l'appli correspondant à cette carte (stock restant > 0).</summary>
        public List<InventoryItem> Lots { get; } = [];
        public int AppQuantity => Lots.Sum(l => l.RemainingQuantity);
    }

    private sealed record Analysis(List<Group> Groups, List<InventoryItem> Extras, int IgnoredRows,
        Dictionary<int, CatalogCard> ItemCards);

    public async Task<CardmarketAnalysisDto> AnalyzeAsync(CardmarketImportRequest request)
    {
        var analysis = await AnalyzeCoreAsync(request);
        var bulkPools = (await BulkLotsAsync())
            .GroupBy(l => l.Name.Trim())
            .Select(g => new CardmarketBulkPoolDto(g.Key, g.Sum(l => l.RemainingQuantity),
                Math.Round(g.Sum(l => l.RemainingQuantity * l.PurchasePrice) / Math.Max(1, g.Sum(l => l.RemainingQuantity)), 6)))
            .OrderByDescending(p => p.Cards)
            .ToList();

        return new CardmarketAnalysisDto(
            analysis.Groups
                .Select(g => new CardmarketLineDto(g.Key, g.IdProduct, g.Card?.Name ?? g.Name, g.SetCode, g.Number, g.Expansion, g.Rarity,
                    g.LanguageLabel, g.Condition, g.Reverse, g.Price, g.Amount, g.AppQuantity, g.Card?.Id))
                .ToList(),
            Extras(analysis),
            bulkPools,
            analysis.IgnoredRows);
    }

    public async Task<CardmarketImportResultDto> ApplyAsync(CardmarketImportRequest request)
    {
        var analysis = await AnalyzeCoreAsync(request);
        var choices = new Dictionary<string, string>();
        foreach (var c in request.Choices ?? [])
            if (!string.IsNullOrEmpty(c.Key)) choices[c.Key] = (c.Origin ?? "").Trim().ToLowerInvariant();
        string OriginOf(Group g) => choices.GetValueOrDefault(g.Key, "ignore");
        var toAdd = analysis.Groups.Where(g => g.Amount > g.AppQuantity && OriginOf(g) is Bulk or Collection).ToList();

        // Tout ou rien : les cartes du catalogue sont enregistrées avant le reste (il faut leur id).
        await using var transaction = await db.Database.BeginTransactionAsync();

        // 1. Cartes du catalogue manquantes (créées comme cartes « ajoutées à la main », avec l'id produit Cardmarket).
        var cardsCreated = await CreateMissingCatalogCardsAsync(toAdd);

        var today = DateTime.Today;
        var newItems = new List<InventoryItem>();
        InventoryItem NewItem(Group g, int quantity, decimal unitCost, DateTime date, string? location)
        {
            var item = new InventoryItem
            {
                Name = ItemName(g),
                Language = g.LanguageLabel,
                Type = ItemType.RawCard,
                Condition = g.Condition,
                Quantity = quantity,
                RemainingQuantity = quantity,
                PurchasePrice = unitCost,
                PurchaseDate = date,
                Location = location,
                CatalogCardId = g.Card?.Id,
                IsListedOnCardmarket = true
            };
            InventoryService.ApplyMarketValue(item, g.Price);
            newItems.Add(item);
            return item;
        }

        // 2. Cartes sorties du bulk : prélevées au prorata des lots de la catégorie choisie.
        var fromBulk = toAdd.Where(g => OriginOf(g) == Bulk).ToList();
        var bulkCards = fromBulk.Sum(g => g.Amount - g.AppQuantity);
        if (bulkCards > 0)
        {
            var category = request.BulkCategory?.Trim();
            if (string.IsNullOrEmpty(category))
                throw new BusinessException("Choisissez la catégorie de bulk d'où sortent les cartes.");
            var lots = (await BulkLotsAsync())
                .Where(l => string.Equals(l.Name.Trim(), category, StringComparison.OrdinalIgnoreCase))
                .ToList();
            var available = lots.Sum(l => l.RemainingQuantity);
            if (available < bulkCards)
                throw new BusinessException($"« {category} » n'a que {available} carte(s) en stock : il en faut {bulkCards}.");

            var budgets = Proportional(lots.Select(l => l.RemainingQuantity).ToList(), bulkCards);
            var lotIndex = 0;
            foreach (var g in fromBulk)
            {
                var wanted = g.Amount - g.AppQuantity;
                while (wanted > 0)
                {
                    while (budgets[lotIndex] == 0) lotIndex++;
                    var lot = lots[lotIndex];
                    var take = Math.Min(wanted, budgets[lotIndex]);
                    budgets[lotIndex] -= take;
                    wanted -= take;

                    var line = lot.PurchaseItem!;
                    lot.Quantity -= take;
                    lot.RemainingQuantity -= take;
                    line.Quantity -= take;
                    db.PurchaseItems.Add(new PurchaseItem
                    {
                        PurchaseId = line.PurchaseId,
                        Item = NewItem(g, take, lot.PurchasePrice, lot.PurchaseDate, lot.Location),
                        Quantity = take,
                        UnitPrice = line.UnitPrice
                    });
                }
            }
            // Lot de bulk entièrement sorti et jamais vendu : sa ligne d'achat disparaît.
            // (Gardé à 0 s'il est référencé par une vente — vendu puis remis en stock — ou par un fichier joint.)
            var emptied = lots.Where(l => l.Quantity == 0).ToList();
            if (emptied.Count > 0)
            {
                var ids = emptied.Select(l => l.Id).ToList();
                var referenced = (await db.SaleItems.Where(s => ids.Contains(s.InventoryItemId)).Select(s => s.InventoryItemId).ToListAsync())
                    .Concat(await db.Attachments.Where(a => a.OwnerType == AttachmentOwner.InventoryItem && ids.Contains(a.OwnerId))
                        .Select(a => a.OwnerId).ToListAsync())
                    .ToHashSet();
                foreach (var lot in emptied.Where(l => !referenced.Contains(l.Id)))
                {
                    db.PurchaseItems.Remove(lot.PurchaseItem!);
                    db.InventoryItems.Remove(lot);
                }
            }
        }

        // 3. Cartes de la collection : un transfert de collection (C…) à 0 €.
        string? transferNumber = null;
        var fromCollection = toAdd.Where(g => OriginOf(g) == Collection).ToList();
        if (fromCollection.Count > 0)
        {
            var transfer = new Purchase
            {
                PurchaseNumber = await NumberGenerator.NextAsync(db.Purchases.Select(p => p.PurchaseNumber), "C", today.Year),
                Source = PurchaseSource.PersonalCollection,
                PurchaseDate = today,
                Supplier = PurchaseService.CollectionSupplier,
                Comment = "Import du stock Cardmarket"
            };
            foreach (var g in fromCollection)
            {
                var quantity = g.Amount - g.AppQuantity;
                transfer.Items.Add(new PurchaseItem { Item = NewItem(g, quantity, 0m, today, null), Quantity = quantity, UnitPrice = 0m });
            }
            transfer.TotalAmount = PurchaseService.ComputeTotal(transfer);
            db.Purchases.Add(transfer);
            transferNumber = transfer.PurchaseNumber;
        }

        // 4. Cartes déjà en stock : en vente sur Cardmarket, au prix de l'export ; cartes absentes : plus en vente.
        var listed = 0;
        foreach (var g in analysis.Groups)
            foreach (var lot in g.Lots)
            {
                lot.IsListedOnCardmarket = true;
                InventoryService.ApplyMarketValue(lot, g.Price);
                if (lot.CatalogCardId is null && g.Card is not null) lot.CatalogCardId = g.Card.Id;
                listed++;
            }
        foreach (var extra in analysis.Extras) extra.IsListedOnCardmarket = false;

        // Lots existants : seulement ceux liés au catalogue (sinon leur catégorie deviendrait « Hors catégorie »).
        await CatalogService.ApplyCatalogLinksAsync(db,
            newItems.Concat(analysis.Groups.SelectMany(g => g.Lots).Where(l => l.CatalogCardId is not null)));
        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        return new CardmarketImportResultDto(
            newItems.Sum(i => i.Quantity),
            fromBulk.Sum(g => g.Amount - g.AppQuantity),
            fromCollection.Sum(g => g.Amount - g.AppQuantity),
            cardsCreated, listed, analysis.Extras.Count, transferNumber);
    }

    // ---------------------------------------------------------------

    private async Task<Analysis> AnalyzeCoreAsync(CardmarketImportRequest request)
    {
        if (request.Rows is null || request.Rows.Count == 0)
            throw new BusinessException("Le fichier ne contient aucune carte.");

        // Regroupement des lignes de l'export.
        var ignored = 0;
        var groups = new Dictionary<string, Group>();
        foreach (var row in request.Rows)
        {
            var condition = ConditionOf(row.Condition);
            if (row.IdProduct <= 0 || row.Amount <= 0 || condition is null || string.IsNullOrWhiteSpace(row.Name)) { ignored++; continue; }
            var language = string.IsNullOrWhiteSpace(row.Language) ? "Français" : row.Language.Trim();
            var key = $"{row.IdProduct}|{(row.Reverse ? "R" : "N")}|{condition}|{language}";
            if (!groups.TryGetValue(key, out var group))
            {
                group = new Group
                {
                    Key = key, IdProduct = row.IdProduct, Name = CleanName(row.Name, row.SetCode, row.Number),
                    SetCode = row.SetCode.TrimOrNull()?.ToUpperInvariant(), Number = row.Number.TrimOrNull(),
                    Expansion = row.Expansion.TrimOrNull(), Rarity = row.Rarity.TrimOrNull(),
                    LanguageLabel = language,
                    LanguageCode = CatalogService.LanguageLabels.FirstOrDefault(l => string.Equals(l.Value, language, StringComparison.OrdinalIgnoreCase)).Key,
                    Condition = condition.Value, Reverse = row.Reverse
                };
                groups[key] = group;
            }
            // Prix moyen pondéré si la même carte est en vente plusieurs fois (commentaires différents…).
            group.Price = (group.Price * group.Amount + row.Price * row.Amount) / (group.Amount + row.Amount);
            group.Amount += row.Amount;
        }
        foreach (var g in groups.Values) g.Price = Math.Round(g.Price, 2);

        // Cartes du catalogue : par id produit Cardmarket, sinon par code de série + numéro.
        var productIds = groups.Values.Select(g => (long?)g.IdProduct).Distinct().ToList();
        var setCodes = groups.Values.Where(g => g.SetCode is not null).Select(g => g.SetCode!).Distinct().ToList();
        var catalog = await db.CatalogCards
            .Where(c => productIds.Contains(c.CardmarketId) || (c.SetCode != null && setCodes.Contains(c.SetCode)))
            .ToListAsync();
        foreach (var g in groups.Values.Where(g => g.LanguageCode is not null))
        {
            g.Card = catalog.FirstOrDefault(c => c.CardmarketId == g.IdProduct && c.Language == g.LanguageCode)
                     ?? (g.SetCode is null || g.Number is null ? null
                         // Une autre version du même numéro (ex. promo « V2 ») a un autre id produit : ce n'est pas la même carte.
                         : catalog.FirstOrDefault(c => c.Language == g.LanguageCode && c.SetCode == g.SetCode
                                                       && (c.CardmarketId == null || c.CardmarketId == g.IdProduct)
                                                       && CatalogService.SameNumber(c.Number, g.Number!)));
        }

        // Stock de l'appli : cartes à l'unité encore en stock.
        var items = await db.InventoryItems
            .Where(i => i.Type == ItemType.RawCard && i.RemainingQuantity > 0)
            .ToListAsync();
        var linkedIds = items.Where(i => i.CatalogCardId.HasValue).Select(i => i.CatalogCardId!.Value).Distinct().ToList();
        var itemCards = linkedIds.Count == 0 ? new Dictionary<int, CatalogCard>()
            : await db.CatalogCards.AsNoTracking().Where(c => linkedIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id);

        var assigned = new HashSet<int>();
        // D'abord les correspondances sûres (carte du catalogue liée), puis par nom pour les cartes saisies sans lien.
        foreach (var g in groups.Values.Where(g => g.Card is not null))
            foreach (var item in items.Where(i => i.CatalogCardId == g.Card!.Id && IsReverse(i.Name) == g.Reverse && i.Condition == g.Condition))
                if (assigned.Add(item.Id)) g.Lots.Add(item);
        foreach (var g in groups.Values)
        {
            var expected = Normalize(BaseName(ItemName(g)));
            var plain = Normalize(g.Card?.Name ?? g.Name);
            foreach (var item in items.Where(i => i.CatalogCardId is null && i.Condition == g.Condition && IsReverse(i.Name) == g.Reverse
                                                  && (string.IsNullOrEmpty(i.Language) || string.Equals(i.Language, g.LanguageLabel, StringComparison.OrdinalIgnoreCase))))
            {
                var name = Normalize(BaseName(item.Name));
                if ((name == expected || (name == plain && g.SetCode is not null && item.Category?.StartsWith(g.SetCode + " ", StringComparison.OrdinalIgnoreCase) == true))
                    && assigned.Add(item.Id))
                    g.Lots.Add(item);
            }
        }

        // Cartes de l'appli absentes de l'export (si le fichier ne couvre que certaines séries : celles-là seulement).
        var extras = items.Where(i => !assigned.Contains(i.Id) && (request.FullStock || InFileSets(i, itemCards, setCodes))).ToList();
        return new Analysis(groups.Values.OrderBy(g => g.SetCode).ThenBy(g => g.Number, StringComparer.Ordinal).ToList(), extras, ignored, itemCards);
    }

    private static List<CardmarketExtraDto> Extras(Analysis analysis)
    {
        var absent = analysis.Extras
            .GroupBy(i => $"{Normalize(i.Name)}|{i.Condition}")
            .Select(g => new CardmarketExtraDto(g.First().Name, g.First().Category, g.First().Condition, g.Sum(i => i.RemainingQuantity), 0, g.First().Id));
        var fewer = analysis.Groups.Where(g => g.AppQuantity > g.Amount)
            .Select(g => new CardmarketExtraDto(g.Lots[0].Name, g.Lots[0].Category, g.Condition, g.AppQuantity, g.Amount, g.Lots[0].Id));
        return absent.Concat(fewer).OrderBy(e => e.Category).ThenBy(e => e.Name).ToList();
    }

    /// <summary>Lots de bulk utilisables : encore en stock et rattachés à une ligne d'achat.</summary>
    private Task<List<InventoryItem>> BulkLotsAsync() =>
        db.InventoryItems
            .Include(i => i.PurchaseItem)
            .Where(i => i.Type == ItemType.Bulk && i.RemainingQuantity > 0 && i.PurchaseItem != null)
            .OrderBy(i => i.PurchaseDate).ThenBy(i => i.Id)
            .ToListAsync();

    private async Task<int> CreateMissingCatalogCardsAsync(List<Group> groups)
    {
        var missing = groups.Where(g => g.Card is null && g.LanguageCode is not null && g.SetCode is not null && g.Number is not null).ToList();
        if (missing.Count == 0) return 0;

        var codes = missing.Select(g => g.SetCode!).Distinct().ToList();
        var sets = await db.CatalogCards.AsNoTracking()
            .Where(c => c.SetCode != null && codes.Contains(c.SetCode))
            .ToListAsync();
        var created = new Dictionary<string, CatalogCard>();
        foreach (var g in missing)
        {
            // Série déjà au catalogue (dans cette langue) : la carte la rejoint ; sinon série « manuelle ».
            var model = sets.FirstOrDefault(c => c.Language == g.LanguageCode && c.SetCode == g.SetCode);
            var setId = model?.SetId ?? Truncate($"manuel-{g.SetCode}", 30);
            var cacheKey = $"{g.LanguageCode}|{setId}|{g.Number}";
            if (!created.TryGetValue(cacheKey, out var card))
            {
                card = new CatalogCard
                {
                    Language = g.LanguageCode!,
                    TcgdexId = $"manuel-{Guid.NewGuid():N}",
                    SetId = setId,
                    SetCode = g.SetCode,
                    SetName = model?.SetName ?? Truncate(g.Expansion ?? g.SetCode!, 150),
                    SerieName = model?.SerieName,
                    ReleaseDate = model?.ReleaseDate ?? DateTime.Today,
                    Number = Truncate(g.Number!, 20),
                    SortOrder = int.TryParse(DigitsRegex().Match(g.Number!).Value, out var n) ? Math.Max(0, n - 1) : 0,
                    Name = Truncate(g.Name, 200),
                    Rarity = g.Rarity is null ? null : Truncate(g.Rarity, 60),
                    CardmarketId = g.IdProduct,
                    IsManual = true
                };
                db.CatalogCards.Add(card);
                created[cacheKey] = card;
            }
            g.Card = card;
        }
        await db.SaveChangesAsync();  // les nouvelles cartes ont besoin d'un id pour être liées aux articles
        return created.Count;
    }

    /// <summary>Répartition au prorata (plus grands restes) ; la somme vaut exactement <paramref name="quantity"/>.</summary>
    private static int[] Proportional(List<int> available, int quantity)
    {
        var total = available.Sum();
        var shares = available.Select(a => (decimal)a * quantity / total).ToList();
        var taken = shares.Select(s => (int)Math.Floor(s)).ToArray();
        var rest = quantity - taken.Sum();
        foreach (var i in Enumerable.Range(0, available.Count).OrderByDescending(i => shares[i] - taken[i]).ThenBy(i => i))
        {
            if (rest <= 0) break;
            if (taken[i] < available[i]) { taken[i]++; rest--; }
        }
        return taken;
    }

    private static bool InFileSets(InventoryItem item, Dictionary<int, CatalogCard> cards, List<string> setCodes)
    {
        var code = item.CatalogCardId is int id && cards.TryGetValue(id, out var card) ? card.SetCode : null;
        if (code is not null) return setCodes.Contains(code, StringComparer.OrdinalIgnoreCase);
        return setCodes.Any(c => item.Category?.StartsWith(c + " ", StringComparison.OrdinalIgnoreCase) == true);
    }

    /// <summary>Nom de l'article : « Aspicot — MEW 013 », « Aspicot Reverse — MEW 013 » (même forme que l'estimation).</summary>
    private static string ItemName(Group g)
    {
        var name = (g.Card?.Name ?? g.Name) + (g.Reverse ? " Reverse" : "");
        var code = g.Card is not null ? $"{g.Card.SetCode ?? g.Card.SetId} {g.Card.Number}"
            : g.SetCode is not null ? $"{g.SetCode} {g.Number}".Trim() : null;
        return Truncate(code is null ? name : $"{name} — {code}", 200);
    }

    /// <summary>« Abra (MEW 063) » -> « Abra » (le code est repris à part).</summary>
    private static string CleanName(string name, string? setCode, string? number)
    {
        var trimmed = name.Trim();
        var m = TrailingParenthesisRegex().Match(trimmed);
        if (m.Success && ((setCode is not null && m.Value.Contains(setCode, StringComparison.OrdinalIgnoreCase))
                          || (number is not null && m.Value.Contains(number))))
            trimmed = trimmed[..m.Index].Trim();
        return trimmed.Length == 0 ? name.Trim() : trimmed;
    }

    private static bool IsReverse(string name) => ReverseRegex().IsMatch(name);

    /// <summary>Nom sans la mention « reverse » (pour comparer les versions normale et reverse d'une carte).</summary>
    private static string BaseName(string name) => ReverseRegex().Replace(name, " ");

    private static ItemCondition? ConditionOf(string? cardmarket) => cardmarket?.Trim().ToUpperInvariant() switch
    {
        "MT" or "NM" => ItemCondition.NM,
        "EX" => ItemCondition.EXC,
        "GD" => ItemCondition.GOOD,
        "LP" => ItemCondition.LP,
        "PL" => ItemCondition.PL,
        "PO" => ItemCondition.PO,
        _ => null
    };

    /// <summary>Texte comparable : sans accents, en minuscules, espaces normalisés.</summary>
    private static string Normalize(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormD);
        var plain = new string(decomposed.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray());
        return string.Join(' ', plain.ToLowerInvariant().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    [GeneratedRegex(@"\s*\([^()]*\)\s*$")]
    private static partial Regex TrailingParenthesisRegex();

    [GeneratedRegex(@"\breverse\b", RegexOptions.IgnoreCase)]
    private static partial Regex ReverseRegex();

    [GeneratedRegex(@"\d+")]
    private static partial Regex DigitsRegex();
}
