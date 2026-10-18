import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';
import { SHIPPING_KIND_ICONS } from '../../core/labels';
import { ShippingStock, ShippingSummary, ShippingSupply, ShippingSupplyKind } from '../../core/models';
import { ShippingService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { euro, monthLabel } from '../../core/utils';
import { ChartComponent } from '../../shared/chart.component';
import { COLORS } from '../../shared/charts';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';
import { ShippingSupplyDialogComponent, ShippingSupplyDialogData } from './shipping-supply-dialog.component';

/**
 * Frais d'envoi : achats de timbres, bordereaux et emballages, stock restant,
 * et coût réel des envois face au port payé par les acheteurs.
 */
@Component({
  selector: 'app-shipping',
  imports: [
    RouterLink, CurrencyPipe, DatePipe, DecimalPipe, LabelPipe,
    MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule, MatTooltipModule, MatProgressBarModule,
    KpiCardComponent, ChartComponent
  ],
  templateUrl: './shipping.component.html',
  styleUrl: './shipping.component.scss'
})
export class ShippingComponent {
  private readonly api = inject(ShippingService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);

  readonly kindIcons = SHIPPING_KIND_ICONS;
  readonly currentYear = new Date().getFullYear();
  readonly year = signal(this.currentYear);
  readonly loading = signal(true);
  readonly summary = signal<ShippingSummary | null>(null);
  readonly supplies = signal<ShippingSupply[]>([]);
  readonly kindFilter = signal<ShippingSupplyKind | ''>('');

  readonly filteredSupplies = computed(() => {
    const kind = this.kindFilter();
    return kind ? this.supplies().filter(s => s.kind === kind) : this.supplies();
  });

  /** Marge sur le port : ce que les acheteurs ont payé moins ce que les envois ont réellement coûté. */
  readonly portMargin = computed(() => {
    const s = this.summary();
    return s ? s.paidByBuyersThisYear - s.usedThisYear : 0;
  });

  readonly chart = computed<ChartConfiguration<'bar'>>(() => {
    const s = this.summary();
    const months = s?.monthly ?? [];
    const dataset = (label: string, data: number[], color: string) =>
      ({ label, data, backgroundColor: color, borderRadius: 4, maxBarThickness: 22 });
    return {
      type: 'bar',
      data: {
        labels: months.map(m => monthLabel(s?.year ?? this.currentYear, m.month)),
        datasets: [
          dataset('Fournitures achetées', months.map(m => m.spent), COLORS.accent),
          dataset('Coût réel des envois', months.map(m => m.used), COLORS.loss),
          dataset('Port payé par les acheteurs', months.map(m => m.paidByBuyers), COLORS.profit)
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} : ${euro(ctx.parsed.y ?? 0, 2)}` } }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: value => euro(value) } }
        }
      }
    };
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({ summary: this.api.summary(this.year()), supplies: this.api.supplies(this.year()) }).subscribe({
      next: ({ summary, supplies }) => {
        this.summary.set(summary);
        this.supplies.set(supplies);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  changeYear(year: number): void {
    this.year.set(year);
    this.load();
  }

  /** Nouvel achat ; `stock` pré-remplit la fourniture à racheter. */
  openAdd(stock?: ShippingStock): void {
    const data: ShippingSupplyDialogData = {
      preset: stock ? { name: stock.name, kind: stock.kind, carrier: stock.carrier } : undefined,
      knownNames: this.knownNames()
    };
    this.dialog.open(ShippingSupplyDialogComponent, { data, width: '640px' }).afterClosed()
      .subscribe(result => { if (result) this.load(); });
  }

  edit(supply: ShippingSupply): void {
    const data: ShippingSupplyDialogData = { supply, knownNames: this.knownNames() };
    this.dialog.open(ShippingSupplyDialogComponent, { data, width: '640px' }).afterClosed()
      .subscribe(result => { if (result) this.load(); });
  }

  remove(supply: ShippingSupply, event: Event): void {
    event.stopPropagation();
    this.notify.confirm({
      title: `Supprimer l'achat ${supply.supplyNumber} ?`,
      message: supply.usedQuantity > 0
        ? 'Cette fourniture a déjà servi à des envois : retirez-la d\'abord des ventes concernées.'
        : `${supply.name} ×${supply.quantity} — ${supply.totalAmount.toFixed(2)} €`
    }).subscribe(ok => {
      if (!ok) return;
      this.api.delete(supply.id).subscribe({
        next: () => {
          this.notify.success('Achat supprimé.');
          this.load();
        },
        error: err => this.notify.error(err)
      });
    });
  }

  private knownNames() {
    return (this.summary()?.stock ?? []).map(s => ({ name: s.name, kind: s.kind, carrier: s.carrier }));
  }
}
