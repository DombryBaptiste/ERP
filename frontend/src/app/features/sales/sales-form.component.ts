import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin, Observable, of } from 'rxjs';
import { defaultPaymentFor, PAYMENT_METHODS, PLATFORMS } from '../../core/labels';
import { InventoryItem, PaymentMethod, Sale, SaleInput, SaleLineInput, SalePlatform, SaleRefund } from '../../core/models';
import { groupProducts, ProductGroup, productKey } from '../../core/products';
import { InventoryService, SaleService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';
import { AttachmentsComponent } from '../../shared/attachments.component';
import { LabelPipe } from '../../shared/label.pipe';
import { RefundDialogComponent } from './refund-dialog.component';

/**
 * Formulaire d'une ligne de vente : on vend un PRODUIT (tous ses lots confondus).
 * `search` est le texte affiché dans le champ de recherche.
 */
type SaleLineForm = FormGroup<{
  productKey: FormControl<string | null>;
  search: FormControl<string>;
  quantity: FormControl<number>;
  salePrice: FormControl<number>;
}>;

/** Part d'une ligne prélevée sur un lot. */
interface LotAllocation {
  lot: InventoryItem;
  quantity: number;
}

interface LineAllocation {
  lots: LotAllocation[];
  /** Quantité demandée qui ne peut pas être servie (stock insuffisant). */
  missing: number;
}

@Component({
  selector: 'app-sales-form',
  imports: [
    ReactiveFormsModule, RouterLink, CurrencyPipe, DecimalPipe, DatePipe, LabelPipe, AttachmentsComponent,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDatepickerModule,
    MatAutocompleteModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './sales-form.component.html'
})
export class SalesFormComponent implements OnInit {
  /** Paramètre de route :id (absent en création). */
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(SaleService);
  private readonly inventoryApi = inject(InventoryService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);

  readonly platforms = PLATFORMS;
  readonly payments = PAYMENT_METHODS;
  readonly isEdit = computed(() => !!this.id());
  readonly sale = signal<Sale | null>(null);
  readonly inventory = signal<InventoryItem[]>([]);
  readonly itemsById = computed(() => new Map(this.inventory().map(i => [i.id, i])));
  /** Produits (lots regroupés), lots triés du plus ancien au plus récent. */
  readonly products = computed(() => groupProducts(this.inventory()));
  readonly productsByKey = computed(() => new Map(this.products().map(p => [p.key, p])));
  readonly loading = signal(true);
  readonly saving = signal(false);

  /** En modification : quantités et coûts déjà réservés par la vente d'origine, par lot. */
  private readonly originalQuantities = new Map<number, number>();
  private readonly originalCosts = new Map<number, number>();
  /** Lignes d'origine (par lot), renvoyées telles quelles quand la vente est figée par un remboursement. */
  private originalLines: SaleLineInput[] = [];

  readonly form = this.fb.group({
    saleDate: this.fb.control<Date>(new Date(), Validators.required),
    customer: ['', Validators.maxLength(150)],
    platform: this.fb.control<SalePlatform>('Cardmarket', Validators.required),
    paymentMethod: this.fb.control<PaymentMethod>('Platform', Validators.required),
    fees: [0, [Validators.min(0)]],
    comment: ['', Validators.maxLength(1000)],
    amountPaid: [0, [Validators.min(0)]],
    trackingNumber: ['', Validators.maxLength(100)],
    // Facturation (clients professionnels)
    customerAddress: ['', Validators.maxLength(500)],
    customerSiren: ['', Validators.pattern(/^[0-9 ]{9,17}$/)],
    items: this.fb.array<SaleLineForm>([])
  });

  /** Les articles sont figés dès qu'un remboursement existe. */
  readonly locked = computed(() => (this.sale()?.refunds.length ?? 0) > 0);

  get items() {
    return this.form.controls.items;
  }

  constructor() {
    // Mode de paiement proposé selon la plateforme, tant que l'utilisateur ne l'a pas choisi lui-même.
    this.form.controls.platform.valueChanges.subscribe(platform => {
      const payment = this.form.controls.paymentMethod;
      if (payment.pristine) payment.setValue(defaultPaymentFor(platform));
    });
  }

  ngOnInit(): void {
    const id = this.id();
    const sale$: Observable<Sale | null> = id ? this.api.get(+id) : of(null);

    forkJoin({ inventory: this.inventoryApi.getAll(), sale: sale$ }).subscribe({
      next: ({ inventory, sale }) => {
        this.inventory.set(inventory);
        if (sale) {
          this.loadSale(sale);
        } else {
          // Pré-sélection depuis l'inventaire : /sales/new?item=12 (n'importe quel lot du produit)
          const lot = this.itemsById().get(Number(this.route.snapshot.queryParamMap.get('item')));
          const line = this.createLine();
          const product = lot ? this.productsByKey().get(productKey(lot)) : undefined;
          if (product) this.selectProduct(line, product);
          this.items.push(line);
        }
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.router.navigate(['/sales']);
      }
    });
  }

  private loadSale(sale: Sale): void {
    this.sale.set(sale);
    this.originalQuantities.clear();
    this.originalCosts.clear();
    for (const line of sale.items) {
      this.originalQuantities.set(line.inventoryItemId, (this.originalQuantities.get(line.inventoryItemId) ?? 0) + line.quantity);
      this.originalCosts.set(line.inventoryItemId, line.unitCost);
    }
    this.originalLines = sale.items.map(l => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity, salePrice: l.salePrice }));

    this.form.patchValue({
      saleDate: parseApiDate(sale.saleDate),
      customer: sale.customer ?? '',
      platform: sale.platform,
      paymentMethod: sale.paymentMethod,
      fees: sale.fees,
      comment: sale.comment ?? '',
      amountPaid: sale.amountPaid,
      trackingNumber: sale.trackingNumber ?? '',
      customerAddress: sale.customerAddress ?? '',
      customerSiren: sale.customerSiren ?? ''
    }, { emitEvent: false });

    // Les lignes enregistrées par lot sont regroupées par produit (et par prix de vente).
    this.items.clear();
    const merged = new Map<string, { key: string; name: string; quantity: number; salePrice: number }>();
    for (const l of sale.items) {
      const lot = this.itemsById().get(l.inventoryItemId);
      const key = lot ? productKey(lot) : `lot-${l.inventoryItemId}`;
      const mergeKey = `${key}|${l.salePrice}`;
      const existing = merged.get(mergeKey);
      if (existing) existing.quantity += l.quantity;
      else merged.set(mergeKey, { key, name: l.itemName, quantity: l.quantity, salePrice: l.salePrice });
    }
    merged.forEach(m => this.items.push(this.createLine(m.key, m.name, m.quantity, m.salePrice)));

    if (sale.refunds.length) this.items.disable();
    this.form.markAsPristine();
  }

  // ----- Remboursements -----

  openRefund(): void {
    const sale = this.sale();
    if (!sale) return;
    this.dialog.open(RefundDialogComponent, { data: sale, width: '640px' }).afterClosed().subscribe((updated?: Sale) => {
      if (updated) this.refreshAfterRefund(updated);
    });
  }

  deleteRefund(refund: SaleRefund): void {
    const sale = this.sale();
    if (!sale) return;
    this.notify.confirm({
      title: 'Annuler ce remboursement ?',
      message: 'Les articles remis en stock en seront retirés et le CA sera recalculé.',
      confirmLabel: 'Annuler le remboursement'
    }).subscribe(ok => {
      if (!ok) return;
      this.api.deleteRefund(sale.id, refund.id).subscribe({
        next: updated => {
          this.notify.success('Remboursement annulé.');
          this.refreshAfterRefund(updated);
        },
        error: err => this.notify.error(err)
      });
    });
  }

  /** Recharge l'inventaire (stock modifié par les retours) et la vente. */
  private refreshAfterRefund(sale: Sale): void {
    this.inventoryApi.getAll().subscribe(inventory => {
      this.inventory.set(inventory);
      this.items.enable();
      this.loadSale(sale);
    });
  }

  // ----- Facture -----

  /** Émet la facture (numéro attribué une seule fois) puis l'ouvre dans un nouvel onglet. */
  invoice(): void {
    const sale = this.sale();
    if (!sale) return;
    if (this.form.dirty) {
      this.notify.error(null, "Enregistrez d'abord vos modifications avant d'éditer la facture.");
      return;
    }
    const url = this.api.invoiceUrl(sale.id);
    if (sale.invoiceNumber) {
      window.open(url, '_blank');
      return;
    }
    this.notify.confirm({
      title: 'Émettre une facture ?',
      message: `Un numéro de facture définitif sera attribué à la vente ${sale.saleNumber} (il ne pourra plus être supprimé). Vérifiez le nom et l'adresse du client.`,
      confirmLabel: 'Émettre la facture'
    }).subscribe(ok => {
      if (!ok) return;
      // Onglet ouvert tout de suite (au clic) pour ne pas être bloqué comme fenêtre surgissante.
      const tab = window.open('', '_blank');
      this.api.issueInvoice(sale.id).subscribe({
        next: updated => {
          this.sale.set(updated);
          this.notify.success(`Facture ${updated.invoiceNumber} émise.`);
          if (tab) tab.location.href = url;
          else window.open(url, '_blank');
        },
        error: err => {
          tab?.close();
          this.notify.error(err);
        }
      });
    });
  }

  // ----- Lignes -----

  private createLine(key: string | null = null, search = '', quantity = 1, salePrice = 0): SaleLineForm {
    return this.fb.group({
      productKey: this.fb.control<string | null>(key, Validators.required),
      search: this.fb.control(search),
      quantity: this.fb.control(quantity, [Validators.required, Validators.min(1)]),
      salePrice: this.fb.control(salePrice, [Validators.required, Validators.min(0)])
    });
  }

  addLine(): void {
    this.items.push(this.createLine());
  }

  removeLine(index: number): void {
    this.items.removeAt(index);
  }

  // ----- Recherche de produits -----

  /** Stock utilisable d'un lot (stock restant + quantité déjà comptée dans la vente modifiée). */
  lotStock(lot: InventoryItem): number {
    return lot.remainingQuantity + (this.originalQuantities.get(lot.id) ?? 0);
  }

  productStock(product: ProductGroup): number {
    return product.lots.reduce((sum, lot) => sum + this.lotStock(lot), 0);
  }

  /** Coût unitaire d'un lot (coût historique si le lot figurait déjà dans la vente). */
  lotCost(lot: InventoryItem): number {
    return this.originalCosts.get(lot.id) ?? lot.purchasePrice;
  }

  /** Coût moyen des unités disponibles d'un produit. */
  productAverageCost(product: ProductGroup): number {
    const stock = this.productStock(product);
    if (stock === 0) return product.averageCost;
    return product.lots.reduce((sum, lot) => sum + this.lotStock(lot) * this.lotCost(lot), 0) / stock;
  }

  filterProducts(term: string): ProductGroup[] {
    const t = (term ?? '').toLowerCase().trim();
    return this.products()
      .filter(p => this.productStock(p) > 0)
      .filter(p => !t || p.lots.some(l =>
        `${l.id} ${l.name} ${l.category ?? ''} ${l.location ?? ''} ${l.purchaseNumber ?? ''}`.toLowerCase().includes(t)))
      .slice(0, 50);
  }

  selectProduct(line: SaleLineForm, product: ProductGroup): void {
    line.patchValue({ productKey: product.key, search: product.name });
  }

  /** Dès que l'utilisateur retape du texte, la sélection précédente est annulée. */
  clearSelection(line: SaleLineForm): void {
    line.controls.productKey.setValue(null);
  }

  selectedProduct(line: SaleLineForm): ProductGroup | undefined {
    const key = line.controls.productKey.value;
    return key ? this.productsByKey().get(key) : undefined;
  }

  /** Quantité encore disponible pour cette ligne, en tenant compte des autres lignes du même produit. */
  availableFor(line: SaleLineForm): number {
    const product = this.selectedProduct(line);
    if (!product) return 0;
    const usedElsewhere = this.items.controls
      .filter(l => l !== line && l.controls.productKey.value === product.key)
      .reduce((sum, l) => sum + (l.controls.quantity.value || 0), 0);
    return this.productStock(product) - usedElsewhere;
  }

  /**
   * Répartition FIFO de chaque ligne sur les lots de son produit : les lots les plus anciens
   * sont vendus en premier. Plusieurs lignes du même produit se partagent les lots dans l'ordre.
   */
  private allocate(): Map<SaleLineForm, LineAllocation> {
    const left = new Map<number, number>();
    const result = new Map<SaleLineForm, LineAllocation>();
    for (const line of this.items.controls) {
      const product = this.selectedProduct(line);
      let wanted = line.controls.quantity.value || 0;
      const lots: LotAllocation[] = [];
      for (const lot of product?.lots ?? []) {
        if (wanted <= 0) break;
        const available = left.get(lot.id) ?? this.lotStock(lot);
        const take = Math.min(available, wanted);
        if (take > 0) {
          lots.push({ lot, quantity: take });
          left.set(lot.id, available - take);
          wanted -= take;
        }
      }
      result.set(line, { lots, missing: Math.max(0, wanted) });
    }
    return result;
  }

  allocationFor(line: SaleLineForm): LineAllocation {
    return this.allocate().get(line) ?? { lots: [], missing: 0 };
  }

  /** Résumé des lots utilisés, ex. « A2025001 ×2 à 4,50 € + A2026003 ×1 à 6,00 € ». */
  lotsSummary(line: SaleLineForm): string {
    return this.allocationFor(line).lots
      .map(a => `${a.lot.purchaseNumber ?? '#' + a.lot.id} ×${a.quantity} à ${a.lot.purchasePrice.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`)
      .join(' + ');
  }

  // ----- Calculs automatiques -----

  lineTotal(line: SaleLineForm): number {
    const v = line.getRawValue();
    return (v.quantity || 0) * (v.salePrice || 0);
  }

  /** Coût d'achat réel de la ligne, lot par lot. */
  lineCost(line: SaleLineForm): number {
    return this.allocationFor(line).lots.reduce((sum, a) => sum + a.quantity * this.lotCost(a.lot), 0);
  }

  lineProfit(line: SaleLineForm): number {
    return this.lineTotal(line) - this.lineCost(line);
  }

  totals(): { total: number; netTotal: number; cost: number; fees: number; profit: number; margin: number; amountPaid: number } {
    const allocation = this.allocate();
    let total = 0;
    let cost = 0;
    for (const line of this.items.controls) {
      total += this.lineTotal(line);
      cost += (allocation.get(line)?.lots ?? []).reduce((sum, a) => sum + a.quantity * this.lotCost(a.lot), 0);
    }
    const fees = this.form.controls.fees.value || 0;
    const amountPaid = this.form.controls.amountPaid.value || 0;
    const netTotal = total - fees + amountPaid;
    const profit = total - cost - fees;
    return {
      total,
      netTotal,
      cost,
      fees,
      profit,
      margin: netTotal > 0 ? (profit / netTotal) * 100 : 0,
      amountPaid
    };
  }

  save(): void {
    if (this.form.invalid || this.items.length === 0) {
      this.form.markAllAsTouched();
      this.notify.error(null, 'Sélectionnez un article dans la liste pour chaque ligne et complétez les champs.');
      return;
    }

    let items: SaleLineInput[];
    if (this.locked()) {
      // Vente remboursée : les lignes (par lot) sont renvoyées à l'identique.
      items = this.originalLines;
    } else {
      const allocation = this.allocate();
      const short = this.items.controls.find(l => (allocation.get(l)?.missing ?? 0) > 0);
      if (short) {
        this.notify.error(null, `Stock insuffisant pour « ${this.selectedProduct(short)?.name} ».`);
        return;
      }
      // Une ligne de produit devient une ligne par lot utilisé, au même prix de vente.
      items = this.items.controls.flatMap(line => (allocation.get(line)?.lots ?? []).map(a => ({
        inventoryItemId: a.lot.id,
        quantity: a.quantity,
        salePrice: line.controls.salePrice.value || 0
      })));
    }

    const v = this.form.getRawValue();
    const payload: SaleInput = {
      saleDate: toIsoDate(v.saleDate),
      customer: v.customer.trim() || null,
      platform: v.platform,
      paymentMethod: v.paymentMethod,
      fees: v.fees || 0,
      comment: v.comment.trim() || null,
      customerAddress: v.customerAddress.trim() || null,
      customerSiren: v.customerSiren.replace(/\s/g, '') || null,
      amountPaid: v.amountPaid || 0,
      trackingNumber: v.trackingNumber.trim() || null,
      items
    };

    const id = this.id();
    const request = id ? this.api.update(+id, payload) : this.api.create(payload);
    this.saving.set(true);
    request.subscribe({
      next: s => {
        this.notify.success(`Vente ${s.saleNumber} enregistrée — bénéfice ${s.profit.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}.`);
        this.router.navigate(['/sales']);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
