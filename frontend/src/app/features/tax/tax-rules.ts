import { MicroActivity, TaxPeriodStatus, TaxSettings } from '../../core/models';

/**
 * Barème micro-entreprise 2026 (sources : urssaf.fr, impots.gouv.fr — septembre 2026).
 * Ces valeurs servent de préréglages : tout est modifiable dans l'onglet Paramètres.
 */
export const RATES_YEAR = 2026;

export interface ActivityPreset {
  label: string;
  description: string;
  values: Pick<TaxSettings,
    'socialRate' | 'trainingRate' | 'chamberTaxRate' | 'liberatoryIncomeTaxRate' | 'flatAllowanceRate' |
    'revenueCeiling' | 'vatThreshold' | 'vatThresholdIncreased'>;
}

export const ACTIVITY_PRESETS: Record<MicroActivity, ActivityPreset> = {
  Sales: {
    label: 'Achat-revente / vente de marchandises (BIC)',
    description: 'Votre cas : vous achetez des cartes et des produits scellés pour les revendre.',
    values: {
      socialRate: 12.3, trainingRate: 0.1, chamberTaxRate: 0.015, liberatoryIncomeTaxRate: 1,
      flatAllowanceRate: 71, revenueCeiling: 203_100, vatThreshold: 85_000, vatThresholdIncreased: 93_500
    }
  },
  ServicesBic: {
    label: 'Prestations de services commerciales ou artisanales (BIC)',
    description: "Ex. : gradation de cartes pour d'autres, réparation, location…",
    values: {
      socialRate: 21.2, trainingRate: 0.1, chamberTaxRate: 0.044, liberatoryIncomeTaxRate: 1.7,
      flatAllowanceRate: 50, revenueCeiling: 83_600, vatThreshold: 37_500, vatThresholdIncreased: 41_250
    }
  },
  Bnc: {
    label: 'Profession libérale non réglementée (BNC)',
    description: 'Ex. : conseil, formation, création de contenu…',
    values: {
      socialRate: 25.6, trainingRate: 0.2, chamberTaxRate: 0, liberatoryIncomeTaxRate: 2.2,
      flatAllowanceRate: 34, revenueCeiling: 83_600, vatThreshold: 37_500, vatThresholdIncreased: 41_250
    }
  }
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  activity: 'Sales',
  creationDate: null,
  frequency: 'Quarterly',
  ...ACTIVITY_PRESETS.Sales.values,
  liberatoryIncomeTax: false,
  marginalTaxRate: 11,
  acreEnabled: false,
  acreReductionRate: 25,
  acreStart: null,
  acreEnd: null,
  cfeAnnualAmount: 0,
  safetyMarginRate: 2
};

/** Tranches marginales du barème de l'impôt sur le revenu. */
export const MARGINAL_TAX_RATES = [0, 11, 30, 41, 45];

/** Seuils DAC7 : au-delà, la plateforme transmet vos ventes au fisc. */
export const DAC7 = { sales: 30, revenue: 2000 };

export const STATUS_LABELS: Record<TaxPeriodStatus, string> = {
  inactive: 'Avant activité',
  ongoing: 'En cours',
  todo: 'À déclarer',
  late: 'En retard',
  declared: 'Déclarée'
};

export const URSSAF_URL = 'https://www.autoentrepreneur.urssaf.fr';

export interface EffectiveRates {
  social: number;
  training: number;
  chamber: number;
  incomeTax: number;
  /** Total prélevé par l'URSSAF (cotisations + versement libératoire éventuel). */
  urssaf: number;
  total: number;
}

/**
 * Taux réels en % du CA, avec ou sans ACRE.
 * Sans versement libératoire, l'impôt est estimé : (100 % - abattement) × tranche marginale.
 */
export function effectiveRates(s: TaxSettings, withAcre = false): EffectiveRates {
  const social = withAcre && s.acreEnabled ? s.socialRate * (1 - s.acreReductionRate / 100) : s.socialRate;
  const incomeTax = s.liberatoryIncomeTax
    ? s.liberatoryIncomeTaxRate
    : ((100 - s.flatAllowanceRate) * s.marginalTaxRate) / 100;
  const urssaf = social + s.trainingRate + s.chamberTaxRate + (s.liberatoryIncomeTax ? s.liberatoryIncomeTaxRate : 0);
  return { social, training: s.trainingRate, chamber: s.chamberTaxRate, incomeTax, urssaf, total: social + s.trainingRate + s.chamberTaxRate + incomeTax };
}

/** Jours restants avant une date (négatif si dépassée). */
export function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.substring(0, 10).split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - start) / 86_400_000);
}
