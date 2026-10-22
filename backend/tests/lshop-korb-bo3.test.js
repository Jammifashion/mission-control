// BO3: L-Shop-Warenkorb bearbeitbar - herausnehmen / zurueck auf offen, eigene Positionen.
// Status nur ueber Schluessel + bisherigen Status (sonst 409, nichts geschrieben),
// nie values.append, Abgleich laesst "abgewählt" und Herkunft "eigen" in Ruhe.

import {
  KORB_SPALTEN, STATUS, HINWEIS, TAB_KORB, GRUENDE,
  korbZeilen, statusPlan, grundVorschlag, naechsteEigenNummer, sucheModelle, NICHT_IM_BESTAND, buendele, korbZaehler, lshopText, rausAktuell,
} from '../utils/korb-logic.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  runKorbAbgleich, setzeStatus, legeEigenePositionAn, sucheLShopModelle, lshopModellVarianten, leseKorb, _korbCacheLeeren, BESCHAEFTIGT,
} from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, machWc, pos, bestellung, NR, NR2, NR_AUS } from './hilfen/korb-sheet.js';

const sp = name => KORB_SPALTEN.indexOf(name);
const jetzt = () => new Date('2026-10-22T09:00:00Z');

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';
  _korbCacheLeeren();
  _resetLShopCache();
});

// Korb mit 3 Shop-Positionen aus dem echten Abgleich
async function gefuellt() {
  const tabs = grundTabs();
  const m = machSheets(tabs);
  const offene = [
    bestellung(21593, 'processing', [pos(5512, 100, 501), pos(5513, 100, 502)]),
    bestellung(21600, 'processing', [pos(5600, 100, 502, 2)]),
  ];
  await runKorbAbgleich({ sheets: m.sheets, wcFuer: () => machWc(offene), jetzt });
  m.aufrufe.update.length = 0;
  m.aufrufe.batchUpdate.length = 0;
  return { tabs, ...m, offene };
}
const zeileVon = (tabs, schluessel) => tabs[TAB_KORB].find(z => z[0] === schluessel);

