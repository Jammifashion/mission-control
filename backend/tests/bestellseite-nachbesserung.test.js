// Nachbesserung KS6 (Inhaber 08.11.): (1) Lieferbarkeit fuer ALLE angebotenen Groessen der Bestellseiten (vorher nur "unsere" Nummern ->
// nur eine Groesse gruen), (2) Zwischenstand des Korbs auf dem Geraet. Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, bearbeiteZugang, bestellseitenNummern, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { genutzteNummern } from '../utils/lshop-lieferbarkeit.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN } from '../utils/bestellseite.js';
import { AUFTRAG_SPALTEN, POSITION_SPALTEN } from '../utils/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
const JETZT = () => new Date('2026-11-08T10:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00001', Status: 'aktiv' }] });
let zz = 900; const zufall = () => Buffer.alloc(32, ++zz);
const zeile = (sp, o) => sp.map(x => o[x] ?? '');
const LS = (nr, cat, farbe, size, disc = '0') => [nr, cat, farbe, '', size, '', '', 'Erfunden', '', disc, 'aktiv', 'Muster'];

function tabs() {
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]], Bestell_Termine: [TERMIN_SPALTEN],
    Auftraege: [AUFTRAG_SPALTEN, zeile(AUFTRAG_SPALTEN, { Auftrag_Nr: 'AU-2026-0201', Kunden_Nr: 'K-00001', Kurztitel: 'T', Status: 'Angebot', Termin: '2026-12-04', Stand: 's' })],
    Auftrag_Positionen: [POSITION_SPALTEN, zeile(POSITION_SPALTEN, { Position_ID: 'AU-2026-0201-01', Auftrag_Nr: 'AU-2026-0201', Art: 'lshop', LShop_ArticleNr: '3000000021', Menge: '1' })],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description'],
      LS('3000000001', 'X100', 'Black', 'S'), LS('3000000002', 'X100', 'Black', 'M'), LS('3000000003', 'X100', 'Black', 'L'), LS('3000000004', 'X100', 'White', 'M'),
      LS('3000000005', 'X100', 'Black', 'XL', '3'), LS('3000000021', 'H200', 'Navy', 'M'), LS('3000000022', 'H200', 'Navy', 'L'), LS('3000000023', 'H200', 'Red', 'L')],
  };
}

beforeEach(() => { _bestellseiteCacheLeeren(); _resetLShopCache?.(); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('Lieferbarkeit fuer alle Groessen der Bestellseiten', () => {
  test('genutzte Nummern nehmen die Bestellseiten-Groessen dazu (nur gueltige)', () => {
    const { nummern } = genutzteNummern({ varianten: [], korb: [{ LShop_ArticleNr: '3000000002', Status: 'offen' }], buchungen: [], bestellseiten: new Set(['3000000001', 'kaputt']) });
    expect([...nummern].sort()).toEqual(['3000000001', '3000000002']);
  });
  test('ohne Auswahl: alle Groessen von Modell + Farbe der Positionen; mit Auswahl: alle Groessen der gewaehlten Farben, ohne gesperrte; gesperrt = nichts', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    expect([...await bestellseitenNummern({ sheets, spreadsheetId: 'test-sheet', jetzt: JETZT() })]).toEqual([]);   // noch keine Seite
    await legeZugangAn({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0201', vorgang: 'vorgang-nb-0001' }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null });
    expect([...await bestellseitenNummern({ sheets, spreadsheetId: 'test-sheet', jetzt: JETZT() })].sort()).toEqual(['3000000021', '3000000022']);   // Navy M + L, nicht Red
    const stand = () => t.Bestellseiten[1][t.Bestellseiten[0].indexOf('Stand')];
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: stand(), auswahl: [{ modell: 'X100', farben: ['Black'], name: 'Shirt' }] }, sheets, jetzt: JETZT });
    _bestellseiteCacheLeeren();
    expect([...await bestellseitenNummern({ sheets, spreadsheetId: 'test-sheet', jetzt: JETZT() })].sort()).toEqual(['3000000001', '3000000002', '3000000003']);   // ohne XL (3), ohne White
    await bearbeiteZugang({ eingabe: { zugangId: 'BS-001', stand: stand(), aktiv: false }, sheets, jetzt: JETZT });
    expect([...await bestellseitenNummern({ sheets, spreadsheetId: 'test-sheet', jetzt: JETZT() })]).toEqual([]);
  });
  test('ohne Reiter der Bestellseite: leere Menge statt Fehler', async () => {
    const t = tabs(); delete t.Bestellseiten; delete t.Bestell_Termine;
    expect([...await bestellseitenNummern({ sheets: machSheets(t).sheets, spreadsheetId: 'test-sheet' })]).toEqual([]);
  });
});

