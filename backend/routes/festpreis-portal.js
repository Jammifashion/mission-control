// ── Festpreis-Portal – Sprint 5.5 ────────────────────────────────────────────
// Alle Endpunkte hinter requireApiKey (registriert in index.js).

import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getWcClient } from '../lib/shopConfig.js';
import { seitenGrenze, seitenListe } from '../lib/hosterPruefseite.js';
import { fpArtikelPruefung, fpUebersprungenePruefen } from '../lib/fpArtikel.js';   // PA7: nur melden
import { berechneFestpreisAnteil } from '../utils/festpreis-kalkulation.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import { zugangArt, klartextFuerMc, SPALTE_TOKEN, SPALTE_HASH } from '../utils/partner-token.js';
import { erzeugeNeuenPartnerLink, zeigePartnerLink, partnerKopierbar } from '../lib/partnerLink.js';
import { SPALTE_VERSCHLUESSELT } from '../utils/link-schluessel.js';
import {
  berechneVerpackung, verpackungsKondition, versandmethodeAus, VERSANDMETHODE,
} from '../utils/festpreis-verpackung.js';
import { berechnePorto, satzAus, portoFuerSyncZeile, PORTO_BESTELLUNG, PORTO_VERSANDART } from '../utils/festpreis-porto.js';   // PO1
const PORTO_INDEX = 24;   // PO1: Y = Porto_Bestellung, Z = Porto_Versandart (hinter X = Sperre)
const POSITION_INDEX = 26;   // AA = Positions-ID (line_item.id) der Shop-Bestellung
import {
  STATUS_GESPERRT, SPALTE_SPERRE, SPERRE_INDEX, SYNC_BREITE, GRUND_KATEGORIE, festpreisZuordnungen, zuordnungFuer, sperreZeile,
  fpAbrechnungHinweise, gesperrtZaehlen,
} from '../utils/fp-sperre.js';
import { mitFpSperre, nachrechnenInSperre, nachrechnen as fpNachrechnen } from '../lib/fpSperre.js';
import { buildFpErstattungRows, erstattungHinweisText, istErstattungsZeile } from '../utils/teilerstattung.js';   // NB2
import { ladeErstattungsBestellungen, vorschauErstattungsHinweise } from '../lib/erstattungen.js';   // NB2
import { schreibeNeueZeilen, pruefeZielStrecke, spalteBuchstabe, sichereSpaltenRaster } from '../lib/sheet-zeilen.js';
import {
  SPALTE_POSITION, verkaufsBestand, schonErfasst, syncStart, bestellTag, konfigJeTag, fixkostenLuecken, fixkostenFehler,
} from '../utils/sync-logic.js';
import {
  aggregateFpVerkaeufe, fpAbrechnungsZeilen, fpZeilenSchluessel, fpLoeschPlan, fpStatusWechselErlaubt,
  POSITIONEN_MAX_ZEICHEN, abrechnungKlaeren, klaerenAntwort, leerZelle,
} from '../utils/fp-abrechnung.js';
import { adminBestellLink } from '../utils/shop-admin.js';
import { parseDeZahl } from '../utils/zahl-de.js';
import { wcTagDE, deHeuteBerlin } from '../utils/berlin-tag.js';   // GT1 C4
import { _fpUebersichtSpeicherLeeren } from './festpreis-public.js';   // GS2: Zwischenspeicher der Portal-Uebersicht
import { pruefePflichtSpalten } from '../utils/pflicht-spalten.js';   // GT1 B2

const router = Router();
// GS2: jede schreibende Abrechnungs-Anfrage (erstellen, Status, loeschen) leert die 10-min-Uebersicht des Portals.
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.path.startsWith('/abrechnungen')) res.on('finish', () => {
    _fpUebersichtSpeicherLeeren();
    import('../lib/fanshopKonto.js').then(m => m._fanshopKontoLeeren()).catch(() => {});   // GS2 Teil B: erst bei Bedarf geladen
  });
  next();
});

const SHEETID = () => process.env.BUSINESS_SHEET_ID;

const TAB_FP_PARTNER       = 'FP_Partner';
const TAB_FP_ARTIKEL       = 'FP_Artikel';
const TAB_FP_VERKAEUFE     = 'FP_Verkäufe';
const TAB_FP_ABRECHNUNGEN  = 'FP_Abrechnungen';
const TAB_FIXKOSTEN        = 'Kalkulation_Fixkosten';

// Erlaubte WC-Status für neue Einträge (inkl. on-hold)
const FP_STATES_VERKAUF = ['processing', 'completed', 'on-hold'];
const FP_STATES_STORNO  = ['refunded', 'cancelled'];
const FP_STORNO_MARKER  = 'Storniert/Rückerstattet';

// Lädt WC-Bestellungen für mehrere Status paginiert. afterParam optional (ISO).
// Status nacheinander, nicht gleichzeitig: bei der Hoster-Pruefseite bleibt es
// bei einem Abruf (lib/hosterPruefseite.js), und die Abrufe kommen nicht im Paket.
async function fetchFpOrders(wc, statuses, afterParam) {
  const all = [];
  for (let page = 1; ; page++) {
    seitenGrenze(page, { wc, pfad: 'orders' });
    const listen = [];
    for (const status of statuses) {
      const params = { per_page: 100, page, status };
      if (afterParam) params.after = afterParam;
      listen.push(seitenListe((await wc.get('orders', params)).data, { wc, pfad: 'orders' }));
    }
    for (const l of listen) all.push(...l);
    if (listen.every(l => l.length < 100)) break;
  }
  return all;
}

// Erzeugt negative Gegeneinträge für FP_Verkäufe-Zeilen deren Order storniert wurde.
// FP_Verkäufe Spalten-Layout (A=0 … P=15, Q=16 neu):
//   0=Partner-ID, 1=Datum, 2=WC-Bestellnummer, 3=Artikelname, 4=Variante,
//   5=Stückzahl, 6=Festpreis-EK, 7=Handling, 8=Porto-Einnahme, 9=Porto-Kosten,
//   10=Versandnk, 11=PayPal, 12=Gesamt-Netto, 13=Gesamt-Brutto,
//   14=Status Abrechnung, 15=Produkt-ID, 16=Storno-Status (Q),
//   17=Artikelkategorie (R), 18=Festpreis (S), 19=Mehrkosten (T),
//   20=VK-Netto (U), 21=Handlingskosten (V), 22=Versandmethode (W, VP1)
const STATUS_SPALTE_INDEX = 14;   // PA8: Status Abrechnung, positionsfest wie der Sync
export function buildFpStornoRows(vRows, stornoOrders) {
  const ORD_COL    = 2;
  const ART_COL    = 3;
  const VAR_COL    = 4;
  const PID_COL    = 0;
  const DATE_COL   = 1;
  const STATUS_COL = 14;
  const STORNO_COL = 16;
  const NEG_COLS   = new Set([5, 6, 7, 8, 9, 10, 11, 12, 13, 18, 19, 20, 21]); // inkl. Festpreis, Mehrkosten, VK-Netto, Handlingskosten
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
  // Neue Zeilen tragen die Positions-ID (AA): Gegenbuchung je Position, auch bei zwei gleichen Positionen.
  const dupKeyOf = r => {
    const posId = String(r[POSITION_INDEX] ?? '').trim();
    return posId ? `${r[ORD_COL]}|pos:${posId}|${r[PID_COL]}` : `${r[ORD_COL]}|${r[ART_COL]}|${varKey(r[VAR_COL])}|${r[PID_COL]}`;
  };

  const refundDate = new Map(
    stornoOrders.map(o => [String(o.id), wcTagDE(o.date_modified || o.date_created)])
  );

  // NB2: Teilerstattungs-Zeilen ("Erstattung #…", "Versanderstattung #…") sind keine Ganz-Stornos - sie sperren die
  // Gegenbuchung nicht, werden aber verrechnet: das Storno negiert Ursprung + schon erstattete Betraege (wie Lizenz,
  // utils/sync-logic.js). Stueckpreise (Festpreis-EK, Handling, Festpreis, Handlingskosten) werden NICHT summiert -
  // die Abrechnung rechnet sie mal Stueckzahl; die Stueckzahl (Summe) traegt den Rest.
  const SUMME_COLS = [5, 8, 9, 10, 11, 12, 13, 19, 20];
  const stornoDone = new Set();
  const teilSumme = new Map();
  for (const r of vRows) {
    const s = String(r[STORNO_COL] ?? '');
    if (s === '') continue;
    if (!istErstattungsZeile(s)) { stornoDone.add(dupKeyOf(r)); continue; }
    const k = dupKeyOf(r);
    const m = teilSumme.get(k) ?? new Map();
    for (const i of SUMME_COLS) if ((r[i] ?? '') !== '') m.set(i, (m.get(i) ?? 0) + toFloat(r[i]));
    teilSumme.set(k, m);
  }
  const rund = x => Math.round((x + Number.EPSILON) * 100) / 100;

  const out = [];
  for (const r of vRows) {
    const oid = String(r[ORD_COL] ?? '');
    if (!refundDate.has(oid)) continue;
    if ((r[STORNO_COL] ?? '') !== '') continue;  // Zeile ist selbst ein Gegeneintrag

    const dupKey = dupKeyOf(r);
    if (stornoDone.has(dupKey)) continue;
    stornoDone.add(dupKey);

    const teil = teilSumme.get(dupKey);
    const counter = [];
    for (let i = 0; i < 23; i++) {
      let v = r[i] ?? '';
      if (NEG_COLS.has(i) && v !== '') {
        const x = teil && SUMME_COLS.includes(i) ? rund(toFloat(v) + (teil.get(i) ?? 0)) : toFloat(v);
        v = x === 0 ? 0 : -x;
      }
      counter[i] = v;
    }
    // Alles schon per Teilerstattung zurueck: keine leere Gegenbuchung.
    if (teil && SUMME_COLS.every(i => counter[i] === '' || counter[i] === 0)) continue;
    counter[DATE_COL]   = refundDate.get(oid) || r[DATE_COL] || deHeuteBerlin();
    // PA8: Storno einer gesperrten Zeile ist ebenfalls gesperrt (leere Betraege bleiben leer, Grund wandert mit).
    const gesperrt = String(r[STATUS_COL] ?? '').trim() === 'gesperrt';
    counter[STATUS_COL] = gesperrt ? 'gesperrt' : 'offen';
    counter[STORNO_COL] = FP_STORNO_MARKER;
    if (gesperrt) counter[23] = r[23] || 'Festpreis-Kategorie fehlt';
    if (String(r[POSITION_INDEX] ?? '').trim()) counter[POSITION_INDEX] = r[POSITION_INDEX];
    out.push(counter);
  }
  return out;
}

