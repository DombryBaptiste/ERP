import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, debounceTime } from 'rxjs';
import { CARD_LANGUAGES, cardCode, cardThumbnail, languageShort, parseSetKey, setKey } from '../../core/catalog';
import { CardLanguage, CatalogCard, CatalogSet } from '../../core/models';
import { CatalogService } from '../../core/services/api.services';
import { BuybackService } from '../../core/services/buyback.service';
import { NotifyService } from '../../core/services/notify.service';
import { ImportSetsDialogComponent } from './import-sets-dialog.component';

interface SerieGroup {
  name: string;
  sets: CatalogSet[];
}

/**
 * Page Cotes : saisie à la main de la cote (prix FR NM) de chaque carte du catalogue.
 * Entrée enregistre la cote et passe à la carte suivante ; la cote est reportée sur les articles en stock liés.
 */
@Component({
  selector: 'app-quotes',
  imports: [
    FormsModule, CurrencyPipe, DatePipe,
    MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressBarModule, MatSelectModule, MatTooltipModule
  ],
  templateUrl: './quotes.component.html',
  styleUrl: './quotes.component.scss'
})
export class QuotesComponent {
  private readonly api = inject(CatalogService);
  private readonly notify = inject(NotifyService);
  private readonly dialog = inject(MatDialog);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly code = cardCode;
  readonly thumbnail = cardThumbnail;
  private readonly buybackService = inject(BuybackService);
  /** Prix de rachat d'une carte NM à sa cote. */
  readonly buyback = (quote: number | null) => this.buybackService.price(quote);
  readonly key = setKey;
  readonly short = languageShort;
  readonly languages = CARD_LANGUAGES;

  readonly sets = signal<CatalogSet[]>([]);
  readonly cards = signal<CatalogCard[]>([]);
  readonly loading = signal(true);
  /** Série choisie (clé langue|id), ou '' pour chercher dans tout le catalogue. */
  readonly setId = signal('');
  /** Langue filtrée quand aucune série n'est choisie ('' = toutes). */
  readonly language = signal<CardLanguage | ''>('');
  readonly search = signal('');
  readonly onlyMissing = signal(false);
  /** Saisie en cours, par carte (texte du champ). */
  readonly drafts = signal(new Map<number, string>());
  readonly saving = signal(new Set<number>());
  private readonly search$ = new Subject<void>();

  readonly groups = computed<SerieGroup[]>(() => {
    const groups: SerieGroup[] = [];
    for (const s of this.sets()) {
      if (this.language() && s.language !== this.language()) continue;
      const name = `${s.serieName ?? 'Autres'}${s.language === 'fr' ? '' : ' — ' + languageShort(s.language)}`;
      let g = groups.find(x => x.name === name);
      if (!g) groups.push(g = { name, sets: [] });
      g.sets.push(s);
    }
    return groups;
  });

  readonly visibleCards = computed(() =>
    this.onlyMissing() ? this.cards().filter(c => c.quote === null) : this.cards());

  readonly currentSet = computed(() => this.sets().find(s => setKey(s) === this.setId()) ?? null);

  constructor() {
    this.search$.pipe(debounceTime(300)).subscribe(() => this.loadCards());
    this.loadSets(true);
  }

  private loadSets(selectFirst: boolean): void {
    this.api.sets().subscribe({
      next: sets => {
        this.sets.set(sets);
        if (selectFirst && !this.setId() && sets.length) this.setId.set(setKey(sets[0]));
        if (sets.length) this.loadCards(); else this.loading.set(false);
      },
      error: err => { this.loading.set(false); this.notify.error(err); }
    });
  }

  loadCards(): void {
    const search = this.search().trim();
    // Sans série choisie, il faut une recherche (le catalogue peut compter des milliers de cartes).
    if (!this.setId() && search.length < 2) { this.cards.set([]); this.loading.set(false); return; }
    this.loading.set(true);
    const { language, setId } = parseSetKey(this.setId());
    this.api.cards({ language: language ?? (this.language() || undefined), setId, search: search || undefined, take: 500 }).subscribe({
      next: cards => { this.cards.set(cards); this.drafts.set(new Map()); this.loading.set(false); },
      error: err => { this.loading.set(false); this.notify.error(err); }
    });
  }

  onSetChange(setId: string): void {
    this.setId.set(setId);
    this.loadCards();
  }

  onLanguageChange(language: CardLanguage | ''): void {
    this.language.set(language);
    if (this.currentSet() && language && this.currentSet()!.language !== language) this.setId.set('');
    this.loadCards();
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.search$.next();
  }

