// BO5-9: "Liegt im Lager – einbuchen …" aus der Bestellkarte. Ware liegt da, ist aber nie eingebucht: Einbuchen als
// Zaehlung/Startbestand (Art inventur) mit Quelle bestellung und Bezug der Position; danach "im Lager: n" und "aus Lager
// nehmen …". Einbuchen und Entnehmen bleiben zwei Schritte. Nur erfundene Daten.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KLASSE, HINWEIS } from '../utils/korb-logic.js';
import { bestandJeSchluessel, shopAbgaengeJePosition } from '../utils/lager-korb.js';
import { einbuchenJeArtikel, baueStand, EINBUCHEN_OHNE_SCHLUESSEL } from '../utils/produktion-stand.js';
import { planBuchung, planGegenbuchung, warenartVon, QUELLE, ART } from '../utils/lager.js';
import { NR } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = new Date('2026-11-25T09:00:00Z');
const b = (id, schluessel, menge, ort, o = {}) => ({ id, datum: '2026-11-01T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel), schluessel, menge, ort,
  grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx`, ...o });
const li = (id, o = {}) => ({ id, name: 'Hoodie Testmotiv - L', quantity: 1, product_id: '500', variation_id: '501', sku: 'X', ...o });
const korbZ = (o = {}) => ({ Schluessel: 'JFN:90001:11', Status: 'offen', LShop_ArticleNr: NR, Menge: '1', Hinweis: '', ...o });

describe('Einbuchen planen (utils/lager.js)', () => {
  const basis = { aktion: 'start', ort: 'Wrist', vorgang: 'vorgang-bo59-01', posten: [{ schluessel: `LS:${NR}`, menge: 1 }] };
  const k = { buchungen: [], orte: ['Wrist', 'Itzehoe'], gueltig: () => true, jetzt: JETZT };
  test('Startbestand aus der Bestellung: Art inventur, Quelle bestellung, Bezug = Position', () => {
    const r = planBuchung({ ...basis, quelle: 'bestellung', bezug: 'JFN:90001:11' }, k);
    expect(r.probleme).toEqual([]);
    expect(r.zeilen).toHaveLength(1);
    expect(r.zeilen[0]).toMatchObject({ Art: ART.INVENTUR, Quelle: QUELLE.BESTELLUNG, Bezug: 'JFN:90001:11', Menge: 1, Ort: 'Wrist', Schluessel: `LS:${NR}` });
  });
  test('ohne gueltigen Bezug oder bei anderer Aktion: nichts gebucht', () => {
    expect(planBuchung({ ...basis, quelle: 'bestellung', bezug: 'JFN:90001' }, k).zeilen).toEqual([]);
    expect(planBuchung({ ...basis, quelle: 'bestellung', bezug: 'irgendwas' }, k).zeilen).toEqual([]);
    expect(planBuchung({ ...basis, aktion: 'einbuchen', art: 'vorrat', quelle: 'bestellung', bezug: 'JFN:90001:11' }, k).zeilen).toEqual([]);
    expect(planBuchung({ ...basis, quelle: 'korb' }, k).zeilen).toEqual([]);   // fremde Quelle nie vom Browser
  });
  test('Doppelklick: gleicher Vorgang = schon gebucht, nichts doppelt', () => {
    const schon = [b('LB-2026-00009', `LS:${NR}`, 1, 'Wrist', { vorgang: 'vorgang-bo59-01', quelle: 'bestellung' })];
    const r = planBuchung({ ...basis, quelle: 'bestellung', bezug: 'JFN:90001:11' }, { ...k, buchungen: schon });
    expect(r.schonGebucht).toHaveLength(1);
    expect(r.zeilen).toEqual([]);
  });
  test('Buchung aus der Bestellung ist von Hand gegenbuchbar (Abnahme: bereinigen)', () => {
    const buchungen = [b('LB-2026-00009', `LS:${NR}`, 1, 'Wrist', { art: 'inventur', quelle: 'bestellung', bezug: 'JFN:90001:11' })];
    const r = planGegenbuchung({ buchungId: 'LB-2026-00009', vorgang: 'vorgang-bo59-02' }, { buchungen, jetzt: JETZT });
    expect(r.probleme).toEqual([]);
    expect(r.zeilen[0]).toMatchObject({ Menge: -1, Storno_von: 'LB-2026-00009' });
  });
});

describe('Bestand und Abgaenge je Position (utils/lager-korb.js)', () => {
  test('Bestand je Schluessel ueber alle Warenarten, nur > 0, meiste zuerst', () => {
    const m = bestandJeSchluessel([b('1', 'WC:501', 2, 'Wrist'), b('2', 'WC:501', 3, 'Itzehoe'), b('3', `LS:${NR}`, 1, 'Wrist'), b('4', `LS:${NR}`, -1, 'Wrist')]);
    expect(m.get('WC:501')).toEqual({ summe: 5, orte: [{ ort: 'Itzehoe', menge: 3 }, { ort: 'Wrist', menge: 2 }] });
    expect(m.has(`LS:${NR}`)).toBe(false);
  });
  test('von Hand ausgebuchte Shop-Abgaenge je Position, Gegenbuchung abgezogen, Korb-Abgaenge nicht', () => {
    const m = shopAbgaengeJePosition([
      b('1', 'WC:501', -1, 'Wrist', { art: 'abgang_shop', bezug: 'JFN:90001:12' }),
      b('2', 'WC:501', -1, 'Wrist', { art: 'abgang_shop', bezug: 'JFN:90001:13' }),
      b('3', 'WC:501', 1, 'Wrist', { art: 'korrektur', stornoVon: '2' }),
      b('4', `LS:${NR}`, -1, 'Wrist', { art: 'abgang_shop', quelle: 'korb', bezug: 'JFN:90001:11' }),
      b('5', 'WC:501', -1, 'Wrist', { art: 'abgang_shop', bezug: '90001' }),
    ]);
    expect([...m.entries()]).toEqual([['JFN:90001:12', 1]]);
  });
});

describe('Knopf in der Bestellkarte (einbuchenJeArtikel)', () => {
  const leer = { bestandJe: new Map(), genommenJe: new Map(), wcBekannt: new Set(['501']) };
  test('Korb-Zeile offen ohne Lagerbestand -> einbuchen LS:<ArticleNr>, Menge = Position, Bezug = Position', () => {
    const r = einbuchenJeArtikel({ jfn: true, orderId: '90001', li: li('11'), korbZeile: korbZ(), ...leer });
    expect(r).toEqual({ einbuchen: { schluessel: `LS:${NR}`, menge: 1, bezug: 'JFN:90001:11' } });
  });
  test('Korb-Zeile mit genug im Lager (BO5-8-Knopf), anderem Status, sperrendem Hinweis, fertig, versendet, HONK: kein Knopf', () => {
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11'), korbZeile: korbZ(), lager: { n: 1, genug: true }, ...leer })).toEqual({});
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11'), korbZeile: korbZ({ Status: 'Lager' }), ...leer })).toEqual({});
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11'), korbZeile: korbZ({ Status: 'bestellt' }), ...leer })).toEqual({});
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11'), korbZeile: korbZ({ Hinweis: HINWEIS.STORNIERT }), ...leer })).toEqual({});
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11'), korbZeile: korbZ(), fertig: true, ...leer })).toEqual({});
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11'), korbZeile: korbZ(), versendet: true, ...leer })).toEqual({});
    expect(einbuchenJeArtikel({ jfn: false, orderId: '1', li: li('11'), ...leer })).toEqual({});
  });
  test('zu wenig im Lager: Rest einbuchen', () => {
    const r = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('11', { quantity: 3 }), korbZeile: korbZ({ Menge: '3' }), lager: { n: 1, genug: false }, ...leer });
    expect(r.einbuchen.menge).toBe(2);
  });
  test('Fertigware ohne Korb-Zeile: WC:<Variation>, nur wenn gepflegt; sonst ohne Schluessel mit Grund', () => {
    const fertig = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('12'), stufe: { klasse: KLASSE.EINFACH }, ...leer });
    expect(fertig.einbuchen).toEqual({ schluessel: 'WC:501', menge: 1, bezug: 'JFN:1:12' });
    const fremd = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('12', { variation_id: '777' }), stufe: { klasse: KLASSE.EXTERN }, ...leer });
    expect(fremd.einbuchen).toEqual({ schluessel: '', menge: 1, bezug: 'JFN:1:12', grund: EINBUCHEN_OHNE_SCHLUESSEL });
  });
  test('Trikots nie (eigener Weg auf der Trikot-Seite)', () => {
    expect(einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('14'), stufe: { klasse: KLASSE.TRIKOT }, ...leer })).toEqual({});
  });
  test('bestellbar, aber noch nicht im Korb: LS:<ArticleNr>; nach dem Einbuchen "im Lager", Korb fehlt noch', () => {
    const vor = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('13'), stufe: { klasse: KLASSE.BESTELLBAR, articleNr: NR }, ...leer });
    expect(vor.einbuchen.schluessel).toBe(`LS:${NR}`);
    const nach = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('13'), stufe: { klasse: KLASSE.BESTELLBAR, articleNr: NR }, ...leer,
      bestandJe: new Map([[`LS:${NR}`, { summe: 1, orte: [{ ort: 'Wrist', menge: 1 }] }]]) });
    expect(nach.einbuchen).toBeUndefined();
    expect(nach.lagerFrei).toMatchObject({ n: 1, korbFehlt: true, erledigt: false });
  });
  test('Fertigware: nach dem Einbuchen "im Lager: n", nach dem Ausbuchen "aus Lager genommen" - kein zweiter Einbuchen-Knopf', () => {
    const bestandJe = new Map([['WC:501', { summe: 1, orte: [{ ort: 'Wrist', menge: 1 }] }]]);
    const da = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('12'), stufe: { klasse: KLASSE.EINFACH }, ...leer, bestandJe });
    expect(da).toEqual({ lagerFrei: { schluessel: 'WC:501', n: 1, orte: [{ ort: 'Wrist', menge: 1 }], genommen: 0, menge: 1, erledigt: false, korbFehlt: false, bezug: 'JFN:1:12' } });
    const weg = einbuchenJeArtikel({ jfn: true, orderId: '1', li: li('12'), stufe: { klasse: KLASSE.EINFACH }, ...leer, genommenJe: new Map([['JFN:1:12', 1]]) });
    expect(weg.einbuchen).toBeUndefined();
    expect(weg.lagerFrei).toMatchObject({ erledigt: true, genommen: 1 });
  });
  test('baueStand haengt einbuchen an (einstufen darf die Klasse oder das ganze Ergebnis liefern)', () => {
    const stand = baueStand({ shop: 'jfn', jetzt: JETZT, ps: new Map(), korb: new Map(), bestellungJe: new Map(),
      bestellungen: [{ id: '90002', date_created: '2026-11-20T10:00:00', line_items: [li('21')] }],
      einstufen: () => ({ klasse: KLASSE.BESTELLBAR, articleNr: NR }), korbSchluessel: (n, p) => `JFN:${n}:${p}`, lagerFrei: leer });
    expect(stand[0].artikel[0].einbuchen).toEqual({ schluessel: `LS:${NR}`, menge: 1, bezug: 'JFN:90002:21' });
    expect(stand[0].artikel[0].lshop.art).toBeTruthy();
    const ohne = baueStand({ shop: 'jfn', jetzt: JETZT, ps: new Map(), korb: new Map(), bestellungJe: new Map(),
      bestellungen: [{ id: '90002', date_created: '', line_items: [li('21')] }], einstufen: () => KLASSE.TRIKOT, korbSchluessel: (n, p) => `JFN:${n}:${p}` });
    expect(ohne[0].artikel[0].einbuchen).toBeUndefined();   // ohne Lager-Daten (z. B. Mika-Pfad nicht geladen) nichts
  });
});

describe('Oberflaeche', () => {
  test('Knopf und Hinweise mit Mouse-over, Klick oeffnet den Lager-Dialog vorbelegt', () => {
    expect(html).toContain('data-hilfe="ps-einbuchen">Liegt im Lager – einbuchen …</button>');
    expect(html).toContain('data-hilfe="ps-aus-lager-frei">aus Lager nehmen …</button>');
    expect(html).toMatch(/'ps-einbuchen':\s+\{ name: 'Liegt im Lager – einbuchen …'/);
    expect(html).toContain("closest('[data-ps-einbuchen], [data-ps-aus-lager-frei]')");
    expect(html).toContain('async function lagerVonBestellung(v)');
  });
  test('Einbuchen = Zaehlung/Startbestand mit Quelle bestellung und Bezug; danach nur die Karte neu (kein Seiten-Neuladen)', () => {
    expect(html).toContain("lagerEl('lager-start').checked = v.art === 'einbuchen';");
    expect(html).toContain("...(aktion === 'start' && z.vonBestellung ? { quelle: 'bestellung' } : {}),");
    expect(html).toContain('const nachher = async () => { await psEinzelnNeu(orderId); psZeichnen(); };');
    expect(html).toContain('if (vb) { lagerDialogZu(); try { await vb.nachher?.(); }');
    expect(html).toContain("if (dlg.parentElement !== document.body) document.body.appendChild(dlg);");
  });
  test('Ausbuchen aus der Karte: Shop-Bestellung mit Bezug der Position, Ort mit Bestand', () => {
    expect(html).toContain("lagerEl('lager-art').value = 'abgang_shop';");
    expect(html).toContain('if (shop) shop.value = v.bezug;');
  });
});
