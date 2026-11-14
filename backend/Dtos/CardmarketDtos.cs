namespace PokeStock.Api.Dtos;

// ----- Comptage du bulk avec l'export Cardmarket (extension du navigateur) -----

/// <summary>Ligne de l'export Cardmarket (lue par le navigateur).</summary>
public record CardmarketRowInput(
    long IdProduct, string Name, string? SetCode, string? Number, string? Expansion, string? Rarity,
    string? Language, string? Condition, bool Reverse, decimal Price, int Amount);

/// <summary>Association d'un groupe du comptage à une catégorie de bulk de l'appli.</summary>
public record CardmarketGroupMapping(string Group, string? Category);

/// <param name="Mappings">Groupe -> catégorie de bulk (null ou absent : groupe non comparé).</param>
public record CardmarketCountRequest(List<CardmarketRowInput> Rows, List<CardmarketGroupMapping>? Mappings = null);

/// <summary>Une carte de l'export rangée dans un groupe (ou à part).</summary>
public record CardmarketCountedCardDto(string Name, string? SetCode, string? Number, string? Rarity, bool Reverse,
    decimal Price, int Amount, string Reason);

/// <summary>Un groupe du comptage (ex. « Reverses ») face à sa catégorie de bulk.</summary>
public record CardmarketGroupDto(string Group, int Cards, decimal Value, string? Category,
    int? AppCards, int? CollectionCards, int? Difference);

public record CardmarketBulkCategoryDto(string Name, int Cards, int CollectionCards);

public record CardmarketCountDto(
    List<CardmarketGroupDto> Groups, List<CardmarketBulkCategoryDto> Categories,
    List<CardmarketCountedCardDto> Apart, int IgnoredRows);

/// <summary>Résultat de l'ajustement : cartes ajoutées / retirées de la collection, et ce qui n'a pas pu être retiré.</summary>
public record CardmarketAdjustmentDto(string Group, string Category, int Added, int Removed, int NotRemoved);

public record CardmarketCountResultDto(List<CardmarketAdjustmentDto> Adjustments, string? TransferNumber);
