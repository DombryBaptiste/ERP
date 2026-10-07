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
import { PAYMENT_METHODS } from '../../core/labels';
import { BulkSettings, PaymentMethod, Purchase, PurchaseInput, PurchaseSource } from '../../core/models';
import { PurchaseService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { toIsoDate } from '../../core/utils';
import { BULK_CONDITION, cardsFromGrams, unitPrice } from './bulk';

export interface BulkAddDialogData {
  settings: BulkSettings;
  category?: string;
}

/**
 * Ajout de bulk au stock : on saisit un nombre de cartes (ou un poids) et un coût total.
 * Crée un achat (A…) ou un transfert de collection (C…) d'une seule ligne de type « Bulk ».
 */
@Component({
  selector: 'app-bulk-add-dialog',
  imports: [
    FormsModule, CurrencyPipe, DecimalPipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatButtonToggleModule, MatIconModule, MatDatepickerModule
  ],
  template: `
    <h2 mat-dialog-title>Ajouter du bulk</h2>
    <mat-dialog-content class="bulk-dialog">
      <mat-button-toggle-group [(ngModel)]="source" class="full">
        <mat-button-toggle value="Supplier"><mat-icon>shopping_cart</mat-icon> Acheté</mat-button-toggle>
        <mat-button-toggle value="PersonalCollection"><mat-icon>collections_bookmark</mat-icon> De ma collection</mat-button-toggle>
      </mat-button-toggle-group>

      <mat-form-field class="full">
        <mat-label>Catégorie</mat-label>
        <mat-select [(ngModel)]="category">
          @for (c of data.settings.categories; track c.name) {
            <mat-option [value]="c.name">{{ c.name }}</mat-option>
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
          </mat-form-field>
        } @else {
          <mat-form-field>
            <mat-label>Poids</mat-label>
            <input matInput type="number" min="0" step="10" [ngModel]="grams()" (ngModelChange)="grams.set(+$event)">
            <span matTextSuffix>g</span>
            <mat-hint>≈ {{ cards() | number }} cartes ({{ data.settings.gramsPerCard }} g/carte)</mat-hint>
          </mat-form-field>
        }
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>{{ source === 'PersonalCollection' ? 'Valeur retenue (facultatif)' : 'Prix payé (total)' }}</mat-label>
          <input matInput type="number" min="0" step="0.5" [ngModel]="total()" (ngModelChange)="total.set(+$event)">
          <span matTextSuffix>€</span>
          <mat-hint>soit {{ costPerCard() | currency: 'EUR' : 'symbol' : '1.2-4' }} par carte</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Date</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="date">
          <mat-datepicker-toggle matIconSuffix [for]="picker" />
          <mat-datepicker #picker />
        </mat-form-field>
      </div>

      @if (source === 'Supplier') {
        <div class="two-cols">
          <mat-form-field>
            <mat-label>Fournisseur</mat-label>
            <input matInput [(ngModel)]="supplier" placeholder="ex. Particulier Leboncoin">
          </mat-form-field>
          <mat-form-field>
            <mat-label>Mode de règlement</mat-label>
            <mat-select [(ngModel)]="paymentMethod">
              @for (p of payments; track p.value) {
                <mat-option [value]="p.value">{{ p.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      }

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Rangement</mat-label>
          <input matInput [(ngModel)]="location" placeholder="ex. Boîte à bulk 2">
        </mat-form-field>
        <mat-form-field>
          <mat-label>Commentaire</mat-label>
          <input matInput [(ngModel)]="comment" placeholder="ex. Lot de 3 kg, cartes EV">
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-flat-button (click)="save()" [disabled]="saving() || cards() < 1">
        Ajouter {{ cards() | number }} carte(s)
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bulk-dialog { display: flex; flex-direction: column; gap: 10px; min-width: min(560px, 80vw); }
    .full { width: 100%; }
    .count-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .count-row mat-form-field { flex: 1; min-width: 160px; }
    mat-button-toggle mat-icon { margin-right: 4px; vertical-align: -6px; }
  `
})
export class BulkAddDialogComponent {
  readonly data = inject<BulkAddDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(PurchaseService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<BulkAddDialogComponent, Purchase>);

  readonly payments = PAYMENT_METHODS;
  source: PurchaseSource = 'Supplier';
  category = this.data.category ?? this.data.settings.categories[0]?.name ?? '';
  date = new Date();
  supplier = '';
  paymentMethod: PaymentMethod = 'Cash';
  location = '';
  comment = '';

  readonly mode = signal<'count' | 'weight'>('count');
  readonly count = signal(1000);
  readonly grams = signal(0);
  readonly total = signal(0);
  readonly saving = signal(false);

  readonly cards = computed(() =>
    this.mode() === 'count' ? Math.max(0, Math.floor(this.count() || 0)) : cardsFromGrams(this.grams(), this.data.settings.gramsPerCard));
  readonly costPerCard = computed(() => unitPrice(this.total() || 0, this.cards()));

  save(): void {
    const quantity = this.cards();
    if (!this.category || quantity < 1) {
      this.notify.error(null, 'Choisissez une catégorie et un nombre de cartes.');
      return;
    }
    if (this.source === 'Supplier' && !this.supplier.trim()) {
      this.notify.error(null, 'Indiquez le fournisseur (obligatoire dans le registre des achats).');
      return;
    }
    const weightNote = this.mode() === 'weight' ? `Compté au poids : ${this.grams()} g` : '';
    const input: PurchaseInput = {
      source: this.source,
      purchaseDate: toIsoDate(this.date),
      supplier: this.source === 'Supplier' ? this.supplier.trim() : null,
      platform: null,
      paymentMethod: this.source === 'Supplier' ? this.paymentMethod : null,
      comment: [this.comment.trim(), weightNote].filter(Boolean).join(' · ') || null,
      platformFees: 0,
      shippingFees: 0,
      trackingNumber: null,
      items: [{
        itemId: null,
        name: this.category,
        category: null,
        type: 'Bulk',
        condition: BULK_CONDITION,
        quantity,
        unitPrice: unitPrice(this.total() || 0, quantity),
        location: this.location.trim() || null
      }]
    };
    this.saving.set(true);
    this.api.create(input).subscribe({
      next: purchase => {
        this.notify.success(`${quantity} cartes ajoutées au bulk (${purchase.purchaseNumber}).`);
        this.ref.close(purchase);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
