using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>Lecture / écriture de paramètres JSON dans la table app_settings.</summary>
public class SettingsStore(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    public async Task<T?> ReadAsync<T>(string key)
    {
        var row = await db.AppSettings.AsNoTracking().FirstOrDefaultAsync(x => x.SettingKey == key);
        return row is null ? default : JsonSerializer.Deserialize<T>(row.Value, Json);
    }

    public async Task WriteAsync<T>(string key, T value)
    {
        var row = await db.AppSettings.FirstOrDefaultAsync(x => x.SettingKey == key);
        if (row is null)
        {
            row = new AppSetting { SettingKey = key };
            db.AppSettings.Add(row);
        }
        row.Value = JsonSerializer.Serialize(value, Json);
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }
}

/// <summary>Réglages du bulk (poids d'une carte, catégories et prix conseillés).</summary>
public class BulkSettingsService(SettingsStore store)
{
    private const string Key = "bulk.settings";

    public async Task<BulkSettings> GetAsync() => await store.ReadAsync<BulkSettings>(Key) ?? new BulkSettings();

    public async Task<BulkSettings> SaveAsync(BulkSettings settings)
    {
        if (settings.GramsPerCard is < 0.5m or > 10m)
            throw new BusinessException("Le poids d'une carte doit être compris entre 0,5 et 10 g.");
        var categories = (settings.Categories ?? new List<BulkCategory>())
            .Where(c => !string.IsNullOrWhiteSpace(c.Name))
            .Select(c => new BulkCategory { Name = c.Name.Trim(), SuggestedPricePerCard = Math.Round(c.SuggestedPricePerCard, 4) })
            .ToList();
        if (categories.Count == 0)
            throw new BusinessException("Gardez au moins une catégorie de bulk.");
        if (categories.Any(c => c.SuggestedPricePerCard < 0))
            throw new BusinessException("Le prix conseillé ne peut pas être négatif.");
        if (categories.GroupBy(c => c.Name.ToLowerInvariant()).Any(g => g.Count() > 1))
            throw new BusinessException("Deux catégories de bulk portent le même nom.");

        settings.Categories = categories;
        settings.GramsPerCard = Math.Round(settings.GramsPerCard, 2);
        await store.WriteAsync(Key, settings);
        return settings;
    }
}

/// <summary>Préférences : informations de l'entreprise (factures) et seuils d'alerte.</summary>
public class PreferencesService(SettingsStore store)
{
    private const string Key = "app.preferences";

    public async Task<AppPreferences> GetAsync() => await store.ReadAsync<AppPreferences>(Key) ?? new AppPreferences();

    public async Task<AppPreferences> SaveAsync(AppPreferences prefs)
    {
        prefs.Company ??= new CompanyInfo();
        prefs.Alerts ??= new AlertSettings();
        prefs.CardSeries ??= [];
        prefs.CardSeries = prefs.CardSeries
            .Where(x => !string.IsNullOrWhiteSpace(x.Language) && !string.IsNullOrWhiteSpace(x.Series))
            .Select(x => new CardSeriesEntry { Language = x.Language.Trim(), Series = x.Series.Trim() })
            .DistinctBy(x => (x.Language, x.Series))
            .OrderBy(x => x.Language).ThenBy(x => x.Series).ToList();
        var a = prefs.Alerts;
        if (a.DormantWarningDays < 1 || a.DormantCriticalDays < a.DormantWarningDays)
            throw new BusinessException("Le seuil « à liquider » doit être supérieur ou égal au seuil « à baisser » (en jours).");
        if (a.MarketGainThreshold < 0 || a.MarketRiseThreshold < 0)
            throw new BusinessException("Les seuils d'alerte de valeur ne peuvent pas être négatifs.");
        if (!string.IsNullOrWhiteSpace(prefs.Company.Siret))
        {
            var digits = new string(prefs.Company.Siret.Where(char.IsDigit).ToArray());
            if (digits.Length != 14) throw new BusinessException("Le SIRET doit comporter 14 chiffres.");
            prefs.Company.Siret = digits;
        }
        await store.WriteAsync(Key, prefs);
        return prefs;
    }
}
