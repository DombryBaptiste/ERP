import { InventoryItem, ItemCondition, ItemType } from './models';
import { groupBy } from './utils';

/**
 * Regroupement des articles en « produits ».
 *
 * Chaque ligne d'achat crée un LOT (un article d'inventaire) avec son propre prix d'achat : on garde ce
 * détail pour le registre des achats et pour calculer un bénéfice juste. Pour l'affichage et la vente,
 * les lots d'un même produit (même nom, même type, même état) sont regroupés :
 *  - coût moyen pondéré (CUMP) sur le stock restant ;
 *  - à la vente, les lots les plus anciens partent en premier (FIFO, « premier entré, premier sorti »).
 */

export interface ProductGroup {
  key: string;
  name: string;
  category: string | null;
  language: string | null;
  isListedOnCardmarket: boolean;
  type: ItemType;
  condition: ItemCondition;
  /** Lots du produit, du plus ancien au plus récent (ordre FIFO). */
  lots: InventoryItem[];
  quantity: number;
  remaining: number;
  /** Valeur du stock restant au prix d'achat. */
  stockValue: number;
  /** Coût moyen pondéré du stock restant (ou de tous les lots si tout est vendu). */
  averageCost: number;
  /** Estimation la plus récente parmi les lots. */
  marketValue: number | null;
  latentGain: number | null;
  photoId: number | null;
  lastPurchaseDate: string;
  hasCollection: boolean;
}

/** Texte comparable : sans accents, en minuscules, espaces normalisés. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Clé d'un produit : même nom (sans tenir compte des accents/majuscules), même type, même état. */
export function productKey(item: { name: string; type: ItemType; condition: ItemCondition }): string {
  return `${normalizeText(item.name)}|${item.type}|${item.condition}`;
}

/** Ordre FIFO (lots d'articles ou de fournitures) : date d'achat puis identifiant. */
export function byFifo(a: { purchaseDate: string; id: number }, b: { purchaseDate: string; id: number }): number {
  return a.purchaseDate.localeCompare(b.purchaseDate) || a.id - b.id;
}

export function groupProducts(items: InventoryItem[]): ProductGroup[] {
  return [...groupBy(items, productKey).entries()].map(([key, lots]) => toGroup(key, lots.sort(byFifo)));
}

function toGroup(key: string, lots: InventoryItem[]): ProductGroup {
  const latest = lots[lots.length - 1];
  const remaining = lots.reduce((s, l) => s + l.remainingQuantity, 0);
  const quantity = lots.reduce((s, l) => s + l.quantity, 0);
  const stockValue = lots.reduce((s, l) => s + l.stockValue, 0);
  const averageCost = remaining > 0
    ? stockValue / remaining
    : lots.reduce((s, l) => s + l.quantity * l.purchasePrice, 0) / Math.max(1, quantity);

  const estimated = lots.filter(l => l.marketValue !== null)
    .sort((a, b) => (a.marketValueUpdatedAt ?? '').localeCompare(b.marketValueUpdatedAt ?? ''));
  const gains = lots.filter(l => l.latentGain !== null && l.remainingQuantity > 0);

  const categorizedLot = [...lots].reverse().find(l => l.category) ?? latest;

  return {
    key,
    name: latest.name,
    category: categorizedLot.category,
    language: categorizedLot.language,
    isListedOnCardmarket: lots.every(lot => lot.isListedOnCardmarket),
    type: latest.type,
    condition: latest.condition,
    lots,
    quantity,
    remaining,
    stockValue,
    averageCost: Math.round(averageCost * 100) / 100,
    marketValue: estimated.length ? estimated[estimated.length - 1].marketValue : null,
    latentGain: gains.length ? gains.reduce((s, l) => s + (l.latentGain ?? 0), 0) : null,
    photoId: [...lots].reverse().find(l => l.photoId !== null)?.photoId ?? null,
    lastPurchaseDate: latest.purchaseDate,
    hasCollection: lots.some(l => l.origin === 'PersonalCollection')
  };
}

/** Part d'une quantité prélevée sur un lot. */
export interface LotAllocation {
  lot: InventoryItem;
  quantity: number;
}

/**
 * Ordre de prélèvement du bulk : d'abord les lots ACHETÉS (du plus ancien au plus récent), puis ceux de la
 * collection (0 €). On récupère ainsi d'abord l'argent réellement dépensé : tant qu'il reste du bulk acheté,
 * le bénéfice n'est pas gonflé par des cartes « gratuites », et le stock restant n'est pas surévalué.
 */
export function byBulkPriority(a: InventoryItem, b: InventoryItem): number {
  const rank = (lot: InventoryItem) => (lot.origin === 'PersonalCollection' ? 1 : 0);
  return rank(a) - rank(b) || byFifo(a, b);
}

/**
 * Prélève une quantité de bulk : achats d'abord, puis collection (voir <c>byBulkPriority</c>).
 * <c>stock</c> donne le stock utilisable de chaque lot ; <c>missing</c> = quantité non couverte.
 */
export function allocatePurchasesFirst(
  lots: InventoryItem[], quantity: number, stock: (lot: InventoryItem) => number
): { lots: LotAllocation[]; missing: number } {
  const taken: LotAllocation[] = [];
  let wanted = Math.max(0, quantity);
  for (const lot of [...lots].sort(byBulkPriority)) {
    if (wanted <= 0) break;
    const take = Math.min(Math.max(0, stock(lot)), wanted);
    if (take > 0) {
      taken.push({ lot, quantity: take });
      wanted -= take;
    }
  }
  return { lots: taken, missing: wanted };
}

/** Lots de bulk à prélever pour une vente (achats d'abord) ; null si le stock ne suffit pas. */
export function allocateBulk(lots: InventoryItem[], quantity: number): LotAllocation[] | null {
  const { lots: taken, missing } = allocatePurchasesFirst(lots, quantity, lot => lot.remainingQuantity);
  return missing > 0 ? null : taken;
}
