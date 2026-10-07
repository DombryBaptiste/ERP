using PokeStock.Api.Models;

namespace PokeStock.Api.Dtos;

/// <summary>Conversion des entités en DTO renvoyés par l'API.</summary>
public static class Mappings
{
    /// <param name="photoId">Identifiant de la première photo de l'article, s'il y en a une.</param>
    public static InventoryItemDto ToDto(this InventoryItem i, int? photoId = null) => new(
        i.Id, i.Name, i.Category, i.Language, i.Type, i.Condition,
        i.PurchasePrice, i.Quantity, i.RemainingQuantity, i.Quantity - i.RemainingQuantity,
        i.RemainingQuantity * i.PurchasePrice, i.Location, i.PurchaseDate,
        i.PurchaseItem?.PurchaseId, i.PurchaseItem?.Purchase?.PurchaseNumber, i.Origin(),
        i.MarketValue, i.PreviousMarketValue, i.MarketValueUpdatedAt,
        i.MarketValue is { } mv ? i.RemainingQuantity * (mv - i.PurchasePrice) : null,
        Math.Max(0, (DateTime.Today - i.PurchaseDate.Date).Days), photoId, i.IsListedOnCardmarket);

    /// <summary>Origine d'un article (nécessite PurchaseItem.Purchase chargé).</summary>
    public static ItemOrigin Origin(this InventoryItem i) => i.PurchaseItem?.Purchase switch
    {
        null => ItemOrigin.Manual,
        { Source: PurchaseSource.PersonalCollection } => ItemOrigin.PersonalCollection,
        _ => ItemOrigin.Purchase
    };

    public static PurchaseDto ToDto(this Purchase p) => new(
        p.Id, p.PurchaseNumber, p.Source, p.PurchaseDate, p.Supplier, p.Platform, p.PaymentMethod, p.Comment,
        p.PlatformFees, p.ShippingFees, p.TrackingNumber, p.TotalAmount,
        p.Items.Sum(i => i.Quantity),
        p.Items.OrderBy(i => i.Id).Select(i => new PurchaseLineDto(
            i.Id, i.ItemId, i.Item.Name, i.Item.Category, i.Item.Language, i.Item.Type, i.Item.Condition,
            i.Quantity, i.UnitPrice, i.Quantity * i.UnitPrice, i.Item.Location,
            i.Item.RemainingQuantity, i.Item.Quantity - i.Item.RemainingQuantity)).ToList());

    /// <summary>Quantité retournée pour une ligne de vente (nécessite Refunds.Items chargés).</summary>
    public static int ReturnedQuantity(this Sale s, int saleItemId) =>
        s.Refunds.SelectMany(r => r.Items).Where(ri => ri.SaleItemId == saleItemId).Sum(ri => ri.Quantity);

    public static SaleDto ToDto(this Sale s)
    {
        var net = s.TotalAmount - s.RefundedAmount;
        var names = s.Items.ToDictionary(i => i.Id, i => i.InventoryItem.Name);
        return new SaleDto(
            s.Id, s.SaleNumber, s.SaleDate, s.Customer, s.Platform, s.PaymentMethod, s.Fees, s.Comment,
            s.AmountPaid, s.TrackingNumber,
            s.TotalAmount, s.RefundedAmount, net, s.Profit, Margin(s.Profit, net),
            s.CustomerAddress, s.CustomerSiren, s.InvoiceNumber, s.InvoiceDate,
            s.Items.OrderBy(i => i.Id).Select(i => new SaleLineDto(
                i.Id, i.InventoryItemId, i.InventoryItem.Name, i.InventoryItem.Type, i.Quantity,
                i.SalePrice, i.UnitCost, i.Quantity * i.SalePrice, i.Quantity * (i.SalePrice - i.UnitCost),
                s.ReturnedQuantity(i.Id))).ToList(),
            s.Refunds.OrderBy(r => r.RefundDate).ThenBy(r => r.Id).Select(r => new SaleRefundDto(
                r.Id, r.RefundDate, r.Amount, r.Reason,
                r.Items.Select(ri => new SaleRefundItemDto(
                    ri.SaleItemId, names.GetValueOrDefault(ri.SaleItemId, "?"), ri.Quantity, ri.Restocked)).ToList())).ToList());
    }

    /// <summary>Résumé d'une vente : montants nets des remboursements.</summary>
    public static RecentSaleDto ToSummary(this Sale s) =>
        new(s.Id, s.SaleNumber, s.SaleDate, s.Customer, s.Platform, s.TotalAmount - s.RefundedAmount, s.Profit);

    /// <summary>Marge en pourcentage du chiffre d'affaires.</summary>
    public static decimal Margin(decimal profit, decimal revenue) =>
        revenue > 0 ? Math.Round(profit / revenue * 100, 1) : 0;

    public static string Label(this PaymentMethod method) => method switch
    {
        PaymentMethod.Platform => "Plateforme",
        PaymentMethod.BankTransfer => "Virement",
        PaymentMethod.PayPal => "PayPal",
        PaymentMethod.Card => "Carte bancaire",
        PaymentMethod.Cash => "Espèces",
        PaymentMethod.Check => "Chèque",
        _ => "Autre"
    };

    public static string Label(this SalePlatform platform) => platform switch
    {
        SalePlatform.Ebay => "eBay",
        SalePlatform.FacebookMarketplace => "Marketplace Facebook",
        SalePlatform.InPerson => "Main propre",
        SalePlatform.Other => "Autre",
        _ => platform.ToString()
    };
}
