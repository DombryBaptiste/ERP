import { BuybackSettings, CardLanguage, CatalogCard, CatalogSet, ItemCondition, RarityGroup } from './models';

/** Langues du catalogue : libellé (aussi utilisé comme langue de l'article acheté) et abréviation. */
export const CARD_LANGUAGES: { value: CardLanguage; label: string; short: string }[] = [
  { value: 'fr', label: 'Français', short: 'FR' },
  { value: 'ja', label: 'Japonais', short: 'JP' },
  { value: 'ko', label: 'Coréen', short: 'KR' },
  { value: 'zh-tw', label: 'Chinois traditionnel', short: 'TW' },
  { value: 'zh-cn', label: 'Chinois simplifié', short: 'CN' }
];

export function languageLabel(language: CardLanguage): string {
  return CARD_LANGUAGES.find(l => l.value === language)?.label ?? language;
}

export function languageShort(language: CardLanguage): string {
  return CARD_LANGUAGES.find(l => l.value === language)?.short ?? language.toUpperCase();
}

/** Clé unique d'une série : les identifiants se répètent d'une langue à l'autre (SV8a en japonais et en chinois). */
export function setKey(set: Pick<CatalogSet, 'language' | 'setId'>): string {
  return `${set.language}|${set.setId}`;
}

export function parseSetKey(key: string): { language?: CardLanguage; setId?: string } {
  if (!key) return {};
  const [language, setId] = key.split('|');
  return { language: language as CardLanguage, setId };
}

/** Groupes de rareté proposés à l'import, avec ceux cochés par défaut (les cartes « rares »). */
export const RARITY_GROUPS: { value: RarityGroup; label: string; hint: string; default: boolean }[] = [
  { value: 'Other', label: 'Cartes rares', hint: 'Full Art, AR, ALT, gold, Prime, LÉGENDE, Radieux, galeries…', default: true },
  { value: 'Holo', label: 'Holos', hint: 'Rares holo (dont les holos des anciennes séries, ex. Dracaufeu du Set de Base)', default: false },
  { value: 'ClassicEx', label: 'ex / V / VMAX / VSTAR classiques', hint: 'Versions non Full Art', default: false },
  { value: 'Rare', label: 'Rares', hint: 'Rares non holo', default: false },
  { value: 'Uncommon', label: 'Peu communes', hint: '', default: false },
  { value: 'Common', label: 'Communes', hint: '', default: false },
  { value: 'NoRarity', label: 'Sans rareté', hint: 'Énergies de base…', default: false },
  { value: 'Unknown', label: 'Rareté non renseignée', hint: 'Fréquent dans les séries asiatiques de TCGdex', default: true }
];

/** Réglages du rachat par défaut (modifiables dans les Paramètres). */
export const DEFAULT_BUYBACK: BuybackSettings = {
  discountPercent: 20,
  roundingStep: 0.5,
  nmPercent: 100,
  excPercent: 85,
  goodPercent: 70,
  lpPercent: 60,
  plPercent: 50,
  poPercent: 30
};

/** Part de la cote (NM) retenue selon l'état (1 = 100 %). */
export function conditionFactor(condition: ItemCondition, settings: BuybackSettings = DEFAULT_BUYBACK): number {
  const percents: Record<ItemCondition, number> = {
    NM: settings.nmPercent, EXC: settings.excPercent, GOOD: settings.goodPercent,
    LP: settings.lpPercent, PL: settings.plPercent, PO: settings.poPercent
  };
  return percents[condition] / 100;
}

/** Prix d'achat proposé : valeur − remise, arrondi au pas inférieur (ex. −20 %, 0,50 € : 6,70 → 6,50 ; 6,40 → 6,00). */
export function buybackPrice(value: number | null | undefined, settings: BuybackSettings = DEFAULT_BUYBACK): number | null {
  if (value === null || value === undefined || value < 0) return null;
  const raw = value * (1 - settings.discountPercent / 100);
  const step = settings.roundingStep > 0 ? settings.roundingStep : 0.01;
  return Math.round(Math.floor(raw / step + 1e-9) * step * 100) / 100;
}

/** Description courte du calcul, ex. « −20 %, arrondi au 0,50 € inférieur ». */
export function buybackRule(settings: BuybackSettings = DEFAULT_BUYBACK): string {
  const step = settings.roundingStep > 0
    ? `arrondi au ${settings.roundingStep.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € inférieur`
    : 'au centime';
  return `−${settings.discountPercent.toLocaleString('fr-FR')} %, ${step}`;
}

/** Catégorie d'une carte (brute ou gradée) qui n'est liée à aucune carte du catalogue. */
export const UNCATEGORIZED = 'Hors catégorie';

/** Catégorie d'une série ou d'une carte du catalogue : « code + nom », ex. « PFL Flammes Fantasmagoriques ». */
export function catalogCategory(set: Pick<CatalogSet, 'setCode' | 'setId' | 'setName'>): string {
  return `${set.setCode ?? set.setId} ${set.setName}`.slice(0, 100);  // même limite que l'API
}

/** Code court de la carte, ex. « PFL 095 ». */
export function cardCode(card: Pick<CatalogCard, 'setCode' | 'setId' | 'number'>): string {
  return `${card.setCode ?? card.setId} ${card.number}`;
}

export function cardThumbnail(card: Pick<CatalogCard, 'imageUrl'>): string | null {
  return card.imageUrl ? `${card.imageUrl}/low.webp` : null;
}

export function cardImage(card: Pick<CatalogCard, 'imageUrl'>): string | null {
  return card.imageUrl ? `${card.imageUrl}/high.webp` : null;
}
