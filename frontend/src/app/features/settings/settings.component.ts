import { Component, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { AppPreferences, CardSeriesEntry } from '../../core/models';
import { ToolsService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';

/** Paramètres : informations de l'entreprise (factures) et seuils d'alerte. */
@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  templateUrl: './settings.component.html'
})
export class SettingsComponent implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ToolsService);
  private readonly notify = inject(NotifyService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly cardSeries = signal<CardSeriesEntry[]>([]);
  readonly editingSeries = signal<CardSeriesEntry | null>(null);
  readonly seriesSearch = this.fb.control('');
  readonly seriesName = this.fb.control('', [Validators.required, Validators.maxLength(100)]);

  readonly seriesForm = this.fb.group({
    language: ['', [Validators.required, Validators.maxLength(50)]],
    series: ['', [Validators.required, Validators.maxLength(100)]]
  });

  readonly company = this.fb.group({
    fullName: ['', [Validators.required, Validators.maxLength(120)]],
    tradeName: [''],
    siret: ['', Validators.pattern(/^[0-9 ]{14,17}$/)],
    address: [''],
    email: ['', Validators.email],
    phone: [''],
    iban: [''],
    vatMention: ['TVA non applicable, art. 293 B du CGI', Validators.required],
    invoiceFooter: ['']
  });

  readonly alerts = this.fb.group({
    dormantWarningDays: [90, [Validators.required, Validators.min(1)]],
    dormantCriticalDays: [180, [Validators.required, Validators.min(1)]],
    marketGainThreshold: [30, [Validators.required, Validators.min(0)]],
    marketRiseThreshold: [15, [Validators.required, Validators.min(0)]]
  });

  ngOnInit(): void {
    this.api.preferences().subscribe({
      next: prefs => {
        const c = prefs.company;
        this.company.patchValue({
          fullName: c.fullName ?? '', tradeName: c.tradeName ?? '', siret: c.siret ?? '', address: c.address ?? '',
          email: c.email ?? '', phone: c.phone ?? '', iban: c.iban ?? '',
          vatMention: c.vatMention || 'TVA non applicable, art. 293 B du CGI', invoiceFooter: c.invoiceFooter ?? ''
        });
        this.alerts.patchValue(prefs.alerts);
        this.cardSeries.set([...(prefs.cardSeries ?? [])].sort((a, b) =>
          a.language.localeCompare(b.language) || a.series.localeCompare(b.series)));
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.loading.set(false);
      }
    });
  }

  addCardSeries(): void {
    if (this.seriesForm.invalid) {
      this.seriesForm.markAllAsTouched();
      return;
    }
    const entry = this.seriesForm.getRawValue();
    const duplicate = this.cardSeries().some(x =>
      x.language.toLocaleLowerCase() === entry.language.trim().toLocaleLowerCase()
      && x.series.toLocaleLowerCase() === entry.series.trim().toLocaleLowerCase());
    if (duplicate) {
      this.notify.error(null, 'Cette série existe déjà pour cette langue.');
      return;
    }
    this.cardSeries.update(entries => [...entries, {
      language: entry.language.trim(), series: entry.series.trim()
    }].sort((a, b) => a.language.localeCompare(b.language) || a.series.localeCompare(b.series)));
    this.seriesForm.reset();
  }

  filteredSeriesGroups(): { language: string; entries: CardSeriesEntry[] }[] {
    const term = this.seriesSearch.value.trim().toLocaleLowerCase();
    const filtered = this.cardSeries().filter(entry =>
      !term || entry.language.toLocaleLowerCase().includes(term) || entry.series.toLocaleLowerCase().includes(term));
    return [...new Set(filtered.map(entry => entry.language))].map(language => ({
      language,
      entries: filtered.filter(entry => entry.language === language)
    }));
  }

  removeCardSeries(entry: CardSeriesEntry): void {
    this.cardSeries.update(entries => entries.filter(x =>
      x.language !== entry.language || x.series !== entry.series));
  }

  editCardSeries(entry: CardSeriesEntry): void {
    this.editingSeries.set(entry);
    this.seriesName.setValue(entry.series);
    this.seriesName.markAsUntouched();
  }

  cancelSeriesEdit(): void {
    this.editingSeries.set(null);
    this.seriesName.reset();
  }

  saveSeriesEdit(entry: CardSeriesEntry): void {
    if (this.seriesName.invalid) {
      this.seriesName.markAsTouched();
      return;
    }
    const series = this.seriesName.value.trim();
    const duplicate = this.cardSeries().some(x =>
      x.language === entry.language && x.series.toLocaleLowerCase() === series.toLocaleLowerCase()
      && x.series !== entry.series);
    if (duplicate) {
      this.notify.error(null, 'Cette série existe déjà pour cette langue.');
      return;
    }
    this.cardSeries.update(entries => entries.map(x =>
      x.language === entry.language && x.series === entry.series ? { ...x, series } : x
    ).sort((a, b) => a.language.localeCompare(b.language) || a.series.localeCompare(b.series)));
    this.cancelSeriesEdit();
  }

  save(): void {
    if (this.company.invalid || this.alerts.invalid) {
      this.company.markAllAsTouched();
      this.alerts.markAllAsTouched();
      this.notify.error(null, 'Certains champs sont invalides.');
      return;
    }
    const c = this.company.getRawValue();
    const blankToNull = (v: string) => v.trim() || null;
    const prefs: AppPreferences = {
      company: {
        fullName: c.fullName.trim(),
        tradeName: blankToNull(c.tradeName),
        siret: blankToNull(c.siret.replace(/\s/g, '')),
        address: blankToNull(c.address),
        email: blankToNull(c.email),
        phone: blankToNull(c.phone),
        iban: blankToNull(c.iban),
        vatMention: c.vatMention.trim(),
        invoiceFooter: blankToNull(c.invoiceFooter)
      },
      alerts: this.alerts.getRawValue(),
      cardSeries: this.cardSeries()
    };
    this.saving.set(true);
    this.api.savePreferences(prefs).subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.success('Paramètres enregistrés.');
      },
      error: err => {
        this.saving.set(false);
        this.notify.error(err);
      }
    });
  }
}