// ── Teil A ───────────────────────────────────────────────────────────────────
describe('setzeStatus', () => {
  test('einzeln herausnehmen: nur Status/Grund/Notiz/Status_Datum/Stand, kein append', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    const vorher = [...zeileVon(tabs, 'JFN:21593:5512')];
    const r = await setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:21593:5512', status: 'offen' }], ziel: 'abgewählt', grund: 'schon bestellt', notiz: 'L-Shop 14.10.' });
    expect(r).toMatchObject({ ok: true, geaendert: 1 });
    const z = zeileVon(tabs, 'JFN:21593:5512');
    expect([z[sp('Status')], z[sp('Grund')], z[sp('Notiz')], z[sp('Status_Datum')], z[sp('Stand')]])
      .toEqual(['abgewählt', 'schon bestellt', 'L-Shop 14.10.', '2026-10-22T09:00:00.000Z', '2026-10-22T09:00:00.000Z']);
    const erlaubt = new Set(['Status', 'Grund', 'Notiz', 'Status_Datum', 'Stand'].map(sp));
    z.forEach((w, j) => { if (!erlaubt.has(j)) expect(w).toBe(vorher[j]); });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toHaveLength(0);
    expect(aufrufe.batchUpdate).toHaveLength(5);
  });

  test('mehrere auf einmal, dann zurueck auf offen (Grund leer, Notiz bleibt)', async () => {
    const { tabs, sheets } = await gefuellt();
    const alle = ['JFN:21593:5512', 'JFN:21593:5513', 'JFN:21600:5600'];
    await setzeStatus({ sheets, jetzt, auswahl: alle.map(s => ({ schluessel: s, status: 'offen' })), ziel: 'abgewählt', grund: 'Ware da / Lager', notiz: 'x' });
    expect(alle.map(s => zeileVon(tabs, s)[sp('Status')])).toEqual(['abgewählt', 'abgewählt', 'abgewählt']);
    await setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: alle[1], status: 'abgewählt' }], ziel: 'offen' });
    const z = zeileVon(tabs, alle[1]);
    expect([z[sp('Status')], z[sp('Grund')], z[sp('Notiz')]]).toEqual(['offen', '', 'x']);
  });

  test('Konflikt: Zeile hat sich geaendert -> 409, NICHTS geschrieben (auch nicht die anderen)', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    zeileVon(tabs, 'JFN:21600:5600')[sp('Status')] = 'abgewählt';   // anderer Browser war schneller
    await expect(setzeStatus({ sheets, jetzt, ziel: 'abgewählt', grund: 'Sonstiges', auswahl: [
      { schluessel: 'JFN:21593:5512', status: 'offen' }, { schluessel: 'JFN:21600:5600', status: 'offen' },
    ] })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe.batchUpdate).toHaveLength(0);
    expect(zeileVon(tabs, 'JFN:21593:5512')[sp('Status')]).toBe('offen');
  });

  test('unbekannter Schluessel -> 409; ohne/falscher Grund, bestellt als Ziel -> 422', async () => {
    const { sheets } = await gefuellt();
    const a = [{ schluessel: 'JFN:21593:5512', status: 'offen' }];
    await expect(setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:1:1', status: 'offen' }], ziel: 'abgewählt', grund: 'Sonstiges' })).rejects.toMatchObject({ status: 409 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'abgewählt' })).rejects.toMatchObject({ status: 422 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'abgewählt', grund: 'weil' })).rejects.toMatchObject({ status: 422 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'bestellt' })).rejects.toMatchObject({ status: 422 });
    await expect(setzeStatus({ sheets, jetzt, auswahl: a, ziel: 'offen' })).rejects.toMatchObject({ status: 422 });   // ist schon offen
  });

  test('bestellt/geliefert sind in BO3 nicht bearbeitbar', () => {
    const zeilen = [{ Schluessel: 'JFN:1:1', Status: STATUS.BESTELLT, _zeile: 2 }];
    expect(() => statusPlan({ zeilen, auswahl: [{ schluessel: 'JFN:1:1', status: 'bestellt' }], ziel: 'offen', jetzt: 'x' })).toThrow(/von dort/);
    const b = buendele([{ ...zeilen[0], LShop_ArticleNr: NR, Menge: '1' }]);
    expect(b[0].positionen[0].bearbeitbar).toBe(false);
  });

  test('Zusammenstoss mit dem Abgleich (gleiche Instanz) -> 409 "gleich nochmal"', async () => {
    const { sheets, offene } = await gefuellt();
    let freigeben;
    const haengend = { get: (...a) => new Promise(r => { freigeben = () => r(machWc(offene).get(...a)); }) };
    const lauf = runKorbAbgleich({ sheets, wcFuer: () => haengend, jetzt });
    await new Promise(r => setTimeout(r, 5));
    await expect(setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:21593:5512', status: 'offen' }], ziel: 'abgewählt', grund: 'Sonstiges' }))
      .rejects.toMatchObject({ status: 409, message: BESCHAEFTIGT });
    freigeben();
    await new Promise(r => setTimeout(r, 5));
    freigeben(); await new Promise(r => setTimeout(r, 5)); freigeben();
    await lauf;
  });
});

describe('grundVorschlag und Zaehler', () => {
  test.each([
    [HINWEIS.STORNIERT, 'Bestellung storniert'],
    [HINWEIS.ERSTATTET, 'Bestellung storniert'],
    [HINWEIS.NICHT_IM_SHOP, 'Bestellung storniert'],
    [HINWEIS.POSITION_WEG, 'Bestellung storniert'],
    [HINWEIS.ABGESCHLOSSEN, 'schon bestellt'],
    [HINWEIS.UNBEZAHLT, ''],
    ['', ''],
  ])('%s -> %s', (h, g) => { expect(grundVorschlag(h)).toBe(g); });

  test('Zaehler offen / herausgenommen / mit Hinweis', () => {
    expect(korbZaehler([
      { Status: 'offen', Hinweis: '' }, { Status: 'offen', Hinweis: HINWEIS.UNBEZAHLT },
      { Status: 'abgewählt', Hinweis: HINWEIS.STORNIERT }, { Status: 'bestellt', Hinweis: '' },
    ])).toEqual({ offen: 2, herausgenommen: 1, herausgenommenAktuell: 1, mitHinweis: 1 });   // ohne Datum = aktuell
    expect(GRUENDE).toEqual(['Ware da / Lager', 'schon bestellt', 'Bestellung storniert', 'Sonstiges']);
  });
});

