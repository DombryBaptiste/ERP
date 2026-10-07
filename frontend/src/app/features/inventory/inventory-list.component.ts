import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
import { groupProducts, ProductGroup } from '../../core/products';
import { AttachmentService, InventoryService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { LabelPipe } from '../../shared/label.pipe';
import { marketDataForLot, MarketValueDialogComponent, MarketValueDialogData } from '../../shared/market-value-dialog.component';

type StockStatus = 'all' | 'instock' | 'sold';
type CardmarketFilter = 'all' | 'checked' | 'unchecked';

interface InventoryFilters {
  search: string;
  category: string;
  type: string;
  condition: string;
  origin: string;
  status: StockStatus;
  cardmarket: CardmarketFilter;
}

/**
 * Inventaire regroupé par produit : un même produit acheté plusieurs fois (à des prix différents)
 * n'apparaît qu'une fois, avec son coût moyen ; le détail des lots se déplie sous la ligne.
 */
@Component({
  selector: 'app-inventory-list',
  imports: [
    FormsModule, RouterLink, CurrencyPipe, DatePipe, LabelPipe,
    MatTableModule, MatSortModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatCheckboxModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './inventory-list.component.html',
  styleUrl: './inventory-list.component.scss'
})
export class InventoryListComponent {
  private readonly api = inject(InventoryService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly attachments = inject(AttachmentService);

  readonly types = ITEM_TYPES;
  readonly conditions = CONDITIONS;
  readonly origins = ORIGINS;
  readonly columns = [
    'expand', 'name', 'category', 'cardmarket', 'type', 'condition', 'averageCost', 'remaining',
    'stockValue', 'marketValue', 'lastPurchaseDate', 'actions'
  ];
  readonly dataSource = new MatTableDataSource<ProductGroup>([]);
  readonly loading = signal(true);
  private readonly allItems = signal<InventoryItem[]>([]);
  /** Produits dont le détail des lots est déplié. */
  readonly expanded = signal<Set<string>>(new Set());

  /** Catégories présentes dans l'inventaire, pour le filtre. */
  readonly categories = computed(() =>
    [...new Set(this.allItems().map(i => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)));

  filters: InventoryFilters = {
    search: '', category: '', type: '', condition: '', origin: '', status: 'instock', cardmarket: 'all'
  };

  @ViewChild(MatSort) set sort(sort: MatSort) { this.dataSource.sort = sort; }
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator) { this.dataSource.paginator = paginator; }

  constructor() {
    this.dataSource.sortingDataAccessor = (p: ProductGroup, column: string): string | number => {
      switch (column) {
        case 'name': return p.name.toLowerCase();
        case 'category': return (p.category ?? '').toLowerCase();
        case 'cardmarket': return p.isListedOnCardmarket ? 1 : 0;
        case 'marketValue': return p.marketValue ?? -1;
        case 'lastPurchaseDate': return p.lastPurchaseDate;
        default: return (p as unknown as Record<string, string | number>)[column] ?? '';
      }
    };
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getAll().subscribe({
      next: items => {
        this.allItems.set(items);
        this.applyFilters();
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
    this.filters = {
      search: '', category: '', type: '', condition: '', origin: '', status: 'all', cardmarket: 'all'
    };
    this.applyFilters();
  }

  /** Filtre les lots (recherche instantanée côté client), puis les regroupe par produit. */
  private applyFilters(): void {
    const f = this.filters;
    const search = f.search.toLowerCase();
    const lots = this.allItems().filter(item => {
      const text = `${item.id} ${item.name} ${item.category ?? ''} ${item.location ?? ''} ${item.purchaseNumber ?? ''}`.toLowerCase();
      return (!search || text.includes(search))
        && (!f.category || item.category === f.category)
        && (!f.type || item.type === f.type)
        && (!f.condition || item.condition === f.condition)
        && (!f.origin || item.origin === f.origin)
        && (f.status === 'all'
          || (f.status === 'instock' && item.remainingQuantity > 0)
          || (f.status === 'sold' && item.remainingQuantity === 0));
    });
    const products = groupProducts(lots);
    const filteredProducts = f.cardmarket === 'all'
      ? products
      : products.filter(product =>
          f.cardmarket === 'checked'
            ? product.isListedOnCardmarket
            : !product.isListedOnCardmarket);
    this.dataSource.data = filteredProducts;
    this.dataSource.paginator?.firstPage();
  }

  // ----- Lignes dépliables -----

  isExpanded(p: ProductGroup): boolean {
    return this.expanded().has(p.key);
  }

  toggle(p: ProductGroup): void {
    this.expanded.update(set => {
      const next = new Set(set);
      if (next.has(p.key)) next.delete(p.key); else next.add(p.key);
      return next;
    });
  }

  /** Clic sur un produit : un seul lot → sa fiche ; plusieurs lots → déplier. */
  open(p: ProductGroup): void {
    if (p.lots.length === 1) this.router.navigate(['/inventory', p.lots[0].id]);
    else this.toggle(p);
  }

  // ----- Totaux -----

  summary(): { products: number; quantity: number; value: number; marketValue: number; gain: number } {
    return this.dataSource.filteredData.reduce((acc, p) => ({
      products: acc.products + 1,
      quantity: acc.quantity + p.remaining,
      value: acc.value + p.stockValue,
      marketValue: acc.marketValue + p.lots.reduce((s, l) => s + l.remainingQuantity * (l.marketValue ?? l.purchasePrice), 0),
      gain: acc.gain + (p.latentGain ?? 0)
    }), { products: 0, quantity: 0, value: 0, marketValue: 0, gain: 0 });
  }

  photoUrl(id: number): string {
    return this.attachments.fileUrl(id);
  }

  // ----- Actions -----

  /** Estimation de la valeur de marché, appliquée à tous les lots encore en stock du produit. */
  editProductMarketValue(p: ProductGroup, event: Event): void {
    event.stopPropagation();
    const inStock = p.lots.filter(l => l.remainingQuantity > 0);
    const data: MarketValueDialogData = {
      name: p.name, purchasePrice: p.averageCost, marketValue: p.marketValue,
      marketValueUpdatedAt: p.lots.map(l => l.marketValueUpdatedAt ?? '').sort().pop() || null,
      lotIds: (inStock.length ? inStock : p.lots).map(l => l.id)
    };
    this.openMarketDialog(data);
  }

  editLotMarketValue(lot: InventoryItem, event: Event): void {
    event.stopPropagation();
    this.openMarketDialog(marketDataForLot(lot));
  }

  private openMarketDialog(data: MarketValueDialogData): void {
    this.dialog.open(MarketValueDialogComponent, { data, width: '440px' }).afterClosed()
      .subscribe((updated?: InventoryItem[]) => {
        if (!updated?.length) return;
        const byId = new Map(updated.map(u => [u.id, u]));
        this.allItems.update(list => list.map(i => byId.get(i.id) ?? i));
        this.applyFilters();
      });
  }

  editLot(lot: InventoryItem): void {
    this.router.navigate(['/inventory', lot.id]);
  }

  setCardmarketListing(product: ProductGroup, isListed: boolean): void {
    this.api.setCardmarketListing(product.lots.map(lot => lot.id), isListed).subscribe({
      next: () => {
        const itemIds = new Set(product.lots.map(lot => lot.id));
        this.allItems.update(items => items.map(item =>
          itemIds.has(item.id) ? { ...item, isListedOnCardmarket: isListed } : item));
        this.dataSource.data = this.dataSource.data.map(item =>
          item.key === product.key ? { ...item, isListedOnCardmarket: isListed } : item);
      },
      error: err => this.notify.error(err)
    });
  }

  sell(p: ProductGroup, event: Event): void {
    event.stopPropagation();
    const lot = p.lots.find(l => l.remainingQuantity > 0);
    if (lot) this.router.navigate(['/sales/new'], { queryParams: { item: lot.id } });
  }

  deleteLot(item: InventoryItem, event: Event): void {
    event.stopPropagation();
    this.notify.confirm({
      title: `Supprimer ce lot de « ${item.name} » ?`,
      message: item.purchaseNumber
        ? `Le lot sera aussi retiré de l'achat ${item.purchaseNumber} (dont le total sera recalculé).`
        : "Le lot sera définitivement supprimé de l'inventaire."
    }).subscribe(ok => {
      if (!ok) return;
      this.api.delete(item.id).subscribe({
        next: () => {
          this.notify.success('Lot supprimé.');
          this.load();
        },
        error: err => this.notify.error(err)
      });
    });
  }
}
