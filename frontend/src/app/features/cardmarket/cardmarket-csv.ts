import { CardmarketRow } from '../../core/models';

/** Export lu : lignes à envoyer au serveur et image Cardmarket de chaque produit (pour l'affichage). */
export interface CardmarketExport {
  rows: CardmarketRow[];
  images: Map<number, string>;
  /** Codes de série présents (ex. MEW, JTG). */
  setCodes: string[];
}

/**
 * Lit l'export CSV de l'extension Cardmarket (séparateur « ; », champs entre guillemets,
 * identifiants au format Excel ="2182182682", prix « 0,10 »).
 * Colonnes utilisées : idProduct, Name, SetCode, CollectorNumber, Expansion, Rarity, Language, Condition,
 * ReverseHolo, Price_EUR, Amount, ImageUrl.
 */
export function parseCardmarketCsv(text: string): CardmarketExport {
  const records = parseCsv(text.replace(/^﻿/, ''), ';');
  if (records.length < 2) throw new Error('Le fichier est vide.');

  const header = records[0].map(h => h.trim().toLowerCase());
  const column = (name: string): number => header.indexOf(name.toLowerCase());
  const required = ['idProduct', 'Name', 'Condition', 'Amount', 'Price_EUR'];
  const missing = required.filter(name => column(name) < 0);
  if (missing.length) throw new Error(`Ce n'est pas un export Cardmarket : colonne(s) manquante(s) ${missing.join(', ')}.`);

  const get = (record: string[], name: string): string | null => {
    const index = column(name);
    const value = index >= 0 ? cleanValue(record[index] ?? '') : '';
    return value === '' ? null : value;
  };

  const rows: CardmarketRow[] = [];
  const images = new Map<number, string>();
  for (const record of records.slice(1)) {
    if (record.every(v => v.trim() === '')) continue;
    const idProduct = Number(get(record, 'idProduct'));
    const row: CardmarketRow = {
      idProduct: Number.isFinite(idProduct) ? idProduct : 0,
      name: get(record, 'Name') ?? '',
      setCode: get(record, 'SetCode'),
      number: get(record, 'CollectorNumber'),
      expansion: get(record, 'Expansion'),
      rarity: get(record, 'Rarity'),
      language: get(record, 'Language'),
      condition: get(record, 'Condition'),
      reverse: (get(record, 'ReverseHolo') ?? '').toUpperCase() === 'Y',
      price: parseEuro(get(record, 'Price_EUR')),
      amount: Math.max(0, Math.floor(Number(get(record, 'Amount')) || 0))
    };
    rows.push(row);
    const image = get(record, 'ImageUrl');
    if (image && row.idProduct) images.set(row.idProduct, image);
  }
  if (rows.length === 0) throw new Error('Aucune carte dans le fichier.');

  const setCodes = [...new Set(rows.map(r => r.setCode?.toUpperCase()).filter((c): c is string => !!c))].sort();
  return { rows, images, setCodes };
}

/** ="2182182682" -> 2182182682 (format Excel de l'extension). */
function cleanValue(value: string): string {
  const v = value.trim();
  const excel = /^="(.*)"$/.exec(v);
  return (excel ? excel[1] : v).trim();
}

/** « 1 234,50 » -> 1234.5 */
function parseEuro(value: string | null): number {
  if (!value) return 0;
  const n = Number(value.replace(/[\s  €]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Découpe un CSV (guillemets doublés, retours à la ligne dans les champs entre guillemets). */
function parseCsv(text: string, separator: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === separator) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}
