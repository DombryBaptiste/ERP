import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BulkRebalance } from '../../core/models';
import { BulkService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';

/**
 * Recalcul des ventes de bulk déjà enregistrées avec la règle « achats d'abord » : affiche d'abord un aperçu
 * (ventes dont le bénéfice change), puis applique sur confirmation.
 */
@Component({
  selector: 'app-bulk-rebalance-dialog',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <h2 mat-dialog-title>Recalculer les ventes de bulk (achats d'abord)</h2>
    <mat-dialog-content class="rebalance">
      <p class="muted small">
        Les ventes de bulk passées sont rejouées dans l'ordre, en prenant d'abord les cartes achetées
        (du plus ancien achat au plus récent), puis celles de la collection, comme les nouvelles ventes. Seuls le coût et le bénéfice changent :
        le montant des ventes (CA, URSSAF, livre des recettes) et les frais restent identiques.
      </p>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (preview(); as p) {
        @if (p.sales.length === 0) {
          <p class="ok"><mat-icon>check_circle</mat-icon> Rien à recalculer : vos ventes de bulk suivent déjà cette règle.</p>
        } @else {
          <p>
            <strong>{{ p.sales.length }}</strong> vente(s) modifiée(s) · bénéfice total
            <strong [class.positive]="p.profitDifference >= 0" [class.negative]="p.profitDifference < 0">
              {{ p.profitDifference >= 0 ? '+' : '' }}{{ p.profitDifference | currency }}
            </strong>
            <span class="muted small">(il reviendra sur les prochaines ventes, le stock restant étant revalorisé)</span>
          </p>
          <div class="table-wrap">
            <table class="simple-table">
              <thead>
                <tr><th>Vente</th><th>Date</th><th>Catégorie</th><th class="num">Cartes</th>
                  <th class="num">Coût avant → après</th><th class="num">Bénéfice avant → après</th></tr>
              </thead>
              <tbody>
                @for (s of p.sales; track s.saleId) {
                  <tr>
                    <td><span class="ref">{{ s.saleNumber }}</span></td>
                    <td>{{ s.saleDate | date: 'dd/MM/yyyy' }}</td>
                    <td>{{ s.categories }}</td>
                    <td class="num">{{ s.cards | number }}</td>
                    <td class="num">{{ s.oldCost | currency }} → {{ s.newCost | currency }}</td>
                    <td class="num">
                      {{ s.oldProfit | currency }} →
                      <strong [class.positive]="s.newProfit >= 0" [class.negative]="s.newProfit < 0">{{ s.newProfit | currency }}</strong>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (p.skipped.length) {
          <div class="skipped small">
            <strong>Laissé tel quel :</strong>
            <ul>@for (s of p.skipped; track $index) { <li>{{ s }}</li> }</ul>
          </div>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ preview()?.sales?.length ? 'Annuler' : 'Fermer' }}</button>
      @if (preview()?.sales?.length) {
        <button mat-flat-button (click)="apply()" [disabled]="saving()">
          <mat-icon>calculate</mat-icon> Appliquer le recalcul
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .rebalance { display: flex; flex-direction: column; gap: 10px; min-width: min(760px, 85vw); }
    .ok { display: flex; align-items: center; gap: 6px; color: var(--app-positive); }
    .positive { color: var(--app-positive); }
    .negative { color: var(--app-danger); }
    .skipped { padding: 8px 12px; border-radius: 10px; background: #fff8e1; }
    .skipped ul { margin: 4px 0 0; padding-left: 18px; }
  `
})
export class BulkRebalanceDialogComponent {
  private readonly api = inject(BulkService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<BulkRebalanceDialogComponent, boolean>);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly preview = signal<BulkRebalance | null>(null);

  constructor() {
    this.api.previewRebalance().subscribe({
      next: p => { this.preview.set(p); this.loading.set(false); },
      error: err => { this.notify.error(err); this.loading.set(false); }
    });
  }

  apply(): void {
    this.saving.set(true);
    this.api.applyRebalance().subscribe({
      next: result => {
        this.notify.success(`${result.sales.length} vente(s) de bulk recalculée(s) (achats d'abord).`);
        this.ref.close(true);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
