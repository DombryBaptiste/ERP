using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Gestion des ventes : calcul du total, du bénéfice et décrémentation automatique du stock,
/// remboursements (avec remise en stock) et numérotation des factures.
/// Chaque opération est enregistrée en un seul SaveChanges (donc dans une transaction).
/// </summary>
public class SaleService(AppDbContext db, AttachmentService attachments)
{
    private IQueryable<Sale> WithDetails() =>
        db.Sales
            .Include(s => s.Items).ThenInclude(i => i.InventoryItem)
            .Include(s => s.Refunds).ThenInclude(r => r.Items)
            .AsSplitQuery();

    public async Task<List<SaleDto>> GetAllAsync(DateTime? from, DateTime? to, SalePlatform? platform, string? customer)
    {
        var query = WithDetails().AsNoTracking();
        if (from.HasValue) { var f = from.Value.Date; query = query.Where(s => s.SaleDate >= f); }
        if (to.HasValue) { var t = to.Value.Date; query = query.Where(s => s.SaleDate <= t); }
        if (platform.HasValue) query = query.Where(s => s.Platform == platform.Value);
        if (!string.IsNullOrWhiteSpace(customer))
        {
            var c = customer.Trim();
            query = query.Where(s => s.Customer != null && s.Customer.Contains(c));
        }

        var sales = await query.OrderByDescending(s => s.SaleDate).ThenByDescending(s => s.Id).ToListAsync();
        return sales.Select(s => s.ToDto()).ToList();
    }

    public async Task<SaleDto?> GetByIdAsync(int id) =>
        (await WithDetails().AsNoTracking().FirstOrDefaultAsync(s => s.Id == id))?.ToDto();

    /// <summary>Vente complète (pour la facture PDF).</summary>
    public Task<Sale?> GetEntityAsync(int id) =>
        WithDetails().AsNoTracking().FirstOrDefaultAsync(s => s.Id == id);

