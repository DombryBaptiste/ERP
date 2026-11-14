import { CurrencyPipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import {
  CardmarketAnalysis, CardmarketImportRequest, CardmarketImportResult, CardmarketLine, CardmarketOrigin
} from '../../core/models';
import { CardmarketImportService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { KpiCardComponent } from '../../shared/kpi-card.component';
import { LabelPipe } from '../../shared/label.pipe';
import { CardmarketExport, parseCardmarketCsv } from './cardmarket-csv';

/** Prix à partir duquel une carte est « à vérifier » (on veut savoir d'où elle vient). */
const CHECK_PRICE = 1;

/**
 * Import du stock Cardmarket : on charge l'export CSV de l'extension, l'appli compare avec le stock
 * et propose d'ajouter les cartes manquantes (sorties du bulk au coût du lot, ou de la collection à 0 €).
 * Rien n'est enregistré avant « Appliquer ».
 */
@Component({
  selector: 'app-cardmarket-import',
  imports: [
    FormsModule, RouterLink, CurrencyPipe, DecimalPipe, NgTemplateOutlet, LabelPipe,
    MatCardModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatProgressBarModule,
    MatSelectModule, MatTooltipModule, KpiCardComponent
  ],
  templateUrl: './cardmarket-import.component.html',
  styleUrl: './cardmarket-import.component.scss'
})
export class CardmarketImportComponent {
  private readonly api = inject(CardmarketImportService);
  private readonly notify = inject(NotifyService);

  readonly checkPrice = CHECK_PRICE;
  readonly fileName = signal<string | null>(null);
  readonly file = signal<CardmarketExport | null>(null);
  /** Vrai : le fichier contient tout le stock Cardmarket ; faux : seulement certaines séries. */
  readonly fullStock = signal(true);
  readonly analysis = signal<CardmarketAnalysis | null>(null);
  readonly choices = signal<Record<string, CardmarketOrigin>>({});
  readonly bulkCategory = signal<string | null>(null);
  readonly loading = signal(false);
  readonly applying = signal(false);
  readonly result = signal<CardmarketImportResult | null>(null);
  readonly showCheap = signal(false);
  readonly showUpToDate = signal(false);

  /** Cartes en vente sur Cardmarket et absentes de l'appli (ou en plus grand nombre). */
  readonly toAdd = computed(() => (this.analysis()?.lines ?? []).filter(l => l.cardmarketQuantity > l.appQuantity));
  readonly toCheck = computed(() => this.toAdd().filter(l => l.price >= CHECK_PRICE).sort((a, b) => b.price - a.price));
  readonly cheap = computed(() => this.toAdd().filter(l => l.price < CHECK_PRICE));
  readonly upToDate = computed(() => (this.analysis()?.lines ?? []).filter(l => l.cardmarketQuantity <= l.appQuantity));

  readonly totals = computed(() => {
    const choices = this.choices();
    const sum = (origin: CardmarketOrigin) => this.toAdd()
      .filter(l => (choices[l.key] ?? 'ignore') === origin)
      .reduce((s, l) => s + this.missing(l), 0);
    const lines = this.analysis()?.lines ?? [];
    return {
      listedCards: lines.reduce((s, l) => s + l.cardmarketQuantity, 0),
      listedValue: lines.reduce((s, l) => s + l.cardmarketQuantity * l.price, 0),
      bulk: sum('bulk'),
      collection: sum('collection'),
      ignored: sum('ignore'),
      cheapCards: this.cheap().reduce((s, l) => s + this.missing(l), 0)
    };
  });

  readonly selectedPool = computed(() => this.analysis()?.bulkPools.find(p => p.name === this.bulkCategory()) ?? null);
  readonly bulkShortage = computed(() => {
    const needed = this.totals().bulk;
    if (needed === 0) return 0;
    return Math.max(0, needed - (this.selectedPool()?.cards ?? 0));
  });

  // ----- Fichier -----

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    file.text().then(text => {
      try {
        const parsed = parseCardmarketCsv(text);
        this.fileName.set(file.name);
        this.file.set(parsed);
        this.result.set(null);
        this.analyze();
      } catch (e) {
        this.notify.error(null, e instanceof Error ? e.message : 'Fichier illisible.');
      }
    }, () => this.notify.error(null, 'Impossible de lire ce fichier.'));
  }

  setFullStock(full: boolean): void {
    this.fullStock.set(full);
    if (this.file()) this.analyze();
  }

  analyze(): void {
    const file = this.file();
    if (!file) return;
    this.loading.set(true);
    this.api.analyze({ rows: file.rows, fullStock: this.fullStock() }).subscribe({
      next: analysis => {
        this.analysis.set(analysis);
        // Par défaut, tout vient du bulk (cartes sorties du vrac pour être vendues à l'unité).
        this.choices.set(Object.fromEntries(analysis.lines
          .filter(l => l.cardmarketQuantity > l.appQuantity)
          .map(l => [l.key, 'bulk' as CardmarketOrigin])));
        if (!analysis.bulkPools.some(p => p.name === this.bulkCategory()))
          this.bulkCategory.set(analysis.bulkPools[0]?.name ?? null);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  // ----- Choix -----

  missing(line: CardmarketLine): number {
    return line.cardmarketQuantity - line.appQuantity;
  }

  origin(line: CardmarketLine): CardmarketOrigin {
    return this.choices()[line.key] ?? 'ignore';
  }

  setOrigin(line: CardmarketLine, origin: CardmarketOrigin): void {
    this.choices.update(c => ({ ...c, [line.key]: origin }));
  }

  setAll(lines: CardmarketLine[], origin: CardmarketOrigin): void {
    this.choices.update(c => ({ ...c, ...Object.fromEntries(lines.map(l => [l.key, origin])) }));
  }

  image(line: CardmarketLine): string | null {
    return this.file()?.images.get(line.idProduct) ?? null;
  }

  code(line: CardmarketLine): string {
    return [line.setCode, line.number].filter(Boolean).join(' ');
  }

  // ----- Application -----

  apply(): void {
    const file = this.file();
    const t = this.totals();
    if (!file || !this.analysis()) return;
    if (this.bulkShortage() > 0) {
      this.notify.error(null, `Il manque ${this.bulkShortage()} carte(s) dans la catégorie de bulk choisie.`);
      return;
    }
    const parts = [
      t.bulk ? `${t.bulk} carte(s) sorties du bulk « ${this.bulkCategory()} »` : '',
      t.collection ? `${t.collection} carte(s) depuis ma collection (0 €)` : '',
      `les cartes déjà en stock marquées « en vente sur Cardmarket » au prix de l'export`,
      this.analysis()?.extras.length ? `${this.analysis()!.extras.length} carte(s) de l'appli marquées « plus en vente »` : ''
    ].filter(Boolean);
    this.notify.confirm({
      title: 'Appliquer l\'import Cardmarket ?',
      message: parts.join(' · ') + '. Aucune vente n\'est créée et aucune quantité n\'est retirée.',
      confirmLabel: 'Appliquer'
    }).subscribe(ok => {
      if (!ok) return;
      const request: CardmarketImportRequest = {
        rows: file.rows,
        fullStock: this.fullStock(),
        bulkCategory: this.bulkCategory(),
        choices: Object.entries(this.choices()).map(([key, origin]) => ({ key, origin }))
      };
      this.applying.set(true);
      this.api.apply(request).subscribe({
        next: result => {
          this.result.set(result);
          this.applying.set(false);
          this.notify.success(`Import appliqué : ${result.cardsAdded} carte(s) ajoutée(s).`);
          this.analyze();
        },
        error: err => {
          this.notify.error(err);
          this.applying.set(false);
        }
      });
    });
  }
}
