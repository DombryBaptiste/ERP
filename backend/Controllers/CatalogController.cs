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
    public Task<List<AvailableSetDto>> AvailableSets(CancellationToken ct) => service.GetAvailableSetsAsync(ct);

    /// <summary>Importe ou met à jour une série (les cotes sont conservées).</summary>
    [HttpPost("sets/{setId}/import")]
    public Task<CatalogImportResultDto> Import(string setId, [FromQuery] bool rareOnly = true, CancellationToken ct = default) =>
        service.ImportSetAsync(setId, rareOnly, ct);

    /// <summary>Ex. : /api/catalog/cards?setId=me02 ou ?search=PFL 95 ou ?search=Dracaufeu</summary>
    [HttpGet("cards")]
    public Task<List<CatalogCardDto>> Cards([FromQuery] string? setId, [FromQuery] string? search,
        [FromQuery] bool quotedOnly = false, [FromQuery] int take = 300, CancellationToken ct = default) =>
        service.SearchAsync(setId, search, quotedOnly, take, ct);

    /// <summary>Saisit (ou efface, avec null) la cote d'une carte.</summary>
    [HttpPut("cards/{id:int}/quote")]
    public Task<CatalogCardDto> SetQuote(int id, SetQuoteInput input, CancellationToken ct) =>
        service.SetQuoteAsync(id, input.Quote, ct);
}
