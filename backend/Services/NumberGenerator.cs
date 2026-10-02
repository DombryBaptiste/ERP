using Microsoft.EntityFrameworkCore;

namespace PokeStock.Api.Services;

/// <summary>
/// Génère les numéros de pièce : préfixe + année + séquence sur 3 chiffres (A2026001, V2026042...).
/// La séquence repart à 001 chaque année.
/// </summary>
public static class NumberGenerator
{
    public static async Task<string> NextAsync(IQueryable<string> existingNumbers, string prefix, int year)
    {
        var start = $"{prefix}{year}";
        // Tri par longueur puis valeur pour que A20261000 passe après A2026999.
        var last = await existingNumbers
            .Where(n => n.StartsWith(start))
            .OrderByDescending(n => n.Length).ThenByDescending(n => n)
            .FirstOrDefaultAsync();

        var next = last is not null && int.TryParse(last[start.Length..], out var seq) ? seq + 1 : 1;
        return $"{start}{next:D3}";
    }
}
