// L-Shop-Bestellungen (BO4d) - Ein-/Ausgabe fuer GET /api/bestellen/lshop-bestellungen, Logik in
// utils/lshop-bestellungen.js. NUR LESEN, nur Sheets: LShop_EDI_Dateien, Warenkorb_LShop, LShop_Modelle,
// LShop_Sendungen. Kein FTP, kein Shop, kein Schreiben. Laedt nur, wenn der Unterreiter offen ist.
// WE2 (mitHinweisen, nur die Ansicht): dazu LShop_Kartons (Paket-Zaehler) und die Rueckstandslisten aus Drive
// (lib/rueckstand.js, nur lesen) fuer "wahrscheinlich da – bitte prüfen". Gebucht wird nur ueber "Ware angekommen".

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeLShopZeilen } from './lshop.js';
import { normalizeShop } from '../utils/shop-spalte.js';
import { TAB_KORB, korbZeilen } from '../utils/korb-logic.js';
import { AB_KORB_SPALTEN } from '../utils/lshop-ab.js';
import { normHeader } from '../utils/sheet-headers.js';
import { EDI_TAB, entwuerfeAus } from '../utils/edi-bestellung.js';
import { SENDUNGEN_TAB, sendungenZeilen } from '../utils/lshop-belege.js';
import { ediBestellZeilen, baueBestellungen } from '../utils/lshop-bestellungen.js';
import { KARTONS_TAB } from '../utils/karton.js';
import { leseRueckstandListen } from './rueckstand.js';

const q = tab => `'${tab}'`;

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

/** WE2: alle vorhandenen Reiter in EINEM batchGet; fehlt ein Reiter, leere Liste (noch nicht eingerichtet). */
async function werteOderLeer(sheets, spreadsheetId, tabs, titel) {
  const da = tabs.filter(tab => titel.has(tab));
  const aus = Object.fromEntries(tabs.map(tab => [tab, []]));
  if (!da.length) return aus;
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: da.map(q), valueRenderOption: 'FORMATTED_VALUE' });
  (data.valueRanges ?? []).forEach((vr, i) => { aus[da[i]] = vr.values ?? []; });
  return aus;
}

/** WE2 Teil 2: LShop_Kartons -> order_id -> Anzahl gescannter Kartons (Karton_ID einmal). */
function kartonsJeBestellung(werte) {
  const [kopf = [], ...rest] = werte ?? [];
  const norm = kopf.map(normHeader);
  const io = norm.indexOf(normHeader('order_id')), ik = norm.indexOf(normHeader('Karton_ID'));
  const m = new Map();
  if (io < 0) return m;
  const gesehen = new Set();
  for (const r of rest) {
    const o = String(r[io] ?? '').trim(), k = ik < 0 ? '' : String(r[ik] ?? '').trim();
    if (!o || (k && gesehen.has(k))) continue;
    if (k) gesehen.add(k);
    m.set(o, (m.get(o) ?? 0) + 1);
  }
  return m;
}

// BO4i: Liefertermin + AB_Hinweis (hinten, optional - fehlen sie, bleibt es leer) an die Korb-Zeilen haengen.
function mitAbFeldern(korbWerte, zeilen) {
  const norm = (korbWerte[0] ?? []).map(normHeader);
  const i = AB_KORB_SPALTEN.map(n => [n, norm.indexOf(normHeader(n))]).filter(([, x]) => x >= 0);
  return zeilen.map(z => ({ ...z, ...Object.fromEntries(i.map(([n, x]) => [n, String(korbWerte[z._zeile - 1]?.[x] ?? '').trim()])) }));
}

/**
 * @param {object}  o
 * @param {boolean} [o.mitHinweisen]  WE2: Paket-Zaehler + "wahrscheinlich da" (nur die Ansicht; produktionStand liest ohne)
 * @param {Function} [o.listenLesen]  WE2: Rueckstandslisten nach Stichtag (Standard leseRueckstandListen, Drive) - Test setzbar
 */
