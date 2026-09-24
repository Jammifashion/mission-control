// Reiter "Varianten" (SSOT-Sheet): Zeilen lesen und neu bauen, ausschliesslich
// ueber die Spaltennamen. Keine Buchstaben, keine Indizes, keine Endspalte.
//
// Anlass (VR1): Beim Speichern in der Erfassungsmaske werden die Zeilen einer
// SSOT-ID geloescht und neu angehaengt. Frueher entstand die neue Zeile aus
// einer festen Liste von 12 Werten - jede Spalte, die der Code nicht kennt
// (z. B. LShop_ArticleNr), war nach dem naechsten Speichern leer.
// Jetzt: bekannte Felder aus dem Payload, alle uebrigen Spalten aus der alten
// Zeile mit demselben Varianten-Schluessel.

import { findHeader, requireHeader } from './sheet-headers.js';

export const TAB_VARIANTEN = 'Varianten';
export const LSHOP_SPALTE  = 'LShop_ArticleNr';

// Payload-Feld -> Spaltenname. Das sind die Felder, die das Frontend beim
// Speichern schickt; sie werden immer geschrieben (fehlend = leer), wie bisher.
const PAYLOAD_SPALTEN = [
  ['nr',            'Varianten-Nr'],
  ['e1', 'E1'], ['v1', 'V1'],
  ['e2', 'E2'], ['v2', 'V2'],
  ['e3', 'E3'], ['v3', 'V3'],
  ['preis',         'Preis'],
  ['aktiv',         'Aktiv'],
  ['wcVariationId', 'WC_Variation_ID'],
  ['googleFarbe',   'Google_Farbe'],
];
const ACHSEN = [['E1', 'V1'], ['E2', 'V2'], ['E3', 'V3']];