  openImport(): void {
    this.dialog.open(ImportSetsDialogComponent, { width: '820px', maxHeight: '90vh' }).afterClosed()
      .subscribe(imported => { if (imported) this.loadSets(true); });
  }

  draft(card: CatalogCard): string {
    return this.drafts().get(card.id) ?? (card.quote === null ? '' : String(card.quote));
  }

  setDraft(card: CatalogCard, value: string): void {
    this.drafts.update(m => new Map(m).set(card.id, value));
  }

  /** Enregistre la cote si elle a changé. */
  save(card: CatalogCard): void {
    const text = this.drafts().get(card.id);
    // Entrée enregistre puis déplace le focus : le blur qui suit ne doit pas renvoyer la même cote.
    if (text === undefined || this.saving().has(card.id)) return;
    const trimmed = text.replace(',', '.').trim();
    const quote = trimmed === '' ? null : Number(trimmed);
    if (quote !== null && (isNaN(quote) || quote < 0)) {
      this.notify.error(null, `Cote invalide pour ${card.name} : ${text}`);
      return;
    }
    if (quote === card.quote) { this.clearDraft(card.id); return; }

    this.saving.update(s => new Set(s).add(card.id));
    this.api.setQuote(card.id, quote).subscribe({
      next: updated => {
        this.cards.update(list => list.map(c => c.id === updated.id ? updated : c));
        this.clearDraft(card.id);
        this.saving.update(s => { const n = new Set(s); n.delete(card.id); return n; });
        this.sets.update(list => list.map(s => s.setId !== updated.setId ? s : {
          ...s, quotedCount: s.quotedCount + (card.quote === null && updated.quote !== null ? 1 : card.quote !== null && updated.quote === null ? -1 : 0)
        }));
      },
      error: err => {
        this.saving.update(s => { const n = new Set(s); n.delete(card.id); return n; });
        this.notify.error(err);
      }
    });
  }

  /** Supprime une carte du catalogue, après confirmation. */
  deleteCard(card: CatalogCard): void {
    const stock = card.inStock
      ? ` Les ${card.inStock} exemplaire(s) en stock liés restent dans l'inventaire, en « Hors catégorie ».` : '';
    this.notify.confirm({
      title: 'Supprimer cette carte ?',
      message: `« ${card.name} » (${cardCode(card)}) sera retirée du catalogue, avec sa cote.${stock}`
    }).subscribe(confirmed => {
      if (!confirmed) return;
      this.api.deleteCard(card.id).subscribe({
        next: () => {
          this.cards.update(list => list.filter(c => c.id !== card.id));
          this.sets.update(list => list
            .map(s => s.language === card.language && s.setId === card.setId
              ? { ...s, cardCount: s.cardCount - 1, quotedCount: s.quotedCount - (card.quote !== null ? 1 : 0) } : s)
            .filter(s => s.cardCount > 0));
          this.notify.success(`${card.name} supprimée du catalogue.`);
        },
        error: err => this.notify.error(err)
      });
    });
  }

  /** Supprime toute la série affichée, après confirmation. */
  deleteSet(set: CatalogSet): void {
    this.notify.confirm({
      title: 'Supprimer cette série ?',
      message: `Les ${set.cardCount} carte(s) de « ${set.setName} » (${languageShort(set.language)}) et leurs ${set.quotedCount} cote(s) `
        + `seront retirées du catalogue. Les cartes en stock liées restent dans l'inventaire, en « Hors catégorie ». `
        + `Vous pourrez réimporter la série plus tard.`
    }).subscribe(confirmed => {
      if (!confirmed) return;
      this.api.deleteSet(set.setId, set.language).subscribe({
        next: r => {
          this.notify.success(`${r.deletedCards} carte(s) supprimée(s)`
            + (r.unlinkedItems ? `, ${r.unlinkedItems} article(s) en stock passé(s) en « Hors catégorie ».` : '.'));
          this.setId.set('');
          this.cards.set([]);
          this.loadSets(true);
        },
        error: err => this.notify.error(err)
      });
    });
  }

  /** Entrée : enregistre et passe au champ de la carte suivante. */
  saveAndNext(card: CatalogCard, event: Event): void {
    event.preventDefault();
    this.save(card);
    const inputs = Array.from(this.host.nativeElement.querySelectorAll<HTMLInputElement>('input.quote-input'));
    const index = inputs.indexOf(event.target as HTMLInputElement);
    inputs[index + 1]?.focus();
    inputs[index + 1]?.select();
  }

  private clearDraft(id: number): void {
    this.drafts.update(m => { const n = new Map(m); n.delete(id); return n; });
  }
}
