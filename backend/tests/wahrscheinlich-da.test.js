// WE2 Teil 2 + 3: Paket-Zaehler und "wahrscheinlich da – bitte prüfen" (Regel aus bericht-WE1). Daten nach den gemessenen
// Faellen 0004-0008 (Datumsfolge wie gemessen), Nummern/Referenzen ERFUNDEN.

import { wahrscheinlichDa, paketZaehler, baueBestellungen } from '../utils/lshop-bestellungen.js';

const NR_A = '1000000001', NR_B = '1000000002', NR_C = '1000000003';
const pos = (schluessel, articleNr, o = {}) => ({ schluessel, articleNr, menge: 1, status: 'bestellt', liefertermin: '', gesperrt: false, ...o });
const ls = (...daten) => daten.map((datum, i) => ({ la: `LA0000000${i}`, datum, pakete: [{}] }));
const liste = (datum, eintraege = []) => ({ datum, positionen: eintraege.map(([orderId, articleNr, rueckstand]) => ({ orderId, articleNr, rueckstand })) });
const da = o => wahrscheinlichDa({ orderId: 'JFN-2026-0004', ...o });
const schluessel = r => r.positionen.map(p => p.schluessel);

describe('wahrscheinlich da', () => {
  test('0004/0006: nach Versand eine Liste ohne die Nummer -> gemeldet; gleiche Nummer zweimal -> bitte zählen', () => {
    const r = da({ positionen: [pos('JFN:1:1', NR_A), pos('EIGEN:1', NR_A), pos('JFN:1:2', NR_B)], lieferscheine: ls('2026-10-28'), listen: [liste('2026-11-04')] });
    expect(r.liste).toBe('2026-11-04');
    expect(r.positionen).toEqual([
      { schluessel: 'JFN:1:1', menge: 1, rest: null, zaehlen: true, text: '2 Positionen mit derselben Nummer – 2 von 2 wahrscheinlich da, bitte zählen' },
      { schluessel: 'EIGEN:1', menge: 1, rest: null, zaehlen: true, text: '2 Positionen mit derselben Nummer – 2 von 2 wahrscheinlich da, bitte zählen' },
      { schluessel: 'JFN:1:2', menge: 1, rest: 1, zaehlen: false, text: 'wahrscheinlich da' },
    ]);
  });
  test('0005: was auf der Liste nach dem Versand steht, bleibt draussen (auch zwei Positionen derselben Nummer)', () => {
    const r = wahrscheinlichDa({ orderId: 'JFN-2026-0005', lieferscheine: ls('2026-10-30'),
      positionen: [pos('E:1', NR_A), pos('E:2', NR_A), pos('JFN:2:1', NR_B), pos('JFN:2:2', NR_C)],
      listen: [liste('2026-11-04', [['JFN-2026-0005', NR_A, 1], ['JFN-2026-0005', NR_A, 1], ['JFN-2026-0005', NR_B, 1], ['JFN-2026-0099', NR_C, 1]])] });
    expect(schluessel(r)).toEqual(['JFN:2:2']);   // Eintrag einer anderen order_id zaehlt nicht
  });
  test('0007: AB-Termin nach dem einzigen Versandtag -> nicht verfrueht; mit spaeterem Paket + Liste danach -> gemeldet', () => {
    const p = [pos('JFN:3:1', NR_A, { liefertermin: '2026-11-12' })];
    expect(schluessel(da({ positionen: p, lieferscheine: ls('2026-11-03'), listen: [liste('2026-11-04')] }))).toEqual([]);
    expect(schluessel(da({ positionen: p, lieferscheine: ls('2026-11-03', '2026-11-10'), listen: [liste('2026-11-04'), liste('2026-11-11')] }))).toEqual(['JFN:3:1']);
  });
  test('0008: Liste am Versandtag zaehlt nicht (null), erst die naechste', () => {
    const p = [pos('JFN:4:1', NR_A)];
    expect(da({ positionen: p, lieferscheine: ls('2026-11-09', '2026-11-11'), listen: [liste('2026-11-04'), liste('2026-11-11', [['JFN-2026-0004', NR_A, 1]])] })).toBeNull();
    expect(schluessel(da({ positionen: p, lieferscheine: ls('2026-11-09', '2026-11-11'), listen: [liste('2026-11-11', [['JFN-2026-0004', NR_A, 1]]), liste('2026-11-18')] }))).toEqual(['JFN:4:1']);
  });
  test('auf irgendeiner Liste nach dem Versand -> nicht gemeldet (groesster Rueckstand gilt)', () => {
    const r = da({ positionen: [pos('JFN:5:1', NR_A)], lieferscheine: ls('2026-11-01'), listen: [liste('2026-11-04', [['JFN-2026-0004', NR_A, 1]]), liste('2026-11-11')] });
    expect(r.positionen).toEqual([]);
  });
  test('Teilmenge: bestellt 5, Rueckstand 2 -> Rest 3, bitte zählen', () => {
    const r = da({ positionen: [pos('JFN:6:1', NR_A, { menge: 5 })], lieferscheine: ls('2026-11-01'), listen: [liste('2026-11-04', [['JFN-2026-0004', NR_A, 2]])] });
    expect(r.positionen).toEqual([{ schluessel: 'JFN:6:1', menge: 5, rest: 3, zaehlen: true, text: '3 von 5 wahrscheinlich da, Rest im Rückstand – bitte zählen' }]);
  });
  test('keine Liste nach dem Versand, keine Listen, nicht lesbar, kein Paket -> nichts melden', () => {
    const p = [pos('JFN:7:1', NR_A)];
    expect(da({ positionen: p, lieferscheine: ls('2026-11-05'), listen: [liste('2026-11-04')] })).toBeNull();
    expect(da({ positionen: p, lieferscheine: ls('2026-11-05'), listen: [] })).toBeNull();
    expect(da({ positionen: p, lieferscheine: ls('2026-11-05'), listen: null })).toBeNull();
    expect(da({ positionen: p, lieferscheine: [], listen: [liste('2026-11-11')] })).toBeNull();
    expect(da({ positionen: p, lieferscheine: [{ la: 'LA1', datum: '', pakete: [{}] }], listen: [liste('2026-11-11')] })).toBeNull();
  });
  test('nur Status bestellt ohne sperrenden Hinweis', () => {
    const p = [pos('A', NR_A, { status: 'geliefert' }), pos('B', NR_B, { status: 'abgewählt' }), pos('C', NR_C, { gesperrt: true }), pos('D', '1000000004', { status: 'Lager' })];
    expect(da({ positionen: p, lieferscheine: ls('2026-11-01'), listen: [liste('2026-11-04')] }).positionen).toEqual([]);
  });
});

