using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PokeStock.Api.Data;
using PokeStock.Api.Dtos;
using PokeStock.Api.Models;

namespace PokeStock.Api.Services;

/// <summary>
/// Fiscalité micro-entreprise : paramètres, calcul des cotisations URSSAF par période de déclaration,
/// estimation de l'impôt, seuils et suivi des déclarations.
/// Toutes les cotisations d'une micro-entreprise se calculent sur le chiffre d'affaires ENCAISSÉ,
/// pas sur le bénéfice : ici, le CA d'une période = total des ventes datées dans la période.
/// </summary>
public class TaxService(AppDbContext db, SettingsStore store)
{
    private const string SettingsKey = "tax.settings";
    private const string DeclaredKey = "tax.declared";
    /// <summary>Seuils DAC7 : les plateformes transmettent vos ventes au fisc au-delà.</summary>
    private const int Dac7SalesThreshold = 30;
    private const decimal Dac7RevenueThreshold = 2000m;
    /// <summary>Abattement minimum pour le calcul de l'impôt au barème.</summary>
    private const decimal MinimumAllowance = 305m;


    // ---------------------------------------------------------------
    // Paramètres
    // ---------------------------------------------------------------

    public async Task<TaxSettings> GetSettingsAsync() =>
        await store.ReadAsync<TaxSettings>(SettingsKey) ?? new TaxSettings();

    public async Task<TaxSettings> SaveSettingsAsync(TaxSettings settings)
    {
        Validate(settings);
        await store.WriteAsync(SettingsKey, settings);
        return settings;
    }

    /// <summary>Marque une période (ex. "2026-T3" ou "2026-M09") comme déclarée à l'URSSAF, ou non.</summary>
    public async Task SetDeclaredAsync(string periodKey, bool declared)
    {
        var set = await store.ReadAsync<HashSet<string>>(DeclaredKey) ?? new HashSet<string>();
        if (declared) set.Add(periodKey); else set.Remove(periodKey);
        await store.WriteAsync(DeclaredKey, set.OrderBy(k => k).ToList());
    }

    // ---------------------------------------------------------------
    // Synthèse annuelle
    // ---------------------------------------------------------------

