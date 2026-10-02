import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
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
import { CONDITIONS, ITEM_TYPES, ORIGINS } from '../../core/labels';
import { InventoryItem } from '../../core/models';
import { AttachmentService, InventoryService } from '../../core/services/api.services';
import { MarketValueDialogComponent } from '../../shared/market-value-dialog.component';
import { NotifyService } from '../../core/services/notify.service';
import { LabelPipe } from '../../shared/label.pipe';

type StockStatus = 'all' | 'instock' | 'sold';

interface InventoryFilters {
  search: string;
  category: string;
  type: string;
  condition: string;
  origin: string;
  status: StockStatus;
}

@Component({
  selector: 'app-inventory-list',
  imports: [
    FormsModule, RouterLink, CurrencyPipe, DatePipe, LabelPipe,
    MatTableModule, MatSortModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './inventory-list.component.html'
})
export class InventoryListComponent {
  private readonly api = inject(InventoryService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly attachments = inject(AttachmentService);

  readonly types = ITEM_TYPES;
  readonly conditions = CONDITIONS;
  readonly columns = [
    'id', 'name', 'category', 'type', 'condition', 'purchasePrice', 'remainingQuantity',
    'stockValue', 'marketValue', 'purchaseDate', 'purchaseNumber', 'actions'
  ];
  readonly dataSource = new MatTableDataSource<InventoryItem>([]);
  readonly loading = signal(true);
  private readonly allItems = signal<InventoryItem[]>([]);

  /** Catégories présentes dans l'inventaire, pour le filtre. */
  readonly categories = computed(() =>
    [...new Set(this.allItems().map(i => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)));

  readonly origins = ORIGINS;
  filters: InventoryFilters = { search: '', category: '', type: '', condition: '', origin: '', status: 'instock' };

  @ViewChild(MatSort) set sort(sort: MatSort) { this.dataSource.sort = sort; }
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) { this.dataSource.paginator = paginator; }

  constructor() {
    // Filtrage côté client : la recherche est instantanée.
    this.dataSource.filterPredicate = (item: InventoryItem) => {
      const f = this.filters;
      const text = `${item.id} ${item.name} ${item.category ?? ''} ${item.location ?? ''} ${item.purchaseNumber ?? ''}`.toLowerCase();
      return (!f.search || text.includes(f.search.toLowerCase()))
        && (!f.category || item.category === f.category)
        && (!f.type || item.type === f.type)
        && (!f.condition || item.condition === f.condition)
        && (!f.origin || item.origin === f.origin)
        && (f.status === 'all'
          || (f.status === 'instock' && item.remainingQuantity > 0)
          || (f.status === 'sold' && item.remainingQuantity === 0));
    };
    this.load();
    this.applyFilters();
  }

  load(): void {
    this.loading.set(true);
    this.api.getAll().subscribe({
      next: items => {
        this.allItems.set(items);
        this.dataSource.data = items;
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  setFilter<K extends keyof InventoryFilters>(key: K, value: InventoryFilters[K]): void {
    const next = { ...this.filters };
    next[key] = value;
    this.filters = next;
    this.applyFilters();
  }

  resetFilters(): void {
    this.filters = { search: '', category: '', type: '', condition: '', origin: '', status: 'all' };
    this.applyFilters();
  }

  private applyFilters(): void {
    // La valeur n'est pas lue par le prédicat : elle sert à déclencher le filtrage.
    this.dataSource.filter = JSON.stringify(this.filters);
    this.dataSource.paginator?.firstPage();
  }

  /** Totaux des lignes affichées. */
  summary(): { quantity: number; value: number } {
    return this.dataSource.filteredData.reduce(
      (acc, i) => ({ quantity: acc.quantity + i.remainingQuantity, value: acc.value + i.stockValue }),
      { quantity: 0, value: 0 });
  }

  photoUrl(id: number): string {
    return this.attachments.fileUrl(id);
  }

  /** Saisie rapide de la valeur de marché, sans quitter la liste. */
  editMarketValue(item: InventoryItem, event: Event): void {
    event.stopPropagation();
    this.dialog.open(MarketValueDialogComponent, { data: item, width: '440px' }).afterClosed()
      .subscribe((updated?: InventoryItem) => {
        if (!updated) return;
        const replace = (list: InventoryItem[]) => list.map(i => (i.id === updated.id ? updated : i));
        this.allItems.update(replace);
        this.dataSource.data = replace(this.dataSource.data);
      });
  }

  /** Totaux des lignes affichées : valeur de marché (estimation, sinon prix d'achat) et plus-value latente. */
  marketSummary(): { value: number; gain: number } {
    return this.dataSource.filteredData.reduce((acc, i) => ({
      value: acc.value + i.remainingQuantity * (i.marketValue ?? i.purchasePrice),
      gain: acc.gain + (i.latentGain ?? 0)
    }), { value: 0, gain: 0 });
  }

  edit(item: InventoryItem): void {
    this.router.navigate(['/inventory', item.id]);
  }

  sell(item: InventoryItem, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/sales/new'], { queryParams: { item: item.id } });
  }

  delete(item: InventoryItem, event: Event): void {
    event.stopPropagation();
    this.notify.confirm({
      title: `Supprimer « ${item.name} » ?`,
      message: item.purchaseNumber
        ? `L'article sera aussi retiré de l'achat ${item.purchaseNumber} (dont le total sera recalculé).`
        : "L'article sera définitivement supprimé de l'inventaire."
    }).subscribe(ok => {
      if (!ok) return;
      this.api.delete(item.id).subscribe({
        next: () => {
          this.notify.success('Article supprimé.');
          this.load();
        },
        error: err => this.notify.error(err)
      });
    });
  }
}