// ── Teil B: eigene Positionen nur aus blanken L-Shop-Artikeln (LShop_Modelle) ───
describe('eigene Positionen aus LShop_Modelle', () => {
  const eingabe = (o = {}) => ({ articleNr: NR, menge: 3, referenz: 'Lager', notiz: '', ...o });
  const Q1 = '2000000001', Q2 = '2000000002', Q_DISC = '2000000003';
  // Zweites Modell mit L-Shop-Name (Spalte Description) und Hersteller; eine Variante Discontinued 6.
  function mitQueen(tabs) {
    const [kopf, ...rest] = tabs.LShop_Modelle;
    tabs.LShop_Modelle = [[...kopf, 'Brand', 'CatNrManufacturer', 'Description'],
      ...rest.map(r => [...r, 'James & Nicholson', 'JN030', '']),
      [Q1, 'BCWW02Q', 'White', '', 'M', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
      [Q2, 'BCWW02Q', 'White', '', 'S', '', '', '0', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt'],
      [Q_DISC, 'BCWW02Q', 'Black', '', 'M', '', '', '6', 'aktiv', 'B&C', 'TW02Q', 'Queen Women T-Shirt']];
    return tabs;
  }

  test('Nummer fortlaufend je Jahr, aus dem Reiter', () => {
    const z = s => ({ Schluessel: s });
    expect(naechsteEigenNummer([], 2026)).toBe('EIGEN:2026-0001');
    expect(naechsteEigenNummer([z('EIGEN:2026-0001'), z('EIGEN:2026-0007'), z('EIGEN:2025-0099'), z('JFN:1:2')], 2026)).toBe('EIGEN:2026-0008');
  });

  test('Suche in einer Zeile: ArticleNr, Modell, L-Shop-Name (Teilwort, Gross/Klein egal), Hersteller', () => {
    const zeilen = [
      { articleNr: NR, catalogNr: 'JH030F', marke: 'James & Nicholson', herstellerNr: 'JN030', bezeichnung: '', status: 'aktiv', discontinued: '0' },
      { articleNr: Q1, catalogNr: 'BCWW02Q', marke: 'B&C', herstellerNr: 'TW02Q', bezeichnung: 'Queen Women T-Shirt', status: 'aktiv', discontinued: '0' },
      { articleNr: Q_DISC, catalogNr: 'BCWW02Q', marke: 'B&C', herstellerNr: 'TW02Q', bezeichnung: 'Queen Women T-Shirt', status: 'aktiv', discontinued: '6' },
    ];
    const cat = s => sucheModelle(zeilen, s).modelle.map(m => m.catalogNr);
    expect(cat('queen')).toEqual(['BCWW02Q']);
    expect(cat('QUEEN wom')).toEqual(['BCWW02Q']);
    expect(cat('bcww02q')).toEqual(['BCWW02Q']);
    expect(cat('nicholson')).toEqual(['JH030F']);
    expect(cat('tw02')).toEqual(['BCWW02Q']);
    expect(sucheModelle(zeilen, Q1).modelle).toEqual([{ catalogNr: 'BCWW02Q', bezeichnung: 'Queen Women T-Shirt', marke: 'B&C', bestellbar: 1, articleNr: Q1 }]);
    expect(sucheModelle(zeilen, 'q').modelle).toEqual([]);                          // unter 2 Zeichen
    const leer = sucheModelle(zeilen, 'BCTW04T');
    expect(leer.modelle).toEqual([]);
    expect(leer.hinweis).toBe(NICHT_IM_BESTAND);
    expect(NICHT_IM_BESTAND).toBe('Nicht im Bestand – direkt bei L-Shop bestellen oder Modell über Modelle_Zusatz/LS1 aufnehmen.');
  });

  test('Farbe -> Groesse nur aus LShop_Modelle, ohne ausgelaufen und Discontinued 3/6', async () => {
    const { sheets } = machSheets(mitQueen(grundTabs()));
    const j = await lshopModellVarianten({ sheets, catalogNr: 'JH030F' });
    expect(j.varianten.map(v => v.articleNr).sort()).toEqual([NR2, NR, '1000888888'].sort());   // NR_AUS (ausgelaufen) fehlt
    const q = await lshopModellVarianten({ sheets, catalogNr: 'BCWW02Q' });
    expect(q).toMatchObject({ catalogNr: 'BCWW02Q', bezeichnung: 'Queen Women T-Shirt', marke: 'B&C' });
    expect(q.varianten.map(v => [v.farbe, v.groesse, v.articleNr])).toEqual([['White', 'S', Q2], ['White', 'M', Q1]]);   // Black/M (Disc 6) fehlt
    await expect(lshopModellVarianten({ sheets, catalogNr: 'BCTW04T' })).rejects.toMatchObject({ status: 404, message: NICHT_IM_BESTAND });
    const s = await sucheLShopModelle({ sheets, q: 'queen' });
    expect(s.modelle.map(m => [m.catalogNr, m.bezeichnung, m.marke, m.bestellbar])).toEqual([['BCWW02Q', 'Queen Women T-Shirt', 'B&C', 2]]);
  });

  test('Anlage: SSOT-ID leer, Herkunft eigen, Shop JFN, Zeile hinter der letzten, ohne append', async () => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    mitQueen(tabs); _resetLShopCache();
    const r = await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe({ articleNr: Q1 }) });
    expect(r).toMatchObject({ ok: true, schluessel: 'EIGEN:2026-0001', zeile: 5, articleNr: Q1, menge: '3' });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([`'${TAB_KORB}'!A5:R5`]);
    expect(korbZeilen(tabs[TAB_KORB]).zeilen.at(-1)).toMatchObject({ Schluessel: 'EIGEN:2026-0001', Shop: 'JFN', Herkunft: 'eigen',
      Bestellnummer: '', Position: '', Referenz: 'Lager', 'SSOT-ID': '', LShop_ArticleNr: Q1, Menge: '3', Status: 'offen', Quelle_Lauf: 'Knopf' });
    const r2 = await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe({ articleNr: NR2, referenz: 'Muster' }) });
    expect(r2.schluessel).toBe('EIGEN:2026-0002');
  });

  test.each([
    ['ohne Referenz', { referenz: '  ' }],
    ['Menge 0', { menge: 0 }],
    ['Menge 1.5', { menge: 1.5 }],
    ['ausgelaufene Variante', { articleNr: NR_AUS }],
    ['Discontinued 6', { articleNr: '2000000003' }],
    ['ArticleNr nicht in LShop_Modelle', { articleNr: '9999999999' }],
    ['keine ArticleNr', { articleNr: '' }],
    ['alte Eingabe ueber unseren Shop-Artikel', { articleNr: undefined, ssotId: '0001', wcVariationId: '501' }],
  ])('abgelehnt: %s -> 422, nichts geschrieben', async (_n, o) => {
    const { tabs, sheets, aufrufe } = await gefuellt();
    mitQueen(tabs); _resetLShopCache();
    await expect(legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe(o) })).rejects.toMatchObject({ status: 422 });
    expect(aufrufe.update).toHaveLength(0);
  });

  test('eigene Positionen erscheinen im Buendel neben Shop-Positionen', async () => {
    const { sheets } = await gefuellt();
    await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe({ menge: 2 }) });
    const k = await leseKorb({ shop: 'jfn', sheets });
    const b = k.buendel.find(x => x.articleNr === NR);
    expect(b.positionen.map(p => [p.herkunft, p.menge, p.ssotId])).toEqual([['shop', 1, '0001'], ['eigen', 2, '']]);
    expect(b.zuBestellen).toBe(3);
    expect(k.summen).toMatchObject({ offen: 4, herausgenommen: 0 });
  });
});

