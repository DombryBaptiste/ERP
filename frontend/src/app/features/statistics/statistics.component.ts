import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { Statistics } from '../../core/models';
import { ReportingService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { monthLabel, truncate } from '../../core/utils';
import { ChartComponent } from '../../shared/chart.component';
import { barChart, COLORS } from '../../shared/charts';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';

@Component({
  selector: 'app-statistics',
  imports: [
    RouterLink, CurrencyPipe, DatePipe, DecimalPipe, LabelPipe,
    MatCardModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatProgressBarModule,
    KpiCardComponent, ChartComponent
  ],
  templateUrl: './statistics.component.html'
})
export class StatisticsComponent {
  private readonly reporting = inject(ReportingService);
  private readonly notify = inject(NotifyService);

  readonly currentYear = new Date().getFullYear();
  readonly year = signal(this.currentYear);
  readonly loading = signal(true);
  readonly stats = signal<Statistics | null>(null);

  private readonly monthLabels = computed(() => (this.stats()?.monthly ?? []).map(m => monthLabel(m.year, m.month)));

  readonly revenueChart = computed(() =>
    barChart(this.monthLabels(), "Chiffre d'affaires", (this.stats()?.monthly ?? []).map(m => m.revenue), COLORS.revenue));

  readonly profitChart = computed(() => {
    const values = (this.stats()?.monthly ?? []).map(m => m.profit);
    return barChart(this.monthLabels(), 'Bénéfice', values, values.map(v => (v < 0 ? COLORS.loss : COLORS.profit)));
  });

  readonly bestSellersChart = computed(() => {
    const products = this.stats()?.topProductsByRevenue ?? [];
    return barChart(products.map(p => truncate(p.name)), "Chiffre d'affaires", products.map(p => p.revenue), COLORS.accent, true);
  });

  readonly mostProfitableChart = computed(() => {
    const products = this.stats()?.topProductsByProfit ?? [];
    return barChart(products.map(p => truncate(p.name)), 'Bénéfice brut', products.map(p => p.profit),
      products.map(p => (p.profit < 0 ? COLORS.loss : COLORS.profit)), true);
  });

  constructor() {
    this.load();
  }

  changeYear(year: number): void {
    this.year.set(year);
    this.load();
  }

  monthName(year: number, month: number): string {
    return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long' });
  }

  private load(): void {
    this.loading.set(true);
    this.reporting.statistics(this.year()).subscribe({
      next: s => {
        this.stats.set(s);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }
}
