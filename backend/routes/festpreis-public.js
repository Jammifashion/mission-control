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
    const BETRAEGE = ['Festpreis', 'Handlingskosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto'];
    const filtered = rows
      .filter(r => (r[pidIdx] ?? '') === partnerId && (r[stIdx] ?? '') !== 'abgerechnet')
      .map(r => {
        const o = rowToObj(header, r);
        delete o.Sperre;
        if (String(o['Status Abrechnung'] ?? '').trim() === 'gesperrt') {
          o['Status Abrechnung'] = 'in Prüfung';
          for (const b of BETRAEGE) delete o[b];
        }
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
    const partnerId = partner['Partner-ID'];

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

    res.json({
      mwstProzent,
      auszahlungNetto, auszahlungBrutto,
      interneSumme: interne.summe,
      verpackung,
      ...(porto ? { porto } : {}),   // PO1: ohne Bestellnummern
      saldoNetto, saldoBrutto,
    });
  } catch (err) { next(err); }
});

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
        const obj = rowToObj(header, r);
        // Sheet ist deutsch lokalisiert → "12,34"; als echte Zahl liefern,
        // sonst ergibt Number("12,34") im Frontend NaN (→ Anzeige 0,00).
        obj['Gesamt-Netto']  = toFloat(obj['Gesamt-Netto']);
        obj['Gesamt-Brutto'] = toFloat(obj['Gesamt-Brutto']);
        return obj;
      });
    res.json(filtered);
  } catch (err) { next(err); }
});

export default router;
