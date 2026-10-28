/**
 * Modèles échangés avec l'API. Les dates arrivent au format ISO "2026-09-30T00:00:00"
 * et sont envoyées au format "2026-09-30".
 */

export type ItemType = 'RawCard' | 'GradedCard' | 'Booster' | 'Blister' | 'Etb' | 'Box' | 'Display' | 'MiniTin' | 'Pokebox' | 'Bundle' | 'Bulk' | 'Other';
export type ItemCondition = 'NM' | 'EXC' | 'GOOD' | 'LP' | 'PL' | 'PO';
export type SalePlatform = 'Cardmarket' | 'Ebay' | 'Vinted' | 'Leboncoin' | 'FacebookMarketplace' | 'InPerson' | 'Other';
/** Supplier = achat classique ; PersonalCollection = transfert depuis la collection personnelle. */
export type PurchaseSource = 'Supplier' | 'PersonalCollection';
export type PurchasePlatform = 'Cardmarket' | 'Ebay' | 'Vinted' | 'Leboncoin' | 'FacebookMarketplace' | 'Amazon' | 'Store' | 'Other';
export type ItemOrigin = 'Purchase' | 'PersonalCollection' | 'Manual';
export type PaymentMethod = 'Platform' | 'BankTransfer' | 'PayPal' | 'Card' | 'Cash' | 'Check' | 'Other';
export type AttachmentOwner = 'InventoryItem' | 'Purchase' | 'Sale' | 'ShippingSupply';
export type ShippingSupplyKind = 'Stamp' | 'Label' | 'Envelope' | 'Protection' | 'Box' | 'Other';
export type ShippingCarrier = 'LaPoste' | 'Colissimo' | 'MondialRelay' | 'RelaisColis' | 'Chronopost' | 'VintedGo' | 'Ups' | 'HandDelivery' | 'Other';
export type AttachmentKind = 'Photo' | 'Receipt' | 'Listing' | 'OriginProof' | 'Other';

// ----- Inventaire -----
export interface InventoryItem {
  id: number;
  name: string;
  category: string | null;
  language: string | null;
  isListedOnCardmarket: boolean;
  type: ItemType;
  condition: ItemCondition;
  purchasePrice: number;
  quantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  stockValue: number;
  location: string | null;
  purchaseDate: string;
  purchaseId: number | null;
  purchaseNumber: string | null;
  origin: ItemOrigin;
  /** Valeur de marché unitaire estimée. */
  marketValue: number | null;
  previousMarketValue: number | null;
  marketValueUpdatedAt: string | null;
  /** Quantité restante × (valeur de marché − prix d'achat). */
  latentGain: number | null;
  daysInStock: number;
  photoId: number | null;
}

export interface InventoryItemInput {
  name: string;
  category: string | null;
  type: ItemType;
  condition: ItemCondition;
  purchasePrice: number;
  quantity: number;
  location: string | null;
  purchaseDate: string;
  marketValue: number | null;
}

// ----- Achats -----
export interface PurchaseLine {
  id: number;
  itemId: number;
  name: string;
  category: string | null;
  language: string | null;
  type: ItemType;
  condition: ItemCondition;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  location: string | null;
  remainingQuantity: number;
  soldQuantity: number;
  /** Carte du catalogue liée (ligne créée depuis l'estimation). */
  catalogCardId: number | null;
}

export interface Purchase {
  id: number;
  purchaseNumber: string;
  source: PurchaseSource;
  purchaseDate: string;
  supplier: string;
  platform: PurchasePlatform | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  platformFees: number;
  shippingFees: number;
  trackingNumber: string | null;
  totalAmount: number;
  itemCount: number;
  items: PurchaseLine[];
  performance: PurchasePerformance;
}

/** Vente contenant des articles d'un achat : part de la vente revenant à cet achat. */
export interface PurchaseSale {
  saleId: number;
  saleNumber: string;
  saleDate: string;
  quantity: number;
  /** Encaissement net (après frais, remboursements et envoi) revenant aux articles de l'achat. */
  net: number;
}

/** Rentabilité d'un achat d'après ses articles déjà vendus. */
export interface PurchasePerformance {
  unitsSold: number;
  unitsInStock: number;
  /** Encaissement net des ventes revenant à cet achat. */
  recovered: number;
  /** Coût d'achat des unités vendues (frais de l'achat inclus au prorata). */
  costOfSold: number;
  /** Bénéfice sur les unités déjà vendues : récupéré − coût des unités vendues. */
  realizedProfit: number;
  /** Récupéré − coût total de l'achat : négatif tant que l'achat n'est pas remboursé. */
  balance: number;
  recoveredPercent: number | null;
  stockCost: number;
  /** Valeur de marché des unités restantes (null si aucune n'est estimée). */
  stockMarketValue: number | null;
  unitsWithoutMarketValue: number;
  /** Bilan si le stock restant se vend à sa valeur de marché. */
  projectedBalance: number | null;
  lastSaleDate: string | null;
  sales: PurchaseSale[];
}

