import { ShippingCarrier, ShippingSupply, ShippingSupplyKind } from './models';
import { byFifo, normalizeText } from './products';
import { groupBy } from './utils';

/**
 * Fournitures d'envoi regroupées : les achats de même nom et même nature (ex. plusieurs carnets de
 * « Timbre Lettre verte 20 g ») forment une seule fourniture, consommée en FIFO par les envois.
 */
export interface SupplyGroup {
  key: string;
  name: string;
  kind: ShippingSupplyKind;
  carrier: ShippingCarrier | null;
  /** Achats du plus ancien au plus récent. */
  lots: ShippingSupply[];
}

export interface SupplyAllocation {
  lot: ShippingSupply;
  quantity: number;
}

export function supplyKey(s: { name: string; kind: ShippingSupplyKind }): string {
  return `${normalizeText(s.name)}|${s.kind}`;
}

export function groupSupplies(supplies: ShippingSupply[]): SupplyGroup[] {
  return [...groupBy(supplies, supplyKey).entries()]
    .map(([key, lots]) => {
      lots.sort(byFifo);
      const latest = lots[lots.length - 1];
      return { key, name: latest.name, kind: latest.kind, carrier: latest.carrier, lots };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
