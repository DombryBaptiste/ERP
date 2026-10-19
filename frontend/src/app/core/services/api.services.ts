import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Alerts, AppPreferences, Attachment, AttachmentKind, AttachmentOwner, AvailableSet, BulkSettings, CatalogCard, CatalogImportResult,
  CardLanguage, CatalogDeleteResult, CatalogSet, Dashboard, RarityGroup, InventoryItem, InventoryItemInput,
  Purchase, PurchaseInput, RefundInput, Sale, SaleInput, ShippingSummary, ShippingSupply, ShippingSupplyInput, Statistics,
  TaxSettings, TaxSummary
} from '../models';

/** Accès aux endpoints REST /api/purchases */
@Injectable({ providedIn: 'root' })
export class PurchaseService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/purchases';

  getAll(): Observable<Purchase[]> { return this.http.get<Purchase[]>(this.url); }
  get(id: number): Observable<Purchase> { return this.http.get<Purchase>(`${this.url}/${id}`); }
  create(input: PurchaseInput): Observable<Purchase> { return this.http.post<Purchase>(this.url, input); }
  update(id: number, input: PurchaseInput): Observable<Purchase> { return this.http.put<Purchase>(`${this.url}/${id}`, input); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.url}/${id}`); }
}

/** Accès aux endpoints REST /api/inventory */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/inventory';

  getAll(status?: 'instock' | 'sold'): Observable<InventoryItem[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<InventoryItem[]>(this.url, { params });
  }
  categories(): Observable<string[]> { return this.http.get<string[]>(`${this.url}/categories`); }
  get(id: number): Observable<InventoryItem> { return this.http.get<InventoryItem>(`${this.url}/${id}`); }
  create(input: InventoryItemInput): Observable<InventoryItem> { return this.http.post<InventoryItem>(this.url, input); }
  update(id: number, input: InventoryItemInput): Observable<InventoryItem> { return this.http.put<InventoryItem>(`${this.url}/${id}`, input); }
  /** Met à jour uniquement la valeur de marché estimée (null pour l'effacer). */
  setMarketValue(id: number, value: number | null): Observable<InventoryItem> {
    return this.http.put<InventoryItem>(`${this.url}/${id}/market-value`, { value });
  }
  setCardmarketListing(itemIds: number[], isListed: boolean): Observable<void> {
    return this.http.put<void>(`${this.url}/cardmarket-listing`, { itemIds, isListed });
  }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.url}/${id}`); }
}

/** Accès aux endpoints REST /api/sales */
@Injectable({ providedIn: 'root' })
export class SaleService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/sales';

  getAll(): Observable<Sale[]> { return this.http.get<Sale[]>(this.url); }
  get(id: number): Observable<Sale> { return this.http.get<Sale>(`${this.url}/${id}`); }
  create(input: SaleInput): Observable<Sale> { return this.http.post<Sale>(this.url, input); }
  update(id: number, input: SaleInput): Observable<Sale> { return this.http.put<Sale>(`${this.url}/${id}`, input); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.url}/${id}`); }

  addRefund(id: number, input: RefundInput): Observable<Sale> { return this.http.post<Sale>(`${this.url}/${id}/refunds`, input); }
  deleteRefund(id: number, refundId: number): Observable<Sale> { return this.http.delete<Sale>(`${this.url}/${id}/refunds/${refundId}`); }

  /** Attribue un numéro de facture (une seule fois). */
  issueInvoice(id: number): Observable<Sale> { return this.http.post<Sale>(`${this.url}/${id}/invoice`, {}); }
  invoiceUrl(id: number, download = false): string { return `${this.url}/${id}/invoice${download ? '?download=true' : ''}`; }
}

/** Frais d'envoi : fournitures (timbres, bordereaux, emballages) et synthèse (/api/shipping) */
@Injectable({ providedIn: 'root' })
export class ShippingService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/shipping';

  summary(year?: number): Observable<ShippingSummary> {
    const params = year ? new HttpParams().set('year', year) : undefined;
    return this.http.get<ShippingSummary>(`${this.url}/summary`, { params });
  }
  supplies(year?: number): Observable<ShippingSupply[]> {
    const params = year ? new HttpParams().set('year', year) : undefined;
    return this.http.get<ShippingSupply[]>(`${this.url}/supplies`, { params });
  }
  create(input: ShippingSupplyInput): Observable<ShippingSupply> { return this.http.post<ShippingSupply>(`${this.url}/supplies`, input); }
  update(id: number, input: ShippingSupplyInput): Observable<ShippingSupply> {
    return this.http.put<ShippingSupply>(`${this.url}/supplies/${id}`, input);
  }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.url}/supplies/${id}`); }
}

/** Réglages du bulk (/api/bulk/settings) */
@Injectable({ providedIn: 'root' })
export class BulkService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/bulk/settings';

  settings(): Observable<BulkSettings> { return this.http.get<BulkSettings>(this.url); }
  saveSettings(settings: BulkSettings): Observable<BulkSettings> { return this.http.put<BulkSettings>(this.url, settings); }
}

