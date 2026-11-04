import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { catchError, map, of, switchMap } from 'rxjs';
import { CARD_LANGUAGES, cardCode, languageShort } from '../../core/catalog';
import { CardLanguage, CatalogCard, CatalogCardInput, CatalogSet } from '../../core/models';
import { AttachmentService, CatalogService } from '../../core/services/api.services';
import { NotifyService } from '../../core/services/notify.service';

export interface CatalogCardDialogData {
  sets: CatalogSet[];
  /** Carte ajoutée à la main à corriger ; absente pour un ajout. */
  card?: CatalogCard;
  /** Série proposée par défaut (celle affichée sur la page). */
  set?: CatalogSet | null;
}

/** Valeur du choix « Nouvelle série » dans la liste des séries. */
const NEW_SET = '';

/**
 * Ajout (ou correction) d'une carte à la main, quand TCGdex n'est pas encore à jour.
 * Quand la série arrivera chez TCGdex, son import reprendra la carte par son numéro, avec sa cote et son image.
 * Ferme la boîte avec la carte enregistrée.
 */
@Component({
  selector: 'app-catalog-card-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>{{ data.card ? 'Modifier la carte ' + code(data.card) : 'Ajouter une carte' }}</h2>
    <mat-dialog-content>
      @if (data.card; as card) {
        <p class="muted small">{{ card.setName }} · {{ short(card.language) }}</p>
      } @else {
        <p class="muted small">
          Pour une carte absente de TCGdex. À l'import de sa série (même série ou même code), elle sera reprise par son numéro, avec sa cote et son image.
        </p>
        <div class="two-cols">
          <mat-form-field>
            <mat-label>Langue</mat-label>
            <mat-select [value]="language()" (selectionChange)="changeLanguage($event.value)">
              @for (l of languages; track l.value) { <mat-option [value]="l.value">{{ l.label }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Série</mat-label>
            <mat-select [value]="setId()" (selectionChange)="setId.set($event.value)">
              <mat-option [value]="newSet"><mat-icon>add</mat-icon> Nouvelle série</mat-option>
              @for (s of languageSets(); track s.setId) {
                <mat-option [value]="s.setId"><span class="ref">{{ s.setCode ?? s.setId }}</span> {{ s.setName }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        @if (setId() === newSet) {
          <mat-form-field class="full">
            <mat-label>Nom de la série</mat-label>
            <input matInput [(ngModel)]="setName" maxlength="150" required>
          </mat-form-field>
          <div class="two-cols">
            <mat-form-field>
              <mat-label>Code</mat-label>
              <input matInput [(ngModel)]="setCode" maxlength="20" placeholder="ex. PFL">
              <mat-hint>Celui de Cardmarket (recherche « PFL 95 ») : sans code, l'import TCGdex ne reprendra pas la carte</mat-hint>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Bloc (facultatif)</mat-label>
              <input matInput [(ngModel)]="serieName" maxlength="100" placeholder="ex. Méga-Évolution">
            </mat-form-field>
          </div>
        }
      }

      <div class="two-cols">
        <mat-form-field>
          <mat-label>Numéro</mat-label>
          <input matInput [(ngModel)]="number" maxlength="20" required placeholder="ex. 095">
        </mat-form-field>
        <mat-form-field>
          <mat-label>Rareté (facultatif)</mat-label>
          <input matInput [(ngModel)]="rarity" maxlength="60">
        </mat-form-field>
      </div>
      <mat-form-field class="full">
        <mat-label>Nom de la carte</mat-label>
        <input matInput [(ngModel)]="name" maxlength="200" required (keydown.enter)="save()">
      </mat-form-field>

      @if (!data.card) {
        <div class="image-row">
          <button mat-stroked-button type="button" (click)="imageInput.click()">
            <mat-icon>add_photo_alternate</mat-icon> {{ image() ? 'Changer l\\'image' : 'Ajouter une image' }}
          </button>
          <span class="muted small">{{ image()?.name ?? 'Facultatif : vous pourrez aussi l\\'ajouter plus tard.' }}</span>
          <input #imageInput type="file" accept="image/*" hidden (change)="pickImage($event)">
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-flat-button (click)="save()" [disabled]="saving()">
        <mat-icon>save</mat-icon> {{ data.card ? 'Enregistrer' : 'Ajouter' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full { width: 100%; }
    .image-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 4px; }
  `]
})
export class CatalogCardDialogComponent {
  readonly data = inject<CatalogCardDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(CatalogService);
  private readonly attachments = inject(AttachmentService);
  private readonly notify = inject(NotifyService);
  private readonly ref = inject(MatDialogRef<CatalogCardDialogComponent, CatalogCard>);

  readonly languages = CARD_LANGUAGES;
  readonly newSet = NEW_SET;
  readonly code = cardCode;
  readonly short = languageShort;

  readonly language = signal<CardLanguage>(this.data.set?.language ?? 'fr');
  readonly setId = signal(this.data.set?.setId ?? NEW_SET);
  readonly languageSets = computed(() => this.data.sets.filter(s => s.language === this.language()));
  readonly image = signal<File | null>(null);
  readonly saving = signal(false);

  setName = '';
  setCode = '';
  serieName = '';
  number = this.data.card?.number ?? '';
  name = this.data.card?.name ?? '';
  rarity = this.data.card?.rarity ?? '';

  /** Autre langue : la série la plus récente de cette langue, ou une nouvelle série. */
  changeLanguage(language: CardLanguage): void {
    this.language.set(language);
    this.setId.set(this.languageSets()[0]?.setId ?? NEW_SET);
  }

  pickImage(event: Event): void {
    this.image.set((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  save(): void {
    const card = this.data.card;
    const newSet = !card && this.setId() === NEW_SET;
    if (!this.number.trim() || !this.name.trim() || (newSet && !this.setName.trim())) {
      this.notify.error(null, newSet ? 'Indiquez le nom de la série, le numéro et le nom de la carte.' : 'Indiquez le numéro et le nom de la carte.');
      return;
    }
    const input: CatalogCardInput = {
      language: card?.language ?? this.language(),
      setId: card?.setId ?? (newSet ? null : this.setId()),
      setCode: newSet ? this.setCode.trim() || null : null,
      setName: newSet ? this.setName.trim() : null,
      serieName: newSet ? this.serieName.trim() || null : null,
      number: this.number.trim(),
      name: this.name.trim(),
      rarity: this.rarity.trim() || null
    };

    this.saving.set(true);
    (card ? this.api.updateCard(card.id, input) : this.api.createCard(input)).pipe(
      switchMap(saved => {
        const file = this.image();
        if (!file) return of(saved);
        // La carte est déjà créée : un échec de l'envoi de l'image ne doit pas la faire ressaisir.
        return this.attachments.upload('CatalogCard', saved.id, 'Photo', file).pipe(
          map(photo => ({ ...saved, photoId: photo.id })),
          catchError(err => {
            this.notify.error(err, 'Carte ajoutée, mais l\'image n\'a pas pu être envoyée.');
            return of(saved);
          }));
      })
    ).subscribe({
      next: saved => {
        this.notify.success(card ? `${saved.name} modifiée.` : `${saved.name} ajoutée au catalogue.`);
        this.ref.close(saved);
      },
      error: err => {
        this.saving.set(false);
        this.notify.error(err);
      }
    });
  }
}
