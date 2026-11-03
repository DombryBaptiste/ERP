namespace PokeStock.Api.Services;

/// <summary>Petites fonctions communes aux services.</summary>
internal static class ServiceHelpers
{
    /// <summary>Texte saisi nettoyé : espaces de début et de fin retirés, null s'il est vide.</summary>
    public static string? TrimOrNull(this string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>Bornes d'une année civile : du 1er janvier (inclus) au 1er janvier suivant (exclu).</summary>
    public static (DateTime Start, DateTime End) YearRange(int year) => (new DateTime(year, 1, 1), new DateTime(year + 1, 1, 1));
}
