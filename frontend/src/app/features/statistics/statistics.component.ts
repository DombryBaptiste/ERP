import { CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { forkJoin } from 'rxjs';
import { Insights, Statistics } from '../../core/models';
import { ReportingService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { euro, monthLabel, truncate } from '../../core/utils';
import { ChartComponent } from '../../shared/chart.component';
import { barChart, COLORS, doughnutChart, profitColors } from '../../shared/charts';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';
import { StatTableComponent } from './stat-table.component';

/** Couleurs des répartitions (anneaux). */
const PALETTE = ['#3949ab', '#ef6c00', '#00897b', '#8e24aa', '#c62828', '#5d4037', '#1e88e5', '#7cb342', '#f9a825', '#546e7a', '#d81b60', '#00acc1'];

/** Histogramme d'un nombre (articles, ventes, jours…) et non d'un montant. */
function countChart(
  labels: string[], label: string, data: number[], color: string | string[], unit: string, horizontal = false
): ChartConfiguration<'bar'> {
  const valueAxis = { beginAtZero: true, ticks: { precision: 0 } };
  const categoryAxis = { grid: { display: false } };
  return {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: color, borderRadius: 6, maxBarThickness: 34 }] },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => `${label} : ${((horizontal ? ctx.parsed.x : ctx.parsed.y) ?? 0).toLocaleString('fr-FR')} ${unit}` }
        }
      },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis }
    }
  };
}

/** Mois court pour les axes, ex. « janv. ». */
const shortMonth = (year: number, month: number): string => monthLabel(year, month).split(' ')[0];

/** Couleur fixe par origine (les lignes sont triées par montant, l'ordre peut changer). */
const originColors = (rows: { label: string }[]): string[] =>
  rows.map(r => (r.label === 'Ma collection' ? COLORS.accent : COLORS.revenue));

/** Somme cumulée d'une série. */
const cumulate = (values: number[]): number[] => values.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);