export interface PurchaseLineInput {
  itemId: number | null;
  name: string;
  category: string | null;
  language?: string | null;
  type: ItemType;
  condition: ItemCondition;
  quantity: number;
  unitPrice: number;
  location: string | null;
  catalogCardId?: number | null;
}

export interface PurchaseInput {
  source: PurchaseSource;
  purchaseDate: string;
  supplier: string | null;
  platform: PurchasePlatform | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
  platformFees: number;
  shippingFees: number;
  trackingNumber: string | null;
  items: PurchaseLineInput[];
}

// ----- Ventes -----
export interface SaleLine {
  id: number;
  inventoryItemId: number;
  itemName: string;
  itemType: ItemType;
  quantity: number;
  salePrice: number;
  unitCost: number;
  lineTotal: number;
  lineProfit: number;
  returnedQuantity: number;
}

export interface SaleRefundItem {
  saleItemId: number;
  itemName: string;
  quantity: number;
  restocked: boolean;
}

export interface SaleRefund {
  id: number;
  refundDate: string;
  amount: number;
  reason: string | null;
  items: SaleRefundItem[];
}

export interface Sale {
  id: number;
  saleNumber: string;
  saleDate: string;
  customer: string | null;
  platform: SalePlatform;
  paymentMethod: PaymentMethod;
  fees: number;
  comment: string | null;
  /** Montant effectivement reçu du client, avant éventuels remboursements. */
  amountPaid: number;
  trackingNumber: string | null;
  carrier: ShippingCarrier | null;
  /** Coût réel de l'envoi (fournitures consommées). */
  shippingCost: number;
  shipping: ShippingUsage[];
  /** Montant initial de la vente. */
  totalAmount: number;
  refundedAmount: number;
  /** Montant encaissé définitivement (total − remboursements). */
  netAmount: number;
  profit: number;
  margin: number;
  customerAddress: string | null;
  customerSiren: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  items: SaleLine[];
  refunds: SaleRefund[];
}

export interface RefundInput {
  refundDate: string;
  amount: number;
  reason: string | null;
  restock: boolean;
  items: { saleItemId: number; quantity: number }[];
}

export interface SaleLineInput {
  inventoryItemId: number;
  quantity: number;
  salePrice: number;
}

export interface SaleInput {
  saleDate: string;
  customer: string | null;
  platform: SalePlatform;
  fees: number;
  comment: string | null;
  items: SaleLineInput[];
  paymentMethod: PaymentMethod;
  customerAddress: string | null;
  customerSiren: string | null;
  amountPaid: number;
  trackingNumber: string | null;
  carrier: ShippingCarrier | null;
  /** Fournitures d'envoi consommées (une ligne par lot). */
  shipping: ShippingUsageInput[];
}

// ----- Tableau de bord & statistiques -----
export interface MonthlyPoint {
  year: number;
  month: number;
  revenue: number;
  profit: number;
  salesCount: number;
}

export interface DistributionSlice {
  label: string;
  quantity: number;
  value: number;
}

export interface SaleSummary {
  id: number;
  saleNumber: string;
  customer: string | null;
  saleDate: string;
  platform: SalePlatform;
  totalAmount: number;
  netAmount: number;
  profit: number;
}

export interface Dashboard {
  stockItemCount: number;
  stockReferenceCount: number;
  stockValue: number;
  stockMarketValue: number;
  latentGain: number;
  monthSalesCount: number;
  monthRevenue: number;
  monthProfit: number;
  monthPurchases: number;
  totalPurchases: number;
  last12Months: MonthlyPoint[];
  stockDistribution: DistributionSlice[];
  recentSales: SaleSummary[];
  monthShippingSpent: number;
  monthShippingCost: number;
  monthShippingPaid: number;
}

export interface ProductStat {
  name: string;
  type: ItemType;
  quantitySold: number;
  revenue: number;
  profit: number;
  margin: number;
}

// ----- Fiscalité -----
export type MicroActivity = 'Sales' | 'ServicesBic' | 'Bnc';
export type DeclarationFrequency = 'Monthly' | 'Quarterly';
export type TaxPeriodStatus = 'inactive' | 'ongoing' | 'todo' | 'late' | 'declared';

