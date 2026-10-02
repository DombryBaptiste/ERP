import { DecimalPipe } from '@angular/common';
import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DeclarationFrequency, MicroActivity, TaxSettings } from '../../core/models';
import { TaxService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';
import { ACTIVITY_PRESETS, DEFAULT_TAX_SETTINGS, effectiveRates, MARGINAL_TAX_RATES, RATES_YEAR } from './tax-rules';

/** Date à partir de laquelle l'ACRE passe de 50 % à 25 % de réduction. */
const ACRE_REFORM_DATE = new Date(2026, 6, 1);

/** Paramètres fiscaux personnalisables. */
@Component({
  selector: 'app-tax-settings',
  imports: [
    ReactiveFormsModule, DecimalPipe,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatButtonToggleModule,
    MatDatepickerModule, MatButtonModule, MatIconModule, MatTooltipModule
  ],
  templateUrl: './tax-settings.component.html',
  styleUrl: './tax-settings.component.scss'
})
export class TaxSettingsComponent implements OnInit {
  readonly settings = input.required<TaxSettings>();
  readonly saved = output<TaxSettings>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(TaxService);
  private readonly notify = inject(NotifyService);

  readonly ratesYear = RATES_YEAR;
  readonly presets = ACTIVITY_PRESETS;
  readonly activities = Object.keys(ACTIVITY_PRESETS) as MicroActivity[];
  readonly marginalRates = MARGINAL_TAX_RATES;
  readonly saving = signal(false);

  readonly form = this.fb.group({
    activity: this.fb.control<MicroActivity>('Sales'),
    creationDate: this.fb.control<Date | null>(null),
    frequency: this.fb.control<DeclarationFrequency>('Quarterly'),
    socialRate: this.rate(0),
    trainingRate: this.rate(0),
    chamberTaxRate: this.rate(0),
    liberatoryIncomeTax: [false],
    liberatoryIncomeTaxRate: this.rate(0),
    flatAllowanceRate: this.rate(0),
    marginalTaxRate: [11],
    acreEnabled: [false],
    acreReductionRate: this.rate(25),
    acreStart: this.fb.control<Date | null>(null),
    acreEnd: this.fb.control<Date | null>(null),
    revenueCeiling: this.amount(0),
    vatThreshold: this.amount(0),
    vatThresholdIncreased: this.amount(0),
    cfeAnnualAmount: this.amount(0),
    safetyMarginRate: this.rate(0)
  });

  ngOnInit(): void {
    this.patch(this.settings());
  }

  /** Champ de taux en % (entre 0 et 100). */
  private rate(value: number) {
    return this.fb.control(value, [Validators.required, Validators.min(0), Validators.max(100)]);
  }

  /** Champ de montant en € (positif). */
  private amount(value: number) {
    return this.fb.control(value, [Validators.required, Validators.min(0)]);
  }

  private patch(s: TaxSettings): void {
    this.form.reset({
      ...s,
      creationDate: s.creationDate ? parseApiDate(s.creationDate) : null,
      acreStart: s.acreStart ? parseApiDate(s.acreStart) : null,
      acreEnd: s.acreEnd ? parseApiDate(s.acreEnd) : null
    });
  }

  /** Taux cumulé prélevé sur chaque vente, recalculé en direct. */
  previewRate(): number {
    return effectiveRates(this.toSettings()).total;
  }

  /** Applique les taux officiels de l'activité choisie. */
  applyPreset(): void {
    this.form.patchValue(ACTIVITY_PRESETS[this.form.controls.activity.value].values);
    this.notify.success(`Taux ${RATES_YEAR} appliqués. Pensez à enregistrer.`);
  }

  /** Déduit les dates et le taux de l'ACRE de la date de création (12 mois à partir de la création). */
  computeAcre(): void {
    const created = this.form.controls.creationDate.value;
    if (!created) {
      this.notify.error(null, "Renseignez d'abord la date de début d'activité.");
      return;
    }
    const end = new Date(created.getFullYear() + 1, created.getMonth(), created.getDate() - 1);
    this.form.patchValue({
      acreEnabled: true,
      acreStart: created,
      acreEnd: end,
      acreReductionRate: created < ACRE_REFORM_DATE ? 50 : 25
    });
  }

  resetDefaults(): void {
    this.patch({ ...DEFAULT_TAX_SETTINGS, creationDate: this.settings().creationDate });
    this.notify.success(`Valeurs ${RATES_YEAR} par défaut restaurées. Pensez à enregistrer.`);
  }

  private toSettings(): TaxSettings {
    const v = this.form.getRawValue();
    return {
      ...v,
      creationDate: v.creationDate ? toIsoDate(v.creationDate) : null,
      acreStart: v.acreStart ? toIsoDate(v.acreStart) : null,
      acreEnd: v.acreEnd ? toIsoDate(v.acreEnd) : null
    };
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notify.error(null, 'Certains taux ou montants sont invalides.');
      return;
    }
    this.saving.set(true);
    this.api.saveSettings(this.toSettings()).subscribe({
      next: s => {
        this.saving.set(false);
        this.notify.success('Paramètres fiscaux enregistrés.');
        this.saved.emit(s);
      },
      error: err => {
        this.saving.set(false);
        this.notify.error(err);
      }
    });
  }
}
