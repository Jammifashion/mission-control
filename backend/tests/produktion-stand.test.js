// PS1: Bestellansicht "Bestellungen (JFN)" - L-Shop-Stand aus dem Warenkorb, Haekchen "Fertig (im Karton)",
// Zusammenfassung im Kopf, Filter "wartet auf Teile". Prueft die Logik (utils/produktion-stand.js), den
// Leser (lib/produktionStand.js), den Schreibweg (PUT /api/sheets/produktions-status, Feld fertig; altes
// Haekchen nicht mehr schreibbar) und den Anzeige-Block "Produktion-Stand" in index.html.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KLASSE, KORB_SPALTEN } from '../utils/korb-logic.js';

// ── In-Memory-Sheet mit Zeilenbereichen (fuer den Schreibweg) ───────────────
let tabs;
const geschrieben = [];
const spalteNr = buchst => [...buchst].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const tabAus = range => String(range).split('!')[0].replace(/'/g, '');
function lies(range) {
  const t = tabs[tabAus(range)] ?? [];
  const teil = String(range).split('!')[1] ?? '';
  const m = teil.match(/^A(\d+):Z(\d+)$/);
  if (m && m[1] === m[2]) return [[...(t[Number(m[1]) - 1] ?? [])]];
  return t.map(z => [...z]);
}
function setze(range, wert) {
  const t = tabs[tabAus(range)];
  const m = String(range).split('!')[1].match(/^([A-Z]+)(\d+)$/);
  const col = spalteNr(m[1]), row = Number(m[2]) - 1;
  while (t.length <= row) t.push([]);
  while (t[row].length <= col) t[row].push('');
  t[row][col] = wert;
}
const values = {
  get: async ({ range }) => ({ data: { values: lies(range) } }),
  update: jest.fn(async ({ range, requestBody }) => { geschrieben.push(range); setze(range, requestBody.values[0][0]); return {}; }),
  batchUpdate: jest.fn(async ({ requestBody }) => {
    for (const d of requestBody.data) { geschrieben.push(d.range); setze(d.range, d.values[0][0]); }
    return {};
  }),
  append: jest.fn(async () => ({})),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

// Leser: BO4d-Bestellungen, Kontext und Produkte des Korb-Abgleichs nachgebildet.
const leseLShopBestellungen = jest.fn();
const ladeKontext = jest.fn();
const ladeProdukte = jest.fn();
jest.unstable_mockModule('../lib/lshopBestellungen.js', () => ({ leseLShopBestellungen }));
jest.unstable_mockModule('../lib/lshopKorb.js', () => ({ ladeKontext, ladeProdukte }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  normalizeShop: s => (String(s ?? '').toLowerCase().trim() === 'honk' ? 'honk' : 'jfn'),
  getWcClient: () => ({ get: async () => ({ data: [] }) }),
}));

const PS_KOPF = ['WC_Order_ID', 'WC_Item_ID', 'Artikelname', 'SKU', 'Menge',
  'L-Shop_bestellt', 'DTF_bestellt', 'Gedruckt', 'Versendet', 'Notiz', 'Shop'];

let L, K, lib, request, app, front;
beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'test';
  L = await import('../utils/produktion-stand.js');
  K = await import('../utils/korb-logic.js');
  lib = await import('../lib/produktionStand.js');
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/sheets', (await import('../routes/sheets.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));

  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const von = html.indexOf('// ── Produktion-Stand: Anfang');
  const bis = html.indexOf('// ── Produktion-Stand: Ende ──');
  front = { html, von, bis, ...new Function(`${html.slice(von, bis)}
    return { PS_FELDER, psLshopHtml, psKopfHtml, psArtikelHtml, psSicht, psZaehler, psWartetReihenfolge, psVariante };`)() };
});

const korbZeile = (o = {}) => ({ Schluessel: 'JFN:100:1', Status: 'offen', Grund: '', Bestell_ID: '', ...o });

