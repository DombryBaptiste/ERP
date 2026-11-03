using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Frais Cardmarket facturés au mois. Tant que la facture d'un mois n'est pas saisie, chaque vente porte une
/// estimation (5 % par article). Une fois saisie, son montant est réparti sur les ventes Cardmarket du mois
/// au prorata de leur montant : le bénéfice des ventes, les statistiques et la rentabilité des achats restent justes.
/// </summary>
public class PlatformFeeService(AppDbContext db, AttachmentService attachments)
{
    private const SalePlatform Platform = SalePlatform.Cardmarket;

    /// <summary>Mois de l'année ayant des ventes Cardmarket ou une facture, du plus récent au plus ancien.</summary>
    public async Task<List<PlatformFeeMonthDto>> GetMonthsAsync(int year)
    {
        var (start, end) = ServiceHelpers.YearRange(year);
        var sales = await db.Sales.AsNoTracking()
            .Include(s => s.Items)
            .Where(s => s.Platform == Platform && s.SaleDate >= start && s.SaleDate < end)
            .ToListAsync();
        var invoices = await db.PlatformFeeInvoices.AsNoTracking()
            .Where(f => f.Platform == Platform && f.Year == year)
            .ToListAsync();

        var months = sales.Select(s => s.SaleDate.Month).Concat(invoices.Select(f => f.Month)).Distinct();
        return months.OrderByDescending(m => m).Select(month =>
        {
            var monthSales = sales.Where(s => s.SaleDate.Month == month).ToList();
            var invoice = invoices.FirstOrDefault(f => f.Month == month);
            return new PlatformFeeMonthDto(
                year, month, monthSales.Count,
                monthSales.Sum(s => s.TotalAmount),
                Math.Round(monthSales.Sum(SaleService.EstimatedCardmarketFees), 2),
                monthSales.Sum(s => s.Fees),
                invoice?.ToDto());
        }).ToList();
    }

    public async Task<PlatformFeeInvoiceDto> CreateAsync(PlatformFeeInvoiceInput input)
    {
        Validate(input);
        if (await db.PlatformFeeInvoices.AnyAsync(f => f.Platform == Platform && f.Year == input.Year && f.Month == input.Month))
            throw BusinessException.Conflict("Une facture existe déjà pour ce mois : modifiez-la.");

        var invoice = new PlatformFeeInvoice { Platform = Platform };
        Apply(invoice, input);
        db.PlatformFeeInvoices.Add(invoice);
        await db.SaveChangesAsync();
        await ReallocateAsync(invoice.Year, invoice.Month);
        return invoice.ToDto();
    }

    public async Task<PlatformFeeInvoiceDto> UpdateAsync(int id, PlatformFeeInvoiceInput input)
    {
        Validate(input);
        var invoice = await db.PlatformFeeInvoices.FirstOrDefaultAsync(f => f.Id == id)
                      ?? throw BusinessException.NotFound("Facture introuvable.");
        if (await db.PlatformFeeInvoices.AnyAsync(f => f.Id != id && f.Platform == invoice.Platform
                                                       && f.Year == input.Year && f.Month == input.Month))
            throw BusinessException.Conflict("Une autre facture existe déjà pour ce mois.");

        var (oldYear, oldMonth) = (invoice.Year, invoice.Month);
        Apply(invoice, input);
        await db.SaveChangesAsync();
        await ReallocateAsync(invoice.Year, invoice.Month);
        if ((oldYear, oldMonth) != (invoice.Year, invoice.Month)) await ReallocateAsync(oldYear, oldMonth);
        return invoice.ToDto();
    }

    /// <summary>Supprime la facture : les ventes du mois reviennent à l'estimation.</summary>
    public async Task DeleteAsync(int id)
    {
        var invoice = await db.PlatformFeeInvoices.FirstOrDefaultAsync(f => f.Id == id)
                      ?? throw BusinessException.NotFound("Facture introuvable.");
        db.PlatformFeeInvoices.Remove(invoice);
        await db.SaveChangesAsync();
        await ReallocateAsync(invoice.Year, invoice.Month);
        await attachments.DeleteForOwnerAsync(AttachmentOwner.PlatformFeeInvoice, id);
    }

    /// <summary>
    /// Recalcule les frais et le bénéfice des ventes Cardmarket d'un mois : part de la facture si elle existe
    /// (au prorata du montant des articles, le dernier centime d'arrondi sur la plus grosse vente), sinon estimation.
    /// </summary>
    public async Task ReallocateAsync(int year, int month)
    {
        var start = new DateTime(year, month, 1);
        var end = start.AddMonths(1);
        var sales = await db.Sales
            .Include(s => s.Items)
            .Include(s => s.Refunds).ThenInclude(r => r.Items)
            .Include(s => s.ShippingUsages)
            .AsSplitQuery()
            .Where(s => s.Platform == Platform && s.SaleDate >= start && s.SaleDate < end)
            .ToListAsync();
        if (sales.Count == 0) return;

        var invoice = await db.PlatformFeeInvoices.AsNoTracking()
            .FirstOrDefaultAsync(f => f.Platform == Platform && f.Year == year && f.Month == month);

        if (invoice is null)
        {
            sales.ForEach(SaleService.ApplyCardmarketFees);
        }
        else
        {
            var total = sales.Sum(s => s.TotalAmount);
            foreach (var sale in sales)
            {
                var share = total > 0 ? sale.TotalAmount / total : 1m / sales.Count;
                sale.Fees = Math.Round(invoice.Amount * share, 2);
                sale.FeesFromInvoice = true;
            }
            // L'écart d'arrondi va sur la plus grosse vente pour que la somme égale exactement la facture.
            var gap = invoice.Amount - sales.Sum(s => s.Fees);
            if (gap != 0) sales.MaxBy(s => s.TotalAmount)!.Fees += gap;
        }

        sales.ForEach(SaleService.Recalculate);
        await db.SaveChangesAsync();
    }

    private static void Apply(PlatformFeeInvoice invoice, PlatformFeeInvoiceInput input)
    {
        invoice.Year = input.Year;
        invoice.Month = input.Month;
        invoice.Amount = Math.Round(input.Amount, 2);
        invoice.InvoiceNumber = input.InvoiceNumber.TrimOrNull();
        invoice.InvoiceDate = input.InvoiceDate?.Date;
        invoice.Comment = input.Comment.TrimOrNull();
    }

    private static void Validate(PlatformFeeInvoiceInput input)
    {
        if (input.Month is < 1 or > 12) throw new BusinessException("Mois invalide.");
        if (input.Year is < 2000 or > 2100) throw new BusinessException("Année invalide.");
        if (input.Amount < 0) throw new BusinessException("Le montant de la facture ne peut pas être négatif.");
        if (input.InvoiceNumber?.Trim().Length > 50) throw new BusinessException("Numéro de facture trop long (50 caractères max.).");
        if (input.Comment?.Trim().Length > 1000) throw new BusinessException("Commentaire trop long (1000 caractères max.).");
    }
}
