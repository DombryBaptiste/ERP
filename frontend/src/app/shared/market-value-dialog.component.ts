import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { cardmarketSearchUrl } from '../core/labels';
import { InventoryItem } from '../core/models';
import { InventoryService } from '../core/services/api.services';
import { NotifyService } from '../core/services/notify.service';

/**
 * Saisie rapide de la valeur de marché d'un article.
 * Ferme la boîte avec l'article mis à jour, ou undefined si annulé.
 */
@Component({
  selector: 'app-market-value-dialog',
  imports: [FormsModule, CurrencyPipe, DatePipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Valeur de marché</h2>
    <mat-dialog-content>
      <p class="mv-name">{{ item.name }}</p>
      <p class="mv-meta">
        Prix d'achat : <strong>{{ item.purchasePrice | currency }}</strong>
        @if (item.marketValue !== null) {
          · estimation actuelle : <strong>{{ item.marketValue | currency }}</strong>
          @if (item.marketValueUpdatedAt) { (le {{ item.marketValueUpdatedAt | date: 'dd/MM/yyyy' }}) }
        }
      </p>
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
    .mv-meta { margin: 0 0 16px; font-size: 13px; color: var(--app-muted); }
    .mv-field { width: 100%; }
  `
})
export class MarketValueDialogComponent {
  readonly item = inject<InventoryItem>(MAT_DIALOG_DATA);
  private readonly api = inject(InventoryService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<MarketValueDialogComponent, InventoryItem>);

  value: number | null = this.item.marketValue;
  readonly saving = signal(false);
  readonly searchUrl = cardmarketSearchUrl(this.item.name);

  save(): void {
    const value = this.value === null || (this.value as unknown) === '' ? null : Number(this.value);
    if (value !== null && (isNaN(value) || value < 0)) {
      this.notify.error(null, 'Valeur invalide.');
      return;
    }
    this.saving.set(true);
    this.api.setMarketValue(this.item.id, value).subscribe({
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