// ═══ Logik ═══════════════════════════════════════════════════════════════════
describe('lshopStand: alle Anzeigen', () => {
  test('im Korb offen -> Link zum Warenkorb', () => {
    expect(L.lshopStand({ jfn: true, korb: korbZeile() })).toMatchObject({ art: 'offen', text: 'im Korb offen', ziel: 'lshop-korb' });
  });
  test('herausgenommen mit Grund', () => {
    const s = L.lshopStand({ jfn: true, korb: korbZeile({ Status: 'abgewählt', Grund: 'Ware da / Lager' }) });
    expect(s).toMatchObject({ art: 'raus', text: 'herausgenommen: Ware da / Lager', ziel: 'lshop-korb' });
  });
  test('bestellt ohne Pakete, bestaetigt, mit Paket (versandt · GLS · Paket 1), mehrere Pakete', () => {
    const korb = korbZeile({ Status: 'bestellt', Bestell_ID: 'JFN-2026-0003' });
    expect(L.lshopStand({ jfn: true, korb, bestellung: { status: 'gesendet', lieferscheine: [] } }))
      .toMatchObject({ art: 'bestellt', text: 'bestellt JFN-2026-0003', kurz: 'L-Shop: bestellt', ziel: 'lshop-bestellungen', bestellId: 'JFN-2026-0003' });
    expect(L.lshopStand({ jfn: true, korb, bestellung: { status: 'bestätigt', lieferscheine: [] } }).text).toBe('bestellt JFN-2026-0003 · bestätigt');
    const ein = { status: 'versandt', lieferscheine: [{ pakete: [{ frachtfuehrer: 'GLS' }] }] };
    expect(L.lshopStand({ jfn: true, korb, bestellung: ein })).toMatchObject({ text: 'bestellt JFN-2026-0003 · versandt · GLS · Paket 1', kurz: 'L-Shop: bestellt, versandt' });
    const zwei = { status: 'versandt', lieferscheine: [{ pakete: [{ frachtfuehrer: 'GLS' }] }, { pakete: [{ frachtfuehrer: 'GLS' }] }] };
    expect(L.lshopStand({ jfn: true, korb, bestellung: zwei }).text).toBe('bestellt JFN-2026-0003 · versandt · GLS · 2 Pakete');
    expect(L.lshopStand({ jfn: true, korb }).text).toBe('bestellt JFN-2026-0003');   // EDI-Bestellung nicht gefunden
  });
  test('geliefert', () => {
    expect(L.lshopStand({ jfn: true, korb: korbZeile({ Status: 'geliefert', Bestell_ID: 'JFN-2026-0004' }) }))
      .toMatchObject({ art: 'geliefert', text: 'geliefert', ziel: 'lshop-bestellungen', bestellId: 'JFN-2026-0004' });
  });
  test.each([
    [KLASSE.TRIKOT, 'Trikot'], [KLASSE.EXTERN, 'Fremdware'], [KLASSE.EINFACH, 'Artikel ohne Variation'],
    [KLASSE.OHNE_VARIANTE, 'ohne L-Shop-Daten'],
  ])('ohne Korbzeile, %s -> kein L-Shop-Artikel (grau, kein Link)', (klasse, grund) => {
    expect(L.lshopStand({ jfn: true, klasse })).toMatchObject({ art: 'kein', text: 'kein L-Shop-Artikel', grund, ziel: '', kurz: '' });
  });
  test.each([KLASSE.NR_LEER, KLASSE.NR_FORMAT, KLASSE.NR_UNBEKANNT, KLASSE.AUSGELAUFEN, KLASSE.FREMDES_PRODUKT])(
    'Datenluecke %s -> gelb "L-Shop-Nummer fehlt"', klasse => {
      expect(L.lshopStand({ jfn: true, klasse })).toMatchObject({ art: 'pruefen', text: 'L-Shop-Nummer fehlt', ziel: '' });
    });
  test('Produkt im Shop nicht lesbar -> gelb', () => {
    expect(L.lshopStand({ jfn: true, klasse: KLASSE.PRODUKT_FEHLT })).toMatchObject({ art: 'pruefen', text: 'Produkt im Shop nicht lesbar' });
  });
  test('bestellbar, aber keine Korbzeile -> nicht im Korb (Link zum Korb)', () => {
    expect(L.lshopStand({ jfn: true, klasse: KLASSE.BESTELLBAR })).toMatchObject({ art: 'nicht-im-korb', text: 'nicht im Korb', ziel: 'lshop-korb' });
  });
  test('Altstand: altes Haekchen nur, wo der Korb nichts weiss', () => {
    expect(L.lshopStand({ jfn: true, klasse: KLASSE.TRIKOT, altHaken: true }).alt).toBe(true);
    expect(L.lshopStand({ jfn: true, klasse: KLASSE.BESTELLBAR, altHaken: true }).alt).toBe(true);
    expect(L.lshopStand({ jfn: true, korb: korbZeile(), altHaken: true }).alt).toBeUndefined();
  });
  test('HONK: nur JFN', () => {
    expect(L.lshopStand({ jfn: false })).toMatchObject({ art: 'nur-jfn', text: 'L-Shop-Stand nur für JFN', ziel: '' });
  });
});

