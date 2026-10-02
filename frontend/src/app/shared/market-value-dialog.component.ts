import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { forkJoin } from 'rxjs';
import { cardmarketSearchUrl } from '../core/labels';
import { InventoryItem } from '../core/models';
import { InventoryService } from '../core/services/api.services';
import { NotifyService } from '../core/services/notify.service';

/** Données de la boîte : un lot, ou un produit regroupant plusieurs lots. */
export interface MarketValueDialogData {
  name: string;
  /** Prix d'achat (ou coût moyen pour un produit). */
  purchasePrice: number;
  marketValue: number | null;
  marketValueUpdatedAt: string | null;
  /** Lots à mettre à jour avec la même estimation. */
  lotIds: number[];
}

/** Données de la boîte pour un seul lot. */
export function marketDataForLot(item: InventoryItem): MarketValueDialogData {
  return {
    name: item.name, purchasePrice: item.purchasePrice, marketValue: item.marketValue,
    marketValueUpdatedAt: item.marketValueUpdatedAt, lotIds: [item.id]
  };
}

/**
 * Saisie rapide de la valeur de marché (appliquée à tous les lots indiqués).
 * Ferme la boîte avec les lots mis à jour, ou undefined si annulé.
 */
@Component({
  selector: 'app-market-value-dialog',
  imports: [FormsModule, CurrencyPipe, DatePipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Valeur de marché</h2>
    <mat-dialog-content>
      <p class="mv-name">{{ data.name }}</p>
      <p class="mv-meta">
        {{ data.lotIds.length > 1 ? 'Coût moyen' : "Prix d'achat" }} : <strong>{{ data.purchasePrice | currency }}</strong>
        @if (data.marketValue !== null) {
          · estimation actuelle : <strong>{{ data.marketValue | currency }}</strong>
          @if (data.marketValueUpdatedAt) { (le {{ data.marketValueUpdatedAt | date: 'dd/MM/yyyy' }}) }
        }
      </p>
      @if (data.lotIds.length > 1) {
        <p class="mv-meta">L'estimation sera appliquée aux {{ data.lotIds.length }} lots de ce produit.</p>
      }
      <mat-form-field class="mv-field">
        <mat-label>Nouvelle valeur unitaire</mat-label>
        <input matInput type="number" min="0" step="0.5" [(ngModel)]="value" cdkFocusInitial (keyup.enter)="save()">
        <span matTextSuffix>€</span>
        <mat-hint>Laissez vide pour effacer l'estimation</mat-hint>
      </mat-form-field>
      <a mat-button [href]="searchUrl" target="_blank" rel="noopener">
        <mat-icon>travel_explore</mat-icon> Voir les prix sur Cardmarket
      </a>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">Enregistrer</button>
    </mat-dialog-actions>
  `,
  styles: `
    .mv-name { font-weight: 600; margin: 0 0 4px; }
    .mv-meta { margin: 0 0 12px; font-size: 13px; color: var(--app-muted); }
    .mv-field { width: 100%; margin-top: 4px; }
  `
})
export class MarketValueDialogComponent {
  readonly data = inject<MarketValueDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(InventoryService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<MarketValueDialogComponent, InventoryItem[]>);

  value: number | null = this.data.marketValue;
  readonly saving = signal(false);
  readonly searchUrl = cardmarketSearchUrl(this.data.name);

  save(): void {
    const value = this.value === null || (this.value as unknown) === '' ? null : Number(this.value);
    if (value !== null && (isNaN(value) || value < 0)) {
      this.notify.error(null, 'Valeur invalide.');
      return;
    }
    this.saving.set(true);
    forkJoin(this.data.lotIds.map(id => this.api.setMarketValue(id, value))).subscribe({
      next: updated => {
        this.notify.success('Valeur de marché enregistrée.');
        this.ref.close(updated);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
