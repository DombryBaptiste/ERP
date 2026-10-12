import { AttachmentKind, ItemCondition, ItemOrigin, ItemType, PaymentMethod, PurchasePlatform, SalePlatform, ShippingCarrier, ShippingSupplyKind } from './models';

/** Libellés français des valeurs techniques renvoyées par l'API. */

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RawCard: 'Carte brute',
  GradedCard: 'Carte gradée',
  Booster: 'Booster',
  Blister: 'Blister',
  Etb: 'ETB',
  Box: 'Coffret',
  Display: 'Display',
  MiniTin: 'Mini-Tin',
  Bundle: 'Bundle',
  Bulk: 'Bulk (vrac)',
  Other: 'Autre'
};

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  NM: 'NM',
  EXC: 'EXC',
  GOOD: 'GOOD',
  LP: 'LP',
  PL: 'PL',
  PO: 'PO'
};

export const PLATFORM_LABELS: Record<SalePlatform, string> = {
  Cardmarket: 'Cardmarket',
  Ebay: 'eBay',
  Vinted: 'Vinted',
  Leboncoin: 'Leboncoin',
  FacebookMarketplace: 'Marketplace Facebook',
  InPerson: 'Main propre',
  Other: 'Autre'
};

export const PURCHASE_PLATFORM_LABELS: Record<PurchasePlatform, string> = {
  Cardmarket: 'Cardmarket',
  Ebay: 'eBay',
  Vinted: 'Vinted',
  Leboncoin: 'Leboncoin',
  FacebookMarketplace: 'Marketplace Facebook',
  Amazon: 'Amazon',
  Store: 'Magasin',
  Other: 'Autre'
};

export const ORIGIN_LABELS: Record<ItemOrigin, string> = {
  Purchase: 'Achat',
  PersonalCollection: 'Ma collection',
  Manual: 'Ajout manuel'
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  Platform: 'Via la plateforme',
  BankTransfer: 'Virement',
  PayPal: 'PayPal',
  Card: 'Carte bancaire',
  Cash: 'Espèces',
  Check: 'Chèque',
  Other: 'Autre'
};

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  Photo: 'Photo',
  Receipt: "Ticket / facture d'achat",
  Listing: "Capture d'annonce",
  OriginProof: "Preuve d'origine",
  Other: 'Autre'
};

/** Mode de paiement le plus probable selon la plateforme de vente. */
export function defaultPaymentFor(platform: SalePlatform): PaymentMethod {
  switch (platform) {
    case 'Cardmarket':
    case 'Ebay':
    case 'Vinted':
      return 'Platform';
    case 'InPerson':
      return 'Cash';
    default:
      return 'BankTransfer';
  }
}

export const SHIPPING_KIND_LABELS: Record<ShippingSupplyKind, string> = {
  Stamp: 'Timbre',
  Label: 'Bordereau',
  Envelope: 'Enveloppe',
  Protection: 'Protection',
  Box: 'Carton',
  Other: 'Autre'
};

export const SHIPPING_KIND_ICONS: Record<ShippingSupplyKind, string> = {
  Stamp: 'local_post_office',
  Label: 'receipt',
  Envelope: 'mail',
  Protection: 'shield',
  Box: 'inventory_2',
  Other: 'category'
};

export const CARRIER_LABELS: Record<ShippingCarrier, string> = {
  LaPoste: 'La Poste',
  Colissimo: 'Colissimo',
  MondialRelay: 'Mondial Relay',
  RelaisColis: 'Relais Colis',
  Chronopost: 'Chronopost',
  VintedGo: 'Vinted Go',
  Ups: 'UPS',
  HandDelivery: 'Main propre',
  Other: 'Autre'
};

/** Désignations courantes proposées à la saisie d'un achat de fournitures (modifiables). */
export const SHIPPING_PRESETS: { name: string; kind: ShippingSupplyKind; carrier: ShippingCarrier | null }[] = [
  { name: 'Timbre Lettre verte 20 g', kind: 'Stamp', carrier: 'LaPoste' },
  { name: 'Timbre Lettre verte 100 g', kind: 'Stamp', carrier: 'LaPoste' },
  { name: 'Timbre Lettre internationale 20 g', kind: 'Stamp', carrier: 'LaPoste' },
  { name: 'Lettre suivie', kind: 'Label', carrier: 'LaPoste' },
  { name: 'Bordereau Colissimo', kind: 'Label', carrier: 'Colissimo' },
  { name: 'Bordereau Mondial Relay', kind: 'Label', carrier: 'MondialRelay' },
  { name: 'Enveloppe bulle', kind: 'Envelope', carrier: null },
  { name: 'Enveloppe cartonnée', kind: 'Envelope', carrier: null },
  { name: 'Toploader', kind: 'Protection', carrier: null },
  { name: 'Sleeves', kind: 'Protection', carrier: null },
  { name: 'Carton d\'expédition', kind: 'Box', carrier: null }
];

export interface Option<T extends string> {
  value: T;
  label: string;
}

function toOptions<T extends string>(labels: Record<T, string>): Option<T>[] {
  return (Object.keys(labels) as T[]).map(value => ({ value, label: labels[value] }));
}

export const ITEM_TYPES = toOptions(ITEM_TYPE_LABELS);
export const CONDITIONS = toOptions(CONDITION_LABELS);
export const PLATFORMS = toOptions(PLATFORM_LABELS);
export const PURCHASE_PLATFORMS = toOptions(PURCHASE_PLATFORM_LABELS);
export const ORIGINS = toOptions(ORIGIN_LABELS);
export const PAYMENT_METHODS = toOptions(PAYMENT_LABELS);
export const ATTACHMENT_KINDS = toOptions(ATTACHMENT_KIND_LABELS);
export const SHIPPING_KINDS = toOptions(SHIPPING_KIND_LABELS);
export const CARRIERS = toOptions(CARRIER_LABELS);

/** Recherche de prix sur Cardmarket (ouverte dans un nouvel onglet, aucune donnée envoyée automatiquement). */
export function cardmarketSearchUrl(name: string): string {
  return `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`;
}

/** Commission Cardmarket : 5 % de la valeur de l'article, plafonnée à 100 € par article. */
export function cardmarketSaleFeeForItem(value: number): number {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.min(safe * 0.05, 100);
}

export function cardmarketSaleFees(items: Array<{ quantity: number; salePrice: number }>): number {
  return items.reduce((sum, item) => sum + (item.quantity || 0) * cardmarketSaleFeeForItem(item.salePrice), 0);
}

/** Vrai pour les cartes (brutes ou gradées), faux pour les produits scellés. */
export const isCard = (type: ItemType): boolean => type === 'RawCard' || type === 'GradedCard' || type === 'Bulk';
