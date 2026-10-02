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
import { InventoryItem, PaymentMethod, Sale, SaleInput, SalePlatform, SaleRefund } from '../../core/models';
import { InventoryService, SaleService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';
import { AttachmentsComponent } from '../../shared/attachments.component';
import { LabelPipe } from '../../shared/label.pipe';
import { RefundDialogComponent } from './refund-dialog.component';

/** Formulaire d'une ligne de vente. `search` est le texte affiché dans le champ de recherche d'article. */
type SaleLineForm = FormGroup<{
  inventoryItemId: FormControl<number | null>;
  search: FormControl<string>;
  quantity: FormControl<number>;
  salePrice: FormControl<number>;
}>;

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

  readonly platforms = PLATFORMS;
  readonly isEdit = computed(() => !!this.id());
  readonly sale = signal<Sale | null>(null);
  readonly inventory = signal<InventoryItem[]>([]);
  readonly itemsById = computed(() => new Map(this.inventory().map(i => [i.id, i])));
  readonly loading = signal(true);
  readonly saving = signal(false);

  /** En modification : quantités et coûts déjà réservés par la vente d'origine, par article. */
  private readonly originalQuantities = new Map<number, number>();
  private readonly originalCosts = new Map<number, number>();

  readonly form = this.fb.group({
    saleDate: this.fb.control<Date>(new Date(), Validators.required),
    customer: ['', Validators.maxLength(150)],
    platform: this.fb.control<SalePlatform>('Cardmarket', Validators.required),
    paymentMethod: this.fb.control<PaymentMethod>('Platform', Validators.required),
    fees: [0, [Validators.min(0)]],
    comment: ['', Validators.maxLength(1000)],
    // Facturation (clients professionnels)
    customerAddress: ['', Validators.maxLength(500)],
    customerSiren: ['', Validators.pattern(/^[0-9 ]{9,17}$/)],
    items: this.fb.array<SaleLineForm>([])
  });

  readonly payments = PAYMENT_METHODS;
  private readonly dialog = inject(MatDialog);

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
          // Pré-sélection depuis l'inventaire : /sales/new?item=12
          const preselected = this.itemsById().get(Number(this.route.snapshot.queryParamMap.get('item')));
          const line = this.createLine();
          if (preselected) this.selectItem(line, preselected);
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
    for (const line of sale.items) {
      this.originalQuantities.set(line.inventoryItemId, (this.originalQuantities.get(line.inventoryItemId) ?? 0) + line.quantity);
      this.originalCosts.set(line.inventoryItemId, line.unitCost);
    }
    this.form.patchValue({
      saleDate: parseApiDate(sale.saleDate),
      customer: sale.customer ?? '',
      platform: sale.platform,
      paymentMethod: sale.paymentMethod,
      fees: sale.fees,
      comment: sale.comment ?? '',
      customerAddress: sale.customerAddress ?? '',
      customerSiren: sale.customerSiren ?? ''
    }, { emitEvent: false });
    this.items.clear();
    sale.items.forEach(l => this.items.push(this.createLine(l.inventoryItemId, l.itemName, l.quantity, l.salePrice)));
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
      this.originalQuantities.clear();
      this.originalCosts.clear();
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

  private createLine(itemId: number | null = null, search = '', quantity = 1, salePrice = 0): SaleLineForm {
    return this.fb.group({
      inventoryItemId: this.fb.control<number | null>(itemId, Validators.required),
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

  // ----- Recherche d'articles -----

  /** Stock utilisable pour un article (stock restant + quantité déjà comptée dans la vente modifiée). */
  stockFor(item: InventoryItem): number {
    return item.remainingQuantity + (this.originalQuantities.get(item.id) ?? 0);
  }

  filterItems(term: string): InventoryItem[] {
    const t = (term ?? '').toLowerCase().trim();
    return this.inventory()
      .filter(i => this.stockFor(i) > 0)
      .filter(i => !t || `${i.id} ${i.name} ${i.category ?? ''} ${i.location ?? ''}`.toLowerCase().includes(t))
      .slice(0, 50);
  }

  selectItem(line: SaleLineForm, item: InventoryItem): void {
    line.patchValue({ inventoryItemId: item.id, search: item.name });
  }

  /** Dès que l'utilisateur retape du texte, la sélection précédente est annulée. */
  clearSelection(line: SaleLineForm): void {
    line.controls.inventoryItemId.setValue(null);
  }

  selectedItem(line: SaleLineForm): InventoryItem | undefined {
    const id = line.controls.inventoryItemId.value;
    return id ? this.itemsById().get(id) : undefined;
  }

  /** Quantité encore disponible pour cette ligne, en tenant compte des autres lignes du même article. */
  availableFor(line: SaleLineForm): number {
    const item = this.selectedItem(line);
    if (!item) return 0;
    const usedElsewhere = this.items.controls
      .filter(l => l !== line && l.controls.inventoryItemId.value === item.id)
      .reduce((sum, l) => sum + (l.controls.quantity.value || 0), 0);
    return this.stockFor(item) - usedElsewhere;
  }

  unitCost(itemId: number | null): number {
    if (!itemId) return 0;
    return this.originalCosts.get(itemId) ?? this.itemsById().get(itemId)?.purchasePrice ?? 0;
  }

  // ----- Calculs automatiques -----

  lineTotal(line: SaleLineForm): number {
    const v = line.getRawValue();
    return (v.quantity || 0) * (v.salePrice || 0);
  }

  lineProfit(line: SaleLineForm): number {
    const v = line.getRawValue();
    return (v.quantity || 0) * ((v.salePrice || 0) - this.unitCost(v.inventoryItemId));
  }

  totals(): { total: number; cost: number; fees: number; profit: number; margin: number } {
    let total = 0;
    let cost = 0;
    for (const line of this.items.controls) {
      const v = line.getRawValue();
      total += this.lineTotal(line);
      cost += (v.quantity || 0) * this.unitCost(v.inventoryItemId);
    }
    const fees = this.form.controls.fees.value || 0;
    const profit = total - cost - fees;
    return { total, cost, fees, profit, margin: total > 0 ? (profit / total) * 100 : 0 };
  }

  save(): void {
    if (this.form.invalid || this.items.length === 0) {
      this.form.markAllAsTouched();
      this.notify.error(null, 'Sélectionnez un article dans la liste pour chaque ligne et complétez les champs.');
      return;
    }
    const overStock = this.items.controls.find(l => (l.controls.quantity.value || 0) > this.availableFor(l));
    if (overStock) {
      this.notify.error(null, `Stock insuffisant pour « ${this.selectedItem(overStock)?.name} ».`);
      return;
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
      items: v.items.map(l => ({ inventoryItemId: l.inventoryItemId!, quantity: l.quantity, salePrice: l.salePrice }))
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
