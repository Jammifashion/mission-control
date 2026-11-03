// AM-3: Auftrag <-> Warenkorb und Lager. Bereitstellen (gemischte Herkuenfte, ein Schritt), Teilen, Zuruecknehmen,
// Korb-Rueckmeldung, automatisches "bestellt" (nur nach vorn), "Ware da", EDI-Referenz = AU-Nr., Status "Design".
// Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets, grundTabs, NR, NR2 } from './hilfen/korb-sheet.js';
import { TAB_KORB, KORB_SPALTEN, eigenGesperrtGrund } from '../utils/korb-logic.js';
import * as L from '../utils/lager.js';
import {
  TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, wareStand, autoBestellt, korbStand, auftragZahlen,
} from '../utils/auftraege.js';
import { bereitstellenPlan, zuruecknehmenPlan, kannBereitstellen } from '../utils/auftrag-bereitstellen.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import { lagerZielPlan } from '../utils/lager-eingang.js';
import { bereitstellen, bereitstellenVorschau, zuruecknehmen } from '../lib/auftragBereitstellen.js';
import { leseAuftraege, setzeAutoBestellt, wechsleStatus, _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';
import { lagerCacheLeeren } from '../lib/lager.js';

const hier = dirname(fileURLToPath(import.meta.url));
const JETZT = '2026-11-04T09:00:00.000Z';
const jetzt = () => new Date(JETZT);
const AU = 'AU-2026-0003';
const POS_OPT = ['Herkunft', 'Lager_Ort', 'Lager_Buchung'];
const az = o => [...AUFTRAG_SPALTEN, 'Design_Am'].map(s => o[s] ?? '');
const pz = o => [...POSITION_SPALTEN, ...POS_OPT].map(s => o[s] ?? '');
const pos = (n, extra) => ({ Position_ID: `${AU}-0${n}`, Auftrag_Nr: AU, Art: 'lshop', LShop_ArticleNr: NR, Menge: '3', Stand: 's', ...extra });

function tabs({ auftrag = {}, positionen, lager = [] } = {}) {
  const t = grundTabs();
  return {
    ...t,
    [TAB_AUFTRAEGE]: [[...AUFTRAG_SPALTEN, 'Design_Am'], az({ Auftrag_Nr: AU, Kunden_Nr: 'K-00009', Kurztitel: 'Polos Testverein', Status: 'Angebot', Stand: 'S1', ...auftrag })],
    [TAB_POSITIONEN]: [[...POSITION_SPALTEN, ...POS_OPT], ...positionen.map(pz)],
    [L.TAB_BUCHUNGEN]: [L.BUCHUNG_SPALTEN, ...lager],
    [L.TAB_ARTIKEL]: [L.ARTIKEL_SPALTEN],
    [L.TAB_ORTE]: [L.ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Alt', 'inaktiv', '']],
  };
}
const startBestand = (nr, ort, n) => L.BUCHUNG_SPALTEN.map(s => ({ Buchung_ID: 'LB-2026-00001', Datum: '2026-11-01T00:00:00Z', Art: 'inventur', Warenart: 'rohling',
  Schluessel: `LS:${nr}`, Menge: n, Ort: ort, Quelle: 'start' })[s] ?? '');
const gemischt = () => [
  pos(1, { Herkunft: 'bestellen' }),
  pos(2, { LShop_ArticleNr: NR2, Herkunft: 'lager', Lager_Ort: 'Wrist', Menge: '2' }),
  pos(3, { Herkunft: 'vorhanden', Menge: '1' }),
  { Position_ID: `${AU}-04`, Auftrag_Nr: AU, Art: 'frei', Freitext: 'Tassen', Menge: '5', Stand: 's' },
];

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren(); lagerCacheLeeren();
});

