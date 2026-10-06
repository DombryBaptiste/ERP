import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { cardmarketSearchUrl, CONDITIONS, ITEM_TYPES } from '../../core/labels';
import { AttachmentsComponent } from '../../shared/attachments.component';
import { InventoryItem, InventoryItemInput, ItemCondition, ItemType } from '../../core/models';
import { InventoryService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';

@Component({
  selector: 'app-inventory-form',
  imports: [
    ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, DecimalPipe, AttachmentsComponent,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDatepickerModule,
    MatAutocompleteModule, MatButtonModule, MatIconModule, MatProgressBarModule
  ],
  templateUrl: './inventory-form.component.html'
})
export class InventoryFormComponent implements OnInit {
  /** Paramètre de route :id (absent en création). */
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(InventoryService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly types = ITEM_TYPES;
  readonly conditions = CONDITIONS;
  readonly isEdit = computed(() => !!this.id());
  readonly item = signal<InventoryItem | null>(null);
  readonly categories = signal<string[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    category: [''],
    type: this.fb.control<ItemType>('RawCard', Validators.required),
    condition: this.fb.control<ItemCondition>('NM', Validators.required),
    purchasePrice: [0, [Validators.required, Validators.min(0)]],
    quantity: [1, [Validators.required, Validators.min(1)]],
    location: [''],
    purchaseDate: this.fb.control<Date>(new Date(), Validators.required),
    /** Valeur de marché unitaire estimée (facultative). */
    marketValue: this.fb.control<number | null>(null, Validators.min(0))
  });

  /** Lien de recherche Cardmarket pour l'article en cours de saisie. */
  cardmarketUrl(): string {
    return cardmarketSearchUrl(this.form.controls.name.value || '');
  }

  /** Rafraîchit la vignette après l'ajout ou la suppression d'une photo. */
  reloadItem(): void {
    const id = this.id();
    if (id) this.api.get(+id).subscribe(item => this.item.set(item));
  }

  ngOnInit(): void {
    this.api.categories().subscribe(c => this.categories.set(c));

    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.api.get(+id).subscribe({
      next: item => {
        this.item.set(item);
        this.form.patchValue({
          name: item.name,
          category: item.category ?? '',
          type: item.type,
          condition: item.condition,
          purchasePrice: item.purchasePrice,
          quantity: item.quantity,
          location: item.location ?? '',
          purchaseDate: parseApiDate(item.purchaseDate),
          marketValue: item.marketValue
        });
        // La quantité ne peut pas descendre sous ce qui a déjà été vendu.
        this.form.controls.quantity.setValidators([Validators.required, Validators.min(Math.max(1, item.soldQuantity))]);
        this.form.controls.quantity.updateValueAndValidity();
        // La date d'un article issu d'un achat est celle de l'achat.
        if (item.purchaseId) this.form.controls.purchaseDate.disable();
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.router.navigate(['/inventory']);
      }
    });
  }

  filterCategories(term: string): string[] {
    const t = (term ?? '').toLowerCase();
    return this.categories().filter(c => c.toLowerCase().includes(t)).slice(0, 20);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload: InventoryItemInput = {
      name: v.name.trim(),
      category: v.category.trim() || null,
      type: v.type,
      condition: v.condition,
      purchasePrice: v.purchasePrice,
      quantity: v.quantity,
      location: v.location.trim() || null,
      purchaseDate: toIsoDate(v.purchaseDate),
      marketValue: v.marketValue === null || (v.marketValue as unknown) === '' ? null : Number(v.marketValue)
    };

    const id = this.id();
    const request = id ? this.api.update(+id, payload) : this.api.create(payload);
    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.notify.success('Article enregistré.');
        this.router.navigate(['/inventory']);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
