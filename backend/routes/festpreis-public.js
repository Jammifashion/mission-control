// ── Festpreis Public – Token-Auth Endpunkte (kein API-Key erforderlich) ──────
// Registriert vor requireApiKey in index.js.
// Wird von partner-festpreis.html genutzt.

import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { fpAbrechnungsZeilen } from '../utils/fp-abrechnung.js';
import { aggregateFpVerkaeufe, loadOffeneInterne, ladeVerpackung, ladePorto, portoSaldo } from './festpreis-portal.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import { findeZeileZumToken, SPALTE_TOKEN, SPALTE_HASH } from '../utils/partner-token.js';
import { SPALTE_VERSCHLUESSELT } from '../utils/link-schluessel.js';
import { parseDeZahl } from '../utils/zahl-de.js';
import { verkaufsUebersicht, uebersichtAntwort, bauZwischenspeicher, detailAn, fpBetragsUebersicht } from '../utils/partner-uebersicht.js';
import { gebuendelt } from '../lib/sheetsBuendel.js';
import { berlinDatum } from '../utils/berlin-tag.js';

const router = Router();

const SHEETID = () => process.env.BUSINESS_SHEET_ID;
const TAB_FP_PARTNER      = 'FP_Partner';
const TAB_FP_VERKAEUFE    = 'FP_Verkäufe';
const TAB_FP_ABRECHNUNGEN = 'FP_Abrechnungen';
const TAB_INTERN          = 'Partner_Interne_Bestellungen';
const TAB_FIXKOSTEN       = 'Kalkulation_Fixkosten';

