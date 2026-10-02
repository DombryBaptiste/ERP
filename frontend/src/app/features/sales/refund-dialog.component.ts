import { CurrencyPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Sale } from '../../core/models';
import { SaleService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { toIsoDate } from '../../core/utils';

interface ReturnLine {
  saleItemId: number;
  name: string;
  salePrice: number;
  max: number;
  quantity: number;
}

/**
 * Remboursement total ou partiel d'une vente : montant rendu, articles retournés,
 * remise en stock ou non. Ferme la boîte avec la vente mise à jour.
 */
@Component({
  selector: 'app-refund-dialog',
  imports: [FormsModule, CurrencyPipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatDatepickerModule, MatSlideToggleModule],
  template: `
    <h2 mat-dialog-title>Rembourser la vente {{ sale.saleNumber }}</h2>
    <mat-dialog-content class="refund-content">
      <p class="refund-info">
        Montant de la vente : <strong>{{ sale.totalAmount | currency }}</strong>
        @if (sale.refundedAmount > 0) { · déjà remboursé : <strong>{{ sale.refundedAmount | currency }}</strong> }
        · reste remboursable : <strong>{{ maxAmount | currency }}</strong>
      </p>

      @if (lines.length) {
        <h4>Articles retournés</h4>
        <table class="simple-table">
          <thead><tr><th>Article</th><th class="num">Prix</th><th class="num">Retour</th></tr></thead>
          <tbody>
            @for (l of lines; track l.saleItemId) {
              <tr>
                <td>{{ l.name }}</td>
                <td class="num">{{ l.salePrice | currency }}</td>
                <td class="num">
                  <input class="qty-input" type="number" min="0" [max]="l.max" [(ngModel)]="l.quantity" (ngModelChange)="suggestAmount()">
                  <span class="muted"> / {{ l.max }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
        <mat-slide-toggle [(ngModel)]="restock">Remettre les articles retournés en stock (revendables)</mat-slide-toggle>
      }

      <div class="refund-grid">
        <mat-form-field>
          <mat-label>Montant remboursé</mat-label>
          <input matInput type="number" min="0" [max]="maxAmount" step="0.01" [(ngModel)]="amount">
          <span matTextSuffix>€</span>
          <mat-hint>0 € pour un simple retour sans remboursement</mat-hint>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Date du remboursement</mat-label>
          <input matInput [matDatepicker]="picker" [(ngModel)]="date">
          <mat-datepicker-toggle matIconSuffix [for]="picker" />
          <mat-datepicker #picker />
        </mat-form-field>
      </div>
      <mat-form-field class="full">
        <mat-label>Motif</mat-label>
        <input matInput [(ngModel)]="reason" placeholder="ex. carte abîmée à la livraison, colis perdu…">
      </mat-form-field>
      <p class="refund-note">
        <mat-icon>info</mat-icon>
        Le montant remboursé sera déduit du CA à déclarer à l'URSSAF pour la période du remboursement.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Enregistrer le remboursement</button>
    </mat-dialog-actions>
  `,
  styles: `
    .refund-content { min-width: min(560px, 80vw); }
    .refund-info { font-size: 13px; color: var(--app-muted); margin-top: 0; }
    h4 { margin: 12px 0 6px; }
    .qty-input { width: 56px; padding: 4px 6px; border: 1px solid var(--app-border); border-radius: 6px; font: inherit; text-align: right; }
    .refund-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .full { width: 100%; }
    .refund-note { display: flex; gap: 6px; font-size: 12px; color: var(--app-muted); }
    .refund-note mat-icon { font-size: 16px; width: 16px; height: 16px; }
    mat-slide-toggle { display: block; margin: 12px 0 4px; }
  `
})
export class RefundDialogComponent {
  readonly sale = inject<Sale>(MAT_DIALOG_DATA);
  private readonly api = inject(SaleService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<RefundDialogComponent, Sale>);

  readonly maxAmount = Math.round((this.sale.totalAmount - this.sale.refundedAmount) * 100) / 100;
  readonly lines: ReturnLine[] = this.sale.items
    .map(i => ({ saleItemId: i.id, name: i.itemName, salePrice: i.salePrice, max: i.quantity - i.returnedQuantity, quantity: 0 }))
    .filter(l => l.max > 0);

  amount = this.maxAmount;
  date = new Date();
  reason = '';
  restock = true;
  readonly saving = signal(false);

  /** Propose un montant égal à la valeur des articles retournés. */
  suggestAmount(): void {
    const value = this.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * l.salePrice, 0);
    if (value > 0) this.amount = Math.min(this.maxAmount, Math.round(value * 100) / 100);
  }

  save(): void {
    const amount = Number(this.amount) || 0;
    const items = this.lines
      .filter(l => Number(l.quantity) > 0)
      .map(l => ({ saleItemId: l.saleItemId, quantity: Math.min(l.max, Math.floor(Number(l.quantity))) }));
    if (amount < 0 || amount > this.maxAmount) {
      this.notify.error(null, `Le montant doit être compris entre 0 et ${this.maxAmount} €.`);
      return;
    }
    if (amount === 0 && items.length === 0) {
      this.notify.error(null, 'Indiquez un montant ou des articles retournés.');
      return;
    }
    this.saving.set(true);
    this.api.addRefund(this.sale.id, {
      refundDate: toIsoDate(this.date),
      amount,
      reason: this.reason.trim() || null,
      restock: this.restock,
      items
    }).subscribe({
      next: sale => {
        this.notify.success('Remboursement enregistré.');
        this.ref.close(sale);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
