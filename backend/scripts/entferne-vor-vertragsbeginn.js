// ════════════════════════════════════════════════════════════════════════════
// EINMAL-SKRIPT – nach erfolgreicher Ausfuehrung wieder entfernen, zusammen mit
//   .github/workflows/entferne-vor-vertragsbeginn.yml
//   backend/tests/entferne-vor-vertragsbeginn.test.js
// ════════════════════════════════════════════════════════════════════════════
//
// Entfernt die Verkaufszeilen eines Partners, deren Bestelldatum vor seinem
// Vertrag-ab liegt. Anlass: der Neu-Sync fuer P-004 holte Bestellungen ab
// 25.11.2022, die Vereinbarung gilt ab 01.01.2025 (48 Zeilen, 192,61 €).
//
// Laeuft ueber GitHub Actions (workflow_dispatch), weil lokal kein Zugriff auf
// das Business-Sheet besteht und die API keine Sheet-Zeilennummern liefert.
//
// Schutzregeln:
//   - Trockenlauf ist Standard. Geloescht wird nur mit --loeschen.
//   - --loeschen verlangt --erwartete-zeilen und --erwartete-summe; beide
//     muessen gegen den frisch gelesenen Stand passen. Sonst Abbruch ohne
//     Schreiben, mit den tatsaechlich gefundenen Werten.
//   - Abgerechnete Zeilen unter der Auswahl → Abbruch.
//   - Eine Gegenbuchung folgt ihrem Verkauf: liegt der Verkauf vor
//     Vertrag-ab, geht sie mit, auch wenn sie selbst danach datiert ist.
//   - Geloescht wird in EINEM batchUpdate, von unten nach oben - so bleiben
//     die Zeilennummern der noch folgenden Requests gueltig.
//
// Verwendung:
//   node backend/scripts/entferne-vor-vertragsbeginn.js --partner=P-004 --shop=honk
//   node backend/scripts/entferne-vor-vertragsbeginn.js --partner=P-004 --shop=honk \
//        --loeschen --erwartete-zeilen=48 --erwartete-summe=192,61

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getShopConfig } from '../lib/shopConfig.js';
import { baueVertragsbeginne } from '../utils/partner-kalkulation.js';
import { verkaufsSpalten, istStornoZeile, parseDatum } from '../utils/abrechnung-zeilen.js';
import { requireHeader } from '../utils/sheet-headers.js';

const round2 = n => Math.round(n * 100) / 100;
const text   = v => String(v ?? '').trim();
// "3,82" und "192.61" → Zahl; mit Komma gilt ein Punkt als Tausendertrenner ("1.234,56").
const betrag = v => {
  const s = text(v);
  if (s === '') return NaN;
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
};
const eur = n => round2(n).toFixed(2).replace('.', ',');

function abbruch(message, details = {}) {
  return Object.assign(new Error(message), { abbruch: true, ...details });
}

// ── Argumente ───────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const wert = name => {
    const a = argv.find(x => x.startsWith(`--${name}=`));
    return a === undefined ? undefined : a.slice(name.length + 3);
  };
  const partnerId = text(wert('partner'));
  const shop      = text(wert('shop') ?? 'jfn').toLowerCase();
  const loeschen  = argv.includes('--loeschen');

  if (!/^P-\d{3,}$/.test(partnerId)) throw abbruch(`--partner fehlt oder ist ungültig: "${partnerId}" (erwartet z.B. P-004).`);
  if (!['jfn', 'honk'].includes(shop)) throw abbruch(`--shop muss jfn oder honk sein, nicht "${shop}".`);

  const zRoh = text(wert('erwartete-zeilen'));
  const sRoh = text(wert('erwartete-summe'));
  const erwarteteZeilen = zRoh === '' ? null : Number(zRoh);
  const erwarteteSumme  = sRoh === '' ? null : betrag(sRoh);
  if (erwarteteZeilen !== null && !(Number.isInteger(erwarteteZeilen) && erwarteteZeilen >= 0))
    throw abbruch(`--erwartete-zeilen ist keine ganze Zahl: "${zRoh}".`);
  if (erwarteteSumme !== null && !Number.isFinite(erwarteteSumme))
    throw abbruch(`--erwartete-summe ist keine Zahl: "${sRoh}".`);
  if (loeschen && (erwarteteZeilen === null || erwarteteSumme === null))
    throw abbruch('--loeschen nur zusammen mit --erwartete-zeilen und --erwartete-summe.');

  return { partnerId, shop, loeschen, erwarteteZeilen, erwarteteSumme };
}

