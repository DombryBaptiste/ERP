import { Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';

/** Traduction française de la pagination des tableaux. */
@Injectable()
export class FrPaginatorIntl extends MatPaginatorIntl {
  override itemsPerPageLabel = 'Lignes par page';
  override nextPageLabel = 'Page suivante';
  override previousPageLabel = 'Page précédente';
  override firstPageLabel = 'Première page';
  override lastPageLabel = 'Dernière page';

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0) return '0 sur 0';
    const start = page * pageSize;
    const end = Math.min(start + pageSize, length);
    return `${start + 1} – ${end} sur ${length}`;
  };
}
