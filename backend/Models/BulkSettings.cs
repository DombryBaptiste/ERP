namespace PokeStock.Api.Models;

/// <summary>
/// Réglages du bulk (cartes en vrac vendues au lot) : poids moyen d'une carte pour compter au poids,
/// et catégories de bulk avec un prix de vente conseillé par carte.
/// Stocké en JSON dans app_settings (clé "bulk.settings").
/// </summary>
public class BulkSettings
{
    /// <summary>Poids moyen d'une carte sans protection, en grammes (≈ 1,8 g).</summary>
    public decimal GramsPerCard { get; set; } = 1.8m;

    public List<BulkCategory> Categories { get; set; } = DefaultCategories();

    /// <summary>Catégories proposées par défaut ; prix indicatifs, à ajuster selon le marché.</summary>
    public static List<BulkCategory> DefaultCategories() =>
    [
        new() { Name = "Bulk communes / peu communes", SuggestedPricePerCard = 0.02m },
        new() { Name = "Bulk reverses", SuggestedPricePerCard = 0.10m },
        new() { Name = "Bulk holos", SuggestedPricePerCard = 0.25m },
        new() { Name = "Bulk V / ex / GX", SuggestedPricePerCard = 0.30m },
        new() { Name = "Bulk dresseurs", SuggestedPricePerCard = 0.03m },
        new() { Name = "Bulk énergies", SuggestedPricePerCard = 0.01m }
    ];
}

/// <summary>Catégorie de bulk : c'est aussi le nom du produit dans l'inventaire.</summary>
public class BulkCategory
{
    public string Name { get; set; } = string.Empty;
    /// <summary>Prix de vente conseillé par carte, utilisé pour proposer le prix d'un lot.</summary>
    public decimal SuggestedPricePerCard { get; set; }
}
