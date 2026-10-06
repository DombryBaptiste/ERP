import { InventoryItem, ItemCondition } from '../../core/models';
import { groupProducts, ProductGroup } from '../../core/products';

/**
 * Le bulk (communes, peu communes, reverses…) est géré comme un produit de l'inventaire de type « Bulk »,
 * dont la quantité est un nombre de cartes. Chaque ajout crée un lot (avec son coût par carte), et chaque
 * vente de lot prélève les cartes en FIFO : le bénéfice utilise le coût moyen réel des cartes vendues.
 */

/** État fixe des lots de bulk : il fait partie de la clé produit, il doit donc rester constant. */
export const BULK_CONDITION: ItemCondition = 'Excellent';

export const isBulk = (item: InventoryItem): boolean => item.type === 'Bulk';

/** Nombre de cartes estimé à partir d'un poids. */
export function cardsFromGrams(grams: number, gramsPerCard: number): number {
  return gramsPerCard > 0 ? Math.round((grams || 0) / gramsPerCard) : 0;
}

/** Prix unitaire à 6 décimales (comme en base) : 10 € pour 75 cartes = 0,133333 €. */
export function unitPrice(total: number, quantity: number): number {
  return quantity > 0 ? Math.round((total / quantity) * 1_000_000) / 1_000_000 : 0;
}

/** Produits de bulk de l'inventaire, indexés par nom. */
export function bulkProducts(items: InventoryItem[]): Map<string, ProductGroup> {
  return new Map(groupProducts(items.filter(isBulk)).map(p => [p.name, p]));
}
