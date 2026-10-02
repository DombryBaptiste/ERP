import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { TaxSettings } from '../../core/models';
import { ACTIVITY_PRESETS, DAC7, DEFAULT_TAX_SETTINGS, effectiveRates, RATES_YEAR, URSSAF_URL } from './tax-rules';

interface OfficialLink {
  label: string;
  url: string;
  description: string;
}

/**
 * Guide pratique du statut de micro-entrepreneur, appliqué à l'achat-revente de cartes Pokémon.
 * Informations indicatives (septembre 2026) : les montants affichés suivent les paramètres enregistrés.
 */
@Component({
  selector: 'app-tax-guide',
  imports: [CurrencyPipe, DecimalPipe, MatExpansionModule, MatIconModule],
  templateUrl: './tax-guide.component.html',
  styleUrl: './tax-guide.component.scss'
})
export class TaxGuideComponent {
  readonly settings = input<TaxSettings | null>(null);
  readonly setAsideRate = input<number | null>(null);

  readonly ratesYear = RATES_YEAR;
  readonly dac7 = DAC7;
  readonly presets = ACTIVITY_PRESETS;
  readonly urssafUrl = URSSAF_URL;

  readonly s = computed(() => this.settings() ?? DEFAULT_TAX_SETTINGS);
  readonly rates = computed(() => effectiveRates(this.s()));

  /** Exemple chiffré : une carte achetée 60 € revendue 100 €. */
  readonly example = computed(() => {
    const r = this.rates();
    const price = 100;
    const urssaf = (price * r.urssaf) / 100;
    const incomeTax = this.s().liberatoryIncomeTax ? 0 : (price * r.incomeTax) / 100;
    return { price, cost: 60, urssaf, incomeTax, net: price - 60 - urssaf - incomeTax };
  });

  readonly links: OfficialLink[] = [
    { label: 'autoentrepreneur.urssaf.fr', url: URSSAF_URL, description: 'Déclarer et payer son CA, gérer ses options (gratuit).' },
    { label: 'urssaf.fr', url: 'https://www.urssaf.fr', description: 'Taux, ACRE, protection sociale des indépendants.' },
    { label: 'impots.gouv.fr (professionnel)', url: 'https://www.impots.gouv.fr/professionnel', description: 'CFE, TVA, versement libératoire, espace professionnel.' },
    { label: 'entreprendre.service-public.gouv.fr', url: 'https://entreprendre.service-public.gouv.fr', description: 'Fiches officielles sur le régime micro-entrepreneur.' },
    { label: 'formalites.entreprises.gouv.fr', url: 'https://formalites.entreprises.gouv.fr', description: 'Guichet unique : création, modification, cessation.' }
  ];
}