/** Paramètres fiscaux. Les taux sont en % (12.3 = 12,3 %). */
export interface TaxSettings {
  activity: MicroActivity;
  creationDate: string | null;
  frequency: DeclarationFrequency;
  socialRate: number;
  trainingRate: number;
  chamberTaxRate: number;
  liberatoryIncomeTax: boolean;
  liberatoryIncomeTaxRate: number;
  flatAllowanceRate: number;
  marginalTaxRate: number;
  acreEnabled: boolean;
  acreReductionRate: number;
  acreStart: string | null;
  acreEnd: string | null;
  revenueCeiling: number;
  vatThreshold: number;
  vatThresholdIncreased: number;
  cfeAnnualAmount: number;
  safetyMarginRate: number;
}

export interface TaxPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
  deadline: string;
  salesCount: number;
  /** CA à déclarer : ventes de la période − remboursements de la période. */
  revenue: number;
  refunds: number;
  profit: number;
  socialContributions: number;
  trainingContribution: number;
  chamberTax: number;
  liberatoryIncomeTax: number;
  total: number;
  acreApplied: boolean;
  status: TaxPeriodStatus;
}

export interface PlatformTaxReport {
  platform: SalePlatform;
  salesCount: number;
  revenue: number;
  dac7Reported: boolean;
}

export interface TaxSummary {
  year: number;
  availableYears: number[];
  settings: TaxSettings;
  revenue: number;
  profit: number;
  /** CA venant d'articles transférés depuis la collection personnelle (inclus dans `revenue`). */
  collectionRevenue: number;
  socialContributions: number;
  trainingContribution: number;
  chamberTax: number;
  liberatoryIncomeTax: number;
  urssafTotal: number;
  cfeAmount: number;
  estimatedIncomeTax: number;
  taxableIncome: number;
  totalCharges: number;
  netIncome: number;
  effectiveRateOnRevenue: number;
  effectiveRateOnProfit: number;
  projectedRevenue: number;
  setAsideRate: number;
  nextDeclaration: TaxPeriod | null;
  periods: TaxPeriod[];
  platforms: PlatformTaxReport[];
}

export interface Statistics {
  year: number;
  availableYears: number[];
  annualRevenue: number;
  annualProfit: number;
  annualPurchases: number;
  annualSalesCount: number;
  currentMonthRevenue: number;
  currentMonthProfit: number;
  averageMonthlyRevenue: number;
  averageMonthlyProfit: number;
  stockValue: number;
  monthly: MonthlyPoint[];
  topSales: SaleSummary[];
  topProductsByRevenue: ProductStat[];
  topProductsByProfit: ProductStat[];
  annualShippingSpent: number;
  annualShippingCost: number;
  annualShippingPaid: number;
  shippedSalesCount: number;
}

// ----- Alertes -----
export interface AlertSettings {
  dormantWarningDays: number;
  dormantCriticalDays: number;
  marketGainThreshold: number;
  marketRiseThreshold: number;
  lowShippingStock: number;
}

export interface MarketAlert {
  item: InventoryItem;
  gainPercent: number | null;
  risePercent: number | null;
  latentGain: number;
  reason: 'gain' | 'rise';
}

export interface DormantItem {
  item: InventoryItem;
  daysInStock: number;
  level: 'warning' | 'critical';
  suggestion: string;
}

export interface Alerts {
  settings: AlertSettings;
  stockCost: number;
  stockMarketValue: number;
  latentGain: number;
  itemsWithMarketValue: number;
  itemsWithoutMarketValue: number;
  marketAlerts: MarketAlert[];
  dormant: DormantItem[];
  lowShippingStock: ShippingStock[];
}

// ----- Fichiers joints -----
export interface Attachment {
  id: number;
  ownerType: AttachmentOwner;
  ownerId: number;
  kind: AttachmentKind;
  fileName: string;
  contentType: string;
  size: number;
  sortOrder: number;
  isImage: boolean;
  uploadedAt: string;
  url: string;
}

// ----- Paramètres -----
export interface CompanyInfo {
  fullName: string;
  tradeName: string | null;
  siret: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  vatMention: string;
  invoiceFooter: string | null;
}

/** Calcul du prix de rachat : valeur = cote × part selon l'état ; rachat = valeur − remise, arrondi au pas inférieur. */
export interface BuybackSettings {
  /** Remise en % (20 = valeur − 20 %). */
  discountPercent: number;
  /** Arrondi au multiple inférieur, en euros (0 = au centime). */
  roundingStep: number;
  nmPercent: number;
  excPercent: number;
  goodPercent: number;
  lpPercent: number;
  plPercent: number;
  poPercent: number;
}

export interface AppPreferences {
  company: CompanyInfo;
  alerts: AlertSettings;
  buyback?: BuybackSettings;
  cardSeries: CardSeriesEntry[];
}

