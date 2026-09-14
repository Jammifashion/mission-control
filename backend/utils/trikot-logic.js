// Reine Logik für den Trikot-Sync (backend/scripts/sync-trikot.js).
// Kein Netzwerk, kein Sheet-Client – damit testbar in backend/tests.
//
// Grundregeln:
//  - Name/Nummer/Groesse/Farbe kommen ausschliesslich aus line_item.meta_data,
//    über exakte (case-insensitive) Schlüssel-Synonyme. Einzige Zerlegung ist das
//    Variantenmerkmal "Name - Nummer" (siehe extractVarianteNameNummer). Aus
//    Freitext wird nichts geraten: keine Regex auf die Kundennotiz, keine KI.
//  - Der Rohtext hält alles fest, was zum Item bekannt ist, damit ein Mensch
//    nachlesen kann, was die Synonyme nicht erfasst haben.
//  - Das Skript schreibt nur SCRIPT_COLUMNS. Alle anderen Spalten (insbesondere
//    MANUAL_COLUMNS) bekommen im Append null – die Sheets-API überspringt die Zelle.

import { requireHeader, findHeader } from './sheet-headers.js';

export const TAB_TRIKOTS = 'Trikots';
export const TAB_ARTIKEL = 'Trikot_Artikel';

export const WC_STATES_TRIKOT = ['processing', 'on-hold', 'completed'];

export const SCRIPT_COLUMNS = [
  'Zeilen-ID', 'Erfasst_Am', 'Bestelldatum', 'Order-ID', 'Order-Item-ID',
  'Kunde', 'Artikelnummer', 'Produktname', 'Groesse', 'Farbe',
  'Name', 'Nummer', 'Stueck', 'Quelle', 'Rohtext',
];
export const MANUAL_COLUMNS = ['Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz'];

export const ARTIKEL_COLUMNS = ['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'];

export const SYNONYME = {
  name:    ['name', 'rückenname', 'ruckenname', 'spielername', 'aufdruck', 'wunschname'],
  nummer:  ['nummer', 'rückennummer', 'trikotnummer', 'wunschnummer'],
  groesse: ['größe', 'groesse', 'size', 'pa_groesse'],
  farbe:   ['farbe', 'color', 'pa_farbe'],
};

// Google Sheets: max. 50.000 Zeichen je Zelle.
const MAX_CELL = 50000;

const AKTIV_WERTE = new Set(['true', 'wahr', 'ja', 'x', '1']);

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

function metaText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ── Trikot_Artikel ────────────────────────────────────────────────────────────

// values: Ergebnis von values.get inkl. Kopfzeile.
// Liefert Maps Produkt-ID → Artikelnummer und SKU → Artikelnummer, nur aktive Zeilen.
export function parseArtikel(values) {
  const [headers = [], ...rows] = values ?? [];
  const ctx = `Reiter ${TAB_ARTIKEL}`;
  const iNr    = requireHeader(headers, 'Artikelnummer', ctx);
  const iPid   = requireHeader(headers, 'Produkt-ID', ctx);
  const iAktiv = requireHeader(headers, 'Aktiv', ctx);

  const productIds = new Map();
  const skus       = new Map();
  for (const row of rows) {
    if (!AKTIV_WERTE.has(norm(row[iAktiv]))) continue;
    const artikelnummer = String(row[iNr] ?? '').trim();
    const pid = Number(String(row[iPid] ?? '').trim());
    if (Number.isInteger(pid) && pid > 0) productIds.set(pid, artikelnummer);
    if (artikelnummer) skus.set(artikelnummer, artikelnummer);
  }
  return { productIds, skus };
}

// Artikelnummer aus Trikot_Artikel, '' wenn dort leer, null wenn kein Treffer.
export function matchItem(item, artikel) {
  if (artikel.productIds.has(item.product_id)) return artikel.productIds.get(item.product_id);
  const sku = String(item.sku ?? '').trim();
  if (sku && artikel.skus.has(sku)) return artikel.skus.get(sku);
  return null;
}

// ── meta_data ─────────────────────────────────────────────────────────────────

// Erster Treffer je Feld. Verglichen werden key und display_key, exakt nach
// trim + lowercase. Wert bevorzugt display_value ("2XL" statt Slug "2xl").
export function extractFields(metaData) {
  const out = { name: '', nummer: '', groesse: '', farbe: '' };
  for (const m of metaData ?? []) {
    const keys = [norm(m.key), norm(m.display_key)];
    const raw  = typeof m.display_value === 'string' && m.display_value.trim() !== ''
      ? m.display_value : m.value;
    if (raw === null || raw === undefined || typeof raw === 'object') continue;
    const wert = String(raw).trim();
    if (!wert) continue;
    for (const [feld, synonyme] of Object.entries(SYNONYME)) {
      if (out[feld]) continue;
      if (keys.some(k => synonyme.includes(k))) out[feld] = wert;
    }
  }
  return out;
}

// Vorgefertigte Spieler-Trikots tragen Name und Nummer im Variantenmerkmal
// "Name - Nummer" (pa_name-nummer), z.B. "LEPISTÖ - 11". Einzige erlaubte
// Zerlegung: am letzten " - ". Der Platzhalter "WUNSCHNAME - WUNSCHNUMMER"
// liefert nichts – die echten Werte stehen dann im Add-on oder in der Notiz.
export const VARIANTE_NAME_NUMMER = ['pa_name-nummer', 'name - nummer'];
const PLATZHALTER = new Set(['wunschname', 'wunschnummer']);