describe('psZustaende', () => {
  test('Shop getrennt, Fertig/Fertig_Am ueber den Namen, Altstand aus F', () => {
    const werte = [[...PS_KOPF, 'Fertig', 'Fertig_Am'],
      ['100', '1', 'A', '', '1', 'TRUE', 'FALSE', 'FALSE', 'FALSE', 'n', 'JFN', 'TRUE', '2026-10-20T10:00:00.000Z'],
      ['100', '1', 'A', '', '1', 'FALSE', 'TRUE', 'FALSE', 'TRUE', '', 'HONK', 'FALSE', ''],
      ['100', '2', 'B', '', '1', 'WAHR', 'FALSE', 'FALSE', 'FALSE', '', '', '', '']];
    const { zustaende, fertigSpalte } = L.psZustaende(werte, 'jfn');
    expect(fertigSpalte).toBe(true);
    expect(zustaende.get('100|1')).toMatchObject({ altLShop: true, fertig: true, fertigAm: '2026-10-20T10:00:00.000Z', notiz: 'n', versendet: false });
    expect(zustaende.get('100|2')).toMatchObject({ altLShop: true, fertig: false });   // leere Shop-Zelle = JFN
    expect(L.psZustaende(werte, 'honk').zustaende.get('100|1')).toMatchObject({ dtfBestellt: true, versendet: true });
  });
  test('ohne Spalten Fertig/Fertig_Am: fertigSpalte false, alle nicht fertig', () => {
    const { zustaende, fertigSpalte } = L.psZustaende([PS_KOPF, ['100', '1', 'A', '', '1', '', '', '', '', '', 'JFN']], 'jfn');
    expect(fertigSpalte).toBe(false);
    expect(zustaende.get('100|1').fertig).toBe(false);
  });
});

describe('tageSeit (Kalendertage Europe/Berlin)', () => {
  test('ueber das Ende der Sommerzeit (25.10.2026)', () => {
    const jetzt = new Date('2026-10-26T08:00:00Z');
    expect(L.tageSeit('2026-10-24T22:30:00Z', jetzt)).toBe(1);   // 25.10. 00:30 Sommerzeit
    expect(L.tageSeit('2026-10-25T23:30:00Z', jetzt)).toBe(0);   // 26.10. 00:30 Winterzeit
    expect(L.tageSeit('2026-10-25T22:30:00Z', jetzt)).toBe(1);   // 25.10. 23:30 Winterzeit
  });
  test('Beginn der Sommerzeit (29.03.2026), leer/ungueltig -> null', () => {
    expect(L.tageSeit('2026-03-28T23:30:00Z', new Date('2026-03-29T21:30:00Z'))).toBe(0);   // 29.03. 00:30 MEZ -> 29.03. 23:30 MESZ
    expect(L.tageSeit('2026-03-28T23:30:00Z', new Date('2026-03-29T22:30:00Z'))).toBe(1);   // -> 30.03. 00:30 MESZ
    expect(L.tageSeit('', new Date())).toBeNull();
    expect(L.tageSeit('kaputt', new Date())).toBeNull();
  });
});

