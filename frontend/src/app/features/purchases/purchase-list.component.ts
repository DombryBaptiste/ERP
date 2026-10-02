import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, signal, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { PURCHASE_PLATFORM_LABELS } from '../../core/labels';
import { Purchase, PurchasePlatform } from '../../core/models';
import { PurchaseService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';

@Component({
  selector: 'app-purchase-list',
  imports: [
    RouterLink, CurrencyPipe, DatePipe,
    MatTableModule, MatSortModule, MatPaginatorModule, MatFormFieldModule, MatInputModule,
    MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './purchase-list.component.html'
})
export class PurchaseListComponent {
  private readonly api = inject(PurchaseService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly columns = ['purchaseNumber', 'purchaseDate', 'supplier', 'items', 'itemCount', 'totalAmount', 'actions'];
  readonly platformLabels = PURCHASE_PLATFORM_LABELS;
  readonly dataSource = new MatTableDataSource<Purchase>([]);
  readonly loading = signal(true);

  @ViewChild(MatSort) set sort(sort: MatSort) { this.dataSource.sort = sort; }
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) { this.dataSource.paginator = paginator; }

  constructor() {
    // Recherche instantanée sur numéro, fournisseur, commentaire et noms d'articles.
    this.dataSource.filterPredicate = (p, filter) =>
      [p.purchaseNumber, p.supplier, p.platform ? PURCHASE_PLATFORM_LABELS[p.platform] : '', p.comment ?? '', p.source === 'PersonalCollection' ? 'collection' : '', ...p.items.map(i => i.name)]
        .join(' ').toLowerCase().includes(filter);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getAll().subscribe({
      next: purchases => {
        this.dataSource.data = purchases;
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  applyFilter(value: string): void {
    this.dataSource.filter = value.trim().toLowerCase();
    this.dataSource.paginator?.firstPage();
  }

  itemsSummary(p: Purchase): string {
    return p.items.map(i => `${i.name} ×${i.quantity}`).join(', ');
  }

  platformLabel(platform: PurchasePlatform | null): string {
    return platform ? PURCHASE_PLATFORM_LABELS[platform] : '';
  }

  filteredTotal(): number {
    return this.dataSource.filteredData
      .filter(p => p.source === 'Supplier')
      .reduce((sum, p) => sum + p.totalAmount, 0);
  }

  edit(p: Purchase): void {
    this.router.navigate(['/purchases', p.id]);
  }

  delete(p: Purchase, event: Event): void {
    event.stopPropagation();
    this.notify.confirm({
      title: `Supprimer ${p.source === 'PersonalCollection' ? 'le transfert' : "l'achat"} ${p.purchaseNumber} ?`,
      message: `Les ${p.itemCount} article(s) associé(s) seront retirés de l'inventaire. Impossible si certains ont déjà été vendus.`
    }).subscribe(ok => {
      if (!ok) return;
      this.api.delete(p.id).subscribe({
        next: () => {
          this.notify.success(`Achat ${p.purchaseNumber} supprimé.`);
          this.load();
        },
        error: err => this.notify.error(err)
      });
    });
  }
}
