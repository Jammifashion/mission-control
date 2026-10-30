// BO5-3: Lager im L-Shop-Warenkorb - Vorschlag "im Lager: n", "aus Lager nehmen" (zwei Reiter, ein Schreibaufruf),
// "zurück in den Korb", Abgleich/EDI/Matrix fassen Lager-Positionen nicht an. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB, STATUS } from '../utils/korb-logic.js';
import { TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, warenartVon, planGegenbuchung, buchungsVerlauf } from '../utils/lager.js';
import { rohlingBestandJeNr, korbAbgaenge, korbVorschlaege, ausLagerPlan, zurueckAusLagerPlan } from '../utils/lager-korb.js';
import { ediPruefung } from '../utils/edi-bestellung.js';
import { ausLagerNehmen, zurueckAusLager } from '../lib/lagerKorb.js';
import { leseKorb, runKorbAbgleich, _korbCacheLeeren } from '../lib/lshopKorb.js';
import { lagerCacheLeeren, _stammCacheLeeren } from '../lib/lager.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, machWc, pos, bestellung, NR, NR2 } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-03T09:00:00Z');
const V = n => `vorgang-korb-${String(n).padStart(4, '0')}`;
const b = (id, schluessel, menge, ort, extra = {}) => ({ id, datum: '2026-11-01T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel),
  schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx`, ...extra });
const kz = (o) => ({ _zeile: 2, Schluessel: 'JFN:100:1', Herkunft: 'shop', Status: 'offen', LShop_ArticleNr: NR, Menge: '2', Hinweis: '', ...o });

describe('Bestand und Vorschlag', () => {
  const buchungen = [b('LB-2026-00001', `LS:${NR}`, 3, 'Regal A'), b('LB-2026-00002', `LS:${NR}`, 2, 'Werkstatt'),
    b('LB-2026-00003', `LS:${NR2}`, 1, 'Regal A'), b('LB-2026-00004', 'WC:501', 9, 'Regal A')];

  test('Rohling-Bestand je ArticleNr ueber alle Orte, meiste zuerst; Fertigware zaehlt nicht', () => {
    const m = rohlingBestandJeNr(buchungen);
    expect(m.get(NR)).toEqual({ summe: 5, orte: [{ ort: 'Regal A', menge: 3 }, { ort: 'Werkstatt', menge: 2 }] });
    expect([...m.keys()].sort()).toEqual([NR, NR2].sort());
  });

  test('nur gleiche Nummer, ohne Doppelverplanung, genug nur bei Bestand >= Menge, gesperrte Positionen nie', () => {
    const p = (s, menge, o = {}) => ({ schluessel: s, menge, status: 'offen', vorschlag: true, ...o });
    const buendel = [
      { articleNr: NR, positionen: [p('a', 2), p('x', 9, { vorschlag: false }), p('b', 2), p('c', 4), p('d', 1)] },
      { articleNr: NR2, positionen: [p('e', 2)] },
      { articleNr: '1000999999', positionen: [p('f', 1)] },
    ];
    korbVorschlaege(buendel, rohlingBestandJeNr(buchungen));
    const [a, x, bb, c, d] = buendel[0].positionen;
    expect(a.lager).toEqual({ n: 5, genug: true });
    expect(x.lager).toBeUndefined();
    expect(bb.lager).toEqual({ n: 3, genug: true });
    expect(c.lager).toEqual({ n: 1, genug: false });   // "im Lager: 1 von 4", kein Knopf
    expect(d.lager).toBeUndefined();                    // nichts mehr uebrig
    expect(buendel[1].positionen[0].lager).toEqual({ n: 1, genug: false });
    expect(buendel[2].positionen[0].lager).toBeUndefined();
    expect(buendel[2].lager).toBeNull();
    expect(buendel[0].lager.orte[0]).toEqual({ ort: 'Regal A', menge: 3 });
  });
});

describe('ausLagerPlan / zurueckAusLagerPlan', () => {
  const k = (buchungen, zeilen = [kz()]) => ({ korbZeilen: zeilen, buchungen, orte: ['Regal A', 'Werkstatt'], jetzt: JETZT });
  const lager5 = [b('LB-2026-00001', `LS:${NR}`, 3, 'Regal A'), b('LB-2026-00002', `LS:${NR}`, 2, 'Werkstatt')];
  const e = (o = {}) => ({ schluessel: 'JFN:100:1', status: 'offen', verteilung: [{ ort: 'Regal A', menge: 2 }], vorgang: V(1), ...o });

  test('Korb: Status Lager (Konstante unveraendert), Grund leer; Lager: Abgang Shop, Quelle korb, Bezug Korb-Schluessel', () => {
    expect(STATUS.LAGER).toBe('Lager');
    const p = ausLagerPlan(e(), k(lager5));
    expect(p.korb).toMatchObject({ zeile: 2, werte: { Status: 'Lager', Grund: '' } });
    expect(p.lagerZeilen).toEqual([expect.objectContaining({ Buchung_ID: 'LB-2026-00003', Art: 'abgang_shop', Schluessel: `LS:${NR}`, Menge: -2,
      Ort: 'Regal A', Bezug: 'JFN:100:1', Quelle: 'korb', Vorgang: V(1), Warenart: 'rohling' })]);
  });
  test('eigene Position -> abgang_eigen; auf zwei Orte verteilt -> zwei Zeilen', () => {
    const p = ausLagerPlan(e({ schluessel: 'EIGEN:2026-0001', verteilung: [{ ort: 'Regal A', menge: 3 }, { ort: 'Werkstatt', menge: 1 }] }),
      k(lager5, [kz({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Menge: '4' })]));
    expect(p.lagerZeilen.map(z => [z.Art, z.Ort, z.Menge])).toEqual([['abgang_eigen', 'Regal A', -3], ['abgang_eigen', 'Werkstatt', -1]]);
  });
  test.each([
    [{ verteilung: [{ ort: 'Regal A', menge: 4 }] }, k(lager5, [kz({ Menge: '4' })]), 422, /nur 3 da/],   // nie negativ je Ort
    [{ verteilung: [{ ort: 'Regal A', menge: 1 }] }, k(lager5), 422, /Verteilt sind 1/],
    [{ verteilung: [{ ort: 'Keller', menge: 2 }] }, k(lager5), 422, /Keller/],
    [{ verteilung: [{ ort: 'Regal A', menge: 1 }, { ort: 'Werkstatt', menge: 1 }, { ort: 'Regal A', menge: 0 }] }, k(lager5), 422, /höchstens zwei/],
    [{ status: 'abgewählt' }, k(lager5), 409, /hat sich geändert/],
    [{}, k(lager5, [kz({ Status: 'abgewählt' })]), 409, /hat sich geändert/],
    [{}, k(lager5, [kz({ Hinweis: 'Bestellung storniert' })]), 422, /storniert/],
    [{ schluessel: 'JFN:999:1' }, k(lager5), 409, /gibt es nicht/],
    [{ vorgang: 'kurz' }, k(lager5), 422, /Kennung/],
  ])('abgelehnt: %j', (aenderung, kontext, status, text) => {
    expect(() => ausLagerPlan(e(aenderung), kontext)).toThrow(expect.objectContaining({ status, message: expect.stringMatching(text) }));
  });
  test('schon ein offener Korb-Abgang zu dieser Position -> 409', () => {
    const mit = [...lager5, b('LB-2026-00003', `LS:${NR}`, -2, 'Regal A', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:100:1' })];
    expect(() => ausLagerPlan(e({ vorgang: V(2) }), k(mit))).toThrow(expect.objectContaining({ status: 409 }));
  });
  test('Doppelklick: derselbe Vorgang -> schon gebucht', () => {
    const mit = [...lager5, b('LB-2026-00003', `LS:${NR}`, -2, 'Regal A', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:100:1', vorgang: V(3) })];
    expect(ausLagerPlan(e({ vorgang: V(3) }), k(mit, [kz({ Status: 'Lager' })])).schonGebucht.map(x => x.id)).toEqual(['LB-2026-00003']);
  });
  test('Rueckweg: Status offen + Gegenbuchung je Abgang; ohne Abgang 409; offene Position 409', () => {
    const mit = [...lager5,
      b('LB-2026-00003', `LS:${NR}`, -1, 'Regal A', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:100:1' }),
      b('LB-2026-00004', `LS:${NR}`, -1, 'Werkstatt', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:100:1' })];
    const p = zurueckAusLagerPlan({ schluessel: 'JFN:100:1', vorgang: V(4) }, k(mit, [kz({ Status: 'Lager' })]));
    expect(p.korb.werte).toMatchObject({ Status: 'offen', Grund: '' });
    expect(p.lagerZeilen.map(z => [z.Art, z.Ort, z.Menge, z.Storno_von, z.Quelle])).toEqual([
      ['korrektur', 'Regal A', 1, 'LB-2026-00003', 'korb'], ['korrektur', 'Werkstatt', 1, 'LB-2026-00004', 'korb']]);
    expect(() => zurueckAusLagerPlan({ schluessel: 'JFN:100:1', vorgang: V(5) }, k(lager5, [kz({ Status: 'Lager' })]))).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => zurueckAusLagerPlan({ schluessel: 'JFN:100:1', vorgang: V(6) }, k(mit))).toThrow(expect.objectContaining({ status: 409 }));
    // nach der Gegenbuchung ist der Abgang nicht mehr offen
    const danach = [...mit, ...p.lagerZeilen.map(z => b(z.Buchung_ID, z.Schluessel, z.Menge, z.Ort, { art: 'korrektur', quelle: 'korb', bezug: z.Bezug, stornoVon: z.Storno_von }))];
    expect(korbAbgaenge(danach).get('JFN:100:1')).toBeUndefined();
  });
  test('Korb-Abgang laesst sich im Lagerverlauf nicht von Hand gegenbuchen', () => {
    const mit = [...lager5, b('LB-2026-00003', `LS:${NR}`, -2, 'Regal A', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:100:1' })];
    expect(planGegenbuchung({ buchungId: 'LB-2026-00003', vorgang: V(7) }, { buchungen: mit }).probleme[0].code).toBe('korb');
    expect(buchungsVerlauf(mit, () => ({})).find(x => x.id === 'LB-2026-00003').gegenbuchbar).toBe(false);
  });
});

describe('Lager-Positionen nie in Bestellung, Matrix, Zaehlliste', () => {
  test('EDI-Pruefung: Position mit Status Lager ist rot (nicht offen)', () => {
    const z = { Schluessel: 'JFN:100:1', Shop: 'JFN', Herkunft: 'shop', Status: 'Lager', LShop_ArticleNr: NR, Menge: '2', Hinweis: '', Bestellnummer: '100', Position: '1' };
    const r = ediPruefung({ auswahl: [{ schluessel: z.Schluessel, status: 'Lager' }], zeilen: [z], modelle: new Map(), customerId: '00000000',
      commission: 'x', orderId: 'JFN-2026-0099', versandart: 'Standard', jetzt: JETZT });
    expect(r.gruen).toBe(false);
    expect(r.punkte.find(p => p.regel === 'vorhanden')?.treffer?.length).toBeGreaterThan(0);
  });
  test('Bestellmatrix (BO3b) zaehlt nur offene Positionen', () => {
    const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
    const block = (a, z) => html.slice(html.indexOf(a), html.indexOf(z));
    const { baueMatrix, grSortiere } = new Function(`${block('// ── Groessen: Anfang', '// ── Groessen: Ende ──')}\n${block('// ── Matrix: Anfang', '// ── Matrix: Ende ──')}\nreturn { baueMatrix, grSortiere };`)();
    const p = o => ({ schluessel: `k${Math.random()}`, status: 'offen', menge: 1, vorschlag: true, hinweis: '', herkunft: 'shop', ...o });
    const mx = baueMatrix([{ articleNr: NR, catalogNr: 'X1', farbe: 'Black', groesse: 'M', positionen: [p({ menge: 2 }), p({ status: 'Lager', menge: 5, vorschlag: false })] }], grSortiere);
    expect(mx).toMatchObject({ stueck: 2, positionen: 1 });
  });
});

// ── Schreibweg gegen das In-Memory-Sheet ─────────────────────────────────────
function tabsMit({ korb = [], buchungen = [] } = {}) {
  const tabs = grundTabs();
  tabs[TAB_KORB] = [KORB_SPALTEN, ...korb.map(o => KORB_SPALTEN.map(n => o[n] ?? ''))];
  tabs[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))];
  tabs[TAB_ORTE] = [ORTE_SPALTEN, ['Regal A', 'aktiv', ''], ['Werkstatt', 'aktiv', '']];
  tabs[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
  tabs.Trikots = [['Produktname', 'Groesse']];
  return tabs;
}
const korbZeile = o => ({ Schluessel: 'JFN:21593:5512', Shop: 'JFN', Herkunft: 'shop', Bestellnummer: '21593', Position: '5512', 'SSOT-ID': '0001',
  LShop_ArticleNr: NR, Menge: '2', Status: 'offen', Angelegt: '2026-11-01T08:00:00Z', ...o });
const zugang = (id, menge, ort) => ({ Buchung_ID: id, Datum: '2026-11-01T08:00:00Z', Art: 'vorrat', Warenart: 'rohling', Schluessel: `LS:${NR}`,
  Menge: menge, Ort: ort, Quelle: 'knopf', Vorgang: `v-${id}-xxxxxx` });

describe('lib/lagerKorb.js', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot';
    _resetLShopCache(); _korbCacheLeeren(); lagerCacheLeeren(); _stammCacheLeeren();
  });

  test('GET Korb: "im Lager" an der offenen Position, Orte am Buendel; Lager-Positionen eigener Zaehler', async () => {
    const tabs = tabsMit({ korb: [korbZeile(), korbZeile({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Bestellnummer: '', Position: '', Status: 'Lager', Menge: '1' })],
      buchungen: [zugang('LB-2026-00001', 3, 'Regal A'), { ...zugang('LB-2026-00002', -1, 'Regal A'), Art: 'abgang_eigen', Quelle: 'korb', Bezug: 'EIGEN:2026-0001' }] });
    const { sheets } = machSheets(tabs);
    const d = await leseKorb({ shop: 'jfn', sheets });
    const bnd = d.buendel.find(x => x.articleNr === NR);
    expect(bnd.lager).toEqual({ summe: 2, orte: [{ ort: 'Regal A', menge: 2 }] });
    expect(bnd.positionen.find(p => p.status === 'offen').lager).toEqual({ n: 2, genug: true });
    expect(bnd.positionen.find(p => p.status === 'Lager').lagerAbgang).toEqual([expect.objectContaining({ ort: 'Regal A', menge: 1 })]);
    expect(d.summen).toMatchObject({ positionen: 1, offen: 1, lager: 1 });
  });

  test('ohne Lager-Reiter: Korb wie bisher, ohne Vorschlag', async () => {
    const tabs = grundTabs();
    tabs[TAB_KORB] = [KORB_SPALTEN, KORB_SPALTEN.map(n => korbZeile()[n] ?? '')];
    const d = await leseKorb({ shop: 'jfn', sheets: machSheets(tabs).sheets });
    expect(d.buendel[0].lager).toBeNull();
    expect(d.lagerHinweis).toBe('');
  });

  test('aus Lager nehmen: EIN batchUpdate ueber beide Reiter, kein append, zurueckgelesen; Doppelklick schreibt nichts', async () => {
    const tabs = tabsMit({ korb: [korbZeile()], buchungen: [zugang('LB-2026-00001', 3, 'Regal A')] });
    const { sheets, aufrufe } = machSheets(tabs);
    const eingabe = { schluessel: 'JFN:21593:5512', status: 'offen', verteilung: [{ ort: 'Regal A', menge: 2 }], vorgang: V(10) };
    const r = await ausLagerNehmen({ eingabe, sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, status: 'Lager', buchungen: ['LB-2026-00002'], stueck: 2 });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.batchUpdate.some(x => x.startsWith(`'${TAB_KORB}'`))).toBe(true);
    expect(aufrufe.batchUpdate).toContain(`'${TAB_BUCHUNGEN}'!A3:N3`);
    const iStatus = KORB_SPALTEN.indexOf('Status');
    expect(tabs[TAB_KORB][1][iStatus]).toBe('Lager');
    expect(tabs[TAB_BUCHUNGEN][2].slice(2, 8)).toEqual(['abgang_shop', 'rohling', `LS:${NR}`, -2, 'Regal A', '']);
    const vorher = aufrufe.batchUpdate.length;
    const zwei = await ausLagerNehmen({ eingabe, sheets, jetzt: () => JETZT });
    expect(zwei).toMatchObject({ ok: true, schonGebucht: true });
    expect(aufrufe.batchUpdate.length).toBe(vorher);
  });

  test('nie negativ ueber den Schreibweg: 422, nichts geschrieben', async () => {
    const { sheets, aufrufe } = machSheets(tabsMit({ korb: [korbZeile({ Menge: '5' })], buchungen: [zugang('LB-2026-00001', 3, 'Regal A')] }));
    await expect(ausLagerNehmen({ eingabe: { schluessel: 'JFN:21593:5512', status: 'offen', verteilung: [{ ort: 'Regal A', menge: 5 }], vorgang: V(11) }, sheets }))
      .rejects.toMatchObject({ status: 422 });
    expect(aufrufe.batchUpdate).toEqual([]);
  });

  test('alles oder nichts: Zielzeilen im Journal belegt (andere Instanz) -> 409, kein Schreibaufruf', async () => {
    const tabs = tabsMit({ korb: [korbZeile()], buchungen: [zugang('LB-2026-00001', 3, 'Regal A')] });
    const { sheets, aufrufe } = machSheets(tabs);
    const get = sheets.spreadsheets.values.get;
    let n = 0;
    sheets.spreadsheets.values.get = async a => {
      const r = await get(a);
      if (String(a.range) === `'${TAB_BUCHUNGEN}'` && n++ === 0) tabs[TAB_BUCHUNGEN].push(['LB-2026-00009']);
      return r;
    };
    await expect(ausLagerNehmen({ eingabe: { schluessel: 'JFN:21593:5512', status: 'offen', verteilung: [{ ort: 'Regal A', menge: 2 }], vorgang: V(12) }, sheets }))
      .rejects.toMatchObject({ status: 409, code: 'konflikt' });
    expect(aufrufe.batchUpdate).toEqual([]);
    expect(tabs[TAB_KORB][1][KORB_SPALTEN.indexOf('Status')]).toBe('offen');
  });

  test('zurueck in den Korb: Status offen, Bestand wieder da; Abgleich aendert den Status Lager nie', async () => {
    const tabs = tabsMit({ korb: [korbZeile()], buchungen: [zugang('LB-2026-00001', 3, 'Regal A')] });
    const { sheets } = machSheets(tabs);
    await ausLagerNehmen({ eingabe: { schluessel: 'JFN:21593:5512', status: 'offen', verteilung: [{ ort: 'Regal A', menge: 2 }], vorgang: V(13) }, sheets, jetzt: () => JETZT });
    // Abgleich mit derselben (inzwischen stornierten) Bestellung: Status bleibt Lager, kein Hinweis, keine neue Zeile
    await runKorbAbgleich({ sheets, wcFuer: () => machWc([bestellung(21593, 'processing', [pos(5512, 100, 501, 2)])], { alle: [bestellung(21593, 'cancelled', [pos(5512, 100, 501, 2)])] }), jetzt: () => JETZT });
    const iS = KORB_SPALTEN.indexOf('Status'), iH = KORB_SPALTEN.indexOf('Hinweis');
    expect(tabs[TAB_KORB].slice(1).map(z => [z[0], z[iS], z[iH] ?? ''])).toEqual([['JFN:21593:5512', 'Lager', '']]);
    const r = await zurueckAusLager({ eingabe: { schluessel: 'JFN:21593:5512', vorgang: V(14) }, sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, status: 'offen', buchungen: ['LB-2026-00003'] });
    expect(tabs[TAB_KORB][1][iS]).toBe('offen');
    lagerCacheLeeren();
    const d = await leseKorb({ shop: 'jfn', sheets });
    expect(d.buendel.find(x => x.articleNr === NR).lager.summe).toBe(3);
  });
});

describe('Frontend-Block Korb-Lager', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = html.slice(html.indexOf('// ── Korb-Lager: Anfang'), html.indexOf('// ── Korb-Lager: Ende ──'));
  const F = new Function(`${block}\nreturn { korbLagerHtml, korbLagerVorbelegung, korbLagerVerteilung, korbLagerOrteText };`)();
  const orte = [{ ort: 'Regal A', menge: 3 }, { ort: 'Werkstatt', menge: 2 }, { ort: 'Keller', menge: 1 }];

  test('Kennzeichen: genug -> Zahl + Knopf, zu wenig -> "n von m" ohne Knopf, Orte im title', () => {
    const bnd = { articleNr: NR, lager: { summe: 5, orte } };
    const genug = F.korbLagerHtml({ schluessel: 'a', status: 'offen', menge: 2, lager: { n: 5, genug: true } }, bnd);
    expect(genug).toMatch(/im Lager: 5/);
    expect(genug).toMatch(/data-aus-lager="a"/);
    expect(genug).toMatch(/title="Regal A: 3 · Werkstatt: 2 · Keller: 1"/);
    const knapp = F.korbLagerHtml({ schluessel: 'b', status: 'offen', menge: 4, lager: { n: 1, genug: false } }, bnd);
    expect(knapp).toMatch(/im Lager: 1 von 4/);
    expect(knapp).not.toMatch(/data-aus-lager/);
    expect(F.korbLagerHtml({ schluessel: 'c', status: 'offen', menge: 1 }, bnd)).toBe('');
    expect(F.korbLagerHtml({ schluessel: 'd', status: 'Lager', menge: 1, lagerAbgang: [{ ort: 'Regal A', menge: 1 }] }, bnd)).toMatch(/aus Lager \(Regal A: 1\)[\s\S]*data-lager-zurueck="d"/);
  });
  test('Vorbelegung: meister Ort zuerst, Rest auf den zweiten, nie ein dritter', () => {
    expect(F.korbLagerVorbelegung(orte, 4).map(o => o.menge)).toEqual([3, 1, 0]);
    expect(F.korbLagerVorbelegung(orte, 2).map(o => o.menge)).toEqual([2, 0, 0]);
  });
  test('Verteilung pruefen: Summe, mehr als da, hoechstens zwei Orte', () => {
    const z = (e1, e2, e3 = '') => [{ ort: 'Regal A', da: 3, eingabe: e1 }, { ort: 'Werkstatt', da: 2, eingabe: e2 }, { ort: 'Keller', da: 1, eingabe: e3 }];
    expect(F.korbLagerVerteilung(z('3', '1'), 4)).toEqual({ verteilung: [{ ort: 'Regal A', menge: 3 }, { ort: 'Werkstatt', menge: 1 }], fehler: [], summe: 4 });
    expect(F.korbLagerVerteilung(z('4', ''), 4).fehler).toEqual(['Regal A: nur 3 da']);
    expect(F.korbLagerVerteilung(z('1', '1', '1'), 3).fehler).toEqual(['höchstens zwei Orte']);
    expect(F.korbLagerVerteilung(z('1', ''), 2).fehler).toEqual(['verteilt 1 von 2']);
  });
  test('Filter "Aus Lager" im Korb, "Alle" ohne Lager; Grund-Hinweis vorhanden', () => {
    expect(html).toMatch(/data-filter="lager" data-hilfe="filter-lager"/);
    expect(html).toMatch(/korbZustand\.filter === 'alle' \? p\.status === 'offen' \|\| p\.status === 'abgewählt'/);
    expect(html).toMatch(/Lieber „aus Lager nehmen“ – dann stimmt der Bestand\./);
  });
});
