using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Gestion des achats. Chaque ligne d'achat crée (ou met à jour) un article d'inventaire.
/// </summary>
public class PurchaseService(AppDbContext db, AttachmentService attachments)
{
    private IQueryable<Purchase> WithDetails() =>
        db.Purchases.Include(p => p.Items).ThenInclude(i => i.Item);

    public async Task<List<PurchaseDto>> GetAllAsync(string? search, DateTime? from, DateTime? to)
    {
        var query = WithDetails().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(p => p.PurchaseNumber.Contains(s) || p.Supplier.Contains(s)
                                     || p.Items.Any(i => i.Item.Name.Contains(s)));
        }
        if (from.HasValue) { var f = from.Value.Date; query = query.Where(p => p.PurchaseDate >= f); }
        if (to.HasValue) { var t = to.Value.Date; query = query.Where(p => p.PurchaseDate <= t); }

        var purchases = await query.OrderByDescending(p => p.PurchaseDate).ThenByDescending(p => p.Id).ToListAsync();
        return purchases.Select(p => p.ToDto()).ToList();
    }

    public async Task<PurchaseDto?> GetByIdAsync(int id) =>
        (await WithDetails().AsNoTracking().FirstOrDefaultAsync(p => p.Id == id))?.ToDto();

    public async Task<PurchaseDto> CreateAsync(PurchaseInput input)
    {
        Validate(input);
        // A2026001 pour un achat, C2026001 pour un transfert depuis la collection personnelle :
        // le registre des achats reste lisible et les transferts ne sont pas comptés comme des achats.
        var prefix = input.Source == PurchaseSource.PersonalCollection ? "C" : "A";
        var purchase = new Purchase
        {
            PurchaseNumber = await NumberGenerator.NextAsync(db.Purchases.Select(p => p.PurchaseNumber), prefix, input.PurchaseDate.Year),
            Source = input.Source,
            PurchaseDate = input.PurchaseDate.Date,
            Supplier = SupplierOf(input),
            Platform = PlatformOf(input),
            PlatformFees = FeesOf(input.PlatformFees, input.Source),
            ShippingFees = FeesOf(input.ShippingFees, input.Source),
            PaymentMethod = PaymentOf(input),
            Comment = Clean(input.Comment)
        };

        foreach (var line in input.Items)
            purchase.Items.Add(NewLine(line, purchase.PurchaseDate));

        purchase.TotalAmount = ComputeTotal(purchase);
        db.Purchases.Add(purchase);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(purchase.Id))!;
    }

    public async Task<PurchaseDto> UpdateAsync(int id, PurchaseInput input)
    {
        Validate(input);
        var purchase = await WithDetails().FirstOrDefaultAsync(p => p.Id == id)
                       ?? throw BusinessException.NotFound("Achat introuvable.");

        // La source (achat / collection) est fixée à la création : elle détermine le numéro.
        if (input.Source != purchase.Source)
            throw new BusinessException("On ne peut pas transformer un achat en transfert de collection (ou l'inverse) : créez une nouvelle entrée.");

        purchase.PurchaseDate = input.PurchaseDate.Date;
        purchase.Supplier = SupplierOf(input);
        purchase.Platform = PlatformOf(input);
        purchase.PlatformFees = FeesOf(input.PlatformFees, input.Source);
        purchase.ShippingFees = FeesOf(input.ShippingFees, input.Source);
        purchase.PaymentMethod = PaymentOf(input);
        purchase.Comment = Clean(input.Comment);

        // 1. Lignes supprimées : autorisé seulement si rien n'a été vendu.
        var keptItemIds = input.Items.Where(l => l.ItemId.HasValue).Select(l => l.ItemId!.Value).ToHashSet();
        var removedItemIds = new List<int>();
        foreach (var removed in purchase.Items.Where(pi => !keptItemIds.Contains(pi.ItemId)).ToList())
        {
            if (await db.SaleItems.AnyAsync(s => s.InventoryItemId == removed.ItemId))
                throw BusinessException.Conflict($"Impossible de retirer « {removed.Item.Name} » : cet article a déjà été vendu.");
            purchase.Items.Remove(removed);
            db.PurchaseItems.Remove(removed);
            db.InventoryItems.Remove(removed.Item);
            removedItemIds.Add(removed.ItemId);
        }

        // 2. Lignes modifiées ou ajoutées.
        foreach (var line in input.Items)
        {
            if (line.ItemId is not int itemId)
            {
                purchase.Items.Add(NewLine(line, purchase.PurchaseDate));
                continue;
            }

            var existing = purchase.Items.FirstOrDefault(pi => pi.ItemId == itemId)
                           ?? throw BusinessException.NotFound($"L'article #{itemId} n'appartient pas à cet achat.");
            var sold = existing.Item.Quantity - existing.Item.RemainingQuantity;
            if (line.Quantity < sold)
                throw BusinessException.Conflict($"« {existing.Item.Name} » : {sold} unité(s) déjà vendue(s), la quantité ne peut pas être inférieure.");

            ApplyLine(existing.Item, line, purchase.PurchaseDate);
            existing.Item.RemainingQuantity = line.Quantity - sold;
            existing.Quantity = line.Quantity;
            existing.UnitPrice = Math.Round(line.UnitPrice, 2);
        }

        // Tous les articles de l'achat héritent de la date d'achat.
        foreach (var pi in purchase.Items) pi.Item.PurchaseDate = purchase.PurchaseDate;

        purchase.TotalAmount = ComputeTotal(purchase);
        await db.SaveChangesAsync();
        // Photos et justificatifs des articles retirés.
        if (removedItemIds.Count > 0)
            await attachments.DeleteForOwnerAsync(AttachmentOwner.InventoryItem, removedItemIds.ToArray());
        return (await GetByIdAsync(id))!;
    }

    public async Task DeleteAsync(int id)
    {
        var purchase = await WithDetails().FirstOrDefaultAsync(p => p.Id == id)
                       ?? throw BusinessException.NotFound("Achat introuvable.");

        var itemIds = purchase.Items.Select(i => i.ItemId).ToList();
        if (await db.SaleItems.AnyAsync(s => itemIds.Contains(s.InventoryItemId)))
            throw BusinessException.Conflict("Impossible de supprimer cet achat : certains articles ont déjà été vendus.");

        db.InventoryItems.RemoveRange(purchase.Items.Select(i => i.Item));
        db.Purchases.Remove(purchase);
        await db.SaveChangesAsync();
        await attachments.DeleteForOwnerAsync(AttachmentOwner.Purchase, id);
        await attachments.DeleteForOwnerAsync(AttachmentOwner.InventoryItem, itemIds.ToArray());
    }

    // ---------------------------------------------------------------

    private static PurchaseItem NewLine(PurchaseLineInput line, DateTime purchaseDate)
    {
        var item = new InventoryItem { Quantity = line.Quantity, RemainingQuantity = line.Quantity };
        ApplyLine(item, line, purchaseDate);
        return new PurchaseItem { Item = item, Quantity = line.Quantity, UnitPrice = item.PurchasePrice };
    }

    private static void ApplyLine(InventoryItem item, PurchaseLineInput line, DateTime purchaseDate)
    {
        item.Name = line.Name.Trim();
        item.Category = Clean(line.Category);
        item.Language = Clean(line.Language);
        item.Type = line.Type;
        item.Condition = line.Condition;
        item.Quantity = line.Quantity;
        item.PurchasePrice = Math.Round(line.UnitPrice, 2);
        item.Location = Clean(line.Location);
        item.PurchaseDate = purchaseDate;
    }

    private static decimal ComputeTotal(Purchase p) => Math.Round(
        p.Items.Sum(i => i.Quantity * i.UnitPrice) + p.PlatformFees + p.ShippingFees, 2);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private const string CollectionSupplier = "Collection personnelle";

    /// <summary>Un transfert de collection n'a pas de règlement.</summary>
    private static PaymentMethod? PaymentOf(PurchaseInput input) =>
        input.Source == PurchaseSource.PersonalCollection ? null : input.PaymentMethod;

    private static PurchasePlatform? PlatformOf(PurchaseInput input) =>
        input.Source == PurchaseSource.PersonalCollection ? null : input.Platform;

    private static decimal FeesOf(decimal fees, PurchaseSource source) =>
        source == PurchaseSource.PersonalCollection ? 0 : fees;

    private static string SupplierOf(PurchaseInput input) =>
        string.IsNullOrWhiteSpace(input.Supplier) ? CollectionSupplier : input.Supplier.Trim();

    private static void Validate(PurchaseInput input)
    {
        if (input.Source == PurchaseSource.Supplier && string.IsNullOrWhiteSpace(input.Supplier))
            throw new BusinessException("Le fournisseur est obligatoire.");
        if (input.PlatformFees < 0 || input.ShippingFees < 0)
            throw new BusinessException("Les frais ne peuvent pas être négatifs.");
        if (input.Items is null || input.Items.Count == 0)
            throw new BusinessException("Un achat doit contenir au moins un article.");
        foreach (var line in input.Items)
        {
            if (string.IsNullOrWhiteSpace(line.Name)) throw new BusinessException("Chaque article doit avoir un nom.");
            if (line.Quantity <= 0) throw new BusinessException($"« {line.Name} » : la quantité doit être supérieure à 0.");
            if (line.UnitPrice < 0) throw new BusinessException($"« {line.Name} » : le prix unitaire ne peut pas être négatif.");
        }
    }
}
