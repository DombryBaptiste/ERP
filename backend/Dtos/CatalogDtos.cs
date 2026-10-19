namespace PokeStock.Api.Dtos;

/// <summary>Carte du catalogue.</summary>
public record CatalogCardDto(
    int Id, string Language, string TcgdexId, string SetId, string? SetCode, string SetName, string? SerieName,
    string Number, string Name, string? Rarity,
    string? ImageUrl,       // sans extension : ajouter /low.webp (vignette) ou /high.webp
    string? CardmarketUrl,  // page produit filtrée sur les offres dans la langue de la carte, NM ou mieux
    decimal? Quote, DateTime? QuoteUpdatedAt,
    int InStock);           // exemplaires en stock liés à cette carte

/// <summary>Série importée dans le catalogue.</summary>
public record CatalogSetDto(
    string Language, string SetId, string? SetCode, string SetName, string? SerieName, DateTime? ReleaseDate,
    int CardCount, int QuotedCount);

/// <summary>Série disponible chez TCGdex, proposée à l'import.</summary>
public record AvailableSetDto(string SetId, string? Code, string Name, string SerieName, int ImportedCount);

public record CatalogImportResultDto(string SetId, string SetName, int Added, int Updated, int Total, int Skipped);

/// <summary>Groupes de rareté proposés à l'import.</summary>
public enum RarityGroup
{
    Common,      // Commune
    Uncommon,    // Peu commune
    Rare,        // Rare (non holo)
    Holo,        // Rare holo (intéressantes dans les anciennes séries)
    ClassicEx,   // ex / V / VMAX / VSTAR classiques (non Full Art)
    NoRarity,    // « Sans rareté » : énergies de base...
    Unknown,     // Rareté non renseignée par TCGdex (fréquent en japonais)
    Other        // Tout le reste : Full Art, AR, ALT, gold, Prime, LÉGENDE, Radieux...
}

public record SetQuoteInput(decimal? Quote);

/// <summary>Résultat d'une suppression : cartes retirées du catalogue, articles en stock déliés.</summary>
public record CatalogDeleteResultDto(int DeletedCards, int UnlinkedItems);
