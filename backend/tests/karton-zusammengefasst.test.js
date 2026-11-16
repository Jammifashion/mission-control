// WE2 Teil 1: von L-Shop zusammengefasste Karton-Zeilen (gemessen 16.11., bericht-WE1). Gleiche Nummer in mehreren Positionen
// einer L-Shop-Bestellung -> EINE Zeile mit der Referenz der ersten Position, (Anzahl Referenzen)² mal gedruckt, Ord. falsch,
// Qty. = Gesamtmenge. PDF-Nachbau wie karton.test.js, alle Werte ERFUNDEN.

import { KORB_SPALTEN } from '../utils/korb-logic.js';
import { leseKartonPdf, kartonAbgleich } from '../utils/karton.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import { lagerRestFuer } from '../utils/lager-eingang.js';

const ID = 'JFN-2026-0017';
const NR = '1000111111', NR2 = '1000222222';
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const bt = (x, y, s) => `BT /F1 9 Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
const kopfzeile = y => [bt(40, y, 'Article-No'), bt(132, y, 'SKU'), bt(228, y, 'Color'), bt(365, y, 'Size'), bt(481, y, 'Ord.'), bt(539, y, 'Qty.')];
const daten = (y, sku, ord, qty) => [bt(40, y, 'E3000'), bt(132, y, sku), bt(228, y, 'Black'), bt(365, y, '5XL'), bt(493, y, String(ord)), bt(551, y, String(qty))];
function bauePdf(seiten) {
  const objekte = [];
  const add = s => { objekte.push(s); return objekte.length; };
  const kids = [];
  const inhalte = seiten.map(s => add(`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`));
  inhalte.forEach(c => kids.push(add(`<< /Type /Page /Contents ${c} 0 R >>`)));
  add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  return Buffer.from(`%PDF-1.4\n${objekte.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj`).join('\n')}\n%%EOF`, 'latin1');
}
/** Karton mit Gruppen [{ ref, sku, zeilen, ord, qty }] (Zeilen gleich, wie gemessen). */
function karton(gruppen) {
  let y = 760;
  const teile = [bt(36, 806, 'LA00009999 VA00008888'), bt(36, 790, ID)];
  for (const g of gruppen) {
    teile.push(bt(36, y, g.ref), ...kopfzeile(y - 15)); y -= 30;
    for (let i = 0; i < g.zeilen; i++) { teile.push(...daten(y, g.sku, g.ord ?? 1, g.qty)); y -= 12; }
    teile.push(bt(407, y, 'Subtotal'), bt(493, y, String(g.zeilen * (g.ord ?? 1)))); y -= 25;
  }
  return leseKartonPdf(bauePdf([teile.join('\n')]));
}
const korbZeile = o => Object.fromEntries(KORB_SPALTEN.map(s => [s, { Shop: 'JFN', Herkunft: 'shop', Status: 'bestellt', Menge: '1', Bestell_ID: ID, ...o }[s] ?? '']));
const shop = (nr, pos, sku, o = {}) => korbZeile({ Schluessel: `JFN:${nr}:${pos}`, Bestellnummer: String(nr), Position: String(pos), LShop_ArticleNr: sku, ...o });
const eigen = (n, ref, sku, o = {}) => korbZeile({ Schluessel: `EIGEN:2026-${n}`, Herkunft: 'eigen', Referenz: ref, LShop_ArticleNr: sku, ...o });
const abgleich = (k, korb) => kartonAbgleich({ karton: k, korbZeilen: korb, referenz: referenzFuer });
const kurz = a => a.positionen.map(p => [p.schluessel, p.ampel, p.waehlbar, p.vorgewaehlt]);

describe('PDF: Qty je reference + SKU', () => {
  test('alle Zeilen gleiche Qty -> qty, Ord bleibt Summe', () => {
    const k = karton([{ ref: 'JFN-300-1', sku: NR, zeilen: 4, qty: 2 }]);
    expect(k.positionen[0]).toMatchObject({ reference: 'JFN-300-1', ord: 4, zeilen: 4, qty: 2 });
  });
});

