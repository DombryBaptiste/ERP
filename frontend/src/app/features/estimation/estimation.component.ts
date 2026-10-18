import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import {
  buybackPrice, CARD_LANGUAGES, cardCode, cardThumbnail, CONDITION_FACTORS, languageLabel, languageShort, parseSetKey, setKey
} from '../../core/catalog';
import { CONDITIONS } from '../../core/labels';
import { CardLanguage, CatalogCard, CatalogSet, ItemCondition, PurchaseLineInput } from '../../core/models';
import { CatalogService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';

/** Une carte de la collection à estimer. */
export interface EstimationLine {
  card: CatalogCard;
  condition: ItemCondition;
  quantity: number;
  /** Cote retenue (reprise du catalogue, modifiable). */
  quote: number | null;
}

/** Clé de sauvegarde locale : la sélection survit à un rechargement de la page. */
const STORAGE_KEY = 'pokestock.estimation';

/**
 * Estimation d'une collection : on cherche les cartes dans le catalogue, on les ajoute en un clic,
 * et on obtient la valeur et le prix d'achat proposé (−20 %, arrondi au 0,50 € inférieur).
 * La sélection peut ensuite devenir un achat.
 */
@Component({
  selector: 'app-estimation',
  imports: [
    FormsModule, CurrencyPipe, RouterLink,
    MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatSelectModule, MatTooltipModule
  ],
  templateUrl: './estimation.component.html',
  styleUrl: './estimation.component.scss'
})
export class EstimationComponent {
  private readonly api = inject(CatalogService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly code = cardCode;
  readonly thumbnail = cardThumbnail;
  readonly conditions = CONDITIONS;
  readonly key = setKey;
  readonly short = languageShort;
  readonly languages = CARD_LANGUAGES;

  readonly sets = signal<CatalogSet[]>([]);
  /** Série choisie (clé langue|id). */
  readonly setId = signal('');
  readonly language = signal<CardLanguage | ''>('');
  readonly visibleSets = computed(() => this.sets().filter(s => !this.language() || s.language === this.language()));
  readonly search = signal('');
  readonly results = signal<CatalogCard[]>([]);
  readonly searching = signal(false);
  readonly lines = signal<EstimationLine[]>(this.restore());
  private readonly search$ = new Subject<void>();

  readonly totals = computed(() => this.lines().reduce((t, l) => ({
    cards: t.cards + l.quantity,
    value: t.value + (this.value(l) ?? 0) * l.quantity,
    buyback: t.buyback + (this.unitBuyback(l) ?? 0) * l.quantity,
    missing: t.missing + (l.quote === null ? 1 : 0)
  }), { cards: 0, value: 0, buyback: 0, missing: 0 }));

  /** Quantité déjà sélectionnée par carte (badge sur les résultats). */
  readonly selectedCount = computed(() => {
    const counts = new Map<number, number>();
    for (const l of this.lines()) counts.set(l.card.id, (counts.get(l.card.id) ?? 0) + l.quantity);
    return counts;
  });

  constructor() {
    this.api.sets().subscribe({
      next: sets => this.sets.set(sets),
      error: err => this.notify.error(err)
    });
    this.search$.pipe(debounceTime(300)).subscribe(() => this.loadResults());
    effect(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.lines())); } catch { /* stockage indisponible */ }
    });
  }

  // ---------------------------------------------------------------- Recherche

  onSearch(value: string): void {
    this.search.set(value);
    this.search$.next();
  }

  onLanguageChange(language: CardLanguage | ''): void {
    this.language.set(language);
    if (language && parseSetKey(this.setId()).language !== language) this.setId.set('');
    this.loadResults();
  }

  onSetChange(setId: string): void {
    this.setId.set(setId);
    this.loadResults();
  }

  private loadResults(): void {
    const search = this.search().trim();
    if (!this.setId() && search.length < 2) { this.results.set([]); return; }
    this.searching.set(true);
    const { language, setId } = parseSetKey(this.setId());
    this.api.cards({ language: language ?? (this.language() || undefined), setId, search: search || undefined, take: 200 }).subscribe({
      next: cards => { this.results.set(cards); this.searching.set(false); },
      error: err => { this.searching.set(false); this.notify.error(err); }
    });
  }

  /** Entrée dans la recherche : ajoute directement la carte si elle est seule (ex. « PFL 95 »). */
  addSingleResult(): void {
    const results = this.results();
    if (results.length === 1) this.add(results[0]);
  }

  // ---------------------------------------------------------------- Sélection

  add(card: CatalogCard): void {
    this.lines.update(lines => {
      const existing = lines.find(l => l.card.id === card.id && l.condition === 'NM');
      if (existing) return lines.map(l => l === existing ? { ...l, quantity: l.quantity + 1 } : l);
      return [{ card, condition: 'NM', quantity: 1, quote: card.quote }, ...lines];
    });
  }

  update(line: EstimationLine, changes: Partial<EstimationLine>): void {
    this.lines.update(lines => lines.map(l => l === line ? { ...l, ...changes } : l));
  }

  setQuantity(line: EstimationLine, value: number): void {
    this.update(line, { quantity: Math.max(1, Math.floor(Number(value) || 1)) });
  }

  setQuote(line: EstimationLine, value: string | number | null): void {
    const text = String(value ?? '').replace(',', '.').trim();
    const quote = text === '' ? null : Number(text);
    this.update(line, { quote: quote === null || isNaN(quote) || quote < 0 ? null : quote });
  }

  remove(line: EstimationLine): void {
    this.lines.update(lines => lines.filter(l => l !== line));
  }

  reset(): void {
    this.notify.confirm({
      title: 'Vider l\'estimation ?',
      message: `Les ${this.lines().length} ligne(s) sélectionnée(s) seront retirées.`
    }).subscribe(confirmed => { if (confirmed) this.lines.set([]); });
  }

  /** Valeur unitaire : cote × part retenue selon l'état. */
  value(line: EstimationLine): number | null {
    return line.quote === null ? null : Math.round(line.quote * CONDITION_FACTORS[line.condition] * 100) / 100;
  }

  unitBuyback(line: EstimationLine): number | null {
    return buybackPrice(this.value(line));
  }

  /** Ouvre un nouvel achat pré-rempli avec les cartes sélectionnées, au prix d'achat proposé. */
  createPurchase(): void {
    const items: PurchaseLineInput[] = this.lines().map(l => ({
      itemId: null,
      name: `${l.card.name} — ${cardCode(l.card)}`,
      category: `${l.card.setCode ?? l.card.setId} ${l.card.setName}`,
      language: languageLabel(l.card.language),
      type: 'RawCard',
      condition: l.condition,
      quantity: l.quantity,
      unitPrice: this.unitBuyback(l) ?? 0,
      location: null,
      catalogCardId: l.card.id
    }));
    this.router.navigate(['/purchases/new'], { state: { estimationLines: items } });
  }

  private restore(): EstimationLine[] {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      // Sélections enregistrées avant l'ajout des langues : cartes françaises.
      return Array.isArray(saved)
        ? saved.map((l: EstimationLine) => ({ ...l, card: { ...l.card, language: l.card.language ?? 'fr' } }))
        : [];
    } catch {
      return [];
    }
  }
}
