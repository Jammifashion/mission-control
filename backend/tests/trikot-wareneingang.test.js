// TR4: Wareneingang Trikots (utils/trikot-wareneingang.js, lib/trikotWareneingang.js, Anzeige in index.html).
// Nur erfundene Daten.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { wareneingangPlan } from '../utils/trikot-wareneingang.js';
import { trikotZeilen, baueTrikotAnsicht } from '../utils/trikot-ansicht.js';
import { trikotWareneingang } from '../lib/trikotWareneingang.js';

const KOPF = ['Zeilen-ID', 'Order-ID', 'Kunde', 'Produktname', 'Groesse', 'Name', 'Nummer', 'Quelle', 'Rohtext',
  'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz', 'Ersetzt'];
// Spalten: P=Charge(J), R=Geliefert_Am(L), S=Status(M) in diesem erfundenen Aufbau
const H = 'Verein Heimtrikot 26/27';
const z = (id, order, charge, geliefert = '', status = '', ersetzt = '') =>
  [id, order, 'Erika Muster', H, 'L', 'ALPHA', '7', 'addon', '', charge, charge ? 46300 : '', geliefert, status, '', ersetzt];
const UNF = [KOPF,
  z('1|1|1', '100', 3),                    // 2: offen, abhakbar
  z('2|1|1', '100', 3),                    // 3: offen, gleiche Bestellung
  z('3|1|1', '101', 2, '', 'ok'),          // 4: ok von Hand (ohne Datum) -> kein Haken
  z('4|1|1', '102', 2, 46320, 'ok'),       // 5: MC-Haken -> zurueck moeglich
  z('5|1|1', '103', 2, '', 'ersetzt'),     // 6: ersetzt -> nie
  z('INT-2026-0001', '103', 4, '', '', '5|1|1'),   // 7: Ersatzzeile
  z('6|1|1', '104', ''),                   // 8: ohne Charge
];
const fmt = w => w.map((r, i) => (i ? r.map((v, j) => (j === 11 && typeof v === 'number' ? '18.10.2026' : j === 10 && typeof v === 'number' ? '04.10.2026' : String(v ?? ''))) : r));

