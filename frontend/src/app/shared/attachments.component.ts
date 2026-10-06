import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ATTACHMENT_KIND_LABELS } from '../core/labels';
import { Attachment, AttachmentKind, AttachmentOwner } from '../core/models';
import { AttachmentService } from '../core/services/api.services';
import { NotifyService } from '../core/services/notify.service';
import { LabelPipe } from './label.pipe';

/**
 * Galerie de fichiers joints d'un élément (article, achat, vente) :
 * vignettes pour les images, icône pour les PDF, ajout par bouton ou glisser-déposer.
 */
@Component({
  selector: 'app-attachments',
  imports: [FormsModule, DatePipe, DecimalPipe, LabelPipe, MatButtonModule, MatIconModule, MatSelectModule, MatFormFieldModule, MatTooltipModule, MatProgressBarModule],
  templateUrl: './attachments.component.html',
  styleUrl: './attachments.component.scss'
})
export class AttachmentsComponent {
  readonly ownerType = input.required<AttachmentOwner>();
  /** Identifiant de l'élément ; null tant qu'il n'est pas enregistré. */
  readonly ownerId = input<number | null>(null);
  /** Natures proposées à l'envoi (la première est sélectionnée par défaut). */
  readonly kinds = input<AttachmentKind[]>(['Photo']);
  /** N'afficher que ces natures (toutes si vide). */
  readonly filter = input<AttachmentKind[]>([]);
  readonly emptyText = input('Aucun fichier.');
  /** Émis après un ajout ou une suppression (ex. pour rafraîchir une vignette). */
  readonly changed = output<void>();

  private readonly api = inject(AttachmentService);
  private readonly notify = inject(NotifyService);

  readonly files = signal<Attachment[]>([]);
  readonly uploading = signal(false);
  readonly reordering = signal(false);
  readonly dragOver = signal(false);
  readonly preview = signal<Attachment | null>(null);
  selectedKind: AttachmentKind = 'Photo';
  readonly kindLabels = ATTACHMENT_KIND_LABELS;

  constructor() {
    effect(() => {
      this.selectedKind = this.kinds()[0] ?? 'Photo';
      const id = this.ownerId();
      if (id) this.load(id);
      else this.files.set([]);
    });
  }

  private load(id: number): void {
    this.api.list(this.ownerType(), id).subscribe({
      next: files => {
        const filter = this.filter();
        this.files.set(filter.length ? files.filter(f => filter.includes(f.kind)) : files);
      },
      error: err => this.notify.error(err)
    });
  }

  onFiles(list: FileList | null): void {
    const id = this.ownerId();
    if (!id || !list?.length) return;
    const files = Array.from(list);
    this.uploading.set(true);
    let remaining = files.length;
    for (const file of files) {
      this.api.upload(this.ownerType(), id, this.selectedKind, file).subscribe({
        next: () => {
          if (--remaining === 0) this.done(id, files.length);
        },
        error: err => {
          this.notify.error(err, `Envoi de « ${file.name} » impossible.`);
          if (--remaining === 0) this.done(id, 0);
        }
      });
    }
  }

  private done(id: number, count: number): void {
    this.uploading.set(false);
    if (count) this.notify.success(`${count} fichier(s) ajouté(s).`);
    this.load(id);
    this.changed.emit();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.onFiles(event.dataTransfer?.files ?? null);
  }

  photoFiles(): Attachment[] {
    return this.files().filter(file => file.kind === 'Photo');
  }

  photoIndex(file: Attachment): number {
    return this.photoFiles().findIndex(photo => photo.id === file.id);
  }

  movePhoto(file: Attachment, direction: -1 | 1): void {
    const ownerId = this.ownerId();
    if (!ownerId || this.reordering()) return;

    const photos = this.photoFiles();
    const index = photos.findIndex(photo => photo.id === file.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= photos.length) return;
    [photos[index], photos[destination]] = [photos[destination], photos[index]];

    this.reordering.set(true);
    this.api.reorderPhotos(this.ownerType(), ownerId, photos.map(photo => photo.id)).subscribe({
      next: () => {
        this.reordering.set(false);
        this.load(ownerId);
        this.changed.emit();
      },
      error: err => {
        this.reordering.set(false);
        this.notify.error(err);
      }
    });
  }

  remove(file: Attachment): void {
    this.notify.confirm({ title: 'Supprimer ce fichier ?', message: file.fileName }).subscribe(ok => {
      if (!ok) return;
      this.api.delete(file.id).subscribe({
        next: () => {
          this.files.update(list => list.filter(f => f.id !== file.id));
          if (this.preview()?.id === file.id) this.preview.set(null);
          this.changed.emit();
        },
        error: err => this.notify.error(err)
      });
    });
  }
}
