using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

[ApiController]
[Route("api")]
public class ReportingController(ReportingService service, InsightsService insights) : ControllerBase
{
    /// <summary>Indicateurs du tableau de bord (mois en cours + 12 derniers mois).</summary>
    [HttpGet("dashboard")]
    public Task<DashboardDto> Dashboard() => service.GetDashboardAsync();

    /// <summary>Statistiques annuelles (année en cours par défaut).</summary>
    [HttpGet("statistics")]
    public Task<StatisticsDto> Statistics([FromQuery] int? year, [FromQuery] bool includePersonalCollection = true) =>
        service.GetStatisticsAsync(year, includePersonalCollection);

    /// <summary>Statistiques détaillées : panier moyen, plateformes, types, clients, bulk, rotation, N-1…</summary>
    [HttpGet("statistics/insights")]
    public Task<InsightsDto> Insights([FromQuery] int? year, [FromQuery] bool includePersonalCollection = true) =>
        insights.GetAsync(year, includePersonalCollection);
}