describe('wareneingangPlan', () => {
  test('setzen: nur S="ok" und R=Datumswert, nur leere Zellen mit Charge', () => {
    const p = wareneingangPlan(UNF, fmt(UNF), { richtung: 'setzen', auswahl: [{ id: '2|1|1', zeile: 3 }, { id: '1|1|1', zeile: 2 }], serial: 46325 });
    expect(p.probleme).toEqual([]);
    expect(p.zellen).toEqual([
      { range: "'Trikots'!M2", values: [['ok']] }, { range: "'Trikots'!L2", values: [[46325]] },
      { range: "'Trikots'!M3", values: [['ok']] }, { range: "'Trikots'!L3", values: [[46325]] }]);
  });
  test('zurueck: nur beim gesehenen MC-Haken (ok + dasselbe Datum), leert beide', () => {
    const p = wareneingangPlan(UNF, fmt(UNF), { richtung: 'zurueck', auswahl: [{ id: '4|1|1', zeile: 5, geliefertAm: '18.10.2026' }], serial: 1 });
    expect(p.zellen).toEqual([{ range: "'Trikots'!M5", values: [['']] }, { range: "'Trikots'!L5", values: [['']] }]);
    const anders = wareneingangPlan(UNF, fmt(UNF), { richtung: 'zurueck', auswahl: [{ id: '4|1|1', zeile: 5, geliefertAm: '17.10.2026' }], serial: 1 });
    expect(anders.probleme[0].text).toMatch(/inzwischen 18\.10\.2026/);
  });
  test('nie: ersetzt, ok von Hand, ohne Charge, geaenderte Zeile, belegte Zellen; ein Problem -> keine Zelle', () => {
    const t = (richtung, a) => wareneingangPlan(UNF, fmt(UNF), { richtung, auswahl: [a], serial: 1 }).probleme[0]?.text ?? '';
    expect(t('setzen', { id: '5|1|1', zeile: 6 })).toMatch(/nicht mehr offen \(Status „ersetzt“/);
    expect(t('zurueck', { id: '5|1|1', zeile: 6, geliefertAm: '' })).toMatch(/keinen Haken von MC/);
    expect(t('zurueck', { id: '3|1|1', zeile: 4, geliefertAm: '' })).toMatch(/keinen Haken von MC/);
    expect(t('setzen', { id: '3|1|1', zeile: 4 })).toMatch(/nicht mehr offen/);
    expect(t('setzen', { id: '6|1|1', zeile: 8 })).toMatch(/noch nicht beim Produzenten/);
    expect(t('setzen', { id: 'x', zeile: 2 })).toMatch(/hat sich geändert/);
    expect(t('setzen', { id: '1|1|1', zeile: 99 })).toMatch(/gibt es nicht/);
    const gemischt = wareneingangPlan(UNF, fmt(UNF), { richtung: 'setzen', auswahl: [{ id: '1|1|1', zeile: 2 }, { id: '6|1|1', zeile: 8 }], serial: 1 });
    expect(gemischt.zellen).toEqual([]);
    expect(() => wareneingangPlan(UNF, fmt(UNF), { richtung: 'weg', auswahl: [{}], serial: 1 })).toThrow(/Richtung/);
    expect(() => wareneingangPlan(UNF, fmt(UNF), { richtung: 'setzen', auswahl: [], serial: 1 })).toThrow(/Keine/);
  });
});

describe('Ansicht: abhakbar und Bestellung komplett', () => {
  const zeilenAus = w => baueTrikotAnsicht(trikotZeilen(fmt(w))).gruppen.flatMap(g => g.zeilen);
  test('abhaken: setzen / zurueck / nie', () => {
    const a = Object.fromEntries(zeilenAus(UNF).map(x => [x.zeile, x.abhaken]));
    expect(a).toEqual({ 2: 'setzen', 3: 'setzen', 4: '', 5: 'zurueck', 6: '', 7: 'setzen', 8: '' });
  });
  test('komplett: alle Trikots der Order ok; bei ersetzt zaehlt die Ersatzzeile', () => {
    let a = zeilenAus(UNF);
    const k = n => a.find(x => x.zeile === n);
    expect(k(4).bestellungKomplett).toBe(true);    // 101: ein Trikot, ok
    expect(k(2)).toMatchObject({ bestellungKomplett: false, bestellung: { trikots: 2, fertig: 0 } });
    expect(k(6).bestellungKomplett).toBe(false);   // 103: ersetzt, Ersatz noch nicht da
    const w = UNF.map(r => [...r]); w[6][12] = 'ok'; w[6][11] = 46325;   // Ersatzzeile da
    a = zeilenAus(w);
    expect(k(6).bestellungKomplett).toBe(true);
    expect(k(7)).toMatchObject({ bestellungKomplett: true, bestellung: { trikots: 1, fertig: 1 } });
  });
});

// ── lib mit Attrappe ──
function attrappe(w = UNF) {
  let werte = w.map(r => [...r]);
  const batchUpdate = jest.fn(async ({ requestBody }) => {
    for (const d of requestBody.data) {
      const [, ref] = d.range.split('!');
      werte[Number(ref.slice(1)) - 1][ref.charCodeAt(0) - 65] = d.values[0][0];
    }
  });
  let mitFormat = false;
  const sheets = { spreadsheets: {
    values: {
      get: jest.fn(async ({ valueRenderOption }) => ({ data: { values: valueRenderOption === 'FORMATTED_VALUE'
        ? werte.map((r, i) => (i ? r.map((v, j) => (j === 11 && typeof v === 'number' ? (mitFormat ? '30.10.2026' : String(v)) : String(v ?? ''))) : r)) : werte } })),
      batchUpdate, append: jest.fn(), update: jest.fn(),
    },
    get: jest.fn(async () => ({ data: { sheets: [{ properties: { sheetId: 7, title: 'Trikots' } }] } })),
    batchUpdate: jest.fn(async () => { mitFormat = true; }),
  } };
  return { sheets, batchUpdate, werte: () => werte };
}
const JETZT = new Date('2026-10-30T10:00:00Z');

describe('lib/trikotWareneingang.js', () => {
  beforeEach(() => { process.env.BUSINESS_SHEET_ID = 'biz'; });
  test('setzen: ein batchUpdate, Datumswert + Format dd.mm.yyyy nur fuer diese Zellen, ganzer Reiter zurueckgelesen', async () => {
    const a = attrappe();
    const r = await trikotWareneingang({ richtung: 'setzen', auswahl: [{ id: '1|1|1', zeile: 2 }, { id: '2|1|1', zeile: 3 }], sheets: a.sheets, jetzt: JETZT });
    expect(r).toMatchObject({ richtung: 'setzen', zeilen: 2, geliefertAm: '30.10.2026', rueckgelesen: true, abweichungen: [], datumsformatGesetzt: 2 });
    expect(a.batchUpdate).toHaveBeenCalledTimes(1);
    expect(a.werte()[1].slice(11, 13)).toEqual([46325, 'ok']);
    const fmtReq = a.sheets.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(fmtReq.map(q => [q.repeatCell.range.startRowIndex, q.repeatCell.range.startColumnIndex, q.repeatCell.fields])).toEqual([[1, 11, 'userEnteredFormat.numberFormat'], [2, 11, 'userEnteredFormat.numberFormat']]);
    expect(fmtReq[0].repeatCell.cell.userEnteredFormat.numberFormat).toEqual({ type: 'DATE', pattern: 'dd.mm.yyyy' });
    expect(a.sheets.spreadsheets.values.append).not.toHaveBeenCalled();
  });
  test('zurueck leert beide Zellen; ersetzt bleibt unberuehrt', async () => {
    const a = attrappe();
    await trikotWareneingang({ richtung: 'zurueck', auswahl: [{ id: '4|1|1', zeile: 5, geliefertAm: '46320' }], sheets: a.sheets, jetzt: JETZT });
    expect(a.werte()[4].slice(11, 13)).toEqual(['', '']);
    await expect(trikotWareneingang({ richtung: 'setzen', auswahl: [{ id: '5|1|1', zeile: 6 }], sheets: a.sheets, jetzt: JETZT }))
      .rejects.toMatchObject({ status: 409, code: 'nicht_gebucht' });
    expect(a.werte()[5][12]).toBe('ersetzt');
  });
  test('Doppelklick: zweiter Aufruf waehrend des ersten -> 409; danach ist die Zeile nicht mehr offen -> 409', async () => {
    const a = attrappe();
    const auswahl = [{ id: '1|1|1', zeile: 2 }];
    const [x, y] = await Promise.allSettled([
      trikotWareneingang({ richtung: 'setzen', auswahl, sheets: a.sheets, jetzt: JETZT }),
      trikotWareneingang({ richtung: 'setzen', auswahl, sheets: a.sheets, jetzt: JETZT })]);
    expect(x.status).toBe('fulfilled');
    expect(y.reason).toMatchObject({ status: 409, code: 'laeuft_gerade' });
    await expect(trikotWareneingang({ richtung: 'setzen', auswahl, sheets: a.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409 });
    expect(a.batchUpdate).toHaveBeenCalledTimes(1);
  });
});

// ── Anzeige (index.html) ──
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Trikots: Anfang'), html.indexOf('// ── Trikots: Ende ──'));
const T = new Function(`${block}\nreturn { trZeileHtml, trGruppeHtml };`)();
describe('Anzeige', () => {
  const daten = baueTrikotAnsicht(trikotZeilen(fmt(UNF)));
  const zeile = n => daten.gruppen.flatMap(g => g.zeilen).find(x => x.zeile === n);
  test('Haken nur wo erlaubt; MC-Haken angehakt mit Rueckweg-Hilfe; ok von Hand und ersetzt ohne Haken', () => {
    expect(T.trZeileHtml(zeile(2))).toMatch(/<input type="checkbox" data-tr-haken="2" data-id="1\|1\|1" data-datum="" data-hilfe="tr-haken"> da<\/label>/);
    expect(T.trZeileHtml(zeile(5))).toMatch(/data-tr-haken="5" data-id="4\|1\|1" data-datum="18\.10\.2026" checked data-hilfe="tr-zurueck"/);
    expect(T.trZeileHtml(zeile(4))).not.toMatch(/data-tr-haken/);
    expect(T.trZeileHtml(zeile(4))).toMatch(/lb-st-geliefert">da</);
    expect(T.trZeileHtml(zeile(6))).not.toMatch(/data-tr-haken/);
    expect(T.trZeileHtml(zeile(8))).not.toMatch(/data-tr-haken/);
  });
  test('Bestellung komplett / Teilstand; Sammelknopf je Bestellung mit Anzahl', () => {
    expect(T.trZeileHtml(zeile(4))).toMatch(/Bestellung komplett ✓/);
    expect(T.trZeileHtml(zeile(2))).toMatch(/Bestellung 0\/2 da/);
    const g3 = daten.gruppen.find(g => g.charge === '3');
    expect(T.trGruppeHtml(g3)).toMatch(/data-tr-alle="3" data-hilfe="tr-alle-da">alle offenen dieser Bestellung als da \(2\)</);
    expect(T.trGruppeHtml(daten.gruppen.find(g => g.charge === '2'))).not.toMatch(/data-tr-alle/);
    expect(T.trGruppeHtml(daten.gruppen.find(g => g.offen))).not.toMatch(/data-tr-alle/);
  });
  test('Schreibteil: Bestaetigung beim Rueckweg und beim Sammelknopf, Sperre gegen Doppelklick', () => {
    const teil = html.slice(html.indexOf('// ── Trikot-Wareneingang (TR4)'), html.indexOf('// ── SECTION: Artikelerfassung ──'));
    expect(teil).toMatch(/showConfirm\('Doch nicht da\?'/);
    expect(teil).toMatch(/showConfirm\('Alle als da buchen'/);
    expect(teil).toMatch(/if \(trWe\.laeuft\) \{ showToast/);
    expect(teil).toContain('/api/bestellen/trikots/wareneingang');
  });
});
