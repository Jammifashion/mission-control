// BO5-8: Lagerware bei Shop-Bestellungen sichtbar, Bestellnummer im Korb anklickbar, Korb-Zeilen zu abgeschlossenen
// Bestellungen in einem Schritt erledigen. Nur erfundene Daten (Bestellnummern, Orte).
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GRUENDE, HINWEIS, grundVorschlag, nurAbgeschlossen, STATUS } from '../utils/korb-logic.js';
import { korbVorschlaege, ausLagerPlan, rohlingBestandJeNr } from '../utils/lager-korb.js';
import { lagerJeKorb, baueStand } from '../utils/produktion-stand.js';
import { warenartVon } from '../utils/lager.js';
import { NR, NR2 } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = new Date('2026-11-18T09:00:00Z');
const b = (id, schluessel, menge, ort) => ({ id, datum: '2026-11-01T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel), schluessel, menge, ort,
  grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx` });
const p = (s, menge, o = {}) => ({ schluessel: s, menge, status: 'offen', vorschlag: true, hinweis: '', ...o });

describe('Teil B: abgeschlossene Bestellungen', () => {
  test('"nur abgeschlossen" = abgeschlossen ohne storniert/erstattet/weg; Grund-Vorschlag und Grundliste', () => {
    expect(nurAbgeschlossen(HINWEIS.ABGESCHLOSSEN)).toBe(true);
    expect(nurAbgeschlossen(`${HINWEIS.ABGESCHLOSSEN} · ${HINWEIS.UNBEZAHLT}`)).toBe(true);
    expect(nurAbgeschlossen(`${HINWEIS.ABGESCHLOSSEN} · ${HINWEIS.ERSTATTET}`)).toBe(false);
    expect(nurAbgeschlossen(HINWEIS.STORNIERT)).toBe(false);
    expect(grundVorschlag(HINWEIS.ABGESCHLOSSEN)).toBe('Bestellung abgeschlossen');
    expect(GRUENDE).toContain('Bestellung abgeschlossen');
  });
  test('Lager-Info fuer abgeschlossene Zeilen erst NACH den offenen (keine Doppelverplanung), eigenes Feld', () => {
    const buendel = [{ articleNr: NR, positionen: [
      p('abg1', 2, { vorschlag: false, hinweis: HINWEIS.ABGESCHLOSSEN }), p('offen1', 3), p('abg2', 2, { vorschlag: false, hinweis: HINWEIS.ABGESCHLOSSEN }),
      p('storno', 1, { vorschlag: false, hinweis: HINWEIS.STORNIERT }) ] }];
    korbVorschlaege(buendel, rohlingBestandJeNr([b('LB-2026-00001', `LS:${NR}`, 6, 'Wrist')]));
    const [abg1, offen1, abg2, storno] = buendel[0].positionen;
    expect(offen1.lager).toEqual({ n: 6, genug: true });          // offene zuerst
    expect(abg1).toMatchObject({ abgeschlossen: true, lagerErledigt: { n: 3, genug: true } });
    expect(abg2).toMatchObject({ abgeschlossen: true, lagerErledigt: { n: 1, genug: false } });
    expect(abg1.lager).toBeUndefined();                             // BO5-3-Anzeige bleibt unveraendert
    expect(storno.abgeschlossen).toBeUndefined();
  });
  test('"Aus Lager genommen": nur mit erledigt: true und nur bei "abgeschlossen"; nie mehr als da (nie negativ)', () => {
    const buchungen = [b('LB-2026-00001', `LS:${NR}`, 2, 'Wrist')];
    const zeile = { _zeile: 2, Schluessel: 'JFN:90001:1', Herkunft: 'shop', Status: 'offen', LShop_ArticleNr: NR, Menge: '2', Hinweis: HINWEIS.ABGESCHLOSSEN };
    const k = { korbZeilen: [zeile], buchungen, orte: ['Wrist'], jetzt: JETZT };
    const e = (o = {}) => ({ schluessel: 'JFN:90001:1', status: 'offen', verteilung: [{ ort: 'Wrist', menge: 2 }], vorgang: 'vorgang-bo58-0001', ...o });
    expect(() => ausLagerPlan(e(), k)).toThrow(/nicht aus dem Lager/);
    const plan = ausLagerPlan(e({ erledigt: true }), k);
    expect(plan.korb.werte.Status).toBe(STATUS.LAGER);
    expect(plan.lagerZeilen).toEqual([expect.objectContaining({ Art: 'abgang_shop', Schluessel: `LS:${NR}`, Menge: -2, Bezug: 'JFN:90001:1' })]);
    expect(() => ausLagerPlan(e({ erledigt: true, verteilung: [{ ort: 'Wrist', menge: 3 }] }), { ...k, korbZeilen: [{ ...zeile, Menge: '3' }] })).toThrow(/nur 2/);
    expect(() => ausLagerPlan(e({ erledigt: true }), { ...k, korbZeilen: [{ ...zeile, Hinweis: HINWEIS.STORNIERT }] })).toThrow(/nicht aus dem Lager/);
  });
});

describe('Bestellansicht: Lagerhinweis je Artikel', () => {
  const bestand = rohlingBestandJeNr([b('LB-2026-00001', `LS:${NR}`, 3, 'Wrist'), b('LB-2026-00002', `LS:${NR2}`, 4, 'Itzehoe')]);
  test('offen mit Bestand (aus derselben Verteilung wie der Korb), bestellt nur Hinweis, sonst nichts', () => {
    const buendel = [{ articleNr: NR, lager: { summe: 3, orte: [{ ort: 'Wrist', menge: 3 }] }, positionen: [p('JFN:90002:11', 2, { lager: { n: 3, genug: true } }), p('JFN:90002:12', 5, { lager: { n: 1, genug: false } })] }];
    const korb = new Map([
      ['JFN:90003:21', { Schluessel: 'JFN:90003:21', Status: 'bestellt', LShop_ArticleNr: NR2 }],
      ['JFN:90003:22', { Schluessel: 'JFN:90003:22', Status: 'bestellt', LShop_ArticleNr: '1000999999' }],
    ]);
    const je = lagerJeKorb({ buendel, korb, bestand });
    expect(je.get('JFN:90002:11')).toMatchObject({ art: 'offen', n: 3, genug: true, articleNr: NR, status: 'offen', menge: 2 });
    expect(je.get('JFN:90002:12')).toMatchObject({ art: 'offen', genug: false });
    expect(je.get('JFN:90003:21')).toMatchObject({ art: 'bestellt', n: 4 });
    expect(je.has('JFN:90003:22')).toBe(false);
  });
  test('baueStand haengt "lager" nur an die passenden Artikel', () => {
    const stand = baueStand({ shop: 'jfn', bestellungen: [{ id: '90002', date_created: '2026-11-10T10:00:00', line_items: [{ id: '11', name: 'Testshirt', quantity: 2 }, { id: '13', name: 'Anderes', quantity: 1 }] }],
      ps: new Map(), korb: new Map(), bestellungJe: new Map(), einstufen: () => 'Trikot', korbSchluessel: (nr, pos) => `JFN:${nr}:${pos}`,
      lagerJe: new Map([['JFN:90002:11', { art: 'offen', n: 3, genug: true }]]), jetzt: JETZT });
    expect(stand[0].artikel[0].lager).toMatchObject({ art: 'offen' });
    expect(stand[0].artikel[1].lager).toBeUndefined();
  });
});

describe('Oberflaeche', () => {
  test('Bestellkarte: orange Hinweis, Knopf nur bei genug, grau bei bestellt; Mouse-over, kein title', () => {
    const block = html.slice(html.indexOf('function psLagerHtml('), html.indexOf('/** Sichtbare Bestellungen je Filter'));
    expect(block).toContain('Liegt im Korb – aber im Lager:');
    expect(block).toContain('bereits bei L-Shop bestellt – Lagerware bleibt im Lager');
    expect(block).toContain('(l.genug ? ` <button');
    expect(block).toContain('data-hilfe="ps-lager"');
    expect(block).not.toMatch(/\stitle=/);
    expect(html).toContain("document.body.appendChild(document.getElementById('korb-lager-dialog'));");
    expect(html).toContain("korbLagerOeffnenMit({ schluessel: l.schluessel, status: l.status, menge: l.menge, herkunft: 'shop'");
  });
  test('Korb: Bestellnummer -> Bestellansicht + ↗ (nur https-Admin-Link); Teil B Knoepfe und Sammel mit Mouse-over', () => {
    expect(html).toContain("psSpringeZu(nrK.dataset.korbBestellung); oeffneAnsicht('bestellen', 'bestellungen');");
    expect(html).toContain('data-korb-bestellung=');
    for (const k of ['korb-bestellung', 'korb-aus-lager-erledigt', 'korb-erledigt', 'korb-lager-knapp', 'korb-sammel-erledigt', 'ps-lager', 'ps-lager-bestellt'])
      expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
    expect(html).toContain("'abgewählt', 'Bestellung abgeschlossen', undefined");
    const teilB = html.slice(html.indexOf('function korbErledigtHtml('), html.indexOf('// ── Korb-Lager: Ende ──'));
    expect(teilB).not.toMatch(/\stitle=/);
  });
  test('Backend: Korb haengt adminUrl an Shop-Positionen (BS4-Baustein)', () => {
    const lib = readFileSync(resolve(hier, '../lib/lshopKorb.js'), 'utf8');
    expect(lib).toContain('adminBestellLink(normalizeShop(p.shop) === \'honk\' ? process.env.WC_URL_HONK : process.env.WC_URL, p.bestellnummer)');
  });
});