describe('Paket-Zaehler', () => {
  test('weniger Kartons als Pakete -> fehlt, ausser alles geliefert; ohne Pakete -> null', () => {
    expect(paketZaehler({ pakete: 2, gescannt: 1, status: 'versandt' })).toEqual({ pakete: 2, gescannt: 1, fehlt: true });
    expect(paketZaehler({ pakete: 2, gescannt: 2, status: 'versandt' })).toEqual({ pakete: 2, gescannt: 2, fehlt: false });
    expect(paketZaehler({ pakete: 1, gescannt: 0, status: 'geliefert' })).toEqual({ pakete: 1, gescannt: 0, fehlt: false });
    expect(paketZaehler({ pakete: 0, gescannt: 0, status: 'bestätigt' })).toBeNull();
  });
  test('baueBestellungen: Felder nur mit kartons/listen, sonst wie bisher', () => {
    const edi = [{ orderId: 'JFN-2026-0005', ediStatus: 'versandt', korbSchluessel: [], positionen: '1', stueck: '1' }];
    const korb = [{ Schluessel: 'JFN:9:1', Shop: 'JFN', Herkunft: 'shop', Bestellnummer: '9', Position: '1', LShop_ArticleNr: NR_A, Menge: '1', Status: 'bestellt', Bestell_ID: 'JFN-2026-0005', Hinweis: '' }];
    const sendungen = [{ order_id: 'JFN-2026-0005', LA: 'LA1', VA: 'VA1', Paketnummer: 'P1', Datei: 'DeliveryConfirmation_20261030204945.xml' },
      { order_id: 'JFN-2026-0005', LA: 'LA1', VA: 'VA1', Paketnummer: 'P2', Datei: 'DeliveryConfirmation_20261030204945.xml' }];
    const ohne = baueBestellungen({ edi, korb, modelle: new Map(), sendungen }).bestellungen[0];
    expect(ohne).not.toHaveProperty('paketZaehler');
    expect(ohne).not.toHaveProperty('wahrscheinlichDa');
    const mit = baueBestellungen({ edi, korb, modelle: new Map(), sendungen, kartons: new Map([['JFN-2026-0005', 1]]), listen: [liste('2026-11-04')] }).bestellungen[0];
    expect(mit.paketZaehler).toEqual({ pakete: 2, gescannt: 1, fehlt: true });
    expect(mit.wahrscheinlichDa).toMatchObject({ liste: '2026-11-04', positionen: [{ schluessel: 'JFN:9:1', text: 'wahrscheinlich da' }] });
  });
});

