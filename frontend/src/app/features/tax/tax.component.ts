import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChartConfiguration } from 'chart.js';
import { TaxPeriod, TaxSettings, TaxSummary } from '../../core/models';
import { TaxService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { euro } from '../../core/utils';
import { ChartComponent } from '../../shared/chart.component';
import { COLORS, doughnutChart } from '../../shared/charts';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';
import { TaxGuideComponent } from './tax-guide.component';
import { daysUntil, DAC7, STATUS_LABELS, URSSAF_URL } from './tax-rules';
import { TaxSettingsComponent } from './tax-settings.component';
import { TaxSimulatorComponent } from './tax-simulator.component';

interface Threshold {
  label: string;
  hint: string;
  limit: number;
  percent: number;
  projectedPercent: number;
  level: 'ok' | 'warn' | 'over';
}

/** Onglet Fiscalité : synthèse, déclarations URSSAF, simulateur, paramètres et guide. */
@Component({
  selector: 'app-tax',
  imports: [
    CurrencyPipe, DatePipe, DecimalPipe, LabelPipe,
    MatTabsModule, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule,
    MatProgressBarModule, MatCheckboxModule, MatTooltipModule,
    KpiCardComponent, ChartComponent, TaxSettingsComponent, TaxSimulatorComponent, TaxGuideComponent
  ],
  templateUrl: './tax.component.html',
  styleUrl: './tax.component.scss'
})
export class TaxComponent {
  private readonly api = inject(TaxService);
  private readonly notify = inject(NotifyService);

  readonly urssafUrl = URSSAF_URL;
  readonly dac7 = DAC7;
  readonly statusLabels = STATUS_LABELS;
  readonly currentYear = new Date().getFullYear();
  readonly year = signal(this.currentYear);
  readonly loading = signal(true);
  readonly summary = signal<TaxSummary | null>(null);
  readonly selectedTab = signal(0);

  readonly settings = computed<TaxSettings | null>(() => this.summary()?.settings ?? null);

  readonly nextDays = computed(() => {
    const next = this.summary()?.nextDeclaration;
    return next ? daysUntil(next.deadline) : null;
  });

  /** Progression vers les seuils (plafond micro, franchise TVA). */
  readonly thresholds = computed<Threshold[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const make = (label: string, hint: string, limit: number): Threshold => {
      const percent = limit > 0 ? (s.revenue / limit) * 100 : 0;
      const projectedPercent = limit > 0 ? (s.projectedRevenue / limit) * 100 : 0;
      return { label, hint, limit, percent, projectedPercent,
        level: percent >= 100 ? 'over' : projectedPercent >= 90 ? 'warn' : 'ok' };
    };
    return [
      make('Franchise de TVA', 'Au-delà, vous devrez facturer la TVA à partir de l\'année suivante.', s.settings.vatThreshold),
      make('Seuil majoré de TVA', 'Au-delà, la TVA est due dès le jour du dépassement.', s.settings.vatThresholdIncreased),
      make('Plafond du régime micro', 'Dépassé 2 années de suite, vous sortez du régime micro.', s.settings.revenueCeiling)
    ];
  });

  /** « Où va chaque euro encaissé ». */
  readonly splitChart = computed(() => {
    const s = this.summary();
    const costs = s ? Math.max(0, s.revenue - s.profit) : 0;
    const urssaf = s?.urssafTotal ?? 0;
    const taxes = (s?.estimatedIncomeTax ?? 0) + (s?.cfeAmount ?? 0);
    const net = Math.max(0, s?.netIncome ?? 0);
    return doughnutChart(
      ['Achats & frais de vente', 'URSSAF', 'Impôt & CFE', 'Reste pour vous'],
      [costs, urssaf, taxes, net].map(v => Math.round(v * 100) / 100),
      ['#90a4ae', COLORS.revenue, COLORS.cards, COLORS.profit],
      v => euro(v, 2));
  });

  /** Montant à payer par période, empilé par nature de prélèvement. */
  readonly periodsChart = computed<ChartConfiguration<'bar'>>(() => {
    const periods = this.summary()?.periods ?? [];
    const dataset = (label: string, values: number[], color: string) =>
      ({ label, data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 40, stack: 'total' });
    return {
      type: 'bar',
      data: {
        labels: periods.map(p => this.shortLabel(p)),
        datasets: [
          dataset('Cotisations sociales', periods.map(p => p.socialContributions), COLORS.revenue),
          dataset('CFP + chambre consulaire', periods.map(p => p.trainingContribution + p.chamberTax), COLORS.accent),
          dataset('Versement libératoire', periods.map(p => p.liberatoryIncomeTax), COLORS.cards)
        ]
      },
      options: {
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} : ${euro(ctx.parsed.y ?? 0, 2)}` } }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: value => euro(value) } }
        }
      }
    };
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.summary(this.year()).subscribe({
      next: s => {
        this.summary.set(s);
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

  shortLabel(p: TaxPeriod): string {
    return p.key.includes('-T') ? `T${p.key.split('-T')[1]}` : p.label.split(' ')[0].slice(0, 4) + '.';
  }

  toggleDeclared(period: TaxPeriod, declared: boolean): void {
    this.api.setDeclared(period.key, declared).subscribe({
      next: () => {
        this.notify.success(declared ? `${period.label} marquée comme déclarée.` : `${period.label} remise « à déclarer ».`);
        this.load();
      },
      error: err => this.notify.error(err)
    });
  }

  /** Copie le CA à déclarer (format attendu par le site de l'URSSAF : euros entiers). */
  copyRevenue(period: TaxPeriod): void {
    const value = Math.round(period.revenue).toString();
    navigator.clipboard?.writeText(value).then(
      () => this.notify.success(`${value} € copié : collez-le sur autoentrepreneur.urssaf.fr`),
      () => this.notify.error(null, 'Copie impossible.'));
  }

  onSettingsSaved(): void {
    this.load();
    this.selectedTab.set(0);
  }

  periodTotals(): { salesCount: number; revenue: number; total: number } {
    const periods = this.summary()?.periods ?? [];
    return {
      salesCount: periods.reduce((sum, p) => sum + p.salesCount, 0),
      revenue: periods.reduce((sum, p) => sum + p.revenue, 0),
      total: periods.reduce((sum, p) => sum + p.total, 0)
    };
  }
}
