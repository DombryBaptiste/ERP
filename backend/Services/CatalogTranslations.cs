using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeStock.Api.Services;

/// <summary>
/// Noms anglais des cartes et des séries asiatiques (japonais, coréen, chinois), sans l'écriture d'origine :
/// « Mega Charizard X ex », « Inferno X ». La recherche se fait en anglais.
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

    /// <summary>Écritures asiatiques (kana, idéogrammes, hangeul, ponctuation pleine chasse), retirées des noms affichés.</summary>
    private static readonly Regex AsianText = new(
        @"[\p{IsHiragana}\p{IsKatakana}\p{IsKatakanaPhoneticExtensions}\p{IsCJKUnifiedIdeographs}" +
        @"\p{IsCJKSymbolsandPunctuation}\p{IsHangulSyllables}\p{IsHangulJamo}\p{IsHangulCompatibilityJamo}" +
        @"\p{IsHalfwidthandFullwidthForms}]+");

    /// <summary>Nom affiché d'une série hors français : nom anglais uniquement (ex. « Inferno X »).</summary>
    public static string SetName(string language, string setId, string original)
    {
        if (language == "fr") return original;
        var t = Data.Value;
        // L'identifiant d'abord (certains noms TCGdex sont erronés, ex. S11 en coréen), puis le nom d'origine.
        var english = (t.LanguageSets.TryGetValue(language, out var own) ? own.GetValueOrDefault(setId) : null)
                      ?? t.Sets.GetValueOrDefault(setId)
                      ?? t.SetNames.GetValueOrDefault(original.Trim());
        return english ?? Latin(original, fallback: setId);
    }

    /// <summary>Nom affiché d'un bloc (série TCGdex) hors français, ex. « Scarlet & Violet ».</summary>
    public static string? SerieName(string language, string? serieId, string? original)
    {
        if (language == "fr" || original is null) return original;
        return (serieId is null ? null : Data.Value.Series.GetValueOrDefault(serieId)) ?? Latin(original, fallback: serieId ?? "");
    }

    /// <summary>
    /// Nom affiché d'une carte hors français, en anglais uniquement : les noms de Pokémon et les préfixes
    /// (Méga, formes régionales, Radiant) sont traduits, les suffixes latins (ex, V, VMAX, GX, X…) gardés,
    /// le reste en écriture asiatique retiré (« リーリエのピッピex » -> « Clefairy ex »).
    /// Sans rien de lisible (dresseur, objet…), on affiche <paramref name="fallback"/> (ex. « Trainer 112 »).
    /// </summary>
    public static string CardName(string language, string original, string fallback)
    {
        if (language == "fr" || string.IsNullOrWhiteSpace(original)) return original;
        var work = original;
        if (Data.Value.Pokemon.TryGetValue(language, out var names))
            foreach (var (local, english) in names)
                if (work.Contains(local, StringComparison.Ordinal))
                    work = work.Replace(local, $" {english} ", StringComparison.Ordinal);

        foreach (var (words, english) in Prefixes)
            foreach (var word in words)
                work = work.Replace(word, $" {english} ", StringComparison.Ordinal);

        work = Regex.Replace(work, @"(?<=\b[XY])(?=(ex|EX|GX|V)\b)", " ");  // « Xex » -> « X ex »
        return Latin(work, fallback);
    }

    /// <summary>Retire l'écriture asiatique ; s'il ne reste rien de lisible, renvoie <paramref name="fallback"/>.</summary>
    private static string Latin(string text, string fallback)
    {
        var latin = AsianText.Replace(text, " ");
        latin = Regex.Replace(latin, @"\s*[&＆]\s*", " & ");
        latin = Regex.Replace(latin, @"\s+", " ").Trim(' ', '&', '-', '・');
        return latin.Any(char.IsLetter) ? latin : fallback;
    }

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
