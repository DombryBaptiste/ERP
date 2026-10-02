using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Alertes : articles dont la valeur de marché a fortement augmenté, et stock qui dort.
/// </summary>
public class AlertService(AppDbContext db, PreferencesService preferences, AttachmentService attachments)
{
    public async Task<AlertsDto> GetAsync()
    {
        var settings = (await preferences.GetAsync()).Alerts;
        var items = await db.InventoryItems.AsNoTracking()
            .Include(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase)
            .Where(i => i.RemainingQuantity > 0)
            .ToListAsync();
        var photos = await attachments.FirstPhotoIdsAsync(items.Select(i => i.Id));
        var dtos = items.ToDictionary(i => i.Id, i => i.ToDto(photos.TryGetValue(i.Id, out var p) ? p : null));

        // --- Valeur de marché ---
        var marketAlerts = new List<MarketAlertDto>();
        foreach (var item in items.Where(i => i.MarketValue.HasValue))
        {
            var market = item.MarketValue!.Value;
            decimal? gain = item.PurchasePrice > 0 ? Math.Round((market - item.PurchasePrice) / item.PurchasePrice * 100, 1) : null;
            decimal? rise = item.PreviousMarketValue is > 0m
                ? Math.Round((market - item.PreviousMarketValue.Value) / item.PreviousMarketValue.Value * 100, 1)
                : null;
            var latent = item.RemainingQuantity * (market - item.PurchasePrice);

            // Article sans coût (ex. collection) : toute valeur positive est une plus-value.
            var gainAlert = gain >= settings.MarketGainThreshold || (item.PurchasePrice == 0 && market > 0);
            var riseAlert = rise >= settings.MarketRiseThreshold;
            if (gainAlert || riseAlert)
                marketAlerts.Add(new MarketAlertDto(dtos[item.Id], gain, rise, latent, riseAlert ? "rise" : "gain"));
        }

        // --- Stock dormant ---
        var dormant = items
            .Select(i => (Item: i, Days: dtos[i.Id].DaysInStock))
            .Where(x => x.Days >= settings.DormantWarningDays)
            .Select(x =>
            {
                var critical = x.Days >= settings.DormantCriticalDays;
                return new DormantItemDto(dtos[x.Item.Id], x.Days, critical ? "critical" : "warning",
                    Suggest(x.Item, critical));
            })
            .OrderByDescending(d => d.DaysInStock)
            .ToList();

        return new AlertsDto(
            settings,
            StockCost: items.Sum(i => i.RemainingQuantity * i.PurchasePrice),
            StockMarketValue: items.Sum(i => i.RemainingQuantity * (i.MarketValue ?? i.PurchasePrice)),
            LatentGain: items.Where(i => i.MarketValue.HasValue).Sum(i => i.RemainingQuantity * (i.MarketValue!.Value - i.PurchasePrice)),
            ItemsWithMarketValue: items.Count(i => i.MarketValue.HasValue),
            ItemsWithoutMarketValue: items.Count(i => !i.MarketValue.HasValue),
            MarketAlerts: marketAlerts.OrderByDescending(a => a.RisePercent ?? 0).ThenByDescending(a => a.LatentGain).ToList(),
            Dormant: dormant);
    }

    /// <summary>Conseil de prix pour un article qui ne se vend pas.</summary>
    private static string Suggest(InventoryItem item, bool critical)
    {
        var reference = item.MarketValue ?? item.PurchasePrice;
        if (critical)
        {
            return item.PurchasePrice > 0
                ? $"À liquider : proposez-le autour de {item.PurchasePrice:0.00} € (prix coûtant) ou dans un lot."
                : "À liquider : intégrez-le à un lot ou faites une offre groupée.";
        }
        return reference > 0
            ? $"À baisser : essayez environ {Math.Round(reference * 0.85m, 2):0.00} € (-15 %) ou une meilleure annonce (photos, titre)."
            : "À baisser : revoyez le prix ou l'annonce (photos, titre, plateforme).";
    }
}
