// German-Market-Lieferzeit (_lieferzeit) fuer die Artikelanlage.
//
// Quelle der waehlbaren Terme ist der Reiter "Struktur_Lieferzeiten" im
// SSOT-Sheet. Kopfzeile (gelesen 23.09.): Term_ID | Name | Slug, dazu die
// Pflichtspalte "Standard" (Nachtrag zu Befehl L, im Sheet noch anzulegen).
// Term_ID steht im Sheet als ZAHL - geschrieben wird immer der String ("21"),
// so wie German Market ihn in meta_data ablegt.
//
// Keine IDs im Code: fehlt der Reiter oder eine Pflichtspalte, scheitert das
// Lesen laut - es gibt keinen fest verdrahteten Ersatzwert. Der Standard fuer
// die Anlage ist die Zeile mit "ja" in der Spalte "Standard" - genau eine,
// sonst Fehler. Die Reihenfolge der Zeilen spielt keine Rolle.
//
// An Variationen heisst "-1" "wie Elternartikel". Das ist ein WooCommerce-/
// German-Market-Sentinel, kein Term - er steht deshalb hier und nicht im Reiter.
// "'-1" (mit Apostroph) blockiert die Anzeige, leer erbt nicht (gemessen 22./23.09.).

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { requireHeader, findHeader } from '../utils/sheet-headers.js';

export const TAB_LIEFERZEITEN     = 'Struktur_Lieferzeiten';
export const LIEFERZEIT_META_KEY  = '_lieferzeit';
export const LIEFERZEIT_WIE_ELTERN = '-1';

const CTX = `Reiter "${TAB_LIEFERZEITEN}"`;

/**
 * Zeilen des Reiters (inkl. Kopfzeile) -> [{ id, name, slug, standard }].
 * id ist immer ein String aus Ziffern. Wirft laut bei fehlender Pflichtspalte,
 * leerem Reiter, Zeile ohne Term_ID/Name, nicht-numerischer oder doppelter ID
 * und wenn nicht GENAU eine Zeile "ja" in "Standard" hat.
 */
export function parseLieferzeiten(rows) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw fehler(`${CTX} fehlt oder ist leer.`);

  const [headers, ...daten] = rows;
  const idIdx   = requireHeader(headers, 'Term_ID', CTX);
  const nameIdx = requireHeader(headers, 'Name', CTX);
  const stdIdx  = requireHeader(headers, 'Standard', CTX);
  const slugIdx = findHeader(headers, 'Slug');

  const liste = [];
  daten.forEach((row, i) => {
    const zelle = k => (k >= 0 ? String(row?.[k] ?? '').trim() : '');
    if (!(row ?? []).some(c => String(c ?? '').trim())) return;   // Leerzeile
    const zeile = i + 2;
    const id    = zelle(idIdx);
    const name  = zelle(nameIdx);
    if (!id)   throw fehler(`${CTX}, Zeile ${zeile}: Spalte "Term_ID" ist leer.`);
    if (!name) throw fehler(`${CTX}, Zeile ${zeile}: Spalte "Name" ist leer.`);
    if (!/^\d+$/.test(id))
      throw fehler(`${CTX}, Zeile ${zeile}: Term_ID "${id}" ist keine Zahl.`);
    if (liste.some(l => l.id === id))
      throw fehler(`${CTX}, Zeile ${zeile}: Term_ID "${id}" doppelt.`);
    liste.push({ id, name, slug: zelle(slugIdx), standard: zelle(stdIdx).toLowerCase() === 'ja', zeile });
  });

  if (!liste.length) throw fehler(`${CTX} enthaelt keine Lieferzeiten.`);

  const standard = liste.filter(l => l.standard);
  if (standard.length === 0)
    throw fehler(`${CTX}: Spalte "Standard" hat keine Zeile mit "ja" – genau eine erwartet.`);
  if (standard.length > 1)
    throw fehler(`${CTX}: Spalte "Standard" hat ${standard.length} Zeilen mit "ja" `
               + `(Zeilen ${standard.map(l => l.zeile).join(', ')}) – genau eine erwartet.`);

  return liste.map(({ zeile: _z, ...l }) => l);
}

/** Term-ID fuer _lieferzeit am Elternartikel: String aus Ziffern, sonst Fehlertext. */
export function pruefeLieferzeitWert(wert) {
  if (typeof wert !== 'string' || !/^\d+$/.test(wert))
    return `Lieferzeit "${wert}" ist keine Term-ID (erwartet: Ziffern als Text, z. B. "21").`;
  return null;
}

/** meta_data-Eintrag, getrimmt als String - oder null. */
export function lieferzeitAusMetaData(metaData) {
  const e = (Array.isArray(metaData) ? metaData : []).find(m => m && m.key === LIEFERZEIT_META_KEY);
  if (!e || e.value === null || e.value === undefined || typeof e.value === 'object') return null;
  return String(e.value).trim();
}

/** Setzt _lieferzeit in einer meta_data-Liste (ersetzt einen vorhandenen Eintrag). */
export function mitLieferzeit(metaData, wert) {
  const rest = (Array.isArray(metaData) ? metaData : []).filter(m => m?.key !== LIEFERZEIT_META_KEY);
  return [...rest, { key: LIEFERZEIT_META_KEY, value: String(wert) }];
}

export async function ladeLieferzeiten() {
  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  let rows;
  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range:         `${TAB_LIEFERZEITEN}!A1:Z200`,
    });
    rows = data.values ?? [];
  } catch (e) {
    // Fehlender Reiter kommt von der Sheets-API als "Unable to parse range".
    if (/Unable to parse range/i.test(e.message ?? ''))
      throw fehler(`${CTX} fehlt im SSOT-Sheet.`);
    throw e;
  }
  return parseLieferzeiten(rows);
}

function fehler(msg) {
  const e = new Error(msg);
  e.status = 500;
  return e;
}
