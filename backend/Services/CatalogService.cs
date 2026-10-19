using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Catalogue des cartes Pokémon : import depuis l'API publique TCGdex (https://tcgdex.dev),
/// cotes saisies à la main et report de la cote sur la valeur de marché des articles liés.
/// </summary>
public class CatalogService(HttpClient http, AppDbContext db, IMemoryCache cache, ILogger<CatalogService> logger)
{
    public const string ApiBaseUrl = "https://api.tcgdex.net/v2/";

    /// <summary>Langues gérées : code TCGdex -> identifiant de la langue sur Cardmarket (filtre des offres).</summary>
    public static readonly IReadOnlyDictionary<string, int> Languages = new Dictionary<string, int>
    {
        ["fr"] = 2,      // français
        ["ja"] = 7,      // japonais
        ["ko"] = 10,     // coréen
        ["zh-tw"] = 11,  // chinois traditionnel
        ["zh-cn"] = 6    // chinois simplifié
    };

    /// <summary>Catégorie d'une carte (brute ou gradée) qui n'est liée à aucune carte du catalogue.</summary>
    public const string Uncategorized = "Hors catégorie";

    /// <summary>Langue de l'article acheté, selon la langue de la carte du catalogue.</summary>
    public static readonly IReadOnlyDictionary<string, string> LanguageLabels = new Dictionary<string, string>
    {
        ["fr"] = "Français", ["ja"] = "Japonais", ["ko"] = "Coréen",
        ["zh-tw"] = "Chinois traditionnel", ["zh-cn"] = "Chinois simplifié"
    };

    /// <summary>Catégorie d'une carte du catalogue : « code + nom de la série », ex. « PFL Flammes Fantasmagoriques ».</summary>
    public static string CategoryOf(CatalogCard card) => $"{card.SetCode ?? card.SetId} {card.SetName}";

    /// <summary>
    /// Règle des cartes (brutes ou gradées) : la catégorie et la langue viennent de la carte du catalogue liée ;
    /// sans carte liée, la catégorie est « Hors catégorie ». Une carte liée cotée donne aussi sa valeur de marché
    /// à un article qui n'en a pas encore.
    /// </summary>
    public static async Task ApplyCatalogLinksAsync(AppDbContext db, IEnumerable<InventoryItem> items)
    {
        var cards = items.Where(i => i.Type is ItemType.RawCard or ItemType.GradedCard).ToList();
        if (cards.Count == 0) return;
        var ids = cards.Where(i => i.CatalogCardId.HasValue).Select(i => i.CatalogCardId!.Value).Distinct().ToList();
        var catalog = ids.Count == 0 ? new Dictionary<int, CatalogCard>()
            : await db.CatalogCards.Where(c => ids.Contains(c.Id)).ToDictionaryAsync(c => c.Id);

        foreach (var item in cards)
        {
            if (item.CatalogCardId is int id && catalog.TryGetValue(id, out var card))
            {
                item.Category = CategoryOf(card);
                item.Language = LanguageLabels.GetValueOrDefault(card.Language, item.Language ?? "");
                if (item.MarketValue is null && card.Quote is not null) InventoryService.ApplyMarketValue(item, card.Quote);
            }
            else
            {
                item.CatalogCardId = null;  // carte supprimée du catalogue ou id inconnu
                item.Category = Uncategorized;
            }
        }
    }

    /// <summary>Groupes importés par défaut : les cartes « rares » (Full Art, alternatives, gold…) et les raretés inconnues.</summary>
    public static readonly RarityGroup[] DefaultGroups = [RarityGroup.Other, RarityGroup.Unknown];

