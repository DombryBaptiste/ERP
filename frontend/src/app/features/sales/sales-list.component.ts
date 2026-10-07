import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, inject, signal, ViewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { PLATFORMS } from '../../core/labels';
import { Sale, SalePlatform } from '../../core/models';
import { SaleService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { toIsoDate } from '../../core/utils';
import { LabelPipe } from '../../shared/label.pipe';

/** Historique des ventes avec filtres (période, plateforme, client). */
@Component({
  selector: 'app-sales-list',
  imports: [
    ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, DecimalPipe, LabelPipe,
    MatTableModule, MatSortModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDatepickerModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './sales-list.component.html'
})
export class SalesListComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(SaleService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly platforms = PLATFORMS;
  readonly columns = ['saleNumber', 'saleDate', 'customer', 'platform', 'items', 'totalAmount', 'profit', 'margin', 'actions'];
  readonly dataSource = new MatTableDataSource<Sale>([]);
  readonly loading = signal(true);

  readonly filterForm = this.fb.group({
    from: this.fb.control<Date | null>(null),
    to: this.fb.control<Date | null>(null),
    platform: this.fb.control<SalePlatform | ''>(''),
    customer: ['']
  });

  @ViewChild(MatSort) set sort(sort: MatSort) { this.dataSource.sort = sort; }
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) { this.dataSource.paginator = paginator; }

  constructor() {
    this.dataSource.filterPredicate = (sale: Sale) => {
      const f = this.filterForm.getRawValue();
      const date = sale.saleDate.substring(0, 10);
      return (!f.from || date >= toIsoDate(f.from))
        && (!f.to || date <= toIsoDate(f.to))
        && (!f.platform || sale.platform === f.platform)
        && (!f.customer || (sale.customer ?? '').toLowerCase().includes(f.customer.trim().toLowerCase()));
    };
    // La colonne « Montant » affiche le montant net des frais et des remboursements.
    this.dataSource.sortingDataAccessor = (sale: Sale, column: string) =>
      column === 'totalAmount' ? this.saleAmount(sale) : ((sale as unknown as Record<string, string | number>)[column] ?? '');
    this.filterForm.valueChanges.subscribe(() => this.applyFilters());
    this.applyFilters();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getAll().subscribe({
      next: sales => {
        this.dataSource.data = sales;
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  private applyFilters(): void {
    // Valeur non vide pour déclencher le prédicat, qui lit directement le formulaire.
    this.dataSource.filter = JSON.stringify(this.filterForm.getRawValue());
    this.dataSource.paginator?.firstPage();
  }

  setPeriod(period: 'month' | 'year'): void {
    const now = new Date();
    const from = period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), 0, 1);
    this.filterForm.patchValue({ from, to: null });
  }

  resetFilters(): void {
    this.filterForm.reset();
  }

  itemsSummary(sale: Sale): string {
    return sale.items.map(i => `${i.itemName} ×${i.quantity}`).join(', ');
  }

  saleAmount(sale: Sale): number {
    return sale.totalAmount - sale.fees + sale.amountPaid - sale.refundedAmount;
  }

  totals(): { amount: number; profit: number; count: number } {
    return this.dataSource.filteredData.reduce(
      (acc, s) => ({ amount: acc.amount + this.saleAmount(s), profit: acc.profit + s.profit, count: acc.count + 1 }),
      { amount: 0, profit: 0, count: 0 });
  }

  edit(sale: Sale): void {
    this.router.navigate(['/sales', sale.id]);
  }

  delete(sale: Sale, event: Event): void {
    event.stopPropagation();
    this.notify.confirm({
      title: `Supprimer la vente ${sale.saleNumber} ?`,
      message: 'Les articles vendus seront remis en stock.'
    }).subscribe(ok => {
      if (!ok) return;
      this.api.delete(sale.id).subscribe({
        next: () => {
          this.notify.success(`Vente ${sale.saleNumber} supprimée, stock restauré.`);
          this.load();
        },
        error: err => this.notify.error(err)
      });
    });
  }
}
