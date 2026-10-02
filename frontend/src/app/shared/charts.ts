import { ChartConfiguration } from 'chart.js';
import { euro } from '../core/utils';

/** Palette commune à tous les graphiques. */
export const COLORS = {
  revenue: '#3949ab',
  profit: '#2e7d32',
  loss: '#c62828',
  cards: '#ef6c00',
  sealed: '#00897b',
  accent: '#8e24aa'
};

/** Courbe d'évolution en euros. */
export function lineChart(labels: string[], label: string, data: number[], color: string): ChartConfiguration<'line'> {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label, data, borderColor: color, backgroundColor: color + '26',
        fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2
      }]
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${label} : ${euro(ctx.parsed.y ?? 0, 2)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: value => euro(value) } }
      }
    }
  };
}

/** Histogramme en euros (vertical, ou horizontal pour les classements). */
export function barChart(
  labels: string[], label: string, data: number[], color: string | string[], horizontal = false
): ChartConfiguration<'bar'> {
  const valueAxis = { beginAtZero: true, ticks: { callback: (value: string | number) => euro(value) } };
  const categoryAxis = { grid: { display: false } };
  return {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: color, borderRadius: 6, maxBarThickness: 34 }] },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${label} : ${euro((horizontal ? ctx.parsed.x : ctx.parsed.y) ?? 0, 2)}` } }
      },
      scales: horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis }
    }
  };
}

/** Anneau de répartition (quantités par défaut, ou valeurs mises en forme par `format`). */
export function doughnutChart(
  labels: string[], data: number[], colors: string[], format: (value: number) => string = v => `${v} article(s)`
): ChartConfiguration<'doughnut'> {
  return {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: {
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label} : ${format(ctx.parsed)}` } }
      }
    }
  };
}