export function extractVarianteNameNummer(metaData) {
  for (const m of metaData ?? []) {
    if (![norm(m.key), norm(m.display_key)].some(k => VARIANTE_NAME_NUMMER.includes(k))) continue;
    const raw = typeof m.display_value === 'string' && m.display_value.trim() !== ''
      ? m.display_value : m.value;
    if (typeof raw !== 'string') continue;
    const pos = raw.lastIndexOf(' - ');
    if (pos < 0) continue;
    const name   = raw.slice(0, pos).trim();
    const nummer = raw.slice(pos + 3).trim();
    if (!name || !nummer || PLATZHALTER.has(norm(name)) || PLATZHALTER.has(norm(nummer))) continue;
    return { name, nummer };
  }
  return null;
}

// addon:    Name oder Nummer über ein Synonym gefunden (individuelles Trikot)
// variante: Name/Nummer aus dem Variantenmerkmal "Name - Nummer" (vorgefertigt)
// notiz:    weder noch – Angaben stehen, wenn überhaupt, nur im Rohtext
export function bestimmeQuelle(item, felder) {
  if (felder.name || felder.nummer) return 'addon';
  if (felder.variante) return 'variante';
  return 'notiz';
}

// Alle meta_data (ohne WC-interne "_"-Schlüssel) plus Kundennotiz, lesbar.
export function buildRohtext(item, order) {
  const zeilen = [];
  for (const m of item.meta_data ?? []) {
    if (String(m.key ?? '').startsWith('_')) continue;
    const key  = m.display_key || m.key;
    const wert = typeof m.display_value === 'string' && m.display_value !== ''
      ? m.display_value : metaText(m.value);
    zeilen.push(`${key}: ${wert}`);
  }
  const notiz = String(order.customer_note ?? '').trim();
  if (notiz) zeilen.push(`Kundennotiz: ${notiz}`);
  const text = zeilen.length ? zeilen.join('\n') : '(keine Meta-Daten, keine Kundennotiz)';
  return text.length > MAX_CELL ? text.slice(0, MAX_CELL - 1) + '…' : text;
}

// ── Zeilen ────────────────────────────────────────────────────────────────────

export function zeilenId(orderId, orderItemId, laufnummer) {
  return `${orderId}|${orderItemId}|${laufnummer}`;
}

function kundeAus(order) {
  const b = order.billing ?? {};
  return `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim() || String(b.company ?? '').trim();
}

// Liefert Zeilen als Objekte { Spaltenname: Wert } für alle passenden Items.
// Individuell (Name/Nummer gefunden): eine Zeile je Stück, Stueck = 1.
// Sonst: eine Zeile, Stueck = quantity.
export function buildRowsForOrder(order, artikel, erfasstAm) {
  const rows = [];
  for (const item of order.line_items ?? []) {
    const artikelnummer = matchItem(item, artikel);
    if (artikelnummer === null) continue;

    const felder     = extractFields(item.meta_data);
    felder.variante  = extractVarianteNameNummer(item.meta_data);
    const quelle     = bestimmeQuelle(item, felder);
    const individuell = quelle === 'addon';
    if (quelle === 'variante') {
      felder.name   = felder.variante.name;
      felder.nummer = felder.variante.nummer;
    }
    const menge      = Math.max(1, Number(item.quantity) || 1);
    const anzahl     = individuell ? menge : 1;

    const basis = {
      'Erfasst_Am':    erfasstAm,
      'Bestelldatum':  order.date_created ?? '',
      'Order-ID':      order.id,
      'Order-Item-ID': item.id,
      'Kunde':         kundeAus(order),
      'Artikelnummer': artikelnummer || String(item.sku ?? '').trim(),
      'Produktname':   item.name ?? '',
      'Groesse':       felder.groesse,
      'Farbe':         felder.farbe,
      'Name':          felder.name,
      'Nummer':        felder.nummer,
      'Stueck':        individuell ? 1 : menge,
      'Quelle':        quelle,
      'Rohtext':       buildRohtext(item, order),
    };
    for (let lauf = 1; lauf <= anzahl; lauf++) {
      rows.push({ 'Zeilen-ID': zeilenId(order.id, item.id, lauf), ...basis });
    }
  }
  return rows;
}

// Spaltenindex je SCRIPT_COLUMN, header-basiert. Fehlt eine, wirft es.
export function resolveTrikotColumns(headers) {
  const ctx = `Reiter ${TAB_TRIKOTS}`;
  return Object.fromEntries(SCRIPT_COLUMNS.map(c => [c, requireHeader(headers, c, ctx)]));
}

// Objekt → Array für values.append. Nicht-Skript-Spalten bleiben null (= Zelle
// wird übersprungen); nachlaufende nulls werden abgeschnitten.
export function toSheetRow(cols, obj) {
  const len = Math.max(...Object.values(cols)) + 1;
  const row = new Array(len).fill(null);
  for (const [name, idx] of Object.entries(cols)) row[idx] = obj[name] ?? '';
  return row;
}

// ── Bestand ───────────────────────────────────────────────────────────────────

export function existingIds(values) {
  const [headers = [], ...rows] = values ?? [];
  const idx = requireHeader(headers, 'Zeilen-ID', `Reiter ${TAB_TRIKOTS}`);
  return new Set(rows.map(r => String(r[idx] ?? '').trim()).filter(Boolean));
}

// Jüngstes Bestelldatum als YYYY-MM-DD, oder null bei leerem Reiter.
export function juengstesBestelldatum(values) {
  const [headers = [], ...rows] = values ?? [];
  const idx = findHeader(headers, 'Bestelldatum');
  if (idx < 0) return null;
  let max = null;
  for (const r of rows) {
    const d = String(r[idx] ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (max === null || d > max)) max = d;
  }
  return max;
}