@Component({
  selector: 'app-statistics',
  imports: [
    RouterLink, CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet, LabelPipe,
    MatCardModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatSlideToggleModule, MatTabsModule,
    KpiCardComponent, ChartComponent, StatTableComponent
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
  readonly insights = signal<Insights | null>(null);
  readonly includePersonalCollection = signal(true);

  private readonly monthLabels = computed(() => (this.stats()?.monthly ?? []).map(m => monthLabel(m.year, m.month)));

  readonly revenueChart = computed(() =>
    barChart(this.monthLabels(), "Chiffre d'affaires", (this.stats()?.monthly ?? []).map(m => m.revenue), COLORS.revenue));

  readonly profitChart = computed(() => {
    const values = (this.stats()?.monthly ?? []).map(m => m.profit);
    return barChart(this.monthLabels(), 'Bénéfice', values, profitColors(values));
  });

  readonly bestSellersChart = computed(() => {
    const products = this.stats()?.topProductsByRevenue ?? [];
    return barChart(products.map(p => truncate(p.name)), "Chiffre d'affaires", products.map(p => p.revenue), COLORS.accent, true);
  });

  readonly mostProfitableChart = computed(() => {
    const products = this.stats()?.topProductsByProfit ?? [];
    const values = products.map(p => p.profit);
    return barChart(products.map(p => truncate(p.name)), 'Bénéfice brut', values, profitColors(values), true);
  });

  // ----- Statistiques détaillées -----

  readonly platformChart = computed(() => {
    const rows = this.insights()?.byPlatform ?? [];
    return barChart(rows.map(r => r.label), "Chiffre d'affaires", rows.map(r => r.revenue), COLORS.revenue, true);
  });

  readonly typeChart = computed(() => {
    const rows = (this.insights()?.byType ?? []).filter(r => r.revenue > 0);
    return doughnutChart(rows.map(r => r.label), rows.map(r => r.revenue), PALETTE, v => euro(v, 2));
  });

  readonly originChart = computed(() => {
    const rows = (this.insights()?.byOrigin ?? []).filter(r => r.revenue > 0);
    return doughnutChart(rows.map(r => r.label), rows.map(r => r.revenue), originColors(rows), v => euro(v, 2));
  });

  readonly bulkOriginChart = computed(() => {
    const rows = this.insights()?.bulk.byOrigin ?? [];
    return doughnutChart(rows.map(r => r.label), rows.map(r => r.quantity), originColors(rows),
      v => `${v.toLocaleString('fr-FR')} carte(s)`);
  });

  readonly seriesChart = computed(() => {
    const rows = (this.insights()?.bySeries ?? []).slice(0, 10);
    const values = rows.map(r => r.profit);
    return barChart(rows.map(r => truncate(r.label)), 'Bénéfice', values, profitColors(values), true);
  });

  readonly daysChart = computed(() => {
    const rows = this.insights()?.daysToSellByType ?? [];
    return countChart(rows.map(r => r.label), 'Délai moyen', rows.map(r => r.averageDays), COLORS.sealed, 'jour(s)', true);
  });

  readonly stockAgeChart = computed(() => {
    const rows = this.insights()?.stockAge ?? [];
    return barChart(rows.map(r => r.label), 'Valeur du stock', rows.map(r => r.value),
      ['#7cb342', '#c0ca33', '#f9a825', '#ef6c00', '#c62828']);
  });

  readonly weekdayChart = computed(() => {
    const rows = this.insights()?.byWeekday ?? [];
    return countChart(rows.map(r => r.label), 'Ventes', rows.map(r => r.sales), COLORS.revenue, 'vente(s)');
  });

  readonly priceBandChart = computed(() => {
    const rows = this.insights()?.byPriceBand ?? [];
    return countChart(rows.map(r => r.label), 'Articles vendus', rows.map(r => r.quantity), COLORS.cards, 'article(s)');
  });

  /** CA mensuel : année choisie face à l'année précédente. */
  readonly comparisonChart = computed<ChartConfiguration<'bar'>>(() => {
    const s = this.stats();
    const i = this.insights();
    return {
      type: 'bar',
      data: {
        labels: (s?.monthly ?? []).map(m => shortMonth(m.year, m.month)),
        datasets: [
          {
            label: String(i?.comparison.previousYear ?? ''), data: (i?.comparison.monthly ?? []).map(m => m.revenue),
            backgroundColor: '#c5cae9', borderRadius: 6, maxBarThickness: 22
          },
          {
            label: String(s?.year ?? ''), data: (s?.monthly ?? []).map(m => m.revenue),
            backgroundColor: COLORS.revenue, borderRadius: 6, maxBarThickness: 22
          }
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} : ${euro(ctx.parsed.y ?? 0, 2)}` } }
        },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: value => euro(value) } } }
      }
    };
  });

  /** CA cumulé au fil des mois (année choisie et année précédente). */
  readonly cumulativeChart = computed<ChartConfiguration<'line'>>(() => {
    const s = this.stats();
    const i = this.insights();
    const today = new Date();
    // Année en cours : la courbe s'arrête au mois actuel.
    const current = cumulate((s?.monthly ?? []).map(m => m.revenue))
      .map((v, index) => (s?.year === today.getFullYear() && index > today.getMonth() ? null : v));
    return {
      type: 'line',
      data: {
        labels: (s?.monthly ?? []).map(m => shortMonth(m.year, m.month)),
        datasets: [
          {
            label: String(i?.comparison.previousYear ?? ''), data: cumulate((i?.comparison.monthly ?? []).map(m => m.revenue)),
            borderColor: '#9fa8da', backgroundColor: 'transparent', borderDash: [6, 4], tension: 0.3, pointRadius: 2, borderWidth: 2
          },
          {
            label: String(s?.year ?? ''), data: current,
            borderColor: COLORS.revenue, backgroundColor: COLORS.revenue + '26', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2
          }
        ]
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} : ${euro(ctx.parsed.y ?? 0, 2)}` } }
        },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: value => euro(value) } } }
      }
    };
  });

  /** Meilleur mois de l'année (CA). */
  readonly bestMonth = computed(() => {
    const months = (this.stats()?.monthly ?? []).filter(m => m.revenue > 0);
    return months.length ? months.reduce((best, m) => (m.revenue > best.revenue ? m : best)) : null;
  });

  /** Meilleur jour de la semaine (nombre de ventes). */
  readonly bestWeekday = computed(() => {
    const days = (this.insights()?.byWeekday ?? []).filter(d => d.sales > 0);
    return days.length ? days.reduce((best, d) => (d.sales > best.sales ? d : best)) : null;
  });

  constructor() {
    this.load();
  }

  /** Évolution par rapport à l'année précédente, ex. « +12 % vs 2025 » (« à date » pour l'année en cours). */
  evolutionText(current: number, previous: number): string {
    const year = `${this.insights()?.comparison.previousYear ?? ''}${this.stats()?.year === this.currentYear ? ' à date' : ''}`;
    if (previous === 0) return `${year} : aucune donnée`;
    const percent = ((current - previous) / Math.abs(previous)) * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} % vs ${year}`;
  }

  changeYear(year: number): void {
    this.year.set(year);
    this.load();
  }

  changeCollection(include: boolean): void {
    this.includePersonalCollection.set(include);
    this.load();
  }

  monthName(year: number, month: number): string {
    return new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long' });
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({
      stats: this.reporting.statistics(this.year(), this.includePersonalCollection()),
      insights: this.reporting.insights(this.year(), this.includePersonalCollection())
    }).subscribe({
      next: ({ stats, insights }) => {
        this.stats.set(stats);
        this.insights.set(insights);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }
}
