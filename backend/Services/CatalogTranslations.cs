using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeStock.Api.Services;

/// <summary>
/// Noms anglais des cartes et des séries asiatiques (japonais, coréen, chinois), affichés sous la forme
/// « Mega Charizard X ex (メガリザードンXex) » : la recherche marche en anglais et le nom d'origine reste visible.
/// Données embarquées : Data/Catalog/pokemon-names.json (noms officiels des Pokémon, PokéAPI)
/// et Data/Catalog/set-names.json (noms des séries, par identifiant TCGdex).
/// </summary>
public static class CatalogTranslations
{
    private sealed record Tables(
        Dictionary<string, string> Series,
        Dictionary<string, string> Sets,
        Dictionary<string, Dictionary<string, string>> LanguageSets,
        Dictionary<string, string> SetNames,
        // Par langue : noms des Pokémon du plus long au plus court (« ミュウツー » avant « ミュウ »).
        Dictionary<string, List<KeyValuePair<string, string>>> Pokemon);

    private static readonly Lazy<Tables> Data = new(Load);

    /// <summary>Préfixes de forme : Méga et formes régionales, dans chaque langue.</summary>
    private static readonly (string[] Words, string English)[] Prefixes =
    [
        (["メガ", "메가", "超級", "超级"], "Mega"),
        (["アローラ", "알로라", "阿羅拉", "阿罗拉"], "Alolan"),
        (["ガラル", "가라르", "伽勒爾", "伽勒尔"], "Galarian"),
        (["ヒスイ", "히스이", "洗翠"], "Hisuian"),
        (["パルデア", "팔데아", "帕底亞", "帕底亚"], "Paldean"),
        (["かがやく", "빛나는", "光輝", "光辉"], "Radiant")
    ];

    /// <summary>Nom affiché d'une série : « nom anglais (nom d'origine) » hors français.</summary>
    public static string SetName(string language, string setId, string original)
    {
        if (language == "fr") return original;
        var t = Data.Value;
        // L'identifiant d'abord (certains noms TCGdex sont erronés, ex. S11 en coréen), puis le nom d'origine.
        var english = (t.LanguageSets.TryGetValue(language, out var own) ? own.GetValueOrDefault(setId) : null)
                      ?? t.Sets.GetValueOrDefault(setId)
                      ?? t.SetNames.GetValueOrDefault(original.Trim());
        return Combine(english, original);
    }

    /// <summary>Nom affiché d'un bloc (série TCGdex), ex. « Scarlet & Violet (スカーレット&バイオレット) ».</summary>
    public static string? SerieName(string language, string? serieId, string? original)
    {
        if (language == "fr" || original is null) return original;
        return Combine(serieId is null ? null : Data.Value.Series.GetValueOrDefault(serieId), original);
    }

    /// <summary>
    /// Nom affiché d'une carte : les noms de Pokémon et les préfixes (Méga, formes régionales) sont traduits,
    /// les suffixes latins (ex, V, VMAX, GX, X…) gardés. Sans Pokémon reconnu (dresseur, objet), le nom reste tel quel.
    /// </summary>
    public static string CardName(string language, string original)
    {
        if (language == "fr" || string.IsNullOrWhiteSpace(original)) return original;
        if (!Data.Value.Pokemon.TryGetValue(language, out var names)) return original;

        var work = original;
        var found = false;
        foreach (var (local, english) in names)
        {
            if (!work.Contains(local, StringComparison.Ordinal)) continue;
            work = work.Replace(local, $" {english} ", StringComparison.Ordinal);
            found = true;
        }
        if (!found) return original;

        foreach (var (words, english) in Prefixes)
            foreach (var word in words)
                work = work.Replace(word, $" {english} ", StringComparison.Ordinal);

        work = Regex.Replace(work, @"(?<=\b[XY])(?=(ex|EX|GX|V)\b)", " ");  // « Xex » -> « X ex »
        work = Regex.Replace(work, @"\s*[&＆]\s*", " & ");
        work = Regex.Replace(work, @"\s+", " ").Trim();
        return Combine(work, original);
    }

    private static string Combine(string? english, string original) =>
        string.IsNullOrWhiteSpace(english) || english == original.Trim() ? original : $"{english} ({original.Trim()})";

    private static Tables Load()
    {
        using var setsDoc = ReadResource("set-names.json");
        using var pokemonDoc = ReadResource("pokemon-names.json");
        var root = setsDoc.RootElement;

        var languageSets = root.GetProperty("languages").EnumerateObject()
            .ToDictionary(l => l.Name, l => ToDictionary(l.Value));
        var pokemon = pokemonDoc.RootElement.EnumerateObject()
            .Where(p => p.Value.ValueKind == JsonValueKind.Object)
            .ToDictionary(p => p.Name, p => ToDictionary(p.Value)
                .Where(kv => kv.Key.Length > 1)  // évite qu'un nom d'un seul caractère remplace n'importe quoi
                .OrderByDescending(kv => kv.Key.Length).ToList());

        return new Tables(ToDictionary(root.GetProperty("series")), ToDictionary(root.GetProperty("sets")),
            languageSets, ToDictionary(root.GetProperty("names")), pokemon);
    }

    private static Dictionary<string, string> ToDictionary(JsonElement e) =>
        e.EnumerateObject().Where(p => p.Value.ValueKind == JsonValueKind.String)
            .ToDictionary(p => p.Name, p => p.Value.GetString()!, StringComparer.Ordinal);

    private static JsonDocument ReadResource(string fileName)
    {
        var assembly = typeof(CatalogTranslations).Assembly;
        var name = assembly.GetManifestResourceNames().Single(n => n.EndsWith($".Catalog.{fileName}", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name)!;
        return JsonDocument.Parse(stream);
    }
}