export interface CardSeriesEntry {
  language: string;
  series: string;
}
// ----- Bulk (cartes en vrac vendues au lot) -----
export interface BulkCategory {
  /** Nom de la catégorie, utilisé aussi comme nom du produit dans l'inventaire. */
  name: string;
  /** Prix de vente conseillé par carte. */
  suggestedPricePerCard: number;
}

export interface BulkSettings {
  /** Poids moyen d'une carte en grammes, pour compter au poids. */
  gramsPerCard: number;
  categories: BulkCategory[];
}

// ----- Frais d'envoi -----
export interface ShippingSupply {
  id: number;
  supplyNumber: string;
  purchaseDate: string;
  kind: ShippingSupplyKind;
  carrier: ShippingCarrier | null;
  name: string;
  quantity: number;
  remainingQuantity: number;
  usedQuantity: number;
  totalAmount: number;
  unitCost: number;
  stockValue: number;
  supplier: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
}

export interface ShippingSupplyInput {
  purchaseDate: string;
  kind: ShippingSupplyKind;
  carrier: ShippingCarrier | null;
  name: string;
  quantity: number;
  totalAmount: number;
  supplier: string | null;
  paymentMethod: PaymentMethod | null;
  comment: string | null;
}

export interface ShippingUsage {
  id: number;
  supplyId: number;
  supplyNumber: string;
  name: string;
  kind: ShippingSupplyKind;
  quantity: number;
  unitCost: number;
  cost: number;
}

export interface ShippingUsageInput {
  supplyId: number;
  quantity: number;
}

export interface ShippingStock {
  name: string;
  kind: ShippingSupplyKind;
  carrier: ShippingCarrier | null;
  remaining: number;
  averageUnitCost: number;
  stockValue: number;
  usedThisYear: number;
  low: boolean;
}

export interface ShippingMonth {
  month: number;
  spent: number;
  used: number;
  paidByBuyers: number;
  shippedSales: number;
}

export interface CarrierStat {
  carrier: ShippingCarrier | null;
  shipments: number;
  cost: number;
  paidByBuyers: number;
}

export interface ShippingSummary {
  year: number;
  availableYears: number[];
  lowStockThreshold: number;
  spentThisYear: number;
  spentThisMonth: number;
  usedThisYear: number;
  paidByBuyersThisYear: number;
  shippedSalesThisYear: number;
  averageCostPerShipment: number;
  stockValue: number;
  stock: ShippingStock[];
  monthly: ShippingMonth[];
  carriers: CarrierStat[];
}

// ----- Catalogue des cartes (cotes, estimation) -----
/** Langue d'une carte du catalogue (code TCGdex). */
export type CardLanguage = 'fr' | 'ja' | 'ko' | 'zh-tw' | 'zh-cn';

export interface CatalogCard {
  id: number;
  language: CardLanguage;
  tcgdexId: string;
  setId: string;
  /** Code officiel de la série (PFL, MEW…). */
  setCode: string | null;
  setName: string;
  /** Bloc (Méga-Évolution, Écarlate et Violet…). */
  serieName: string | null;
  number: string;
  name: string;
  rarity: string | null;
  /** Adresse de l'image sans extension : ajouter /low.webp ou /high.webp. */
  imageUrl: string | null;
  /** Page Cardmarket filtrée sur les offres dans la langue de la carte, NM ou mieux. */
  cardmarketUrl: string | null;
  /** Cote saisie à la main (prix FR NM). */
  quote: number | null;
  quoteUpdatedAt: string | null;
  /** Exemplaires en stock liés à cette carte. */
  inStock: number;
}

export interface CatalogSet {
  language: CardLanguage;
  setId: string;
  setCode: string | null;
  setName: string;
  serieName: string | null;
  releaseDate: string | null;
  cardCount: number;
  quotedCount: number;
}

export interface AvailableSet {
  setId: string;
  /** Code officiel (BWP, PFL…) ou identifiant de la série asiatique. */
  code: string | null;
  name: string;
  serieName: string;
  importedCount: number;
  /** Série absente dans cette langue chez TCGdex : importée avec les fiches d'une autre langue (ex. « ja » pour le coréen). */
  dataLanguage?: CardLanguage | null;
}

export interface CatalogDeleteResult {
  deletedCards: number;
  /** Articles en stock qui étaient liés : déliés et passés en « Hors catégorie ». */
  unlinkedItems: number;
}

/** Groupes de rareté proposés à l'import. */
export type RarityGroup = 'Common' | 'Uncommon' | 'Rare' | 'Holo' | 'ClassicEx' | 'NoRarity' | 'Unknown' | 'Other';

export interface CatalogImportResult {
  setId: string;
  setName: string;
  added: number;
  updated: number;
  total: number;
  /** Cartes ignorées (rareté non cochée). */
  skipped: number;
}
