import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { BulkCategory, BulkSettings, InventoryItem, Sale } from '../../core/models';
import { ProductGroup } from '../../core/products';
import { BulkService, InventoryService, SaleService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { BulkAddDialogComponent, BulkAddDialogData } from './bulk-add-dialog.component';
import { BulkSellDialogComponent, BulkSellDialogData } from './bulk-sell-dialog.component';
import { bulkProducts, cardsFromGrams, isBulk } from './bulk';

/** Une catégorie de bulk avec son stock. */
interface BulkPool {
  name: string;
  suggestedPricePerCard: number;
  product: ProductGroup | null;
  cards: number;
  averageCost: number;
  stockValue: number;
  /** Valeur au prix conseillé. */
  potentialValue: number;
  /** Poids estimé du stock, en kg. */
  weightKg: number;
}

/** Vente de bulk (une ligne de l'historique). */
interface BulkSaleRow {
  sale: Sale;
  category: string;
  cards: number;
  amount: number;
  profit: number;
}

/**
 * Page Bulk : le vrac (communes, reverses…) se gère au nombre de cartes, sans fiche par carte.
 * On ajoute des cartes (achat ou collection, au nombre ou au poids) et on vend des lots.
 */
@Component({
  selector: 'app-bulk',
  imports: [
    FormsModule, RouterLink, CurrencyPipe, DecimalPipe, DatePipe,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatTooltipModule, MatProgressBarModule,
    KpiCardComponent
  ],
  templateUrl: './bulk.component.html',
  styleUrl: './bulk.component.scss'
})
export class BulkComponent {
  private readonly bulkApi = inject(BulkService);
  private readonly inventoryApi = inject(InventoryService);
  private readonly saleApi = inject(SaleService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
  readonly settings = signal<BulkSettings | null>(null);
  private readonly items = signal<InventoryItem[]>([]);
  private readonly sales = signal<Sale[]>([]);

  /** Copie modifiable des réglages (panneau « Réglages »). */
  editGrams = 1.8;
  editCategories: BulkCategory[] = [];
  readonly showSettings = signal(false);
  readonly savingSettings = signal(false);

  /** Calculatrice de poids. */
  readonly calcGrams = signal(1000);

  readonly pools = computed<BulkPool[]>(() => {
    const settings = this.settings();
    if (!settings) return [];
    const products = bulkProducts(this.items());
    // Catégories des réglages, puis éventuelles catégories qui n'existent plus dans les réglages mais ont du stock.
    const names = [...settings.categories.map(c => c.name), ...[...products.keys()].filter(n => !settings.categories.some(c => c.name === n))];
    return names.map(name => {
      const product = products.get(name) ?? null;
      const price = settings.categories.find(c => c.name === name)?.suggestedPricePerCard ?? 0;
      const cards = product?.remaining ?? 0;
      return {
        name,
        suggestedPricePerCard: price,
        product,
        cards,
        averageCost: product && cards > 0 ? product.stockValue / cards : 0,
        stockValue: product?.stockValue ?? 0,
        potentialValue: cards * price,
        weightKg: (cards * settings.gramsPerCard) / 1000
      };
    });
  });

  readonly totals = computed(() => this.pools().reduce((acc, p) => ({
    cards: acc.cards + p.cards,
    cost: acc.cost + p.stockValue,
    potential: acc.potential + p.potentialValue,
    weightKg: acc.weightKg + p.weightKg
  }), { cards: 0, cost: 0, potential: 0, weightKg: 0 }));

  /** 20 dernières ventes contenant du bulk. */
  readonly recentSales = computed<BulkSaleRow[]>(() => this.sales()
    .filter(s => s.items.some(i => i.itemType === 'Bulk'))
    .slice(0, 20)
    .map(sale => {
      const lines = sale.items.filter(i => i.itemType === 'Bulk');
      return {
        sale,
        category: [...new Set(lines.map(l => l.itemName))].join(', '),
        cards: lines.reduce((s, l) => s + l.quantity, 0),
        amount: lines.reduce((s, l) => s + l.lineTotal, 0),
        profit: lines.reduce((s, l) => s + l.lineProfit, 0)
      };
    }));

  /** 20 derniers ajouts de bulk (lots). */
  readonly recentLots = computed(() => this.items()
    .filter(isBulk)
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id)
    .slice(0, 20));

  readonly calcCards = computed(() => cardsFromGrams(this.calcGrams(), this.settings()?.gramsPerCard ?? 1.8));

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({ settings: this.bulkApi.settings(), items: this.inventoryApi.getAll(), sales: this.saleApi.getAll() }).subscribe({
      next: ({ settings, items, sales }) => {
        this.settings.set(settings);
        this.items.set(items);
        this.sales.set(sales);
        this.resetSettingsForm();
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  // ----- Ajout / vente -----

  openAdd(category?: string): void {
    const settings = this.settings();
    if (!settings) return;
    const data: BulkAddDialogData = { settings, category };
    this.dialog.open(BulkAddDialogComponent, { data, width: '620px' }).afterClosed()
      .subscribe(result => { if (result) this.load(); });
  }

  openSell(category?: string): void {
    const settings = this.settings();
    if (!settings) return;
    const products = this.pools().filter(p => p.product && p.cards > 0).map(p => p.product!);
    if (products.length === 0) {
      this.notify.error(null, "Aucun bulk en stock : ajoutez d'abord des cartes.");
      return;
    }
    const data: BulkSellDialogData = { settings, products, category: category && products.some(p => p.name === category) ? category : undefined };
    this.dialog.open(BulkSellDialogComponent, { data, width: '640px' }).afterClosed()
      .subscribe(result => { if (result) this.load(); });
  }

  // ----- Réglages -----

  resetSettingsForm(): void {
    const s = this.settings();
    this.editGrams = s?.gramsPerCard ?? 1.8;
    this.editCategories = (s?.categories ?? []).map(c => ({ ...c }));
  }

  addCategory(): void {
    this.editCategories = [...this.editCategories, { name: '', suggestedPricePerCard: 0 }];
  }

  removeCategory(index: number): void {
    const name = this.editCategories[index]?.name;
    if (name && (this.pools().find(p => p.name === name)?.cards ?? 0) > 0) {
      this.notify.error(null, `« ${name} » a encore du stock : vendez-le avant de supprimer la catégorie.`);
      return;
    }
    this.editCategories = this.editCategories.filter((_, i) => i !== index);
  }

  saveSettings(): void {
    const current = this.settings();
    // Renommer une catégorie ayant du stock séparerait ses cartes : on l'interdit.
    const renamedWithStock = (current?.categories ?? []).find(c =>
      !this.editCategories.some(e => e.name.trim() === c.name)
      && (this.pools().find(p => p.name === c.name)?.cards ?? 0) > 0);
    if (renamedWithStock) {
      this.notify.error(null, `« ${renamedWithStock.name} » a du stock : son nom ne peut pas changer.`);
      return;
    }
    this.savingSettings.set(true);
    this.bulkApi.saveSettings({
      gramsPerCard: Number(this.editGrams) || 1.8,
      categories: this.editCategories.map(c => ({ name: c.name.trim(), suggestedPricePerCard: Number(c.suggestedPricePerCard) || 0 }))
    }).subscribe({
      next: saved => {
        this.settings.set(saved);
        this.resetSettingsForm();
        this.savingSettings.set(false);
        this.showSettings.set(false);
        this.notify.success('Réglages du bulk enregistrés.');
      },
      error: err => {
        this.savingSettings.set(false);
        this.notify.error(err);
      }
    });
  }
}
