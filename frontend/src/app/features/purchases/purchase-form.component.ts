import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, input, OnInit, signal, ViewChild } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CONDITIONS, ITEM_TYPES, PAYMENT_METHODS, PURCHASE_PLATFORMS } from '../../core/labels';
import { isCard } from '../../core/labels';
import { AppPreferences, CardSeriesEntry, ItemCondition, ItemType, PaymentMethod, Purchase, PurchaseInput, PurchaseLine, PurchasePlatform, PurchaseSource } from '../../core/models';
import { AttachmentsComponent } from '../../shared/attachments.component';
import { LabelPipe } from '../../shared/label.pipe';
import { groupProducts, normalizeText, ProductGroup, productKey } from '../../core/products';
import { InventoryService, PurchaseService, ToolsService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';
import { parseApiDate, toIsoDate } from '../../core/utils';

/** Formulaire d'une ligne d'achat. */
type LineForm = FormGroup<{
  itemId: FormControl<number | null>;
  name: FormControl<string>;
  category: FormControl<string>;
  language: FormControl<string>;
  type: FormControl<ItemType>;
  condition: FormControl<ItemCondition>;
  quantity: FormControl<number>;
  unitPrice: FormControl<number>;
  location: FormControl<string>;
  soldQuantity: FormControl<number>;
}>;

type LineValues = ReturnType<LineForm['getRawValue']>;

@Component({
  selector: 'app-purchase-form',
  imports: [
    ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, AttachmentsComponent, LabelPipe,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDatepickerModule,
    MatAutocompleteModule, MatButtonModule, MatButtonToggleModule, MatIconModule, MatTooltipModule, MatProgressBarModule
  ],
  templateUrl: './purchase-form.component.html'
})
export class PurchaseFormComponent implements OnInit {
  /** Paramètre de route :id (absent en création). */
  readonly id = input<string>();

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(PurchaseService);
  private readonly inventoryApi = inject(InventoryService);
  private readonly toolsApi = inject(ToolsService);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly types = ITEM_TYPES;
  readonly conditions = CONDITIONS;
  readonly isEdit = computed(() => !!this.id());
  readonly purchase = signal<Purchase | null>(null);
  readonly categories = signal<string[]>([]);
  readonly cardSeries = signal<CardSeriesEntry[]>([]);
  readonly knownProducts = signal<ProductGroup[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly linePage = signal(0);
  readonly linePageSize = 20;
  private automaticPlatformFees = false;
  private settingAutomaticPlatformFees = false;
  private readonly savedLineValues = new WeakMap<LineForm, LineValues>();

  @ViewChild('purchaseLines') private purchaseLines?: ElementRef<HTMLDivElement>;

  readonly form = this.fb.group({
    /** Achat classique ou transfert depuis la collection personnelle (fixé à la création). */
    source: this.fb.control<PurchaseSource>('Supplier'),
    purchaseDate: this.fb.control<Date>(new Date(), Validators.required),
    supplier: ['', [Validators.required, Validators.maxLength(150)]],
    platform: this.fb.control<PurchasePlatform | null>(null),
    platformFees: this.fb.control(0, Validators.min(0)),
    shippingFees: this.fb.control(0, Validators.min(0)),
    trackingNumber: ['', [Validators.maxLength(100)]],
    /** Mode de règlement (registre des achats) ; null pour un transfert de collection. */
    paymentMethod: this.fb.control<PaymentMethod | null>('Cash'),
    comment: ['', Validators.maxLength(1000)],
    items: this.fb.array<LineForm>([])
  });

  readonly payments = PAYMENT_METHODS;
  readonly purchasePlatforms = PURCHASE_PLATFORMS;

  get items() {
    return this.form.controls.items;
  }

  get visibleReversedItems(): LineForm[] {
    const start = this.linePage() * this.linePageSize;
    const firstIndex = this.items.length - start - 1;
    const count = Math.min(this.linePageSize, firstIndex + 1);
    return Array.from({ length: count }, (_, offset) => this.items.at(firstIndex - offset));
  }

  get linePageCount(): number {
    return Math.max(1, Math.ceil(this.items.length / this.linePageSize));
  }

  get isCollection(): boolean {
    return this.form.controls.source.value === 'PersonalCollection';
  }

  constructor() {
    this.form.controls.platformFees.valueChanges.subscribe(() => {
      if (!this.settingAutomaticPlatformFees) this.automaticPlatformFees = false;
    });
    this.items.valueChanges.subscribe(() => this.updateAutomaticPlatformFees());

    // Le fournisseur n'est obligatoire que pour un vrai achat.
    this.form.controls.source.valueChanges.subscribe(source => {
      const supplier = this.form.controls.supplier;
      supplier.setValidators(source === 'Supplier' ? [Validators.required, Validators.maxLength(150)] : [Validators.maxLength(150)]);
      supplier.updateValueAndValidity();
    });
  }

  ngOnInit(): void {
    this.toolsApi.preferences().subscribe({
      next: (prefs: AppPreferences) => this.cardSeries.set(prefs.cardSeries ?? []),
      error: err => this.notify.error(err)
    });
    this.inventoryApi.categories().subscribe(c => this.categories.set(c));
    // Produits déjà connus : proposés à la saisie du nom pour regrouper les lots sous le même produit.
    this.inventoryApi.getAll().subscribe(items => this.knownProducts.set(groupProducts(items)));

    const id = this.id();
    if (!id) {
      // /purchases/new?source=collection : transfert depuis la collection personnelle.
      if (this.route.snapshot.queryParamMap.get('source') === 'collection') {
        this.form.controls.source.setValue('PersonalCollection');
      }
      this.addLine();
      return;
    }
    this.loading.set(true);
    this.api.get(+id).subscribe({
      next: p => {
        this.purchase.set(p);
        this.form.controls.source.setValue(p.source);
        this.form.controls.source.disable();
        this.form.patchValue({
          purchaseDate: parseApiDate(p.purchaseDate), supplier: p.supplier,
          platform: p.platform, platformFees: p.platformFees, shippingFees: p.shippingFees,
          trackingNumber: p.trackingNumber ?? '', paymentMethod: p.paymentMethod, comment: p.comment ?? ''
        });
        p.items.forEach(line => {
          const formLine = this.createLine(line);
          this.items.push(formLine);
          this.savedLineValues.set(formLine, formLine.getRawValue());
        });
        this.loading.set(false);
      },
      error: err => {
        this.notify.error(err);
        this.router.navigate(['/purchases']);
      }
    });
  }

  private createLine(line?: PurchaseLine): LineForm {
    const sold = line?.soldQuantity ?? 0;
    return this.fb.group({
      itemId: this.fb.control<number | null>(line?.itemId ?? null),
      name: this.fb.control(line?.name ?? '', [Validators.required, Validators.maxLength(200)]),
      category: this.fb.control(line?.category ?? ''),
      language: this.fb.control(line?.language ?? ''),
      // Valeurs par défaut : une collection contient surtout des cartes déjà ouvertes.
      type: this.fb.control<ItemType>(line?.type ?? 'RawCard', Validators.required),
      condition: this.fb.control<ItemCondition>(line?.condition ?? 'NM', Validators.required),
      // On ne peut pas descendre sous la quantité déjà vendue.
      quantity: this.fb.control(line?.quantity ?? 1, [Validators.required, Validators.min(Math.max(1, sold))]),
      unitPrice: this.fb.control(line?.unitPrice ?? 0, [Validators.required, Validators.min(0)]),
      location: this.fb.control(line?.location ?? ''),
      soldQuantity: this.fb.control(sold)
    });
  }

  addLine(): void {
    this.items.push(this.createLine());
    this.linePage.set(0);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => this.purchaseLines?.nativeElement.scrollTo({ top: 0, behavior: 'smooth' }));
    }
  }

  /** Duplique une ligne (pratique pour saisir plusieurs produits proches). */
  duplicateLine(index: number): void {
    const source = this.items.at(index).getRawValue();
    const copy = this.createLine();
    copy.patchValue({ ...source, itemId: null, soldQuantity: 0 });
    this.items.insert(index + 1, copy);
    const displayedIndex = this.items.length - index - 2;
    this.linePage.set(Math.floor(Math.max(0, displayedIndex) / this.linePageSize));
  }

  removeLine(line: LineForm): void {
    if (this.items.length === 1 || line.controls.soldQuantity.value > 0) return;

    const name = line.controls.name.value.trim() || 'cet article';
    this.notify.confirm({
      title: 'Supprimer cette ligne ?',
      message: `« ${name} » sera retiré de l'achat à son prochain enregistrement.`
    }).subscribe(confirmed => {
      if (!confirmed) return;
      const index = this.items.controls.indexOf(line);
      if (index < 0) return;
      this.items.removeAt(index);
      this.linePage.update(page => Math.min(page, this.linePageCount - 1));
    });
  }

  previousLinesPage(): void {
    this.linePage.update(page => Math.max(0, page - 1));
    this.scrollLinesToTop();
  }

  nextLinesPage(): void {
    this.linePage.update(page => Math.min(this.linePageCount - 1, page + 1));
    this.scrollLinesToTop();
  }

  private scrollLinesToTop(): void {
    this.purchaseLines?.nativeElement.scrollTo({ top: 0, behavior: 'smooth' });
  }

  isLineUnsaved(line: LineForm): boolean {
    const saved = this.savedLineValues.get(line);
    return !saved || JSON.stringify(line.getRawValue()) !== JSON.stringify(saved);
  }

  /** Produits existants dont le nom correspond à la saisie. */
  filterProducts(term: string): ProductGroup[] {
    const t = normalizeText(term);
    if (t.length < 2) return [];
    return this.knownProducts().filter(p => normalizeText(p.name).includes(t)).slice(0, 15);
  }

  /** Reprend nom, catégorie, type et état du produit existant : le nouveau lot rejoindra ce produit. */
  useProduct(line: LineForm, product: ProductGroup): void {
    line.patchValue({
      name: product.name,
      category: product.category ?? line.controls.category.value,
      language: this.usesCardSeries(product.type) ? product.language ?? line.controls.language.value : '',
      type: product.type,
      condition: product.condition
    });
  }

  /** Produit existant que rejoindra cette ligne (même nom, type et état), s'il y en a un. */
  matchingProduct(line: LineForm): ProductGroup | undefined {
    const v = line.getRawValue();
    if (!v.name.trim() || v.itemId) return undefined;
    const key = productKey({ name: v.name, type: v.type, condition: v.condition });
    return this.knownProducts().find(p => p.key === key);
  }

  filterCategories(term: string): string[] {
    const t = (term ?? '').toLowerCase();
    return this.categories().filter(c => c.toLowerCase().includes(t)).slice(0, 20);
  }

  usesCardSeries(type: ItemType): boolean {
    return isCard(type) || type === 'Booster' || type === 'Blister' || type === 'Etb' || type === 'MiniTin' || type === 'Bundle';
  }

  languages(): string[] {
    return [...new Set(this.cardSeries().map(x => x.language))].sort((a, b) => a.localeCompare(b));
  }

  seriesFor(line: LineForm): string[] {
    const language = line.controls.language.value;
    const configured = this.cardSeries().filter(x => x.language === language).map(x => x.series);
    const current = line.controls.category.value;
    if (current && !configured.includes(current)) configured.push(current);
    return configured.sort((a, b) => a.localeCompare(b));
  }

  onLanguageChange(line: LineForm): void {
    line.controls.category.setValue('');
  }

  onTypeChange(line: LineForm): void {
    if (!this.usesCardSeries(line.controls.type.value)) line.patchValue({ language: '', category: '' });
  }

  onPurchasePlatformChange(): void {
    const wasAutomatic = this.automaticPlatformFees;
    this.automaticPlatformFees = this.form.controls.platform.value === 'Vinted';
    if (this.automaticPlatformFees) this.updateAutomaticPlatformFees();
    else if (wasAutomatic) this.setAutomaticPlatformFees(0);
  }

  private updateAutomaticPlatformFees(): void {
    if (!this.automaticPlatformFees) return;
    const fees = Math.round((this.itemsTotal() * 0.05 + 0.7) * 100) / 100;
    this.setAutomaticPlatformFees(fees);
  }

  private setAutomaticPlatformFees(fees: number): void {
    this.settingAutomaticPlatformFees = true;
    this.form.controls.platformFees.setValue(fees);
    this.settingAutomaticPlatformFees = false;
  }

  lineTotal(line: LineForm): number {
    const v = line.getRawValue();
    return (v.quantity || 0) * (v.unitPrice || 0);
  }

  /** Calcul automatique du montant total de l'achat. */
  total(): number {
    const itemTotal = this.items.controls.reduce((sum, line) => sum + this.lineTotal(line), 0);
    return itemTotal + (this.isCollection ? 0 : this.form.controls.platformFees.value + this.form.controls.shippingFees.value);
  }

  itemsTotal(): number {
    return this.items.controls.reduce((sum, line) => sum + this.lineTotal(line), 0);
  }

  totalQuantity(): number {
    return this.items.controls.reduce((sum, line) => sum + (line.controls.quantity.value || 0), 0);
  }

  save(): void {
    if (this.form.invalid || this.items.length === 0) {
      this.form.markAllAsTouched();
      this.notify.error(null, 'Veuillez compléter les champs obligatoires (en rouge).');
      return;
    }

    const v = this.form.getRawValue();
    const payload: PurchaseInput = {
      source: v.source,
      purchaseDate: toIsoDate(v.purchaseDate),
      supplier: v.supplier.trim() || null,
      platform: v.source === 'PersonalCollection' ? null : v.platform,
      platformFees: v.source === 'PersonalCollection' ? 0 : v.platformFees,
      shippingFees: v.source === 'PersonalCollection' ? 0 : v.shippingFees,
      trackingNumber: v.trackingNumber.trim() || null,
      paymentMethod: v.source === 'PersonalCollection' ? null : v.paymentMethod,
      comment: v.comment.trim() || null,
      items: v.items.map(l => ({
        itemId: l.itemId,
        name: l.name.trim(),
        category: l.category.trim() || null,
        language: l.language.trim() || null,
        type: l.type,
        condition: l.condition,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        location: l.location.trim() || null
      }))
    };

    const id = this.id();
    const request = id ? this.api.update(+id, payload) : this.api.create(payload);
    this.saving.set(true);
    request.subscribe({
      next: p => {
        const kind = p.source === 'PersonalCollection' ? 'Transfert' : 'Achat';
        this.notify.success(`${kind} ${p.purchaseNumber} enregistré (${p.itemCount} article(s) en stock).`);
        this.saving.set(false);
        this.items.controls.forEach(line => this.savedLineValues.set(line, line.getRawValue()));
        this.router.navigate(['/purchases', p.id]);
      },
      error: err => {
        this.notify.error(err);
        this.saving.set(false);
      }
    });
  }
}
