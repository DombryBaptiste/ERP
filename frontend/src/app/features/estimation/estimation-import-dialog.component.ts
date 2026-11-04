import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

export interface EstimationImportDialogData {
  /** La sélection actuelle n'est pas vide : on propose d'ajouter ou de remplacer. */
  hasLines: boolean;
}

export interface EstimationImportResult {
  text: string;
  replace: boolean;
}

/** Collage d'un texte « Copier l'estimation » pour reprendre une estimation là où on en était. */
@Component({
  selector: 'app-estimation-import-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Reprendre une estimation</h2>
    <mat-dialog-content>
      <p class="muted small">
        Collez le texte obtenu avec « Copier l'estimation » : les cartes sont retrouvées dans le catalogue,
        avec leur état, leur quantité et la cote retenue.
      </p>
      <mat-form-field class="full">
        <mat-label>Texte de l'estimation</mat-label>
        <textarea matInput [(ngModel)]="text" rows="12" cdkFocusInitial
                  placeholder="PFL 095 — Dracaufeu ex (Near Mint, x1) : 12,50 € => 6,25 €"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      @if (data.hasLines) {
        <button mat-button (click)="close(false)" [disabled]="!text.trim()">
          <mat-icon>playlist_add</mat-icon> Ajouter à la sélection
        </button>
      }
      <button mat-flat-button (click)="close(data.hasLines)" [disabled]="!text.trim()">
        <mat-icon>upload</mat-icon> {{ data.hasLines ? 'Remplacer la sélection' : 'Reprendre' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`.full { width: 100%; } textarea { font-family: monospace; font-size: 12px; }`]
})
export class EstimationImportDialogComponent {
  readonly data = inject<EstimationImportDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<EstimationImportDialogComponent, EstimationImportResult>);

  text = '';

  close(replace: boolean): void {
    this.ref.close({ text: this.text, replace });
  }
}
