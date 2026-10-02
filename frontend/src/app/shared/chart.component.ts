import { AfterViewInit, Component, effect, ElementRef, input, OnDestroy, signal, viewChild } from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);
Chart.defaults.font.family = 'Roboto, "Helvetica Neue", sans-serif';
Chart.defaults.color = '#5f6b7a';

/** Enveloppe légère autour de Chart.js : le graphique est recréé à chaque changement de configuration. */
@Component({
  selector: 'app-chart',
  template: `<div class="chart-box" [style.height.px]="height()"><canvas #canvas></canvas></div>`,
  styles: `.chart-box { position: relative; width: 100%; }`
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly config = input.required<ChartConfiguration<any>>();
  readonly height = input(280);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly viewReady = signal(false);
  private chart?: Chart;

  constructor() {
    effect(() => {
      if (!this.viewReady()) return;
      const cfg = this.config();
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, {
        ...cfg,
        options: { responsive: true, maintainAspectRatio: false, ...cfg.options }
      });
    });
  }

  ngAfterViewInit(): void {
    this.viewReady.set(true);
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
