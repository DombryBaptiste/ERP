using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

/// <summary>Catalogue des cartes : import TCGdex, cotes, recherche pour l'estimation.</summary>
[ApiController]
[Route("api/catalog")]
public class CatalogController(CatalogService service) : ControllerBase
{
    /// <summary>Séries présentes dans le catalogue.</summary>
    [HttpGet("sets")]
    public Task<List<CatalogSetDto>> Sets(CancellationToken ct) => service.GetImportedSetsAsync(ct);

    /// <summary>Séries disponibles chez TCGdex, à importer.</summary>
    [HttpGet("available-sets")]
    public Task<List<AvailableSetDto>> AvailableSets([FromQuery] string language = "fr", CancellationToken ct = default) =>
        service.GetAvailableSetsAsync(language, ct);

    /// <summary>
    /// Importe ou met à jour une série (les cotes sont conservées).
    /// Ex. : ?language=fr&amp;groups=Holo&amp;groups=Other (par défaut : Other et Unknown, les cartes « rares »).
    /// </summary>
    [HttpPost("sets/{setId}/import")]
    public Task<CatalogImportResultDto> Import(string setId, [FromQuery] string language = "fr",
        [FromQuery] RarityGroup[]? groups = null, CancellationToken ct = default) =>
        service.ImportSetAsync(setId, language, groups is { Length: > 0 } ? groups : CatalogService.DefaultGroups, ct);

    /// <summary>Ex. : /api/catalog/cards?language=fr&amp;setId=me02 ou ?search=PFL 95 ou ?search=Dracaufeu</summary>
    [HttpGet("cards")]
    public Task<List<CatalogCardDto>> Cards([FromQuery] string? language, [FromQuery] string? setId, [FromQuery] string? search,
        [FromQuery] bool quotedOnly = false, [FromQuery] int take = 300, CancellationToken ct = default) =>
        service.SearchAsync(language, setId, search, quotedOnly, take, ct);

    /// <summary>Supprime une carte du catalogue (les articles liés passent en « Hors catégorie »).</summary>
    [HttpDelete("cards/{id:int}")]
    public Task<CatalogDeleteResultDto> DeleteCard(int id, CancellationToken ct) => service.DeleteCardAsync(id, ct);

    /// <summary>Supprime toute une série du catalogue, ex. DELETE /api/catalog/sets/me02?language=fr.</summary>
    [HttpDelete("sets/{setId}")]
    public Task<CatalogDeleteResultDto> DeleteSet(string setId, [FromQuery] string language = "fr", CancellationToken ct = default) =>
        service.DeleteSetAsync(setId, language, ct);

    /// <summary>Saisit (ou efface, avec null) la cote d'une carte.</summary>
    [HttpPut("cards/{id:int}/quote")]
    public Task<CatalogCardDto> SetQuote(int id, SetQuoteInput input, CancellationToken ct) =>
        service.SetQuoteAsync(id, input.Quote, ct);
}
