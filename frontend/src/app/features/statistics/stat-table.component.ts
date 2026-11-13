import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { StatRow } from '../../core/models';

/** Tableau d'une répartition (plateforme, type, série…) avec la part du CA de chaque ligne. */
@Component({
  selector: 'app-stat-table',
  imports: [CurrencyPipe, DecimalPipe],
  template: `
    @if (rows().length === 0) {
      <p class="empty">Aucune vente sur cette année.</p>
    } @else {
      <div class="table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th>{{ labelTitle() }}</th>
              @if (showSales()) { <th class="num">Ventes</th> }
              @if (showQuantity()) { <th class="num">Articles</th> }
              <th class="num">CA</th>
              <th class="num">Part</th>
              <th class="num">Bénéfice</th>
              <th class="num">Marge</th>
              @if (showFees()) { <th class="num">Frais</th> }
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.label) {
              <tr [class.muted]="r.sales === 0">
                <td class="strong">{{ r.label }}</td>
                @if (showSales()) { <td class="num">{{ r.sales | number }}</td> }
                @if (showQuantity()) { <td class="num">{{ r.quantity | number }}</td> }
                <td class="num">{{ r.revenue | currency }}</td>
                <td class="num share">
                  <span class="bar" [style.width.%]="share(r)"></span>
                  <span class="value">{{ share(r) | number: '1.0-0' }} %</span>
                </td>
                <td class="num" [class.negative]="r.profit < 0" [class.positive]="r.profit > 0">{{ r.profit | currency }}</td>
                <td class="num">{{ r.revenue > 0 ? (r.margin | number: '1.0-1') + ' %' : '—' }}</td>
                @if (showFees()) { <td class="num">{{ r.fees | currency }}</td> }
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .share { position: relative; min-width: 70px; }
    .share .bar {
      position: absolute; left: 0; top: 25%; height: 50%; border-radius: 4px;
      background: rgba(57, 73, 171, .14);
    }
    .share .value { position: relative; }
  `
})
export class StatTableComponent {
  readonly rows = input.required<StatRow[]>();
  readonly labelTitle = input('');
  readonly showSales = input(true);
  readonly showQuantity = input(true);
  readonly showFees = input(false);

  private readonly totalRevenue = computed(() => this.rows().reduce((s, r) => s + Math.max(0, r.revenue), 0));

  share(row: StatRow): number {
    const total = this.totalRevenue();
    return total > 0 ? Math.max(0, row.revenue) / total * 100 : 0;
  }
}
