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
            i.Item.RemainingQuantity, i.Item.Quantity - i.Item.RemainingQuantity, i.Item.CatalogCardId)).ToList(),
        p.Performance());

    /// <summary>
    /// Rentabilité d'un achat (nécessite Items.Item.SaleItems.Sale avec ses Items et Refunds.Items chargés).
    /// Une vente peut mélanger des articles de plusieurs achats : son encaissement net est réparti entre ses lignes
    /// au prorata du prix de vente, de sorte que la somme sur tous les achats retombe sur le bénéfice global.
    /// </summary>
    public static PurchasePerformanceDto Performance(this Purchase p)
    {
        var totalUnits = p.Items.Sum(i => i.Quantity);
        var fees = p.PlatformFees + p.ShippingFees;
        var sales = new Dictionary<int, (Sale Sale, int Quantity, decimal Net)>();
        var unitsSold = 0;
        var costOfSold = 0m;
        int stockUnits = 0, withoutValue = 0;
        decimal stockValue = 0;

        foreach (var line in p.Items)
        {
            var sold = line.Item.Quantity - line.Item.RemainingQuantity;
            unitsSold += sold;
            costOfSold += sold * line.UnitPrice;
            stockUnits += line.Item.RemainingQuantity;
            if (line.Item.RemainingQuantity > 0)
            {
                if (line.Item.MarketValue is { } mv) stockValue += line.Item.RemainingQuantity * mv;
                else withoutValue += line.Item.RemainingQuantity;
            }

            foreach (var si in line.Item.SaleItems)
            {
                var net = si.Sale.LineNet(si);
                var key = si.Sale.Id;
                var current = sales.TryGetValue(key, out var c) ? c : (Sale: si.Sale, Quantity: 0, Net: 0m);
                sales[key] = (current.Sale, current.Quantity + si.Quantity, current.Net + net);
            }
        }

        // Frais de l'achat répartis sur les unités vendues.
        if (totalUnits > 0) costOfSold += fees * unitsSold / totalUnits;
        costOfSold = Math.Round(costOfSold, 2);
        var recovered = Math.Round(sales.Values.Sum(s => s.Net), 2);
        var balance = recovered - p.TotalAmount;
        // Valeur de marché du stock restant : seulement si au moins une unité restante est estimée.
        decimal? marketValue = stockUnits > withoutValue ? Math.Round(stockValue, 2) : null;

        return new PurchasePerformanceDto(
            unitsSold, stockUnits, recovered, costOfSold, recovered - costOfSold, balance,
            p.TotalAmount > 0 ? Math.Round(recovered / p.TotalAmount * 100, 1) : null,
            Math.Max(0, p.TotalAmount - costOfSold), marketValue, withoutValue,
            marketValue is { } v ? balance + v : null,
            sales.Count > 0 ? sales.Values.Max(s => s.Sale.SaleDate) : null,
            sales.Values.OrderByDescending(s => s.Sale.SaleDate).ThenByDescending(s => s.Sale.Id)
                .Select(s => new PurchaseSaleDto(s.Sale.Id, s.Sale.SaleNumber, s.Sale.SaleDate, s.Quantity, Math.Round(s.Net, 2)))
                .ToList());
    }

    /// <summary>
    /// Encaissement net d'une ligne de vente : part (au prorata du prix) de ce qui reste de la vente
    /// une fois déduits frais, remboursements et envoi, avant coût d'achat des articles.
    /// </summary>
    public static decimal LineNet(this Sale s, SaleItem line)
    {
        var restocked = (int saleItemId) => s.Refunds.SelectMany(r => r.Items)
            .Where(ri => ri.SaleItemId == saleItemId && ri.Restocked).Sum(ri => ri.Quantity);
        // Bénéfice + coût des articles vendus = ce qu'il reste de la vente avant coût d'achat.
        var net = s.Profit + s.Items.Sum(i => (i.Quantity - restocked(i.Id)) * i.UnitCost);
        var gross = s.Items.Sum(i => i.Quantity * i.SalePrice);
        var share = gross > 0
            ? line.Quantity * line.SalePrice / gross
            : (decimal)line.Quantity / Math.Max(1, s.Items.Sum(i => i.Quantity));
        return net * share;
    }

    /// <summary>Quantité retournée pour une ligne de vente (nécessite Refunds.Items chargés).</summary>
    public static int ReturnedQuantity(this Sale s, int saleItemId) =>
        s.Refunds.SelectMany(r => r.Items).Where(ri => ri.SaleItemId == saleItemId).Sum(ri => ri.Quantity);

    public static SaleDto ToDto(this Sale s)
    {
        var net = SaleRevenue(s) - s.RefundedAmount;
        var names = s.Items.ToDictionary(i => i.Id, i => i.InventoryItem.Name);
        return new SaleDto(
            s.Id, s.SaleNumber, s.SaleDate, s.Customer, s.Platform, s.PaymentMethod, s.Fees, s.Comment,
            s.AmountPaid, s.TrackingNumber,
            s.Carrier, s.ShippingCost,
            s.ShippingUsages.OrderBy(u => u.Id).Select(u => new ShippingUsageDto(
                u.Id, u.SupplyId, u.Supply?.SupplyNumber ?? "", u.Supply?.Name ?? "?", u.Supply?.Kind ?? ShippingSupplyKind.Other,
                u.Quantity, u.UnitCost, Math.Round(u.Quantity * u.UnitCost, 2))).ToList(),
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

    /// <summary>Résumé d'une vente : montant net des frais et des remboursements.</summary>
    public static RecentSaleDto ToSummary(this Sale s) =>
        new(s.Id, s.SaleNumber, s.SaleDate, s.Customer, s.Platform,
            s.TotalAmount, SaleRevenue(s) - s.RefundedAmount, s.Profit);

    /// <summary>Marge en pourcentage du chiffre d'affaires.</summary>
    public static decimal Margin(decimal profit, decimal revenue) =>
        revenue > 0 ? Math.Round(profit / revenue * 100, 1) : 0;
    /// <summary>
    /// Chiffre d'affaires d'une vente (avant remboursements) : prix des articles + port payé par l'acheteur.
    /// C'est le montant payé par l'acheteur, AVANT la commission de la plateforme : la commission est une charge
    /// (déduite du bénéfice), elle ne réduit pas le CA déclaré à l'URSSAF.
    /// </summary>
    public static decimal SaleRevenue(Sale sale) => sale.TotalAmount + sale.AmountPaid;
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

    public static ShippingSupplyDto ToDto(this ShippingSupply s) => new(
        s.Id, s.SupplyNumber, s.PurchaseDate, s.Kind, s.Carrier, s.Name,
        s.Quantity, s.RemainingQuantity, s.Quantity - s.RemainingQuantity, s.TotalAmount, s.UnitCost,
        Math.Round(s.RemainingQuantity * s.UnitCost, 2), s.Supplier, s.PaymentMethod, s.Comment);

    public static string Label(this ShippingSupplyKind kind) => kind switch
    {
        ShippingSupplyKind.Stamp => "Timbre",
        ShippingSupplyKind.Label => "Bordereau",
        ShippingSupplyKind.Envelope => "Enveloppe",
        ShippingSupplyKind.Protection => "Protection",
        ShippingSupplyKind.Box => "Carton",
        _ => "Autre"
    };

    public static string Label(this ShippingCarrier carrier) => carrier switch
    {
        ShippingCarrier.LaPoste => "La Poste",
        ShippingCarrier.MondialRelay => "Mondial Relay",
        ShippingCarrier.RelaisColis => "Relais Colis",
        ShippingCarrier.VintedGo => "Vinted Go",
        ShippingCarrier.Ups => "UPS",
        ShippingCarrier.HandDelivery => "Main propre",
        ShippingCarrier.Other => "Autre",
        _ => carrier.ToString()
    };
}
