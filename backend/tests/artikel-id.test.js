// Befehl AID: Artikel-ID frueh anlegen.
//
// Der Knopf "Artikel-ID anlegen" geht denselben Weg wie "Entwurf speichern"
// (saveDraft -> POST /api/sheets/erfassung). Die Logik fuer den Knopf steht im
// Block "Artikel-ID" in index.html; der Test fuehrt ihn zusammen mit dem
// SKU-Block aus (dieselbe Pruefung wie beim Speichern).

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── In-Memory-Sheet fuer die Erfassungsmaske ────────────────────────────────
const KOPF = ['ID', 'Status', 'Status Shop', 'Produkt-ID', 'SEO_Status', 'Produktname', 'Produktart',
  'L-Shop-Artikelnummer', 'Artikelkurzbezeichnung', 'Artikelnummer', 'Lieferzeit', 'Versandklasse', 'Kategorien'];
let zeilen;
const append = jest.fn(async ({ requestBody }) => {
  await new Promise(r => setTimeout(r, 5));            // Netzlaufzeit
  zeilen.push(...requestBody.values);
  return {};
});
jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: () => ({ spreadsheets: { values: {
    get: async () => { await new Promise(r => setTimeout(r, 5)); return { data: { values: zeilen.map(z => [...z]) } }; },
    append,
  } } }) },
}));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

