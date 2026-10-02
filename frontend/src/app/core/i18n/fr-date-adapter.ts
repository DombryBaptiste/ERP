import { Injectable } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';

/**
 * Adaptateur de dates : accepte la saisie manuelle au format français (30/09/2026)
 * et fait commencer les semaines le lundi.
 */
@Injectable()
export class FrDateAdapter extends NativeDateAdapter {
  override parse(value: unknown, parseFormat?: unknown): Date | null {
    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (match) {
        const year = +match[3] < 100 ? 2000 + +match[3] : +match[3];
        const date = new Date(year, +match[2] - 1, +match[1]);
        return isNaN(date.getTime()) ? null : date;
      }
    }
    return super.parse(value, parseFormat);
  }

  override getFirstDayOfWeek(): number {
    return 1;
  }
}
