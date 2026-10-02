/**
 * Modèles échangés avec l'API. Les dates arrivent au format ISO "2026-09-30T00:00:00"
 * et sont envoyées au format "2026-09-30".
 */

export type ItemType = 'RawCard' | 'GradedCard' | 'Booster' | 'Blister' | 'Etb' | 'Box' | 'Display' | 'MiniTin' | 'Bundle' | 'Other';
export type ItemCondition = 'New' | 'Excellent' | 'VeryGood' | 'Good' | 'Fair';
export type SalePlatform = 'Cardmarket' | 'Ebay' | 'Vinted' | 'Leboncoin' | 'FacebookMarketplace' | 'InPerson' | 'Other';
/** Supplier = achat classique ; PersonalCollection = transfert depuis la collection personnelle. */
export type PurchaseSource = 'Supplier' | 'PersonalCollection';
export type PurchasePlatform = 'Cardmarket' | 'Ebay' | 'Vinted' | 'Leboncoin' | 'FacebookMarketplace' | 'Amazon' | 'Store' | 'Other';
export type ItemOrigin = 'Purchase' | 'PersonalCollection' | 'Manual';
export type PaymentMethod = 'Platform' | 'BankTransfer' | 'PayPal' | 'Card' | 'Cash' | 'Check' | 'Other';
export type AttachmentOwner = 'InventoryItem' | 'Purchase' | 'Sale';
export type AttachmentKind = 'Photo' | 'Receipt' | 'Listing' | 'OriginProof' | 'Other';

// ----- Inventaire -----
export interface InventoryItem {
  id: number;
  name: string;
  category: string | null;
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
  type: ItemType;
  condition: ItemCondition;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  location: string | null;
  remainingQuantity: number;
  soldQuantity: number;
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
  totalAmount: number;
  itemCount: number;
  items: PurchaseLine[];
}

export interface PurchaseLineInput {
  itemId: number | null;
  name: string;
  category: string | null;
  type: ItemType;
  condition: ItemCondition;
  quantity: number;
  unitPrice: number;
  location: string | null;
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
  saleDate: string;
  customer: string | null;
  platform: SalePlatform;
  totalAmount: number;
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
}

// ----- Alertes -----
export interface AlertSettings {
  dormantWarningDays: number;
  dormantCriticalDays: number;
  marketGainThreshold: number;
  marketRiseThreshold: number;
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

export interface AppPreferences {
  company: CompanyInfo;
  alerts: AlertSettings;
}