import { Injectable, inject, signal } from '@angular/core';
import { buybackPrice, buybackRule, conditionFactor, DEFAULT_BUYBACK } from '../catalog';
import { BuybackSettings, ItemCondition } from '../models';
import { ToolsService } from './api.services';

/** Réglages du rachat (Paramètres), partagés par les pages Cotes, Estimation et Achats. */
@Injectable({ providedIn: 'root' })
export class BuybackService {
  private readonly api = inject(ToolsService);
  readonly settings = signal<BuybackSettings>(DEFAULT_BUYBACK);

  constructor() {
    this.reload();
  }

  reload(): void {
    this.api.preferences().subscribe({
      next: prefs => this.settings.set({ ...DEFAULT_BUYBACK, ...(prefs.buyback ?? {}) }),
      error: () => { /* on garde les réglages par défaut */ }
    });
  }

  /** Valeur d'une carte : cote × part retenue selon l'état. */
  value(quote: number | null, condition: ItemCondition): number | null {
    return quote === null ? null : Math.round(quote * conditionFactor(condition, this.settings()) * 100) / 100;
  }

  /** Prix de rachat proposé à partir d'une valeur. */
  price(value: number | null | undefined): number | null {
    return buybackPrice(value, this.settings());
  }

  /** Ex. « −20 %, arrondi au 0,50 € inférieur ». */
  rule(): string {
    return buybackRule(this.settings());
  }
}
