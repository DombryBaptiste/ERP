import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Carte d'indicateur (KPI) : icône, libellé, valeur, sous-titre. */
@Component({
  selector: 'app-kpi-card',
  imports: [MatIconModule],
  template: `
    <div class="kpi-card">
      <div class="kpi-icon" [style.background-color]="color() + '1f'" [style.color]="color()">
        <mat-icon>{{ icon() }}</mat-icon>
      </div>
      <div class="kpi-body">
        <div class="kpi-label">{{ label() }}</div>
        <div class="kpi-value" [class.negative]="negative()">{{ value() }}</div>
        @if (sub()) {
          <div class="kpi-sub">{{ sub() }}</div>
        }
      </div>
    </div>
  `,
  styles: `
    .kpi-card {
      display: flex; align-items: center; gap: 16px; height: 100%;
      padding: 18px 20px; border-radius: 14px; background: var(--app-surface);
      box-shadow: var(--app-shadow);
    }
    .kpi-icon {
      flex: none; width: 48px; height: 48px; border-radius: 12px;
      display: grid; place-items: center;
    }
    .kpi-body { min-width: 0; }
    .kpi-label { font-size: 13px; color: var(--app-muted); }
    .kpi-value { font-size: 24px; font-weight: 600; line-height: 1.3; white-space: nowrap; }
    .kpi-value.negative { color: var(--app-danger); }
    .kpi-sub { font-size: 12px; color: var(--app-muted); }
  `
})
export class KpiCardComponent {
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input<string | number | null>('');
  readonly sub = input<string | null>(null);
  readonly color = input('#3949ab');
  readonly negative = input(false);
}
