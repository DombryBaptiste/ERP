import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { CardmarketCount, CardmarketCountResult, CardmarketGroup } from '../../core/models';
import { CardmarketCountService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { CardmarketExport, parseCardmarketCsv } from './cardmarket-csv';

/** Associations groupe -> catégorie de bulk, retenues dans le navigateur pour la prochaine fois. */
const STORAGE_KEY = 'pokestock.cardmarket.bulk-mappings';

/** Ligne affichée : un groupe du comptage, sa catégorie et l'écart. */
interface GroupRow extends CardmarketGroup {
  categoryCards: number | null;
  collectionCards: number | null;
  difference: number | null;
  /** Retrait impossible au-delà des cartes de collection de la catégorie. */
  notRemovable: number;
}

/**
 * Comptage du bulk avec l'export Cardmarket : les cartes en vente sont comptées par groupe
 * (communes / peu communes / rares, holo, reverses, V / EX / GX) et comparées aux catégories de bulk.
 * Les écarts sont corrigés dans la collection personnelle (ajout à 0 €, ou retrait des lots de collection).
 */
@Component({
  selector: 'app-cardmarket-count',
  imports: [
    RouterLink, CurrencyPipe, DecimalPipe,
    MatCardModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatProgressBarModule, MatSelectModule
  ],
  templateUrl: './cardmarket-count.component.html',
  styleUrl: './cardmarket-count.component.scss'
})
export class CardmarketCountComponent {
  private readonly api = inject(CardmarketCountService);
  private readonly notify = inject(NotifyService);

  readonly fileName = signal<string | null>(null);
  readonly file = signal<CardmarketExport | null>(null);
  readonly count = signal<CardmarketCount | null>(null);
  readonly mappings = signal<Record<string, string | null>>(this.loadMappings());
  readonly loading = signal(false);
  readonly applying = signal(false);
  readonly result = signal<CardmarketCountResult | null>(null);
  readonly showApart = signal(false);

  readonly rows = computed<GroupRow[]>(() => {
    const count = this.count();
    if (!count) return [];
    return count.groups.map(g => {
      const category = count.categories.find(c => c.name === this.mappings()[g.group]) ?? null;
      const difference = category ? g.cards - category.cards : null;
      return {
        ...g,
        category: category?.name ?? null,
        categoryCards: category?.cards ?? null,
        collectionCards: category?.collectionCards ?? null,
        difference,
        notRemovable: category && difference !== null && difference < 0 ? Math.max(0, -difference - category.collectionCards) : 0
      };
    });
  });

  readonly totals = computed(() => {
    const rows = this.rows();
    return {
      cards: rows.reduce((s, r) => s + r.cards, 0),
      value: rows.reduce((s, r) => s + r.value, 0),
      toAdd: rows.reduce((s, r) => s + Math.max(0, r.difference ?? 0), 0),
      toRemove: rows.reduce((s, r) => s + Math.max(0, -(r.difference ?? 0)) - r.notRemovable, 0),
      apart: (this.count()?.apart ?? []).reduce((s, a) => s + a.amount, 0)
    };
  });

  /** Une même catégorie associée à deux groupes : interdit. */
  readonly duplicateCategory = computed(() => {
    const used = Object.values(this.mappings()).filter((c): c is string => !!c);
    return used.find((c, i) => used.indexOf(c) !== i) ?? null;
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

  analyze(): void {
    const file = this.file();
    if (!file) return;
    this.loading.set(true);
    this.api.analyze({ rows: file.rows }).subscribe({
      next: count => {
        this.count.set(count);
        this.guessMappings(count);
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  setCategory(group: string, category: string | null): void {
    this.mappings.update(m => ({ ...m, [group]: category }));
    this.saveMappings();
  }

  // ----- Application -----

  apply(): void {
    const file = this.file();
    if (!file || this.duplicateCategory()) return;
    const changes = this.rows().filter(r => r.difference);
    if (changes.length === 0) return;
    const lines = changes.map(r => r.difference! > 0
      ? `${r.category} : +${r.difference} carte(s) depuis ma collection`
      : `${r.category} : −${-r.difference! - r.notRemovable} carte(s) retirée(s) de ma collection`);
    this.notify.confirm({
      title: 'Corriger le bulk ?',
      message: lines.join(' · ') + '. Les lots achetés ne sont pas modifiés.',
      confirmLabel: 'Corriger'
    }).subscribe(ok => {
      if (!ok) return;
      this.applying.set(true);
      this.api.apply({
        rows: file.rows,
        mappings: Object.entries(this.mappings()).map(([group, category]) => ({ group, category }))
      }).subscribe({
        next: result => {
          this.result.set(result);
          this.applying.set(false);
          this.notify.success('Bulk corrigé d\'après le comptage Cardmarket.');
          this.analyze();
        },
        error: err => {
          this.notify.error(err);
          this.applying.set(false);
        }
      });
    });
  }

  // ----- Associations -----

  /** Première fois : devine la catégorie de chaque groupe d'après son nom. */
  private guessMappings(count: CardmarketCount): void {
    const names = count.categories.map(c => c.name);
    const current = this.mappings();
    const guesses: Record<string, RegExp> = {
      'Communes / Peu communes / Rares': /commun/i,
      'Holo': /holo/i,
      'Reverses': /reverse/i,
      'V / EX / GX': /\b(v|ex|gx)\b/i
    };
    const next = { ...current };
    for (const group of count.groups.map(g => g.group)) {
      if (next[group] && names.includes(next[group]!)) continue;
      next[group] = names.find(n => guesses[group]?.test(n) && !Object.values(next).includes(n)) ?? null;
    }
    this.mappings.set(next);
    this.saveMappings();
  }

  private loadMappings(): Record<string, string | null> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
    } catch {
      return {};
    }
  }

  private saveMappings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mappings()));
    } catch {
      // Stockage indisponible : les associations seront à refaire la prochaine fois.
    }
  }
}
