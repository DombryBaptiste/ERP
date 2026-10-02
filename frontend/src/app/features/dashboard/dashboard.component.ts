import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Alerts, Dashboard, TaxSummary } from '../../core/models';
import { ReportingService, TaxService, ToolsService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { monthLabel } from '../../core/utils';
import { ChartComponent } from '../../shared/chart.component';
import { barChart, COLORS, doughnutChart, lineChart } from '../../shared/charts';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';

@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink, CurrencyPipe, DatePipe, DecimalPipe, LabelPipe,
    MatCardModule, MatIconModule, MatButtonModule, MatProgressBarModule,
    KpiCardComponent, ChartComponent
  ],
  templateUrl: './dashboard.component.html'
})
export class DashboardComponent {
  private readonly reporting = inject(ReportingService);
  private readonly notify = inject(NotifyService);

  readonly today = new Date();
  readonly loading = signal(true);
  readonly data = signal<Dashboard | null>(null);
  readonly tax = signal<TaxSummary | null>(null);
  private readonly taxApi = inject(TaxService);
  private readonly toolsApi = inject(ToolsService);
  readonly alerts = signal<Alerts | null>(null);

  private readonly labels = computed(() =>
    (this.data()?.last12Months ?? []).map(p => monthLabel(p.year, p.month)));

  readonly revenueChart = computed(() =>
    lineChart(this.labels(), "Chiffre d'affaires", (this.data()?.last12Months ?? []).map(p => p.revenue), COLORS.revenue));

  readonly profitChart = computed(() => {
    const values = (this.data()?.last12Months ?? []).map(p => p.profit);
    return barChart(this.labels(), 'Bénéfice', values, values.map(v => (v < 0 ? COLORS.loss : COLORS.profit)));
  });

  readonly distributionChart = computed(() => {
    const slices = this.data()?.stockDistribution ?? [];
    return doughnutChart(slices.map(s => s.label), slices.map(s => s.quantity), [COLORS.cards, COLORS.sealed]);
  });

  constructor() {
    // Prochaine échéance URSSAF (facultatif : le tableau de bord s'affiche même en cas d'erreur).
    this.taxApi.summary().subscribe({ next: s => this.tax.set(s), error: () => this.tax.set(null) });
    this.toolsApi.alerts().subscribe({ next: a => this.alerts.set(a), error: () => this.alerts.set(null) });

    this.reporting.dashboard().subscribe({
      next: d => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }
}
