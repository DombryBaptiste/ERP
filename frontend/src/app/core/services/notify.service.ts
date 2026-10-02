import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { map, Observable } from 'rxjs';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { extractErrorMessage } from '../utils';

/** Notifications (snackbar) et boîtes de confirmation. */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  success(message: string): void {
    this.snackBar.open(message, 'OK', { duration: 3000, panelClass: 'snack-success' });
  }

  error(err: unknown, fallback?: string): void {
    this.snackBar.open(extractErrorMessage(err, fallback), 'Fermer', { duration: 6000, panelClass: 'snack-error' });
  }

  /** Ouvre une boîte de confirmation ; émet true si l'utilisateur confirme. */
  confirm(data: ConfirmDialogData): Observable<boolean> {
    return this.dialog
      .open(ConfirmDialogComponent, { data, width: '440px' })
      .afterClosed()
      .pipe(map(result => result === true));
  }
}
