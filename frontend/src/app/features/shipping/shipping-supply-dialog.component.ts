import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CARRIERS, PAYMENT_METHODS, SHIPPING_KINDS, SHIPPING_PRESETS } from '../../core/labels';
import { PaymentMethod, ShippingCarrier, ShippingSupply, ShippingSupplyInput, ShippingSupplyKind } from '../../core/models';
import { normalizeText } from '../../core/products';
import { ShippingService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';
import { AttachmentsComponent } from '../../shared/attachments.component';

export interface ShippingSupplyDialogData {
  /** Achat à modifier (absent en création). */
  supply?: ShippingSupply;
  /** Valeurs proposées en création (ex. « Racheter » ou bordereau pour une vente). */
  preset?: Partial<ShippingSupplyInput>;
  /** Désignations déjà utilisées, proposées à la saisie. */
  knownNames?: { name: string; kind: ShippingSupplyKind; carrier: ShippingCarrier | null }[];
}

/** Achat de fournitures d'envoi : carnet de timbres, bordereaux, enveloppes, protections… */
@Component({
  selector: 'app-shipping-supply-dialog',
  imports: [
    FormsModule, CurrencyPipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatAutocompleteModule,
    MatButtonModule, MatIconModule, MatDatepickerModule, AttachmentsComponent
  ],
  template: `
    <h2 mat-dialog-title>{{ data.supply ? 'Achat ' + data.supply.supplyNumber : 'Acheter des fournitures d\\'envoi' }}</h2>
    <mat-dialog-content class="supply-dialog">
      <mat-form-field class="full">
        <mat-label>Désignation</mat-label>
        <input matInput [(ngModel)]="name" [matAutocomplete]="names" placeholder="ex. Timbre Lettre verte 20 g">
        <mat-autocomplete #names="matAutocomplete">
          @for (s of suggestions(); track s.name) {
            <mat-option [value]="s.name" (onSelectionChange)="$event.isUserInput && usePreset(s)">
              {{ s.name }} <span class="muted small">· {{ kindLabel(s.kind) }}</span>
            </mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="kind">
            @for (k of kinds; track k.value) {
              <mat-option [value]="k.value">{{ k.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Transporteur</mat-label>
          <mat-select [(ngModel)]="carrier">
            <mat-option [value]="null">—</mat-option>
            @for (c of carriers; track c.value) {
              <mat-option [value]="c.value">{{ c.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Quantité</mat-label>
          <input matInput type="number" min="1" step="1" [ngModel]="quantity()" (ngModelChange)="quantity.set(+$event)">
          @if (data.supply && data.supply.usedQuantity > 0) {
            <mat-hint>{{ data.supply.usedQuantity }} déjà utilisé(s)</mat-hint>
          } @else {
            <mat-hint>ex. 12 pour un carnet de timbres</mat-hint>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>Prix payé (total)</mat-label>
          <input matInput type="number" min="0" step="0.01" [ngModel]="total()" (ngModelChange)="total.set(+$event)">
          <span matTextSuffix>€</span>
          <mat-hint>soit {{ unitCost() | currency: 'EUR' : 'symbol' : '1.2-4' }} l'unité</mat-hint>
        </mat-form-field>
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Date d'achat</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="date">
          <mat-datepicker-toggle matIconSuffix [for]="picker" />
          <mat-datepicker #picker />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Où (fournisseur)</mat-label>
          <input matInput [(ngModel)]="supplier" placeholder="ex. Bureau de poste, Amazon, Cardmarket">
        </mat-form-field>
      </div>

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Mode de règlement</mat-label>
          <mat-select [(ngModel)]="paymentMethod">
            <mat-option [value]="null">—</mat-option>
            @for (p of payments; track p.value) {
              <mat-option [value]="p.value">{{ p.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Commentaire</mat-label>
          <input matInput [(ngModel)]="comment">
        </mat-form-field>
      </div>

      @if (data.supply) {
        <h4>Justificatifs</h4>
        <app-attachments ownerType="ShippingSupply" [ownerId]="data.supply.id" [kinds]="['Receipt', 'Other']"
                         emptyText="Aucun ticket ni facture." />
      } @else {
        <p class="muted small">Vous pourrez joindre le ticket ou la facture après l'enregistrement.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Enregistrer</button>
    </mat-dialog-actions>
  `,
  styles: `
    .supply-dialog { display: flex; flex-direction: column; gap: 10px; min-width: min(580px, 80vw); }
    .full { width: 100%; }
    h4 { margin: 8px 0 0; }
  `
})
export class ShippingSupplyDialogComponent {
  readonly data = inject<ShippingSupplyDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(ShippingService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<ShippingSupplyDialogComponent, ShippingSupply>);

  readonly kinds = SHIPPING_KINDS;
  readonly carriers = CARRIERS;
  readonly payments = PAYMENT_METHODS;

  private readonly source: Partial<ShippingSupplyInput> = this.data.supply ?? this.data.preset ?? {};
  name = this.source.name ?? '';
  kind: ShippingSupplyKind = this.source.kind ?? 'Stamp';
  carrier: ShippingCarrier | null = this.source.carrier ?? null;
  date = this.data.supply ? parseApiDate(this.data.supply.purchaseDate) : new Date();
  supplier = this.source.supplier ?? '';
  paymentMethod: PaymentMethod | null = this.source.paymentMethod ?? 'Card';
  comment = this.source.comment ?? '';
  readonly quantity = signal(this.source.quantity ?? 1);
  readonly total = signal(this.source.totalAmount ?? 0);
  readonly saving = signal(false);

  readonly unitCost = computed(() => (this.quantity() > 0 ? (this.total() || 0) / this.quantity() : 0));

  /** Désignations connues puis préréglages, filtrées par la saisie. */
  suggestions(): { name: string; kind: ShippingSupplyKind; carrier: ShippingCarrier | null }[] {
    const term = normalizeText(this.name);
    const all = [...(this.data.knownNames ?? []), ...SHIPPING_PRESETS];
    const seen = new Set<string>();
    return all.filter(s => {
      const key = normalizeText(s.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return !term || key.includes(term);
    }).slice(0, 12);
  }

  usePreset(s: { name: string; kind: ShippingSupplyKind; carrier: ShippingCarrier | null }): void {
    this.name = s.name;
    this.kind = s.kind;
    this.carrier = s.carrier;
  }

  kindLabel(kind: ShippingSupplyKind): string {
    return this.kinds.find(k => k.value === kind)?.label ?? kind;
  }

  save(): void {
    if (!this.name.trim()) {
      this.notify.error(null, 'Indiquez la désignation.');
      return;
    }
    if (!(this.quantity() >= 1)) {
      this.notify.error(null, 'La quantité doit être d\'au moins 1.');
      return;
    }
    const input: ShippingSupplyInput = {
      purchaseDate: toIsoDate(this.date),
      kind: this.kind,
      carrier: this.carrier,
      name: this.name.trim(),
      quantity: Math.floor(this.quantity()),
      totalAmount: this.total() || 0,
      supplier: this.supplier.trim() || null,
      paymentMethod: this.paymentMethod,
      comment: this.comment.trim() || null
    };
    const request = this.data.supply ? this.api.update(this.data.supply.id, input) : this.api.create(input);
    this.saving.set(true);
    request.subscribe({
      next: supply => {
        this.notify.success(`Fournitures enregistrées (${supply.supplyNumber}).`);
        this.ref.close(supply);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