// aggregateFpVerkaeufe: utils/fp-abrechnung.js (eine Rechnung fuer Vorschau, Abrechnung, Portal-Saldo).

/**
 * Eine FP_Verkaeufe-Zeile fuer eine Shop-Position und einen FP-Artikel-Eintrag (Positionsformat A..AA).
 * EINE Rechnung fuer den Sync und das Nachtragen (scripts/nachtragen-positionen.js).
 * @returns {{ zeile: any[], katPreis: object|null }}  katPreis null = Festpreis-Kategorie fehlt (Aufrufer sperrt die Zeile)
 */
export function fpVerkaufszeile({ order, item, e, k, zuordnungen }) {
  const orderDate     = wcTagDE(order.date_created);
  const shippingNetto = toFloat(order.shipping_total);
  const orderNetto    = order.line_items.reduce((s, i) => s + toFloat(i.total), 0);
  const itemNetto  = toFloat(item.total);
  const anteil     = orderNetto > 0 ? (itemNetto / orderNetto) : 0;
  const portoEinnahmeAnteil = shippingNetto * anteil;
  const artikelname = item.name || item.sku || String(item.product_id);
  const va = e.versandart;
  // PO1: ab Bestelldatum 01.07.2026 Porto nicht mehr anteilig in der Zeile, sondern je Bestellung (eigene Positionen)
  const po = portoFuerSyncZeile({ bestelldatumDE: orderDate, shippingNetto, versandart: va });
  const portoKostenAnteil  = po ? 0 : (va === 'B' ? k.portoB : k.portoP) * anteil;
  const versandnkAnteil    = po ? 0 : (va === 'B' ? k.versandnebenkostenB : k.versandnebenkostenP) * anteil;
  const portoEinnahmeZeile = po ? 0 : portoEinnahmeAnteil;
  // PayPal berechnet die Gebühr auf den Brutto-Betrag, den der Kunde zahlt.
  const paypalKosten       = (itemNetto * (1 + k.mwstProzent / 100)) * (k.paypalProzent / 100)
                           + (k.paypalPauschale * anteil);

  const artikelkategorie = String(e.artikelkategorie || '').trim();
  // PA8: ohne gueltige Zuordnung NICHT mehr mit 0 rechnen - die Zeile wird unten gesperrt (Betraege leer).
  const katPreis = zuordnungFuer(zuordnungen, e.partnerId, artikelkategorie);
  const festpreis      = katPreis?.festpreis ?? 0;
  const handlingskosten = katPreis?.handlingskosten ?? 0;

  const { netto, brutto } = berechneFestpreisAnteil({
    vkNetto: itemNetto,
    festpreisEK: festpreis,
    handlingskosten,
    stueckzahl: item.quantity || 1,
    mehrkosten: 0,
    portoEinnahmeAnteil: portoEinnahmeZeile,
    portoKostenAnteil,
    versandnkAnteil,
    paypalKosten,
    mwstProzent: k.mwstProzent,
  });

  const zeile = ([
    e.partnerId,           // A 0
    orderDate,             // B 1
    order.id,              // C 2
    artikelname,           // D 3
    item.variation_id || 0, // E 4
    item.quantity,         // F 5
    e.festpreisEK,         // G 6 (legacy, aus FP_Artikel)
    e.handlingGebuehr,     // H 7 (legacy, aus FP_Artikel)
    Math.round(portoEinnahmeZeile * 100) / 100,   // I 8 (PO1: ab 01.07. = 0)
    Math.round(portoKostenAnteil * 100) / 100,    // J 9
    Math.round(versandnkAnteil * 100) / 100,      // K 10
    Math.round(paypalKosten * 100) / 100,         // L 11
    netto,                 // M 12 Gesamt-Partner-Netto
    brutto,                // N 13 Gesamt-Partner-Brutto
    'offen',               // O 14 Status Abrechnung
    item.product_id,       // P 15 Produkt-ID
    '',                    // Q 16 Storno-Status (leer)
    artikelkategorie,      // R 17 Artikelkategorie
    festpreis,             // S 18 Festpreis (aus FP_Artikel_Kategorie)
    0,                     // T 19 Mehrkosten (manuell, default 0)
    Math.round(itemNetto * 100) / 100, // U 20 VK-Netto
    handlingskosten,       // V 21 Handlingskosten (aus FP_Artikel_Kategorie)
    versandmethodeAus(order), // W 22 Versandmethode (VP1, method_id)
  ]);
  if (po) { zeile[PORTO_INDEX] = po.portoBestellung; zeile[PORTO_INDEX + 1] = po.versandart; }   // PO1: Y, Z
  zeile[POSITION_INDEX] = item.id;   // AA: Positions-ID
  return { zeile, katPreis };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${tabName}!A1:ZZ`,   // PPS1: breiter als A1:Z (Token_Hash steht hinten)
  });
  const [header, ...rows] = data.values ?? [];
  pruefePflichtSpalten(tabName, header);   // GT1 B2: fehlende Pflichtspalte = lauter Fehler, nie still 0
  // Echten Sheet-Zeilenindex (_sheetRow) anhängen BEVOR Leerzeilen gefiltert werden,
  // damit Status-Updates die korrekte Zeile treffen (sonst verschiebt jede Leerzeile alles).
  rows.forEach((r, i) => { r._sheetRow = i + 2; });
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseDeZahl(val.toString());
  return Number.isNaN(n) ? fallback : n;
}

function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [dd, mm, yyyy] = str.split('.');
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function rowToObj(header, row) {
  const obj = {};
  header.forEach((h, i) => { obj[h] = row[i] ?? ''; });
  return obj;
}

// Lädt offene interne Bestellungen eines FP-Partners im Zeitraum (Status 'offen',
// Datum in [von, bis]). Liefert die Positionen inkl. echtem Sheet-Zeilenindex
// (rowIndex) und den Spaltenbuchstaben der Status-Spalte für spätere Updates.
// Einzelpreise/Summen sind BRUTTO (siehe Erfassungs-Modal "Einzelpreis brutto").
async function loadOffeneInterne(sheets, sheetId, partnerId, von, bis) {
  const { header, rows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
  const h = col => header.indexOf(col);
  const positionen = rows
    .filter(r => {
      if ((r[h('Partner-ID')] ?? '') !== partnerId) return false;
      if ((r[h('Status')] ?? '') !== 'offen') return false;
      const d = parseDate(r[h('Datum')] ?? '');
      if (!d) return false;
      if (von && d < von) return false;
      if (bis && d > bis) return false;
      return true;
    })
    .map(r => ({
      rowIndex:    r._sheetRow,
      datum:       r[h('Datum')]       ?? '',
      bezeichnung: r[h('Bezeichnung')] ?? '',
      anzahl:      toFloat(r[h('Anzahl')]),
      einzelpreis: toFloat(r[h('Einzelpreis')]),
      summe:       toFloat(r[h('Summe')]),
      ohneSumme:   leerZelle(r[h('Summe')]),   // leer = Preis fehlt (0 = bewusst)
    }));
  const summe = Math.round(positionen.reduce((s, p) => s + p.summe, 0) * 100) / 100;
  const statusCol = h('Status') !== -1 ? String.fromCharCode(65 + h('Status')) : null;
  return { positionen, summe, statusCol };
}

// Verpackungspauschale (VP1) für die Zeilen einer Abrechnung: Kondition aus
// FP_Partner, Bestelldatum/Versandmethode der Stornos aus allen Partner-Zeilen.
async function ladeVerpackung(sheets, sheetId, partnerId, zeilen, alleZeilen, vh) {
  const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
  const row = rows.find(r => (r[header.indexOf('Partner-ID')] ?? '') === partnerId);
  const kondition = verpackungsKondition(row ? rowToObj(header, row) : {});
  const partnerZeilen = alleZeilen.filter(r => (r[vh('Partner-ID')] ?? '') === partnerId);
  return berechneVerpackung(zeilen, vh, kondition, partnerZeilen);
}

// PO1: Porto je Bestellung als eigene Positionen - DIESELBE Funktion fuer Vorschau, Abrechnung und Portal-Saldo.
async function ladePorto(sheets, sheetId, partnerId, zeilen, alleZeilen, vh) {
  const { header: kH, rows: kRows } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
  return berechnePorto(zeilen, vh, satzAus(parseKonfiguration, kRows, kH), alleZeilen, { partnerId });   // alle Zeilen: Traeger bei 2 Partnern
}
// Erst klaeren, dann abrechnen: offene Punkte (Porto, Verpackung, Eigenauftraege ohne Preis, MwSt) - Vorschau und Erstellen.
async function fpKlaeren(sheets, sheetId, partnerId, { porto, verpackung, interne, konfiguration }) {
  const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
  const row = rows.find(r => (r[header.indexOf('Partner-ID')] ?? '') === partnerId);
  const honk = String(row?.[header.indexOf('Shop')] ?? '').trim().toLowerCase() === 'honk';
  return abrechnungKlaeren({
    porto, verpackung,
    interneOhneSumme: (interne?.positionen ?? []).filter(p => p.ohneSumme),
    fixkostenFehlen: (konfiguration.fehlend ?? []).filter(p => p === 'MwSt'),
    bestellLink: id => adminBestellLink(honk ? process.env.WC_URL_HONK : process.env.WC_URL, id),
  });
}

/** PO1: Netto-Saldo der Porto-Positionen (0 ohne neue Bestellungen). */
const portoSaldo = p => (p && p.status !== 'keine' ? p.saldo : 0);

// ── GET /api/festpreis/partner ───────────────────────────────────────────────
router.get('/partner', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    // PPS1: nie den Hash, Klartext nur im Uebergang (fuer "Link kopieren"); _zugang = 'hash' | 'klartext' | ''.
    const partner = rows.map(r => {
      const o = rowToObj(header, r);
      delete o[SPALTE_HASH];
      delete o[SPALTE_VERSCHLUESSELT];   // LK1: nie an den Browser, auch nicht verschluesselt
      o[SPALTE_TOKEN] = klartextFuerMc(header, r);
      o._zugang = zugangArt(header, r);
      o._kopierbar = partnerKopierbar(header, r);
      return o;
    });
    res.json({ partner });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/partner ──────────────────────────────────────────────
router.post('/partner', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { name, shop, aktiv = 'Ja', notiz = '' } = req.body;
    if (!name) return res.status(400).json({ error: 'name ist erforderlich.' });
    const cleanShop = (shop ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);

    const maxId = rows.reduce((max, r) => {
      const m = String(r[0] ?? '').match(/^FP-?(\d+)$/i);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const partnerId = `FP-${String(maxId + 1).padStart(3, '0')}`;

    const kategorien = Array.isArray(req.body.kategorien)
      ? req.body.kategorien.join(',')
      : (req.body.kategorien ?? '');

    // Zeilenarray anhand der tatsächlichen Sheet-Header aufbauen (reihenfolge-sicher)
    const h = col => header.indexOf(col);
    const row = new Array(header.length).fill('');
    if (h('Partner-ID')  !== -1) row[h('Partner-ID')]  = partnerId;
    if (h('Name')        !== -1) row[h('Name')]        = name;
    if (h('Shop')        !== -1) row[h('Shop')]        = cleanShop;
    if (h('Aktiv')       !== -1) row[h('Aktiv')]       = aktiv;
    if (h('Notiz')       !== -1) row[h('Notiz')]       = notiz;
    if (h('Kategorien')  !== -1) row[h('Kategorien')]  = kategorien;

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAB_FP_PARTNER}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    res.status(201).json({ partnerId, name, shop: cleanShop });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/partner/:partnerId/link-neu (PPS1) ───────────────────
// Neuer Portal-Link: alter Link sofort ungueltig, der neue kommt genau einmal in der Antwort.
router.post('/partner/:partnerId/link-neu', async (req, res, next) => {
  try {
    res.json(await erzeugeNeuenPartnerLink({ art: 'festpreis', partnerId: req.params.partnerId }));
  } catch (err) {
    if (err.code && err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

// ── GET /api/festpreis/partner/:partnerId/link (LK1) ─────────────────────────
// "Link kopieren": entschluesselt serverseitig, Link nur in dieser Antwort (no-store), nie im Log.
router.get('/partner/:partnerId/link', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await zeigePartnerLink({ art: 'festpreis', partnerId: req.params.partnerId }));
  } catch (err) {
    if (err.code && err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

// ── PATCH /api/festpreis/partner/:partnerId ───────────────────────────────────
// Aktiv und Kategorien (PPS1: der Token nicht mehr - dafuer POST .../link-neu)
router.patch('/partner/:partnerId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    // PPS1: Tokens erzeugt nur noch das Backend (POST .../link-neu), nie aus dem Browser.
    if (req.body.token !== undefined)
      return res.status(400).json({ error: 'Token wird nicht mehr gesendet – bitte „Link erzeugen“ nutzen.', code: 'token_vom_browser' });
    const { aktiv, kategorien } = req.body;

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const pidIdx   = header.indexOf('Partner-ID');
    const aktivIdx = header.indexOf('Aktiv');
    const katIdx   = header.indexOf('Kategorien');

    const rowIdx = rows.findIndex(r => (r[pidIdx] ?? '') === req.params.partnerId);
    if (rowIdx === -1) return res.status(404).json({ error: 'Partner nicht gefunden.' });

    const sheetRow = rows[rowIdx]._sheetRow;
    const colLetter = i => String.fromCharCode(65 + i);
    const updates = [];
    if (aktiv !== undefined && aktivIdx !== -1)
      updates.push({ range: `${TAB_FP_PARTNER}!${colLetter(aktivIdx)}${sheetRow}`, values: [[aktiv]] });
    if (kategorien !== undefined && katIdx !== -1) {
      const katStr = Array.isArray(kategorien) ? kategorien.join(',') : String(kategorien ?? '');
      updates.push({ range: `${TAB_FP_PARTNER}!${colLetter(katIdx)}${sheetRow}`, values: [[katStr]] });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/artikel/:partnerId/pruefung (PA7) ─────────────────────
// Nur lesen: veroeffentlichte Shop-Artikel der Partner-Kategorien ohne FP_Artikel-Zeile, Zeilen ohne
// Festpreis-Kategorie, Kategorien nicht im Shop. Schreibt nichts, keine Preise.
router.get('/artikel/:partnerId/pruefung', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const r = await fpArtikelPruefung({ sheets: await getSheets(), sheetId, nurPartner: req.params.partnerId });
    if (!r.partner.length) return res.status(404).json({ error: 'FP-Partner nicht gefunden oder nicht aktiv.' });
    res.json(r.partner[0]);
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/artikel/:partnerId ────────────────────────────────────
router.get('/artikel/:partnerId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidCol = header.indexOf('Partner-ID');
    const filtered = rows
      .filter(r => (r[pidCol] ?? '') === req.params.partnerId)
      .map(r => rowToObj(header, r));
    res.json({ artikel: filtered });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/artikel/:partnerId/:produktId ───────────────────────
// Body: { festpreisEK, handlingGebuehr, versandart }
router.patch('/artikel/:partnerId/:produktId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, produktId } = req.params;
    const { festpreisEK, handlingGebuehr, versandart, artikelkategorie } = req.body;

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidIdx  = header.indexOf('Partner-ID');
    const prodIdx = header.indexOf('Produkt-ID');
    const ekIdx   = header.indexOf('Festpreis-EK-Netto');
    const hgIdx   = header.indexOf('Handling-Gebühr');
    const vaIdx   = header.indexOf('Versandart');
    const akIdx   = header.indexOf('Artikelkategorie');

    const rowIdx = rows.findIndex(r =>
      (r[pidIdx] ?? '') === partnerId && String(r[prodIdx] ?? '') === String(produktId)
    );
    if (rowIdx === -1) return res.status(404).json({ error: 'Artikel nicht gefunden.' });

    const sheetRow = rows[rowIdx]._sheetRow;
    const updates = [];
    const colLetter = i => String.fromCharCode(65 + i);
    if (ekIdx !== -1 && festpreisEK !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(ekIdx)}${sheetRow}`, values: [[Number(festpreisEK)]] });
    if (hgIdx !== -1 && handlingGebuehr !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(hgIdx)}${sheetRow}`, values: [[Number(handlingGebuehr)]] });
    if (vaIdx !== -1 && versandart !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(vaIdx)}${sheetRow}`, values: [[String(versandart).toUpperCase() === 'B' ? 'B' : 'P']] });
    if (akIdx !== -1 && artikelkategorie !== undefined) updates.push({ range: `${TAB_FP_ARTIKEL}!${colLetter(akIdx)}${sheetRow}`, values: [[String(artikelkategorie)]] });

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/artikel/:partnerId/import ────────────────────────────
// Liest Shop + Kategorien aus FP_Partner. Unterkategorien werden automatisch
// eingeschlossen. Body-Parameter werden nur als Fallback akzeptiert.
router.post('/artikel/:partnerId/import', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId } = req.params;

    const sheets = await getSheets();

    // Partner-Daten lesen (Shop + Kategorien)
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const ph = col => pH.indexOf(col);
    const partnerRow = pRows.find(r => (r[ph('Partner-ID')] ?? '') === partnerId);
    if (!partnerRow) return res.status(404).json({ error: 'FP-Partner nicht gefunden.' });

    const shop = (partnerRow[ph('Shop')] ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';
    const kategorienRaw = partnerRow[ph('Kategorien')] ?? req.body.kategorien ?? '';
    const kategorienIds = String(kategorienRaw).split(',').map(s => s.trim()).filter(Boolean);

    // Vorhandene Produkt-IDs dieses Partners ermitteln (Dedup)
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const pidCol    = aH.indexOf('Partner-ID');
    const prodIdCol = aH.indexOf('Produkt-ID');
    const existingIds = new Set(
      aRows.filter(r => (r[pidCol] ?? '') === partnerId).map(r => String(r[prodIdCol] ?? ''))
    );

    const wc = getWcClient(shop);

    // Ziel-Kategorie-IDs bestimmen (inkl. Unterkategorien)
    let targetCatIds = [];
    if (kategorienIds.length > 0) {
      const allCats = [];
      for (let page = 1; ; page++) {
        seitenGrenze(page, { wc, pfad: 'products/categories' });
        const data = seitenListe((await wc.get('products/categories', { per_page: 100, page })).data, { wc, pfad: 'products/categories' });
        allCats.push(...data);
        if (data.length < 100) break;
      }
      // parent → [child-IDs]
      const children = {};
      for (const c of allCats) {
        if (c.parent) {
          if (!children[c.parent]) children[c.parent] = [];
          children[c.parent].push(c.id);
        }
      }
      // Rekursiv alle Nachfahren sammeln
      const expand = id => {
        const num = Number(id);
        const result = [num];
        for (const child of (children[num] ?? [])) result.push(...expand(child));
        return result;
      };
      const expanded = new Set();
      for (const id of kategorienIds) expand(id).forEach(i => expanded.add(i));
      targetCatIds = [...expanded];
    }

    // WC-Produkte laden
    const allProducts = [];
    const seenIds = new Set();
    if (targetCatIds.length > 0) {
      for (const catId of targetCatIds) {
        for (let page = 1; ; page++) {
          seitenGrenze(page, { wc, pfad: 'products' });
          const data = seitenListe((await wc.get('products', { status: 'any', per_page: 100, page, category: catId })).data, { wc, pfad: 'products' });
          for (const p of data) {
            if (!seenIds.has(p.id)) { seenIds.add(p.id); allProducts.push(p); }
          }
          if (data.length < 100) break;
        }
      }
    } else {
      for (let page = 1; ; page++) {
        seitenGrenze(page, { wc, pfad: 'products' });
        const data = seitenListe((await wc.get('products', { status: 'any', per_page: 100, page })).data, { wc, pfad: 'products' });
        allProducts.push(...data);
        if (data.length < 100) break;
      }
    }

    const toWrite = allProducts
      .filter(p => !existingIds.has(String(p.id)))
      .map(p => [
        partnerId,
        String(p.id),
        p.name || '',
        0,   // Festpreis-EK-Netto
        0,   // Handling-Gebühr
        'P', // Versandart
        (p.categories?.[0]?.name) || '',
        '',  // Artikelkategorie
      ]);

    if (toWrite.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB_FP_ARTIKEL}!A:H`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: toWrite },
      });
    }

    res.json({ imported: toWrite.length, total: allProducts.length, kategorien: targetCatIds });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/artikel-kategorien ────────────────────────────────────
// Liefert alle Werte aus Spalte 'Kategorie' im Tab FP_Artikel_Kategorie.
router.get('/artikel-kategorien', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'FP_Artikel_Kategorie');
    const katIdx = header.indexOf('Kategorie');
    if (katIdx === -1) return res.json({ kategorien: [] });
    const kategorien = rows.map(r => r[katIdx] ?? '').filter(Boolean);
    res.json({ kategorien });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/verkaeufe ─────────────────────────────────────────────
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, status } = req.query;
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const pidIdx    = header.indexOf('Partner-ID');
    const statusIdx = header.indexOf('Status Abrechnung');
    let filtered = rows;
    if (partnerId) filtered = filtered.filter(r => (r[pidIdx] ?? '') === partnerId);
    if (status)    filtered = filtered.filter(r => (r[statusIdx] ?? '').toLowerCase() === status.toLowerCase());
    res.json({ verkaeufe: filtered.map(r => ({ ...rowToObj(header, r), _rowId: r._sheetRow })) });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/verkaeufe/summary ─────────────────────────────────────
// Aggregiert FP_Verkäufe pro Produkt-ID. Parameter: partnerId, vonDatum,
// bisDatum (beide DD.MM.YYYY, optional), status (default: offen).
router.get('/verkaeufe/summary', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, vonDatum, bisDatum } = req.query;
    const statusFilter = req.query.status ?? 'offen';

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const vh = col => header.indexOf(col);

    const von = vonDatum ? parseDate(vonDatum) : null;
    const bis = bisDatum ? parseDate(bisDatum) : null;

    // Dieselbe Auswahl wie POST /abrechnungen und der Portal-Saldo - Storno-Gegenbuchungen gehoeren dazu.
    const filtered = fpAbrechnungsZeilen(rows, vh, { partnerId, von, bis, status: statusFilter, parseDate });

    const { produkteGruppen, summen } = aggregateFpVerkaeufe(filtered, vh);
    // PA8: gesperrte Zeilen im Zeitraum + Nachzuegler (nur Anzahlen/IDs)
    const sperrHinweise = partnerId ? fpAbrechnungHinweise({ kopf: header, zeilen: rows, partnerId, von, bis, parseDate }) : null;

    // Interne Bestellungen (brutto) im Zeitraum von der Brutto-Auszahlung abziehen.
    const { rows: kRows, header: kH } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
    const konfigHeute = parseKonfiguration(kRows, kH);
    const mwstProzent = konfigHeute.mwstProzent;
    const interne = partnerId ? await loadOffeneInterne(sheets, sheetId, partnerId, von, bis) : { positionen: [], summe: 0 };

    // Verpackungspauschale (brutto) über DIESELBEN Zeilen wie POST /abrechnungen
    // (inkl. Storno-Gegenbuchungen), nur mit Partner.
    const verpackung = partnerId ? await ladeVerpackung(sheets, sheetId, partnerId, filtered, rows, vh) : null;
    const verpackungSumme = verpackung?.status === 'ok' ? verpackung.summe : 0;
    // PO1: Porto je Bestellung (netto) ueber dieselben Zeilen wie die Verpackung
    const porto = partnerId ? await ladePorto(sheets, sheetId, partnerId, filtered, rows, vh) : null;

    // Erst klaeren: dieselbe Pruefung wie beim Erstellen (dort 409).
    const klaeren = partnerId ? await fpKlaeren(sheets, sheetId, partnerId, { porto, verpackung, interne, konfiguration: konfigHeute }) : [];
    // NB2: Erstattungen zu den Bestellungen dieser Zeilen (live aus dem Shop des Partners, dieselbe Rechnung wie der Sync),
    // nicht sperrend; dazu der Porto-Hinweis (Versanderstattung) als Text.
    const hinweise = [];
    if (partnerId && statusFilter === 'offen') {
      const { header: pH, rows: pRows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
      const pRow = pRows.find(r => String(r[pH.indexOf('Partner-ID')] ?? '') === partnerId);
      const shop = String(pRow?.[pH.indexOf('Shop')] ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';
      const konfigFuer = konfigJeTag(d => parseKonfiguration(kRows, kH, d));
      const evh = fpErstattungVh(vh);
      hinweise.push(...await vorschauErstattungsHinweise({
        wc: () => getWcClient(shop), verkaufStati: FP_STATES_VERKAUF,
        orderIds: filtered.filter(r => !istErstattungsZeile(r[vh('Storno-Status')])).map(r => r[vh('WC-Bestellnummer')]),
        orderVon: r => r[evh('WC-Bestellnummer')],
        rechne: bestellungen => buildFpErstattungRows({ vRows: rows, vh: evh, bestellungen, partnerFilter: new Set([partnerId]),
          mwstFuer: o => Number(konfigFuer(bestellTag(o)).mwstProzent), stornoMarker: FP_STORNO_MARKER }),
      }));
    }
    const auszahlungNetto = Math.round((summen.auszahlung + portoSaldo(porto)) * 100) / 100;
    const auszahlungBrutto = Math.round(auszahlungNetto * (1 + mwstProzent / 100) * 100) / 100;
    const gesamtBrutto = Math.round((auszahlungBrutto - interne.summe - verpackungSumme) * 100) / 100;
    const gesamtNetto  = Math.round((gesamtBrutto / (1 + mwstProzent / 100)) * 100) / 100;

    res.json({
      produkteGruppen, summen, positionen: filtered.length,
      mwstProzent,
      intern: interne.positionen,
      interneSumme: interne.summe,
      verpackung,
      ...(porto && porto.status !== 'keine' ? { porto } : {}),   // PO1
      auszahlungNetto, auszahlungBrutto,
      gesamtNetto, gesamtBrutto,
      ...(sperrHinweise ? { sperre: sperrHinweise } : {}),
      klaeren,
      hinweise,   // NB2: Erstattungen (nicht sperrend)
    });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/verkaeufe/sync ───────────────────────────────────────
// PA8: unter der FP-Sperre; erster Schritt = gesperrte Zeilen nachrechnen, deren Artikel jetzt eine Festpreis-Kategorie hat.
// Ohne gueltige Festpreis-Zuordnung wird ein Verkauf "gesperrt" (nicht mehr still Festpreis 0). Schreiben ohne append.
router.post('/verkaeufe/sync', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const ergebnis = await mitFpSperre(() => fpSyncInSperre(req, sheetId));
    if (ergebnis?.status) return res.status(ergebnis.status).json(ergebnis.body);
    res.json(ergebnis);
  } catch (err) {
    if (err.code === 'laeuft_gerade') return res.status(409).json({ error: err.message, code: err.code });
    next(err);
  }
});

/**
 * NB2: Spaltenindex fuer die Erstattung - Porto_Bestellung und Positions-ID stehen positionsfest (Y, AA), auch wenn
 * die Kopfzelle erst beim Schreiben dieses Laufs angelegt wird.
 */
const fpErstattungVh = vh => c => (vh(c) !== -1 ? vh(c) : ({ [PORTO_BESTELLUNG]: PORTO_INDEX, [SPALTE_POSITION]: POSITION_INDEX }[c] ?? -1));

/** NB2: Erstattungen des FP-Syncs, je Shop (Abruf wie der Lizenz-Sync, Rechnung buildFpErstattungRows). */
async function fpErstattungen({ vRows, vh, shops, partnerShopMap, ordersByShop, konfigFuer, laden = ladeErstattungsBestellungen, wcFuer = getWcClient }) {
  const evh = fpErstattungVh(vh);
  const rows = [], hinweise = [];
  for (const shop of shops) {
    const partner = new Set(Object.entries(partnerShopMap).filter(([, s]) => s === shop).map(([p]) => p));
    const eigene = vRows.filter(r => partner.has(String(r[evh('Partner-ID')] ?? '')));
    if (!eigene.length) continue;
    const mitZeilen = new Set(eigene.map(r => String(r[evh('WC-Bestellnummer')] ?? '')));
    const bestellungen = await laden(wcFuer(shop), ordersByShop[shop] ?? [], mitZeilen, FP_STATES_VERKAUF);
    const erg = buildFpErstattungRows({ vRows, vh: evh, bestellungen, partnerFilter: partner,
      mwstFuer: o => Number(konfigFuer(bestellTag(o)).mwstProzent), stornoMarker: FP_STORNO_MARKER });
    rows.push(...erg.rows); hinweise.push(...erg.hinweise);
  }
  return { rows, hinweise };
}

async function fpSyncInSperre(req, sheetId) {
  {
    const { after } = req.body ?? {};

    const sheets = await getSheets();
    const nach = await nachrechnenInSperre({ sheets, spreadsheetId: sheetId });   // PA8

    // 1. Alle aktiven FP-Partner laden
    const { header: pH, rows: pRows } = await readTab(sheets, sheetId, TAB_FP_PARTNER);
    const ph = col => pH.indexOf(col);
    const activePartners = pRows.filter(r =>
      (r[ph('Aktiv')] ?? '').toLowerCase() === 'ja'
    );
    if (!activePartners.length)
      return { synced: 0, orders: 0, nachgerechnet: nach.nachgerechnet, message: 'Keine aktiven FP-Partner gefunden.' };

    // 2. FP_Artikel → Map: produktId → [{ partnerId, festpreisEK, handlingGebuehr, versandart, artikelkategorie }]
    const { header: aH, rows: aRows } = await readTab(sheets, sheetId, TAB_FP_ARTIKEL);
    const ah = col => aH.indexOf(col);
    const activePartnerIds = new Set(activePartners.map(r => r[ph('Partner-ID')] ?? ''));

    const artikelMap = {};
    for (const r of aRows) {
      const pid = r[ah('Partner-ID')] ?? '';
      if (!activePartnerIds.has(pid)) continue;
      const produktId = String(r[ah('Produkt-ID')] ?? '').trim();
      if (!produktId) continue;
      if (!artikelMap[produktId]) artikelMap[produktId] = [];
      artikelMap[produktId].push({
        partnerId:       pid,
        festpreisEK:     toFloat(r[ah('Festpreis-EK-Netto')]),
        handlingGebuehr: toFloat(r[ah('Handling-Gebühr')]),
        versandart:      ((r[ah('Versandart')] ?? 'P').toUpperCase() === 'B') ? 'B' : 'P',
        artikelkategorie: r[ah('Artikelkategorie')] ?? '',
      });
    }
    if (!Object.keys(artikelMap).length)
      return { synced: 0, orders: 0, nachgerechnet: nach.nachgerechnet, message: 'Keine FP-Artikel konfiguriert.' };

    // 2b. FP_Artikel_Kategorie → Map: `${partnerId}|${kategorie}` → festpreis
    const { header: akH, rows: akRows } = await readTab(sheets, sheetId, 'FP_Artikel_Kategorie');
    const akh = col => akH.indexOf(col);
    // PA8: Festpreis 0 in FP_Artikel_Kategorie = bewusst gesetzt (gueltig); KEINE Zeile / leere Kategorie = gesperrt.
    const zuordnungen = festpreisZuordnungen(akH, akRows);

    // 3. Partner-Shop-Map für WC-Credentials
    const partnerShopMap = {};
    for (const r of activePartners) {
      const pid  = r[ph('Partner-ID')] ?? '';
      const shop = (r[ph('Shop')] ?? '').toLowerCase() === 'honk' ? 'honk' : 'jfn';
      partnerShopMap[pid] = shop;
    }

    // 4. Kalkulation_Fixkosten für Porto + PayPal-Kosten
    const { header: kH, rows: kRows } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
    const konfigFuer = konfigJeTag(d => parseKonfiguration(kRows, kH, d));   // Kostensatz zum Bestelldatum

    // 5. FP_Verkäufe → Duplikat-Set + neuestes Datum
    const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const vh = col => vH.indexOf(col);
    const bestand = verkaufsBestand(vRows, vh, { bestellung: 'WC-Bestellnummer', artikel: 'Artikelname' });

    // Ab neuestem Bestelldatum minus 14 Tage: spaet bezahlte Bestellungen kommen noch dazu.
    const afterParam = after || syncStart(vRows, vh('Datum'), parseDate);

    // 6. WC Bestellungen laden (jfn + ggf. honk separat)
    // Stornos voll-historisch ohne after-Filter – fängt auch ältere Refunds.
    const shopsNeeded = new Set(Object.values(partnerShopMap));
    const ordersByShop = {};
    const stornoByShop = {};
    for (const shop of shopsNeeded) {
      const wc = getWcClient(shop);
      ordersByShop[shop] = await fetchFpOrders(wc, FP_STATES_VERKAUF, afterParam);
      stornoByShop[shop] = await fetchFpOrders(wc, FP_STATES_STORNO, null);
    }

    // Fehlt zum Bestelldatum eine Fixkosten-Position: nichts schreiben (nicht mit 0 rechnen).
    const luecken = fixkostenLuecken(Object.values(ordersByShop).flat().map(bestellTag), konfigFuer);
    if (luecken.length) throw fixkostenFehler(luecken);

    // 7. Zeilen berechnen
    const toWrite = [];
    let gesperrt = 0;
    // PA7: nicht mehr still - uebersprungene Positionen (Produkt-ID nicht in FP_Artikel) und Zeilen ohne
    // Festpreis-Kategorie werden gesammelt und in der Antwort gemeldet. Am Rechnen und Schreiben aendert sich nichts.
    const uebersprungen = {};
    const ohneFestpreis = [];

    for (const [shop, orders] of Object.entries(ordersByShop)) {
      for (const order of orders) {
        const k = konfigFuer(bestellTag(order));   // Kostensatz zum Bestelldatum

        for (const item of order.line_items) {
          const entries = artikelMap[String(item.product_id || '')];
          if (!entries) {
            (uebersprungen[shop] ??= []).push({ produktId: String(item.product_id || ''), bestellung: order.id, datum: String(order.date_created ?? '').slice(0, 10) });
            continue;
          }

          const artikelname = item.name || item.sku || String(item.product_id);
          const variationId = String(item.variation_id || 0);

          for (const e of entries) {
            if (partnerShopMap[e.partnerId] !== shop) continue;
            if (schonErfasst(bestand, { orderId: order.id, positionId: item.id, artikel: artikelname, variante: variationId, partnerId: e.partnerId })) continue;

            const { zeile, katPreis } = fpVerkaufszeile({ order, item, e, k, zuordnungen });
            if (!katPreis) ohneFestpreis.push({ partnerId: e.partnerId, produktId: String(item.product_id), bestellung: String(order.id) });
            if (katPreis) toWrite.push(zeile);
            else { toWrite.push(sperreZeile(zeile, vH)); gesperrt++; }   // PA8
          }
        }
      }
    }

    // Storno-Gegeneinträge: alle Shops zusammenführen, dann gegen vRows prüfen
    const allStornoOrders = Object.values(stornoByShop).flat();
    const stornoRows = buildFpStornoRows(vRows, allStornoOrders);

    // NB2: Teilerstattungen (Position anteilig, Versand mindert die Porto-Einnahme) - je Shop nur mit dessen Partnern,
    // weil Bestellnummern von JFN und HONK gleich sein koennen und FP_Verkaeufe keine Shop-Spalte hat.
    const erst = await fpErstattungen({ vRows: [...vRows, ...toWrite], vh, shops: shopsNeeded, partnerShopMap, ordersByShop, konfigFuer });

    const allRows = [...toWrite, ...stornoRows, ...erst.rows];
    if (allRows.length > 0) {
      // Spalte W "Versandmethode" (VP1): additiv, beim ersten Schreiben anlegen. Der
      // Sync schreibt positionsfest A:W - steht sie woanders, nichts schreiben.
      if (vh(VERSANDMETHODE) === -1) {
        if (vH.length !== 22)
          return { status: 409, body: { error: `FP_Verkäufe: ${vH.length} Spalten statt 22, ${VERSANDMETHODE} nicht angelegt, nichts geschrieben.` } };
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId, range: `${TAB_FP_VERKAEUFE}!W1`,
          valueInputOption: 'RAW', requestBody: { values: [[VERSANDMETHODE]] },
        });
        vH[22] = VERSANDMETHODE;
      } else if (vh(VERSANDMETHODE) !== 22) {
        return { status: 409, body: { error: `FP_Verkäufe: ${VERSANDMETHODE} steht nicht in Spalte W, nichts geschrieben.` } };
      }
      // PA8: Spalte X "Sperre" additiv direkt hinter W, nur wenn eine Zeile gesperrt ist (oder die Spalte schon da ist).
      const brauchtSperre = allRows.some(r => r[STATUS_SPALTE_INDEX] === STATUS_GESPERRT);
      if (vh(SPALTE_SPERRE) === -1 && brauchtSperre) {
        if (vH.length !== SYNC_BREITE)
          return { status: 409, body: { error: `FP_Verkäufe: ${vH.length} Spalten statt ${SYNC_BREITE}, ${SPALTE_SPERRE} nicht angelegt, nichts geschrieben.` } };
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId, range: `${TAB_FP_VERKAEUFE}!X1`,
          valueInputOption: 'RAW', requestBody: { values: [[SPALTE_SPERRE]] },
        });
        vH[SPERRE_INDEX] = SPALTE_SPERRE;
      } else if (vh(SPALTE_SPERRE) !== -1 && vh(SPALTE_SPERRE) !== SPERRE_INDEX) {
        return { status: 409, body: { error: `FP_Verkäufe: ${SPALTE_SPERRE} steht nicht in Spalte X, nichts geschrieben.` } };
      }
      // PO1: Spalten Y "Porto_Bestellung" + Z "Porto_Versandart" additiv hinter X; X wird dafuer (nur Kopf) angelegt.
      const brauchtPorto = allRows.some(r => r[PORTO_INDEX] !== undefined && r[PORTO_INDEX] !== '');
      if (vh(PORTO_BESTELLUNG) === -1 && brauchtPorto) {
        if (vh(SPALTE_SPERRE) === -1) {
          if (vH.length !== SYNC_BREITE)
            return { status: 409, body: { error: `FP_Verkäufe: ${vH.length} Spalten statt ${SYNC_BREITE}, Porto-Spalten nicht angelegt, nichts geschrieben.` } };
          vH[SPERRE_INDEX] = SPALTE_SPERRE;
        }
        if (vH.length !== SYNC_BREITE + 1)
          return { status: 409, body: { error: `FP_Verkäufe: ${vH.length} Spalten statt ${SYNC_BREITE + 1}, Porto-Spalten nicht angelegt, nichts geschrieben.` } };
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId, range: `${TAB_FP_VERKAEUFE}!X1:Z1`,
          valueInputOption: 'RAW', requestBody: { values: [[SPALTE_SPERRE, PORTO_BESTELLUNG, PORTO_VERSANDART]] },
        });
        vH[PORTO_INDEX] = PORTO_BESTELLUNG; vH[PORTO_INDEX + 1] = PORTO_VERSANDART;
      } else if (vh(PORTO_BESTELLUNG) !== -1 && (vh(PORTO_BESTELLUNG) !== PORTO_INDEX || vh(PORTO_VERSANDART) !== PORTO_INDEX + 1)) {
        return { status: 409, body: { error: `FP_Verkäufe: Porto-Spalten stehen nicht in Y/Z, nichts geschrieben.` } };
      }
      // Spalte AA "Positions-ID": additiv hinter Z; fehlende Kopfzellen X–Z werden dafuer (nur Kopf) mit angelegt.
      if (vh(SPALTE_POSITION) === -1) {
        const kopf = [SPALTE_SPERRE, PORTO_BESTELLUNG, PORTO_VERSANDART, SPALTE_POSITION];
        if (vH.length < SYNC_BREITE || vH.length > POSITION_INDEX
          || kopf.slice(0, vH.length - SYNC_BREITE).some((n, i) => vH[SYNC_BREITE + i] !== n))
          return { status: 409, body: { error: `FP_Verkäufe: ${vH.length} Spalten, ${SPALTE_POSITION} nicht angelegt, nichts geschrieben.` } };
        const fehlt = kopf.slice(vH.length - SYNC_BREITE);
        await sichereSpaltenRaster(sheets, sheetId, TAB_FP_VERKAEUFE, POSITION_INDEX + 1);   // Raster bis AA
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId, range: `${TAB_FP_VERKAEUFE}!${spalteBuchstabe(vH.length)}1:AA1`,
          valueInputOption: 'RAW', requestBody: { values: [fehlt] },
        });
        vH.push(...fehlt);
      } else if (vh(SPALTE_POSITION) !== POSITION_INDEX) {
        return { status: 409, body: { error: `FP_Verkäufe: ${SPALTE_POSITION} steht nicht in Spalte AA, nichts geschrieben.` } };
      }
      const breite = POSITION_INDEX + 1;
      const zeilen = allRows.map(r => Array.from({ length: breite }, (_, i) => r[i] ?? ''));
      // PA8: ohne values.append - erste freie Zeile, Nachbarzeile + Zielbereich geprueft, RAW, zurueckgelesen.
      await schreibeNeueZeilen(sheets, sheetId, TAB_FP_VERKAEUFE, zeilen);
    }

    const totalOrders = Object.values(ordersByShop).reduce((s, o) => s + o.length, 0);
    // PA7: uebersprungene Positionen, deren Produkt in den Kategorien eines aktiven FP-Partners liegt = nicht abgerechnet.
    // Nach dem Schreiben (aendert nichts am Sync); ein Fehler hier steht in der Antwort, der Sync ist trotzdem gelaufen.
    let ohneEintrag = [], pruefungFehler = null;
    try {
      for (const [shop, liste] of Object.entries(uebersprungen)) {
        const partnerShop = activePartners.filter(r => partnerShopMap[r[ph('Partner-ID')] ?? ''] === shop)
          .map(r => ({ id: r[ph('Partner-ID')] ?? '', kategorien: ph('Kategorien') >= 0 ? (r[ph('Kategorien')] ?? '') : '' }));
        ohneEintrag.push(...await fpUebersprungenePruefen({ wc: getWcClient(shop), uebersprungen: liste, partner: partnerShop }));
      }
    } catch (err) { pruefungFehler = err.message; }
    return {
      ohneEintrag, ...(pruefungFehler ? { pruefungFehler } : {}),
      ohneFestpreis: ohneFestpreis.slice(0, 50), ohneFestpreisAnzahl: ohneFestpreis.length,
      synced:    toWrite.length,
      gesperrt,                                   // PA8: davon gesperrt (Festpreis-Kategorie fehlt)
      nachgerechnet: nach.nachgerechnet, nochGesperrt: nach.nochGesperrt + gesperrt,
      storniert: stornoRows.length,
      erstattet: erst.rows.length,                              // NB2
      erstattungHinweise: erst.hinweise.map(erstattungHinweisText),
      orders:    totalOrders,
      afterParam: afterParam || null,
      message: toWrite.length || stornoRows.length
        ? `${[toWrite.length && `${toWrite.length} neue`, stornoRows.length && `${stornoRows.length} stornierte`].filter(Boolean).join(' + ')} Einträge synchronisiert.`
        : 'Alle Einträge bereits vorhanden – nichts Neues.',
    };
  }
}

// ── POST /api/festpreis/verkaeufe/nachrechnen (PA8) ──────────────────────────
// Knopf "gesperrte nachrechnen": gesperrte Zeilen, deren Artikel jetzt eine Festpreis-Kategorie hat -> offen mit dem dann
// gueltigen Festpreis. Body { dryRun }. Nur Anzahlen und Produkt-IDs in der Antwort.
router.post('/verkaeufe/nachrechnen', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    res.json(await fpNachrechnen({ sheets: await getSheets(), spreadsheetId: sheetId, dryRun: req.body?.dryRun === true }));
  } catch (err) {
    if (err.code === 'laeuft_gerade') return res.status(409).json({ error: err.message, code: err.code });
    next(err);
  }
});

// ── GET /api/festpreis/verkaeufe/gesperrt (PA8) ──────────────────────────────
// Anzahl gesperrter Zeilen je Partner + Produkt-IDs (fuer den Hinweis in MC). Keine Betraege.
router.get('/verkaeufe/gesperrt', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { header, rows } = await readTab(await getSheets(), sheetId, TAB_FP_VERKAEUFE);
    res.json({ ...gesperrtZaehlen(header, rows, { partnerId: req.query.partnerId || undefined }), grund: GRUND_KATEGORIE });
  } catch (err) { next(err); }
});

// ── GET /api/festpreis/abrechnungen ──────────────────────────────────────────
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId } = req.query;
    const sheets = await getSheets();
    const { rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
    // Positionsfest gemäß POST-Schreibreihenfolge (A:I) – robust gegen Header-Namen.
    const mapped = rows.map(r => ({
      'Abrechnungs-ID': r[0] ?? '',
      'Partner-ID':     r[1] ?? '',
      'Zeitraum-Von':   r[2] ?? '',
      'Zeitraum-Bis':   r[3] ?? '',
      // Sheet ist deutsch lokalisiert → Geldwerte kommen als "12,34" zurück.
      // Als echte Zahl liefern, sonst ergibt Number("12,34") im Frontend NaN.
      'Gesamt-Netto':   toFloat(r[4]),
      'Gesamt-Brutto':  toFloat(r[5]),
      'Status':         r[6] ?? '',
      'Erstellt-Am':    r[7] ?? '',
      'Positionen':     r[8] ?? '',
    }));
    const filtered = partnerId ? mapped.filter(a => a['Partner-ID'] === partnerId) : mapped;
    res.json({ abrechnungen: filtered });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/abrechnungen ─────────────────────────────────────────
// Body: { partnerId, vonDatum, bisDatum }  (dd.mm.yyyy)
router.post('/abrechnungen', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { partnerId, vonDatum, bisDatum } = req.body ?? {};
    if (!partnerId || !vonDatum || !bisDatum)
      return res.status(400).json({ error: 'partnerId, vonDatum und bisDatum sind erforderlich.' });
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(String(vonDatum)) || !/^\d{2}\.\d{2}\.\d{4}$/.test(String(bisDatum)))
      return res.status(400).json({ error: 'vonDatum und bisDatum im Format TT.MM.JJJJ.' });
    // unter der FP-Sperre (wie Sync/Nachrechnen), alles frisch gelesen, EIN Schreibaufruf.
    const antwort = await mitFpSperre(() => fpAbrechnungErstellen({ sheetId, partnerId, vonDatum, bisDatum }));
    res.status(antwort.status).json(antwort.body);
  } catch (err) { next(err); }
});

async function fpAbrechnungErstellen({ sheetId, partnerId, vonDatum, bisDatum }) {
  const sheets = await getSheets();

  // FP_Verkäufe: offene Einträge des Partners im Zeitraum, inkl. Storno-Gegenbuchungen (dieselbe Auswahl wie die Vorschau)
  const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
  const vh = col => vH.indexOf(col);
  const von = parseDate(vonDatum);
  const bis = parseDate(bisDatum);
  const offene = fpAbrechnungsZeilen(vRows, vh, { partnerId, von, bis, parseDate });   // PA8: gesperrt nie abrechenbar
  const sperre = fpAbrechnungHinweise({ kopf: vH, zeilen: vRows, partnerId, von, bis, parseDate });   // PA8

  if (!offene.length) return { status: 400, body: { error: 'Keine offenen Einträge im angegebenen Zeitraum.' } };
  if (vh('Status Abrechnung') === -1) return { status: 409, body: { error: 'Spalte „Status Abrechnung“ fehlt in FP_Verkäufe.' } };

  const { produkteGruppen, summen } = aggregateFpVerkaeufe(offene, vh);
  const { header: kH, rows: kRows } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
  const konfigHeute = parseKonfiguration(kRows, kH);
  const mwstProzent = konfigHeute.mwstProzent;

  // Verpackungspauschale (VP1) über genau die abzurechnenden Zeilen. Fehlt der
  // Wert oder eine Versandmethode: Abrechnung ohne Pauschale (Inhaber VP1, keine
  // Sperre), aber laut - Antwort und Positionen-JSON tragen status 'fehlt'.
  const verpackung = await ladeVerpackung(sheets, sheetId, partnerId, offene, vRows, vh);
  const verpackungSumme = verpackung.status === 'ok' ? verpackung.summe : 0;
  const porto = await ladePorto(sheets, sheetId, partnerId, offene, vRows, vh);   // PO1: zwei eigene Positionen

  // Offene interne Bestellungen (brutto) im Zeitraum von der Brutto-Auszahlung abziehen.
  const interne = await loadOffeneInterne(sheets, sheetId, partnerId, von, bis);
  // Erst klaeren (Versandart/Porto-Satz, Verpackung, Eigenauftraege ohne Preis, MwSt): sonst nichts anlegen.
  const klaeren = await fpKlaeren(sheets, sheetId, partnerId, { porto, verpackung, interne, konfiguration: konfigHeute });
  if (klaeren.length) return klaerenAntwort(klaeren);
  const auszahlungBrutto = Math.round((summen.auszahlung + portoSaldo(porto)) * (1 + mwstProzent / 100) * 100) / 100;
  const gesamtBrutto = Math.round((auszahlungBrutto - interne.summe - verpackungSumme) * 100) / 100;
  const gesamtNetto  = Math.round((gesamtBrutto / (1 + mwstProzent / 100)) * 100) / 100;
  const positionenJson = JSON.stringify({
    produkteGruppen, summen, intern: interne.positionen.map(({ rowIndex, ohneSumme, ...p }) => p), interneSumme: interne.summe,
    ...(verpackung.status !== 'keine' ? { verpackung } : {}),
    ...(porto.status !== 'keine' ? { porto } : {}),   // PO1
    zeilen: offene.map(r => fpZeilenSchluessel(r, vh)),   // Loeschen setzt genau diese Zeilen zurueck
  });
  if (positionenJson.length > POSITIONEN_MAX_ZEICHEN)
    return { status: 422, body: { error: `Zu viele Positionen für eine Abrechnung (${offene.length}) – Zeitraum kürzer wählen.` } };

  // Abrechnungs-ID unter der Sperre aus dem frisch gelesenen Reiter
  const { data: abData } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${TAB_FP_ABRECHNUNGEN}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const abWerte = abData.values ?? [];
  const maxAbNr = abWerte.slice(1).reduce((max, r) => {
    const m = String(r?.[0] ?? '').match(/^FPA-(\d+)$/i);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const abrechnungsId = `FPA-${String(maxAbNr + 1).padStart(4, '0')}`;
  const erstelltAm = deHeuteBerlin();
  const neueZeile = [abrechnungsId, partnerId, vonDatum, bisDatum, gesamtNetto, gesamtBrutto, 'entwurf', erstelltAm, positionenJson];
  const ziel = await pruefeZielStrecke(sheets, sheetId, TAB_FP_ABRECHNUNGEN, abWerte, [neueZeile]);

  // Status-Zellen der Verkäufe und internen Bestellungen (Zeilen oben frisch gelesen)
  const vStCol = spalteBuchstabe(vh('Status Abrechnung'));
  const data = [
    { range: ziel.range, values: [neueZeile] },
    ...offene.map(r => ({ range: `'${TAB_FP_VERKAEUFE}'!${vStCol}${r._sheetRow}`, values: [['abgerechnet']] })),
    ...(interne.statusCol ? interne.positionen.map(p => ({ range: `'Partner_Interne_Bestellungen'!${interne.statusCol}${p.rowIndex}`, values: [['abgerechnet']] })) : []),
  ];
  // EIN Schreibaufruf: Abrechnung und Markierung gelingen zusammen oder gar nicht.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId, requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  return { status: 201, body: {
    sperre,   // PA8
    abrechnungsId, partnerId, gesamtNetto, gesamtBrutto,
    positionen: offene.length, interne: interne.positionen.length, interneSumme: interne.summe,
    verpackung: verpackung.status !== 'keine' ? verpackung : null,
    porto: porto.status !== 'keine' ? porto : null,   // PO1
  } };
}

// ── PATCH /api/festpreis/abrechnungen/:id/status ─────────────────────────────
// nur vorwaerts entwurf -> freigegeben -> bezahlt (und bezahlt -> freigegeben), nie zurueck auf entwurf.
router.patch('/abrechnungen/:id/status', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { status } = req.body ?? {};
    const ALLOWED = new Set(['entwurf', 'freigegeben', 'bezahlt']);
    if (!status || !ALLOWED.has(status))
      return res.status(400).json({ error: `Ungültiger Status. Erlaubt: ${[...ALLOWED].join(', ')}` });

    const antwort = await mitFpSperre(async () => {
      const sheets = await getSheets();
      const { rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
      // Positionsfest: Abrechnungs-ID = Spalte A (0), Status = Spalte G (Index 6)
      const row = rows.find(r => (r[0] ?? '') === req.params.id);
      if (!row) return { status: 404, body: { error: 'Abrechnung nicht gefunden.' } };
      const bisher = String(row[6] ?? '').trim() || 'entwurf';
      if (!fpStatusWechselErlaubt(bisher, status))
        return { status: 409, body: { error: `Statuswechsel ${bisher} → ${status} ist nicht erlaubt (nur entwurf → freigegeben → bezahlt; zurück nur bezahlt → freigegeben).` } };
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${TAB_FP_ABRECHNUNGEN}!G${row._sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[status]] },
      });
      return { status: 200, body: { ok: true, abrechnungsId: req.params.id, status } };
    });
    res.status(antwort.status).json(antwort.body);
  } catch (err) { next(err); }
});

// ── DELETE /api/festpreis/abrechnungen/:id ───────────────────────────────────
// Löscht einen Entwurf und setzt GENAU seine Verkäufe und internen Bestellungen wieder auf 'offen'
// (Zeilen-Schluessel im Positionen-JSON). Ein Schreibaufruf: Ruecksetzen + Abrechnungszeile leeren.
router.delete('/abrechnungen/:id', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const antwort = await mitFpSperre(() => fpAbrechnungLoeschen({ sheetId, id: req.params.id }));
    res.status(antwort.status).json(antwort.body);
  } catch (err) { next(err); }
});

async function fpAbrechnungLoeschen({ sheetId, id }) {
  const sheets = await getSheets();
  const { header: aH, rows } = await readTab(sheets, sheetId, TAB_FP_ABRECHNUNGEN);
  const abrRow = rows.find(r => (r[0] ?? '') === id); // Spalte A = Abrechnungs-ID
  if (!abrRow) return { status: 404, body: { error: 'Abrechnung nicht gefunden.' } };
  if ((abrRow[6] ?? '').toLowerCase() !== 'entwurf')
    return { status: 400, body: { error: `Nur Entwürfe können gelöscht werden (Status: ${abrRow[6]}).` } };

  const partnerId = abrRow[1] ?? '';
  const von = parseDate(abrRow[2] ?? '');
  const bis = parseDate(abrRow[3] ?? '');
  let positionen = null;
  try { positionen = JSON.parse(abrRow[8] ?? ''); } catch { /* Altbestand ohne JSON */ }
  const andere = rows.filter(r => r !== abrRow && (r[1] ?? '') === partnerId)
    .map(r => ({ von: parseDate(r[2] ?? ''), bis: parseDate(r[3] ?? '') }));

  const { header: vH, rows: vRows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
  const vh = col => vH.indexOf(col);
  const { header: iH, rows: iRows } = await readTab(sheets, sheetId, 'Partner_Interne_Bestellungen');
  const ih = col => iH.indexOf(col);

  const plan = fpLoeschPlan({ positionen, verkaufsZeilen: vRows, internZeilen: iRows, vh, ih, partnerId, von, bis, andere, parseDate });
  if (plan.fehler) return { status: 409, body: { error: plan.fehler } };

  const stCol = spalteBuchstabe(vh('Status Abrechnung'));
  const data = plan.verkaeufe.map(r => ({ range: `'${TAB_FP_VERKAEUFE}'!${stCol}${r._sheetRow}`, values: [['offen']] }));
  if (ih('Status') !== -1) {
    const iStCol = spalteBuchstabe(ih('Status'));
    for (const r of plan.intern) data.push({ range: `'Partner_Interne_Bestellungen'!${iStCol}${r._sheetRow}`, values: [['offen']] });
  }
  // Abrechnungszeile leeren statt Zeile loeschen: bleibt im selben Schreibaufruf (Leerzeilen liest readTab nicht).
  const breite = Math.max(aH.length, 9);
  data.push({ range: `'${TAB_FP_ABRECHNUNGEN}'!A${abrRow._sheetRow}:${spalteBuchstabe(breite - 1)}${abrRow._sheetRow}`, values: [Array(breite).fill('')] });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId, requestBody: { valueInputOption: 'RAW', data },
  });

  const erwartet = Array.isArray(positionen?.zeilen) ? positionen.zeilen.length : null;
  return { status: 200, body: {
    ok: true, abrechnungsId: id, zurueckgesetzt: plan.verkaeufe.length + plan.intern.length,
    ...(erwartet !== null && erwartet !== plan.verkaeufe.length
      ? { hinweis: `${erwartet - plan.verkaeufe.length} Verkauf/Verkäufe der Abrechnung nicht mehr als „abgerechnet“ gefunden.` } : {}),
  } };
}

// ── GET /api/festpreis/preise ─────────────────────────────────────────────────
// Liest FP_Artikel_Kategorie: Kategorie | Festpreispartner-ID | Festpreis
router.get('/preise', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'FP_Artikel_Kategorie');
    res.json({ preise: rows.map(r => ({ ...rowToObj(header, r), _rowId: r._sheetRow })) });
  } catch (err) { next(err); }
});

// ── POST /api/festpreis/preise ────────────────────────────────────────────────
router.post('/preise', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const { kategorie, partnerId, festpreis, handlingskosten } = req.body;
    if (!kategorie || !partnerId) return res.status(400).json({ error: 'kategorie und partnerId sind erforderlich.' });
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'FP_Artikel_Kategorie!A:D',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[kategorie, partnerId, toFloat(festpreis), toFloat(handlingskosten)]] },
    });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/preise/:rowId ───────────────────────────────────────
router.patch('/preise/:rowId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2) return res.status(400).json({ error: 'Ungültige rowId.' });
    const { festpreis, handlingskosten } = req.body;
    const sheets = await getSheets();
    const updates = [];
    if (festpreis      !== undefined) updates.push({ range: `FP_Artikel_Kategorie!C${sheetRow}`, values: [[toFloat(festpreis)]] });
    if (handlingskosten !== undefined) updates.push({ range: `FP_Artikel_Kategorie!D${sheetRow}`, values: [[toFloat(handlingskosten)]] });
    if (!updates.length) return res.status(400).json({ error: 'Kein Feld zum Aktualisieren.' });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/festpreis/preise/:rowId ──────────────────────────────────────
router.delete('/preise/:rowId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2) return res.status(400).json({ error: 'Ungültige rowId.' });
    const sheets = await getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties' });
    const sheetGid = meta.data.sheets.find(s => s.properties.title === 'FP_Artikel_Kategorie')?.properties.sheetId;
    if (sheetGid === undefined) return res.status(404).json({ error: 'Tab nicht gefunden.' });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow } } }] },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/festpreis/verkaeufe-eintrag/:rowId ────────────────────────────
// Aktualisiert Mehrkosten und berechnet Gesamt-Partner-Netto/-Brutto neu,
// damit die Abrechnung (summiert M/N) die Mehrkosten korrekt enthält.
router.patch('/verkaeufe-eintrag/:rowId', async (req, res, next) => {
  try {
    const sheetId = SHEETID();
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID fehlt.' });
    const sheetRow = parseInt(req.params.rowId, 10);
    if (!sheetRow || sheetRow < 2) return res.status(400).json({ error: 'Ungültige rowId.' });
    const { mehrkosten } = req.body;
    if (mehrkosten === undefined) return res.status(400).json({ error: 'mehrkosten fehlt.' });
    const mk = toFloat(mehrkosten);

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, TAB_FP_VERKAEUFE);
    const h = col => header.indexOf(col);
    const row = rows.find(r => r._sheetRow === sheetRow);
    if (!row) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    // PA8: gesperrte Zeile hat keinen Festpreis - Mehrkosten erst nach dem Nachrechnen (sonst rechnet das hier mit 0).
    if (String(row[h('Status Abrechnung')] ?? '').trim() === STATUS_GESPERRT)
      return res.status(409).json({ error: 'Zeile ist gesperrt (Festpreis-Kategorie fehlt) – erst Kategorie setzen und nachrechnen.', code: 'gesperrt' });

    // MwSt aus Fixkosten ziehen (für Brutto)
    const { header: kH, rows: kRows } = await readTab(sheets, sheetId, TAB_FIXKOSTEN);
    const mwstProzent = parseKonfiguration(kRows, kH).mwstProzent;

    // Netto/Brutto neu berechnen aus gespeicherten Komponenten + neuer Mehrkosten
    const { netto, brutto } = berechneFestpreisAnteil({
      vkNetto:            toFloat(row[h('VK-Netto')]),
      festpreisEK:        toFloat(row[h('Festpreis')]),
      handlingskosten:    toFloat(row[h('Handlingskosten')]),
      stueckzahl:         toFloat(row[h('Stückzahl')]) || 1,
      mehrkosten:         mk,
      portoEinnahmeAnteil: toFloat(row[h('Porto-Einnahme')]),
      portoKostenAnteil:  toFloat(row[h('Porto-Kosten')]),
      versandnkAnteil:    toFloat(row[h('Versandnebenkosten')]),
      paypalKosten:       toFloat(row[h('PayPal-Kosten')]),
      mwstProzent,
    });

    const col = i => String.fromCharCode(65 + i);
    const updates = [
      { range: `${TAB_FP_VERKAEUFE}!${col(h('Mehrkosten'))}${sheetRow}`,            values: [[mk]] },
      { range: `${TAB_FP_VERKAEUFE}!${col(h('Gesamt-Partner-Netto'))}${sheetRow}`,  values: [[netto]] },
      { range: `${TAB_FP_VERKAEUFE}!${col(h('Gesamt-Partner-Brutto'))}${sheetRow}`, values: [[brutto]] },
    ].filter(u => !u.range.includes('@')); // safety, falls Header fehlt → -1

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
    res.json({ ok: true, sheetRow, netto, brutto });
  } catch (err) { next(err); }
});

// Für die Partner-Sicht (festpreis-public.js) wiederverwendbar – identische
// Auszahlungs-Aggregation + Interne-Verrechnung wie im Admin.
export { aggregateFpVerkaeufe, loadOffeneInterne, ladeVerpackung, ladePorto, portoSaldo };

export default router;