    public async Task<TaxSummaryDto> GetSummaryAsync(int? requestedYear)
    {
        var settings = await GetSettingsAsync();
        var declared = await store.ReadAsync<HashSet<string>>(DeclaredKey) ?? new HashSet<string>();
        var today = DateTime.Today;
        var year = requestedYear ?? today.Year;
        var start = new DateTime(year, 1, 1);
        var end = start.AddYears(1);

        var sales = await db.Sales.AsNoTracking()
            .Where(s => s.SaleDate >= start && s.SaleDate < end)
            .Select(s => new
            {
                s.SaleDate,
                NetAmount = s.TotalAmount - s.Fees + s.AmountPaid,
                s.Profit,
                s.Platform
            })
            .ToListAsync();

        // Remboursements : déduits du CA de la période où ils ont lieu (date du remboursement).
        var refunds = await db.SaleRefunds.AsNoTracking()
            .Where(r => r.RefundDate >= start && r.RefundDate < end)
            .Select(r => new { r.RefundDate, r.Amount })
            .ToListAsync();

        // Part du CA venant d'articles transférés depuis la collection personnelle (inclus dans le CA à déclarer).
        var collectionRevenue = await db.SaleItems.AsNoTracking()
            .Where(si => si.Sale.SaleDate >= start && si.Sale.SaleDate < end
                         && si.InventoryItem.PurchaseItem != null
                         && si.InventoryItem.PurchaseItem.Purchase.Source == PurchaseSource.PersonalCollection)
            .SumAsync(si => (decimal?)(si.Quantity * si.SalePrice)) ?? 0m;

        var saleYears = await db.Sales.Select(s => s.SaleDate.Year).Distinct().ToListAsync();
        var years = saleYears.Append(today.Year).Append(year).Distinct().OrderByDescending(y => y).ToList();

        // --- Périodes de déclaration ---
        var periods = BuildPeriods(year, settings.Frequency).Select(p =>
        {
            var inPeriod = sales.Where(s => s.SaleDate >= p.Start && s.SaleDate <= p.End).ToList();
            var refundsInPeriod = refunds.Where(r => r.RefundDate >= p.Start && r.RefundDate <= p.End).ToList();
            var refunded = refundsInPeriod.Sum(r => r.Amount);
            var revenue = inPeriod.Sum(s => s.NetAmount) - refunded;
            // L'ACRE réduit uniquement les cotisations sociales, vente par vente selon sa date.
            var social = inPeriod.Sum(s => s.NetAmount * SocialRateAt(settings, s.SaleDate) / 100m)
                         - refundsInPeriod.Sum(r => r.Amount * SocialRateAt(settings, r.RefundDate) / 100m);
            // Un CA net négatif ne génère pas de cotisations (le solde s'impute sur la période suivante).
            var basis = Math.Max(0, revenue);
            social = Math.Max(0, social);
            var training = basis * settings.TrainingRate / 100m;
            var chamber = basis * settings.ChamberTaxRate / 100m;
            var incomeTax = settings.LiberatoryIncomeTax ? basis * settings.LiberatoryIncomeTaxRate / 100m : 0m;
            var acre = inPeriod.Any(s => IsAcre(settings, s.SaleDate))
                       || (inPeriod.Count == 0 && IsAcre(settings, p.Start));

            return new TaxPeriodDto(
                p.Key, p.Label, p.Start, p.End, p.Deadline,
                inPeriod.Count, revenue, refunded, inPeriod.Sum(s => s.Profit),
                Round(social), Round(training), Round(chamber), Round(incomeTax),
                Round(social) + Round(training) + Round(chamber) + Round(incomeTax),
                acre, StatusOf(p, settings, declared, today));
        }).ToList();

        // --- Totaux annuels ---
        var yearRevenue = periods.Sum(p => p.Revenue);
        var yearProfit = periods.Sum(p => p.Profit);
        var urssafTotal = periods.Sum(p => p.Total);

        // CFE : exonérée l'année civile de création.
        var cfe = settings.CreationDate is { } created && created.Year >= year ? 0m : settings.CfeAnnualAmount;

        // Impôt au barème (sans versement libératoire) : CA - abattement forfaitaire, × tranche marginale.
        var taxableIncome = 0m;
        var estimatedIncomeTax = 0m;
        if (!settings.LiberatoryIncomeTax)
        {
            var allowance = Math.Max(yearRevenue * settings.FlatAllowanceRate / 100m, Math.Min(MinimumAllowance, yearRevenue));
            taxableIncome = Round(Math.Max(0, yearRevenue - allowance));
            estimatedIncomeTax = Round(taxableIncome * settings.MarginalTaxRate / 100m);
        }

        var totalCharges = urssafTotal + cfe + estimatedIncomeTax;

        // Projection sur l'année entière (année en cours uniquement).
        var projected = yearRevenue;
        if (year == today.Year)
        {
            var elapsed = (today - start).TotalDays + 1;
            var total = (end - start).TotalDays;
            projected = elapsed > 0 ? Round(yearRevenue * (decimal)(total / elapsed)) : yearRevenue;
        }

        // Pourcentage conseillé à mettre de côté sur chaque vente.
        var setAside = settings.SocialRate + settings.TrainingRate + settings.ChamberTaxRate
                       + (settings.LiberatoryIncomeTax
                           ? settings.LiberatoryIncomeTaxRate
                           : (100m - settings.FlatAllowanceRate) * settings.MarginalTaxRate / 100m)
                       + settings.SafetyMarginRate;

        var platforms = sales.GroupBy(s => s.Platform)
            .Select(g => new PlatformTaxReportDto(g.Key, g.Count(), g.Sum(s => s.NetAmount),
                g.Count() >= Dac7SalesThreshold || g.Sum(s => s.NetAmount) >= Dac7RevenueThreshold))
            .OrderByDescending(p => p.Revenue)
            .ToList();

        var next = periods.FirstOrDefault(p => p.Status is "late" or "todo")
                   ?? periods.FirstOrDefault(p => p.Status == "ongoing");

        return new TaxSummaryDto(
            Year: year, AvailableYears: years, Settings: settings,
            Revenue: yearRevenue, Profit: yearProfit, CollectionRevenue: collectionRevenue,
            SocialContributions: periods.Sum(p => p.SocialContributions),
            TrainingContribution: periods.Sum(p => p.TrainingContribution),
            ChamberTax: periods.Sum(p => p.ChamberTax),
            LiberatoryIncomeTax: periods.Sum(p => p.LiberatoryIncomeTax),
            UrssafTotal: urssafTotal, CfeAmount: cfe,
            EstimatedIncomeTax: estimatedIncomeTax, TaxableIncome: taxableIncome,
            TotalCharges: totalCharges, NetIncome: yearProfit - totalCharges,
            EffectiveRateOnRevenue: yearRevenue > 0 ? Math.Round(totalCharges / yearRevenue * 100, 1) : 0,
            EffectiveRateOnProfit: yearProfit > 0 ? Math.Round(totalCharges / yearProfit * 100, 1) : 0,
            ProjectedRevenue: projected, SetAsideRate: Math.Round(setAside, 1),
            NextDeclaration: next, Periods: periods, Platforms: platforms);
    }

