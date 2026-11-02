// BO5-7: Umlagern/Ausbuchen aus dem vorhandenen Bestand waehlen, "alles", "ganzen Ort umlagern", Abgangsart Ausschuss
// mit Pflicht-Grund. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, TAB_EVENTS, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, EVENT_SPALTEN,
  warenartVon, planBuchung, bezugRegel, abgaengeAuswertung, ABGANG_ARTEN, AUSSCHUSS_GRUENDE, POSTEN_MAX,
} from '../utils/lager.js';
import { bucheLager, leseBestand, leseAbgaenge, lagerCacheLeeren, _stammCacheLeeren, _partnerCacheLeeren } from '../lib/lager.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, NR, NR2 } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-06T10:00:00Z');
const V = n => `vorgang-ab7-${String(n).padStart(4, '0')}`;
const LS = `LS:${NR}`, LS2 = `LS:${NR2}`;
const b = (id, schluessel, menge, ort, extra = {}) => ({ id, datum: '2026-11-01T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel),
  schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx`, ...extra });

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const gr = html.slice(html.indexOf('// ── Groessen: Anfang'), html.indexOf('// ── Groessen: Ende ──'));
const block = html.slice(html.indexOf('// ── Lager-Anzeige: Anfang'), html.indexOf('// ── Lager-Anzeige: Ende ──'));
const F = new Function(`${gr}\n${block}\nreturn { lagerBestandAmOrt, lagerGruppen, lagerAuswahl, lagerAnfrage, lagerListeHinzu, lagerListeAuswahl };`)();

const POSTEN = [
  { schluessel: LS, ort: 'Wrist', menge: 3, warenart: 'rohling', modell: 'JH030F', name: 'Sweater', farbe: 'Deep Black', groesse: 'XXL' },
  { schluessel: LS2, ort: 'Wrist', menge: 2, warenart: 'rohling', modell: 'JH030F', name: 'Sweater', farbe: 'Deep Black', groesse: 'XL' },
  { schluessel: 'WC:501', ort: 'Wrist', menge: 0, warenart: 'fertig', modell: 'Ugly Sweater', name: '', farbe: 'Kürbis', groesse: 'M' },
  { schluessel: 'WC:502', ort: 'Itzehoe', menge: 4, warenart: 'fertig', modell: 'Ugly Sweater', name: '', farbe: 'Geist', groesse: 'L' },
];

describe('Bestandsliste je Ort (Frontend-Block)', () => {
  test('nur Bestand > 0 am gewaehlten Ort', () => {
    expect(F.lagerBestandAmOrt(POSTEN, 'Wrist').map(p => p.schluessel)).toEqual([LS, LS2]);
    expect(F.lagerBestandAmOrt(POSTEN, 'Itzehoe').map(p => p.schluessel)).toEqual(['WC:502']);
    expect(F.lagerBestandAmOrt(POSTEN, 'Keller')).toEqual([]);
  });
  test('Suche: jedes Wort in Modell, Name, Motiv/Farbe oder Groesse', () => {
    expect(F.lagerBestandAmOrt(POSTEN, 'Wrist', 'sweater xl').map(p => p.groesse)).toEqual(['XXL', 'XL']);
    expect(F.lagerBestandAmOrt(POSTEN, 'Wrist', 'xxl').map(p => p.groesse)).toEqual(['XXL']);
    expect(F.lagerBestandAmOrt(POSTEN, 'Itzehoe', 'geist').map(p => p.schluessel)).toEqual(['WC:502']);
    expect(F.lagerBestandAmOrt(POSTEN, 'Itzehoe', 'kürbis')).toEqual([]);
  });
  test('"alles" = da: die Auswahl nimmt den ganzen Bestand je Zeile', () => {
    const raster = F.lagerGruppen(F.lagerBestandAmOrt(POSTEN, 'Wrist')).flatMap(g => g.zeilen.map(p => ({ schluessel: p.schluessel, label: p.groesse })));
    const a = F.lagerAuswahl(raster, Object.fromEntries(F.lagerBestandAmOrt(POSTEN, 'Wrist').map(p => [p.schluessel, String(p.menge)])));
    expect(a.posten.map(p => [p.schluessel, p.menge])).toEqual([[LS2, 2], [LS, 3]]);
    expect(F.lagerAnfrage({ modus: 'umlagern', ort: 'Wrist', zielOrt: 'Itzehoe', vorgang: 'v-12345678' }, a)).toMatchObject({ aktion: 'umlagern', zielOrt: 'Itzehoe' });
  });
  test('Sammelliste aus dem Bestand: Ort je Zeile bleibt erhalten', () => {
    let l = F.lagerListeHinzu([], { posten: [{ schluessel: LS, label: 'JH030F · Sweater · Deep Black · XXL', menge: 1 }] }, { ort: 'Wrist' });
    l = F.lagerListeHinzu(l, { posten: [{ schluessel: 'WC:502', label: 'Ugly Sweater · Geist · L', menge: 2 }] }, { ort: 'Itzehoe' });
    const r = F.lagerAnfrage({ modus: 'ausbuchen', art: 'abgang_ausschuss', bezug: 'Fehldruck', ort: 'Wrist', vorgang: 'v-12345678' }, F.lagerListeAuswahl(l, { posten: [], fehler: [] }, 'Wrist'));
    expect(r.posten).toEqual([{ schluessel: LS, menge: 1, ort: 'Wrist' }, { schluessel: 'WC:502', menge: 2, ort: 'Itzehoe' }]);
  });
});

describe('Ausschuss', () => {
  test('ist eine Abgangsart mit Pflicht-Grund aus der Liste', () => {
    expect(ABGANG_ARTEN).toContain('abgang_ausschuss');
    expect(AUSSCHUSS_GRUENDE).toEqual(['Fehldruck', 'Ware defekt', 'verschenkt']);
    for (const g of AUSSCHUSS_GRUENDE) expect(bezugRegel('abgang_ausschuss', g)).toBe(true);
    expect(bezugRegel('abgang_ausschuss', '')).toMatch(/Grund wählen/);
    expect(bezugRegel('abgang_ausschuss', 'kaputt')).toMatch(/Grund wählen/);
  });
  test('jede Warenart, nie negativ, Grund-Freitext optional', () => {
    const lager = [b('LB-2026-00001', LS, 2, 'Wrist'), b('LB-2026-00002', 'WC:501', 1, 'Wrist'), b('LB-2026-00003', 'TR:900:XL', 1, 'Wrist')];
    const k = { buchungen: lager, orte: ['Wrist'], bezugPruefen: (a, x) => bezugRegel(a, x), jetzt: JETZT };
    const p = planBuchung({ aktion: 'ausbuchen', art: 'abgang_ausschuss', bezug: 'Fehldruck', grund: 'beim Drucken verrutscht', ort: 'Wrist', vorgang: V(1),
      posten: [{ schluessel: LS, menge: 1 }, { schluessel: 'WC:501', menge: 1 }, { schluessel: 'TR:900:XL', menge: 1 }] }, k);
    expect(p.zeilen.map(z => [z.Warenart, z.Art, z.Bezug, z.Grund, z.Menge])).toEqual([
      ['rohling', 'abgang_ausschuss', 'Fehldruck', 'beim Drucken verrutscht', -1], ['fertig', 'abgang_ausschuss', 'Fehldruck', 'beim Drucken verrutscht', -1],
      ['trikot', 'abgang_ausschuss', 'Fehldruck', 'beim Drucken verrutscht', -1]]);
    expect(planBuchung({ aktion: 'ausbuchen', art: 'abgang_ausschuss', bezug: '', ort: 'Wrist', vorgang: V(2), posten: [{ schluessel: LS, menge: 1 }] }, k).probleme[0].code).toBe('bezug');
    expect(planBuchung({ aktion: 'ausbuchen', art: 'abgang_ausschuss', bezug: 'verschenkt', ort: 'Wrist', vorgang: V(3), posten: [{ schluessel: LS, menge: 3 }] }, k).probleme[0].code).toBe('bestand');
  });
  test('Auswertung: eigene Art, Filter nach Grund', () => {
    const bs = [b('LB-2026-00001', LS, 5, 'Wrist'),
      b('LB-2026-00002', LS, -2, 'Wrist', { art: 'abgang_ausschuss', bezug: 'Fehldruck' }),
      b('LB-2026-00003', LS, -1, 'Wrist', { art: 'abgang_ausschuss', bezug: 'verschenkt' }),
      b('LB-2026-00004', LS, -1, 'Wrist', { art: 'abgang_vorort', bezug: 'EV-0001' })];
    expect(abgaengeAuswertung(bs, { art: 'abgang_ausschuss' }).stueck).toBe(3);
    expect(abgaengeAuswertung(bs, { art: 'abgang_ausschuss', bezug: 'Fehldruck' }).stueck).toBe(2);
    expect(abgaengeAuswertung(bs).bezuege).toEqual(expect.arrayContaining([{ art: 'abgang_ausschuss', bezug: 'Fehldruck', stueck: 2 }]));
  });
});

describe('Ganzen Ort umlagern (Schreibweg)', () => {
  function tabs(buchungen) {
    const t = grundTabs({ mitKorb: false });
    t.Trikots = [['Produktname', 'Groesse']];
    t.Partner = [['Partner-ID', 'Name', 'Aktiv']];
    t[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))];
    t[TAB_ORTE] = [ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Itzehoe', 'aktiv', ''], ['Alt', 'aktiv', '']];
    t[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
    t[TAB_EVENTS] = [EVENT_SPALTEN];
    return t;
  }
  const z = (id, s, m, ort) => ({ Buchung_ID: id, Datum: '2026-11-01T08:00:00Z', Art: 'vorrat', Warenart: warenartVon(s), Schluessel: s, Menge: m, Ort: ort, Quelle: 'knopf', Vorgang: `v-${id}-xxxxxx` });
  beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot'; _resetLShopCache(); _stammCacheLeeren(); lagerCacheLeeren(); _partnerCacheLeeren(); });

  test('alles vom alten Ort in einem Schritt: zwei Zeilen je Teil, danach 0 am alten Ort; Doppelklick bucht nichts', async () => {
    const t = tabs([z('LB-2026-00001', LS, 3, 'Alt'), z('LB-2026-00002', LS2, 2, 'Alt'), z('LB-2026-00003', 'WC:501', 1, 'Alt')]);
    const { sheets, aufrufe } = machSheets(t);
    const d = await leseBestand({ sheets });
    const amOrt = F.lagerBestandAmOrt(d.posten, 'Alt');
    const eingabe = { aktion: 'umlagern', ort: 'Alt', zielOrt: 'Wrist', vorgang: V(10), posten: amOrt.map(p => ({ schluessel: p.schluessel, menge: p.menge })) };
    const r = await bucheLager({ eingabe, sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, zeilen: 6 });
    expect(aufrufe.update).toHaveLength(1);
    expect(await bucheLager({ eingabe, sheets, jetzt: () => JETZT })).toMatchObject({ schonGebucht: true });
    lagerCacheLeeren();
    const nach = await leseBestand({ sheets });
    expect(F.lagerBestandAmOrt(nach.posten, 'Alt')).toEqual([]);
    expect(F.lagerBestandAmOrt(nach.posten, 'Wrist').reduce((s, p) => s + p.menge, 0)).toBe(6);
  });
  test('alles oder nichts: eine Zeile mehr als da -> nichts gebucht', async () => {
    const t = tabs([z('LB-2026-00001', LS, 3, 'Alt'), z('LB-2026-00002', LS2, 2, 'Alt')]);
    const { sheets, aufrufe } = machSheets(t);
    await expect(bucheLager({ eingabe: { aktion: 'umlagern', ort: 'Alt', zielOrt: 'Wrist', vorgang: V(11),
      posten: [{ schluessel: LS, menge: 3 }, { schluessel: LS2, menge: 3 }] }, sheets })).rejects.toMatchObject({ status: 422 });
    expect(aufrufe.update).toEqual([]);
  });
  test('ein Ort mit vielen Artikeln passt in einen Schritt (Grenze 300 Zeilen)', () => {
    expect(POSTEN_MAX).toBeGreaterThanOrEqual(300);
  });
  test('Ausschuss ueber den Schreibweg erscheint in der Auswertung', async () => {
    const t = tabs([z('LB-2026-00001', LS, 3, 'Wrist')]);
    const { sheets } = machSheets(t);
    await bucheLager({ eingabe: { aktion: 'ausbuchen', art: 'abgang_ausschuss', bezug: 'Fehldruck', ort: 'Wrist', vorgang: V(12), posten: [{ schluessel: LS, menge: 2 }] }, sheets, jetzt: () => JETZT });
    const a = await leseAbgaenge({ filter: { art: 'abgang_ausschuss', bezug: 'Fehldruck' }, sheets });
    expect(a).toMatchObject({ stueck: 2, ausschussGruende: AUSSCHUSS_GRUENDE });
  });
});

describe('Dialog (Verdrahtung)', () => {
  test('Umschalter "aus Bestand wählen" / "Artikel suchen", Suche, alles, ganzer Ort - alle mit Mouse-over', () => {
    for (const k of ['lager-quelle-bestand', 'lager-quelle-suche', 'lager-best-suche', 'lager-alles', 'lager-alles-gruppe', 'lager-ganzer-ort', 'lager-ausschuss-grund']) {
      expect(html).toMatch(new RegExp(`data-hilfe="${k}"`));
    }
  });
  test('aus Bestand nur bei Umlagern und Ausbuchen; Einbuchen bleibt ueber die Stammdaten', () => {
    expect(html).toMatch(/const lagerAusBestand = \(\) => \['umlagern', 'ausbuchen'\]\.includes\(lagerDlg\.modus\) && lagerDlg\.herkunft !== 'suche';/);
  });
  test('ganzer Ort fragt vorher nach', () => {
    const fn = html.slice(html.indexOf('async function lagerGanzerOrt'), html.indexOf('async function lagerGanzerOrt') + 1500);
    expect(fn).toMatch(/await showConfirm\('Ganzen Ort umlagern'/);
    expect(fn.indexOf('showConfirm')).toBeLessThan(fn.indexOf('lagerBuchen(false)'));
  });
});
