// RS1: L-Shop-Rueckstandsliste lesen, zuordnen, anzeigen. Nur ERFUNDENE Daten (auch Empfaenger/Adresse in P-T erfunden).

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { machSheets } from './hilfen/korb-sheet.js';
import { KORB_SPALTEN } from '../utils/korb-logic.js';
import {
  leseXlsxZeilen, rueckstandPositionen, parseLiefertermin, statusText, stufe, zuordnen, rueckstandAntwort, neuesteListe, alterTage, articleNr, datumAus,
} from '../utils/rueckstand.js';
import { leseRueckstand, _rueckstandCacheLeeren } from '../lib/rueckstand.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const KOPF = ['Kunden-Nr.', 'Unser Auftrag', 'INET-Nr.', 'Fremdbeleg-Nr. / Referenz', 'Kommission', 'Bestell-Datum', 'LieferantArtNr', 'Katalognummer',
  'Bezeichnung', 'Farbe', 'Größe', 'Bestellte Menge', 'Geliefert', 'Menge im Rückstand', 'Liefertermin', 'Lieferempfänger', 'Straße', 'PLZ', 'Ort', 'Land'];
const ADRESSE = ['Erika Beispiel', 'Musterweg 1', '99887', 'Musterstadt', 'DE'];   // erfunden - darf nirgends auftauchen
const ZEILEN = [
  KOPF,
  ['1234567', '011-VA0000001', '', 'JFN-2026-0003', 'JFN Sammelbestellung KW45', '03.11.2026', '9000000120.0', 'X3000', 'Muster-Shirt', 'Black', 'M', '3.0', '1.0', '2.0', '2 Stk ca. KW 46/2026', ...ADRESSE],
  [],
  ['1234567', '011-VA0000001', '', 'JFN-2026-0003', 'JFN Sammelbestellung KW45', '03.11.2026', '9000000150', 'X3000', 'Muster-Shirt', 'Black', '3XL', '2.0', '0.0', '2.0', '1 Stk sofort 1 Stk in Klärung', ...ADRESSE],
  [],
  ['1234567', '011-VA0000002', '4711', '- / -', '-', '', '9000000999', 'Y100', 'Muster-Hoodie', 'Navy', 'L', '1.0', '0.0', '1.0', '1 Stk unbekannt', ...ADRESSE],
  [],
  ['Gesamt: 3 Positionen'],
  ['Mit freundlichen Grüßen – erfundener Fußtext'],
];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const spalte = i => String.fromCharCode(65 + i);
/** xlsx wie die echte Datei: Blatt "Sheet1.xml" (gross), keine Stile, alle Texte als sharedStrings, Leerzeilen ohne Zellen. */
async function machXlsx(zeilen = ZEILEN) {
  const shared = [], idx = new Map();
  const si = v => { if (!idx.has(v)) { idx.set(v, shared.length); shared.push(v); } return idx.get(v); };
  const rows = zeilen.map((r, n) => `<row r="${n + 1}">${r.map((v, i) => (v === '' ? '' : `<c r="${spalte(i)}${n + 1}" s="1" t="s"><v>${si(v)}</v></c>`)).join('')}</row>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships/>');
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns:r="x"><sheets><sheet name="Rueckstand" sheetId="1" r:id="rId3"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="x/sharedStrings" Target="sharedStrings.xml" /><Relationship Id="rId3" Type="x/worksheet" Target="worksheets/Sheet1.xml" /></Relationships>');
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${shared.map(v => `<si><t>${esc(v)}</t></si>`).join('')}</sst>`);
  zip.file('xl/styles.xml', '<?xml version="1.0"?><styleSheet/>');
  zip.file('xl/worksheets/Sheet1.xml', `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const KORB_HEAD = [...KORB_SPALTEN];
const korbZeile = o => KORB_HEAD.map(s => o[s] ?? '');
const KORB = [KORB_HEAD,
  korbZeile({ Schluessel: 'JFN:50001:1', Shop: 'JFN', Herkunft: 'shop', Bestellnummer: '50001', Position: '1', 'LShop_ArticleNr': '9000000120', Menge: '1', Status: 'bestellt', Bestell_ID: 'JFN-2026-0003' }),
  korbZeile({ Schluessel: 'EIGEN:2026-0007', Shop: 'JFN', Herkunft: 'eigen', Referenz: 'AU-2026-0003', 'LShop_ArticleNr': '9000000120', Menge: '1', Status: 'bestellt', Bestell_ID: 'JFN-2026-0003' }),
  korbZeile({ Schluessel: 'EIGEN:2026-0008', Shop: 'JFN', Herkunft: 'eigen', Referenz: 'AU-2026-0003', 'LShop_ArticleNr': '9000000150', Menge: '2', Status: 'bestellt', Bestell_ID: 'JFN-2026-0003' }),
];

describe('Lesen (Datei ohne Standard-Stil)', () => {
  test('Sheet1.xml gross, sharedStrings, Leer- und Fusszeilen; nur Spalten A-O', async () => {
    const z = await leseXlsxZeilen(await machXlsx(), JSZip);
    expect(z).toHaveLength(9);
    expect(z[0]).toHaveLength(15);
    expect(z.flat().join('|')).not.toMatch(/Erika|Musterweg|Musterstadt|99887/);   // P-T nie gelesen
    const p = rueckstandPositionen(z);
    expect(p.map(x => [x.articleNr, x.rueckstand, x.status, x.stufe])).toEqual([
      ['9000000120', 2, 'ca. KW 46', 'kw'], ['9000000150', 2, '1× sofort · 1× in Klärung', 'klaerung'], ['9000000999', 1, 'unbekannt', 'unbekannt']]);
    expect(p[2]).toMatchObject({ fremdbeleg: '', kommission: '', bestelldatum: '' });   // "- / -", "-", leeres Datum
    expect(p[0]).toMatchObject({ fremdbeleg: 'JFN-2026-0003', bestelldatum: '2026-11-03', katalogNr: 'X3000', farbe: 'Black', groesse: 'M', bestellt: 3, geliefert: 1 });
  });
  test('falsche Kopfzeile -> Fehler, keine Datei -> Fehler', async () => {
    await expect(leseXlsxZeilen(Buffer.from('kein zip'), JSZip)).rejects.toThrow();
    expect(() => rueckstandPositionen([['A', 'B']])).toThrow(/Kopfzeile/);
  });
  test('Liefertermin: alle Formen, mehrere Teilmengen, ohne "Stk"', () => {
    expect(parseLiefertermin('1 Stk sofort')).toEqual([{ menge: 1, status: 'sofort', kw: null, jahr: null, text: 'sofort' }]);
    expect(parseLiefertermin('3 Stk ca. KW 46/2026')[0]).toMatchObject({ menge: 3, status: 'kw', kw: 46, jahr: 2026 });
    expect(parseLiefertermin('2 Stk in Klärung')[0].status).toBe('in Klärung');
    expect(parseLiefertermin('1 Stk unbekannt')[0].status).toBe('unbekannt');
    expect(parseLiefertermin('1 Stk sofort\n2 Stk ca. KW 47/2026').map(x => x.status)).toEqual(['sofort', 'kw']);
    expect(parseLiefertermin('1 Stk sofort, 1 Stk in Klaerung').map(x => x.status)).toEqual(['sofort', 'in Klärung']);
    expect(parseLiefertermin('ca. KW 2/2027')[0]).toMatchObject({ menge: null, status: 'kw', kw: 2 });
    expect(parseLiefertermin('')).toEqual([]);
    expect(statusText(parseLiefertermin('2 Stk ca. KW 46/2026'))).toBe('ca. KW 46');
    expect(stufe(parseLiefertermin('1 Stk sofort 1 Stk unbekannt'))).toBe('unbekannt');
  });
  test('Hilfen: ArticleNr, Datum, neueste Datei, Alter', () => {
    expect([articleNr('9000000120.0'), articleNr('9.00000012E9'), articleNr('123')]).toEqual(['9000000120', '9000000120', '']);
    expect([datumAus('3.11.2026'), datumAus('46330'), datumAus('')]).toEqual(['2026-11-03', '2026-11-04', '']);
    expect(neuesteListe([{ name: 'Rueckstandsliste_2026-10-28.xlsx' }, { name: 'Rueckstandsliste_2026-11-04.xlsx' }, { name: 'anderes.xlsx' }]).name).toBe('Rueckstandsliste_2026-11-04.xlsx');
    expect(alterTage('2026-11-04', '2026-11-13')).toBe(9);
  });
});

describe('Zuordnung', () => {
  const positionen = async () => rueckstandPositionen(await leseXlsxZeilen(await machXlsx(), JSZip));
  test('Fremdbeleg + ArticleNr -> alle Korb-Positionen; daraus Auftrag und Shop-Bestellung; ohne Referenz = ohne Bezug', async () => {
    const korb = (await import('../utils/korb-logic.js')).korbZeilen(KORB).zeilen.map(z => ({ ...z, referenz: z.Herkunft === 'eigen' ? z.Referenz : `JFN-${z.Bestellnummer}-${z.Position}` }));
    const z = zuordnen(await positionen(), { korb, edi: new Set(['JFN-2026-0003']) });
    expect(z.map(p => p.zuordnung)).toEqual(['bestellung', 'bestellung', 'ohne']);
    expect(z[0]).toMatchObject({ korbSchluessel: ['JFN:50001:1', 'EIGEN:2026-0007'], auftraege: ['AU-2026-0003'], shops: [{ shop: 'JFN', bestellnummer: '50001' }], orderId: 'JFN-2026-0003' });
    const a = rueckstandAntwort(z);
    expect(a.je.auftrag['AU-2026-0003']).toMatchObject({ stufe: 'klaerung', stueck: 4, positionen: 2 });
    expect(a.je.shop['JFN:50001']).toMatchObject({ stufe: 'kw', status: 'ca. KW 46' });
    expect(a.je.korb['EIGEN:2026-0008']).toMatchObject({ stufe: 'klaerung' });
    expect(a.zahlen).toEqual({ positionen: 3, stueck: 5, kritisch: 2, ohneBezug: 1 });
    expect(JSON.stringify(a.positionen)).not.toMatch(/kommission|Sammelbestellung|kundenNr|1234567/);
  });
  test('nur unsere order_id, aber nicht im Korb -> Bezug L-Shop-Bestellung', async () => {
    const z = zuordnen(await positionen(), { korb: [], edi: new Set(['JFN-2026-0003']) });
    expect(z.map(p => p.zuordnung)).toEqual(['lshop', 'lshop', 'ohne']);
  });
});

describe('Lesen aus Drive (Attrappe) + Alter', () => {
  const drive = (dateien, buffer) => ({ files: {
    list: async () => ({ data: { files: dateien } }),
    get: async () => ({ data: buffer }),
  } });
  test('neueste Datei, Zuordnung, Zahlen; Empfaenger nirgends in der Antwort', async () => {
    _rueckstandCacheLeeren();
    const buf = await machXlsx();
    const { sheets } = machSheets({ Warenkorb_LShop: KORB, LShop_EDI_Dateien: [['order_id', 'Status'], ['JFN-2026-0003', 'gesendet']] });
    const r = await leseRueckstand({ drive: drive([{ id: 'a', name: 'Rueckstandsliste_2026-10-28.xlsx', modifiedTime: 'x', size: '100' }, { id: 'b', name: 'Rueckstandsliste_2026-11-04.xlsx', modifiedTime: 'y', size: '100' }], buf),
      sheets, spreadsheetId: 'ssot', jetzt: new Date('2026-11-06T10:00:00Z') });
    expect(r.liste).toEqual({ name: 'Rueckstandsliste_2026-11-04.xlsx', datum: '2026-11-04', alterTage: 2, veraltet: false });
    expect(r.zahlen.positionen).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/Erika|Musterweg|Musterstadt|99887|Sammelbestellung/);
  });
  test('aelter als 8 Tage -> veraltet + Hinweis; leerer Ordner -> Hinweis ohne Fehler', async () => {
    _rueckstandCacheLeeren();
    const { sheets } = machSheets({ Warenkorb_LShop: KORB, LShop_EDI_Dateien: [['order_id']] });
    const r = await leseRueckstand({ drive: drive([{ id: 'b', name: 'Rueckstandsliste_2026-11-04.xlsx', modifiedTime: 'y', size: '100' }], await machXlsx()),
      sheets, spreadsheetId: 'ssot', jetzt: new Date('2026-11-13T10:00:00Z') });
    expect(r.liste.veraltet).toBe(true);
    expect(r.hinweis).toBe('Rückstandsliste veraltet (letzte vom 04.11.2026) – Script oder Mail ausgefallen?');
    _rueckstandCacheLeeren();
    const leer = await leseRueckstand({ drive: drive([], null), sheets, spreadsheetId: 'ssot' });
    expect(leer).toMatchObject({ liste: null, positionen: [] });
    expect(leer.hinweis).toMatch(/Noch keine Rückstandsliste/);
  });
});

describe('Oberflaeche', () => {
  const block = html.slice(html.indexOf('// ── Rueckstand: Anfang'), html.indexOf('// ── Rueckstand: Ende'));
  const F = new Function(`${block}\nreturn { rsKennzeichenHtml, rsBlockHtml, rsGruppe };`)();
  test('Kennzeichen: Text, Farbe je Stufe, Mouse-over, kein title', () => {
    expect(F.rsKennzeichenHtml({ stufe: 'kw', status: 'ca. KW 46', stueck: 2 }))
      .toBe(' <span class="rs-chip rs-kw" tabindex="0" data-hilfe="rs-kennzeichen" data-hilfe-zusatz="2 Stück im Rückstand">Rückstand: ca. KW 46</span>');
    expect(F.rsKennzeichenHtml({ stufe: 'klaerung', status: 'in Klärung', stueck: 1 })).toContain('rs-klaerung');
    expect(F.rsKennzeichenHtml(undefined)).toBe('');
    expect(block).not.toMatch(/\stitle=/);
  });
  test('Abschnitt: Stand der Liste, Gruppen, offen bei kritisch/veraltet, ohne Liste Hinweis', () => {
    const d = { liste: { datum: '2026-11-04', veraltet: false }, hinweis: '', zahlen: { positionen: 2, stueck: 3, kritisch: 1 },
      positionen: [{ katalogNr: 'X3000', farbe: 'Black', groesse: 'M', rueckstand: 2, bestellt: 3, stufe: 'kw', status: 'ca. KW 46', auftraege: ['AU-2026-0003'], shops: [], orderId: 'JFN-2026-0003' },
        { katalogNr: 'Y100', farbe: 'Navy', groesse: 'L', rueckstand: 1, stufe: 'unbekannt', status: 'unbekannt', auftraege: [], shops: [], orderId: '', auftrag: '011-VA0000002' }] };
    const h = F.rsBlockHtml(d);
    expect(h).toMatch(/^<details class="rs-block" open>/);
    expect(h).toMatch(/Liste vom Mi\.?, 04\.11\./);
    expect(h).toContain('<h4>Aufträge (1)</h4>');
    expect(h).toContain('<h4>ohne Bezug in MC (1)</h4>');
    expect(h).toContain('data-rs-au="AU-2026-0003" data-hilfe="rs-bezug">AU-2026-0003</button>');
    expect(F.rsBlockHtml({ ...d, zahlen: { positionen: 2, stueck: 3, kritisch: 0 } })).toMatch(/^<details class="rs-block">/);
    expect(F.rsBlockHtml({ ...d, liste: { ...d.liste, veraltet: true }, hinweis: 'Rückstandsliste veraltet (letzte vom 04.11.2026) – x' })).toContain('class="rs-veraltet"');
    expect(F.rsBlockHtml({ liste: null, hinweis: 'Noch keine Rückstandsliste im Ordner.' })).toContain('Noch keine Rückstandsliste');
  });
  test('Einbindung: Position in L-Shop-Bestellungen, Shop-Karte, Auftrag; Laden still', () => {
    expect(html).toContain('const rueck = globalThis.rsKorbKennzeichen?.(p.schluessel) ?? \'\';');
    expect(html).toContain('${globalThis.rsShopKennzeichen?.(currentShop(), o.id) ?? \'\'}');
    expect(html).toContain('globalThis.rsAuftragKennzeichen?.(a.Auftrag_Nr)');
    expect(html).toContain('<div id="rs-bereich"></div>');
  });
});
