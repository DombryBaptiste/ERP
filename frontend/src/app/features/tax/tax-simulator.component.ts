import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TaxSettings } from '../../core/models';
import { effectiveRates } from './tax-rules';

interface Segment {
  label: string;
  value: number;
  color: string;
}

/**
 * Simulateurs : « combien me reste-t-il sur une vente ? » et « à quel prix vendre ? ».
 * Les calculs utilisent les paramètres fiscaux enregistrés.
 */
@Component({
  selector: 'app-tax-simulator',
  imports: [FormsModule, CurrencyPipe, DecimalPipe, MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule, MatSlideToggleModule],
  templateUrl: './tax-simulator.component.html',
  styleUrl: './tax-simulator.component.scss'
})
export class TaxSimulatorComponent {
  readonly settings = input.required<TaxSettings>();

  // ----- Simulation d'une vente -----
  readonly salePrice = signal(100);
  readonly purchaseCost = signal(60);
  readonly saleFees = signal(5);
  readonly withAcre = signal(false);

  readonly rates = computed(() => effectiveRates(this.settings(), this.withAcre()));

  readonly result = computed(() => {
    const price = this.salePrice() || 0;
    const cost = this.purchaseCost() || 0;
    const fees = this.saleFees() || 0;
    const r = this.rates();
    const social = (price * r.social) / 100;
    const other = (price * (r.training + r.chamber)) / 100;
    const incomeTax = (price * r.incomeTax) / 100;
    const grossProfit = price - cost - fees;
    const net = grossProfit - social - other - incomeTax;
    return {
      social, other, incomeTax, grossProfit, net,
      charges: social + other + incomeTax,
      chargesOnProfit: grossProfit > 0 ? ((social + other + incomeTax) / grossProfit) * 100 : 0,
      netMargin: price > 0 ? (net / price) * 100 : 0
    };
  });

  /** Décomposition visuelle du prix de vente. */
  readonly segments = computed<Segment[]>(() => {
    const r = this.result();
    return [
      { label: "Prix d'achat", value: this.purchaseCost() || 0, color: '#90a4ae' },
      { label: 'Frais de vente', value: this.saleFees() || 0, color: '#b0bec5' },
      { label: 'Cotisations URSSAF', value: r.social + r.other, color: '#3949ab' },
      { label: 'Impôt', value: r.incomeTax, color: '#ef6c00' },
      { label: 'Reste pour vous', value: Math.max(0, r.net), color: '#2e7d32' }
    ].filter(s => s.value > 0);
  });

  segmentWidth(value: number): number {
    const total = this.segments().reduce((sum, s) => sum + s.value, 0);
    return total > 0 ? (value / total) * 100 : 0;
  }

  // ----- Calcul du prix de vente -----
  readonly targetCost = signal(20);
  readonly targetFees = signal(2);
  readonly commissionRate = signal(5);
  readonly targetNet = signal(10);

  /**
   * Le CA à déclarer est le prix payé par l'acheteur : cotisations et commission s'appliquent au prix.
   * Net = P − coût − frais − P × (commission + prélèvements)  ⇒  P = (coût + frais + net) / (1 − taux).
   */
  readonly pricing = computed(() => {
    const rate = (this.rates().total + (this.commissionRate() || 0)) / 100;
    if (rate >= 1) return null;
    const base = (this.targetCost() || 0) + (this.targetFees() || 0);
    return {
      rate: rate * 100,
      breakEven: base / (1 - rate),
      recommended: (base + (this.targetNet() || 0)) / (1 - rate)
    };
  });
}