// ── Auswahl ─────────────────────────────────────────────────────────────────
// rows tragen _sheetRow (echte Zeilennummer aus dem frischen Read).
export function waehleZeilen({ header, rows, partnerId, beginn }) {
  const sp     = verkaufsSpalten(header);
  const lizIdx = requireHeader(header, 'Lizenzgebühr', 'Verkaeufe');
  const eigene = rows.filter(r => text(r[sp.partner]) === partnerId);
  const key    = r => [text(r[sp.order]), text(r[sp.artikel]), text(r[sp.variante]) || '0'].join('|');

  const verkaufZu = new Map();
  for (const r of eigene) if (!istStornoZeile(r, sp) && !verkaufZu.has(key(r))) verkaufZu.set(key(r), r);

  const zeilen = [];
  const waisen = [];
  for (const r of eigene) {
    const basis = istStornoZeile(r, sp) ? verkaufZu.get(key(r)) : r;
    if (!basis) { waisen.push(r); continue; }       // Gegenbuchung ohne Verkauf: nicht anfassen, melden
    const d = parseDatum(basis[sp.datum]);
    if (!d) throw abbruch(`Datum unlesbar in Zeile ${basis._sheetRow}: "${basis[sp.datum]}".`);
    if (d < beginn) zeilen.push(r);
  }

  let summe = 0;
  for (const r of zeilen) {
    const b = betrag(r[lizIdx]);
    if (!Number.isFinite(b)) throw abbruch(`Lizenzgebühr unlesbar in Zeile ${r._sheetRow}: "${r[lizIdx]}".`);
    summe += b;
  }

  return {
    zeilen,
    anzahl:      zeilen.length,
    summe:       round2(summe),
    abgerechnet: zeilen.filter(r => text(r[sp.status]) !== 'offen'),
    waisen,
    bleiben:     eigene.length - zeilen.length,
    spalten:     { ...sp, liz: lizIdx },
  };
}

// ── Freigabe ────────────────────────────────────────────────────────────────
export function pruefeFreigabe({ loeschen, erwarteteZeilen, erwarteteSumme }, auswahl) {
  const gefunden = `gefunden: ${auswahl.anzahl} Zeilen, Summe ${eur(auswahl.summe)} €`;
  if (!loeschen) return { loeschen: false, grund: `Trockenlauf (${gefunden}).` };
  if (auswahl.anzahl === 0) return { loeschen: false, grund: `Nichts zu löschen (${gefunden}).` };
  if (auswahl.anzahl !== erwarteteZeilen || auswahl.summe !== round2(erwarteteSumme)) {
    return {
      loeschen: false,
      grund: `Erwartung passt nicht zum Sheet – erwartet: ${erwarteteZeilen} Zeilen, Summe ${eur(erwarteteSumme)} €; ${gefunden}.`,
    };
  }
  if (auswahl.abgerechnet.length) {
    return {
      loeschen: false,
      grund: `${auswahl.abgerechnet.length} abgerechnete Zeile(n) in der Auswahl (Zeilen ${auswahl.abgerechnet.map(r => r._sheetRow).join(', ')}).`,
    };
  }
  return { loeschen: true, grund: `Erwartung passt (${gefunden}).` };
}

// ── Lösch-Requests ──────────────────────────────────────────────────────────
export function baueLoeschRequests(gid, zeilen) {
  const nummern = zeilen.map(r => r._sheetRow);
  if (nummern.some(n => !Number.isInteger(n) || n < 2)) throw abbruch('Ungültige Zeilennummer in der Auswahl.');
  if (new Set(nummern).size !== nummern.length) throw abbruch('Doppelte Zeilennummer in der Auswahl.');
  return [...nummern].sort((a, b) => b - a).map(n => ({
    deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
  }));
}

