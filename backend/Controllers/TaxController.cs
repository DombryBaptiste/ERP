using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

[ApiController]
[Route("api/tax")]
public class TaxController(TaxService service) : ControllerBase
{
    /// <summary>Synthèse fiscale de l'année : cotisations par période, impôt estimé, seuils, DAC7.</summary>
    [HttpGet("summary")]
    public Task<TaxSummaryDto> Summary([FromQuery] int? year) => service.GetSummaryAsync(year);

    [HttpGet("settings")]
    public Task<TaxSettings> GetSettings() => service.GetSettingsAsync();

    [HttpPut("settings")]
    public Task<TaxSettings> SaveSettings(TaxSettings settings) => service.SaveSettingsAsync(settings);

    /// <summary>Marque une période comme déclarée à l'URSSAF (ex. 2026-T3).</summary>
    [HttpPut("declarations/{periodKey}")]
    public async Task<IActionResult> SetDeclared(string periodKey, DeclarationStatusInput input)
    {
        await service.SetDeclaredAsync(periodKey, input.Declared);
        return NoContent();
    }
}
