using PokeStock.Api.Models;

namespace PokeStock.Api.Dtos;

/// <summary>
/// Période de déclaration URSSAF (mois ou trimestre).
/// Status : "inactive" (avant le début d'activité), "ongoing" (période en cours), "todo" (à déclarer),
/// "late" (échéance dépassée), "declared" (marquée comme déclarée).
/// </summary>
public record TaxPeriodDto(
    string Key, string Label, DateTime Start, DateTime End, DateTime Deadline,
    // Revenue = CA à déclarer (ventes de la période − remboursements de la période).
    int SalesCount, decimal Revenue, decimal Refunds, decimal Profit,
    decimal SocialContributions, decimal TrainingContribution, decimal ChamberTax, decimal LiberatoryIncomeTax,
    decimal Total, bool AcreApplied, string Status);

/// <summary>Ventes par plateforme, pour les seuils de transmission DAC7 (30 ventes ou 2 000 €).</summary>
public record PlatformTaxReportDto(SalePlatform Platform, int SalesCount, decimal Revenue, bool Dac7Reported);

public record TaxSummaryDto(
    int Year, List<int> AvailableYears, TaxSettings Settings,
    decimal Revenue, decimal Profit, decimal CollectionRevenue,
    decimal SocialContributions, decimal TrainingContribution, decimal ChamberTax, decimal LiberatoryIncomeTax,
    decimal UrssafTotal, decimal CfeAmount, decimal EstimatedIncomeTax, decimal TaxableIncome,
    decimal TotalCharges, decimal NetIncome,
    decimal EffectiveRateOnRevenue, decimal EffectiveRateOnProfit,
    decimal ProjectedRevenue, decimal SetAsideRate,
    TaxPeriodDto? NextDeclaration, List<TaxPeriodDto> Periods, List<PlatformTaxReportDto> Platforms);

public record DeclarationStatusInput(bool Declared);
