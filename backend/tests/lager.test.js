// BO5-1 Lager: Logik (utils/lager.js), Schreibweg (lib/lager.js) gegen ein In-Memory-Sheet, Setup-Plan.
// Nur erfundene Daten.

import {
  TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, warenartVon, trikotSchluessel,
  buchungenAus, bestandAus, bestandVon, planBuchung, planGegenbuchung, planNeuerOrt, planNeuerArtikel, naechsteBuchungNr,
  buchungsVerlauf,
} from '../utils/lager.js';
import { reiterPlan, LAGER_REITER } from '../utils/lager-setup.js';
import { bucheLager, gegenbuchung, neuerOrt, neuerArtikel, leseBestand, rohlingVarianten, fertigVarianten, trikotAuswahl,
  lagerCacheLeeren, _stammCacheLeeren } from '../lib/lager.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, NR, NR2, NR_AUS } from './hilfen/korb-sheet.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const JETZT = new Date('2026-11-02T10:00:00Z');
const V = n => `vorgang-test-${String(n).padStart(4, '0')}`;
const LS = `LS:${NR}`, LS2 = `LS:${NR2}`;

// Journal-Zeilen fuer die reine Logik (gleiches Format wie buchungenAus).
const b = (id, schluessel, menge, ort, extra = {}) => ({ id, datum: `2026-11-01T0${id.slice(-1)}:00:00Z`, art: 'vorrat', warenart: warenartVon(schluessel),
  schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxxx`, ...extra });
const ORTE = ['Regal A', 'Werkstatt'];
const gueltig = () => true;

describe('Schluessel', () => {
  test.each([
    [`LS:${NR}`, 'rohling'], ['WC:501', 'fertig'], ['TR:900:XL', 'trikot'], ['TR:900:140', 'trikot'], ['EX:AB-12', 'fremd'],
    ['FREI:LA-0001', 'frei'],
  ])('%s -> %s', (s, wa) => expect(warenartVon(s)).toBe(wa));
  test.each(['LS:123', 'WC:abc', 'TR:900', 'FREI:LA-1', 'XX:1', '', 'EX:', 'TR:900:Max Muster'])('ungueltig: %s', s => expect(warenartVon(s)).toBeNull());
  test('Trikot-Schluessel ohne Leerzeichen, nie mit Name', () => expect(trikotSchluessel('900', ' 2XL ')).toBe('TR:900:2XL'));
});

describe('Bestand wird gerechnet', () => {
  test('Summe je Schluessel + Ort, Zu- und Abgaenge', () => {
    const bs = [b('LB-2026-00001', LS, 5, 'Regal A'), b('LB-2026-00002', LS, -2, 'Regal A'), b('LB-2026-00003', LS, 3, 'Werkstatt'), b('LB-2026-00004', LS2, 1, 'Regal A')];
    const m = bestandAus(bs);
    expect(bestandVon(m, LS, 'Regal A')).toBe(3);
    expect(bestandVon(m, LS, 'Werkstatt')).toBe(3);
    expect(bestandVon(m, LS2, 'Regal A')).toBe(1);
    expect(bestandVon(m, LS2, 'Werkstatt')).toBe(0);
  });
  test('Journal lesen ueber Spaltennamen, Reihenfolge egal; kaputte Menge = 0 + Hinweis', () => {
    const kopf = [...BUCHUNG_SPALTEN].reverse();
    const zeile = o => kopf.map(k => o[k] ?? '');
    const r = buchungenAus([kopf, zeile({ Buchung_ID: 'LB-2026-00001', Schluessel: LS, Menge: 4, Ort: 'Regal A' }), [], zeile({ Buchung_ID: 'LB-2026-00002', Schluessel: LS, Menge: 'x', Ort: 'Regal A' })]);
    expect(r.fehlt).toEqual([]);
    expect(r.buchungen.map(x => [x.zeile, x.menge])).toEqual([[2, 4], [4, 0]]);
    expect(r.hinweise).toHaveLength(1);
  });
  test('Buchungsnummer: hoechste + 1 je Jahr', () => {
    expect(naechsteBuchungNr([b('LB-2026-00007', LS, 1, 'Regal A'), b('LB-2025-00099', LS, 1, 'Regal A')], 2026)).toBe(8);
    expect(naechsteBuchungNr([], 2027)).toBe(1);
  });
});

describe('planBuchung', () => {
  const k = (buchungen = []) => ({ buchungen, orte: ORTE, gueltig, jetzt: JETZT });

  test('Einbuchen mit Raster: mehrere Groessen -> mehrere Zeilen, leer zaehlt nicht', () => {
    const p = planBuchung({ aktion: 'einbuchen', art: 'vorrat', ort: 'Regal A', vorgang: V(1), notiz: 'Kiste 2',
      posten: [{ schluessel: LS, menge: '5' }, { schluessel: LS2, menge: 3 }, { schluessel: 'LS:1000000003', menge: '' }] }, k());
    expect(p.probleme).toEqual([]);
    expect(p.zeilen.map(z => [z.Buchung_ID, z.Schluessel, z.Menge, z.Ort, z.Art, z.Warenart, z.Quelle, z.Vorgang])).toEqual([
      ['LB-2026-00001', LS, 5, 'Regal A', 'vorrat', 'rohling', 'knopf', V(1)],
      ['LB-2026-00002', LS2, 3, 'Regal A', 'vorrat', 'rohling', 'knopf', V(1)],
    ]);
    expect(p.zeilen[0].Notiz).toBe('Kiste 2');
  });

  test.each([
    ['fertig', 'WC:501'], ['trikot', 'TR:900:XL'], ['fremd', 'EX:x'], ['frei', 'FREI:LA-0001'],
  ])('Einbuchen je Warenart: %s', (wa, s) => {
    const p = planBuchung({ aktion: 'einbuchen', art: 'retoure', ort: 'Werkstatt', vorgang: V(2), posten: [{ schluessel: s, menge: 1 }] }, k());
    expect(p.zeilen.map(z => [z.Warenart, z.Art])).toEqual([[wa, 'retoure']]);
  });

  test('Startbestand = Einbuchen mit Art inventur, Quelle start', () => {
    const p = planBuchung({ aktion: 'start', ort: 'Regal A', vorgang: V(3), posten: [{ schluessel: LS, menge: 7 }] }, k());
    expect(p.zeilen.map(z => [z.Art, z.Quelle, z.Menge])).toEqual([['inventur', 'start', 7]]);
  });

  test('Ausbuchen: nie negativ - Bestand am Ort zaehlt, nicht der an anderen Orten', () => {
    const vorher = [b('LB-2026-00001', LS, 2, 'Regal A'), b('LB-2026-00002', LS, 9, 'Werkstatt')];
    const zuViel = planBuchung({ aktion: 'ausbuchen', art: 'abgang_vorort', ort: 'Regal A', vorgang: V(4), posten: [{ schluessel: LS, menge: 3 }] }, k(vorher));
    expect(zuViel.zeilen).toEqual([]);
    expect(zuViel.probleme[0]).toMatchObject({ code: 'bestand', da: 2 });
    expect(zuViel.probleme[0].text).toMatch(/nur 2 da/);
    const ok = planBuchung({ aktion: 'ausbuchen', art: 'abgang_partner', ort: 'Regal A', vorgang: V(5), grund: 'Muster', posten: [{ schluessel: LS, menge: 2 }] }, k(vorher));
    expect(ok.zeilen.map(z => [z.Menge, z.Art, z.Grund])).toEqual([[-2, 'abgang_partner', 'Muster']]);
    const nichts = planBuchung({ aktion: 'ausbuchen', art: 'abgang_vorort', ort: 'Regal A', vorgang: V(6), posten: [{ schluessel: LS2, menge: 1 }] }, k(vorher));
    expect(nichts.probleme[0].text).toMatch(/nichts da/);
  });

  test('alles oder nichts: ein Problem in einer Zeile verhindert alle', () => {
    const vorher = [b('LB-2026-00001', LS, 2, 'Regal A')];
    const p = planBuchung({ aktion: 'ausbuchen', art: 'abgang_vorort', ort: 'Regal A', vorgang: V(7),
      posten: [{ schluessel: LS, menge: 1 }, { schluessel: LS2, menge: 1 }] }, k(vorher));
    expect(p.zeilen).toEqual([]);
    expect(p.probleme).toHaveLength(1);
  });

  test('Umlagerung = zwei Zeilen, gegenseitig verknuepft', () => {
    const vorher = [b('LB-2026-00001', LS, 4, 'Regal A')];
    const p = planBuchung({ aktion: 'umlagern', ort: 'Regal A', zielOrt: 'Werkstatt', vorgang: V(8), posten: [{ schluessel: LS, menge: 3 }] }, k(vorher));
    expect(p.zeilen.map(z => [z.Buchung_ID, z.Ort, z.Menge, z.Art, z.Bezug])).toEqual([
      ['LB-2026-00002', 'Regal A', -3, 'umlagerung', 'LB-2026-00003'],
      ['LB-2026-00003', 'Werkstatt', 3, 'umlagerung', 'LB-2026-00002'],
    ]);
    expect(planBuchung({ aktion: 'umlagern', ort: 'Regal A', zielOrt: 'Regal A', vorgang: V(9), posten: [{ schluessel: LS, menge: 1 }] }, k(vorher)).probleme[0].code).toBe('zielOrt');
    expect(planBuchung({ aktion: 'umlagern', ort: 'Regal A', zielOrt: 'Werkstatt', vorgang: V(9), posten: [{ schluessel: LS, menge: 5 }] }, k(vorher)).probleme[0].code).toBe('bestand');
  });

  test('Zaehlung bucht nur die Differenz, gleich = keine Zeile, 0 gezaehlt = alles raus', () => {
    const vorher = [b('LB-2026-00001', LS, 4, 'Regal A'), b('LB-2026-00002', LS2, 2, 'Regal A')];
    const p = planBuchung({ aktion: 'zaehlung', ort: 'Regal A', vorgang: V(10),
      posten: [{ schluessel: LS, menge: 4 }, { schluessel: LS2, menge: 0 }, { schluessel: 'WC:501', menge: 3 }] }, k(vorher));
    expect(p.zeilen.map(z => [z.Schluessel, z.Menge, z.Art, z.Quelle])).toEqual([[LS2, -2, 'inventur', 'inventur'], ['WC:501', 3, 'inventur', 'inventur']]);
    const gleich = planBuchung({ aktion: 'zaehlung', ort: 'Regal A', vorgang: V(11), posten: [{ schluessel: LS, menge: 4 }] }, k(vorher));
    expect(gleich.probleme[0].code).toBe('leer');
  });

  test.each([
    [{ ort: 'Keller' }, 'ort'], [{ ort: '' }, 'ort'], [{ art: 'abgang_vorort' }, 'art'], [{ vorgang: 'x' }, 'vorgang'],
    [{ posten: [{ schluessel: LS, menge: 0 }] }, 'menge'], [{ posten: [{ schluessel: LS, menge: '1,5' }] }, 'menge'],
    [{ posten: [{ schluessel: LS, menge: 10000 }] }, 'menge'], [{ posten: [{ schluessel: 'LS:12', menge: 1 }] }, 'schluessel'],
    [{ posten: [{ schluessel: LS, menge: 1 }, { schluessel: LS, menge: 2 }] }, 'doppelt'], [{ posten: [] }, 'leer'],
    [{ notiz: 'x'.repeat(201) }, 'notiz'],
  ])('Eingabe %j -> Problem %s', (aenderung, code) => {
    const p = planBuchung({ aktion: 'einbuchen', art: 'vorrat', ort: 'Regal A', vorgang: V(12), posten: [{ schluessel: LS, menge: 1 }], ...aenderung }, k());
    expect(p.zeilen).toEqual([]);
    expect(p.probleme.map(x => x.code)).toContain(code);
  });

  test('nicht gepflegter Artikel wird abgelehnt', () => {
    const p = planBuchung({ aktion: 'einbuchen', art: 'vorrat', ort: 'Regal A', vorgang: V(13), posten: [{ schluessel: 'WC:999', menge: 1 }] },
      { ...k(), gueltig: s => s === 'WC:999' ? 'Variante 999 ist nicht gepflegt.' : true });
    expect(p.probleme[0].text).toBe('Variante 999 ist nicht gepflegt.');
  });

  test('Doppelklick: derselbe Vorgang bucht nichts, liefert die vorhandenen Buchungen', () => {
    const vorher = [b('LB-2026-00001', LS, 4, 'Regal A', { vorgang: V(14) })];
    const p = planBuchung({ aktion: 'einbuchen', art: 'vorrat', ort: 'Regal A', vorgang: V(14), posten: [{ schluessel: LS, menge: 4 }] }, k(vorher));
    expect(p.zeilen).toEqual([]);
    expect(p.schonGebucht.map(x => x.id)).toEqual(['LB-2026-00001']);
  });
});

describe('planGegenbuchung', () => {
  test('Zugang gegenbuchen: Minus-Zeile mit Storno_von, Art korrektur; nie doppelt', () => {
    const vorher = [b('LB-2026-00001', LS, 4, 'Regal A')];
    const p = planGegenbuchung({ buchungId: 'LB-2026-00001', vorgang: V(20) }, { buchungen: vorher, jetzt: JETZT });
    expect(p.zeilen.map(z => [z.Buchung_ID, z.Menge, z.Art, z.Storno_von, z.Ort])).toEqual([['LB-2026-00002', -4, 'korrektur', 'LB-2026-00001', 'Regal A']]);
    const danach = [...vorher, b('LB-2026-00002', LS, -4, 'Regal A', { art: 'korrektur', stornoVon: 'LB-2026-00001' })];
    expect(planGegenbuchung({ buchungId: 'LB-2026-00001', vorgang: V(21) }, { buchungen: danach }).probleme[0].code).toBe('doppelt');
    expect(planGegenbuchung({ buchungId: 'LB-2026-00002', vorgang: V(22) }, { buchungen: danach }).probleme[0].code).toBe('korrektur');
    expect(planGegenbuchung({ buchungId: 'LB-2026-00009', vorgang: V(23) }, { buchungen: danach }).status).toBe(404);
  });
  test('Gegenbuchung, die negativ machen wuerde, ist gesperrt', () => {
    const vorher = [b('LB-2026-00001', LS, 4, 'Regal A'), b('LB-2026-00002', LS, -3, 'Regal A', { art: 'abgang_vorort' })];
    expect(planGegenbuchung({ buchungId: 'LB-2026-00001', vorgang: V(24) }, { buchungen: vorher }).probleme[0].code).toBe('bestand');
    // Abgang gegenbuchen geht (Ware wieder da)
    expect(planGegenbuchung({ buchungId: 'LB-2026-00002', vorgang: V(25) }, { buchungen: vorher, jetzt: JETZT }).zeilen[0].Menge).toBe(3);
  });
  test('Umlagerung: beide Zeilen werden zurueckgenommen', () => {
    const vorher = [b('LB-2026-00001', LS, 4, 'Regal A'),
      b('LB-2026-00002', LS, -3, 'Regal A', { art: 'umlagerung', bezug: 'LB-2026-00003' }),
      b('LB-2026-00003', LS, 3, 'Werkstatt', { art: 'umlagerung', bezug: 'LB-2026-00002' })];
    const p = planGegenbuchung({ buchungId: 'LB-2026-00003', vorgang: V(26) }, { buchungen: vorher, jetzt: JETZT });
    expect(p.zeilen.map(z => [z.Ort, z.Menge, z.Storno_von])).toEqual([['Werkstatt', -3, 'LB-2026-00003'], ['Regal A', 3, 'LB-2026-00002']]);
  });
  test('Verlauf: neueste oben, gegengebucht markiert', () => {
    const bs = [b('LB-2026-00001', LS, 4, 'Regal A'), b('LB-2026-00002', LS, -4, 'Regal A', { art: 'korrektur', stornoVon: 'LB-2026-00001' })];
    const v = buchungsVerlauf(bs, () => ({ modell: 'M' }));
    expect(v.map(x => [x.id, x.gegengebucht, x.gegenbuchbar])).toEqual([['LB-2026-00002', false, false], ['LB-2026-00001', true, false]]);
  });
});

describe('Orte und Freitext-Artikel', () => {
  test('neuer Ort: eindeutig ohne Gross/Klein, 2-40 Zeichen', () => {
    const orte = [{ ort: 'Regal A', status: 'aktiv' }];
    expect(planNeuerOrt({ ort: '  Kiste   Crocodiles ' }, orte).zeile).toEqual({ Ort: 'Kiste Crocodiles', Status: 'aktiv', Notiz: '' });
    expect(planNeuerOrt({ ort: 'regal a' }, orte)).toMatchObject({ vorhanden: 'Regal A' });
    expect(planNeuerOrt({ ort: 'x' }, orte).probleme[0].code).toBe('ort');
  });
  test('neuer Freitext-Artikel: LA-Nummer hoechste + 1, Dublette wird erkannt', () => {
    const artikel = [{ laNr: 'LA-0002', bezeichnung: 'Beutel', farbe: 'Rot', groesse: '' }];
    const p = planNeuerArtikel({ bezeichnung: 'Cap', warenart: 'sonstiges', farbe: 'Schwarz' }, artikel);
    expect(p.laNr).toBe('LA-0003');
    expect(p.zeile).toMatchObject({ 'LA-Nr': 'LA-0003', Bezeichnung: 'Cap', Warenart: 'sonstiges', Farbe: 'Schwarz', Status: 'aktiv' });
    expect(planNeuerArtikel({ bezeichnung: 'beutel', warenart: 'sonstiges', farbe: 'rot' }, artikel)).toMatchObject({ vorhanden: 'LA-0002' });
    expect(planNeuerArtikel({ bezeichnung: 'Cap', warenart: 'egal' }, artikel).probleme[0].code).toBe('warenart');
  });
});

describe('Setup-Plan', () => {
  test('legt fehlende Reiter an, fasst vorhandene nicht an, meldet fehlende Spalten', () => {
    expect(reiterPlan(['Produkt_Inventar']).neu.map(r => r.tab)).toEqual([TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE]);
    const zweiter = reiterPlan(['Produkt_Inventar', TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE],
      { [TAB_BUCHUNGEN]: BUCHUNG_SPALTEN, [TAB_ARTIKEL]: ARTIKEL_SPALTEN, [TAB_ORTE]: ['Ort', 'Status'] });
    expect(zweiter.neu).toEqual([]);
    expect(zweiter.vorhanden.map(v => [v.tab, v.fehlt])).toEqual([[TAB_BUCHUNGEN, []], [TAB_ARTIKEL, []], [TAB_ORTE, ['Notiz']]]);
  });
  test('Textspalten gibt es im Reiter', () => {
    for (const r of LAGER_REITER) for (const n of r.text) expect(r.spalten).toContain(n);
  });
  test('Skript: Trockenlauf Standard, nie append/delete, kein bestehender Reiter', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/setup-lager-reiter.js'), 'utf8');
    expect(src).toMatch(/process\.argv\.includes\('--write'\)/);
    expect(src).not.toMatch(/values\.append|deleteSheet|deleteDimension|\.clear\(/);
  });
});

// ── Schreibweg gegen das In-Memory-Sheet ─────────────────────────────────────

function lagerTabs({ buchungen = [], orte = ['Regal A', 'Werkstatt'], artikel = [] } = {}) {
  const tabs = grundTabs({ mitKorb: false });
  tabs.Trikots = [['Produktname', 'Groesse', 'Name'], ['Trikot Heim', '140', 'GEHEIM'], ['Trikot Heim', 'M', 'GEHEIM']];
  tabs.Erfassungsmaske.push(['0009', '900', 'Trikot Heim', 'TR-H']);
  tabs[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))];
  tabs[TAB_ORTE] = [ORTE_SPALTEN, ...orte.map(o => [o, 'aktiv', ''])];
  tabs[TAB_ARTIKEL] = [ARTIKEL_SPALTEN, ...artikel];
  return tabs;
}
const ein = (n, posten, extra = {}) => ({ aktion: 'einbuchen', art: 'vorrat', ort: 'Regal A', vorgang: V(n), posten, ...extra });

describe('lib/lager.js', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'biz';
    _resetLShopCache(); _stammCacheLeeren(); lagerCacheLeeren();
  });

  test('Einbuchen: Zeilen hinten, kein append, zurueckgelesen; Bestand danach gerechnet', async () => {
    const tabs = lagerTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    const r = await bucheLager({ eingabe: ein(1, [{ schluessel: LS, menge: 5 }, { schluessel: LS2, menge: 2 }]), sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, startZeile: 2, zeilen: 2, stueck: 7, buchungen: ['LB-2026-00001', 'LB-2026-00002'] });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([`'${TAB_BUCHUNGEN}'!A2:N3`]);
    expect(tabs[TAB_BUCHUNGEN][1].slice(0, 7)).toEqual(['LB-2026-00001', JETZT.toISOString(), 'vorrat', 'rohling', LS, 5, 'Regal A']);
    const best = await leseBestand({ sheets });
    expect(best.einrichtung).toEqual([]);
    expect(best.posten.map(p => [p.schluessel, p.ort, p.menge, p.modell, p.farbe, p.groesse])).toEqual([
      [LS2, 'Regal A', 2, 'JH030F', 'Deep Black', 'XL'], [LS, 'Regal A', 5, 'JH030F', 'Deep Black', 'XXL'],
    ]);
  });

  test('Doppelklick: zweiter Aufruf mit demselben Vorgang schreibt nichts', async () => {
    const tabs = lagerTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    await bucheLager({ eingabe: ein(2, [{ schluessel: LS, menge: 1 }]), sheets, jetzt: () => JETZT });
    const zwei = await bucheLager({ eingabe: ein(2, [{ schluessel: LS, menge: 1 }]), sheets, jetzt: () => JETZT });
    expect(zwei).toMatchObject({ ok: true, schonGebucht: true, buchungen: ['LB-2026-00001'] });
    expect(aufrufe.update).toHaveLength(1);
    expect(tabs[TAB_BUCHUNGEN]).toHaveLength(2);
  });

  test('gleichzeitig zweimal: der zweite bekommt 409, nur einer schreibt', async () => {
    const { sheets, aufrufe } = machSheets(lagerTabs());
    const [a, c] = await Promise.allSettled([
      bucheLager({ eingabe: ein(3, [{ schluessel: LS, menge: 1 }]), sheets, jetzt: () => JETZT }),
      bucheLager({ eingabe: ein(4, [{ schluessel: LS, menge: 1 }]), sheets, jetzt: () => JETZT }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(c.reason).toMatchObject({ status: 409, code: 'laeuft_gerade' });
    expect(aufrufe.update).toHaveLength(1);
  });

  test('anderer Schreiber zwischen Lesen und Schreiben (Zielbereich belegt) -> 409, nichts geschrieben', async () => {
    const tabs = lagerTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    const get = sheets.spreadsheets.values.get;
    let n = 0;
    sheets.spreadsheets.values.get = async a => {
      // Nach dem Lesen des Journals schreibt "jemand anders" eine Zeile.
      const r = await get(a);
      if (String(a.range) === `'${TAB_BUCHUNGEN}'` && n++ === 0) tabs[TAB_BUCHUNGEN].push(['LB-2026-00001', '', 'vorrat', 'rohling', LS, 1, 'Regal A']);
      return r;
    };
    await expect(bucheLager({ eingabe: ein(5, [{ schluessel: LS, menge: 1 }]), sheets, jetzt: () => JETZT })).rejects.toMatchObject({ status: 409, code: 'konflikt' });
    expect(aufrufe.update).toEqual([]);
  });

  test('Ausbuchen ueber den Bestand: 422, nichts geschrieben', async () => {
    const tabs = lagerTabs();
    const { sheets, aufrufe } = machSheets(tabs);
    await bucheLager({ eingabe: ein(6, [{ schluessel: LS, menge: 2 }]), sheets, jetzt: () => JETZT });
    await expect(bucheLager({ eingabe: { aktion: 'ausbuchen', art: 'abgang_vorort', ort: 'Regal A', vorgang: V(7), posten: [{ schluessel: LS, menge: 3 }] }, sheets, jetzt: () => JETZT }))
      .rejects.toMatchObject({ status: 422, code: 'nicht_gebucht' });
    expect(aufrufe.update).toHaveLength(1);
  });

  test('Umlagern und Gegenbuchung ueber den Schreibweg', async () => {
    const tabs = lagerTabs();
    const { sheets } = machSheets(tabs);
    await bucheLager({ eingabe: ein(8, [{ schluessel: LS, menge: 4 }]), sheets, jetzt: () => JETZT });
    const u = await bucheLager({ eingabe: { aktion: 'umlagern', ort: 'Regal A', zielOrt: 'Werkstatt', vorgang: V(9), posten: [{ schluessel: LS, menge: 3 }] }, sheets, jetzt: () => JETZT });
    expect(u.zeilen).toBe(2);
    const g = await gegenbuchung({ eingabe: { buchungId: u.buchungen[0], vorgang: V(10) }, sheets, jetzt: () => JETZT });
    expect(g.zeilen).toBe(2);
    const best = await leseBestand({ sheets });
    expect(best.posten.filter(p => p.schluessel === LS).map(p => [p.ort, p.menge])).toEqual([['Regal A', 4], ['Werkstatt', 0]]);
  });

  test('nicht gepflegte Variante und unbekannter Ort werden abgelehnt', async () => {
    const { sheets } = machSheets(lagerTabs());
    await expect(bucheLager({ eingabe: ein(11, [{ schluessel: 'WC:999', menge: 1 }]), sheets })).rejects.toMatchObject({ status: 422 });
    await expect(bucheLager({ eingabe: ein(12, [{ schluessel: LS, menge: 1 }], { ort: 'Keller' }), sheets })).rejects.toMatchObject({ status: 422 });
  });

  test('Reiter fehlt: 409 einrichtung, Bestand meldet es', async () => {
    const tabs = grundTabs({ mitKorb: false });
    const { sheets } = machSheets(tabs);
    await expect(bucheLager({ eingabe: ein(13, [{ schluessel: LS, menge: 1 }]), sheets })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect((await leseBestand({ sheets })).einrichtung).toHaveLength(3);
  });

  test('neuer Ort und neuer Freitext-Artikel, danach buchbar', async () => {
    const tabs = lagerTabs({ orte: [] });
    const { sheets, aufrufe } = machSheets(tabs);
    expect(await neuerOrt({ eingabe: { ort: 'Kiste Crocodiles' }, sheets })).toEqual({ ok: true, ort: 'Kiste Crocodiles' });
    await expect(neuerOrt({ eingabe: { ort: 'kiste crocodiles' }, sheets })).rejects.toMatchObject({ status: 422, vorhanden: 'Kiste Crocodiles' });
    const a = await neuerArtikel({ eingabe: { bezeichnung: 'Stoffbeutel', warenart: 'sonstiges', farbe: 'Natur' }, sheets });
    expect(a).toEqual({ ok: true, laNr: 'LA-0001', schluessel: 'FREI:LA-0001' });
    await bucheLager({ eingabe: ein(14, [{ schluessel: a.schluessel, menge: 3 }], { ort: 'Kiste Crocodiles', aktion: 'start' }), sheets, jetzt: () => JETZT });
    expect(aufrufe.append).toBe(0);
    const best = await leseBestand({ sheets });
    expect(best.posten.map(p => [p.schluessel, p.modell, p.farbe, p.menge])).toEqual([['FREI:LA-0001', 'Stoffbeutel', 'Natur', 3]]);
    expect(tabs[TAB_BUCHUNGEN][1].slice(2, 4)).toEqual(['inventur', 'frei']);
  });

  test('Auswahl: Rohling mit ausgelaufenen Varianten (markiert), Fertigware mit Achsen, Trikot ohne Namen', async () => {
    const { sheets } = machSheets(lagerTabs());
    const r = await rohlingVarianten({ catalogNr: 'JH030F', sheets });
    expect(r.varianten.find(v => v.articleNr === NR_AUS)).toMatchObject({ auslauf: true, schluessel: `LS:${NR_AUS}` });
    const f = await fertigVarianten({ ssotId: '0001', sheets });
    expect(f.varianten[0]).toMatchObject({ wcId: '501', schluessel: 'WC:501', farbe: 'Deep Black', groesse: '2XL' });
    const tr = await trikotAuswahl({ sheets });
    expect(tr.produkte[0]).toMatchObject({ produktId: '900', name: 'Trikot Heim' });
    expect(tr.produkte[0].groessen).toEqual(expect.arrayContaining(['140', 'M', '4XL']));
    expect(JSON.stringify(tr)).not.toMatch(/GEHEIM/);
  });
});