    // ---------------------------------------------------------------

    private record Period(string Key, string Label, DateTime Start, DateTime End, DateTime Deadline);

    /// <summary>
    /// Mensuel : échéance le dernier jour du mois suivant.
    /// Trimestriel : 30 avril, 31 juillet, 31 octobre, 31 janvier (dernier jour du mois suivant le trimestre).
    /// </summary>
    private static IEnumerable<Period> BuildPeriods(int year, DeclarationFrequency frequency)
    {
        var fr = CultureInfo.GetCultureInfo("fr-FR");
        var months = frequency == DeclarationFrequency.Monthly ? 1 : 3;
        for (var i = 0; i < 12 / months; i++)
        {
            var start = new DateTime(year, i * months + 1, 1);
            var end = start.AddMonths(months).AddDays(-1);
            var deadline = start.AddMonths(months + 1).AddDays(-1);
            var (key, label) = frequency == DeclarationFrequency.Monthly
                ? ($"{year}-M{i + 1:D2}", fr.TextInfo.ToTitleCase(start.ToString("MMMM yyyy", fr)))
                : ($"{year}-T{i + 1}", $"{i + 1}{(i == 0 ? "er" : "e")} trimestre {year}");
            yield return new Period(key, label, start, end, deadline);
        }
    }

    private static string StatusOf(Period p, TaxSettings s, HashSet<string> declared, DateTime today)
    {
        if (s.CreationDate is { } created && p.End < created.Date) return "inactive";
        if (declared.Contains(p.Key)) return "declared";
        if (today <= p.End) return "ongoing";
        return today <= p.Deadline ? "todo" : "late";
    }

    private static bool IsAcre(TaxSettings s, DateTime date) =>
        s.AcreEnabled
        && (s.AcreStart is null || date >= s.AcreStart.Value.Date)
        && (s.AcreEnd is null || date <= s.AcreEnd.Value.Date);

    private static decimal SocialRateAt(TaxSettings s, DateTime date) =>
        IsAcre(s, date) ? s.SocialRate * (1 - s.AcreReductionRate / 100m) : s.SocialRate;

    private static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    private static void Validate(TaxSettings s)
    {
        foreach (var (name, value) in new (string, decimal)[]
                 {
                     ("Taux de cotisations sociales", s.SocialRate), ("CFP", s.TrainingRate),
                     ("Taxe chambre consulaire", s.ChamberTaxRate), ("Versement libératoire", s.LiberatoryIncomeTaxRate),
                     ("Abattement", s.FlatAllowanceRate), ("Tranche marginale", s.MarginalTaxRate),
                     ("Réduction ACRE", s.AcreReductionRate), ("Marge de sécurité", s.SafetyMarginRate)
                 })
        {
            if (value is < 0m or > 100m) throw new BusinessException($"{name} : le taux doit être compris entre 0 et 100 %.");
        }
        if (s.RevenueCeiling < 0 || s.VatThreshold < 0 || s.VatThresholdIncreased < 0 || s.CfeAnnualAmount < 0)
            throw new BusinessException("Les seuils et montants ne peuvent pas être négatifs.");
        if (s.AcreStart.HasValue && s.AcreEnd.HasValue && s.AcreEnd < s.AcreStart)
            throw new BusinessException("La fin de l'ACRE doit être postérieure à son début.");
    }
}
