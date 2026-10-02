using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>Gestion de l'inventaire (articles en stock).</summary>
public class InventoryService(AppDbContext db, AttachmentService attachments)
{
    private IQueryable<InventoryItem> WithPurchase() =>
        db.InventoryItems.Include(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase);

    /// <param name="status">"instock" = encore en stock, "sold" = entièrement vendu, sinon tout.</param>
    public async Task<List<InventoryItemDto>> GetAllAsync(
        string? search, string? category, ItemType? type, ItemCondition? condition, string? status)
    {
        var query = WithPurchase().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim();
            query = query.Where(i => i.Name.Contains(s)
                                     || (i.Category != null && i.Category.Contains(s))
                                     || (i.Location != null && i.Location.Contains(s)));
        }
        if (!string.IsNullOrWhiteSpace(category)) query = query.Where(i => i.Category == category);
        if (type.HasValue) query = query.Where(i => i.Type == type.Value);
        if (condition.HasValue) query = query.Where(i => i.Condition == condition.Value);
        query = status switch
        {
            "instock" => query.Where(i => i.RemainingQuantity > 0),
            "sold" => query.Where(i => i.RemainingQuantity == 0),
            _ => query
        };

        var items = await query.OrderByDescending(i => i.PurchaseDate).ThenByDescending(i => i.Id).ToListAsync();
        var photos = await attachments.FirstPhotoIdsAsync(items.Select(i => i.Id));
        return items.Select(i => i.ToDto(photos.TryGetValue(i.Id, out var photo) ? photo : null)).ToList();
    }

    public async Task<InventoryItemDto?> GetByIdAsync(int id)
    {
        var item = await WithPurchase().AsNoTracking().FirstOrDefaultAsync(i => i.Id == id);
        if (item is null) return null;
        var photos = await attachments.FirstPhotoIdsAsync(new[] { id });
        return item.ToDto(photos.TryGetValue(id, out var photo) ? photo : null);
    }

    /// <summary>
    /// Met à jour la valeur de marché estimée. L'ancienne valeur est conservée pour détecter une hausse.
    /// </summary>
    public async Task<InventoryItemDto> SetMarketValueAsync(int id, decimal? value)
    {
        if (value < 0) throw new BusinessException("La valeur de marché ne peut pas être négative.");
        var item = await db.InventoryItems.FirstOrDefaultAsync(i => i.Id == id)
                   ?? throw BusinessException.NotFound("Article introuvable.");
        ApplyMarketValue(item, value);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(id))!;
    }

    private static void ApplyMarketValue(InventoryItem item, decimal? value)
    {
        if (value < 0) throw new BusinessException("La valeur de marché ne peut pas être négative.");
        var rounded = value.HasValue ? Math.Round(value.Value, 2) : (decimal?)null;
        if (rounded == item.MarketValue) return;
        item.PreviousMarketValue = item.MarketValue;
        item.MarketValue = rounded;
        item.MarketValueUpdatedAt = rounded.HasValue ? DateTime.UtcNow : null;
    }

    /// <summary>Liste des catégories déjà utilisées (pour l'autocomplétion).</summary>
    public Task<List<string>> GetCategoriesAsync() =>
        db.InventoryItems.Where(i => i.Category != null && i.Category != "")
            .Select(i => i.Category!).Distinct().OrderBy(c => c).ToListAsync();

    /// <summary>Ajout manuel d'un article sans achat associé (ex. carte de collection personnelle).</summary>
    public async Task<InventoryItemDto> CreateAsync(InventoryItemInput input)
    {
        Validate(input);
        var item = new InventoryItem { RemainingQuantity = input.Quantity };
        Apply(item, input);
        ApplyMarketValue(item, input.MarketValue);
        db.InventoryItems.Add(item);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(item.Id))!;
    }

    public async Task<InventoryItemDto> UpdateAsync(int id, InventoryItemInput input)
    {
        Validate(input);
        var item = await db.InventoryItems
                       .Include(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase).ThenInclude(p => p.Items)
                       .FirstOrDefaultAsync(i => i.Id == id)
                   ?? throw BusinessException.NotFound("Article introuvable.");

        var sold = item.Quantity - item.RemainingQuantity;
        if (input.Quantity < sold)
            throw BusinessException.Conflict($"{sold} unité(s) déjà vendue(s) : la quantité ne peut pas être inférieure.");

        Apply(item, input);
        ApplyMarketValue(item, input.MarketValue);
        item.RemainingQuantity = input.Quantity - sold;

        // Article issu d'un achat : on garde l'achat cohérent (quantité, prix, total, date).
        if (item.PurchaseItem is { } pi)
        {
            pi.Quantity = item.Quantity;
            pi.UnitPrice = item.PurchasePrice;
            item.PurchaseDate = pi.Purchase.PurchaseDate;
            pi.Purchase.TotalAmount = Math.Round(
                pi.Purchase.Items.Sum(x => x.Quantity * x.UnitPrice) + pi.Purchase.PlatformFees + pi.Purchase.ShippingFees, 2);
        }

        await db.SaveChangesAsync();
        return (await GetByIdAsync(id))!;
    }

    public async Task DeleteAsync(int id)
    {
        var item = await db.InventoryItems
                       .Include(i => i.PurchaseItem).ThenInclude(pi => pi!.Purchase).ThenInclude(p => p.Items)
                       .FirstOrDefaultAsync(i => i.Id == id)
                   ?? throw BusinessException.NotFound("Article introuvable.");

        if (await db.SaleItems.AnyAsync(s => s.InventoryItemId == id))
            throw BusinessException.Conflict("Cet article figure dans des ventes : modifiez ou supprimez d'abord ces ventes.");

        if (item.PurchaseItem is { } pi)
        {
            pi.Purchase.Items.Remove(pi);
            db.PurchaseItems.Remove(pi);
            pi.Purchase.TotalAmount = Math.Round(
                pi.Purchase.Items.Sum(x => x.Quantity * x.UnitPrice) + pi.Purchase.PlatformFees + pi.Purchase.ShippingFees, 2);
        }

        db.InventoryItems.Remove(item);
        await db.SaveChangesAsync();
        await attachments.DeleteForOwnerAsync(AttachmentOwner.InventoryItem, id);
    }

    // ---------------------------------------------------------------

    private static void Apply(InventoryItem item, InventoryItemInput input)
    {
        item.Name = input.Name.Trim();
        item.Category = string.IsNullOrWhiteSpace(input.Category) ? null : input.Category.Trim();
        item.Type = input.Type;
        item.Condition = input.Condition;
        item.PurchasePrice = Math.Round(input.PurchasePrice, 2);
        item.Quantity = input.Quantity;
        item.Location = string.IsNullOrWhiteSpace(input.Location) ? null : input.Location.Trim();
        item.PurchaseDate = input.PurchaseDate.Date;
    }

    private static void Validate(InventoryItemInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name)) throw new BusinessException("Le nom est obligatoire.");
        if (input.Quantity <= 0) throw new BusinessException("La quantité doit être supérieure à 0.");
        if (input.PurchasePrice < 0) throw new BusinessException("Le prix d'achat ne peut pas être négatif.");
    }
}
