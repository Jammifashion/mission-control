// Befehl M3: Erfassungsmaske mit L-Shop-Modell.
//
//  1. Block "L-Shop-Modell" aus index.html (reine Logik): Farben nur aus dem
//     Modell, Groessen aus den Zeilen der gewaehlten Farben, ArticleNr je
//     Variante, Varianten-Payload mit lshopArticleNr.
//  2. Block "Artikel-ID": anlageZustand sperrt ohne Versandklasse und bei
//     fremden Farben.
//  3. Regressionstest Befund M1: nach der Anlage stehen die WC_Variation_IDs im
//     Reiter Varianten - Schritt 10 (POST /erfassung/overwrite) leert sie nicht.
//
// Die Modell-Daten sind Platzhalter im Format der Route
// GET /api/sheets/lshop/:catalogNr (backend/lib/lshop.js), keine Stammdatei.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── In-Memory-Sheet: Erfassungsmaske + Varianten ────────────────────────────
let tabs;
const sheetIds = { Erfassungsmaske: 11, Varianten: 77 };
const rowNr = r => Number(/!(?:[A-Z]+)?(\d+)/.exec(r)?.[1]);

const values = {
  get: jest.fn(async ({ range }) => {
    const [tab, teil] = range.split('!');
    const rows = tabs[tab];
    if (!rows) throw new Error(`unerwartete Range ${range}`);
    if (!teil || /^1:2000$/.test(teil)) return { data: { values: rows.map(r => [...r]) } };
    const m = /^(\d+):(\d+)$/.exec(teil);
    if (m) return { data: { values: rows[Number(m[1]) - 1] ? [[...rows[Number(m[1]) - 1]]] : [] } };
    throw new Error(`unerwartete Range ${range}`);
  }),
  update: jest.fn(async ({ range, requestBody }) => {
    const [tab, zelle] = range.split('!');
    const n = rowNr(range);
    if (n === 1 && /^[A-Z]+1$/.test(zelle)) { tabs[tab][0].push(requestBody.values[0][0]); return { data: {} }; }
    tabs[tab][n - 1] = requestBody.values[0].map(c => String(c ?? ''));
    return { data: {} };
  }),
  append: jest.fn(async ({ range, requestBody }) => {
    const tab = range.split('!')[0];
    const erste = tabs[tab].length + 1;
    tabs[tab].push(...requestBody.values.map(r => r.map(c => (typeof c === 'boolean' ? String(c).toUpperCase() : String(c ?? '')))));
    return { data: { updates: { updatedRange: `${tab}!A${erste}:Z${tabs[tab].length}` } } };
  }),
  batchUpdate: jest.fn(async () => ({ data: {} })),
};
const spreadsheets = {
  values,
  get: jest.fn(async () => ({ data: { sheets: Object.entries(sheetIds).map(([title, sheetId]) => ({ properties: { title, sheetId } })) } })),
  batchUpdate: jest.fn(async ({ requestBody }) => {
    for (const rq of requestBody.requests) {
      if (rq.deleteDimension && rq.deleteDimension.range.sheetId === sheetIds.Varianten)
        tabs.Varianten.splice(rq.deleteDimension.range.startIndex, 1);
    }
    return { data: {} };
  }),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

// ── Frontend-Bloecke ────────────────────────────────────────────────────────
const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => {
  const i = html.indexOf(a), j = html.indexOf(e);
  if (i < 0 || j < 0) throw new Error(`Block fehlt: ${a}`);
  return html.slice(i, j);
};
const FARB  = block('// ── Farbachsen-Regel: Anfang', '// ── Farbachsen-Regel: Ende ──');
const LSHOP = block('// ── L-Shop-Modell: Anfang', '// ── L-Shop-Modell: Ende ──');
const SKU   = block('// ── SKU-Regeln: Anfang', '// ── SKU-Regeln: Ende ──');
const AID   = block('// ── Artikel-ID: Anfang', '// ── Artikel-ID: Ende ──');
const fe = new Function(`${FARB}\n${LSHOP}\n${SKU}\n${AID}\n return {
  lshopFarbe, lshopGroessen, lshopEigenschaften, lshopArticleNr, lshopFarbFehler,
  variantenFarbwert, variantenZeile, erfassungNachAnlage, anlageZustand,
  lshopGesperrteFarbe, lshopAuslauf, lshopModellHinweis };`)();

// Antwort von GET /api/sheets/lshop/CB166R (ohne Farben = alle).
const CB166R = {
  catalogNr: 'CB166R',
  alleFarben: ['Black/Kelly Green', 'Black/Red', 'Black/White', 'Navy/Sky Blue', 'White/Black'],
  groessen: ['One Size'],
  varianten: [
    ['Black/Kelly Green', '1000412880'], ['Black/Red', '1000412881'], ['Black/White', '1000412882'],
    ['Navy/Sky Blue', '1000412883'], ['White/Black', '1000412884'],
  ].map(([farbe, articleNr]) => ({ farbe, groesse: 'One Size', articleNr })),
  faser: '100% Polyester', grammatur: null, hinweise: [],
};

// E3000-Platzhalter: Black in XS..3XL, Sports Grey (Heather) nur S..XL.
const E3000 = {
  catalogNr: 'E3000',
  alleFarben: ['Black', 'Sports Grey (Heather)'],
  groessen: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  varianten: [
    ...['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map((g, i) => ({ farbe: 'Black', groesse: g, articleNr: `900000010${i}` })),
    ...['S', 'M', 'L', 'XL'].map((g, i) => ({ farbe: 'Sports Grey (Heather)', groesse: g, articleNr: `900000020${i}` })),
  ],
  faser: null, grammatur: null, hinweise: [],
};

const DREI = ['Black/Kelly Green', 'Black/Red', 'Black/White'];
const attrs = (...paare) => paare.map(([name, value]) => ({ name, value }));

// M8b: Antwort fuer BG42 (Auszug) und ein Modell mit gesperrten Varianten.
const BG42 = {
  catalogNr: 'BG42',
  alleFarben: ['Black', 'White', 'Fuchsia', 'Jungle Camo', 'Fluorescent Yellow'],
  groessen: ['38 x 14 x 8 cm'],
  varianten: [
    ['Black', '1000030393'], ['White', '1000030402'], ['Fuchsia', '1000030398'],
    ['Jungle Camo', '1000231408', 1], ['Fluorescent Yellow', '1000292385', 1],
  ].map(([farbe, articleNr, auslauf]) => ({ farbe, groesse: '38 x 14 x 8 cm', articleNr, ...(auslauf ? { auslauf } : {}) })),
  gesperrt: [],
  auslaufend: [{ farbe: 'Jungle Camo', groesse: '38 x 14 x 8 cm', wert: 1 }, { farbe: 'Fluorescent Yellow', groesse: '38 x 14 x 8 cm', wert: 1 }],
  faser: '100% Polyester', grammatur: null, hinweise: [],
};
const X1 = {
  catalogNr: 'X1', alleFarben: ['Black', 'Blue'], groessen: ['M', 'L'],
  varianten: [{ farbe: 'Black', groesse: 'M', articleNr: '9000000001' }, { farbe: 'Blue', groesse: 'M', articleNr: '9000000005', auslauf: 2 },
    { farbe: 'Blue', groesse: 'L', articleNr: '9000000006' }],
  gesperrt: [{ farbe: 'Black', groesse: 'L', articleNr: '9000000002', wert: 6 }, { farbe: 'Red', groesse: 'M', articleNr: '9000000003', wert: 3 }],
  auslaufend: [{ farbe: 'Blue', groesse: 'M', wert: 2 }],
};

describe('Block L-Shop-Modell: Discontinued (M8b)', () => {
  test('BG42: auslaufende Farben markiert, andere nicht', () => {
    expect(fe.lshopAuslauf(BG42, 'jungle camo')).toBe('läuft aus (Wert 1)');
    expect(fe.lshopAuslauf(BG42, 'Black')).toBeNull();
    expect(fe.lshopAuslauf(BG42, 'Pink')).toBeNull();
    expect(fe.lshopModellHinweis(BG42))
      .toBe('Achtung: Jungle Camo läuft aus (Wert 1); Fluorescent Yellow läuft aus (Wert 1).');
    // waehlbar: ArticleNr kommt wie bei jeder Farbe
    expect(fe.lshopArticleNr(BG42, attrs(['Farbe', 'Jungle Camo']))).toBe('1000231408');
  });
  test('gesperrte Farbe nicht waehlbar, mit eigenem Grund; nur teilweise auslaufend -> Groessen genannt', () => {
    expect(fe.lshopGesperrteFarbe(X1, 'red')).toEqual({ farbe: 'Red', wert: 3 });
    expect(fe.lshopGesperrteFarbe(X1, 'Black')).toBeNull();          // Black ist in M waehlbar
    expect(fe.lshopFarbFehler(X1, ['Red'])).toMatch(/gehört nicht zum L-Shop-Modell X1/);
    expect(fe.lshopArticleNr(X1, attrs(['Farbe', 'Black'], ['Größe', 'L']))).toBeNull();
    expect(fe.lshopAuslauf(X1, 'Blue')).toBe('läuft aus (Wert 2, nur M)');
    expect(fe.lshopModellHinweis(X1))
      .toBe('Gesperrt, nicht wählbar: Black L (Wert 6), Red (Wert 3). Achtung: Blue läuft aus (Wert 2, nur M).');
  });
  test('ohne Befund oder ohne Modell: leer', () => {
    expect(fe.lshopModellHinweis(CB166R)).toBe('');
    expect(fe.lshopModellHinweis(null)).toBe('');
    expect(fe.lshopAuslauf(null, 'Black')).toBeNull();
  });
});

describe('Block L-Shop-Modell: CB166R', () => {
  test('3 Farben, eine Groesse -> nur Farbachse, keine Groessenachse', () => {
    expect(fe.lshopEigenschaften(CB166R, DREI)).toEqual([{ name: 'Farbe', tags: DREI }]);
    expect(fe.lshopGroessen(CB166R, DREI)).toEqual(['One Size']);
  });

  test('Schreibweise des Modells, Gross/Klein egal, Dubletten fallen weg', () => {
    expect(fe.lshopEigenschaften(CB166R, ['black/kelly green', 'Black/Kelly Green', 'BLACK/RED']))
      .toEqual([{ name: 'Farbe', tags: ['Black/Kelly Green', 'Black/Red'] }]);
  });

  test('3 ArticleNr als String, ohne Groessenachse ueber die einzige Groesse', () => {
    expect(DREI.map(f => fe.lshopArticleNr(CB166R, attrs(['Farbe', f]))))
      .toEqual(['1000412880', '1000412881', '1000412882']);
    for (const f of DREI) expect(typeof fe.lshopArticleNr(CB166R, attrs(['Farbe', f]))).toBe('string');
  });

  test('fremde Farbe (Bestand deutsch) -> Anlage-Sperre mit Text, keine ArticleNr', () => {
    expect(fe.lshopFarbFehler(CB166R, ['Black/Red', 'Schwarz']))
      .toBe('Farbe "Schwarz" gehört nicht zum L-Shop-Modell CB166R – nur dessen Farben wählen.');
    expect(fe.lshopFarbFehler(CB166R, DREI)).toBeNull();
    expect(fe.lshopFarbFehler(null, ['Schwarz'])).toBeNull();     // ohne Modell: frei (Fremdware)
    expect(fe.lshopArticleNr(CB166R, attrs(['Farbe', 'Schwarz']))).toBeNull();
  });
});

describe('Block L-Shop-Modell: E3000', () => {
  test('Black -> Groessen XS .. 3XL aus den Zeilen, Groessenachse', () => {
    expect(fe.lshopEigenschaften(E3000, ['Black'])).toEqual([
      { name: 'Farbe', tags: ['Black'] },
      { name: 'Größe', tags: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] },
    ]);
  });

  test('Groessen nur der gewaehlten Farben', () => {
    expect(fe.lshopGroessen(E3000, ['Sports Grey (Heather)'])).toEqual(['S', 'M', 'L', 'XL']);
  });

  test('ArticleNr je Farbe x Groesse; Kombination ohne Zeile -> null', () => {
    expect(fe.lshopArticleNr(E3000, attrs(['Farbe', 'Black'], ['Größe', 'M']))).toBe('9000000102');
    expect(fe.lshopArticleNr(E3000, attrs(['Farbe', 'Sports Grey (Heather)'], ['Größe', 'XS']))).toBeNull();
  });
});

describe('Varianten-Payload', () => {
  const v = { attrs: attrs(['Farbe', 'Black/Kelly Green']), price: '25', _checked: true, lshopArticleNr: '1000412880' };

  test('lshopArticleNr als String im Payload', () => {
    expect(fe.variantenZeile(v, 0)).toEqual({
      nr: 1, e1: 'Farbe', v1: 'Black/Kelly Green', e2: '', v2: '', e3: '', v3: '',
      preis: '25', aktiv: true, wcVariationId: null, googleFarbe: '', lshopArticleNr: '1000412880',
    });
  });

  test('ohne ArticleNr (Fremdware, Bestand) kein Feld -> Bestandswert im Reiter bleibt', () => {
    const { lshopArticleNr: _x, ...ohne } = v;
    expect(fe.variantenZeile(ohne, 0)).not.toHaveProperty('lshopArticleNr');
  });

  test('nach der Anlage: WC-ID und Google_Farbe = Farbwert 1:1', () => {
    const z = fe.variantenZeile(v, 0, { wcVariationId: 9001, googleFarbe: fe.variantenFarbwert(v.attrs) });
    expect(z.wcVariationId).toBe(9001);
    expect(z.googleFarbe).toBe('Black/Kelly Green');
  });

  test('erfassungNachAnlage laesst varianten weg, sonst alles', () => {
    expect(fe.erfassungNachAnlage({ Produktname: 'Cap', varianten: [{ nr: 1 }] })).toEqual({ Produktname: 'Cap' });
  });
});

describe('anlageZustand (Versandklasse, L-Shop-Farben)', () => {
  const GUT = { editMode: false, laeuft: false, ssotId: 'JFN-2026-0100', variantenAnzahl: 3, aktiveAnzahl: 3 };

  test('Versandklasse leer -> Anlage gesperrt mit Grund', () => {
    expect(fe.anlageZustand({ ...GUT, versandFehler: 'keine Versandklasse gewählt' }))
      .toEqual({ aktiv: false, grund: 'Versandklasse: keine Versandklasse gewählt' });
  });

  test('fremde Farbe -> gesperrt', () => {
    const f = fe.lshopFarbFehler(CB166R, ['Schwarz']);
    expect(fe.anlageZustand({ ...GUT, lshopFehler: f })).toEqual({ aktiv: false, grund: f });
  });

  test('alles da -> frei; Aenderungsmodus unberuehrt', () => {
    expect(fe.anlageZustand(GUT)).toEqual({ aktiv: true, grund: '' });
    expect(fe.anlageZustand({ ...GUT, editMode: true, versandFehler: 'x' })).toEqual({ aktiv: false, grund: '' });
  });
});

// ── Regressionstest Befund M1 ───────────────────────────────────────────────

describe('WC_Variation_IDs bleiben nach der Anlage im Reiter', () => {
  let request, app;
  const ERF_KOPF = ['ID', 'Status', 'Status Shop', 'Produkt-ID', 'Produktname', 'Produktart',
    'L-Shop-Artikelnummer', 'Artikelkurzbezeichnung', 'Artikelnummer', 'Versandklasse'];
  const VAR_KOPF = ['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv',
    'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'];
  const SSOT = 'JFN-2026-0100';
  const spalte = name => VAR_KOPF.indexOf(name);

  // Formularzustand nach recomputeVariants mit L-Shop-Modell (IDs noch leer).
  const formular = () => DREI.map((f, i) => ({
    attrs: attrs(['Farbe', f]), price: '25', _checked: true, lshopArticleNr: `100041288${i}`,
  }));
  const stammdaten = varianten => ({
    'Produktname': 'Match Day Cap Crocodiles Hamburg', 'Produktart': 'Variabel',
    'L-Shop-Artikelnummer': 'CB166R', 'Artikelkurzbezeichnung': 'CH-Matchday',
    'Artikelnummer': 'CB166R/CH-Matchday', 'Versandklasse': 'paket',
    varianten: varianten.map((v, i) => fe.variantenZeile(v, i)),
  });

  beforeAll(async () => {
    process.env.GOOGLE_SHEET_ID = 'ssot-test';
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    app = express();
    app.use(express.json());
    app.use('/api/sheets', (await import('../routes/sheets.js')).default);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  });

  // Schritt 0 (saveDraft), Schritt 9 (PUT varianten mit IDs), Schritt 10 (overwrite).
  async function anlage({ schritt10 }) {
    tabs = { Erfassungsmaske: [ERF_KOPF.slice()], Varianten: [VAR_KOPF.slice()] };
    const vs = formular();
    const r0 = await request(app).post('/api/sheets/erfassung').send(stammdaten(vs));
    expect(r0.status).toBe(200);
    const ssotId = r0.body.ssotId;

    const ids = [7101, 7102, 7103];
    const payload9 = vs.map((v, i) => {
      v.wcVariationId = ids[i];
      return fe.variantenZeile(v, i, { wcVariationId: ids[i], googleFarbe: fe.variantenFarbwert(v.attrs) });
    });
    const r9 = await request(app).put(`/api/sheets/varianten/${ssotId}`).send({ varianten: payload9 });
    expect(r9.status).toBe(200);

    // Schritt 10 baut wie das Frontend aus einem FRISCHEN Formularzustand
    // (wie buildSheetPayload); vor M3 ohne erfassungNachAnlage.
    const body10 = schritt10(stammdaten(formular()));
    const r10 = await request(app).post('/api/sheets/erfassung/overwrite')
      .send({ row: r0.body.row, ssotId, 'Produkt-ID': '99001', ...body10, 'Status': 'Im Shop' });
    expect(r10.status).toBe(200);
    return tabs.Varianten.slice(1).filter(z => z[spalte('SSOT-ID')] === ssotId);
  }

  test('mit erfassungNachAnlage (M3): IDs, Google_Farbe und LShop_ArticleNr stehen', async () => {
    const zeilen = await anlage({ schritt10: fe.erfassungNachAnlage });
    expect(zeilen.map(z => z[spalte('WC_Variation_ID')])).toEqual(['7101', '7102', '7103']);
    expect(zeilen.map(z => z[spalte('Google_Farbe')])).toEqual(DREI);
    expect(zeilen.map(z => z[spalte('LShop_ArticleNr')])).toEqual(['1000412880', '1000412881', '1000412882']);
    expect(tabs.Erfassungsmaske[1][ERF_KOPF.indexOf('Produkt-ID')]).toBe('99001');
  });

  test('Befund M1 (vorher): Schritt 10 mit varianten leerte die IDs', async () => {
    const zeilen = await anlage({ schritt10: body => body });
    expect(zeilen.map(z => z[spalte('WC_Variation_ID')])).toEqual(['', '', '']);
  });
});
