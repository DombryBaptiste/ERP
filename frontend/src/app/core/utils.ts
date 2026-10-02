import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';

/** Date locale -> "yyyy-MM-dd" (sans décalage de fuseau horaire). */
export function toIsoDate(date: Date | null | undefined): string {
  const d = date ?? new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** "2026-09-30T00:00:00" -> Date locale au 30/09/2026. */
export function parseApiDate(value: string): Date {
  const [y, m, d] = value.substring(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Libellé court d'un mois : "sept. 26". */
export function monthLabel(year: number, month: number): string {
  return formatDate(new Date(year, month - 1, 1), 'MMM yy', 'fr-FR');
}

/** Montant en euros sans décimales, pour les axes de graphiques. */
export function euro(value: number | string, decimals = 0): string {
  return Number(value).toLocaleString('fr-FR', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
}

export function truncate(text: string, max = 32): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Extrait un message lisible d'une erreur HTTP de l'API. */
export function extractErrorMessage(err: unknown, fallback = 'Une erreur est survenue.'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return "Impossible de joindre l'API. Le backend est-il démarré ?";
    const body = err.error;
    if (body?.message) return body.message;
    if (body?.errors) {
      const first = Object.values(body.errors as Record<string, string[]>)[0];
      if (first?.length) return first[0];
    }
    if (body?.title) return body.title;
  }
  return fallback;
}
