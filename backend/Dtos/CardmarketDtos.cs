using PokeStock.Api.Models;

namespace PokeStock.Api.Dtos;

// ----- Import du stock Cardmarket (export CSV de l'extension) -----

/// <summary>Ligne de l'export Cardmarket (lue par le navigateur).</summary>
public record CardmarketRowInput(
    long IdProduct, string Name, string? SetCode, string? Number, string? Expansion, string? Rarity,
    string? Language, string? Condition, bool Reverse, decimal Price, int Amount);

/// <summary>Origine choisie pour les cartes à ajouter d'une ligne : "bulk", "collection" ou "ignore".</summary>
public record CardmarketChoice(string Key, string Origin);

/// <param name="FullStock">Vrai si le fichier contient tout le stock Cardmarket ; faux s'il ne contient que certaines séries
/// (seules les cartes de l'appli de ces séries sont alors comparées).</param>
public record CardmarketImportRequest(
    List<CardmarketRowInput> Rows, bool FullStock, string? BulkCategory = null, List<CardmarketChoice>? Choices = null);

/// <summary>Une carte de l'export (lignes de même produit, version, état et langue regroupées) face au stock de l'appli.</summary>
public record CardmarketLineDto(
    string Key, long IdProduct, string Name, string? SetCode, string? Number, string? Expansion, string? Rarity,
    string Language, ItemCondition Condition, bool Reverse, decimal Price,
    int CardmarketQuantity, int AppQuantity, int? CatalogCardId);

/// <summary>Carte du stock de l'appli absente de l'export, ou en plus grand nombre que sur Cardmarket.</summary>
public record CardmarketExtraDto(
    string Name, string? Category, ItemCondition Condition, int AppQuantity, int CardmarketQuantity, int FirstItemId);

/// <summary>Catégorie de bulk dans laquelle on peut prendre des cartes.</summary>
public record CardmarketBulkPoolDto(string Name, int Cards, decimal AverageCost);

public record CardmarketAnalysisDto(
    List<CardmarketLineDto> Lines, List<CardmarketExtraDto> Extras, List<CardmarketBulkPoolDto> BulkPools, int IgnoredRows);

public record CardmarketImportResultDto(
    int CardsAdded, int FromBulk, int FromCollection, int CatalogCardsCreated, int Listed, int Unlisted,
    string? CollectionTransferNumber);
