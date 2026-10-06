import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { defaultPaymentFor, PAYMENT_METHODS, PLATFORMS } from '../../core/labels';
import { BulkSettings, PaymentMethod, Sale, SaleInput, SalePlatform } from '../../core/models';
import { allocateFifo, ProductGroup } from '../../core/products';
import { SaleService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { toIsoDate } from '../../core/utils';
import { cardsFromGrams, unitPrice } from './bulk';

export interface BulkSellDialogData {
  settings: BulkSettings;
  /** Catégories de bulk ayant du stock. */
  products: ProductGroup[];
  category?: string;
}

/**
 * Vente d'un lot de bulk : nombre de cartes (ou poids) + prix du lot.
 * Les cartes sont prélevées sur les lots les plus anciens (FIFO) ; une vente classique est créée,
 * donc le CA, l'URSSAF, le livre des recettes et les statistiques sont à jour.
 */
@Component({
  selector: 'app-bulk-sell-dialog',
  imports: [
    FormsModule, CurrencyPipe, DecimalPipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule, MatDatepickerModule
  ],
  template: `
    @let r = result();
    <h2 mat-dialog-title>Vendre un lot de bulk</h2>
    <mat-dialog-content class="bulk-dialog">
      <mat-form-field class="full">
        <mat-label>Catégorie</mat-label>
        <mat-select [ngModel]="category()" (ngModelChange)="changeCategory($event)">
          @for (p of data.products; track p.key) {
            <mat-option [value]="p.name">{{ p.name }} — {{ p.remaining | number }} cartes</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <div class="count-row">
        <mat-button-toggle-group [ngModel]="mode()" (ngModelChange)="mode.set($event)">
          <mat-button-toggle value="count">Nombre de cartes</mat-button-toggle>
          <mat-button-toggle value="weight"><mat-icon>scale</mat-icon> Au poids</mat-button-toggle>
        </mat-button-toggle-group>
        @if (mode() === 'count') {
          <mat-form-field>
            <mat-label>Cartes</mat-label>
            <input matInput type="number" min="1" step="1" [ngModel]="count()" (ngModelChange)="count.set(+$event)">
            <mat-hint>{{ product()?.remaining ?? 0 | number }} en stock</mat-hint>
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>Poids</mat-label>
            <input matInput type="number" min="0" step="10" [ngModel]="grams()" (ngModelChange)="grams.set(+$event)">
            <span matTextSuffix>g</span>
            <mat-hint>≈ {{ cards() | number }} cartes</mat-hint>
          </mat-form-field>
        }
      </div>

      <div class="quick-lots">
        @for (n of [50, 100, 200, 500, 1000]; track n) {
          <button mat-stroked-button type="button" (click)="mode.set('count'); count.set(n)">{{ n }}</button>
        }
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Prix du lot</mat-label>
          <input matInput type="number" min="0" step="0.5" [ngModel]="lotPrice()" (ngModelChange)="setPrice(+$event)">
          <span matTextSuffix>€</span>
          <mat-hint>{{ pricePerCard() | currency: 'EUR' : 'symbol' : '1.2-4' }} par carte
            @if (suggested() > 0) { · conseillé {{ suggested() | currency }} }</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Frais (commission, envoi)</mat-label>
          <input matInput type="number" min="0" step="0.5" [ngModel]="fees()" (ngModelChange)="fees.set(+$event)">
          <span matTextSuffix>€</span>
        </mat-form-field>
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Plateforme</mat-label>
          <mat-select [(ngModel)]="platform" (ngModelChange)="paymentMethod = defaultPayment($event)">
            @for (p of platforms; track p.value) {
              <mat-option [value]="p.value">{{ p.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Mode de paiement</mat-label>
          <mat-select [(ngModel)]="paymentMethod">
            @for (p of payments; track p.value) {
              <mat-option [value]="p.value">{{ p.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Client</mat-label>
          <input matInput [(ngModel)]="customer" placeholder="Pseudo ou nom (facultatif)">
        </mat-form-field>
        <mat-form-field>
          <mat-label>Date</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="date">
          <mat-datepicker-toggle matIconSuffix [for]="picker" />
          <mat-datepicker #picker />
        </mat-form-field>
      </div>


      <div class="summary" [class.negative-box]="r.profit < 0">
        @if (r.missing) {
          <span class="negative"><mat-icon>warning</mat-icon> Stock insuffisant : {{ product()?.remaining ?? 0 | number }} cartes disponibles.</span>
        } @else {
          <div><span>Coût des cartes</span><strong>{{ r.cost | currency }}</strong></div>
          <div><span>Frais</span><strong>{{ fees() | currency }}</strong></div>
          <div><span>Bénéfice</span><strong [class.positive]="r.profit >= 0" [class.negative]="r.profit < 0">{{ r.profit | currency }}</strong></div>
          <div><span>Marge</span><strong>{{ r.margin | number: '1.0-0' }} %</strong></div>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-flat-button (click)="save()" [disabled]="saving() || r.missing || cards() < 1">
        Vendre {{ cards() | number }} carte(s) pour {{ lotPrice() | currency }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bulk-dialog { display: flex; flex-direction: column; gap: 10px; min-width: min(580px, 80vw); }
    .full { width: 100%; }
    .count-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .count-row mat-form-field { flex: 1; min-width: 160px; }
    .quick-lots { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -4px; }
    .quick-lots button { min-width: 0; padding: 0 10px; }
    mat-button-toggle mat-icon { margin-right: 4px; vertical-align: -6px; }
    .summary {
      display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 12px 14px; border-radius: 10px; background: #f5f6fa;
      div { display: flex; flex-direction: column; }
      span { font-size: 12px; color: var(--app-muted); }
      strong { font-size: 16px; }
      mat-icon { vertical-align: -6px; }
    }
    .negative-box { background: #fff5f5; }
  `
})
export class BulkSellDialogComponent {
  readonly data = inject<BulkSellDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(SaleService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<BulkSellDialogComponent, Sale>);

  readonly platforms = PLATFORMS;
  readonly payments = PAYMENT_METHODS;
  platform: SalePlatform = 'Cardmarket';
  paymentMethod: PaymentMethod = defaultPaymentFor('Cardmarket');
  customer = '';
  date = new Date();

  readonly category = signal(this.data.category ?? this.data.products[0]?.name ?? '');
  readonly mode = signal<'count' | 'weight'>('count');
  readonly count = signal(100);
  readonly grams = signal(0);
  readonly fees = signal(0);
  /** Prix saisi à la main ; null = prix conseillé, recalculé avec le nombre de cartes. */
  private readonly manualPrice = signal<number | null>(null);
  readonly saving = signal(false);

  readonly product = computed(() => this.data.products.find(p => p.name === this.category()));
  readonly cards = computed(() =>
    this.mode() === 'count' ? Math.max(0, Math.floor(this.count() || 0)) : cardsFromGrams(this.grams(), this.data.settings.gramsPerCard));

  /** Prix conseillé : nombre de cartes × prix conseillé par carte de la catégorie. */
  readonly suggested = computed(() => {
    const perCard = this.data.settings.categories.find(c => c.name === this.category())?.suggestedPricePerCard ?? 0;
    return Math.round(this.cards() * perCard * 100) / 100;
  });

  readonly lotPrice = computed(() => this.manualPrice() ?? this.suggested());
  readonly pricePerCard = computed(() => unitPrice(this.lotPrice(), this.cards()));

  /** Coût FIFO réel des cartes vendues, bénéfice et marge. */
  readonly result = computed(() => {
    const product = this.product();
    const allocation = product ? allocateFifo(product.lots, this.cards()) : null;
    if (!allocation) return { missing: true, cost: 0, profit: 0, margin: 0 };
    const cost = allocation.reduce((sum, a) => sum + a.quantity * a.lot.purchasePrice, 0);
    const profit = this.lotPrice() - cost - (this.fees() || 0);
    return { missing: false, cost, profit, margin: this.lotPrice() > 0 ? (profit / this.lotPrice()) * 100 : 0 };
  });

  defaultPayment(platform: SalePlatform): PaymentMethod {
    return defaultPaymentFor(platform);
  }

  setPrice(value: number): void {
    this.manualPrice.set(isNaN(value) ? 0 : value);
  }

  /** Nouvelle catégorie : on revient au prix conseillé de cette catégorie. */
  changeCategory(name: string): void {
    this.category.set(name);
    this.manualPrice.set(null);
  }

  save(): void {
    const product = this.product();
    const quantity = this.cards();
    const allocation = product ? allocateFifo(product.lots, quantity) : null;
    if (!product || !allocation || quantity < 1) {
      this.notify.error(null, 'Stock de bulk insuffisant pour ce lot.');
      return;
    }
    const perCard = this.pricePerCard();
    const input: SaleInput = {
      saleDate: toIsoDate(this.date),
      customer: this.customer.trim() || null,
      platform: this.platform,
      paymentMethod: this.paymentMethod,
      fees: this.fees() || 0,
      comment: `Lot de ${quantity} cartes (${product.name})` + (this.mode() === 'weight' ? ` · ${this.grams()} g` : ''),
      customerAddress: null,
      customerSiren: null,
      // Une ligne par lot de bulk utilisé, au même prix par carte.
      items: allocation.map(a => ({ inventoryItemId: a.lot.id, quantity: a.quantity, salePrice: perCard }))
    };
    this.saving.set(true);
    this.api.create(input).subscribe({
      next: sale => {
        this.notify.success(`Lot vendu (${sale.saleNumber}) — bénéfice ${sale.profit.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}.`);
        this.ref.close(sale);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
