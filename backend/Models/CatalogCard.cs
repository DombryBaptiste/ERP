namespace PokeStock.Api.Models;

/// <summary>
/// Carte du catalogue (table card_catalog), importée depuis l'API publique TCGdex.
/// Sert de référentiel : cote saisie à la main, estimation de collections et lien avec les articles achetés.
/// </summary>
public class CatalogCard
{
    public int Id { get; set; }
    /// <summary>Identifiant TCGdex de la carte (ex. "me02-095"), unique.</summary>
    public string TcgdexId { get; set; } = string.Empty;
    /// <summary>Identifiant TCGdex de la série (ex. "me02").</summary>
    public string SetId { get; set; } = string.Empty;
    /// <summary>Code officiel de la série (ex. "PFL"), aussi utilisé par Cardmarket.</summary>
    public string? SetCode { get; set; }
    public string SetName { get; set; } = string.Empty;
    /// <summary>Bloc (ex. "Méga-Évolution", "Écarlate et Violet").</summary>
    public string? SerieName { get; set; }
    public DateTime? ReleaseDate { get; set; }
    /// <summary>Numéro dans la série (ex. "095", "TG13").</summary>
    public string Number { get; set; } = string.Empty;
    /// <summary>Ordre d'affichage dans la série.</summary>
    public int SortOrder { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Rarity { get; set; }
    /// <summary>Adresse de l'image sans extension (on ajoute /low.webp ou /high.webp).</summary>
    public string? ImageUrl { get; set; }
    /// <summary>Identifiant du produit Cardmarket (idProduct).</summary>
    public long? CardmarketId { get; set; }
    /// <summary>Cote saisie à la main (prix FR NM, en euros).</summary>
    public decimal? Quote { get; set; }
    public DateTime? QuoteUpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
