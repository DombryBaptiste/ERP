import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { cardmarketSearchUrl } from '../../core/labels';
import { Alerts, InventoryItem } from '../../core/models';
import { AttachmentService, ToolsService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';
import { marketDataForLot, MarketValueDialogComponent } from '../../shared/market-value-dialog.component';

/** Alertes : cartes qui prennent de la valeur et stock qui dort. */
@Component({
  selector: 'app-alerts',
  imports: [
    RouterLink, CurrencyPipe, DecimalPipe, LabelPipe,
    MatCardModule, MatTabsModule, MatIconModule, MatButtonModule, MatTooltipModule, MatProgressBarModule, KpiCardComponent
  ],
  templateUrl: './alerts.component.html',
  styleUrl: './alerts.component.scss'
})
export class AlertsComponent {
  private readonly api = inject(ToolsService);
  private readonly attachments = inject(AttachmentService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly alerts = signal<Alerts | null>(null);

  readonly criticalCount = computed(() => this.alerts()?.dormant.filter(d => d.level === 'critical').length ?? 0);
  readonly dormantValue = computed(() =>
    (this.alerts()?.dormant ?? []).reduce((sum, d) => sum + d.item.stockValue, 0));

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.alerts().subscribe({
      next: a => {
        this.alerts.set(a);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  photoUrl(id: number): string {
    return this.attachments.fileUrl(id);
  }

  searchUrl(item: InventoryItem): string {
    return cardmarketSearchUrl(item.name);
  }

  editMarketValue(item: InventoryItem): void {
    this.dialog.open(MarketValueDialogComponent, { data: marketDataForLot(item), width: '440px' }).afterClosed()
      .subscribe((updated?: InventoryItem[]) => {
        if (updated) this.load();
      });
  }

  sell(item: InventoryItem): void {
    this.router.navigate(['/sales/new'], { queryParams: { item: item.id } });
  }
}
