namespace PokeStock.Api.Models;

/// <summary>Catégorie d'activité de la micro-entreprise (détermine les taux par défaut).</summary>
public enum MicroActivity
{
    Sales,        // Achat-revente / vente de marchandises (BIC) — cas de PokéStock
    ServicesBic,  // Prestations de services commerciales ou artisanales (BIC)
    Bnc           // Professions libérales non réglementées (BNC)
}

public enum DeclarationFrequency
{
    Monthly,
    Quarterly
}

/// <summary>
/// Paramètres fiscaux et sociaux, modifiables dans l'onglet Fiscalité.
/// Les taux sont en pourcentage (12.3 = 12,3 %). Valeurs par défaut : barème 2026, vente de marchandises.
/// Stocké en JSON dans app_settings (clé "tax.settings").
/// </summary>
public class TaxSettings
{
    public MicroActivity Activity { get; set; } = MicroActivity.Sales;
    /// <summary>Date de début d'activité (sert à l'exonération de CFE la 1re année).</summary>
    public DateTime? CreationDate { get; set; }
    public DeclarationFrequency Frequency { get; set; } = DeclarationFrequency.Quarterly;

    // --- Cotisations prélevées par l'URSSAF, en % du chiffre d'affaires encaissé ---
    /// <summary>Cotisations sociales (12,3 % en vente de marchandises en 2026).</summary>
    public decimal SocialRate { get; set; } = 12.3m;
    /// <summary>Contribution à la formation professionnelle (0,1 % pour les commerçants).</summary>
    public decimal TrainingRate { get; set; } = 0.1m;
    /// <summary>Taxe pour frais de chambre consulaire (CCI : 0,015 % pour les commerçants).</summary>
    public decimal ChamberTaxRate { get; set; } = 0.015m;

    // --- Impôt sur le revenu ---
    /// <summary>Option pour le versement libératoire : l'impôt est payé avec les cotisations.</summary>
    public bool LiberatoryIncomeTax { get; set; }
    /// <summary>Taux du versement libératoire (1 % en vente de marchandises).</summary>
    public decimal LiberatoryIncomeTaxRate { get; set; } = 1m;
    /// <summary>Abattement forfaitaire pour frais appliqué au CA si pas de versement libératoire (71 % en vente).</summary>
    public decimal FlatAllowanceRate { get; set; } = 71m;
    /// <summary>Tranche marginale d'imposition du foyer, pour estimer l'impôt au barème (0, 11, 30, 41, 45).</summary>
    public decimal MarginalTaxRate { get; set; } = 11m;

    // --- ACRE (aide à la création) ---
    public bool AcreEnabled { get; set; }
    /// <summary>Réduction des cotisations sociales : 50 % (création avant le 01/07/2026) ou 25 % (après).</summary>
    public decimal AcreReductionRate { get; set; } = 25m;
    public DateTime? AcreStart { get; set; }
    public DateTime? AcreEnd { get; set; }

    // --- Seuils annuels ---
    /// <summary>Plafond de CA du régime micro (203 100 € en vente pour 2026-2028).</summary>
    public decimal RevenueCeiling { get; set; } = 203_100m;
    /// <summary>Seuil de franchise en base de TVA (85 000 € en vente).</summary>
    public decimal VatThreshold { get; set; } = 85_000m;
    /// <summary>Seuil majoré de TVA : au-delà, TVA due immédiatement (93 500 € en vente).</summary>
    public decimal VatThresholdIncreased { get; set; } = 93_500m;

    // --- Autres ---
    /// <summary>Montant annuel de CFE (avis d'imposition reçu en novembre). 0 si exonéré.</summary>
    public decimal CfeAnnualAmount { get; set; }
    /// <summary>Marge de sécurité ajoutée au pourcentage conseillé à mettre de côté.</summary>
    public decimal SafetyMarginRate { get; set; } = 2m;
}