describe('Zwischenstand auf dem Geraet', () => {
  const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
  const ab = (txt, von, bis) => txt.slice(txt.indexOf(von), txt.indexOf(bis));
  const block = ab(seite, '// ── Bestellseite-Anzeige: Anfang', '// ── Bestellseite-Anzeige: Ende ──');
  const F = new Function(`${block}\nreturn { bsEntwurfLesen, bsEntwurfDaten, bsEntwurfSchluessel, bsKorbHtml };`)();
  const termine = [{ id: 'BT-0001', vergangen: false }, { id: 'BT-0002', vergangen: true }];
  const JETZT_MS = Date.parse('2026-11-08T10:00:00Z');
  const korb = [{ art: 'artikel', id: '3000000001', menge: 2, text: 'Shirt · Black · S', name: 'ERFUNDEN', boese: '<x>' }];

  test('wiederherstellen: Form, 30 Tage, Termin noch offen; nur bekannte Felder, Zahlen bleiben Zahlen', () => {
    const roh = F.bsEntwurfDaten('BT-0001', korb, 'vorgang-zw-0001', JETZT_MS);
    const x = F.bsEntwurfLesen(roh, { termine, jetzt: JETZT_MS + 86400000 });
    expect(x).toEqual({ termin: 'BT-0001', korb: [{ art: 'artikel', id: '3000000001', menge: 2, text: 'Shirt · Black · S', name: 'ERFUNDEN' }], vorgang: 'vorgang-zw-0001', zeit: JETZT_MS });
    expect(F.bsEntwurfLesen(roh, { termine, jetzt: JETZT_MS + 31 * 86400000 })).toBeNull();   // zu alt
    expect(F.bsEntwurfLesen(F.bsEntwurfDaten('BT-0002', korb, 'v', JETZT_MS), { termine, jetzt: JETZT_MS })).toBeNull();   // Termin vorbei
    expect(F.bsEntwurfLesen(F.bsEntwurfDaten('BT-0009', korb, 'v', JETZT_MS), { termine, jetzt: JETZT_MS })).toBeNull();   // Termin weg
    expect(F.bsEntwurfLesen('kaputt', { termine })).toBeNull();
    expect(F.bsEntwurfLesen(F.bsEntwurfDaten('BT-0001', [{ art: 'boese' }], 'v', JETZT_MS), { termine, jetzt: JETZT_MS })).toBeNull();
  });
  test('Schluessel aus einem Pruefwert, nie der Token; Korb sagt "zwischengespeichert"; Speichern erst nach dem Wiederherstellen, geloescht wenn leer', () => {
    expect(F.bsEntwurfSchluessel('ab'.repeat(32))).toBe(`bs_zwischen_${'ab'.repeat(8)}`);
    expect(F.bsEntwurfSchluessel('')).toBe('');
    expect(seite).toMatch(/crypto\.subtle\.digest\('SHA-256', new TextEncoder\(\)\.encode\(BS_TOKEN\)\)/);
    expect(seite).not.toMatch(/setItem\([^)]*BS_TOKEN/);
    expect(F.bsKorbHtml(korb, 'Testi', true)).toContain('automatisch auf diesem Gerät zwischengespeichert');
    expect(seite).toMatch(/function zwMerken\(\) \{\s*if \(!zw\.bereit/);
    expect(seite).toMatch(/lsp\.removeItem\(zw\.schluessel\)/);
  });
});
