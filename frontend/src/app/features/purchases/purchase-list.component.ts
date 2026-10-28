import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
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
    RouterLink, CurrencyPipe, DatePipe, DecimalPipe,
    MatTableModule, MatSortModule, MatPaginatorModule, MatFormFieldModule, MatInputModule,
    MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './purchase-list.component.html'
})
export class PurchaseListComponent {
  private readonly api = inject(PurchaseService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly columns = ['purchaseNumber', 'purchaseDate', 'supplier', 'items', 'itemCount', 'totalAmount', 'performance', 'actions'];
  readonly platformLabels = PURCHASE_PLATFORM_LABELS;
  readonly dataSource = new MatTableDataSource<Purchase>([]);
  readonly loading = signal(true);

  @ViewChild(MatSort) set sort(sort: MatSort) { this.dataSource.sort = sort; }
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) { this.dataSource.paginator = paginator; }

  constructor() {
    // Tri « Rentabilité » sur le bilan ; les achats sans vente prennent la valeur minimale.
    this.dataSource.sortingDataAccessor = (p, column) => {
      switch (column) {
        case 'performance': return p.performance.unitsSold > 0 ? p.performance.balance : Number.NEGATIVE_INFINITY;
        default: return (p as unknown as Record<string, string | number>)[column];
      }
    };
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

  /** Lignes de cartes (brutes ou gradées) qui ne sont liées à aucune carte du catalogue (« Hors catégorie »). */
  unlinkedCards(p: Purchase): number {
    return p.items.filter(i => (i.type === 'RawCard' || i.type === 'GradedCard') && i.catalogCardId === null).length;
  }

  /** Largeur de la barre « récupéré » (plafonnée à 100 %). */
  perfBarWidth(percent: number | null): number {
    return Math.min(100, Math.max(0, percent ?? 0));
  }

  performanceTooltip(p: Purchase): string {
    const perf = p.performance;
    const lines = [
      `Récupéré grâce aux ventes : ${this.money(perf.recovered)} sur ${this.money(p.totalAmount)}`,
      `Bénéfice sur les ${perf.unitsSold} unité(s) vendue(s) : ${this.money(perf.realizedProfit)}`
    ];
    if (perf.unitsInStock > 0) {
      lines.push(perf.stockMarketValue !== null
        ? `Reste ${perf.unitsInStock} unité(s), estimées ${this.money(perf.stockMarketValue)}`
        : `Reste ${perf.unitsInStock} unité(s) en stock`);
    }
    return lines.join(' · ');
  }

  /** Bénéfice déjà réalisé sur les unités vendues des achats affichés. */
  filteredRealizedProfit(): number {
    return this.dataSource.filteredData.reduce((sum, p) => sum + p.performance.realizedProfit, 0);
  }

  private money(value: number): string {
    return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  }

  /** Nombre d'articles achetés (unités) dans les achats affichés. */
  filteredItemCount(): number {
    return this.dataSource.filteredData.reduce((sum, p) => sum + p.itemCount, 0);
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