/** Fichiers joints (/api/attachments) */
@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/attachments';

  list(ownerType: AttachmentOwner, ownerId: number): Observable<Attachment[]> {
    const params = new HttpParams().set('ownerType', ownerType).set('ownerId', ownerId);
    return this.http.get<Attachment[]>(this.url, { params });
  }
  upload(ownerType: AttachmentOwner, ownerId: number, kind: AttachmentKind, file: File): Observable<Attachment> {
    const form = new FormData();
    form.append('ownerType', ownerType);
    form.append('ownerId', String(ownerId));
    form.append('kind', kind);
    form.append('file', file, file.name);
    return this.http.post<Attachment>(this.url, form);
  }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.url}/${id}`); }
  reorderPhotos(ownerType: AttachmentOwner, ownerId: number, attachmentIds: number[]): Observable<void> {
    return this.http.put<void>(`${this.url}/order`, { ownerType, ownerId, attachmentIds });
  }
  fileUrl(id: number): string { return `${this.url}/${id}/file`; }
}

/** Alertes (/api/alerts), préférences (/api/settings) et exports comptables (/api/exports) */
@Injectable({ providedIn: 'root' })
export class ToolsService {
  private readonly http = inject(HttpClient);

  alerts(): Observable<Alerts> { return this.http.get<Alerts>('/api/alerts'); }
  preferences(): Observable<AppPreferences> { return this.http.get<AppPreferences>('/api/settings'); }
  savePreferences(prefs: AppPreferences): Observable<AppPreferences> { return this.http.put<AppPreferences>('/api/settings', prefs); }

  /** URL de téléchargement d'un registre ('receipts' = livre des recettes, 'purchases' = registre des achats). */
  exportUrl(book: 'receipts' | 'purchases', year: number, format: 'xlsx' | 'pdf'): string {
    return `/api/exports/${book}?year=${year}&format=${format}`;
  }
}

/** Tableau de bord et statistiques */
@Injectable({ providedIn: 'root' })
export class ReportingService {
  private readonly http = inject(HttpClient);

  dashboard(): Observable<Dashboard> { return this.http.get<Dashboard>('/api/dashboard'); }

  statistics(year?: number): Observable<Statistics> {
    const params = year ? new HttpParams().set('year', year) : undefined;
    return this.http.get<Statistics>('/api/statistics', { params });
  }
}

/** Fiscalité micro-entreprise (/api/tax) */
@Injectable({ providedIn: 'root' })
export class TaxService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/tax';

  summary(year?: number): Observable<TaxSummary> {
    const params = year ? new HttpParams().set('year', year) : undefined;
    return this.http.get<TaxSummary>(`${this.url}/summary`, { params });
  }
  settings(): Observable<TaxSettings> { return this.http.get<TaxSettings>(`${this.url}/settings`); }
  saveSettings(settings: TaxSettings): Observable<TaxSettings> { return this.http.put<TaxSettings>(`${this.url}/settings`, settings); }
  setDeclared(periodKey: string, declared: boolean): Observable<void> {
    return this.http.put<void>(`${this.url}/declarations/${periodKey}`, { declared });
  }
}

/** Catalogue des cartes (/api/catalog) : import TCGdex, cotes, recherche */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/catalog';

  sets(): Observable<CatalogSet[]> { return this.http.get<CatalogSet[]>(`${this.url}/sets`); }
  availableSets(language: CardLanguage): Observable<AvailableSet[]> {
    return this.http.get<AvailableSet[]>(`${this.url}/available-sets`, { params: { language } });
  }

  importSet(setId: string, language: CardLanguage, groups: RarityGroup[]): Observable<CatalogImportResult> {
    let params = new HttpParams().set('language', language);
    groups.forEach(g => params = params.append('groups', g));
    return this.http.post<CatalogImportResult>(`${this.url}/sets/${encodeURIComponent(setId)}/import`, {}, { params });
  }

  cards(filter: { language?: CardLanguage; setId?: string; search?: string; quotedOnly?: boolean; take?: number }): Observable<CatalogCard[]> {
    let params = new HttpParams();
    if (filter.language) params = params.set('language', filter.language);
    if (filter.setId) params = params.set('setId', filter.setId);
    if (filter.search) params = params.set('search', filter.search);
    if (filter.quotedOnly) params = params.set('quotedOnly', true);
    if (filter.take) params = params.set('take', filter.take);
    return this.http.get<CatalogCard[]>(`${this.url}/cards`, { params });
  }

  setQuote(id: number, quote: number | null): Observable<CatalogCard> {
    return this.http.put<CatalogCard>(`${this.url}/cards/${id}/quote`, { quote });
  }

  deleteCard(id: number): Observable<CatalogDeleteResult> {
    return this.http.delete<CatalogDeleteResult>(`${this.url}/cards/${id}`);
  }

  deleteSet(setId: string, language: CardLanguage): Observable<CatalogDeleteResult> {
    return this.http.delete<CatalogDeleteResult>(`${this.url}/sets/${encodeURIComponent(setId)}`, { params: { language } });
  }
}