    public async Task<SaleDto> CreateAsync(SaleInput input)
    {
        Validate(input);
        var sale = new Sale
        {
            SaleNumber = await NumberGenerator.NextAsync(db.Sales.Select(s => s.SaleNumber), "V", input.SaleDate.Year)
        };
        ApplyHeader(sale, input);
        await ApplyLinesAsync(sale, input.Items, new Dictionary<int, decimal>());
        Recalculate(sale);

        db.Sales.Add(sale);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(sale.Id))!;
    }

    public async Task<SaleDto> UpdateAsync(int id, SaleInput input)
    {
        Validate(input);
        var sale = await WithDetails().FirstOrDefaultAsync(s => s.Id == id)
                   ?? throw BusinessException.NotFound("Vente introuvable.");

        if (sale.Refunds.Count > 0)
        {
            // Les articles sont figés dès qu'un remboursement existe (les retours s'y rapportent).
            var same = sale.Items.Count == input.Items.Count
                       && sale.Items.OrderBy(i => i.Id).Zip(input.Items).All(pair =>
                           pair.First.InventoryItemId == pair.Second.InventoryItemId
                           && pair.First.Quantity == pair.Second.Quantity
                           && pair.First.SalePrice == Math.Round(pair.Second.SalePrice, 6));
            if (!same)
                throw BusinessException.Conflict("Cette vente a des remboursements : supprimez-les avant de modifier les articles.");
            ApplyHeader(sale, input);
            Recalculate(sale);
            await db.SaveChangesAsync();
            return (await GetByIdAsync(id))!;
        }

        // On conserve le coût unitaire historique des articles déjà présents dans la vente.
        var previousCosts = sale.Items
            .GroupBy(i => i.InventoryItemId)
            .ToDictionary(g => g.Key, g => g.First().UnitCost);

        // 1. On remet en stock les quantités de l'ancienne version de la vente...
        foreach (var line in sale.Items) line.InventoryItem.RemainingQuantity += line.Quantity;
        db.SaleItems.RemoveRange(sale.Items);
        sale.Items.Clear();

        // 2. ...puis on applique la nouvelle version (avec contrôle du stock).
        ApplyHeader(sale, input);
        await ApplyLinesAsync(sale, input.Items, previousCosts);
        Recalculate(sale);

        await db.SaveChangesAsync();
        return (await GetByIdAsync(id))!;
    }

    /// <summary>Supprime la vente et remet en stock les articles qui n'y sont pas déjà revenus.</summary>
    public async Task DeleteAsync(int id)
    {
        var sale = await WithDetails().FirstOrDefaultAsync(s => s.Id == id)
                   ?? throw BusinessException.NotFound("Vente introuvable.");
        if (sale.InvoiceNumber is not null)
            throw BusinessException.Conflict($"Une facture ({sale.InvoiceNumber}) a été émise pour cette vente : enregistrez plutôt un remboursement.");

        foreach (var line in sale.Items)
            line.InventoryItem.RemainingQuantity += line.Quantity - RestockedQuantity(sale, line.Id);
        db.Sales.Remove(sale);
        await db.SaveChangesAsync();
        await attachments.DeleteForOwnerAsync(AttachmentOwner.Sale, id);
    }

    // ---------------------------------------------------------------
    // Remboursements
    // ---------------------------------------------------------------

    /// <summary>
    /// Enregistre un remboursement total ou partiel. Les articles retournés peuvent être remis en stock.
    /// Le montant remboursé sera déduit du CA de la période du remboursement.
    /// </summary>
    public async Task<SaleDto> AddRefundAsync(int saleId, RefundInput input)
    {
        var sale = await WithDetails().FirstOrDefaultAsync(s => s.Id == saleId)
                   ?? throw BusinessException.NotFound("Vente introuvable.");

        if (input.Amount < 0) throw new BusinessException("Le montant remboursé ne peut pas être négatif.");
        if (input.RefundDate.Date < sale.SaleDate)
            throw new BusinessException("La date du remboursement ne peut pas précéder la date de la vente.");
        var amount = Math.Round(input.Amount, 2);
        if (sale.RefundedAmount + amount > sale.TotalAmount)
            throw new BusinessException($"Remboursement trop élevé : il reste au maximum {sale.TotalAmount - sale.RefundedAmount:0.00} € à rembourser.");

        var lines = (input.Items ?? new List<RefundLineInput>()).Where(l => l.Quantity > 0).ToList();
        if (amount == 0 && lines.Count == 0)
            throw new BusinessException("Indiquez un montant à rembourser ou des articles retournés.");

        var refund = new SaleRefund
        {
            RefundDate = input.RefundDate.Date,
            Amount = amount,
            Reason = string.IsNullOrWhiteSpace(input.Reason) ? null : input.Reason.Trim()
        };

        foreach (var line in lines)
        {
            var saleItem = sale.Items.FirstOrDefault(i => i.Id == line.SaleItemId)
                           ?? throw BusinessException.NotFound("Ligne de vente introuvable.");
            var alreadyReturned = sale.ReturnedQuantity(saleItem.Id)
                                  + refund.Items.Where(i => i.SaleItemId == saleItem.Id).Sum(i => i.Quantity);
            if (line.Quantity > saleItem.Quantity - alreadyReturned)
                throw new BusinessException($"« {saleItem.InventoryItem.Name} » : {saleItem.Quantity - alreadyReturned} unité(s) au maximum peuvent être retournées.");

            if (input.Restock) saleItem.InventoryItem.RemainingQuantity += line.Quantity;
            refund.Items.Add(new SaleRefundItem { SaleItem = saleItem, SaleItemId = saleItem.Id, Quantity = line.Quantity, Restocked = input.Restock });
        }

        sale.Refunds.Add(refund);
        Recalculate(sale);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(saleId))!;
    }

    /// <summary>Annule un remboursement : les articles remis en stock en sont retirés.</summary>
    public async Task<SaleDto> DeleteRefundAsync(int saleId, int refundId)
    {
        var sale = await WithDetails().FirstOrDefaultAsync(s => s.Id == saleId)
                   ?? throw BusinessException.NotFound("Vente introuvable.");
        var refund = sale.Refunds.FirstOrDefault(r => r.Id == refundId)
                     ?? throw BusinessException.NotFound("Remboursement introuvable.");

        foreach (var item in refund.Items.Where(i => i.Restocked))
        {
            var stock = sale.Items.First(i => i.Id == item.SaleItemId).InventoryItem;
            if (stock.RemainingQuantity < item.Quantity)
                throw BusinessException.Conflict($"« {stock.Name} » a déjà été revendu : impossible d'annuler ce retour.");
            stock.RemainingQuantity -= item.Quantity;
        }

        sale.Refunds.Remove(refund);
        db.SaleRefunds.Remove(refund);
        Recalculate(sale);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(saleId))!;
    }

    // ---------------------------------------------------------------
    // Facture
    // ---------------------------------------------------------------

    /// <summary>
    /// Attribue un numéro de facture (F{année}{séquence}) à la vente s'il n'en a pas encore.
    /// La numérotation est chronologique et continue ; un numéro attribué n'est jamais réutilisé.
    /// </summary>
    public async Task<SaleDto> IssueInvoiceAsync(int saleId)
    {
        var sale = await db.Sales.FirstOrDefaultAsync(s => s.Id == saleId)
                   ?? throw BusinessException.NotFound("Vente introuvable.");
        if (string.IsNullOrWhiteSpace(sale.Customer))
            throw new BusinessException("Renseignez le nom du client avant d'émettre une facture.");

        if (sale.InvoiceNumber is null)
        {
            var today = DateTime.Today;
            sale.InvoiceNumber = await NumberGenerator.NextAsync(
                db.Sales.Where(s => s.InvoiceNumber != null).Select(s => s.InvoiceNumber!), "F", today.Year);
            sale.InvoiceDate = today;
            await db.SaveChangesAsync();
        }
        return (await GetByIdAsync(saleId))!;
    }

    // ---------------------------------------------------------------

    private static int RestockedQuantity(Sale sale, int saleItemId) =>
        sale.Refunds.SelectMany(r => r.Items).Where(i => i.SaleItemId == saleItemId && i.Restocked).Sum(i => i.Quantity);

    /// <summary>
    /// Total = Σ quantité × prix. Bénéfice = total − remboursements − coût des articles qui ne sont pas
    /// revenus en stock − frais.
    /// </summary>
    private static void Recalculate(Sale sale)
    {
        sale.TotalAmount = Math.Round(sale.Items.Sum(i => i.Quantity * i.SalePrice), 2);
        sale.RefundedAmount = Math.Round(sale.Refunds.Sum(r => r.Amount), 2);
        var cost = sale.Items.Sum(i => (i.Quantity - RestockedQuantity(sale, i.Id)) * i.UnitCost);
        sale.Profit = Math.Round(sale.TotalAmount - sale.RefundedAmount - cost - sale.Fees, 2);
    }

    private static void ApplyHeader(Sale sale, SaleInput input)
    {
        sale.SaleDate = input.SaleDate.Date;
        sale.Customer = Clean(input.Customer);
        sale.Platform = input.Platform;
        sale.PaymentMethod = input.PaymentMethod;
        sale.Fees = Math.Round(input.Fees, 2);
        sale.Comment = Clean(input.Comment);
        sale.AmountPaid = Math.Round(input.AmountPaid, 2);
        sale.TrackingNumber = Clean(input.TrackingNumber);
        sale.CustomerAddress = Clean(input.CustomerAddress);
        sale.CustomerSiren = Clean(input.CustomerSiren);
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private async Task ApplyLinesAsync(Sale sale, List<SaleLineInput> lines, IReadOnlyDictionary<int, decimal> previousCosts)
    {
        var ids = lines.Select(l => l.InventoryItemId).Distinct().ToList();
        // Les articles déjà suivis par EF (cas d'une modification) gardent leur stock remis à jour en mémoire.
        var items = await db.InventoryItems.Where(i => ids.Contains(i.Id)).ToDictionaryAsync(i => i.Id);

        foreach (var line in lines)
        {
            if (!items.TryGetValue(line.InventoryItemId, out var item))
                throw BusinessException.NotFound($"Article #{line.InventoryItemId} introuvable.");
            if (item.RemainingQuantity < line.Quantity)
                throw BusinessException.Conflict($"Stock insuffisant pour « {item.Name} » : {item.RemainingQuantity} disponible(s), {line.Quantity} demandé(s).");

            item.RemainingQuantity -= line.Quantity; // décrémentation automatique du stock
            sale.Items.Add(new SaleItem
            {
                InventoryItem = item,
                InventoryItemId = item.Id,
                Quantity = line.Quantity,
                SalePrice = Math.Round(line.SalePrice, 6),
                UnitCost = previousCosts.TryGetValue(item.Id, out var cost) ? cost : item.PurchasePrice
            });
        }
    }

    private static void Validate(SaleInput input)
    {
        if (input.Items is null || input.Items.Count == 0)
            throw new BusinessException("Une vente doit contenir au moins un article.");
        if (input.Fees < 0) throw new BusinessException("Les frais ne peuvent pas être négatifs.");
        if (input.AmountPaid < 0) throw new BusinessException("Les frais payés par l’acheteur ne peuvent pas être négatifs.");
        foreach (var line in input.Items)
        {
            if (line.Quantity <= 0) throw new BusinessException("Chaque quantité doit être supérieure à 0.");
            if (line.SalePrice < 0) throw new BusinessException("Le prix de vente ne peut pas être négatif.");
        }
    }
}