describe('zusammenfassung', () => {
  const art = (o = {}) => ({ name: 'Shirt', menge: 1, fertig: false, fertigAm: '', versendet: false, lshop: { kurz: '' }, ...o });
  const jetzt = new Date('2026-10-26T09:00:00Z');
  test('2/3 fertig · wartet auf: Socken (L-Shop: bestellt, versandt)', () => {
    const z = L.zusammenfassung([
      art({ fertig: true, fertigAm: '2026-10-22T10:00:00Z' }), art({ name: 'Trikot', fertig: true, fertigAm: '2026-10-20T10:00:00Z' }),
      art({ name: 'Socken', lshop: { kurz: 'L-Shop: bestellt, versandt' } }),
    ], '2026-10-01T00:00:00Z', jetzt);
    expect(z.text).toBe('2/3 fertig · wartet auf: Socken (L-Shop: bestellt, versandt)');
    expect(z).toMatchObject({ wartetAufTeile: true, wartetSeit: '2026-10-20T10:00:00.000Z', wartetTage: 6, fertig: 2, artikel: 3 });
  });
  test('Teilversand: versendet zaehlt als fertig', () => {
    const z = L.zusammenfassung([art({ versendet: true }), art({ name: 'Trikot' }), art({ name: 'Mütze' })], '2026-10-10T08:00:00Z', jetzt);
    expect(z.text).toBe('1/3 fertig · 1/3 versendet · wartet auf: Trikot, Mütze');
    // versendet ohne Fertig_Am: "wartet seit" = Bestelldatum
    expect(z).toMatchObject({ wartetAufTeile: true, wartetSeit: '2026-10-10T08:00:00Z', wartetTage: 16 });
  });
  test('alles versendet, nichts fertig, alles fertig', () => {
    expect(L.zusammenfassung([art({ versendet: true }), art({ versendet: true })], '', jetzt)).toMatchObject({ text: '2/2 versendet ✓', allesVersendet: true, wartetAufTeile: false });
    expect(L.zusammenfassung([art(), art()], '', jetzt)).toMatchObject({ text: '0/2 fertig', wartetAufTeile: false, wartetSeit: '', wartetTage: null });
    expect(L.zusammenfassung([art({ fertig: true }), art({ fertig: true })], '', jetzt)).toMatchObject({ text: '2/2 fertig', wartetAufTeile: false });
    expect(L.zusammenfassung([], '', jetzt).text).toBe('–');
  });
  test('lange Namen gekuerzt, Menge > 1 vorn', () => {
    const z = L.zusammenfassung([art({ fertig: true }), art({ name: 'Ein sehr langer Artikelname mit Motiv und Größe XL', menge: 2 })], '', jetzt);
    expect(z.text).toBe(`1/2 fertig · wartet auf: 2× ${'Ein sehr langer Artikelname mi'.slice(0, 29).trimEnd()}…`);
  });
});

describe('baueStand und wartetAufTeile', () => {
  const ps = new Map([
    ['100|1', { fertig: true, fertigAm: '2026-10-21T08:00:00Z', versendet: false, dtfBestellt: true, notiz: '', altLShop: false }],
    ['200|1', { fertig: true, fertigAm: '2026-10-19T08:00:00Z', versendet: false, dtfBestellt: false, notiz: '', altLShop: false }],
    ['300|1', { fertig: true, fertigAm: '2026-10-25T08:00:00Z', versendet: false, dtfBestellt: false, notiz: '', altLShop: false }],
    ['300|2', { fertig: true, fertigAm: '2026-10-25T09:00:00Z', versendet: false, dtfBestellt: false, notiz: '', altLShop: false }],
  ]);
  const bestellungen = [
    { id: '100', date_created: '2026-10-15T10:00:00', line_items: [{ id: '1', name: 'Hoodie' }, { id: '2', name: 'Socken' }] },
    { id: '200', date_created: '2026-10-10T10:00:00', line_items: [{ id: '1', name: 'Shirt' }, { id: '2', name: 'Trikot' }] },
    { id: '300', date_created: '2026-10-12T10:00:00', line_items: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] },
  ];
  const korb = new Map([['JFN:100:2', korbZeile({ Schluessel: 'JFN:100:2', Status: 'bestellt', Bestell_ID: 'JFN-2026-0003' })]]);
  const einstufen = jest.fn(() => KLASSE.TRIKOT);
  const stand = () => L.baueStand({
    shop: 'jfn', bestellungen, ps, korb, bestellungJe: new Map(), einstufen,
    korbSchluessel: (nr, pos) => K.korbSchluessel('jfn', nr, pos), jetzt: new Date('2026-10-26T09:00:00Z'),
  });
  test('Zuordnung ueber den Korb-Schluessel, Einstufung nur ohne Korbzeile', () => {
    einstufen.mockClear();
    const s = stand();
    expect(s[0].artikel[1].lshop).toMatchObject({ art: 'bestellt', bestellId: 'JFN-2026-0003' });
    expect(s[0].artikel[0]).toMatchObject({ imSheet: true, fertig: true, dtfBestellt: true });
    expect(s[0].artikel[1]).toMatchObject({ imSheet: false, fertig: false });
    expect(einstufen).toHaveBeenCalledTimes(5);   // 6 Positionen, 1 im Korb
    expect(s[0].zusammenfassung.text).toBe('1/2 fertig · wartet auf: Socken (L-Shop: bestellt)');
  });
  test('Filter: nur "etwas fertig + etwas fehlt", aeltester zuerst', () => {
    expect(L.wartetAufTeile(stand()).map(b => b.id)).toEqual(['200', '100']);   // 300 ist komplett fertig
  });
  test('HONK: kein Korb, keine Einstufung', () => {
    einstufen.mockClear();
    const s = L.baueStand({ shop: 'honk', bestellungen, ps: new Map(), korb, bestellungJe: new Map(), einstufen, korbSchluessel: () => 'x' });
    expect(einstufen).not.toHaveBeenCalled();
    expect(s[0].artikel[1].lshop.art).toBe('nur-jfn');
  });
});

