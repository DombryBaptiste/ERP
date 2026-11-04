import { CARD_LANGUAGES } from '../../core/catalog';
import { CONDITIONS } from '../../core/labels';
import { CardLanguage, ItemCondition } from '../../core/models';

/** Ligne relue dans un texte « Copier l'estimation », à retrouver ensuite dans le catalogue. */
export interface ParsedEstimationLine {
  /** Code de la carte, ex. « PFL 095 ». */
  code: string;
  name: string;
  language: CardLanguage;
  condition: ItemCondition;
  quantity: number;
  /** Cote retenue dans l'estimation (peut différer de celle du catalogue). */
  quote: number | null;
}

// « PFL 095 — Dracaufeu ex · JP (Near Mint, x2) : 12,50 € => 6,25 € × 2 = 12,50 € »
const LINE = /^(.+?) — (.*?)(?: · ([A-Z]{2}))? \(([^()]+), x(\d+)\) : (.+?) => /;

/**
 * Relit le texte produit par « Copier l'estimation ». La ligne « Total » est ignorée ;
 * les lignes illisibles (texte modifié à la main) sont comptées dans <c>unreadable</c>.
 */
export function parseEstimationText(text: string): { lines: ParsedEstimationLine[]; unreadable: number } {
  const lines: ParsedEstimationLine[] = [];
  let unreadable = 0;
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row || /^total\s*:/i.test(row)) continue;
    const m = LINE.exec(row);
    const conditionText = m?.[4].trim();
    const condition = CONDITIONS.find(c => c.label === conditionText || c.value === conditionText)?.value;
    const language = m?.[3] ? CARD_LANGUAGES.find(l => l.short === m[3])?.value : 'fr';
    if (!m || !condition || !language) { unreadable++; continue; }
    lines.push({
      code: m[1].trim(),
      name: m[2].trim(),
      language,
      condition,
      quantity: Math.max(1, Number(m[5])),
      quote: parseEuro(m[6])
    });
  }
  return { lines, unreadable };
}

/** « 1 234,50 € » -> 1234.5 ; « — » (pas de cote) -> null. */
function parseEuro(text: string): number | null {
  const cleaned = text.replace(/[\s  €]/g, '').replace(',', '.');
  const value = Number(cleaned);
  return cleaned === '' || isNaN(value) ? null : value;
}
