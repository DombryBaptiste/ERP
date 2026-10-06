namespace PokeStock.Api.Models;

/// <summary>Informations de l'entreprise imprimées sur les factures (onglet Paramètres).</summary>
public class CompanyInfo
{
    /// <summary>Prénom et nom de l'entrepreneur (obligatoire, suivi de la mention « EI »).</summary>
    public string FullName { get; set; } = string.Empty;
    /// <summary>Nom commercial facultatif (ex. « PokéShop 59 »).</summary>
    public string? TradeName { get; set; }
    public string? Siret { get; set; }
    /// <summary>Adresse complète, sur plusieurs lignes.</summary>
    public string? Address { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    /// <summary>IBAN affiché sur les factures pour un paiement par virement (facultatif).</summary>
    public string? Iban { get; set; }
    /// <summary>Mention de TVA : franchise en base.</summary>
    public string VatMention { get; set; } = "TVA non applicable, art. 293 B du CGI";
    /// <summary>Texte libre en bas de facture (remerciements, conditions...).</summary>
    public string? InvoiceFooter { get; set; } = "Merci pour votre achat !";
}

/// <summary>Seuils des alertes (stock dormant, valeur de marché).</summary>
public class AlertSettings
{
    /// <summary>Au-delà : « à baisser » (3 mois par défaut).</summary>
    public int DormantWarningDays { get; set; } = 90;
    /// <summary>Au-delà : « à liquider » (6 mois par défaut).</summary>
    public int DormantCriticalDays { get; set; } = 180;
    /// <summary>Alerte quand la valeur de marché dépasse le prix d'achat de ce pourcentage.</summary>
    public decimal MarketGainThreshold { get; set; } = 30m;
    /// <summary>Alerte quand l'estimation augmente de ce pourcentage depuis la précédente.</summary>
    public decimal MarketRiseThreshold { get; set; } = 15m;
}

/// <summary>Préférences de l'application.</summary>
public class AppPreferences
{
    public CompanyInfo Company { get; set; } = new();
    public AlertSettings Alerts { get; set; } = new();
    public List<CardSeriesEntry> CardSeries { get; set; } = [];
}

/// <summary>Série Pokémon disponible pour une langue dans les achats de cartes.</summary>
public class CardSeriesEntry
{
    public string Language { get; set; } = string.Empty;
    public string Series { get; set; } = string.Empty;
}
