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

/// <summary>Préférences : informations de l'entreprise (factures) et seuils d'alerte.</summary>
public class PreferencesService(SettingsStore store)
{
    private const string Key = "app.preferences";

    public async Task<AppPreferences> GetAsync() => await store.ReadAsync<AppPreferences>(Key) ?? new AppPreferences();

    public async Task<AppPreferences> SaveAsync(AppPreferences prefs)
    {
        prefs.Company ??= new CompanyInfo();
        prefs.Alerts ??= new AlertSettings();
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