function fehler(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// Vergleichsform fuer Achsen und Werte: trim, klein, ß = ss. "GRÖSSE" ist die
// Grossschreibung von "Größe" (toLowerCase ergaebe "grösse"), beide sollen
// denselben Schluessel liefern.
const normWert = s => String(s ?? '').trim().toLowerCase().replace(/ß/g, 'ss');

/**
 * Varianten-Schluessel: Menge der Paare Achse -> Wert, normalisiert und
 * sortiert. Unabhaengig davon, ob "Farbe" in E1 oder E2 steht.
 * Paare ohne Achsennamen zaehlen nicht. Artikel ohne Achsen -> ''.
 * @param {Array<[string, string]>} paare
 */
export function variantenSchluessel(paare) {
  return paare
    .filter(([e]) => normWert(e))
    .map(([e, v]) => `${normWert(e)}=${normWert(v)}`)
    .sort()
    .join('|');
}

const payloadPaare = v => [[v.e1, v.v1], [v.e2, v.v2], [v.e3, v.v3]];
const schluesselAusPayload = v => variantenSchluessel(payloadPaare(v));

// Fuer Fehlermeldungen: Originalschreibweise ("Größe=M, Farbe=Schwarz").
const schluesselText = paare =>
  paare.filter(([e]) => String(e ?? '').trim())
    .map(([e, w]) => `${String(e).trim()}=${String(w ?? '').trim()}`).join(', ') || '(ohne Achsen)';

/** L-Shop-Artikelnummer: genau 10 Ziffern. Liefert Fehlertext oder null. */
export function pruefeLShopArticleNr(wert) {
  const s = String(wert ?? '').trim();
  return /^\d{10}$/.test(s) ? null : `"${s}" ist keine L-Shop-Artikelnummer (genau 10 Ziffern erwartet).`;
}

/** Spaltenindizes der Pflichtspalten, alle ueber den Namen. */
export function variantenSpalten(header, ctx) {
  const idx = { ssot: requireHeader(header, 'SSOT-ID', ctx) };
  for (const [, name] of PAYLOAD_SPALTEN) idx[name] = requireHeader(header, name, ctx);
  idx.lshop = findHeader(header, LSHOP_SPALTE);
  return idx;
}

function schluesselAusZeile(zeile, idx) {
  return variantenSchluessel(ACHSEN.map(([e, v]) => [zeile[idx[e]], zeile[idx[v]]]));
}

/**
 * Prueft den Payload, bevor irgendetwas geschrieben wird.
 * Wirft (status 400) bei doppeltem Schluessel oder ungueltiger L-Shop-Nummer.
 * lshopArticleNr: undefined/null = keine Aussage (Bestandswert bleibt),
 * '' = ausdruecklich leeren, sonst genau 10 Ziffern.
 */
export function pruefeVariantenPayload(ssotId, varianten) {
  const gesehen = new Set();
  for (const v of varianten) {
    const k = schluesselAusPayload(v);
    if (gesehen.has(k))
      throw fehler(`Varianten ${ssotId}: Variante "${schluesselText(payloadPaare(v))}" kommt doppelt vor – nichts geschrieben.`);
    gesehen.add(k);
    const nr = v.lshopArticleNr;
    if (nr !== undefined && nr !== null && String(nr).trim() !== '') {
      const f = pruefeLShopArticleNr(nr);
      if (f) throw fehler(`Varianten ${ssotId}, Variante "${schluesselText(payloadPaare(v))}": ${f} Nichts geschrieben.`);
    }
  }
}

/** Bringt der Payload eine L-Shop-Nummer mit (auch ''), braucht es die Spalte. */
export const payloadHatLShop = varianten =>
  varianten.some(v => v.lshopArticleNr !== undefined && v.lshopArticleNr !== null);

/**
 * Neue Zeilen fuer eine SSOT-ID.
 * @param {string[]} header    vollstaendige Kopfzeile
 * @param {string}   ssotId
 * @param {object[]} varianten Payload
 * @param {string[][]} alteZeilen bisherige Zeilen DIESER SSOT-ID
 * @returns {string[][]} Zeilen in Kopfzeilen-Reihenfolge
 */
export function baueVariantenZeilen(header, ssotId, varianten, alteZeilen, ctx = 'Varianten') {
  const idx = variantenSpalten(header, ctx);

  const alt = new Map();
  for (const z of alteZeilen) {
    const k = schluesselAusZeile(z, idx);
    if (alt.has(k))
      throw fehler(`Varianten ${ssotId}: Variante "${schluesselText(ACHSEN.map(([e, w]) => [z[idx[e]], z[idx[w]]]))}" `
                 + `steht im Sheet doppelt – nichts geschrieben.`, 409);
    alt.set(k, z);
  }

  return varianten.map((v, i) => {
    const vorher = alt.get(schluesselAusPayload(v)) ?? [];
    // Grundlage: die alte Zeile (unbekannte Spalten bleiben), auf volle Breite.
    const zeile = header.map((_, j) => vorher[j] ?? '');
    zeile[idx.ssot] = ssotId;
    const werte = {
      nr:            v.nr ?? (i + 1),
      e1: v.e1 ?? '', v1: v.v1 ?? '',
      e2: v.e2 ?? '', v2: v.v2 ?? '',
      e3: v.e3 ?? '', v3: v.v3 ?? '',
      preis:         v.preis ?? '',
      aktiv:         typeof v.aktiv === 'boolean' ? v.aktiv : true,
      wcVariationId: v.wcVariationId ?? '',
      googleFarbe:   v.googleFarbe ?? '',
    };
    for (const [feld, name] of PAYLOAD_SPALTEN) zeile[idx[name]] = werte[feld];
    if (idx.lshop >= 0 && v.lshopArticleNr !== undefined && v.lshopArticleNr !== null)
      zeile[idx.lshop] = String(v.lshopArticleNr).trim();
    return zeile;
  });
}

/** Zeile -> API-Objekt fuer GET /api/sheets/varianten. */
export function varianteAusZeile(zeile, idx) {
  const g = name => zeile[idx[name]] ?? '';
  const aktivRoh = String(g('Aktiv')).toUpperCase().trim();
  return {
    nr:            parseInt(g('Varianten-Nr') || '0', 10) || 0,
    e1: g('E1'), v1: g('V1'), e2: g('E2'), v2: g('V2'), e3: g('E3'), v3: g('V3'),
    preis:         parseFloat(g('Preis')) || 0,
    aktiv:         aktivRoh === 'TRUE' || aktivRoh === 'WAHR',
    wcVariationId: parseInt(g('WC_Variation_ID'), 10) || null,
    googleFarbe:   g('Google_Farbe'),
    lshopArticleNr: idx.lshop >= 0 ? String(zeile[idx.lshop] ?? '').trim() : '',
  };
}

/**
 * WC_Variation_ID -> { ssotId, e1..v3 } fuer den Auftragsmonitor.
 * @param {string[][]} werte ganzer Reiter inkl. Kopfzeile
 */
export function wcVariationMap(werte, ctx) {
  const [header = [], ...zeilen] = werte ?? [];
  const i = {
    ssot: requireHeader(header, 'SSOT-ID', ctx),
    wc:   requireHeader(header, 'WC_Variation_ID', ctx),
  };
  for (const n of ['E1', 'V1', 'E2', 'V2', 'E3', 'V3']) i[n] = requireHeader(header, n, ctx);
  const map = {};
  for (const r of zeilen) {
    const wcVarId = String(r[i.wc] ?? '').trim();
    if (!wcVarId || wcVarId === '0') continue;
    map[wcVarId] = {
      ssotId: String(r[i.ssot] ?? '').trim(),
      e1: r[i.E1] ?? '', v1: r[i.V1] ?? '',
      e2: r[i.E2] ?? '', v2: r[i.V2] ?? '',
      e3: r[i.E3] ?? '', v3: r[i.V3] ?? '',
    };
  }
  return map;
}