    /// <summary>Raretés TCGdex (libellés français et anglais) rangées dans un groupe ; les autres vont dans « Other ».</summary>
    private static readonly Dictionary<string, RarityGroup> RarityGroups = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Commune"] = RarityGroup.Common, ["Common"] = RarityGroup.Common,
        ["Peu Commune"] = RarityGroup.Uncommon, ["Uncommon"] = RarityGroup.Uncommon,
        ["Rare"] = RarityGroup.Rare,
        ["Rare Holo"] = RarityGroup.Holo, ["Holo Rare"] = RarityGroup.Holo,
        ["Double rare"] = RarityGroup.ClassicEx,
        ["Holo Rare V"] = RarityGroup.ClassicEx, ["Holo Rare VMAX"] = RarityGroup.ClassicEx, ["Holo Rare VSTAR"] = RarityGroup.ClassicEx,
        ["Rare Holo V"] = RarityGroup.ClassicEx, ["Rare Holo VMAX"] = RarityGroup.ClassicEx, ["Rare Holo VSTAR"] = RarityGroup.ClassicEx,
        ["Sans Rareté"] = RarityGroup.NoRarity,
        ["None"] = RarityGroup.Unknown
    };

    /// <summary>
    /// Groupe de rareté d'une carte. TCGdex classe les holos des anciennes séries en simple « Rare »
    /// (ex. Dracaufeu du Set de Base) : une rare qui n'existe qu'en version holo est donc rangée dans « Holo ».
    /// </summary>
    public static RarityGroup GroupOf(string? rarity, JsonElement? card = null)
    {
        if (string.IsNullOrWhiteSpace(rarity)) return RarityGroup.Unknown;
        var group = RarityGroups.GetValueOrDefault(rarity, RarityGroup.Other);
        if (group == RarityGroup.Rare && card is { } c && c.TryGetProperty("variants", out var v) && v.ValueKind == JsonValueKind.Object
            && v.TryGetProperty("holo", out var holo) && holo.ValueKind == JsonValueKind.True
            && !(v.TryGetProperty("normal", out var normal) && normal.ValueKind == JsonValueKind.True))
            return RarityGroup.Holo;
        return group;
    }

    private const int MaxParallelRequests = 8;

    // ---------------------------------------------------------------- Séries

    /// <summary>Séries disponibles chez TCGdex dans une langue (hors jeu mobile TCG Pocket), de la plus récente à la plus ancienne.</summary>
    public async Task<List<AvailableSetDto>> GetAvailableSetsAsync(string language, CancellationToken ct)
    {
        var lang = CheckLanguage(language);
        if (!cache.TryGetValue($"catalog:available-sets:{lang}", out List<(string Id, string Name, string Serie)>? sets) || sets is null)
        {
            var series = await GetJsonAsync($"{lang}/series", ct) ?? throw new BusinessException("TCGdex ne répond pas.");
            var serieIds = series.EnumerateArray()
                .Select(s => (Id: Str(s, "id")!, Name: Str(s, "name") ?? ""))
                .Where(s => s.Id != "tcgp")
                .ToList();

            var details = new (string Id, string Name, string Serie)[serieIds.Count][];
            await Parallel.ForEachAsync(Enumerable.Range(0, serieIds.Count),
                new ParallelOptions { MaxDegreeOfParallelism = MaxParallelRequests, CancellationToken = ct }, async (i, token) =>
                {
                    var serie = await GetJsonAsync($"{lang}/series/{Uri.EscapeDataString(serieIds[i].Id)}", token);
                    details[i] = serie is { } s && s.TryGetProperty("sets", out var list)
                        ? list.EnumerateArray().Select(x => (Str(x, "id")!, Str(x, "name") ?? "", serieIds[i].Name)).ToArray()
                        : [];
                });
            // TCGdex liste du plus ancien au plus récent : on inverse.
            sets = details.Reverse().SelectMany(d => d.Reverse()).ToList();
            cache.Set($"catalog:available-sets:{lang}", sets, TimeSpan.FromHours(12));
        }

        var imported = await db.CatalogCards.Where(c => c.Language == lang).GroupBy(c => c.SetId)
            .Select(g => new { SetId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SetId, x => x.Count, ct);
        return sets.Select(s => new AvailableSetDto(s.Id, s.Name, s.Serie, imported.GetValueOrDefault(s.Id))).ToList();
    }

    /// <summary>Séries présentes dans le catalogue, de la plus récente à la plus ancienne.</summary>
    public async Task<List<CatalogSetDto>> GetImportedSetsAsync(CancellationToken ct)
    {
        var sets = await db.CatalogCards
            .GroupBy(c => new { c.Language, c.SetId, c.SetCode, c.SetName, c.SerieName, c.ReleaseDate })
            .Select(g => new CatalogSetDto(g.Key.Language, g.Key.SetId, g.Key.SetCode, g.Key.SetName, g.Key.SerieName, g.Key.ReleaseDate,
                g.Count(), g.Count(c => c.Quote != null)))
            .ToListAsync(ct);
        return sets.OrderByDescending(s => s.ReleaseDate).ThenBy(s => s.SetName).ToList();
    }

    /// <summary>
    /// Importe (ou met à jour) les cartes d'une série. Les cotes déjà saisies sont conservées.
    /// Seules les cartes dont la rareté appartient à <paramref name="groups"/> sont importées.
    /// </summary>
    public async Task<CatalogImportResultDto> ImportSetAsync(string setId, string language, IReadOnlyCollection<RarityGroup> groups,
        CancellationToken ct)
    {
        var wanted = CheckLanguage(language);
        var local = await GetJsonAsync($"{wanted}/sets/{Uri.EscapeDataString(setId)}", ct);
        // Fiche anglaise : code officiel (PFL...) des séries internationales, et repli si la fiche française manque.
        var en = wanted == "fr" ? await GetJsonAsync($"en/sets/{Uri.EscapeDataString(setId)}", ct) : null;
        var set = local ?? en ?? throw BusinessException.NotFound($"Série « {setId} » introuvable chez TCGdex.");
        var lang = local is not null ? wanted : "en";

        var setName = Str(set, "name") ?? setId;
        var serieName = set.TryGetProperty("serie", out var serie) ? Str(serie, "name") : null;
        var code = Abbreviation(en) ?? Abbreviation(local);
        var releaseDate = DateTime.TryParse(Str(set, "releaseDate") ?? (en is { } e ? Str(e, "releaseDate") : null),
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.Date : (DateTime?)null;

        var cards = set.TryGetProperty("cards", out var list) ? list.EnumerateArray().ToList() : [];
        // Fiche complète de chaque carte (rareté, n° Cardmarket), en parallèle.
        var details = new JsonElement?[cards.Count];
        await Parallel.ForEachAsync(Enumerable.Range(0, cards.Count),
            new ParallelOptions { MaxDegreeOfParallelism = MaxParallelRequests, CancellationToken = ct }, async (i, token) =>
            {
                details[i] = await GetJsonAsync($"{lang}/cards/{Uri.EscapeDataString(Str(cards[i], "id") ?? "")}", token);
            });

        var existing = await db.CatalogCards.Where(c => c.Language == wanted && c.SetId == setId)
            .ToDictionaryAsync(c => c.TcgdexId, ct);
        int added = 0, updated = 0, skipped = 0;
        for (var i = 0; i < cards.Count; i++)
        {
            var brief = cards[i];
            var detail = details[i];
            var tcgdexId = Str(brief, "id");
            if (tcgdexId is null) continue;

            var rarity = detail is { } dt ? Str(dt, "rarity") : null;
            if (!groups.Contains(GroupOf(rarity, detail))) { skipped++; continue; }
            if (rarity == "None") rarity = null;  // rareté non renseignée (fréquent en japonais)

            var number = Str(brief, "localId") ?? "";
            if (!existing.TryGetValue(tcgdexId, out var card))
            {
                card = new CatalogCard { Language = wanted, TcgdexId = tcgdexId, SetId = setId };
                db.CatalogCards.Add(card);
                added++;
            }
            else updated++;

            card.SetCode = code;
            card.SetName = setName;
            card.SerieName = serieName;
            card.ReleaseDate = releaseDate;
            card.Number = number;
            card.SortOrder = i;
            card.Name = Str(brief, "name") ?? (detail is { } dn ? Str(dn, "name") : null) ?? number;
            card.Rarity = rarity;
            card.ImageUrl = Str(brief, "image") ?? (detail is { } di ? Str(di, "image") : null) ?? SubsetImage(setId, number, lang);
            card.CardmarketId = detail is { } dc ? CardmarketId(dc) : null;
            card.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        return new CatalogImportResultDto(setId, setName, added, updated, added + updated, skipped);
    }

    // ---------------------------------------------------------------- Cartes

    /// <summary>
    /// Recherche dans le catalogue : par série, par nom, ou par code + numéro (« PFL 95 », « PFL095 »).
    /// </summary>
    public async Task<List<CatalogCardDto>> SearchAsync(string? language, string? setId, string? search, bool quotedOnly, int take,
        CancellationToken ct)
    {
        var query = db.CatalogCards.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(language)) { var lang = CheckLanguage(language); query = query.Where(c => c.Language == lang); }
        if (!string.IsNullOrWhiteSpace(setId)) query = query.Where(c => c.SetId == setId);
        if (quotedOnly) query = query.Where(c => c.Quote != null);

        string? wantedNumber = null;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            var m = Regex.Match(s, @"^([A-Za-z][A-Za-z0-9:.]*?)[\s\-]*([A-Za-z]{0,2}\d+)$");
            var code = m.Success ? m.Groups[1].Value.ToUpperInvariant() : null;
            // Comparaisons insensibles à la casse (collation MySQL) : « me02 » = « ME02 », « sv8a » = « SV8a ».
            if (code is not null && await db.CatalogCards.AnyAsync(c => c.SetCode == code || c.SetId == code, ct))
            {
                // Code de série + numéro : la comparaison du numéro (095 = 95) se fait ensuite en mémoire.
                query = query.Where(c => c.SetCode == code || c.SetId == code);
                wantedNumber = m.Groups[2].Value;
            }
            else
            {
                query = query.Where(c => c.Name.Contains(s) || c.Number == s);
            }
        }

        var cards = await query.OrderByDescending(c => c.ReleaseDate).ThenBy(c => c.SetId).ThenBy(c => c.SortOrder)
            .Take(wantedNumber is null ? Math.Clamp(take, 1, 1000) : 2000)
            .ToListAsync(ct);
        if (wantedNumber is not null)
            cards = cards.Where(c => SameNumber(c.Number, wantedNumber)).ToList();

        return await ToDtosAsync(cards, ct);
    }

    /// <summary>
    /// Enregistre la cote d'une carte et la reporte sur la valeur de marché des articles en stock liés.
    /// </summary>
    public async Task<CatalogCardDto> SetQuoteAsync(int id, decimal? quote, CancellationToken ct)
    {
        if (quote < 0) throw new BusinessException("La cote ne peut pas être négative.");
        var card = await db.CatalogCards.FirstOrDefaultAsync(c => c.Id == id, ct)
                   ?? throw BusinessException.NotFound("Carte introuvable dans le catalogue.");

        var rounded = quote is null ? (decimal?)null : Math.Round(quote.Value, 2);
        card.Quote = rounded;
        card.QuoteUpdatedAt = rounded.HasValue ? DateTime.UtcNow : null;
        card.UpdatedAt = DateTime.UtcNow;

        if (rounded.HasValue)
        {
            var linked = await db.InventoryItems.Where(i => i.CatalogCardId == id && i.RemainingQuantity > 0).ToListAsync(ct);
            foreach (var item in linked) InventoryService.ApplyMarketValue(item, rounded);
        }

        await db.SaveChangesAsync(ct);
        return (await ToDtosAsync([card], ct))[0];
    }

    /// <summary>Supprime une carte du catalogue.</summary>
    public Task<CatalogDeleteResultDto> DeleteCardAsync(int id, CancellationToken ct) =>
        DeleteAsync(db.CatalogCards.Where(c => c.Id == id), ct);

    /// <summary>Supprime toutes les cartes d'une série (dans une langue).</summary>
    public Task<CatalogDeleteResultDto> DeleteSetAsync(string setId, string language, CancellationToken ct)
    {
        var lang = CheckLanguage(language);
        return DeleteAsync(db.CatalogCards.Where(c => c.Language == lang && c.SetId == setId), ct);
    }

    /// <summary>
    /// Supprime des cartes du catalogue. Les articles d'inventaire liés ne sont pas supprimés : ils sont déliés
    /// et passent en « Hors catégorie » (ils gardent leur valeur de marché).
    /// </summary>
    private async Task<CatalogDeleteResultDto> DeleteAsync(IQueryable<CatalogCard> query, CancellationToken ct)
    {
        var cards = await query.ToListAsync(ct);
        if (cards.Count == 0) throw BusinessException.NotFound("Carte introuvable dans le catalogue.");

        var ids = cards.Select(c => c.Id).ToList();
        var linked = await db.InventoryItems.Where(i => i.CatalogCardId != null && ids.Contains(i.CatalogCardId.Value))
            .ToListAsync(ct);
        foreach (var item in linked)
        {
            item.CatalogCardId = null;
            if (item.Type is ItemType.RawCard or ItemType.GradedCard) item.Category = Uncategorized;
        }

        db.CatalogCards.RemoveRange(cards);
        await db.SaveChangesAsync(ct);
        return new CatalogDeleteResultDto(cards.Count, linked.Count);
    }

    // ---------------------------------------------------------------- Outils

    private async Task<List<CatalogCardDto>> ToDtosAsync(List<CatalogCard> cards, CancellationToken ct)
    {
        var ids = cards.Select(c => c.Id).ToList();
        var stock = await db.InventoryItems
            .Where(i => i.CatalogCardId != null && ids.Contains(i.CatalogCardId.Value) && i.RemainingQuantity > 0)
            .GroupBy(i => i.CatalogCardId!.Value)
            .Select(g => new { Id = g.Key, Count = g.Sum(i => i.RemainingQuantity) })
            .ToDictionaryAsync(x => x.Id, x => x.Count, ct);

        return cards.Select(c => new CatalogCardDto(
            c.Id, c.Language, c.TcgdexId, c.SetId, c.SetCode, c.SetName, c.SerieName, c.Number, c.Name, c.Rarity, c.ImageUrl,
            c.CardmarketId is null ? null
                : $"https://www.cardmarket.com/fr/Pokemon/Products?idProduct={c.CardmarketId}" +
                  $"&language={Languages.GetValueOrDefault(c.Language, 2)}&minCondition=2",
            c.Quote, c.QuoteUpdatedAt, stock.GetValueOrDefault(c.Id))).ToList();
    }

    private static string CheckLanguage(string? language)
    {
        var lang = (language ?? "fr").Trim().ToLowerInvariant();
        return Languages.ContainsKey(lang) ? lang
            : throw new BusinessException($"Langue inconnue : {language} (attendu : {string.Join(", ", Languages.Keys)}).");
    }

    /// <summary>« 95 », « 095 » et « TG05 » / « TG5 » sont équivalents.</summary>
    private static bool SameNumber(string number, string wanted)
    {
        static string Normalize(string n)
        {
            var m = Regex.Match(n.ToUpperInvariant(), @"^([A-Z]*)0*(\d+)$");
            return m.Success ? m.Groups[1].Value + m.Groups[2].Value : n.ToUpperInvariant();
        }
        return Normalize(number) == Normalize(wanted);
    }

    /// <summary>
    /// Les galeries (swsh9tg, swsh12.5gg…) et le coffre étincelant (swsh4.5sv) n'ont pas d'image dans leur fiche :
    /// leurs visuels sont rangés sous la série principale (swsh9/TG01).
    /// </summary>
    private static string? SubsetImage(string setId, string number, string lang)
    {
        var parent = Regex.Replace(setId, "(tg|gg|sv)$", "");
        if (parent == setId || number.Length == 0) return null;
        var serie = Regex.Match(parent, "^[a-z]+").Value;
        return $"https://assets.tcgdex.net/{lang}/{serie}/{parent}/{number}";
    }

    private static string? Abbreviation(JsonElement? set) =>
        set is { } s && s.TryGetProperty("abbreviation", out var a) ? Str(a, "official") : null;

    private static long? CardmarketId(JsonElement card)
    {
        if (card.TryGetProperty("pricing", out var p) && p.ValueKind == JsonValueKind.Object
            && p.TryGetProperty("cardmarket", out var cm) && cm.ValueKind == JsonValueKind.Object
            && cm.TryGetProperty("idProduct", out var id) && id.ValueKind == JsonValueKind.Number)
            return id.GetInt64();
        if (card.TryGetProperty("variants_detailed", out var variants) && variants.ValueKind == JsonValueKind.Array)
            foreach (var v in variants.EnumerateArray())
                if (v.TryGetProperty("thirdParty", out var tp) && tp.ValueKind == JsonValueKind.Object
                    && tp.TryGetProperty("cardmarket", out var cmId) && cmId.ValueKind == JsonValueKind.Number)
                    return cmId.GetInt64();
        return null;
    }

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;

    /// <summary>GET JSON sur TCGdex ; null si 404. Patiente et réessaie si TCGdex limite le débit (429/503).</summary>
    private async Task<JsonElement?> GetJsonAsync(string path, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var response = await http.GetAsync(path, ct);
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
                if ((int)response.StatusCode is 429 or 503 && attempt < 6)
                {
                    await Task.Delay(TimeSpan.FromSeconds(2 * attempt), ct);
                    continue;
                }
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                return doc.RootElement.Clone();
            }
            catch (HttpRequestException ex)
            {
                logger.LogWarning(ex, "Appel TCGdex en échec : {Path}", path);
                throw new BusinessException("Le service TCGdex ne répond pas. Réessayez dans un instant.",
                    StatusCodes.Status502BadGateway);
            }
        }
    }
}
