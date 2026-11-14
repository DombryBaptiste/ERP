using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

/// <summary>Import du stock Cardmarket (export CSV de l'extension) : aperçu du rapprochement, puis application.</summary>
[ApiController]
[Route("api/cardmarket/import")]
public class CardmarketController(CardmarketImportService service) : ControllerBase
{
    [HttpPost("analyze")]
    public Task<CardmarketAnalysisDto> Analyze(CardmarketImportRequest request) => service.AnalyzeAsync(request);

    [HttpPost("apply")]
    public Task<CardmarketImportResultDto> Apply(CardmarketImportRequest request) => service.ApplyAsync(request);
}
