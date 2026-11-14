using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

/// <summary>Comptage du bulk avec l'export Cardmarket : aperçu des écarts, puis ajustement de la collection.</summary>
[ApiController]
[Route("api/cardmarket/count")]
public class CardmarketController(CardmarketCountService service) : ControllerBase
{
    [HttpPost("analyze")]
    public Task<CardmarketCountDto> Analyze(CardmarketCountRequest request) => service.AnalyzeAsync(request);

    [HttpPost("apply")]
    public Task<CardmarketCountResultDto> Apply(CardmarketCountRequest request) => service.ApplyAsync(request);
}
