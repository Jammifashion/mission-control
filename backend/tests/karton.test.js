// BO4b-5 Schritt 2: Karton-Scan. Nachbau der Karton-PDF (Aufbau gemessen 27.10., Werte ERFUNDEN), Link-Muster,
// Abgleich gegen den Korb, Schreibweg gegen ein In-Memory-Sheet und: der Link (mit Kundennummer) taucht nie in
// Antwort, Fehlertext oder Konsole auf.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { SENDUNGEN_TAB, SENDUNGEN_SPALTEN } from '../utils/lshop-belege.js';
import { kartonLink, leseKartonPdf, kartonAbgleich, KARTONS_TAB, KARTONS_SPALTEN, kartonDatei } from '../utils/karton.js';
import { referenzFuer } from '../utils/edi-bestellung.js';
import { kartonPruefen, kartonAngekommen, ladeKartonPdf } from '../lib/karton.js';
import { _customerIdCacheLeeren } from '../lib/lshopEdi.js';
import { ArchivKonflikt } from '../lib/belegArchiv.js';
import { machSheets, NR, NR2 } from './hilfen/korb-sheet.js';

const KUNDE = '99999901';           // erfunden
const KARTON = '424242';            // erfunden
const HEX = 'AB'.repeat(32);
const LINK = `https://textilelogistics.eu/pdf/0A/1B/${KUNDE}_${KARTON}_${HEX}.pdf`;
const ID = 'JFN-2026-0007';
const NR3 = '1000555555';
const hier = dirname(fileURLToPath(import.meta.url));
const JETZT = () => new Date('2026-10-27T15:00:00Z');

