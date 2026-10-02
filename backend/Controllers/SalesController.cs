using Microsoft.AspNetCore.Mvc;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;
using PokeStock.Api.Services;

namespace PokeStock.Api.Controllers;

[ApiController]
[Route("api/sales")]
public class SalesController(SaleService service, InvoicePdfService invoices, PreferencesService preferences) : ControllerBase
{
    [HttpGet]
    public Task<List<SaleDto>> GetAll(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] SalePlatform? platform, [FromQuery] string? customer) =>
        service.GetAllAsync(from, to, platform, customer);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<SaleDto>> Get(int id)
    {
        var sale = await service.GetByIdAsync(id);
        if (sale is null) return NotFound(new { message = "Vente introuvable." });
        return sale;
    }

    [HttpPost]
    public async Task<ActionResult<SaleDto>> Create(SaleInput input)
    {
        var sale = await service.CreateAsync(input);
        return CreatedAtAction(nameof(Get), new { id = sale.Id }, sale);
    }

    [HttpPut("{id:int}")]
    public Task<SaleDto> Update(int id, SaleInput input) => service.UpdateAsync(id, input);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await service.DeleteAsync(id);
        return NoContent();
    }

    // ----- Remboursements -----

    /// <summary>Remboursement total ou partiel, avec retour éventuel des articles en stock.</summary>
    [HttpPost("{id:int}/refunds")]
    public Task<SaleDto> AddRefund(int id, RefundInput input) => service.AddRefundAsync(id, input);

    [HttpDelete("{id:int}/refunds/{refundId:int}")]
    public Task<SaleDto> DeleteRefund(int id, int refundId) => service.DeleteRefundAsync(id, refundId);

    // ----- Facture -----

    /// <summary>Attribue un numéro de facture à la vente (une seule fois).</summary>
    [HttpPost("{id:int}/invoice")]
    public Task<SaleDto> IssueInvoice(int id) => service.IssueInvoiceAsync(id);

    /// <summary>Facture PDF (la facture doit avoir été émise).</summary>
    [HttpGet("{id:int}/invoice")]
    public async Task<IActionResult> InvoicePdf(int id, [FromQuery] bool download = false)
    {
        var sale = await service.GetEntityAsync(id) ?? throw BusinessException.NotFound("Vente introuvable.");
        var pdf = invoices.Generate(sale, (await preferences.GetAsync()).Company);
        return download
            ? File(pdf, "application/pdf", $"facture-{sale.InvoiceNumber}.pdf")
            : File(pdf, "application/pdf");
    }
}
