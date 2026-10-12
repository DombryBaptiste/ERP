using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Frais d'envoi : achats de fournitures (timbres, bordereaux, enveloppes, protections...), stock restant,
/// et synthèse « coût réel des envois » face au port payé par les acheteurs.
/// La consommation des fournitures par les ventes est gérée dans <see cref="SaleService"/>.
/// </summary>
public class ShippingService(AppDbContext db, AttachmentService attachments, PreferencesService preferences)
{
    /// <summary>Natures pour lesquelles on suit un stock minimum (pas les bordereaux, achetés à l'unité).</summary>
    private static readonly ShippingSupplyKind[] StockedKinds =
        [ShippingSupplyKind.Stamp, ShippingSupplyKind.Envelope, ShippingSupplyKind.Protection, ShippingSupplyKind.Box];

    public async Task<List<ShippingSupplyDto>> GetAllAsync(int? year, ShippingSupplyKind? kind)
    {
        var query = db.ShippingSupplies.AsNoTracking();
        if (year.HasValue)
        {
            var start = new DateTime(year.Value, 1, 1);
            var end = start.AddYears(1);
            query = query.Where(s => s.PurchaseDate >= start && s.PurchaseDate < end);
        }
        if (kind.HasValue) query = query.Where(s => s.Kind == kind.Value);
        var rows = await query.OrderByDescending(s => s.PurchaseDate).ThenByDescending(s => s.Id).ToListAsync();
        return rows.Select(s => s.ToDto()).ToList();
    }