// ═══ Leser ═══════════════════════════════════════════════════════════════════
describe('leseProduktionStand', () => {
  const sheetsFake = korbWerte => ({ spreadsheets: { values: { get: jest.fn(async ({ range }) => {
    if (range.includes('Produktions_Status')) return { data: { values: [[...PS_KOPF, 'Fertig', 'Fertig_Am'], ['100', '1', 'A', '', '1', '', '', '', '', '', 'JFN', 'TRUE', '2026-10-24T10:00:00Z']] } };
    if (range.includes(K.TAB_KORB)) return { data: { values: korbWerte } };
    throw new Error(`unerwartet ${range}`);
  }) } } });
  const korbKopf = KORB_SPALTEN;
  const korbReihe = o => korbKopf.map(n => o[n] ?? '');
  beforeEach(() => {
    leseLShopBestellungen.mockReset().mockResolvedValue({ bestellungen: [
      { orderId: 'JFN-2026-0003', status: 'versandt', positionen: [{ schluessel: 'JFN:100:1' }], lieferscheine: [{ pakete: [{ frachtfuehrer: 'GLS' }] }] },
    ] });
    ladeKontext.mockReset().mockResolvedValue(K.baueKontext({
      varMap: { 555: { ssotId: 'S1' } }, produktIdJeSsot: { S1: '902' },
      varianten: [['WC_Variation_ID', 'LShop_ArticleNr'], ['555', '1234567890']],
      lshop: [{ articleNr: '1234567890', status: 'aktiv' }], trikotIds: ['900'],
    }));
    ladeProdukte.mockReset().mockImplementation(async (_wc, ids) => new Map(ids.map(id => [id, { type: id === '901' ? 'simple' : 'variable', lieferzeit: '' }])));
  });

  test('alle Faelle, Produkttypen nur fuer Positionen ohne Korbzeile, ohne Kundennamen', async () => {
    const sheets = sheetsFake([korbKopf, korbReihe({ Schluessel: 'JFN:100:1', Shop: 'JFN', Status: 'bestellt', Bestell_ID: 'JFN-2026-0003' })]);
    const d = await lib.leseProduktionStand({ shop: 'jfn', sheets, jetzt: () => new Date('2026-10-26T09:00:00Z'), bestellungen: [
      { id: 100, date_created: '2026-10-20T10:00:00', billing: { first_name: 'Geheim' }, line_items: [
        { id: 1, name: 'Hoodie', product_id: 902, variation_id: 555 },
        { id: 2, name: 'Trikot', product_id: 900, variation_id: 0 },
        { id: 3, name: 'Schal', product_id: 901, variation_id: 0 },
        { id: 4, name: 'Shirt', product_id: 902, variation_id: 555 },
      ] },
    ] });
    expect(ladeProdukte.mock.calls[0][1].sort()).toEqual(['900', '901', '902']);
    const [b] = d.bestellungen;
    expect(b.artikel.map(a => a.lshop.text)).toEqual([
      'bestellt JFN-2026-0003 · versandt · GLS · Paket 1', 'kein L-Shop-Artikel', 'kein L-Shop-Artikel', 'nicht im Korb']);
    expect(b.artikel.map(a => a.lshop.grund ?? '')).toEqual(['', 'Trikot', 'Artikel ohne Variation', '']);
    expect(b.zusammenfassung.text).toBe('1/4 fertig · wartet auf: Trikot, Schal, Shirt (L-Shop: nicht im Korb)');
    expect(d).toMatchObject({ fertigSpalte: true, wartetAufTeile: ['100'] });
    expect(JSON.stringify(d)).not.toContain('Geheim');
  });

  test('alles im Korb: kein Kontext, kein Shop-Abruf', async () => {
    const sheets = sheetsFake([korbKopf, korbReihe({ Schluessel: 'JFN:100:1', Shop: 'JFN', Status: 'offen' })]);
    const d = await lib.leseProduktionStand({ shop: 'jfn', sheets, bestellungen: [{ id: 100, line_items: [{ id: 1, name: 'Hoodie' }] }] });
    expect(ladeKontext).not.toHaveBeenCalled();
    expect(ladeProdukte).not.toHaveBeenCalled();
    expect(d.bestellungen[0].artikel[0].lshop.text).toBe('im Korb offen');
  });

  test('HONK: liest nur Produktions_Status', async () => {
    const sheets = sheetsFake([korbKopf]);
    const d = await lib.leseProduktionStand({ shop: 'honk', sheets, bestellungen: [{ id: 100, line_items: [{ id: 1, name: 'A' }] }] });
    expect(sheets.spreadsheets.values.get).toHaveBeenCalledTimes(1);
    expect(leseLShopBestellungen).not.toHaveBeenCalled();
    expect(d.bestellungen[0].artikel[0].lshop.art).toBe('nur-jfn');
  });

  test.each([[undefined, 'Liste'], [[{ id: 'x' }], 'Ungültige ID'], [Array(301).fill({ id: 1 }), 'Höchstens']])(
    'Eingabe pruefen (%#) -> 400', async (bestellungen, text) => {
      await expect(lib.leseProduktionStand({ shop: 'jfn', sheets: sheetsFake([korbKopf]), bestellungen }))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining(text) });
    });

  test('Route POST /api/bestellen/produktion/stand ruft den Leser mit Shop und Body', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../routes/bestellen.js'), 'utf8');
    expect(src).toMatch(/router\.post\('\/produktion\/stand'[\s\S]*?leseProduktionStand\(\{ shop: req\.query\.shop, bestellungen: req\.body\?\.bestellungen \}\)/);
  });
});

