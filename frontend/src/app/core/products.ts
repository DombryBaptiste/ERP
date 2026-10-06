import { InventoryItem, ItemCondition, ItemType } from './models';

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

/** Ordre FIFO : date d'achat puis identifiant. */
export function byFifo(a: InventoryItem, b: InventoryItem): number {
  return a.purchaseDate.localeCompare(b.purchaseDate) || a.id - b.id;
}

export function groupProducts(items: InventoryItem[]): ProductGroup[] {
  const map = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = productKey(item);
    const lots = map.get(key);
    if (lots) lots.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()].map(([key, lots]) => toGroup(key, lots.sort(byFifo)));
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

  return {
    key,
    name: latest.name,
    category: [...lots].reverse().find(l => l.category)?.category ?? null,
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
 * Répartit une quantité sur les lots en FIFO (les plus anciens d'abord).
 * Renvoie null si le stock total ne suffit pas.
 */
export function allocateFifo(lots: InventoryItem[], quantity: number): LotAllocation[] | null {
  const result: LotAllocation[] = [];
  let wanted = quantity;
  for (const lot of [...lots].sort(byFifo)) {
    if (wanted <= 0) break;
    const take = Math.min(lot.remainingQuantity, wanted);
    if (take > 0) {
      result.push({ lot, quantity: take });
      wanted -= take;
    }
  }
  return wanted > 0 ? null : result;
}
