import { CardLanguage, CatalogCard, CatalogSet, ItemCondition, RarityGroup } from './models';

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

/** Remise appliquée à la valeur pour obtenir le prix d'achat (0,20 = −20 %). */
export const BUYBACK_DISCOUNT = 0.2;

/** Le prix d'achat est arrondi au multiple inférieur de ce pas (0,50 €). */
export const BUYBACK_STEP = 0.5;

/** Part de la cote (NM) retenue selon l'état de la carte. */
export const CONDITION_FACTORS: Record<ItemCondition, number> = {
  NM: 1,
  EXC: 0.85,
  GOOD: 0.7,
  LP: 0.6,
  PL: 0.5,
  PO: 0.3
};

/** Prix d'achat proposé : valeur − 20 %, arrondi au 0,50 € inférieur (6,70 → 6,50 ; 6,40 → 6,00). */
export function buybackPrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || value < 0) return null;
  return Math.floor((value * (1 - BUYBACK_DISCOUNT)) / BUYBACK_STEP + 1e-9) * BUYBACK_STEP;
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