// MI1: letzte Antwort MIT Hinweisen ("wahrscheinlich da") - nur fuer Mika ("dringend"); die Ansicht liest weiter jedes Mal frisch.
let zuletzt = null;   // { zeit, antwort }
export function zuletztLShopBestellungen({ maxMs } = {}) { return zuletzt && Date.now() - zuletzt.zeit <= maxMs ? zuletzt.antwort : null; }
export const _lshopBestellungenZuletztLeeren = () => { zuletzt = null; };

export async function leseLShopBestellungen({ shop, sheets: s, jetzt = () => new Date(), mitHinweisen = false, listenLesen = leseRueckstandListen } = {}) {
  // EDI-Bestellungen gibt es nur fuer JFN (wie Warenkorb und EDI-Datei).
  if (normalizeShop(shop) !== 'jfn') return { nurJfn: true, bestellungen: [], portal: [], entwuerfe: [] };
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) { const e = new Error('GOOGLE_SHEET_ID fehlt.'); e.status = 503; throw e; }
  const sheets = s ?? await sheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title)' });
  const titel = new Set((data.sheets ?? []).map(x => x.properties?.title));

  const w = await werteOderLeer(sheets, spreadsheetId, [EDI_TAB, TAB_KORB, SENDUNGEN_TAB, ...(mitHinweisen ? [KARTONS_TAB] : [])], titel);
  const ediWerte = w[EDI_TAB];
  const edi = ediBestellZeilen(ediWerte);
  const korbWerte = w[TAB_KORB];
  const korb = korbWerte.length ? mitAbFeldern(korbWerte, korbZeilen(korbWerte).zeilen).filter(z => normalizeShop(z.Shop || 'jfn') === 'jfn') : [];
  const sendungen = w[SENDUNGEN_TAB].length ? sendungenZeilen(w[SENDUNGEN_TAB]) : [];
  const modelle = new Map((await ladeLShopZeilen({ sheets, spreadsheetId })).map(z => [z.articleNr, z]));
  // BO4e: Entwuerfe (noch nicht gesendet) fuer den Knopf "Als gesendet markieren"; Testdatei nie.
  const entwuerfe = entwuerfeAus(ediWerte, korb, jetzt());
  if (!mitHinweisen) return { nurJfn: false, ...baueBestellungen({ edi, korb, modelle, sendungen, jetzt: jetzt() }), entwuerfe };

  // WE2 Teil 3: Rueckstandslisten nur, wenn eine Bestellung mit Paket noch "bestellt"-Positionen hat; gelesen ab dem
  // fruehesten letzten Versandtag. Nicht lesbar -> kein Hinweis (nichts melden) + Text, die Ansicht laeuft weiter.
  const ohne = baueBestellungen({ edi, korb, modelle, sendungen, jetzt: jetzt() });
  const stichtage = ohne.bestellungen.filter(b => b.positionen.some(p => p.status === 'bestellt'))
    .map(b => b.lieferscheine.map(l => l.datum).filter(Boolean).sort().at(-1)).filter(Boolean).sort();
  let listen = null, rueckstandHinweis = '';
  if (stichtage.length) {
    try { listen = await listenLesen({ nach: stichtage[0] }); } catch (err) {
      console.warn(`L-Shop-Bestellungen: Rückstandslisten nicht lesbar (${err?.code ?? err?.status ?? 'Fehler'}) - ohne "wahrscheinlich da".`);
      rueckstandHinweis = 'Rückstandslisten gerade nicht lesbar – „wahrscheinlich da“ fehlt.';
    }
  }
  const kartons = kartonsJeBestellung(w[KARTONS_TAB]);
  const antwort = { nurJfn: false, ...baueBestellungen({ edi, korb, modelle, sendungen, jetzt: jetzt(), kartons, listen }), entwuerfe, rueckstandHinweis };
  if (!s) zuletzt = { zeit: Date.now(), antwort };   // MI1
  return antwort;
}
