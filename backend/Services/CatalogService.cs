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

    /// <summary>
    /// Raretés ignorées à l'import « cartes rares » : communes, peu communes, rares, holos
    /// et ex / V / VMAX / VSTAR classiques (les versions Full Art, alternatives et gold sont gardées).
    /// </summary>
    public static readonly HashSet<string> CommonRarities = new(StringComparer.OrdinalIgnoreCase)
    {
        "Commune", "Peu Commune", "Rare", "Rare Holo", "Holo Rare", "Sans Rareté",
        "Double rare", "Holo Rare V", "Holo Rare VMAX", "Holo Rare VSTAR",
        // Libellés anglais, pour les séries sans fiche française.
        "Common", "Uncommon", "None", "Rare Holo V", "Rare Holo VMAX", "Rare Holo VSTAR"
    };

    private const int MaxParallelRequests = 8;

    // ---------------------------------------------------------------- Séries

    /// <summary>Séries disponibles chez TCGdex (hors jeu mobile TCG Pocket), de la plus récente à la plus ancienne.</summary>
    public async Task<List<AvailableSetDto>> GetAvailableSetsAsync(CancellationToken ct)
    {
        if (!cache.TryGetValue("catalog:available-sets", out List<(string Id, string Name, string Serie)>? sets) || sets is null)
        {
            var series = await GetJsonAsync("fr/series", ct) ?? throw new BusinessException("TCGdex ne répond pas.");
            var serieIds = series.EnumerateArray()
                .Select(s => (Id: Str(s, "id")!, Name: Str(s, "name") ?? ""))
                .Where(s => s.Id != "tcgp")
                .ToList();

            var details = new (string Id, string Name, string Serie)[serieIds.Count][];
            await Parallel.ForEachAsync(Enumerable.Range(0, serieIds.Count),
                new ParallelOptions { MaxDegreeOfParallelism = MaxParallelRequests, CancellationToken = ct }, async (i, token) =>
                {
                    var serie = await GetJsonAsync($"fr/series/{Uri.EscapeDataString(serieIds[i].Id)}", token);
                    details[i] = serie is { } s && s.TryGetProperty("sets", out var list)
                        ? list.EnumerateArray().Select(x => (Str(x, "id")!, Str(x, "name") ?? "", serieIds[i].Name)).ToArray()
                        : [];
                });
            // TCGdex liste du plus ancien au plus récent : on inverse.
            sets = details.Reverse().SelectMany(d => d.Reverse()).ToList();
            cache.Set("catalog:available-sets", sets, TimeSpan.FromHours(12));
        }

        var imported = await db.CatalogCards.GroupBy(c => c.SetId)
            .Select(g => new { SetId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SetId, x => x.Count, ct);
        return sets.Select(s => new AvailableSetDto(s.Id, s.Name, s.Serie, imported.GetValueOrDefault(s.Id))).ToList();
    }

    /// <summary>Séries présentes dans le catalogue, de la plus récente à la plus ancienne.</summary>
    public async Task<List<CatalogSetDto>> GetImportedSetsAsync(CancellationToken ct)
    {
        var sets = await db.CatalogCards
            .GroupBy(c => new { c.SetId, c.SetCode, c.SetName, c.SerieName, c.ReleaseDate })
            .Select(g => new CatalogSetDto(g.Key.SetId, g.Key.SetCode, g.Key.SetName, g.Key.SerieName, g.Key.ReleaseDate,
                g.Count(), g.Count(c => c.Quote != null)))
            .ToListAsync(ct);
        return sets.OrderByDescending(s => s.ReleaseDate).ThenBy(s => s.SetName).ToList();
    }

    /// <summary>
    /// Importe (ou met à jour) les cartes d'une série. Les cotes déjà saisies sont conservées.
    /// Avec <paramref name="rareOnly"/>, les raretés de <see cref="CommonRarities"/> sont ignorées.
    /// </summary>
    public async Task<CatalogImportResultDto> ImportSetAsync(string setId, bool rareOnly, CancellationToken ct)
    {
        var fr = await GetJsonAsync($"fr/sets/{Uri.EscapeDataString(setId)}", ct);
        var en = await GetJsonAsync($"en/sets/{Uri.EscapeDataString(setId)}", ct);
        var set = fr ?? en ?? throw BusinessException.NotFound($"Série « {setId} » introuvable chez TCGdex.");
        var lang = fr is not null ? "fr" : "en";

        var setName = Str(set, "name") ?? setId;
        var serieName = set.TryGetProperty("serie", out var serie) ? Str(serie, "name") : null;
        var code = Abbreviation(en) ?? Abbreviation(fr);
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

        var existing = await db.CatalogCards.Where(c => c.SetId == setId).ToDictionaryAsync(c => c.TcgdexId, ct);
        int added = 0, updated = 0;
        for (var i = 0; i < cards.Count; i++)
        {
            var brief = cards[i];
            var detail = details[i];
            var tcgdexId = Str(brief, "id");
            if (tcgdexId is null) continue;

            var rarity = detail is { } dt ? Str(dt, "rarity") : null;
            if (rareOnly && rarity is not null && CommonRarities.Contains(rarity)) continue;

            var number = Str(brief, "localId") ?? "";
            if (!existing.TryGetValue(tcgdexId, out var card))
            {
                card = new CatalogCard { TcgdexId = tcgdexId, SetId = setId };
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
        return new CatalogImportResultDto(setId, setName, added, updated, added + updated);
    }

    // ---------------------------------------------------------------- Cartes

    /// <summary>
    /// Recherche dans le catalogue : par série, par nom, ou par code + numéro (« PFL 95 », « PFL095 »).
    /// </summary>
    public async Task<List<CatalogCardDto>> SearchAsync(string? setId, string? search, bool quotedOnly, int take, CancellationToken ct)
    {
        var query = db.CatalogCards.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(setId)) query = query.Where(c => c.SetId == setId);
        if (quotedOnly) query = query.Where(c => c.Quote != null);

        string? wantedNumber = null;
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            var m = Regex.Match(s, @"^([A-Za-z][A-Za-z0-9:.]*?)[\s\-]*([A-Za-z]{0,2}\d+)$");
            var code = m.Success ? m.Groups[1].Value.ToUpperInvariant() : null;
            if (code is not null && await db.CatalogCards.AnyAsync(c => c.SetCode == code || c.SetId == code.ToLower(), ct))
            {
                // Code de série + numéro : la comparaison du numéro (095 = 95) se fait ensuite en mémoire.
                query = query.Where(c => c.SetCode == code || c.SetId == code.ToLower());
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
            c.Id, c.TcgdexId, c.SetId, c.SetCode, c.SetName, c.SerieName, c.Number, c.Name, c.Rarity, c.ImageUrl,
            c.CardmarketId is null ? null
                : $"https://www.cardmarket.com/fr/Pokemon/Products?idProduct={c.CardmarketId}&language=2&minCondition=2",
            c.Quote, c.QuoteUpdatedAt, stock.GetValueOrDefault(c.Id))).ToList();
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