// ── UX: "Herausgenommen" nur 14 Tage (feste Uhr) ─────────────────────────────
describe('Herausgenommen: 14-Tage-Grenze', () => {
  const JETZT = new Date('2026-11-04T12:00:00.000Z');
  const raus = (datum, hinweis = '') => ({ Status: 'abgewählt', Status_Datum: datum, Hinweis: hinweis });
  test.each([
    ['genau 14 Tage', '2026-10-21T12:00:00.000Z', true],
    ['14 Tage + 1 ms', '2026-10-21T11:59:59.999Z', false],
    ['gestern', '2026-11-03T12:00:00.000Z', true],
    ['15 Tage', '2026-10-20T12:00:00.000Z', false],
    ['Datum leer -> zeigen', '', true],
    ['Datum unlesbar -> zeigen', 'kaputt', true],
  ])('%s', (_n, datum, erwartet) => {
    expect(rausAktuell(raus(datum), JETZT)).toBe(erwartet);
  });

  test('"noch nicht bezahlt" immer, auch alt und mit weiterem Hinweis', () => {
    expect(rausAktuell(raus('2026-01-01T00:00:00.000Z', HINWEIS.UNBEZAHLT), JETZT)).toBe(true);
    expect(rausAktuell(raus('2026-01-01T00:00:00.000Z', `${HINWEIS.UNBEZAHLT} · ${HINWEIS.MENGE}`), JETZT)).toBe(true);
    expect(rausAktuell(raus('2026-01-01T00:00:00.000Z', HINWEIS.STORNIERT), JETZT)).toBe(false);
  });

  test('leseKorb mit fester Uhr: Zaehler sichtbar/gesamt, Flag je Position, nichts geloescht', async () => {
    const { tabs, sheets } = await gefuellt();
    const sp = n => KORB_SPALTEN.indexOf(n);
    const setze = (s, status, datum, hinweis = '') => {
      const z = zeileVon(tabs, s);
      z[sp('Status')] = status; z[sp('Status_Datum')] = datum; z[sp('Hinweis')] = hinweis;
    };
    setze('JFN:21593:5512', 'abgewählt', '2026-11-01T08:00:00.000Z');                     // 3 Tage
    setze('JFN:21593:5513', 'abgewählt', '2026-09-30T08:00:00.000Z');                     // alt
    setze('JFN:21600:5600', 'abgewählt', '2026-09-01T08:00:00.000Z', HINWEIS.UNBEZAHLT);  // alt, unbezahlt
    const k = await leseKorb({ shop: 'jfn', sheets, jetzt: () => JETZT });
    expect(k.summen).toMatchObject({ herausgenommen: 3, herausgenommenAktuell: 2 });
    const flag = Object.fromEntries(k.buendel.flatMap(b => b.positionen).map(p => [p.schluessel, p.rausAktuell]));
    expect(flag).toEqual({ 'JFN:21593:5512': true, 'JFN:21593:5513': false, 'JFN:21600:5600': true });
    expect(korbZeilen(tabs[TAB_KORB]).zeilen).toHaveLength(3);
  });

  test('Frontend: Link "ältere anzeigen (n)" und Gesamtzahl klein am Knopf', () => {
    const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
    expect(html).toContain('ältere anzeigen (${rausAelter})');
    expect(html).toMatch(/raus: `\$\{rausSichtbar\} <small>\/ \$\{z\.herausgenommen\}<\/small>`/);
  });
});

