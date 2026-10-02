using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

[ApiController]
[Route("api")]
public class ReportingController(ReportingService service) : ControllerBase
{
    /// <summary>Indicateurs du tableau de bord (mois en cours + 12 derniers mois).</summary>
    [HttpGet("dashboard")]
    public Task<DashboardDto> Dashboard() => service.GetDashboardAsync();

    /// <summary>Statistiques annuelles (année en cours par défaut).</summary>
    [HttpGet("statistics")]
    public Task<StatisticsDto> Statistics([FromQuery] int? year) => service.GetStatisticsAsync(year);
}
