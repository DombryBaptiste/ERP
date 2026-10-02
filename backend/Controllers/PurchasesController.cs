using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

[ApiController]
[Route("api/purchases")]
public class PurchasesController(PurchaseService service) : ControllerBase
{
    [HttpGet]
    public Task<List<PurchaseDto>> GetAll([FromQuery] string? search, [FromQuery] DateTime? from, [FromQuery] DateTime? to) =>
        service.GetAllAsync(search, from, to);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<PurchaseDto>> Get(int id)
    {
        var purchase = await service.GetByIdAsync(id);
        if (purchase is null) return NotFound(new { message = "Achat introuvable." });
        return purchase;
    }

    [HttpPost]
    public async Task<ActionResult<PurchaseDto>> Create(PurchaseInput input)
    {
        var purchase = await service.CreateAsync(input);
        return CreatedAtAction(nameof(Get), new { id = purchase.Id }, purchase);
    }

    [HttpPut("{id:int}")]
    public Task<PurchaseDto> Update(int id, PurchaseInput input) => service.UpdateAsync(id, input);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await service.DeleteAsync(id);
        return NoContent();
    }
}