// ── UX: L-Shop-Zeile und Filter ───────────────────────────────────────────────
describe('L-Shop-Zeile je Buendel und Position', () => {
  test('mit Kurzbezeichnung, ohne Kurzbezeichnung, ohne Modellzeile', () => {
    expect(lshopText('1000386845', { catalogNr: 'MRS5004', bezeichnung: 'Sport Socks', color1: 'White', color2: 'Green', size: '37/41' }))
      .toBe('1000386845 · MRS5004 · Sport Socks · White/Green · 37/41');
    expect(lshopText(NR, { catalogNr: 'JH030F', color1: 'Deep Black', size: 'XXL' })).toBe(`${NR} · JH030F · Deep Black · XXL`);
    expect(lshopText(NR, undefined)).toBe(NR);
  });

  test('leseKorb: Bezeichnung aus LShop_Modelle.Description, wenn die Spalte da ist; jede Position traegt die Zeile', async () => {
    const { tabs, sheets } = await gefuellt();
    let b = (await leseKorb({ shop: 'jfn', sheets })).buendel.find(x => x.articleNr === NR);
    expect(b.lshopText).toBe(`${NR} · JH030F · Deep Black · XXL`);
    // Positionen tragen keine eigene L-Shop-Zeile mehr (sie wiederholte nur den Buendelkopf).
    expect(b.positionen.every(p => p.lshopText === undefined)).toBe(true);
    expect(b).toMatchObject({ articleNr: NR, catalogNr: 'JH030F', bezeichnung: '', farbe: 'Deep Black', groesse: 'XXL' });

    tabs.LShop_Modelle = tabs.LShop_Modelle.map((z, i) => [...z, i === 0 ? 'Description' : 'Ugly Sweater Basic']);
    _resetLShopCache();
    b = (await leseKorb({ shop: 'jfn', sheets })).buendel.find(x => x.articleNr === NR);
    expect(b.lshopText).toBe(`${NR} · JH030F · Ugly Sweater Basic · Deep Black · XXL`);
  });
});

