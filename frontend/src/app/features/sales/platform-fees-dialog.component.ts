import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlatformFeeMonth } from '../../core/models';
import { PlatformFeeService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';
import { AttachmentsComponent } from '../../shared/attachments.component';

export interface PlatformFeesDialogData {
  /** Mois à ouvrir directement (ex. depuis une alerte « facture manquante »). */
  year?: number;
  month?: number;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Factures mensuelles des frais Cardmarket. Une facture saisie remplace l'estimation (5 %) des ventes du mois :
 * son montant leur est réparti au prorata de leur montant.
 */
@Component({
  selector: 'app-platform-fees-dialog',
  imports: [
    FormsModule, CurrencyPipe, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatDatepickerModule, MatProgressBarModule, MatTooltipModule, AttachmentsComponent
  ],
  template: `
    <h2 mat-dialog-title>Frais Cardmarket</h2>
    <mat-dialog-content class="fees-dialog">
      <p class="muted small intro">
        Cardmarket facture ses commissions une fois par mois. Saisissez le total de la facture : il est réparti sur les
        ventes Cardmarket du mois, au prorata de leur montant, et remplace l'estimation à 5 %.
      </p>

      <div class="year-nav">
        <button mat-icon-button (click)="changeYear(-1)" aria-label="Année précédente"><mat-icon>chevron_left</mat-icon></button>
        <strong>{{ year() }}</strong>
        <button mat-icon-button (click)="changeYear(1)" aria-label="Année suivante"><mat-icon>chevron_right</mat-icon></button>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="startNew()"><mat-icon>add</mat-icon> Saisir une facture</button>
      </div>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table class="simple-table">
        <thead>
          <tr>
            <th>Mois</th><th class="num">Ventes</th><th class="num">Estimé (5 %)</th><th class="num">Facture</th>
            <th class="num">Écart</th><th></th>
          </tr>
        </thead>
        <tbody>
          @for (m of months(); track m.month) {
            <tr [class.editing]="editing()?.month === m.month && editing()?.year === m.year">
              <td class="strong capitalize">{{ monthLabel(m.month) }}</td>
              <td class="num">{{ m.salesCount }} · {{ m.salesTotal | currency }}</td>
              <td class="num muted">{{ m.estimatedFees | currency }}</td>
              <td class="num">
                @if (m.invoice) {
                  <span class="strong">{{ m.invoice.amount | currency }}</span>
                  @if (m.invoice.invoiceNumber) { <div class="muted small">{{ m.invoice.invoiceNumber }}</div> }
                } @else if (isPast(m)) {
                  <span class="missing">À saisir</span>
                } @else {
                  <span class="muted small">Mois en cours</span>
                }
              </td>
              <td class="num">
                @if (m.invoice) {
                  <span [class.negative]="m.invoice.amount > m.estimatedFees" [class.positive]="m.invoice.amount < m.estimatedFees"
                        matTooltip="Facture − estimation">
                    {{ m.invoice.amount - m.estimatedFees > 0 ? '+' : '' }}{{ m.invoice.amount - m.estimatedFees | currency }}
                  </span>
                }
              </td>
              <td class="actions-cell">
                <button mat-button (click)="edit(m)">
                  <mat-icon>{{ m.invoice ? 'edit' : 'receipt_long' }}</mat-icon> {{ m.invoice ? 'Modifier' : 'Saisir' }}
                </button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="no-data">{{ loading() ? 'Chargement…' : 'Aucune vente Cardmarket cette année.' }}</td></tr>
          }
        </tbody>
        @if (months().length) {
          <tfoot>
            <tr>
              <td class="strong">Total</td>
              <td class="num">{{ totals().count }} · {{ totals().sales | currency }}</td>
              <td class="num muted">{{ totals().estimated | currency }}</td>
              <td class="num strong">{{ totals().invoiced | currency }}</td>
              <td colspan="2" class="muted small">frais appliqués aux ventes : {{ totals().applied | currency }}</td>
            </tr>
          </tfoot>
        }
      </table>

      @if (editing(); as e) {
        <div class="editor">
          <h3>{{ e.id ? 'Facture de ' : 'Nouvelle facture — ' }}{{ e.id ? monthLabel(e.month) + ' ' + e.year : '' }}</h3>
          <div class="three-cols">
            @if (!e.id) {
              <mat-form-field>
                <mat-label>Mois</mat-label>
                <mat-select [(ngModel)]="e.month">
                  @for (label of monthNames; track $index) {
                    <mat-option [value]="$index + 1">{{ label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Année</mat-label>
                <input matInput type="number" min="2000" max="2100" [(ngModel)]="e.year">
              </mat-form-field>
            }
            <mat-form-field>
              <mat-label>Montant total de la facture</mat-label>
              <input matInput type="number" min="0" step="0.01" [(ngModel)]="e.amount">
              <span matTextSuffix>€</span>
              @if (estimateFor(e.year, e.month); as est) {
                <mat-hint>Estimation : {{ est | currency }}</mat-hint>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>N° de facture</mat-label>
              <input matInput [(ngModel)]="e.invoiceNumber" maxlength="50">
            </mat-form-field>
            <mat-form-field>
              <mat-label>Date de la facture</mat-label>
              <input matInput [matDatepicker]="picker" [(ngModel)]="e.invoiceDate">
              <mat-datepicker-toggle matIconSuffix [for]="picker" />
              <mat-datepicker #picker />
            </mat-form-field>
            <mat-form-field>
              <mat-label>Commentaire</mat-label>
              <input matInput [(ngModel)]="e.comment" maxlength="1000">
            </mat-form-field>
          </div>

          @if (e.id) {
            <h4>Facture PDF</h4>
            <app-attachments ownerType="PlatformFeeInvoice" [ownerId]="e.id" [kinds]="['Receipt', 'Other']"
                             emptyText="Aucune facture jointe." />
          } @else {
            <p class="muted small">Vous pourrez joindre le PDF de la facture après l'enregistrement.</p>
          }

          <div class="editor-actions">
            @if (e.id) {
              <button mat-button class="danger" (click)="remove(e.id)" [disabled]="saving()">
                <mat-icon>delete</mat-icon> Supprimer
              </button>
            }
            <span class="spacer"></span>
            <button mat-button (click)="editing.set(null)">Annuler</button>
            <button mat-flat-button (click)="save()" [disabled]="saving()">Enregistrer et répartir</button>
          </div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Fermer</button>
    </mat-dialog-actions>
  `,
  styles: `
    .fees-dialog { display: flex; flex-direction: column; gap: 12px; min-width: min(760px, 86vw); }
    .intro { margin: 0; }
    .year-nav { display: flex; align-items: center; gap: 4px; }
    .spacer { flex: 1; }
    tr.editing td { background: var(--app-bg); }
    .missing { color: #ef6c00; font-weight: 600; }
    .editor { border: 1px solid var(--app-border); border-radius: 10px; padding: 12px 16px; }
    .editor h3 { margin: 0 0 12px; }
    .editor h4 { margin: 4px 0; }
    .three-cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px 16px; }
    .editor-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .danger { color: var(--app-danger); }
  `
})
export class PlatformFeesDialogComponent implements OnInit {
  readonly data = inject<PlatformFeesDialogData | null>(MAT_DIALOG_DATA, { optional: true }) ?? {};
  private readonly api = inject(PlatformFeeService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<PlatformFeesDialogComponent, boolean>);

  readonly monthNames = MONTHS;
  readonly year = signal(this.data.year ?? new Date().getFullYear());
  readonly months = signal<PlatformFeeMonth[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly editing = signal<{
    id: number | null; year: number; month: number; amount: number;
    invoiceNumber: string; invoiceDate: Date | null; comment: string;
  } | null>(null);
  /** Vrai dès qu'une facture a été enregistrée ou supprimée : la liste des ventes doit être rechargée. */
  private changed = false;

  readonly totals = computed(() => this.months().reduce((t, m) => ({
    count: t.count + m.salesCount,
    sales: t.sales + m.salesTotal,
    estimated: t.estimated + m.estimatedFees,
    invoiced: t.invoiced + (m.invoice?.amount ?? 0),
    applied: t.applied + m.appliedFees
  }), { count: 0, sales: 0, estimated: 0, invoiced: 0, applied: 0 }));

  ngOnInit(): void {
    this.load(() => {
      const target = this.data.month ? this.months().find(m => m.month === this.data.month) : undefined;
      if (target) this.edit(target);
    });
  }

  load(then?: () => void): void {
    this.loading.set(true);
    this.api.months(this.year()).subscribe({
      next: months => {
        this.months.set(months);
        this.loading.set(false);
        then?.();
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  changeYear(delta: number): void {
    this.year.update(y => y + delta);
    this.editing.set(null);
    this.load();
  }

  monthLabel(month: number): string {
    return MONTHS[month - 1] ?? '';
  }

  /** Mois terminé : sa facture est attendue. */
  isPast(m: PlatformFeeMonth): boolean {
    const now = new Date();
    return m.year < now.getFullYear() || (m.year === now.getFullYear() && m.month < now.getMonth() + 1);
  }

  estimateFor(year: number, month: number): number | null {
    if (year !== this.year()) return null;
    return this.months().find(m => m.month === month)?.estimatedFees ?? null;
  }

  edit(m: PlatformFeeMonth): void {
    const inv = m.invoice;
    this.editing.set({
      id: inv?.id ?? null, year: m.year, month: m.month,
      amount: inv?.amount ?? m.estimatedFees,
      invoiceNumber: inv?.invoiceNumber ?? '',
      invoiceDate: inv?.invoiceDate ? parseApiDate(inv.invoiceDate) : null,
      comment: inv?.comment ?? ''
    });
  }

  /** Nouvelle facture : par défaut le mois précédent, celui dont la facture vient d'arriver. */
  startNew(): void {
    const previous = new Date();
    previous.setDate(1);
    previous.setMonth(previous.getMonth() - 1);
    const existing = this.months().find(m => m.year === previous.getFullYear() && m.month === previous.getMonth() + 1);
    if (existing) { this.edit(existing); return; }
    this.editing.set({
      id: null, year: previous.getFullYear(), month: previous.getMonth() + 1, amount: 0,
      invoiceNumber: '', invoiceDate: null, comment: ''
    });
  }

  save(): void {
    const e = this.editing();
    if (!e) return;
    if (!(e.amount >= 0)) {
      this.notify.error(null, 'Indiquez le montant de la facture.');
      return;
    }
    const input = {
      year: e.year, month: e.month, amount: e.amount,
      invoiceNumber: e.invoiceNumber.trim() || null,
      invoiceDate: e.invoiceDate ? toIsoDate(e.invoiceDate) : null,
      comment: e.comment.trim() || null
    };
    this.saving.set(true);
    const request = e.id ? this.api.update(e.id, input) : this.api.create(input);
    request.subscribe({
      next: invoice => {
        this.saving.set(false);
        this.changed = true;
        this.notify.success(`Facture de ${this.monthLabel(invoice.month)} ${invoice.year} répartie sur les ventes du mois.`);
        if (invoice.year !== this.year()) this.year.set(invoice.year);
        // On garde l'éditeur ouvert sur la facture enregistrée pour pouvoir joindre le PDF.
        this.load(() => {
          const m = this.months().find(x => x.month === invoice.month);
          if (m) this.edit(m); else this.editing.set(null);
        });
      },
      error: err => {
        this.saving.set(false);
        this.notify.error(err);
      }
    });
  }

  remove(id: number): void {
    this.saving.set(true);
    this.api.delete(id).subscribe({
      next: () => {
        this.saving.set(false);
        this.changed = true;
        this.editing.set(null);
        this.notify.success('Facture supprimée : les ventes du mois reviennent à l\'estimation.');
        this.load();
      },
      error: err => {
        this.saving.set(false);
        this.notify.error(err);
      }
    });
  }

  close(): void {
    this.ref.close(this.changed);
  }
}
