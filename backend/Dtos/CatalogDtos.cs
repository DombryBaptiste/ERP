namespace PokeStock.Api.Dtos;

/// <summary>Carte du catalogue.</summary>
public record CatalogCardDto(
    int Id, string TcgdexId, string SetId, string? SetCode, string SetName, string? SerieName,
    string Number, string Name, string? Rarity,
    string? ImageUrl,       // sans extension : ajouter /low.webp (vignette) ou /high.webp
    string? CardmarketUrl,  // page produit filtrée sur les offres en français, NM ou mieux
    decimal? Quote, DateTime? QuoteUpdatedAt,
    int InStock);           // exemplaires en stock liés à cette carte

/// <summary>Série importée dans le catalogue.</summary>
public record CatalogSetDto(
    string SetId, string? SetCode, string SetName, string? SerieName, DateTime? ReleaseDate,
    int CardCount, int QuotedCount);

/// <summary>Série disponible chez TCGdex, proposée à l'import.</summary>
public record AvailableSetDto(string SetId, string Name, string SerieName, int ImportedCount);

public record CatalogImportResultDto(string SetId, string SetName, int Added, int Updated, int Total);

public record SetQuoteInput(decimal? Quote);