describe('Bereitstellen in einem Schritt', () => {
  test('gemischt: 🛒 in den Korb (Referenz = AU-Nr.), 📦 Abgang abgang_auftrag, ✓ und frei nichts; ein batchUpdate, kein append', async () => {
    const t = tabs({ positionen: gemischt(), lager: [startBestand(NR2, 'Wrist', 5)] });
    const { sheets, aufrufe } = machSheets(t);
    const v = await bereitstellenVorschau({ eingabe: { auftragNr: AU }, sheets, jetzt });
    expect(v.vorschau.map(x => x.aktion)).toEqual(['korb', 'lager', 'vorhanden', 'frei']);
    expect(aufrufe.batchUpdate).toEqual([]);   // Vorschau schreibt nichts
    const r = await bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000001' }, sheets, jetzt });
    expect(r).toMatchObject({ korb: 1, korbStueck: 3, lager: 1, lagerStueck: 2, geteilt: 0 });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([]);
    const korb = t[TAB_KORB].slice(1);
    expect(korb).toHaveLength(1);
    const k = Object.fromEntries(KORB_SPALTEN.map((s, i) => [s, korb[0][i]]));
    expect(k).toMatchObject({ Herkunft: 'eigen', Referenz: AU, LShop_ArticleNr: NR, Menge: '3', Status: 'offen', Notiz: '' });
    expect(korb[0].join('|')).not.toMatch(/Testverein|K-00009|Polos/);   // nie Kunde oder Kurztitel
    const ab = t[L.TAB_BUCHUNGEN].slice(-1)[0];
    const b = Object.fromEntries(L.BUCHUNG_SPALTEN.map((s, i) => [s, ab[i]]));
    expect(b).toMatchObject({ Art: 'abgang_auftrag', Schluessel: `LS:${NR2}`, Menge: -2, Ort: 'Wrist', Bezug: AU, Quelle: 'auftrag', Notiz: `${AU}-02` });
    const p = t[TAB_POSITIONEN];
    const iK = p[0].indexOf('Korb_Schluessel'), iL = p[0].indexOf('Lager_Buchung');
    expect(p[1][iK]).toMatch(/^EIGEN:2026-\d{4}$/);
    expect(p[2][iL]).toBe(b.Buchung_ID);
    expect(p[3][iK] + p[3][iL] + p[4][iK]).toBe('');
  });
  test('Doppelklick: zweiter Aufruf -> schon, nichts doppelt', async () => {
    const t = tabs({ positionen: gemischt(), lager: [startBestand(NR2, 'Wrist', 5)] });
    const { sheets } = machSheets(t);
    await bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000002' }, sheets, jetzt });
    const zwei = await bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000002' }, sheets, jetzt });
    expect(zwei.schon).toBe(true);
    expect(t[TAB_KORB]).toHaveLength(2);
    expect(t[L.TAB_BUCHUNGEN]).toHaveLength(3);
  });
  test('Lager nie negativ: Bestand frisch gelesen; zu wenig -> 409 knapp, nichts geschrieben; teilen: n aus Lager + Rest bestellen', async () => {
    const t = tabs({ positionen: [pos(1, { LShop_ArticleNr: NR2, Herkunft: 'lager', Lager_Ort: 'Wrist', Menge: '5' })], lager: [startBestand(NR2, 'Wrist', 2)] });
    const { sheets, aufrufe } = machSheets(t);
    await expect(bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000003' }, sheets, jetzt }))
      .rejects.toMatchObject({ status: 409, code: 'knapp', knapp: [{ positionId: `${AU}-01`, menge: 5, da: 2, ort: 'Wrist' }] });
    expect(aufrufe.batchUpdate).toEqual([]);
    const r = await bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000004', teilen: true }, sheets, jetzt });
    expect(r).toMatchObject({ lager: 1, lagerStueck: 2, korb: 1, korbStueck: 3, geteilt: 1 });
    const p = t[TAB_POSITIONEN];
    const i = n => p[0].indexOf(n);
    expect(p.slice(1).map(z => [z[i('Position_ID')], z[i('Menge')], z[i('Herkunft')], !!z[i('Lager_Buchung')], !!z[i('Korb_Schluessel')]])).toEqual([
      [`${AU}-01`, '2', 'lager', true, false], [`${AU}-02`, '3', 'bestellen', false, true],
    ]);
    const bestand = [...L.bestandAus(L.buchungenAus(t[L.TAB_BUCHUNGEN]).buchungen).values()].every(e => e.menge >= 0);
    expect(bestand).toBe(true);
  });
  test('inaktiver Lagerort: Hinweis + Ortswahl statt still Wrist', () => {
    const plan = bereitstellenPlan({ auftrag: { Auftrag_Nr: AU, Status: 'Angebot' }, positionen: [pos(1, { Herkunft: 'lager', Lager_Ort: 'Alt' })], korbZeilen: [],
      buchungen: [], orte: ['Wrist'], waehlbar: new Set([NR]), jetzt: JETZT });
    expect(plan.probleme[0]).toMatchObject({ code: 'ort' });
    expect(plan.lagerNeu).toEqual([]);
  });
  test('nur bis "bestellt"; leer bei L-Shop = bestellen, leer bei frei = noch zu besorgen', () => {
    expect(kannBereitstellen({ Status: 'Design' })).toBe(true);
    expect(kannBereitstellen({ Status: 'in Produktion' })).toBe(false);
    const plan = bereitstellenPlan({ auftrag: { Auftrag_Nr: AU, Status: 'Design' },
      positionen: [pos(1, { Herkunft: '' }), { Position_ID: `${AU}-02`, Auftrag_Nr: AU, Art: 'frei', Freitext: 'x', Menge: '1', Herkunft: '' }],
      korbZeilen: [], buchungen: [], orte: [], waehlbar: new Set([NR]), jetzt: JETZT });
    expect(plan.vorschau.map(x => x.aktion)).toEqual(['korb', 'frei']);
  });
});

describe('Übergabe zurücknehmen', () => {
  test('nur bei offener Korb-Zeile (abgewählt, Grund "Auftrag geändert"); Lager per Gegenbuchung; bestellt bleibt gesperrt', async () => {
    const t = tabs({ positionen: gemischt(), lager: [startBestand(NR2, 'Wrist', 5)] });
    const { sheets } = machSheets(t);
    await bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000005' }, sheets, jetzt });
    await zuruecknehmen({ eingabe: { auftragNr: AU, positionId: `${AU}-01`, vorgang: 'vorgang-000006' }, sheets, jetzt });
    await zuruecknehmen({ eingabe: { auftragNr: AU, positionId: `${AU}-02`, vorgang: 'vorgang-000007' }, sheets, jetzt });
    const k = t[TAB_KORB][1];
    expect([k[KORB_SPALTEN.indexOf('Status')], k[KORB_SPALTEN.indexOf('Grund')]]).toEqual(['abgewählt', 'Auftrag geändert']);
    const letzte = t[L.TAB_BUCHUNGEN].slice(-1)[0];
    expect([letzte[L.BUCHUNG_SPALTEN.indexOf('Art')], letzte[L.BUCHUNG_SPALTEN.indexOf('Menge')]]).toEqual(['korrektur', 2]);
    expect(L.bestandVon(L.bestandAus(L.buchungenAus(t[L.TAB_BUCHUNGEN]).buchungen), `LS:${NR2}`, 'Wrist')).toBe(5);
    const p = t[TAB_POSITIONEN];
    expect(p[1][p[0].indexOf('Korb_Schluessel')] + p[2][p[0].indexOf('Lager_Buchung')]).toBe('');
    // bestellt im Korb -> gesperrt
    const plan = () => zuruecknehmenPlan({ auftrag: { Auftrag_Nr: AU, Status: 'bestellt' }, positionen: [pos(1, { Korb_Schluessel: 'EIGEN:2026-0001' })],
      positionId: `${AU}-01`, korbZeilen: [{ Schluessel: 'EIGEN:2026-0001', Status: 'bestellt', _zeile: 2 }], buchungen: [], jetzt: JETZT });
    expect(plan).toThrow(/nicht mehr zurücknehmbar/);
  });
  test('Korb und Lager schuetzen Auftragszeilen: Korb-Bearbeiten gesperrt, kein "bei Ankunft ins Lager", keine manuelle Gegenbuchung', () => {
    expect(eigenGesperrtGrund({ Herkunft: 'eigen', Status: 'offen', Referenz: AU })).toMatch(/Gehört zu Auftrag/);
    expect(() => lagerZielPlan({ korbZeile: { Herkunft: 'eigen', Status: 'offen', Referenz: AU, Schluessel: 'EIGEN:2026-0001' }, status: 'offen', ziel: 'Wrist', orte: ['Wrist'] })).toThrow(/Kundenrohlinge/);
    const b = L.buchungenAus([L.BUCHUNG_SPALTEN, L.BUCHUNG_SPALTEN.map(s => ({ Buchung_ID: 'LB-2026-00002', Art: 'abgang_auftrag', Schluessel: `LS:${NR}`, Menge: -1, Ort: 'Wrist', Bezug: AU, Quelle: 'auftrag' })[s] ?? '')]).buchungen;
    expect(L.planGegenbuchung({ buchungId: 'LB-2026-00002', vorgang: 'vorgang-000008' }, { buchungen: b }).probleme[0].text).toMatch(/Übergabe zurücknehmen/);
  });
});

describe('Rückmeldung, Ware da, automatisches bestellt', () => {
  const korbJe = st => new Map([['EIGEN:2026-0001', { Schluessel: 'EIGEN:2026-0001', Status: st }], ['EIGEN:2026-0002', { Schluessel: 'EIGEN:2026-0002', Status: 'geliefert' }]]);
  const p = [pos(1, { Korb_Schluessel: 'EIGEN:2026-0001' }), pos(2, { Korb_Schluessel: 'EIGEN:2026-0002' }), pos(3, { Herkunft: 'lager', Lager_Buchung: 'LB-1' }),
    { Position_ID: `${AU}-04`, Auftrag_Nr: AU, Art: 'frei', Freitext: 'x', Menge: '1' }];
  test('Korb-Stand je Status; bestätigt = bestellt mit AB', () => {
    expect(korbStand({ Status: 'abgewählt' }).status).toBe('herausgenommen');
    expect(korbStand({ Status: 'bestellt', AB_Hinweis: 'ok' }).status).toBe('bestätigt');
    expect(korbStand(undefined).status).toBe('fehlt');
  });
  test('Ware: offen -> bestellt -> da; freie Positionen zaehlen nie', () => {
    expect(wareStand(p, korbJe('offen'))).toBe('offen');
    expect(wareStand(p, korbJe('bestellt'))).toBe('bestellt');
    expect(wareStand(p, korbJe('geliefert'))).toBe('da');
    expect(wareStand([{ Art: 'frei', Freitext: 'x' }], new Map())).toBe('');
  });
  test('automatisch bestellt: nur aus Anfrage/Angebot/Design, alle 🛒 bestellt + alle 📦 ausgebucht; frei blockiert nicht', () => {
    expect(autoBestellt({ Status: 'Design' }, p, korbJe('bestellt'))).toBe(true);
    expect(autoBestellt({ Status: 'Angebot' }, p, korbJe('offen'))).toBe(false);
    expect(autoBestellt({ Status: 'in Produktion' }, p, korbJe('bestellt'))).toBe(false);   // nie zurueck
    expect(autoBestellt({ Status: 'Angebot' }, [pos(1, { Herkunft: 'vorhanden' })], new Map())).toBe(false);   // nichts zu bestellen
    expect(autoBestellt({ Status: 'Angebot' }, [p[2]], new Map())).toBe(true);
  });
  test('Lesen: Korb-Rueckmeldung je Position, Ware, Kachel "wartet auf Ware", auto-bestellt nur nach vorn', async () => {
    const t = tabs({ positionen: gemischt(), lager: [startBestand(NR2, 'Wrist', 5)] });
    const { sheets } = machSheets(t);
    await bereitstellen({ eingabe: { auftragNr: AU, stand: 'S1', vorgang: 'vorgang-000009' }, sheets, jetzt });
    _auftraegeCacheLeeren();
    let r = await leseAuftraege({ sheets, jetzt });
    let a = r.auftraege[0];
    expect(a.positionen[0].korb).toMatchObject({ status: 'offen' });
    expect([a.ware, a.freiOffen, a.Status]).toEqual(['offen', 1, 'Angebot']);
    expect(r.zahlen.wartetAufWare).toBe(1);
    // Korb-Zeile wird bestellt -> beim naechsten Lesen automatisch "bestellt"
    t[TAB_KORB][1][KORB_SPALTEN.indexOf('Status')] = 'bestellt';
    _auftraegeCacheLeeren();
    r = await leseAuftraege({ sheets, jetzt });
    a = r.auftraege[0];
    expect([a.Status, a.Bestellt_Am, a.autoBestellt, a.ware]).toEqual(['bestellt', '2026-11-04', true, 'bestellt']);
    expect(await setzeAutoBestellt({ sheets, jetzt })).toEqual([]);   // nur einmal, nie zurueck
  });
  test('Kachel-Zahl wartet auf Ware nur fuer offene Auftraege', () => {
    const z = auftragZahlen([{ Auftrag_Nr: 'A', Status: 'bestellt' }, { Auftrag_Nr: 'B', Status: 'storniert' }, { Auftrag_Nr: 'C', Status: 'fertig' }], JETZT,
      new Map([['A', 'bestellt'], ['B', 'offen'], ['C', 'da']]));
    expect(z.wartetAufWare).toBe(1);
  });
});

describe('Status Design, EDI, Datenschutz', () => {
  test('EDI-Referenz einer Auftrags-Korbzeile ist nur die AU-Nr.', () => {
    expect(referenzFuer({ Herkunft: 'eigen', Referenz: AU })).toBe(AU);
  });
  test('Design ohne Spalte -> 409 einrichtung; mit Spalte Datum gesetzt', async () => {
    const ohne = tabs({ positionen: gemischt() });
    ohne[TAB_AUFTRAEGE] = [AUFTRAG_SPALTEN, AUFTRAG_SPALTEN.map(s => ({ Auftrag_Nr: AU, Kunden_Nr: 'K-1', Kurztitel: 'T', Status: 'Angebot', Stand: 'S1' })[s] ?? '')];
    await expect(wechsleStatus({ eingabe: { auftragNr: AU, stand: 'S1', aktion: 'weiter' }, sheets: machSheets(ohne).sheets, jetzt })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    const mit = tabs({ positionen: gemischt() });
    const { sheets } = machSheets(mit);
    expect((await wechsleStatus({ eingabe: { auftragNr: AU, stand: 'S1', aktion: 'weiter' }, sheets, jetzt })).status).toBe('Design');
    expect(mit[TAB_AUFTRAEGE][1][[...AUFTRAG_SPALTEN, 'Design_Am'].indexOf('Design_Am')]).toBe('2026-11-04');
  });
  test('Log der neuen Routen nur mit Nummern und Zahlen; lib ohne console', () => {
    const route = readFileSync(resolve(hier, '../routes/auftraege.js'), 'utf8');
    for (const z of route.split('\n').filter(l => l.includes('console.'))) expect(z).not.toMatch(/Kurztitel|Kunden_Nr|req\.body/);
    expect(readFileSync(resolve(hier, '../lib/auftragBereitstellen.js'), 'utf8').split('\n').filter(l => l.includes('console.'))).toEqual([]);
  });
});