let request, app;
beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'test-sheet';
  request = (await import('supertest')).default;
  const express = (await import('express')).default;
  app = express();
  app.use(express.json());
  app.use('/api/sheets', (await import('../routes/sheets.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});
beforeEach(() => {
  zeilen = [KOPF, ['JFN-2026-0041', 'Entwurf', '', '', '', 'Alt', 'Variabel', 'X', 'Alt01', 'X/Alt01']];
  append.mockClear();
});

// ── Frontend-Bloecke ausfuehren ─────────────────────────────────────────────
const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const SKU   = block('// ── SKU-Regeln: Anfang', '// ── SKU-Regeln: Ende ──');
const AID   = block('// ── Artikel-ID: Anfang', '// ── Artikel-ID: Ende ──');
const fe    = new Function(`${SKU}\n${AID}\n return { aidZustand, einmalGleichzeitig, anlageZustand };`)();

const GUT = { name: 'Oldschool T-Shirt Herren', lshop: 'E3000', kurz: 'CH-Oldschool', ssotId: '', editMode: false, laeuft: false };

// Wie saveDraft(false): Artikelnummer bauen und POST /erfassung. Nur der
// Speicherweg, ohne DOM.
const speichern = async (kopf = GUT) => {
  const res = await request(app).post('/api/sheets/erfassung').send({
    'Produktname': kopf.name, 'L-Shop-Artikelnummer': kopf.lshop,
    'Artikelkurzbezeichnung': kopf.kurz, 'Artikelnummer': `${kopf.lshop}/${kopf.kurz}`, 'Status': 'Entwurf',
  });
  return res.body;
};
const zeilenMit = artNr => zeilen.filter(z => z[9] === artNr).length;

// ════════════════════════════════════════════════════════════════════════════
describe('Knopf-Zustand', () => {
  test('Kopfdaten vollstaendig -> aktiv', () => {
    expect(fe.aidZustand(GUT)).toEqual({ sichtbar: true, aktiv: true, text: 'Artikel-ID anlegen', grund: '' });
  });

  test.each([
    ['Produktname fehlt',          { name: '  ' },          /Produktname fehlt/],
    ['L-Shop-Nummer fehlt',        { lshop: '' },           /L-Shop/],
    ['Kuerzel fehlt',              { kurz: '' },            /Artikelkurzbezeichnung fehlt/],
    ['Kuerzel zu kurz',            { kurz: 'AB' },          /3–20 Zeichen/],
    ['Kuerzel mit Leerzeichen',    { kurz: 'CH Old' },      /nur A–Z/],
  ])('%s -> gesperrt mit Grund', (_n, aenderung, grund) => {
    const z = fe.aidZustand({ ...GUT, ...aenderung });
    expect(z.aktiv).toBe(false);
    expect(z.sichtbar).toBe(true);
    expect(z.grund).toMatch(grund);
  });

  test('ID vorhanden -> gesperrt, zeigt die ID', () => {
    expect(fe.aidZustand({ ...GUT, ssotId: 'JFN-2026-0042' }))
      .toEqual({ sichtbar: true, aktiv: false, text: 'Artikel-ID JFN-2026-0042 vorhanden', grund: '' });
  });

  test('waehrend der Anfrage -> gesperrt', () => {
    expect(fe.aidZustand({ ...GUT, laeuft: true })).toMatchObject({ aktiv: false, text: 'Wird angelegt…' });
  });

  test('Aenderungspfad -> ausgeblendet', () => {
    expect(fe.aidZustand({ ...GUT, editMode: true, ssotId: 'JFN-2026-0001' })).toMatchObject({ sichtbar: false, aktiv: false });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Speicherweg: genau eine Zeile', () => {
  test('Anlegen -> genau eine neue Zeile, naechste ID', async () => {
    const d = await speichern();
    expect(d).toMatchObject({ success: true, exists: false, ssotId: 'JFN-2026-0042' });
    expect(zeilenMit('E3000/CH-Oldschool')).toBe(1);
    expect(append).toHaveBeenCalledTimes(1);
  });

  test('zweiter Klick (nach der Antwort) -> keine zweite Zeile, vorhandene ID', async () => {
    const a = await speichern();
    const b = await speichern();
    expect(b).toMatchObject({ success: true, exists: true, ssotId: a.ssotId });
    expect(zeilenMit('E3000/CH-Oldschool')).toBe(1);
    expect(append).toHaveBeenCalledTimes(1);
  });

  test('Doppelklick schnell -> eine Anfrage, eine Zeile', async () => {
    const gesperrt = fe.einmalGleichzeitig(() => speichern());
    const [a, b] = await Promise.all([gesperrt(), gesperrt()]);
    expect(a).toBe(b);                                          // dasselbe Ergebnis
    expect(append).toHaveBeenCalledTimes(1);
    expect(zeilenMit('E3000/CH-Oldschool')).toBe(1);
  });

  test('nach der Antwort ist die Sperre frei (naechster Aufruf laeuft wieder)', async () => {
    const fn = jest.fn(async () => 'ok');
    const gesperrt = fe.einmalGleichzeitig(fn);
    await gesperrt(); await gesperrt();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('Fehler gibt die Sperre ebenfalls frei', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('weg')).mockResolvedValueOnce('ok');
    const gesperrt = fe.einmalGleichzeitig(fn);
    await expect(gesperrt()).rejects.toThrow('weg');
    await expect(gesperrt()).resolves.toBe('ok');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Anbindung in index.html', () => {
  test('Knopf steht bei der SSOT-ID im Kopf', () => {
    const kopf = html.slice(html.indexOf('id="pf-ssot-id"'), html.indexOf('id="pf-wc-id"'));
    expect(kopf).toContain('id="btn-aid-anlegen"');
  });

  test('derselbe Speicherweg: der Knopf ruft saveDraft, kein eigener fetch', () => {
    const von = html.indexOf("getElementById('btn-aid-anlegen').addEventListener");
    const handler = html.slice(von, html.indexOf('\n      });', von));
    expect(handler).toContain('await saveDraft(false)');
    expect(handler).not.toMatch(/apiFetch|\/api\/sheets/);
    expect(handler).toContain('Artikel-ID ${id} angelegt');
  });

  test('saveDraft ist gegen parallele Aufrufe gesperrt (Knopf, Entwurf, Anlagepfad)', () => {
    expect(html).toContain('const saveDraft = einmalGleichzeitig(saveDraftEinmal);');
  });

  test('danach Artikel anlegen ohne Entwurf: der Anlagepfad speichert nur ohne ID', () => {
    const von = html.indexOf("getElementById('btn-create-wc').addEventListener");
    const handler = html.slice(von, von + 2500);
    expect(handler).toMatch(/let ssotId = document\.getElementById\('pf-ssot-id'\)\.value;\s*\n\s*\/\/[^\n]*\n\s*if \(!ssotId\) \{/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Nachtrag AID2: "In WooCommerce anlegen" verlangt nicht mehr den Status
// "Bereit zur Anlage", sondern Artikel-ID + dieselben Pflichtpruefungen.
describe('Freigabe "In WooCommerce anlegen"', () => {
  const OK = {
    editMode: false, laeuft: false, ssotId: 'JFN-2026-0042', variantenAnzahl: 2, aktiveAnzahl: 2,
    preiseFehlen: false, achsenFehler: null, lieferzeitFehler: null, skuFehler: null,
  };

  test('ID vorhanden + Pflichtfelder gueltig -> aktiv', () => {
    expect(fe.anlageZustand(OK)).toEqual({ aktiv: true, grund: '' });
  });

  test('Artikel ohne Varianten (Puck) mit ID -> aktiv', () => {
    expect(fe.anlageZustand({ ...OK, variantenAnzahl: 0, aktiveAnzahl: 0 })).toEqual({ aktiv: true, grund: '' });
  });

  test('ID fehlt -> gesperrt mit Grund', () => {
    expect(fe.anlageZustand({ ...OK, ssotId: '' }))
      .toEqual({ aktiv: false, grund: 'Artikel-ID fehlt – zuerst „Artikel-ID anlegen“.' });
  });

  test.each([
    ['keine Variante ausgewaehlt', { aktiveAnzahl: 0 },                                'Bitte mindestens eine Variante auswählen.'],
    ['Preis fehlt',                { preiseFehlen: true },                             'Bitte alle Variantenpreise ausfüllen.'],
    ['Farbachse fehlt',            { achsenFehler: 'Variantenachse "Farbe" fehlt.' },  'Variantenachse "Farbe" fehlt.'],
    ['Lieferzeit fehlt',           { lieferzeitFehler: 'keine Lieferzeit gewählt' },   'Lieferzeit: keine Lieferzeit gewählt'],
    ['SKU ungueltig',              { skuFehler: 'Varianten-SKU zu lang.' },            'Varianten-SKU zu lang.'],
  ])('Pflichtfeld ungueltig (%s) -> gesperrt mit Grund', (_n, aenderung, grund) => {
    expect(fe.anlageZustand({ ...OK, ...aenderung })).toEqual({ aktiv: false, grund });
  });

  test('waehrend der Anlage und im Aenderungspfad gesperrt, ohne Grund', () => {
    expect(fe.anlageZustand({ ...OK, laeuft: true })).toEqual({ aktiv: false, grund: '' });
    expect(fe.anlageZustand({ ...OK, editMode: true })).toEqual({ aktiv: false, grund: '' });
  });

  test('echte SKU-Pruefung: zu lange Varianten-SKU sperrt', () => {
    const skuFe = new Function(`${SKU}\n return { skuBaueArtikelnummer, skuBaueVariantenSkus };`)();
    const art = skuFe.skuBaueArtikelnummer('E3000', 'CH-Oldschool').artikelnummer;
    const lang = [{ attrs: [{ name: 'Farbe', value: 'Sehr sehr sehr lange Farbbezeichnung mit Zusatz' }] }];
    const fehler = skuFe.skuBaueVariantenSkus(art, lang).fehler;
    expect(fehler).toBeTruthy();
    expect(fe.anlageZustand({ ...OK, skuFehler: fehler }).aktiv).toBe(false);
  });

  test('Status "Bereit zur Anlage" gibt den Knopf nicht mehr frei', () => {
    expect(html).not.toMatch(/createWcBtn\.disabled = prodStatusSel\.value !== 'ready'/);
    expect(html).not.toMatch(/createWcBtn\.disabled = (true|false)/);
    expect(html).toContain("document.getElementById('product-form-area').addEventListener('input',  aktualisiereAnlage);");
  });
});