describe('Frontend: Filter Offen/Herausgenommen/Alle', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  test('--info in :root, Filter-CSS nur ueber var(--info), keine feste Farbe', () => {
    expect(html).toMatch(/:root\s*\{[^}]*--info:\s*#[0-9a-f]{6}/i);
    const css = html.match(/\.korb-filter button[\s\S]*?\}\s*\.korb-filter button\[aria-pressed="true"\][^}]*\}/)[0];
    expect(css).toContain('var(--info)');
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
  test('Buendelkopf: Name gelb (--accent), Variante gruen (--success), keine feste Farbe; keine L-Shop-Zeile je Position', () => {
    const regel = name => html.match(new RegExp(`\\.${name} \\{[^}]*\\}`))?.[0] ?? '';
    expect(regel('korb-kopf-name')).toContain('var(--accent)');
    expect(regel('korb-kopf-variante')).toContain('var(--success)');
    expect(regel('korb-kopf-nr')).toContain('var(--text)');
    for (const n of ['korb-kopf-name', 'korb-kopf-variante', 'korb-kopf-nr']) expect(regel(n)).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(html).not.toContain('korb-lshop');
    expect(html).not.toMatch(/\$\{hinweis\}\$\{lshop\}/);
  });

  test('drei Filterknoepfe (BO4d: kein "Bestellt" mehr), alter Schalter entfernt, Filter wird gemerkt', () => {
    expect([...html.matchAll(/data-filter="(\w+)"/g)].map(m => m[1])).toEqual(['offen', 'raus', 'alle']);
    expect(html).not.toContain('id="korb-alle"');
    expect(html).toMatch(/localStorage\.setItem\(KORB_FILTER_KEY/);
  });
});

// ── Abgleich laesst abgewählt und eigen in Ruhe ───────────────────────────────
describe('Abgleich nach BO3-Aktionen', () => {
  test('abgewählte und eigene Zeilen bleiben unberuehrt, auch bei Storno/Mengenaenderung', async () => {
    const { tabs, sheets, aufrufe, offene } = await gefuellt();
    await setzeStatus({ sheets, jetzt, auswahl: [{ schluessel: 'JFN:21593:5512', status: 'offen' }], ziel: 'abgewählt', grund: 'schon bestellt' });
    await legeEigenePositionAn({ sheets, jetzt, eingabe: eingabe() });
    const vorher = tabs[TAB_KORB].map(z => [...z]);
    aufrufe.update.length = 0; aufrufe.batchUpdate.length = 0;

    // 21593 storniert (abgewählte Zeile + offene 5513), 21600 Menge geaendert
    const storno = bestellung(21593, 'cancelled', offene[0].line_items);
    const menge  = bestellung(21600, 'processing', [pos(5600, 100, 502, 5)]);
    const wc = machWc([menge], { alle: [storno] });
    const r = await runKorbAbgleich({ sheets, wcFuer: () => wc, jetzt });

    expect(r.shops.JFN).toMatchObject({ neu: 0, hinweiseGesetzt: 2 });   // 5513 storniert, 5600 Menge
    const h = sp('Hinweis');
    expect(zeileVon(tabs, 'JFN:21593:5513')[h]).toBe(HINWEIS.STORNIERT);
    expect(zeileVon(tabs, 'JFN:21600:5600')[h]).toBe(HINWEIS.MENGE);
    for (const s of ['JFN:21593:5512', 'EIGEN:2026-0001']) {
      expect(zeileVon(tabs, s)).toEqual(vorher.find(z => z[0] === s));
    }
    expect(aufrufe.update).toHaveLength(0);
    expect(aufrufe.append).toBe(0);
  });

  function eingabe(o = {}) { return { articleNr: NR, menge: 1, referenz: 'Lager', ...o }; }
});