    public async Task<ShippingSupplyDto?> GetByIdAsync(int id) =>
        (await db.ShippingSupplies.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id))?.ToDto();

    public async Task<ShippingSupplyDto> CreateAsync(ShippingSupplyInput input)
    {
        Validate(input);
        var supply = new ShippingSupply
        {
            SupplyNumber = await NumberGenerator.NextAsync(db.ShippingSupplies.Select(s => s.SupplyNumber), "E", input.PurchaseDate.Year),
            RemainingQuantity = input.Quantity
        };
        Apply(supply, input);
        db.ShippingSupplies.Add(supply);
        await db.SaveChangesAsync();
        return supply.ToDto();
    }

    public async Task<ShippingSupplyDto> UpdateAsync(int id, ShippingSupplyInput input)
    {
        Validate(input);
        var supply = await db.ShippingSupplies.FirstOrDefaultAsync(s => s.Id == id)
                     ?? throw BusinessException.NotFound("Fourniture introuvable.");
        var used = supply.Quantity - supply.RemainingQuantity;
        if (input.Quantity < used)
            throw BusinessException.Conflict($"{used} unité(s) déjà utilisée(s) pour des envois : la quantité ne peut pas être inférieure.");
        Apply(supply, input);
        supply.RemainingQuantity = input.Quantity - used;
        await db.SaveChangesAsync();
        return supply.ToDto();
    }

    public async Task DeleteAsync(int id)
    {
        var supply = await db.ShippingSupplies.FirstOrDefaultAsync(s => s.Id == id)
                     ?? throw BusinessException.NotFound("Fourniture introuvable.");
        if (await db.ShippingUsages.AnyAsync(u => u.SupplyId == id))
            throw BusinessException.Conflict("Cette fourniture a déjà servi à des envois : retirez-la d'abord des ventes concernées.");
        db.ShippingSupplies.Remove(supply);
        await db.SaveChangesAsync();
        await attachments.DeleteForOwnerAsync(AttachmentOwner.ShippingSupply, id);
    }

    // ---------------------------------------------------------------
    // Stock et synthèse
    // ---------------------------------------------------------------

    /// <summary>
    /// Stock par fourniture : les achats de même nom et même nature sont regroupés.
    /// Seules les fournitures encore en stock ou utilisées dans l'année sont renvoyées.
    /// </summary>
    public async Task<List<ShippingStockDto>> GetStockAsync(int year, int lowThreshold)
    {
        var start = new DateTime(year, 1, 1);
        var end = start.AddYears(1);
        var supplies = await db.ShippingSupplies.AsNoTracking().ToListAsync();
        var usedThisYear = await db.ShippingUsages.AsNoTracking()
            .Where(u => u.Sale.SaleDate >= start && u.Sale.SaleDate < end)
            .GroupBy(u => u.SupplyId)
            .Select(g => new { SupplyId = g.Key, Quantity = g.Sum(u => u.Quantity) })
            .ToDictionaryAsync(x => x.SupplyId, x => x.Quantity);

        return supplies
            .GroupBy(s => (Name: NormalizeName(s.Name), s.Kind))
            .Select(g =>
            {
                var latest = g.OrderBy(s => s.PurchaseDate).ThenBy(s => s.Id).Last();
                var remaining = g.Sum(s => s.RemainingQuantity);
                var value = g.Sum(s => s.RemainingQuantity * s.UnitCost);
                var used = g.Sum(s => usedThisYear.GetValueOrDefault(s.Id));
                return new ShippingStockDto(
                    latest.Name, latest.Kind, latest.Carrier, remaining,
                    Math.Round(remaining > 0 ? value / remaining : latest.UnitCost, 4),
                    Math.Round(value, 2), used,
                    StockedKinds.Contains(latest.Kind) && remaining <= lowThreshold);
            })
            .Where(s => s.Remaining > 0 || s.UsedThisYear > 0)
            .OrderBy(s => s.Kind).ThenBy(s => s.Name)
            .ToList();
    }

    public async Task<ShippingSummaryDto> GetSummaryAsync(int? requestedYear)
    {
        var today = DateTime.Today;
        var year = requestedYear ?? today.Year;
        var start = new DateTime(year, 1, 1);
        var end = start.AddYears(1);
        var threshold = (await preferences.GetAsync()).Alerts.LowShippingStock;

        var supplies = await db.ShippingSupplies.AsNoTracking()
            .Select(s => new { s.PurchaseDate, s.TotalAmount, s.RemainingQuantity, s.UnitCost })
            .ToListAsync();
        var sales = await db.Sales.AsNoTracking()
            .Where(s => s.SaleDate >= start && s.SaleDate < end)
            .Select(s => new { s.SaleDate, s.ShippingCost, s.AmountPaid, s.Carrier })
            .ToListAsync();
        // Vente « expédiée » : des fournitures ont été utilisées, ou un transporteur (autre que la main propre) est indiqué.
        var shipped = sales.Where(s => s.ShippingCost > 0 || (s.Carrier.HasValue && s.Carrier != ShippingCarrier.HandDelivery)).ToList();

        var saleYears = await db.Sales.Select(s => s.SaleDate.Year).Distinct().ToListAsync();
        var years = supplies.Select(s => s.PurchaseDate.Year).Concat(saleYears).Append(today.Year).Append(year)
            .Distinct().OrderByDescending(y => y).ToList();

        var spentThisYear = supplies.Where(s => s.PurchaseDate >= start && s.PurchaseDate < end).Sum(s => s.TotalAmount);
        var monthStart = new DateTime(today.Year, today.Month, 1);
        var spentThisMonth = supplies.Where(s => s.PurchaseDate >= monthStart).Sum(s => s.TotalAmount);
        var used = shipped.Sum(s => s.ShippingCost);

        var monthly = Enumerable.Range(1, 12).Select(m =>
        {
            var monthSales = shipped.Where(s => s.SaleDate.Month == m).ToList();
            return new ShippingMonthDto(m,
                supplies.Where(s => s.PurchaseDate.Year == year && s.PurchaseDate.Month == m).Sum(s => s.TotalAmount),
                monthSales.Sum(s => s.ShippingCost), monthSales.Sum(s => s.AmountPaid), monthSales.Count);
        }).ToList();

        var carriers = shipped.GroupBy(s => s.Carrier)
            .Select(g => new CarrierStatDto(g.Key, g.Count(), g.Sum(s => s.ShippingCost), g.Sum(s => s.AmountPaid)))
            .OrderByDescending(c => c.Shipments)
            .ToList();

        return new ShippingSummaryDto(
            year, years, threshold,
            spentThisYear, spentThisMonth,
            used, shipped.Sum(s => s.AmountPaid), shipped.Count,
            shipped.Count > 0 ? Math.Round(used / shipped.Count, 2) : 0,
            Math.Round(supplies.Sum(s => s.RemainingQuantity * s.UnitCost), 2),
            await GetStockAsync(year, threshold), monthly, carriers);
    }

    // ---------------------------------------------------------------

    /// <summary>
    /// Nom comparable, comme côté interface (core/products.ts normalizeText) : sans accents, en minuscules,
    /// espaces normalisés. « Carton d'expédition » et « carton  d'expedition » sont la même fourniture.
    /// </summary>
    private static string NormalizeName(string name)
    {
        var decomposed = name.Normalize(System.Text.NormalizationForm.FormD);
        var withoutAccents = new string(decomposed
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark)
            .ToArray());
        return System.Text.RegularExpressions.Regex.Replace(withoutAccents.ToLowerInvariant(), @"\s+", " ").Trim();
    }

    private static void Apply(ShippingSupply supply, ShippingSupplyInput input)
    {
        supply.PurchaseDate = input.PurchaseDate.Date;
        supply.Kind = input.Kind;
        supply.Carrier = input.Carrier;
        supply.Name = input.Name.Trim();
        supply.Quantity = input.Quantity;
        supply.TotalAmount = Math.Round(input.TotalAmount, 2);
        // Le coût unitaire ne change pas le coût des envois déjà faits (figé dans shipping_usages).
        supply.UnitCost = Math.Round(input.TotalAmount / input.Quantity, 6);
        supply.Supplier = string.IsNullOrWhiteSpace(input.Supplier) ? null : input.Supplier.Trim();
        supply.PaymentMethod = input.PaymentMethod;
        supply.Comment = string.IsNullOrWhiteSpace(input.Comment) ? null : input.Comment.Trim();
    }

    private static void Validate(ShippingSupplyInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name)) throw new BusinessException("Indiquez la désignation (ex. « Timbre Lettre verte 20 g »).");
        if (input.Name.Trim().Length > 200) throw new BusinessException("La désignation ne peut pas dépasser 200 caractères.");
        if (input.Quantity <= 0) throw new BusinessException("La quantité doit être supérieure à 0.");
        if (input.TotalAmount < 0) throw new BusinessException("Le montant ne peut pas être négatif.");
    }
}
