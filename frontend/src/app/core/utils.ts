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

/** Arrondi au centime. */
export const roundMoney = (value: number): number => Math.round(value * 100) / 100;

/** Prix unitaire à 6 décimales (comme en base) : 10 € pour 75 cartes = 0,133333 €. */
export function unitPrice(total: number, quantity: number): number {
  return quantity > 0 ? Math.round((total / quantity) * 1_000_000) / 1_000_000 : 0;
}

/** Pourcentage ramené entre 0 et 100 (largeur d'une barre de progression). */
export function clampPercent(percent: number | null): number {
  return Math.min(100, Math.max(0, percent ?? 0));
}

/** Regroupe des éléments par clé, dans l'ordre de première apparition. */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/** Copie d'un ensemble où la valeur est ajoutée si elle est absente, retirée sinon (mise à jour immuable d'un signal). */
export function toggledSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
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
