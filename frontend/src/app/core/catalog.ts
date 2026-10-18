import { CatalogCard, ItemCondition } from './models';

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