// ── Frontend (Block L-Shop-Bestellungen) ──────────────────────────────────────
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

describe('Frontend WE2', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = html.slice(html.indexOf('// ── L-Shop-Bestellungen: Anfang'), html.indexOf('// ── L-Shop-Bestellungen: Ende ──'));
  const f = new Function(`${block}\nreturn { lbWahrscheinlichHtml, lbPaketZaehlerHtml, lbEingangListeHtml, ksErgebnisHtml };`)();
  const p = (schluessel, o = {}) => ({ schluessel, reference: 'JFN-1-1', catalogNr: 'E3000', farbe: 'Black', groesse: 'M', menge: 1, status: 'bestellt', ...o });

  test('Paket-Zaehler: orange mit "fehlt"-Hilfe, sonst neutral, ohne Zaehler leer', () => {
    expect(f.lbPaketZaehlerHtml({ pakete: 2, gescannt: 1, fehlt: true })).toMatch(/class="lb-paketzahl lb-paket-fehlt" data-hilfe="lb-paket-fehlt">· 2 Pakete laut Lieferbestätigung · 1 Karton gescannt/);
    expect(f.lbPaketZaehlerHtml({ pakete: 1, gescannt: 1, fehlt: false })).toMatch(/class="lb-paketzahl" data-hilfe="lb-paket-zaehler">· 1 Paket laut Lieferbestätigung · 1 Karton gescannt/);
    expect(f.lbPaketZaehlerHtml(null)).toBe('');
  });
  test('Block: nur noch bestellte Positionen, "bitte zählen" ohne Haken, Knopf je Position + "alle markierten", maskiert', () => {
    const b = { orderId: 'JFN-2026-0005', positionen: [p('A'), p('B', { reference: '<b>x</b>' }), p('C', { status: 'geliefert' })],
      wahrscheinlichDa: { liste: '2026-11-04', positionen: [
        { schluessel: 'A', zaehlen: false, text: 'wahrscheinlich da' },
        { schluessel: 'B', zaehlen: true, text: '3 von 5 wahrscheinlich da, Rest im Rückstand – bitte zählen' },
        { schluessel: 'C', zaehlen: false, text: 'wahrscheinlich da' }] } };
    const h = f.lbWahrscheinlichHtml(b);
    expect(h).toContain('2 Positionen wahrscheinlich da – bitte prüfen');
    expect(h).toContain('nicht in Rückstandsliste vom 4.11.2026');
    expect(h).toContain('data-wd-pos="A" checked');
    expect(h).toMatch(/data-wd-pos="B">/);
    expect(h).not.toContain('data-wd-pos="C"');
    expect(h).toContain('data-wd-eins="A" data-hilfe="wd-eins"');
    expect(h).toContain('data-wd-alle="JFN-2026-0005" data-hilfe="wd-alle"');
    expect(h).not.toContain('<b>x');
    expect(f.lbWahrscheinlichHtml({ ...b, wahrscheinlichDa: null })).toBe('');
  });
  test('Ware angekommen: Vorwahl hakt nur die gewaehlten an, ohne Vorwahl alle bestellten', () => {
    const b = { positionen: [p('A'), p('B')] };
    expect(f.lbEingangListeHtml(b, new Set(['B']))).toMatch(/data-we-pos="A">[\s\S]*data-we-pos="B" checked/);
    expect(f.lbEingangListeHtml(b)).toMatch(/data-we-pos="A" checked[\s\S]*data-we-pos="B" checked/);
  });
  test('Karton-Scan: "zusammengefasst unter …" steht auch bei gruen', () => {
    const h = f.ksErgebnisHtml({ kartonId: '1', orderId: 'JFN-2026-0006', la: '', stueck: 2, hinweise: [], grund: '', nichtImKarton: [], ampel: 'ok', positionen: [
      { schluessel: 'X', reference: 'JFN-1-1', ord: 1, ampel: 'ok', waehlbar: true, vorgewaehlt: true, zusammengefasst: true, text: 'zusammengefasst unter JFN-1-1' }] });
    expect(h).toContain('zusammengefasst unter JFN-1-1');
    expect(h).toContain('data-ks-pos="X" checked');
  });
  test('Quelltext: Klick oeffnet nur den Dialog "Ware angekommen" (kein eigener Buchungsweg)', () => {
    const klick = html.slice(html.indexOf("const eins = ev.target.closest('[data-wd-eins]')"), html.indexOf("if (!ev.target.closest('[data-portal-aeltere]'))"));
    expect(klick).toMatch(/weOeffnen\(/);
    expect(klick).not.toMatch(/apiFetch|wareneingang/);
  });
});
