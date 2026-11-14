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
/// cartes et images ajoutées à la main quand TCGdex n'est pas à jour,
/// cotes saisies à la main et report de la cote sur la valeur de marché des articles liés.
/// </summary>
public class CatalogService(HttpClient http, AppDbContext db, IMemoryCache cache, ILogger<CatalogService> logger,
    AttachmentService attachments)
{
    public const string ApiBaseUrl = "https://api.tcgdex.net/v2/";

    /// <summary>Langues gérées : code TCGdex -> identifiant de la langue sur Cardmarket (filtre des offres).</summary>
    private static readonly IReadOnlyDictionary<string, int> Languages = new Dictionary<string, int>
    {
        ["fr"] = 2,      // français
        ["ja"] = 7,      // japonais
        ["ko"] = 10,     // coréen
        ["zh-tw"] = 11,  // chinois traditionnel
        ["zh-cn"] = 6    // chinois simplifié
    };

    /// <summary>Catégorie d'une carte (brute ou gradée) qui n'est liée à aucune carte du catalogue.</summary>
    internal const string Uncategorized = "Hors catégorie";

    /// <summary>Langue de l'article acheté, selon la langue de la carte du catalogue.</summary>
    internal static readonly IReadOnlyDictionary<string, string> LanguageLabels = new Dictionary<string, string>
    {
        ["fr"] = "Français", ["ja"] = "Japonais", ["ko"] = "Coréen",
        ["zh-tw"] = "Chinois traditionnel", ["zh-cn"] = "Chinois simplifié"
    };

    /// <summary>Catégorie d'une carte du catalogue : « code + nom de la série », ex. « PFL Flammes Fantasmagoriques ».</summary>
    internal static string CategoryOf(CatalogCard card)
    {
        var category = $"{card.SetCode ?? card.SetId} {card.SetName}";
        return category.Length <= 100 ? category : category[..100];  // inventory_items.category : 100 caractères
    }

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
    private static RarityGroup GroupOf(string? rarity, JsonElement? card)
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

    /// <summary>
    /// Langues dont il manque des séries chez TCGdex, complétées par une autre langue qui a les mêmes séries
    /// (mêmes codes, mêmes numéros) : le coréen reprend les séries japonaises Soleil et Lune, Épée et Bouclier,
    /// Écarlate et Violet et Méga.
    /// </summary>
    private static readonly Dictionary<string, (string Language, string[] Series)> FallbackLanguages = new()
    {
        ["ko"] = ("ja", ["SM", "S", "SV", "M"])
    };

    /// <summary>
    /// Série proposée à l'import (nom déjà traduit en anglais pour les langues asiatiques).
    /// <see cref="DataLanguage"/> : langue des fiches TCGdex utilisées si elle diffère (ex. « ja » pour une série coréenne).
    /// </summary>
    private sealed record AvailableSet(string Id, string Name, string SerieId, string Serie, string? Code, string? DataLanguage = null);

    /// <summary>
    /// Séries disponibles chez TCGdex dans une langue (hors jeu mobile TCG Pocket), de la plus récente à la plus ancienne.
    /// En français, on ajoute les séries qui n'ont qu'une fiche anglaise chez TCGdex et le code officiel de chaque série (BWP, PFL…).
    /// </summary>
    public async Task<List<AvailableSetDto>> GetAvailableSetsAsync(string language, CancellationToken ct)
    {
        var lang = CheckLanguage(language);
        if (!cache.TryGetValue($"catalog:available-sets:{lang}", out List<AvailableSet>? sets) || sets is null)
        {
            sets = await LoadSeriesSetsAsync(lang, ct);
            if (FallbackLanguages.TryGetValue(lang, out var fallback))
            {
                // Ordre de la langue de repli (plus complète), en reprenant la fiche propre à la langue quand elle existe.
                var own = sets.ToDictionary(s => s.Id);
                var merged = new List<AvailableSet>();
                foreach (var f in await LoadSeriesSetsAsync(fallback.Language, ct))
                {
                    if (own.Remove(f.Id, out var mine)) merged.Add(mine);
                    else if (fallback.Series.Contains(f.SerieId)) merged.Add(f with { DataLanguage = fallback.Language });
                }
                merged.AddRange(sets.Where(s => own.ContainsKey(s.Id)));  // séries propres à la langue
                sets = merged;
            }
            if (lang == "fr")
            {
                // Séries sans fiche française (ex. Legendary Treasures) : importées avec la fiche anglaise, rangées dans le bloc français.
                var known = sets.Select(s => s.Id).ToHashSet();
                var frenchSeries = sets.GroupBy(s => s.SerieId).ToDictionary(g => g.Key, g => g.First().Serie);
                var english = await LoadSeriesSetsAsync("en", ct);
                sets.AddRange(english.Where(s => !known.Contains(s.Id))
                    .Select(s => s with { Serie = frenchSeries.GetValueOrDefault(s.SerieId, s.Serie) }));

                var all = sets;
                var codes = new string?[all.Count];
                await Parallel.ForEachAsync(Enumerable.Range(0, all.Count),
                    new ParallelOptions { MaxDegreeOfParallelism = MaxParallelRequests, CancellationToken = ct }, async (i, token) =>
                    {
                        codes[i] = Abbreviation(await GetJsonAsync($"en/sets/{Uri.EscapeDataString(all[i].Id)}", token));
                    });
                sets = all.Select((s, i) => s with { Code = codes[i] }).ToList();
            }
            cache.Set($"catalog:available-sets:{lang}", sets, TimeSpan.FromHours(12));
        }

        var imported = await db.CatalogCards.Where(c => c.Language == lang).GroupBy(c => c.SetId)
            .Select(g => new { SetId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SetId, x => x.Count, ct);
        return sets.Select(s => new AvailableSetDto(s.Id, s.Code, s.Name, s.Serie, imported.GetValueOrDefault(s.Id), s.DataLanguage))
            .ToList();
    }

    /// <summary>Séries d'une langue, bloc par bloc, de la plus récente à la plus ancienne.</summary>
    private async Task<List<AvailableSet>> LoadSeriesSetsAsync(string lang, CancellationToken ct)
    {
        var series = await GetJsonAsync($"{lang}/series", ct) ?? throw new BusinessException("TCGdex ne répond pas.");
        var serieIds = series.EnumerateArray()
            .Select(s => (Id: Str(s, "id")!, Name: Str(s, "name") ?? ""))
            .Where(s => s.Id != "tcgp")
            .ToList();
        var asian = lang is not ("fr" or "en");

        var details = new AvailableSet[serieIds.Count][];
        await Parallel.ForEachAsync(Enumerable.Range(0, serieIds.Count),
            new ParallelOptions { MaxDegreeOfParallelism = MaxParallelRequests, CancellationToken = ct }, async (i, token) =>
            {
                var (serieId, serieName) = serieIds[i];
                var serie = await GetJsonAsync($"{lang}/series/{Uri.EscapeDataString(serieId)}", token);
                details[i] = serie is { } s && s.TryGetProperty("sets", out var list)
                    ? list.EnumerateArray().Select(x =>
                    {
                        var id = Str(x, "id")!;
                        var name = Str(x, "name") ?? id;
                        return new AvailableSet(id, CatalogTranslations.SetName(lang, id, name), serieId,
                            CatalogTranslations.SerieName(lang, serieId, serieName) ?? serieName, asian ? id : null);
                    }).ToArray()
                    : [];
            });
        // TCGdex liste du plus ancien au plus récent : on inverse.
        return details.Reverse().SelectMany(d => d.Reverse()).ToList();
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
        var lang = wanted;
        // Série absente dans cette langue chez TCGdex : fiche de la langue de repli (ex. japonaise pour le coréen).
        if (local is null && FallbackLanguages.TryGetValue(wanted, out var fallback))
        {
            local = await GetJsonAsync($"{fallback.Language}/sets/{Uri.EscapeDataString(setId)}", ct);
            lang = fallback.Language;
        }
        // Fiche anglaise : code officiel (PFL...) des séries internationales, et repli si la fiche française manque.
        var en = wanted == "fr" ? await GetJsonAsync($"en/sets/{Uri.EscapeDataString(setId)}", ct) : null;
        var set = local ?? en ?? throw BusinessException.NotFound($"Série « {setId} » introuvable chez TCGdex.");
        if (local is null) lang = "en";

        // Langues asiatiques : noms anglais pour la série, le bloc et les cartes (traduits depuis la langue des fiches).
        var setName = CatalogTranslations.SetName(lang, setId, Str(set, "name") ?? setId);
        var serieName = set.TryGetProperty("serie", out var serie)
            ? CatalogTranslations.SerieName(lang, Str(serie, "id"), Str(serie, "name")) : null;
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
        // Cartes saisies à la main en attendant TCGdex (même série ou même code) : reprises par leur numéro.
        var manual = await db.CatalogCards
            .Where(c => c.Language == wanted && c.IsManual && (c.SetId == setId || (code != null && c.SetCode == code)))
            .ToListAsync(ct);
        var adopted = new List<CatalogCard>();
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
            if (existing.TryGetValue(tcgdexId, out var card)) updated++;
            else if ((card = manual.FirstOrDefault(m => SameNumber(m.Number, number))) is not null)
            {
                // La carte garde sa cote, son image ajoutée à la main et ses articles liés.
                manual.Remove(card);
                card.TcgdexId = tcgdexId;
                card.SetId = setId;
                card.IsManual = false;
                adopted.Add(card);
                updated++;
            }
            else
            {
                card = new CatalogCard { Language = wanted, TcgdexId = tcgdexId, SetId = setId };
                db.CatalogCards.Add(card);
                added++;
            }

            card.SetCode = code;
            card.SetName = setName;
            card.SerieName = serieName;
            card.ReleaseDate = releaseDate;
            card.Number = number;
            card.SortOrder = i;
            // Hors français : nom anglais ; carte sans nom lisible (dresseur, objet…) -> « Trainer 112 ».
            var kind = (detail is { } dk ? Str(dk, "category") : null) switch
            {
                "Trainer" => "Trainer", "Energy" => "Energy", "Pokemon" => "Pokémon", _ => "Card"
            };
            card.Name = CatalogTranslations.CardName(lang, Str(brief, "name") ?? (detail is { } dn ? Str(dn, "name") : null) ?? number,
                fallback: $"{kind} {number}");
            card.Rarity = rarity;
            card.ImageUrl = Str(brief, "image") ?? (detail is { } di ? Str(di, "image") : null) ?? SubsetImage(setId, number, lang);
            card.CardmarketId = detail is { } dc ? CardmarketId(dc) : null;
            card.UpdatedAt = DateTime.UtcNow;
        }

        // Cartes manuelles reprises : leurs articles prennent le nom de série TCGdex.
        if (adopted.Count > 0)
        {
            var adoptedIds = adopted.Select(c => c.Id).ToList();
            var linked = await db.InventoryItems
                .Where(i => i.CatalogCardId != null && adoptedIds.Contains(i.CatalogCardId.Value)
                            && (i.Type == ItemType.RawCard || i.Type == ItemType.GradedCard))
                .ToListAsync(ct);
            foreach (var item in linked) item.Category = CategoryOf(adopted.First(c => c.Id == item.CatalogCardId));
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

    /// <summary>
    /// Ajoute une carte à la main, quand TCGdex n'est pas encore à jour. Dans une série du catalogue, elle en reprend
    /// le nom, le code et le bloc ; sinon une série « manuelle » est créée (identifiant dérivé du code).
    /// </summary>
    public async Task<CatalogCardDto> CreateCardAsync(CatalogCardInput input, CancellationToken ct)
    {
        var lang = CheckLanguage(input.Language);
        var code = Limit(input.SetCode.TrimOrNull()?.ToUpperInvariant(), 20, "Le code de série");
        var setId = input.SetId.TrimOrNull() ?? (code is null ? $"manuel-{Guid.NewGuid():N}"[..15] : $"manuel-{code}");
        var card = new CatalogCard { Language = lang, TcgdexId = $"manuel-{Guid.NewGuid():N}", SetId = setId, IsManual = true };

        var model = await db.CatalogCards.AsNoTracking().FirstOrDefaultAsync(c => c.Language == lang && c.SetId == setId, ct);
        if (model is not null && input.SetId.TrimOrNull() is null)
            throw new BusinessException($"La série {code} existe déjà : choisissez-la dans la liste des séries.");
        if (model is not null)
        {
            card.SetCode = model.SetCode;
            card.SetName = model.SetName;
            card.SerieName = model.SerieName;
            card.ReleaseDate = model.ReleaseDate;
        }
        else
        {
            card.SetCode = code;
            card.SetName = Limit(input.SetName.TrimOrNull(), 150, "Le nom de la série")
                           ?? throw new BusinessException("Indiquez le nom de la série.");
            card.SerieName = Limit(input.SerieName.TrimOrNull(), 100, "Le bloc");
            card.ReleaseDate = DateTime.Today;  // nouvelle série : affichée en tête de liste
        }

        await ApplyCardInputAsync(card, input, ct);
        db.CatalogCards.Add(card);
        await db.SaveChangesAsync(ct);
        return (await ToDtosAsync([card], ct))[0];
    }

    /// <summary>Corrige le numéro, le nom ou la rareté d'une carte saisie à la main.</summary>
    public async Task<CatalogCardDto> UpdateCardAsync(int id, CatalogCardInput input, CancellationToken ct)
    {
        var card = await db.CatalogCards.FirstOrDefaultAsync(c => c.Id == id, ct)
                   ?? throw BusinessException.NotFound("Carte introuvable dans le catalogue.");
        if (!card.IsManual) throw new BusinessException("Seules les cartes ajoutées à la main sont modifiables.");

        await ApplyCardInputAsync(card, input, ct);
        card.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return (await ToDtosAsync([card], ct))[0];
    }

    /// <summary>Numéro, nom et rareté d'une carte manuelle ; refuse un numéro déjà présent dans la série.</summary>
    private async Task ApplyCardInputAsync(CatalogCard card, CatalogCardInput input, CancellationToken ct)
    {
        var number = Limit(input.Number.TrimOrNull(), 20, "Le numéro") ?? throw new BusinessException("Indiquez le numéro de la carte.");
        var numbers = await db.CatalogCards
            .Where(c => c.Language == card.Language && c.SetId == card.SetId && c.Id != card.Id)
            .Select(c => c.Number)
            .ToListAsync(ct);
        if (numbers.Any(n => SameNumber(n, number)))
            throw new BusinessException($"La carte n° {number} existe déjà dans cette série.");

        card.Number = number;
        card.Name = Limit(input.Name.TrimOrNull(), 200, "Le nom") ?? throw new BusinessException("Indiquez le nom de la carte.");
        card.Rarity = Limit(input.Rarity.TrimOrNull(), 60, "La rareté");
        // Ordre d'affichage proche de celui de TCGdex (position dans la série) : n° 95 -> 94.
        card.SortOrder = int.TryParse(Regex.Match(number, @"\d+").Value, out var n) ? Math.Max(0, n - 1) : 0;
    }

    private static string? Limit(string? value, int max, string label) =>
        value is { Length: var length } && length > max
            ? throw new BusinessException($"{label} ne doit pas dépasser {max} caractères.")
            : value;

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
        await attachments.DeleteForOwnerAsync(AttachmentOwner.CatalogCard, ids.ToArray());
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
        // Image ajoutée à la main : la plus récente (une image remplacée dont la suppression a échoué ne revient pas).
        var photos = await db.Attachments.AsNoTracking()
            .Where(a => a.OwnerType == AttachmentOwner.CatalogCard && a.Kind == AttachmentKind.Photo
                        && a.ContentType.StartsWith("image/") && ids.Contains(a.OwnerId))
            .GroupBy(a => a.OwnerId)
            .Select(g => new { OwnerId = g.Key, Id = g.Max(a => a.Id) })
            .ToDictionaryAsync(x => x.OwnerId, x => x.Id, ct);

        return cards.Select(c => new CatalogCardDto(
            c.Id, c.Language, c.TcgdexId, c.SetId, c.SetCode, c.SetName, c.SerieName, c.Number, c.Name, c.Rarity, c.ImageUrl,
            c.CardmarketId is null ? null
                : $"https://www.cardmarket.com/fr/Pokemon/Products?idProduct={c.CardmarketId}" +
                  $"&language={Languages.GetValueOrDefault(c.Language, 2)}&minCondition=2",
            c.Quote, c.QuoteUpdatedAt, stock.GetValueOrDefault(c.Id),
            c.IsManual, photos.TryGetValue(c.Id, out var photoId) ? photoId : null)).ToList();
    }

    private static string CheckLanguage(string? language)
    {
        var lang = (language ?? "fr").Trim().ToLowerInvariant();
        return Languages.ContainsKey(lang) ? lang
            : throw new BusinessException($"Langue inconnue : {language} (attendu : {string.Join(", ", Languages.Keys)}).");
    }

    /// <summary>« 95 », « 095 » et « TG05 » / « TG5 » sont équivalents.</summary>
    internal static bool SameNumber(string number, string wanted)
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