// ═══ Schreibweg ══════════════════════════════════════════════════════════════
describe('PUT /api/sheets/produktions-status', () => {
  const zeile = (item, shop) => ['100', item, 'A', '', '1', 'FALSE', 'FALSE', 'FALSE', 'FALSE', '', shop];
  beforeEach(() => {
    geschrieben.length = 0;
    tabs = { Produktions_Status: [[...PS_KOPF, 'Fertig', 'Fertig_Am'], zeile('1', 'JFN'), zeile('2', 'JFN'), zeile('1', 'HONK')] };
  });

  test('Fertig schreibt nur Fertig + Fertig_Am der einen Zeile, RAW, zurueckgelesen', async () => {
    const r = await request(app).put('/api/sheets/produktions-status?shop=jfn').send({ orderId: '100', wcItemId: '2', field: 'fertig', value: true });
    expect(r.status).toBe(200);
    expect(geschrieben).toEqual(['Produktions_Status!L3', 'Produktions_Status!M3']);
    expect(values.batchUpdate.mock.calls.at(-1)[0].requestBody.valueInputOption).toBe('RAW');
    expect(tabs.Produktions_Status[2][11]).toBe(true);
    expect(tabs.Produktions_Status[2][12]).toBe(r.body.fertigAm);
    expect(r.body.fertigAm).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(tabs.Produktions_Status[1].slice(11)).toEqual([]);   // Nachbarzeile unberuehrt
    expect(tabs.Produktions_Status[3].slice(11)).toEqual([]);   // HONK unberuehrt
  });

  test('Abhaken leert Fertig_Am', async () => {
    await request(app).put('/api/sheets/produktions-status?shop=honk').send({ orderId: '100', wcItemId: '1', field: 'fertig', value: true });
    const r = await request(app).put('/api/sheets/produktions-status?shop=honk').send({ orderId: '100', wcItemId: '1', field: 'fertig', value: false });
    expect(r.status).toBe(200);
    expect(tabs.Produktions_Status[3].slice(11)).toEqual([false, '']);
  });

  test('Rücklesen weicht ab -> 500', async () => {
    const orig = values.batchUpdate.getMockImplementation();
    values.batchUpdate.mockImplementationOnce(async () => ({}));   // nichts kommt an
    const r = await request(app).put('/api/sheets/produktions-status?shop=jfn').send({ orderId: '100', wcItemId: '1', field: 'fertig', value: true });
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('Zurücklesen');
    values.batchUpdate.mockImplementation(orig);
  });

  test('ohne Spalten Fertig/Fertig_Am -> 409, nichts geschrieben', async () => {
    tabs.Produktions_Status[0] = PS_KOPF;
    const r = await request(app).put('/api/sheets/produktions-status?shop=jfn').send({ orderId: '100', wcItemId: '1', field: 'fertig', value: true });
    expect(r.status).toBe(409);
    expect(geschrieben).toEqual([]);
  });

  test('value muss true/false sein; unbekannte Zeile 404', async () => {
    expect((await request(app).put('/api/sheets/produktions-status').send({ orderId: '100', wcItemId: '1', field: 'fertig', value: 'ja' })).status).toBe(400);
    expect((await request(app).put('/api/sheets/produktions-status').send({ orderId: '999', wcItemId: '1', field: 'fertig', value: true })).status).toBe(404);
    expect(geschrieben).toEqual([]);
  });

  test('altes Haekchen "L-Shop bestellt" ist nicht mehr schreibbar', async () => {
    const r = await request(app).put('/api/sheets/produktions-status').send({ orderId: '100', wcItemId: '1', field: 'lshopBestellt', value: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Warenkorb');
    expect(geschrieben).toEqual([]);
    expect(tabs.Produktions_Status[1][5]).toBe('FALSE');
  });

  test('Versendet bleibt manuell je Artikel', async () => {
    const r = await request(app).put('/api/sheets/produktions-status?shop=jfn').send({ orderId: '100', wcItemId: '1', field: 'versendet', value: true });
    expect(r.status).toBe(200);
    expect(geschrieben).toEqual(['Produktions_Status!I2']);
  });
});

// ═══ Oberflaeche ═════════════════════════════════════════════════════════════
describe('Block "Produktion-Stand" in index.html', () => {
  test('Block gefunden', () => { expect(front.von).toBeGreaterThan(0); expect(front.bis).toBeGreaterThan(front.von); });

  test('Haekchen: Fertig · DTF · Versendet - kein "L-Shop bestellt", kein "Gedruckt"', () => {
    expect(front.PS_FELDER).toEqual(['fertig', 'dtfBestellt', 'versendet']);
    for (const k of front.PS_FELDER) expect(front.psArtikelHtml(1, { wcItemId: '1', imSheet: true }, {})).toContain(`data-field="${k}"`);
    expect(front.html).not.toMatch(/data-field="lshopBestellt"|key: 'lshopBestellt'/);
    expect(front.html).not.toMatch(/key: 'gedruckt'/);
  });

  test('L-Shop-Stand: Link mit Ziel und Bestellung, ohne Ziel kein Link, maskiert', () => {
    const link = front.psLshopHtml({ art: 'bestellt', text: 'bestellt JFN-2026-0003', ziel: 'lshop-bestellungen', bestellId: 'JFN-2026-0003' });
    expect(link).toContain('data-ps-ziel="lshop-bestellungen"');
    expect(link).toContain('data-ps-bestellung="JFN-2026-0003"');
    expect(link).toContain('data-hilfe="prod-lshop"');
    const kein = front.psLshopHtml({ art: 'kein', text: 'kein L-Shop-Artikel', grund: 'Trikot', ziel: '', alt: true });
    expect(kein).not.toContain('<a ');
    expect(kein).toContain('(Trikot)');
    expect(kein).toContain('von Hand markiert (alt)');
    expect(front.psLshopHtml({ art: 'raus', text: 'herausgenommen: <x>', ziel: 'lshop-korb' })).toContain('herausgenommen: &#60;x&#62;');
  });

  test('Artikel: Haekchen gesperrt ohne Sheet-Zeile; Fertig gesperrt ohne Spalte', () => {
    const a = { wcItemId: '7', name: 'Hoodie', menge: 1, imSheet: true, fertig: true, dtfBestellt: false, versendet: false, notiz: '', lshop: null };
    const li = { sku: 'JH001/X', meta_data: [{ key: 'pa_groesse', display_key: 'Größe', display_value: 'L' }, { key: '_intern', display_key: 'x', display_value: 'y' }] };
    const h = front.psArtikelHtml(100, a, li);
    expect(h).toMatch(/data-field="fertig" checked>/);
    expect(h).toContain('Größe: L');
    expect(h).not.toContain('x: y');
    expect(front.psArtikelHtml(100, { ...a, imSheet: false }, li).match(/disabled/g)).toHaveLength(4);   // 3 Haekchen + Notiz
    const ohne = front.psArtikelHtml(100, a, li, { fertigSpalte: false });
    expect(ohne).toMatch(/data-field="fertig" checked disabled>/);
    expect(ohne).toContain('noch nicht eingerichtet');
  });

  test('Kopf: Zusammenfassung und "wartet seit" nur bei wartet auf Teile', () => {
    expect(front.psKopfHtml({ text: '2/3 fertig · wartet auf: Socken', wartetAufTeile: true, wartetTage: 4 }).rechts).toContain('wartet seit 4 Tagen');
    expect(front.psKopfHtml({ text: '1/2 fertig', wartetAufTeile: true, wartetTage: 1 }).rechts).toContain('seit 1 Tag<');
    expect(front.psKopfHtml({ text: 'x', wartetAufTeile: true, wartetTage: 0 }).rechts).toContain('seit heute');
    expect(front.psKopfHtml({ text: '0/2 fertig', wartetAufTeile: false }).rechts).toBe('');
    expect(front.psKopfHtml({ text: '2/2 versendet ✓', allesVersendet: true }).zeile).toContain('ps-fertig');
  });

  test('Filter: Reihenfolge aus dem Backend, Zaehler; Browser-Reihenfolge = Backend-Regel', () => {
    const orders = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const daten = { wartetAufTeile: ['3', '1'] };
    expect(front.psSicht(orders, daten, 'alle').map(o => o.id)).toEqual([1, 2, 3]);
    expect(front.psSicht(orders, daten, 'wartet').map(o => o.id)).toEqual([3, 1]);
    expect(front.psZaehler(orders, daten)).toEqual({ alle: 3, wartet: 2 });
    expect(front.psSicht(orders, null, 'wartet')).toEqual([]);
    const stand = [
      { id: '10', zusammenfassung: { wartetAufTeile: true, wartetSeit: '2026-10-20T00:00:00Z' } },
      { id: '9', zusammenfassung: { wartetAufTeile: true, wartetSeit: '2026-10-18T00:00:00Z' } },
      { id: '8', zusammenfassung: { wartetAufTeile: false, wartetSeit: '' } },
      { id: '11', zusammenfassung: { wartetAufTeile: true, wartetSeit: '2026-10-18T00:00:00Z' } },
    ];
    expect(front.psWartetReihenfolge(stand)).toEqual(L.wartetAufTeile(stand).map(b => b.id));
    expect(front.psWartetReihenfolge(stand)).toEqual(['9', '11', '10']);
  });

  test('Liste laedt seitenweise mit Laufstopp, Stand in einem Abruf, Filter gespeichert', () => {
    const h = front.html;
    expect(h).toContain('/api/bestellen/produktion/stand');
    expect(h).toMatch(/per_page=100&page=\$\{page\}/);
    expect(h).toMatch(/const stopp = await laufStopp\(res\);\s*if \(stopp\) throw/);
    expect(h).toContain("const PS_FILTER_KEY = 'mc_bestellungen_filter'");
    expect(h).toContain("lbSpringeZu(link.dataset.psBestellung)");
    expect(h).not.toMatch(/api\/woocommerce\/orders\/\$\{orderId\}`\)\.then/);   // kein Einzelabruf je Karte mehr
  });
});
