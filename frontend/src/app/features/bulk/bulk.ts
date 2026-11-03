import { InventoryItem, ItemCondition } from '../../core/models';
import { groupProducts, ProductGroup } from '../../core/products';

/**
 * Le bulk (communes, peu communes, reverses…) est géré comme un produit de l'inventaire de type « Bulk »,
 * dont la quantité est un nombre de cartes. Chaque ajout crée un lot (avec son coût par carte), et chaque
 * vente de lot prélève les cartes en FIFO : le bénéfice utilise le coût moyen réel des cartes vendues.
 */

/** État fixe des lots de bulk : il fait partie de la clé produit, il doit donc rester constant. */
export const BULK_CONDITION: ItemCondition = 'EXC';

/** Poids moyen d'une carte (g) tant que les réglages ne sont pas chargés ou si la valeur saisie est invalide. */
export const DEFAULT_GRAMS_PER_CARD = 1.8;

/** Saisie du nombre de cartes : directement, ou par pesée. */
export type CountMode = 'count' | 'weight';

export const isBulk = (item: InventoryItem): boolean => item.type === 'Bulk';

/** Nombre de cartes estimé à partir d'un poids. */
export function cardsFromGrams(grams: number, gramsPerCard: number): number {
  return gramsPerCard > 0 ? Math.round((grams || 0) / gramsPerCard) : 0;
}

/** Nombre de cartes saisi, selon le mode (nombre entier positif ou estimation au poids). */
export function countedCards(mode: CountMode, count: number, grams: number, gramsPerCard: number): number {
  return mode === 'count' ? Math.max(0, Math.floor(count || 0)) : cardsFromGrams(grams, gramsPerCard);
}

/** Produits de bulk de l'inventaire, indexés par nom. */
export function bulkProducts(items: InventoryItem[]): Map<string, ProductGroup> {
  return new Map(groupProducts(items.filter(isBulk)).map(p => [p.name, p]));
}
