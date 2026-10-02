namespace PokeStock.Api.Models;

/// <summary>Type d'article. Stocké en texte dans la base (ex. "GradedCard").</summary>
public enum ItemType
{
    RawCard,     // Carte brute
    GradedCard,  // Carte gradée (PSA, PCA, CGC...)
    Booster,
    Blister,
    Etb,         // Elite Trainer Box
    Box,         // Coffret
    Display,
    MiniTin,
    Bundle,
    Other        // Autre
}

/// <summary>État de l'article.</summary>
public enum ItemCondition
{
    New,        // Neuf
    Excellent,
    VeryGood,   // Très bon
    Good,       // Bon
    Fair        // Moyen
}

/// <summary>Plateforme de vente.</summary>
public enum SalePlatform
{
    Cardmarket,
    Ebay,
    Vinted,
    Leboncoin,
    FacebookMarketplace,
    InPerson,   // Main propre
    Other
}

/// <summary>Origine d'une entrée en stock.</summary>
public enum PurchaseSource
{
    /// <summary>Achat classique auprès d'un fournisseur (particulier, magasin, grossiste...).</summary>
    Supplier,
    /// <summary>
    /// Transfert depuis la collection personnelle vers le stock professionnel (pas de prix d'achat réel).
    /// Les ventes de ces articles font partie du CA de la micro-entreprise.
    /// </summary>
    PersonalCollection
}

/// <summary>Plateforme sur laquelle un achat a été effectué.</summary>
public enum PurchasePlatform
{
    Cardmarket,
    Ebay,
    Vinted,
    Leboncoin,
    FacebookMarketplace,
    Amazon,
    Store,
    Other
}

/// <summary>Origine d'un article de l'inventaire, déduite de son achat.</summary>
public enum ItemOrigin
{
    Purchase,
    PersonalCollection,
    Manual
}

/// <summary>Mode de règlement (livre des recettes et registre des achats).</summary>
public enum PaymentMethod
{
    Platform,      // Paiement via la plateforme (Cardmarket, eBay, Vinted...)
    BankTransfer,  // Virement
    PayPal,
    Card,          // Carte bancaire
    Cash,          // Espèces
    Check,         // Chèque
    Other
}

/// <summary>Élément auquel un fichier est rattaché.</summary>
public enum AttachmentOwner
{
    InventoryItem,
    Purchase,
    Sale
}

/// <summary>Nature d'un fichier joint.</summary>
public enum AttachmentKind
{
    Photo,        // Photo de la carte / du produit
    Receipt,      // Ticket ou facture d'achat
    Listing,      // Capture de l'annonce, conversation
    OriginProof,  // Preuve d'origine (collection personnelle)
    Other
}

public static class ItemTypeExtensions
{
    /// <summary>Vrai pour les cartes (brutes ou gradées), faux pour les produits scellés.</summary>
    public static bool IsCard(this ItemType type) => type is ItemType.RawCard or ItemType.GradedCard;
}