// ── PDF-Nachbau ──────────────────────────────────────────────────────────────
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/ü/g, '\\374').replace(/ö/g, '\\366');
const bt = (x, y, s, f = 'F1', n = 9) => `BT /${f} ${n} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
const kopfzeile = y => [bt(40, y, 'Article-No', 'F2'), bt(132, y, 'SKU', 'F2'), bt(228, y, 'Color', 'F2'), bt(365, y, 'Size', 'F2'), bt(481, y, 'Ord.', 'F2'), bt(539, y, 'Qty.', 'F2')];
const daten = (y, art, sku, farbe, gr, qty = '9') => [bt(40, y, art), bt(132, y, sku), bt(228, y, farbe), bt(365, y, gr), bt(493, y, '1'), bt(547, y, qty)];
function seite(stuecke) { return stuecke.join('\n'); }
export function bauePdf(seiten) {
  const objekte = [];
  const add = s => { objekte.push(s); return objekte.length; };
  const kids = [];
  const inhalte = seiten.map(s => add(`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`));
  inhalte.forEach(c => kids.push(add(`<< /Type /Page /Contents ${c} 0 R >>`)));
  add(`<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  return Buffer.from(`%PDF-1.4\n${objekte.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj`).join('\n')}\n%%EOF`, 'latin1');
}
function standardPdf({ orderId = ID } = {}) {
  const s1 = seite([
    bt(36, 806, 'LA00001234 VA00005678'), bt(36, 790, orderId), bt(36, 758, 'Testkommission'),
    bt(36, 720, 'JFN-100-1'), ...kopfzeile(705),
    ...daten(690, 'JH030F', NR, 'Deep Black', 'XXL'),
    bt(407, 670, 'Subtotal'), bt(493, 670, '1'),
    bt(36, 640, 'JFN-101-2'), ...kopfzeile(625),
    ...daten(610, 'JH030F', NR2, 'Deep Black', 'XL', '1'), ...daten(598, 'JH030F', NR2, 'Deep Black', 'XL', '1'),
    bt(505, 22, 'Page 1/2'),
  ]);
  const s2 = seite([
    ...daten(790, 'JH030F', NR2, 'Deep Black', 'XL', '7'),
    bt(407, 770, 'Subtotal'), bt(493, 770, '3'),
    bt(36, 740, 'Grüße'), ...kopfzeile(725),
    ...daten(710, 'JH001', NR3, 'Wöhite', 'M'),
    bt(407, 690, 'Subtotal'), bt(493, 690, '1'),
    bt(419, 660, 'Total'), bt(489, 660, '5'), bt(543, 660, '27'),
    bt(505, 22, 'Page 2/2'),
  ]);
  return bauePdf([s1, s2]);
}

describe('Link-Muster', () => {
  test('gueltiger Link -> Kunde und Karton-ID', () => {
    expect(kartonLink(LINK)).toEqual({ kunde: KUNDE, kartonId: KARTON });
  });
  test.each([
    LINK.replace('https', 'http'), LINK.replace('textilelogistics.eu', 'textilelogistics.eu.example.com'),
    `${LINK}?x=1`, LINK.replace('.pdf', '.PDF'), LINK.replace(HEX, 'AB'), 'javascript:alert(1)', '',
  ])('ungueltig: %s -> 400 ohne Link im Text', l => {
    let e; try { kartonLink(l); } catch (x) { e = x; }
    expect(e.status).toBe(400);
    expect(e.message).not.toContain(KUNDE);
  });
});

describe('PDF lesen', () => {
  test('Kopf, Gruppen ueber zwei Seiten, Ord summiert, Qty ignoriert, Umlaute', () => {
    const k = leseKartonPdf(standardPdf());
    expect(k).toMatchObject({ orderId: ID, la: 'LA00001234', va: 'VA00005678', stueck: 5, hinweise: [] });
    expect(k.positionen).toEqual([
      expect.objectContaining({ reference: 'JFN-100-1', sku: NR, ord: 1, size: 'XXL', color: 'Deep Black' }),
      expect.objectContaining({ reference: 'JFN-101-2', sku: NR2, ord: 3, zeilen: 3 }),
      expect.objectContaining({ reference: 'Grüße', sku: NR3, ord: 1, color: 'Wöhite' }),
    ]);
  });
  test('keine PDF -> 422', () => {
    expect(() => leseKartonPdf(Buffer.from('<html>'))).toThrow(expect.objectContaining({ status: 422 }));
  });
  test('Zwischensumme passt nicht -> Hinweis', () => {
    const pdf = bauePdf([seite([bt(36, 790, ID), bt(36, 720, 'X-1'), ...kopfzeile(705), ...daten(690, 'A', NR, 'Rot', 'M'), bt(407, 670, 'Subtotal'), bt(493, 670, '2')])]);
    expect(leseKartonPdf(pdf).hinweise[0]).toMatch(/weicht/);
  });
});

// ── Korb ─────────────────────────────────────────────────────────────────────
const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'bestellt', Menge: '1', Bestell_ID: ID, ...o }[s] ?? ''));
const KORB = () => [
  korbZeile({ Schluessel: 'JFN:100:1', Bestellnummer: '100', Position: '1', LShop_ArticleNr: NR }),
  korbZeile({ Schluessel: 'JFN:101:2', Bestellnummer: '101', Position: '2', LShop_ArticleNr: NR2, Menge: '3' }),
  korbZeile({ Schluessel: 'EIGEN:2026-0001', Herkunft: 'eigen', Referenz: 'Grüße', LShop_ArticleNr: NR3, Menge: '2' }),
  korbZeile({ Schluessel: 'JFN:103:1', Bestellnummer: '103', Position: '1', LShop_ArticleNr: NR, Status: 'bestellt' }),
];
const zeilenObj = zs => zs.map((r, i) => ({ _zeile: i + 2, ...Object.fromEntries(KORB_SPALTEN.map((s, j) => [s, r[j]])) }));

describe('Abgleich', () => {
  const karton = leseKartonPdf(standardPdf());
  test('passt / Menge anders / nicht im Karton', () => {
    const a = kartonAbgleich({ karton, korbZeilen: zeilenObj(KORB()), referenz: referenzFuer });
    expect(a.ampel).toBe('gelb');
    expect(a.positionen.map(p => [p.schluessel, p.ampel, p.waehlbar, p.vorgewaehlt])).toEqual([
      ['JFN:100:1', 'ok', true, true], ['JFN:101:2', 'ok', true, true], ['EIGEN:2026-0001', 'gelb', true, false],
    ]);
    expect(a.positionen[2].text).toBe('Menge anders (Korb 2, Karton 1)');
    expect(a.nichtImKarton.map(p => p.schluessel)).toEqual(['JFN:103:1']);
  });
  test('schon geliefert und nicht im Korb', () => {
    const korb = KORB(); korb[0][KORB_SPALTEN.indexOf('Status')] = 'geliefert'; korb.splice(1, 1);
    const a = kartonAbgleich({ karton, korbZeilen: zeilenObj(korb), referenz: referenzFuer });
    expect(a.positionen.map(p => [p.text, p.waehlbar])).toEqual([['schon geliefert', false], ['nicht im Korb', false], ['Menge anders (Korb 2, Karton 1)', true]]);
  });
  test('unbekannte order_id -> rot', () => {
    const a = kartonAbgleich({ karton: { ...karton, orderId: 'JFN-2026-0999' }, korbZeilen: zeilenObj(KORB()), referenz: referenzFuer });
    expect(a).toMatchObject({ ampel: 'rot', positionen: [] });
  });
  test('doppelter Scan -> gelb mit Datum', () => {
    const a = kartonAbgleich({ karton, korbZeilen: zeilenObj(KORB().slice(0, 2)), referenz: referenzFuer, schonDa: { Eingang: '2026-10-26T10:00:00Z' } });
    expect(a).toMatchObject({ ampel: 'gelb', grund: 'Karton schon eingegangen am 2026-10-26' });
  });
});

// ── Schreibweg ───────────────────────────────────────────────────────────────
function aufbau({ kartons = [KARTONS_SPALTEN], customerId = KUNDE, pdf = standardPdf() } = {}) {
  const tabs = {
    [TAB_KORB]: [KORB_SPALTEN, ...KORB()],
    [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN, SENDUNGEN_SPALTEN.map(s => ({ Paketnummer: '000000000001', order_id: ID }[s] ?? ''))],
    Config: [['Schlüssel', 'Wert'], ['lshop.customer_id', customerId]],
    ...(kartons ? { [KARTONS_TAB]: kartons } : {}),
  };
  const { sheets, aufrufe } = machSheets(tabs);
  const holen = jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => String(pdf.length) }, arrayBuffer: async () => pdf }));
  const archiv = jest.fn(async () => ({ status: 'neu', id: 'drive-1' }));
  return { tabs, sheets, aufrufe, holen, archiv };
}
const sp = n => KORB_SPALTEN.indexOf(n);
let log;
beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'biz';
  _customerIdCacheLeeren();
  log = [];
  for (const m of ['log', 'warn', 'error']) jest.spyOn(console, m).mockImplementation((...a) => log.push(a.map(String).join(' ')));
});
afterEach(() => jest.restoreAllMocks());
const ohneLink = x => { const s = JSON.stringify(x) + log.join('\n'); expect(s).not.toContain(KUNDE); expect(s).not.toContain(HEX); };

describe('Pruefen und Angekommen', () => {
  test('pruefen schreibt nichts und gibt den Link nicht zurueck', async () => {
    const a = aufbau();
    const r = await kartonPruefen({ link: LINK, sheets: a.sheets, holen: a.holen });
    expect(r).toMatchObject({ kartonId: KARTON, orderId: ID, ampel: 'gelb', stueck: 5 });
    expect(a.aufrufe.update).toEqual([]); expect(a.aufrufe.batchUpdate).toEqual([]);
    expect(a.holen).toHaveBeenCalledWith(LINK, expect.objectContaining({ redirect: 'error' }));
    ohneLink(r);
  });
  test('fremdes Konto -> 422, kein Abruf', async () => {
    const a = aufbau({ customerId: '11111111' });
    await expect(kartonPruefen({ link: LINK, sheets: a.sheets, holen: a.holen })).rejects.toMatchObject({ status: 422, message: 'Karton nicht von unserem L-Shop-Konto.' });
    expect(a.holen).not.toHaveBeenCalled();
  });
  test('angekommen: archiviert, bucht nur Gewaehltes, Protokollzeile ohne append', async () => {
    const a = aufbau();
    const r = await kartonAngekommen({ link: LINK, auswahl: [{ schluessel: 'JFN:100:1', status: 'bestellt' }, { schluessel: 'JFN:101:2', status: 'bestellt' }], sheets: a.sheets, holen: a.holen, archiv: a.archiv, jetzt: JETZT });
    expect(a.archiv).toHaveBeenCalledWith(expect.objectContaining({ art: 'Karton', jahr: '2026', name: `LA00001234_${KARTON}.pdf`, mime: 'application/pdf' }));
    expect(r).toMatchObject({ ok: true, positionen: 2, status: 'geliefert', kartonId: KARTON, archiv: 'neu', protokoll: 'Zeile 2', nichtGebucht: 1, abweichungen: 2 });
    expect([1, 2, 3, 4].map(z => a.tabs[TAB_KORB][z][sp('Status')])).toEqual(['geliefert', 'geliefert', 'bestellt', 'bestellt']);
    const k = Object.fromEntries(KARTONS_SPALTEN.map((n, i) => [n, a.tabs[KARTONS_TAB][1][i]]));
    expect(k).toMatchObject({ Karton_ID: KARTON, LA: 'LA00001234', VA: 'VA00005678', order_id: ID, Quelle: 'scan', Datei: kartonDatei('LA00001234', KARTON), Drive_ID: 'drive-1', Abweichungen: '2' });
    expect(a.aufrufe.append).toBe(0);
    ohneLink({ r, korb: a.tabs[TAB_KORB], sendungen: a.tabs[SENDUNGEN_TAB], kartons: a.tabs[KARTONS_TAB] });   // Config traegt sie zu Recht
  });
  test('nicht waehlbare Position -> 422, nichts geschrieben, nichts archiviert', async () => {
    const a = aufbau();
    await expect(kartonAngekommen({ link: LINK, auswahl: [{ schluessel: 'JFN:103:1', status: 'bestellt' }], sheets: a.sheets, holen: a.holen, archiv: a.archiv, jetzt: JETZT }))
      .rejects.toMatchObject({ status: 422, probleme: [{ schluessel: 'JFN:103:1', text: 'nicht in diesem Karton wählbar' }] });
    expect(a.archiv).not.toHaveBeenCalled(); expect(a.aufrufe.batchUpdate).toEqual([]);
  });
  test('Archiv-Konflikt -> 409, nichts gebucht', async () => {
    const a = aufbau();
    a.archiv.mockRejectedValue(new ArchivKonflikt('x liegt im Archiv mit anderem Inhalt'));
    await expect(kartonAngekommen({ link: LINK, auswahl: [{ schluessel: 'JFN:100:1', status: 'bestellt' }], sheets: a.sheets, holen: a.holen, archiv: a.archiv, jetzt: JETZT })).rejects.toMatchObject({ status: 409 });
    expect(a.aufrufe.batchUpdate).toEqual([]);
  });
  test('zweiter Scan: Rest buchbar, keine zweite Protokollzeile', async () => {
    const a = aufbau({ kartons: [KARTONS_SPALTEN, KARTONS_SPALTEN.map(n => ({ Karton_ID: KARTON, Eingang: '2026-10-26T10:00:00Z' }[n] ?? ''))] });
    const r = await kartonAngekommen({ link: LINK, auswahl: [{ schluessel: 'EIGEN:2026-0001', status: 'bestellt' }], sheets: a.sheets, holen: a.holen, archiv: a.archiv, jetzt: JETZT });
    expect(r.protokoll).toBe('schon vorhanden');
    expect(a.tabs[KARTONS_TAB]).toHaveLength(2);
  });
  test('Reiter LShop_Kartons fehlt -> 503 vor jedem Schreiben', async () => {
    const a = aufbau({ kartons: null });
    await expect(kartonAngekommen({ link: LINK, auswahl: [{ schluessel: 'JFN:100:1', status: 'bestellt' }], sheets: a.sheets, holen: a.holen, archiv: a.archiv, jetzt: JETZT })).rejects.toMatchObject({ status: 503 });
    expect(a.archiv).not.toHaveBeenCalled();
  });
});

describe('Abruf', () => {
  test('Netzfehler mit Link im Text -> eigener Text ohne Link', async () => {
    const holen = async () => { throw new TypeError(`fetch failed ${LINK}`); };
    const e = await ladeKartonPdf(LINK, { holen }).catch(x => x);
    expect(e.status).toBe(502); expect(e.message).not.toContain(KUNDE);
  });
  test('Zeitlimit -> 504', async () => {
    const holen = async () => { const e = new Error('x'); e.name = 'TimeoutError'; throw e; };
    await expect(ladeKartonPdf(LINK, { holen })).rejects.toMatchObject({ status: 504 });
  });
  test('zu gross und HTML -> 422', async () => {
    const gross = async () => ({ ok: true, status: 200, headers: { get: () => String(5e6) }, arrayBuffer: async () => Buffer.alloc(1) });
    await expect(ladeKartonPdf(LINK, { holen: gross })).rejects.toMatchObject({ status: 422 });
    const html = async () => ({ ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('<html>') });
    await expect(ladeKartonPdf(LINK, { holen: html })).rejects.toMatchObject({ status: 422, message: 'Karton-Link liefert keine PDF.' });
  });
});

// ── Oberflaeche ──────────────────────────────────────────────────────────────
describe('Frontend Karton-Scan', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const von = html.indexOf('// ── L-Shop-Bestellungen: Anfang');
  const bis = html.indexOf('// ── L-Shop-Bestellungen: Ende ──');
  const { ksErgebnisHtml } = new Function(`${html.slice(von, bis)}\nreturn { ksErgebnisHtml };`)();
  const basis = { kartonId: KARTON, orderId: ID, la: 'LA00001234', stueck: 3, hinweise: [], grund: '', nichtImKarton: [] };

  test('ok vorgewaehlt, Menge anders ohne Haken, sonst kein Kaestchen, alles maskiert', () => {
    const h = ksErgebnisHtml({ ...basis, ampel: 'gelb', positionen: [
      { schluessel: 'JFN:100:1', reference: 'JFN-100-1', ord: 1, ampel: 'ok', waehlbar: true, vorgewaehlt: true, text: 'passt' },
      { schluessel: 'EIGEN:1', reference: '<b>x</b>', ord: 1, ampel: 'gelb', waehlbar: true, vorgewaehlt: false, text: 'Menge anders (Korb 2, Karton 1)' },
      { schluessel: '', reference: 'Y-1', ord: 2, ampel: 'gelb', waehlbar: false, vorgewaehlt: false, text: 'nicht im Korb' },
    ] });
    expect(h).toContain('data-ks-pos="JFN:100:1" checked');
    expect(h).toMatch(/data-ks-pos="EIGEN:1">/);
    expect(h.match(/data-ks-pos/g)).toHaveLength(2);
    expect(h).not.toContain('<b>x'); expect(h).toContain('&#60;b&#62;x');
    expect(h).toContain('nicht im Korb');
  });
  test('rot: nur der Grund, keine Auswahl', () => {
    const h = ksErgebnisHtml({ ...basis, ampel: 'rot', grund: 'JFN-2026-0999 ist keine bekannte L-Shop-Bestellung im Korb', positionen: [] });
    expect(h).toMatch(/keine bekannte/); expect(h).not.toContain('data-ks-pos');
  });
  test('Scan-Teil: Link nie in Adresse, Speicher, Anzeige oder Toast', () => {
    const a = html.indexOf('// ── SECTION: Karton-Scan (BO4b-5) ──');
    const teil = html.slice(a, html.indexOf('// ── SECTION:', a + 10));
    expect(teil).not.toMatch(/localStorage|sessionStorage|location|history\.|console\./);
    expect(teil).not.toMatch(/(textContent|innerHTML|showToast)[^;\n]*ksZustand\.link/);
    expect(teil).not.toMatch(/(textContent|innerHTML|showToast)[^;\n]*\btreffer\b/);
    expect(html).toContain('data-hilfe="karton-scannen"');
  });
});