describe('Abgleich: zusammengefasste Zeilen', () => {
  test('2 Referenzen -> 4 Zeilen, Qty = Summe: beide gruen, vorgewaehlt, Stueck = Qty, kein Rest ins Lager', () => {
    const k = karton([{ ref: 'JFN-300-1', sku: NR, zeilen: 4, qty: 2 }]);
    const a = abgleich(k, [shop(300, 1, NR), eigen('0001', 'Lager', NR)]);
    expect(kurz(a)).toEqual([['JFN:300:1', 'ok', true, true], ['EIGEN:2026-0001', 'ok', true, true]]);
    expect(a.positionen.map(p => p.text)).toEqual(['zusammengefasst unter JFN-300-1', 'zusammengefasst unter JFN-300-1']);
    expect(a.positionen.map(p => p.ord)).toEqual([1, 1]);
    expect(a.positionen.map(lagerRestFuer)).toEqual([0, 0]);
    expect(a).toMatchObject({ ampel: 'ok', nichtImKarton: [], stueck: 2 });
    expect(k.stueck).toBe(4);   // die PDF selbst zaehlt die Wiederholungen mit
  });
  test('4 Referenzen -> 16 Zeilen, Mengen 1/1/3/1 = Qty 6: alle gruen', () => {
    const k = karton([{ ref: 'JFN-310-1', sku: NR, zeilen: 16, qty: 6 }]);
    const korb = [shop(310, 1, NR), shop(310, 2, NR), eigen('0002', 'Bestellung A', NR, { Menge: '3' }), eigen('0003', 'Bestellung B', NR)];
    const a = abgleich(k, korb);
    expect(kurz(a).map(x => x[1])).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(a.positionen.map(p => p.ord)).toEqual([1, 1, 3, 1]);
    expect(a.stueck).toBe(6);
  });
  test('Qty passt nicht zur Summe -> alle gelb, waehlbar, nicht vorgewaehlt, "bitte zählen"', () => {
    const k = karton([{ ref: 'AU-2026-0005', sku: NR, zeilen: 2, qty: 3 }]);
    const a = abgleich(k, [eigen('0010', 'AU-2026-0005', NR), eigen('0011', 'Lager', NR, { Menge: '3' })]);
    expect(kurz(a)).toEqual([['EIGEN:2026-0010', 'gelb', true, false], ['EIGEN:2026-0011', 'gelb', true, false]]);
    expect(a.positionen[0].text).toBe('zusammengefasst unter AU-2026-0005 – Karton 3, offen zusammen 4: bitte zählen');
  });
  test('Qty groesser als Summe -> Ueberschuss nur an der Kopf-Position', () => {
    const k = karton([{ ref: 'JFN-320-1', sku: NR, zeilen: 4, qty: 3 }]);
    const a = abgleich(k, [shop(320, 1, NR), shop(320, 2, NR)]);
    expect(a.positionen.map(lagerRestFuer)).toEqual([1, 0]);
  });
  test('ueber zwei Kartons (gemessen 0008): Qty = Stueck in DIESEM Karton - A 3 von 4 zaehlen, B Rest gruen', () => {
    const korb = [eigen('0030', 'AU-2026-0005', NR), eigen('0031', 'Lager', NR, { Menge: '3' })];
    const a = abgleich(karton([{ ref: 'AU-2026-0005', sku: NR, zeilen: 2, qty: 3 }]), korb);
    expect(kurz(a)).toEqual([['EIGEN:2026-0030', 'gelb', true, false], ['EIGEN:2026-0031', 'gelb', true, false]]);
    expect(a.stueck).toBe(3);
    korb[1].Status = 'geliefert';   // Lager x3 im ersten Karton gebucht
    const b = abgleich(karton([{ ref: 'AU-2026-0005', sku: NR, zeilen: 2, qty: 1 }]), korb);
    expect(kurz(b)).toEqual([['EIGEN:2026-0030', 'ok', true, true], ['EIGEN:2026-0031', 'gelb', false, false]]);
    expect(b.positionen.map(lagerRestFuer)).toEqual([0, 0]);
  });
  test('alles schon geliefert (Karton nochmal gescannt) -> kein Rest ins Lager', () => {
    const k = karton([{ ref: 'JFN-380-1', sku: NR, zeilen: 4, qty: 2 }]);
    const a = abgleich(k, [shop(380, 1, NR, { Status: 'geliefert' }), shop(380, 2, NR, { Status: 'geliefert' })]);
    expect(a.positionen.map(lagerRestFuer)).toEqual([0, 0]);
  });
  test('ueber zwei Kartons: im zweiten Karton schon geliefert -> gelb, nicht waehlbar (nie doppelt)', () => {
    const k = karton([{ ref: 'JFN-330-1', sku: NR, zeilen: 2, qty: 2 }]);
    const a = abgleich(k, [shop(330, 1, NR, { Status: 'geliefert' }), eigen('0020', 'Lager', NR, { Status: 'geliefert' })]);
    expect(kurz(a)).toEqual([['JFN:330:1', 'gelb', false, false], ['EIGEN:2026-0020', 'gelb', false, false]]);
    expect(a.positionen.map(p => p.text)).toEqual(['schon geliefert', 'schon geliefert']);
  });
  test('Position mit eigener Zeile im Karton gehoert nicht zur Gruppe', () => {
    const k = karton([{ ref: 'JFN-340-1', sku: NR, zeilen: 4, qty: 2 }, { ref: 'JFN-340-3', sku: NR, zeilen: 1, qty: 1 }]);
    const a = abgleich(k, [shop(340, 1, NR), shop(340, 2, NR), shop(340, 3, NR)]);
    expect(kurz(a)).toEqual([['JFN:340:1', 'ok', true, true], ['JFN:340:2', 'ok', true, true], ['JFN:340:3', 'ok', true, true]]);
  });
  test('nicht zusammengefasst: Qty = Menge, eine Zeile je Stueck -> wie bisher', () => {
    const k = karton([{ ref: 'JFN-350-1', sku: NR, zeilen: 2, qty: 2 }, { ref: 'JFN-351-1', sku: NR2, zeilen: 1, ord: 10, qty: 10 }]);
    const a = abgleich(k, [shop(350, 1, NR, { Menge: '2' }), shop(351, 1, NR2, { Menge: '10' }), shop(352, 1, NR)]);
    expect(kurz(a)).toEqual([['JFN:350:1', 'ok', true, true], ['JFN:351:1', 'ok', true, true]]);
    expect(a.nichtImKarton.map(p => p.schluessel)).toEqual(['JFN:352:1']);
  });
  test('Qty groesser, aber keine weitere Position der Nummer -> wie bisher "Menge anders"', () => {
    const k = karton([{ ref: 'JFN-360-1', sku: NR, zeilen: 4, qty: 4 }]);
    const a = abgleich(k, [shop(360, 1, NR)]);
    expect(a.positionen[0]).toMatchObject({ ampel: 'gelb', text: 'Menge anders (Korb 1, Karton 4)', waehlbar: true });
  });
  test('abgewaehlte Position derselben Nummer zaehlt nicht mit', () => {
    const k = karton([{ ref: 'JFN-370-1', sku: NR, zeilen: 4, qty: 2 }]);
    const a = abgleich(k, [shop(370, 1, NR), shop(370, 2, NR, { Status: 'abgewählt' }), shop(370, 3, NR)]);
    expect(a.positionen.map(p => p.schluessel)).toEqual(['JFN:370:1', 'JFN:370:3']);
  });
});
