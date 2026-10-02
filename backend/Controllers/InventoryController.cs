using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

[ApiController]
[Route("api/inventory")]
public class InventoryController(InventoryService service) : ControllerBase
{
    /// <param name="status">instock | sold (optionnel)</param>
    [HttpGet]
    public Task<List<InventoryItemDto>> GetAll(
        [FromQuery] string? search, [FromQuery] string? category, [FromQuery] ItemType? type,
        [FromQuery] ItemCondition? condition, [FromQuery] string? status) =>
        service.GetAllAsync(search, category, type, condition, status);

    [HttpGet("categories")]
    public Task<List<string>> GetCategories() => service.GetCategoriesAsync();

    [HttpGet("{id:int}")]
    public async Task<ActionResult<InventoryItemDto>> Get(int id)
    {
        var item = await service.GetByIdAsync(id);
        if (item is null) return NotFound(new { message = "Article introuvable." });
        return item;
    }

    [HttpPost]
    public async Task<ActionResult<InventoryItemDto>> Create(InventoryItemInput input)
    {
        var item = await service.CreateAsync(input);
        return CreatedAtAction(nameof(Get), new { id = item.Id }, item);
    }

    [HttpPut("{id:int}")]
    public Task<InventoryItemDto> Update(int id, InventoryItemInput input) => service.UpdateAsync(id, input);

    /// <summary>Met à jour la seule valeur de marché estimée (null pour l'effacer).</summary>
    [HttpPut("{id:int}/market-value")]
    public Task<InventoryItemDto> SetMarketValue(int id, MarketValueInput input) => service.SetMarketValueAsync(id, input.Value);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await service.DeleteAsync(id);
        return NoContent();
    }
}
