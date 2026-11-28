// AS1: Auftrag stornieren raeumt L-Shop- und DTF-Korb mit auf; Storno zuruecknehmen holt zurueck; Position entfernen zieht DTF mit.
// Nur erfundene Daten.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets, grundTabs, NR, NR2 } from './hilfen/korb-sheet.js';
import { TAB_KORB, KORB_SPALTEN, KORB_OPTIONAL } from '../utils/korb-logic.js';
import { TAB_DTF_KORB, KORB_SPALTEN as DTF_SPALTEN, KORB_OPTIONAL as DTF_OPTIONAL } from '../utils/dtf-korb.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, korbStand } from '../utils/auftraege.js';
import { koerbePlan, stornoText, GRUND_AUFTRAG_STORNIERT, GRUND_IM_AUFTRAG_ENTFERNT } from '../utils/auftrag-storno.js';
import { zuruecknehmenPlan } from '../utils/auftrag-bereitstellen.js';
import { lagerZielPlan } from '../utils/lager-eingang.js';
import { wechsleStatus, entfernePosition, stornoVorschau, stornoAltlast, _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = '2026-11-28T10:00:00.000Z';
const jetzt = () => new Date(JETZT);
const AU = 'AU-2026-0050', AU2 = 'AU-2026-0051';
const POS_OPT = ['Herkunft', 'Lager_Ort', 'Lager_Buchung', 'Entfernt'];
const az = o => [...AUFTRAG_SPALTEN, 'Design_Am', 'Storniert_Am'].map(s => o[s] ?? '');
const pz = o => [...POSITION_SPALTEN, ...POS_OPT].map(s => o[s] ?? '');
const kz = o => [...KORB_SPALTEN, ...KORB_OPTIONAL].map(s => o[s] ?? '');
const dz = o => [...DTF_SPALTEN, ...DTF_OPTIONAL].map(s => o[s] ?? '');
const korb = (n, status, o = {}) => ({ Schluessel: `EIGEN:2026-000${n}`, Shop: 'JFN', Herkunft: 'eigen', Referenz: AU, LShop_ArticleNr: NR, Menge: '2', Status: status, Stand: 's', ...o });
const dtf = (pos, status, o = {}) => ({ Schluessel: `AU:${AU}:${pos}:Brust`, Quelle: 'AU', Nummer: AU, Position: pos, Druckposition: 'Brust', Menge: '2', Status: status, Stand: 's', ...o });

function tabs() {
  return {
    ...grundTabs(),
    [TAB_AUFTRAEGE]: [[...AUFTRAG_SPALTEN, 'Design_Am', 'Storniert_Am'],
      az({ Auftrag_Nr: AU, Kunden_Nr: 'K-00009', Kurztitel: 'Testverein', Status: 'bestellt', Bestellt_Am: '2026-11-20', Stand: 'S1' }),
      az({ Auftrag_Nr: AU2, Kunden_Nr: 'K-00009', Kurztitel: 'Anderer', Status: 'bestellt', Stand: 'S2' })],
    [TAB_POSITIONEN]: [[...POSITION_SPALTEN, ...POS_OPT],
      pz({ Position_ID: `${AU}-01`, Auftrag_Nr: AU, Art: 'lshop', LShop_ArticleNr: NR, Menge: '2', Herkunft: 'bestellen', Korb_Schluessel: 'EIGEN:2026-0001', Stand: 's' }),
      pz({ Position_ID: `${AU}-02`, Auftrag_Nr: AU, Art: 'lshop', LShop_ArticleNr: NR2, Menge: '1', Herkunft: 'bestellen', Korb_Schluessel: 'EIGEN:2026-0002', Stand: 's' }),
      pz({ Position_ID: `${AU}-03`, Auftrag_Nr: AU, Art: 'lshop', LShop_ArticleNr: NR, Menge: '4', Herkunft: 'lager', Lager_Ort: 'Wrist', Lager_Buchung: 'LB-2026-00009', Stand: 's' }),
      pz({ Position_ID: `${AU2}-01`, Auftrag_Nr: AU2, Art: 'lshop', LShop_ArticleNr: NR, Menge: '1', Herkunft: 'bestellen', Korb_Schluessel: 'EIGEN:2026-0009', Stand: 's' })],
    [TAB_KORB]: [[...KORB_SPALTEN, ...KORB_OPTIONAL],
      kz(korb(1, 'offen')), kz(korb(2, 'bestellt', { Bestell_ID: 'JFN-2026-0005' })),
      kz(korb(9, 'offen', { Referenz: AU2 })),
      kz({ Schluessel: 'JFN:100:1', Shop: 'JFN', Herkunft: 'shop', Referenz: '', Status: 'offen', Stand: 's' })],
    [TAB_DTF_KORB]: [[...DTF_SPALTEN, ...DTF_OPTIONAL],
      dz(dtf(`${AU}-01`, 'offen')), dz(dtf(`${AU}-02`, 'bestellt', { DTF_Bestellung: 'DTF-2026-0001' })),
      dz(dtf(`${AU2}-01`, 'offen', { Nummer: AU2, Schluessel: `AU:${AU2}:${AU2}-01:Brust` }))],
  };
}
/** machSheets + Zaehler je values.batchUpdate-Aufruf (die Attrappe merkt sich nur die Bereiche). */
function mitZaehler(t) {
  const m = machSheets(t);
  const v = m.sheets.spreadsheets.values, orig = v.batchUpdate;
  const zahl = { calls: 0 };
  v.batchUpdate = async a => { zahl.calls++; return orig(a); };
  return { ...m, zahl };
}
const spalte = (t, tab, name) => t[tab][0].indexOf(name);
const zeile = (t, tab, schluessel) => t[tab].find(z => z[0] === schluessel);
const status = (t, tab, s) => zeile(t, tab, s)[spalte(t, tab, 'Status')];
const grund = (t, tab, s) => zeile(t, tab, s)[spalte(t, tab, 'Grund')];

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('Logik koerbePlan', () => {
  const pos = [{ Position_ID: 'P1', Auftrag_Nr: AU, Korb_Schluessel: 'K1', Menge: '2' }, { Position_ID: 'P2', Auftrag_Nr: AU, Lager_Buchung: 'LB-1', Menge: '3' }];
  const k = [{ _zeile: 2, Schluessel: 'K1', Status: 'offen' }, { _zeile: 3, Schluessel: 'K2', Herkunft: 'eigen', Referenz: AU, Status: 'bestellt' },
    { _zeile: 4, Schluessel: 'K3', Herkunft: 'eigen', Referenz: AU, Status: 'geliefert' }, { _zeile: 5, Schluessel: 'JFN:1:1', Herkunft: 'shop', Referenz: AU, Status: 'offen' }];
  const d = [{ _zeile: 2, Schluessel: 'D1', Quelle: 'AU', Nummer: AU, Position: 'P1', Status: 'offen' }, { _zeile: 3, Schluessel: 'D2', Quelle: 'JFN', Nummer: AU, Status: 'offen' }];
  test('Storno: nur offene abwaehlen, bestellt als Hinweis, geliefert und fremde Shop-Zeilen nie; Lager gezaehlt', () => {
    const p = koerbePlan({ auftrag: { Auftrag_Nr: AU }, positionen: pos, korbZeilen: k, dtfZeilen: d, jetzt: JETZT });
    expect(p.korb.map(x => x.schluessel)).toEqual(['K1']);
    expect(p.korb[0].werte).toEqual({ Status: 'abgewählt', Grund: GRUND_AUFTRAG_STORNIERT, Status_Datum: JETZT, Stand: JETZT });
    expect(p.korbBestellt).toEqual([{ schluessel: 'K2', status: 'bestellt' }]);
    expect(p.dtf.map(x => x.schluessel)).toEqual(['D1']);
    expect([p.lagerTeile, p.lagerPositionen]).toEqual([3, ['P2']]);
    expect(stornoText(p)).toBe('1 Zeile im L-Shop-Korb und 1 Zeile im DTF-Korb werden abgewählt („Auftrag storniert“).');
  });
  test('zurueck: nur Zeilen mit genau diesem Grund', () => {
    const k2 = [{ _zeile: 2, Schluessel: 'K1', Status: 'abgewählt', Grund: GRUND_AUFTRAG_STORNIERT }, { _zeile: 3, Schluessel: 'K2', Herkunft: 'eigen', Referenz: AU, Status: 'abgewählt', Grund: 'Sonstiges' }];
    const p = koerbePlan({ auftrag: { Auftrag_Nr: AU }, positionen: pos, korbZeilen: k2, dtfZeilen: [], richtung: 'zurueck', jetzt: JETZT });
    expect(p.korb.map(x => [x.schluessel, x.werte.Status, x.werte.Grund])).toEqual([['K1', 'offen', '']]);
  });
  test('eine Position mit eigenem Grund (Position entfernen)', () => {
    const p = koerbePlan({ auftrag: { Auftrag_Nr: AU }, positionen: pos, korbZeilen: [], dtfZeilen: d, positionId: 'P1', grund: GRUND_IM_AUFTRAG_ENTFERNT, jetzt: JETZT });
    expect(p.dtf.map(x => [x.schluessel, x.werte.Grund])).toEqual([['D1', 'im Auftrag entfernt']]);
  });
});

describe('Stornieren, Storno zuruecknehmen', () => {
  test('ein Schreibaufruf: Auftrag + offene Zeilen beider Koerbe abgewählt; bestellt bleibt; anderer Auftrag und Shop-Zeilen unberuehrt', async () => {
    const t = tabs();
    const { sheets, aufrufe, zahl } = mitZaehler(t);
    const v = await stornoVorschau({ auftragNr: AU, sheets, jetzt });
    expect(v).toMatchObject({ richtung: 'storno', korb: { abgewaehlt: 1, bestellt: [{ schluessel: 'EIGEN:2026-0002', status: 'bestellt' }] },
      dtf: { abgewaehlt: 1, bestellt: [{ status: 'bestellt' }] }, lager: { teile: 4, positionen: [`${AU}-03`] } });
    const r = await wechsleStatus({ eingabe: { auftragNr: AU, stand: 'S1', aktion: 'stornieren' }, sheets, jetzt });
    expect(r).toMatchObject({ status: 'storniert', korb: { abgewaehlt: 1 }, dtf: { abgewaehlt: 1 } });
    expect(zahl.calls).toBe(1);
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.append).toBe(0);
    expect(new Set(aufrufe.batchUpdate.map(r => r.split('!')[0].replace(/'/g, '')))).toEqual(new Set([TAB_AUFTRAEGE, TAB_KORB, TAB_DTF_KORB]));
    expect([status(t, TAB_KORB, 'EIGEN:2026-0001'), grund(t, TAB_KORB, 'EIGEN:2026-0001')]).toEqual(['abgewählt', 'Auftrag storniert']);
    expect(status(t, TAB_KORB, 'EIGEN:2026-0002')).toBe('bestellt');
    expect(status(t, TAB_KORB, 'EIGEN:2026-0009')).toBe('offen');
    expect(status(t, TAB_KORB, 'JFN:100:1')).toBe('offen');
    expect([status(t, TAB_DTF_KORB, `AU:${AU}:${AU}-01:Brust`), grund(t, TAB_DTF_KORB, `AU:${AU}:${AU}-01:Brust`)]).toEqual(['abgewählt', 'Auftrag storniert']);
    expect(status(t, TAB_DTF_KORB, `AU:${AU}:${AU}-02:Brust`)).toBe('bestellt');
    expect(status(t, TAB_DTF_KORB, `AU:${AU2}:${AU2}-01:Brust`)).toBe('offen');
    // Storno zuruecknehmen holt genau diese zurueck
    _auftraegeCacheLeeren();
    const stand = t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Stand')];
    const r2 = await wechsleStatus({ eingabe: { auftragNr: AU, stand, aktion: 'storno_zurueck' }, sheets, jetzt });
    expect(r2).toMatchObject({ status: 'bestellt', korb: { abgewaehlt: 1 }, dtf: { abgewaehlt: 1 } });
    expect([status(t, TAB_KORB, 'EIGEN:2026-0001'), grund(t, TAB_KORB, 'EIGEN:2026-0001')]).toEqual(['offen', '']);
    expect(status(t, TAB_DTF_KORB, `AU:${AU}:${AU}-01:Brust`)).toBe('offen');
  });
  test('Position entfernen zieht jetzt auch DTF mit, wiederherstellen holt zurueck', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const r = await entfernePosition({ eingabe: { auftragNr: AU, positionId: `${AU}-01` }, sheets, jetzt });
    expect(r.dtf).toMatchObject({ geaendert: 1 });
    expect([status(t, TAB_KORB, 'EIGEN:2026-0001'), grund(t, TAB_DTF_KORB, `AU:${AU}:${AU}-01:Brust`)]).toEqual(['abgewählt', 'im Auftrag entfernt']);
    _auftraegeCacheLeeren();
    await entfernePosition({ eingabe: { auftragNr: AU, positionId: `${AU}-01`, wiederherstellen: true }, sheets, jetzt });
    expect([status(t, TAB_KORB, 'EIGEN:2026-0001'), status(t, TAB_DTF_KORB, `AU:${AU}:${AU}-01:Brust`)]).toEqual(['offen', 'offen']);
  });
  test('Altlast: Trockenlauf zaehlt, schreibt nichts; --write waehlt ab', async () => {
    const t = tabs();
    t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Status')] = 'storniert';
    const { sheets, zahl } = mitZaehler(t);
    const r = await stornoAltlast({ sheets, jetzt });
    expect(r).toMatchObject({ write: false, zeilen: 2, liste: [{ art: 'storniert', nr: AU, korb: ['EIGEN:2026-0001'], dtf: [`AU:${AU}:${AU}-01:Brust`] }] });
    expect(zahl.calls).toBe(0);
    _auftraegeCacheLeeren();
    await stornoAltlast({ write: true, sheets, jetzt });
    expect(status(t, TAB_KORB, 'EIGEN:2026-0001')).toBe('abgewählt');
  });
});

describe('Lager-Rueckwege beim stornierten Auftrag', () => {
  const au = { Auftrag_Nr: AU, Status: 'storniert' };
  test('"zurück ins Lager" erlaubt (Gegenbuchung), Korb bleibt; ohne Lager-Buchung 409', () => {
    const p = [{ Position_ID: `${AU}-03`, Auftrag_Nr: AU, Lager_Buchung: 'LB-2026-00009', Korb_Schluessel: 'EIGEN:2026-0001', Menge: '4' }];
    const plan = zuruecknehmenPlan({ auftrag: au, positionen: p, positionId: `${AU}-03`, korbZeilen: [{ Schluessel: 'EIGEN:2026-0001', Status: 'bestellt' }],
      buchungen: [{ id: 'LB-2026-00009', schluessel: `LS:${NR}`, menge: -4, ort: 'Wrist', warenart: 'rohling' }], jetzt: JETZT });
    expect(plan.lagerNeu).toHaveLength(1);
    expect(plan.lagerNeu[0]).toMatchObject({ Menge: 4, Storno_von: 'LB-2026-00009' });
    expect(plan.korb).toBeNull();
    expect(plan.posFelder.Korb_Schluessel).toBeUndefined();
    expect(() => zuruecknehmenPlan({ auftrag: au, positionen: [{ Position_ID: 'X', Auftrag_Nr: AU, Korb_Schluessel: 'K' }], positionId: 'X', korbZeilen: [], buchungen: [], jetzt: JETZT }))
      .toThrow(expect.objectContaining({ code: 'status' }));
  });
  test('"bei Ankunft ins Lager" fuer Zeilen eines stornierten Auftrags', () => {
    const z = { _zeile: 2, Schluessel: 'EIGEN:2026-0002', Herkunft: 'eigen', Referenz: AU, Status: 'bestellt', Lager_Ziel: '' };
    expect(() => lagerZielPlan({ korbZeile: z, status: 'bestellt', ziel: 'Wrist', orte: ['Wrist'] })).toThrow(/Kundenrohlinge/);
    expect(lagerZielPlan({ korbZeile: z, status: 'bestellt', ziel: 'Wrist', orte: ['Wrist'], auStorniert: true })).toMatchObject({ neu: 'Wrist' });
    expect(korbStand({ Schluessel: 'K', Status: 'bestellt', Lager_Ziel: 'Wrist' }).lagerZiel).toBe('Wrist');
  });
});

describe('Oberflaeche', () => {
  test('Rueckfrage mit Zahlen aus der Vorschau, Hinweis am stornierten Auftrag, orange statt rot, Mouse-over', () => {
    expect(html).toContain('/api/auftraege/${encodeURIComponent(a.Auftrag_Nr)}/storno-vorschau');
    expect(html).toContain("auEl('au-storno').addEventListener('click', () => auStornoKlick(false));");
    expect(html).toContain('.au-warn { color: var(--warning); }');
    expect(html).toContain('<div id="au-d-storno"');
    for (const k of ['au-storno-lager-ziel', 'au-storno-lager', 'au-storno-dtf']) expect(html).toMatch(new RegExp(`'${k}':\\s+\\{ name:`));
    const s = html.slice(html.indexOf('function auStornoHinweisHtml'), html.indexOf('function auKorbText'));
    expect(s).not.toMatch(/--danger|title=/);
  });
});