function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseDeZahl(val.toString());
  return Number.isNaN(n) ? fallback : n;
}
const round2 = n => Math.round(n * 100) / 100;

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${tabName}!A1:ZZ`,   // PPS1: breiter als A1:Z (Token_Hash steht hinten)
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

function rowToObj(header, row) {
  const obj = {};
  header.forEach((h, i) => { obj[h] = row[i] ?? ''; });
  return obj;
}

// feste Feldlisten statt ganzer Sheet-Zeilen - genau das, was partner-festpreis.html liest.
// Neue Spalten im Sheet erscheinen so nie ungewollt im Portal (EK, Festpreis, Sperre-Grund, Versandmethode …).
export const PORTAL_VERKAUF_FELDER = ['Datum', 'WC-Bestellnummer', 'Artikelname', 'Stückzahl', 'Storno-Status', 'Status Abrechnung'];
export const PORTAL_ABRECHNUNG_FELDER = ['Abrechnungs-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Status', 'Erstellt-Am',
  'Gesamt-Netto', 'Gesamt-Brutto', 'Positionen'];

function nurFelder(obj, felder) {
  const aus = {};
  for (const f of felder) aus[f] = obj[f] ?? '';
  return aus;
}

/** Positionen-JSON der Abrechnung: das Portal liest nur die verrechneten internen Bestellungen. */
export function portalPositionen(text) {
  let pos;
  try { pos = JSON.parse(String(text ?? '')); } catch { return ''; }
  if (!pos || typeof pos !== 'object' || Array.isArray(pos)) return '';
  const intern = (Array.isArray(pos.intern) ? pos.intern : [])
    .map(i => ({ datum: i?.datum ?? '', bezeichnung: i?.bezeichnung ?? '', anzahl: i?.anzahl ?? '', summe: i?.summe ?? 0 }));
  return JSON.stringify({ intern, ...(pos.interneSumme !== undefined ? { interneSumme: pos.interneSumme } : {}) });
}

function extractToken(req) {
  const auth = req.headers.authorization ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

async function resolvePartner(token) {
  const sheetId = SHEETID();
  if (!sheetId) throw Object.assign(new Error('BUSINESS_SHEET_ID nicht konfiguriert.'), { status: 503 });
  const sheets = await getSheets();
  const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
  const aktivIdx = header.indexOf('Aktiv');
  // PPS1: Hash + timingSafeEqual (Uebergang: Klartext, solange kein Hash da ist).
  const row = findeZeileZumToken(header, rows, token)?.zeile;
  if (!row) throw Object.assign(new Error('Ungültiger Token.'), { status: 401 });
  if ((row[aktivIdx] ?? '').toLowerCase() !== 'ja')
    throw Object.assign(new Error('Partner ist nicht aktiv.'), { status: 403 });
  // Zugangsspalten nie weiterreichen (das Partner-Objekt geht in Antworten an das Portal).
  const partner = rowToObj(header, row);
  delete partner[SPALTE_TOKEN]; delete partner[SPALTE_HASH]; delete partner[SPALTE_VERSCHLUESSELT];   // LK1
  return { partner, sheets, sheetId };
}

// ── GET /api/festpreis-public/auth ───────────────────────────────────────────
router.get('/auth', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner } = await resolvePartner(token);
    res.json({ partnerId: partner['Partner-ID'], partnerName: partner['Name'] });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis-public/verkaeufe ──────────────────────────────────────
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    const partnerId = partner['Partner-ID'];

    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const pidIdx = header.indexOf('Partner-ID');
    const stIdx  = header.indexOf('Status Abrechnung');
    // PA8: gesperrte Zeilen (Festpreis-Kategorie fehlt) als "in Prüfung", ohne Grund und ohne Betraege; nicht im Saldo.
    // nur die Felder aus PORTAL_VERKAUF_FELDER (keine Betraege, kein Sperre-Grund).
    const filtered = rows
      .filter(r => (r[pidIdx] ?? '') === partnerId && (r[stIdx] ?? '') !== 'abgerechnet')
      .map(r => {
        const o = nurFelder(rowToObj(header, r), PORTAL_VERKAUF_FELDER);
        if (String(o['Status Abrechnung'] ?? '').trim() === 'gesperrt') o['Status Abrechnung'] = 'in Prüfung';
        return o;
      });
    res.json(filtered);
  } catch (err) { next(err); }
});

// ── GET /api/festpreis-public/intern ─────────────────────────────────────────
// Direkte (interne) Bestellungen des FP-Partners – werden mit der Auszahlung
// verrechnet. Einzelpreise sind brutto.
router.get('/intern', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    const partnerId = partner['Partner-ID'];

    const { header, rows } = await readTab(sheets, sheetId, TAB_INTERN);
    const h = col => header.indexOf(col);
    res.json(rows
      .filter(r => (r[h('Partner-ID')] ?? '') === partnerId)
      .map(r => ({
        datum:       r[h('Datum')]       ?? '',
        bezeichnung: r[h('Bezeichnung')] ?? '',
        anzahl:      toFloat(r[h('Anzahl')]),
        einzelpreis: toFloat(r[h('Einzelpreis')]),
        summe:       toFloat(r[h('Summe')]),
        status:      r[h('Status')]      ?? '',
      })));
  } catch (err) { next(err); }
});

// ── GET /api/festpreis-public/saldo ──────────────────────────────────────────
// Offene Auszahlung (FP-Verkäufe, brutto) − offene interne Bestellungen (brutto).
// Identische Rechnung wie Admin-Vorschau/Abrechnung ("von Brutto abziehen").
router.get('/saldo', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    const { _intern, ...saldo } = await fpSaldo(sheets, sheetId, partner['Partner-ID']);   // interne Positionen nie ans Portal
    res.json(saldo);
  } catch (err) { next(err); }
});

/** Offene Auszahlung eines FP-Partners - EINE Rechnung fuer /saldo und /uebersicht (PD1), wie Vorschau/Abrechnung. */
export async function fpSaldo(sheets, sheetId, partnerId) {
  const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
  const vh = col => header.indexOf(col);
  // Dieselbe Auswahl wie Vorschau und Abrechnung: alle offenen Zeilen inkl. Storno-Gegenbuchungen.
  const offene = fpAbrechnungsZeilen(rows, vh, { partnerId, parseDate: () => null });
  const { summen } = aggregateFpVerkaeufe(offene, vh);

  const { header: kH, rows: kRows } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
  const mwstProzent = parseKonfiguration(kRows, kH).mwstProzent;
  const interne = await loadOffeneInterne(sheets, sheetId, partnerId, null, null);

  // Verpackungspauschale (VP1) über alle offenen Zeilen inkl. Storno-Gegenbuchungen,
  // wie die Abrechnung. Fehlt der Wert: nicht abziehen, Portal zeigt "in Prüfung".
  const offeneMitStorno = offene;
  const v = await ladeVerpackung(sheets, sheetId, partnerId, offeneMitStorno, rows, vh);
  const verpackung = v.status === 'keine' ? null
    : v.status === 'ok' ? { status: 'ok', anzahl: v.anzahl, betrag: v.betrag, summe: v.summe }
    : { status: 'in_pruefung' };   // Grund und Bestellnummern nur intern

  // PO1: Porto je Bestellung (netto) ueber dieselben Zeilen wie die Abrechnung
  const p = await ladePorto(sheets, sheetId, partnerId, offeneMitStorno, rows, vh);
  const porto = p.status === 'keine' ? null
    : { einnahmen: p.einnahmen, kosten: { anzahl: p.kosten.anzahl, summe: p.kosten.summe }, saldo: p.saldo, ...(p.status === 'fehlt' ? { inPruefung: true } : {}) };
  const auszahlungNetto  = round2(summen.auszahlung + portoSaldo(p));
  const auszahlungBrutto = round2(auszahlungNetto * (1 + mwstProzent / 100));
  const saldoBrutto      = round2(auszahlungBrutto - interne.summe - (verpackung?.summe ?? 0));
  const saldoNetto       = round2(saldoBrutto / (1 + mwstProzent / 100));

  return {
    mwstProzent,
    auszahlungNetto, auszahlungBrutto,
    interneSumme: interne.summe,
    verpackung,
    ...(porto ? { porto } : {}),   // PO1: ohne Bestellnummern
    saldoNetto, saldoBrutto,
    _intern: interne.positionen,   // nur fuer /uebersicht (Anzahl), nie an das Portal
  };
}

// ── PD1: GET /api/festpreis-public/uebersicht ────────────────────────────────
// Startseite des Festpreis-Portals: Auszahlung (fpSaldo), Stueck je Stand, Stueck je Monat mit Vorjahr, Top 5.
// Feste Feldauswahl, keine Bestellnummern; 10 min Zwischenspeicher je Partner, Reiter in EINEM batchGet.
router.get('/uebersicht', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    res.set('Cache-Control', 'no-store');
    res.json(await leseFpUebersicht({ partnerId: partner['Partner-ID'], sheets, sheetId }));
  } catch (err) { next(err); }
});

const fpSpeicher = bauZwischenspeicher();
export const _fpUebersichtSpeicherLeeren = () => fpSpeicher.leeren();

export async function leseFpUebersicht({ partnerId, sheets: roh, sheetId, heute }) {
  return fpSpeicher.hole(`festpreis:${partnerId}`, async () => {
    const sheets = await gebuendelt(roh, sheetId,
      [TAB_FP_VERKAEUFE, TAB_INTERN, TAB_FP_ABRECHNUNGEN, TAB_FP_PARTNER, TAB_FIXKOSTEN]);
    const s = await fpSaldo(sheets, sheetId, partnerId);
    const [vk, abr, fpp] = [await readTab(sheets, sheetId, TAB_FP_VERKAEUFE), await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN),
      await readTab(sheets, sheetId, TAB_FP_PARTNER)];
    const statistik = verkaufsUebersicht({ header: vk.header, rows: vk.rows, partnerId, heute: heute ?? berlinDatum(new Date()),
      spalten: { order: 'WC-Bestellnummer', artikel: 'Artikelname', status: 'Status Abrechnung', storno: 'Storno-Status' } });
    // PD2: Detailansicht nur, wenn der Partner im Reiter FP_Partner auf "ja" steht - sonst keine Betragsfelder in der Antwort.
    const zeile = fpp.rows.find(r => (r[fpp.header.indexOf('Partner-ID')] ?? '') === partnerId);
    const detail = detailAn(fpp.header, zeile)
      ? fpBetragsUebersicht({ header: vk.header, rows: vk.rows, partnerId, heute: heute ?? berlinDatum(new Date()), mwstProzent: s.mwstProzent })
      : null;
    return uebersichtAntwort({
      detail,
      auszahlung: {
        saldo: s.saldoBrutto, seit: fpSeit(partnerId, abr, fpp), saldoKachel: true,
        intern: s._intern.length, internOhneBetrag: s._intern.filter(x => x.ohneSumme).length,
        inPruefung: s.verpackung?.status === 'in_pruefung' || s.porto?.inPruefung === true,
      },
      statistik,
    });
  });
}

// "seit": Tag nach dem groessten Zeitraum-Bis der (nicht entworfenen) Abrechnungen, sonst Vertrag-ab, sonst leer.
function fpSeit(partnerId, abr, fpp) {
  const a = n => abr.header.indexOf(n);
  const bis = abr.rows.filter(r => (r[a('Partner-ID')] ?? '') === partnerId && String(r[a('Status')] ?? '').trim() !== 'entwurf')
    .map(r => String(r[a('Zeitraum-Bis')] ?? '').trim()).map(s => ({ s, d: deDatum(s) })).filter(x => x.d).sort((x, y) => y.d - x.d)[0];
  if (bis) { const d = new Date(bis.d); d.setDate(d.getDate() + 1); return deText(d); }
  const p = fpp.rows.find(r => (r[fpp.header.indexOf('Partner-ID')] ?? '') === partnerId);
  const v = p ? deDatum(p[fpp.header.indexOf('Vertrag-ab')]) : null;
  return v ? deText(v) : '';
}
const deDatum = s => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s ?? '').trim()); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
const deText = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

// ── GET /api/festpreis-public/abrechnungen ────────────────────────────────────
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const { partner, sheets, sheetId } = await resolvePartner(token);
    const partnerId = partner['Partner-ID'];

    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
    const pidIdx = header.indexOf('Partner-ID');
    const filtered = rows
      .filter(r => (r[pidIdx] ?? '') === partnerId && (r[header.indexOf('Status')] ?? '') !== 'entwurf')
      .map(r => {
        const obj = nurFelder(rowToObj(header, r), PORTAL_ABRECHNUNG_FELDER);
        // Sheet ist deutsch lokalisiert → "12,34"; als echte Zahl liefern,
        // sonst ergibt Number("12,34") im Frontend NaN (→ Anzeige 0,00).
        obj['Gesamt-Netto']  = toFloat(obj['Gesamt-Netto']);
        obj['Gesamt-Brutto'] = toFloat(obj['Gesamt-Brutto']);
        obj['Positionen']    = portalPositionen(obj['Positionen']);
        return obj;
      });
    res.json(filtered);
  } catch (err) { next(err); }
});

export default router;