// ── Ablauf ──────────────────────────────────────────────────────────────────
async function readTab(sheets, spreadsheetId, tab) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:Z` });
  const [header, ...rows] = data.values ?? [];
  rows.forEach((r, i) => { r._sheetRow = i + 2; });           // vor dem Filtern – Leerzeilen zaehlen mit
  return { header: header ?? [], rows: rows.filter(r => r.some(c => text(c) !== '')) };
}

export async function run(argv, log = console.log) {
  const opts = parseArgs(argv);
  const spreadsheetId = process.env.BUSINESS_SHEET_ID;
  if (!spreadsheetId) throw abbruch('BUSINESS_SHEET_ID fehlt.');

  const tab    = getShopConfig(opts.shop).tabVerkaeufe;
  const sheets = google.sheets({ version: 'v4', auth: await getGoogleAuth() });

  const partnerTab = await readTab(sheets, spreadsheetId, 'Partner');
  const beginn = baueVertragsbeginne(partnerTab.header, partnerTab.rows)(opts.partnerId);
  if (!beginn) throw abbruch(`Partner ${opts.partnerId} hat kein Vertrag-ab – nichts auszuwählen.`);

  const vTab    = await readTab(sheets, spreadsheetId, tab);
  const auswahl = waehleZeilen({ header: vTab.header, rows: vTab.rows, partnerId: opts.partnerId, beginn });
  const sp      = auswahl.spalten;
  const beginnDE = `${String(beginn.getUTCDate()).padStart(2, '0')}.${String(beginn.getUTCMonth() + 1).padStart(2, '0')}.${beginn.getUTCFullYear()}`;

  log(`${tab} · Partner ${opts.partnerId} · Vertrag-ab ${beginnDE} · ${opts.loeschen ? 'LÖSCHEN' : 'TROCKENLAUF'}`);
  for (const r of auswahl.zeilen) {
    log(`  Zeile ${String(r._sheetRow).padStart(4)} · ${text(r[sp.order]).padEnd(6)} ${text(r[sp.datum]).padEnd(10)} `
      + `${text(r[sp.artikel]).slice(0, 50).padEnd(50)} Var ${(text(r[sp.variante]) || '0').padEnd(5)} `
      + `Stk ${text(r[sp.stueck]).padStart(3)} Liz ${eur(betrag(r[sp.liz])).padStart(7)} ${text(r[sp.status])}`
      + `${istStornoZeile(r, sp) ? '  ↩ Storno' : ''}`);
  }
  log(`Auswahl: ${auswahl.anzahl} Zeilen · Summe ${eur(auswahl.summe)} € · abgerechnet ${auswahl.abgerechnet.length} · `
    + `bleiben ${auswahl.bleiben} · Gegenbuchungen ohne Verkauf ${auswahl.waisen.length}`);

  const freigabe = pruefeFreigabe(opts, auswahl);
  log(freigabe.grund);
  if (!freigabe.loeschen) {
    if (opts.loeschen) throw abbruch(`ABBRUCH ohne Schreiben: ${freigabe.grund}`, { anzahl: auswahl.anzahl, summe: auswahl.summe });
    return { geloescht: false, anzahl: auswahl.anzahl, summe: auswahl.summe };
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const gid  = meta.data.sheets.find(s => s.properties.title === tab)?.properties.sheetId;
  if (gid === undefined) throw abbruch(`Reiter "${tab}" nicht gefunden.`);

  const requests = baueLoeschRequests(gid, auswahl.zeilen);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  log(`✓ ${requests.length} Zeilen gelöscht (ein batchUpdate, von unten nach oben).`);

  // Kontrolle: frisch lesen
  const nachher = await readTab(sheets, spreadsheetId, tab);
  const spN  = verkaufsSpalten(nachher.header);
  const lizN = requireHeader(nachher.header, 'Lizenzgebühr', 'Verkaeufe');
  const rest = nachher.rows.filter(r => text(r[spN.partner]) === opts.partnerId);
  const restSumme = round2(rest.reduce((s, r) => s + (betrag(r[lizN]) || 0), 0));
  log(`Kontrolle: ${opts.partnerId} hat jetzt ${rest.length} Zeilen · Summe ${eur(restSumme)} €`);

  return { geloescht: true, anzahl: auswahl.anzahl, summe: auswahl.summe, rest: rest.length, restSumme };
}

// ── Direktausführung ────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === __filename || __filename.endsWith(process.argv[1].replace(/\\/g, '/')))) {
  run(process.argv.slice(2))
    .then(r => console.log(r.geloescht ? 'Fertig.' : 'Trockenlauf beendet – nichts geschrieben.'))
    .catch(err => { console.error(err.abbruch ? err.message : `FEHLER: ${err.message ?? err}`); process.exit(1); });
}
