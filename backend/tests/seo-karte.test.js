// Befehl M9: SEO_Karte-Zeile nach dem Yoast-Speichern (lib/seo-karte.js,
// POST /api/seo/karte, Frontend-Block "SEO-Karte").
//
// In-Memory-Sheet und WC-Mock; Werte sind Platzhalter im Format des Reiters
// (Kopfzeile wie gemessen in bericht-SK1, dazu eine unbekannte Zusatzspalte).

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const KOPF = ['Typ', 'Name', 'Pfad', 'Artikel', 'Ist_Keyphrase', 'Ist_Synonyme', 'Ist_SEO_Titel', 'Ist_Meta',
  'noindex', 'WC_ID', 'Ueberschreiben', 'Oberkategorie', 'Befund', 'Soll_Keyphrase', 'Soll_Synonyme',
  'Soll_SEO_Titel', 'Soll_Meta', 'Status', 'Stand', 'Notiz', 'Extra'];
const zeile = o => KOPF.map(k => o[k] ?? '');
let tab;
let batchFehler = null;
const colIdx = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const values = {
  get: jest.fn(async ({ range }) => {
    if (range === 'SEO_Karte') return { data: { values: tab.map(r => [...r]) } };
    const m = /^SEO_Karte!A(\d+):[A-Z]+\d+$/.exec(range);
    if (m) return { data: { values: tab[Number(m[1]) - 1] ? [[...tab[Number(m[1]) - 1]]] : [] } };
    throw new Error(`unerwartete Range ${range}`);
  }),
  batchUpdate: jest.fn(async ({ requestBody }) => {
    if (batchFehler) throw batchFehler;
    expect(requestBody.valueInputOption).toBe('RAW');
    for (const d of requestBody.data) {
      const [, spalte, nr] = /^SEO_Karte!([A-Z]+)(\d+)$/.exec(d.range);
      const i = Number(nr) - 1;
      while (tab.length <= i) tab.push([]);
      tab[i][colIdx(spalte)] = d.values[0][0];
    }
    return { data: {} };
  }),
};
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => ({ spreadsheets: { values } }) } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));

const KATEGORIEN = [
  { id: 67, name: 'Künstler und Marken', parent: 0 },
  { id: 670, name: 'Malle Prinz', parent: 67 },
  { id: 549, name: 'Crocodiles Hamburg', parent: 0 },
  { id: 556, name: 'Accessoires', parent: 549 },
  { id: 686, name: 'Kollektion 26/27', parent: 549 },
  { id: 800, name: 'Kids &amp; Teens', parent: 0 },
];
let produkt;
const wcGet = jest.fn(async (pfad) => {
  if (pfad === 'products/categories') return { data: KATEGORIEN };
  if (pfad.startsWith('products/')) return { data: produkt };
  throw new Error(pfad);
});
const wcPut = jest.fn();
jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: () => ({ get: wcGet, put: wcPut }), getShopConfig: () => ({ shop: 'jfn' }),
}));

process.env.GOOGLE_SHEET_ID = 'ssot-test';
const k = await import('../lib/seo-karte.js');

const SYN_ROH = '["Malle Prinz Tasche, Ultras Bauchtasche Malle, Malle Prinz Gürteltasche"]';
const SYN_SOLL = 'Malle Prinz Tasche, Ultras Bauchtasche Malle, Malle Prinz Gürteltasche';
const yoast = (kp, syn, titel = `${kp} %%sep%% %%sitename%%`, meta = `${kp} in Black.`) => [
  { key: '_yoast_wpseo_focuskw', value: kp }, { key: '_yoast_wpseo_keywordsynonyms', value: syn },
  { key: '_yoast_wpseo_title', value: titel }, { key: '_yoast_wpseo_metadesc', value: meta },
];
const BESTAND = zeile({ Typ: 'Artikel', Name: 'Hoodie Malle Prinz Ultras', Pfad: 'Künstler und Marken > Malle Prinz', WC_ID: '18390',
  Ist_Keyphrase: 'Hoodie Malle Prinz Ultras', Oberkategorie: 'Künstler und Marken', Soll_Keyphrase: 'Hoodie Malle Prinz Ultras',
  Status: 'geschrieben', Stand: '2026-09-24' });
const KAT_670 = zeile({ Typ: 'Kategorie', Name: 'Malle Prinz', WC_ID: '21126', Ist_Keyphrase: 'Malle Prinz' });   // gleiche Zahl, Kategorie

const rufe = () => k.seoKarteNachziehen('21126', { heute: '2026-09-26' });
const zelle = (nr, spalte) => tab[nr - 1][KOPF.indexOf(spalte)] ?? '';

beforeEach(() => {
  tab = [KOPF, BESTAND, KAT_670];
  batchFehler = null;
  produkt = { id: 21126, name: 'Malle Prinz Ultras Bauchtasche', categories: [{ id: 670 }], meta_data: yoast('Malle Prinz Ultras Bauchtasche', SYN_ROH) };
  values.batchUpdate.mockClear(); wcPut.mockClear();
  k._resetKarteCache();
});

// ── Reine Logik ─────────────────────────────────────────────────────────────

describe('kartePfad', () => {
  test('eine Blattkategorie -> Namenskette, Oberkategorie = erster Teil', () => {
    expect(k.kartePfad([67, 670], KATEGORIEN)).toEqual({ pfad: 'Künstler und Marken > Malle Prinz', oberkategorie: 'Künstler und Marken', hinweis: null });
  });
  test('zwei Blaetter derselben Oberkategorie -> Pfad leer, Oberkategorie bleibt, Hinweis', () => {
    const r = k.kartePfad([549, 556, 686], KATEGORIEN);
    expect(r.pfad).toBe('');
    expect(r.oberkategorie).toBe('Crocodiles Hamburg');
    expect(r.hinweis).toMatch(/Pfad nicht eindeutig \(Crocodiles Hamburg > Accessoires \| Crocodiles Hamburg > Kollektion 26\/27\)/);
  });
  test('verschiedene Oberkategorien -> beides leer', () => {
    expect(k.kartePfad([670, 556], KATEGORIEN)).toMatchObject({ pfad: '', oberkategorie: '' });
  });
  test('HTML-Entities im Namen', () => {
    expect(k.kartePfad([800], KATEGORIEN).pfad).toBe('Kids & Teens');
  });
});

describe('sollSynonyme', () => {
  test('mit und ohne Klammern', () => {
    expect(k.sollSynonyme(SYN_ROH)).toBe(SYN_SOLL);
    expect(k.sollSynonyme('a, b')).toBe('a, b');
    expect(k.sollSynonyme('')).toBe('');
  });
});

// ── Schreiben ───────────────────────────────────────────────────────────────

describe('seoKarteNachziehen', () => {
  test('keine Zeile -> neue Zeile unter der letzten Datenzeile, Muster-Felder aus den Kategorien', async () => {
    const r = await rufe();
    expect(r).toMatchObject({ aktion: 'neu', zeile: 4, hinweise: [], abweichungen: [] });
    expect(zelle(4, 'Typ')).toBe('Artikel');
    expect(zelle(4, 'Name')).toBe('Malle Prinz Ultras Bauchtasche');
    expect(zelle(4, 'Pfad')).toBe('Künstler und Marken > Malle Prinz');
    expect(zelle(4, 'Oberkategorie')).toBe('Künstler und Marken');
    expect(zelle(4, 'WC_ID')).toBe('21126');
    expect(zelle(4, 'Ist_Synonyme')).toBe(SYN_ROH);
    expect(zelle(4, 'Soll_Keyphrase')).toBe('Malle Prinz Ultras Bauchtasche');
    expect(zelle(4, 'Soll_Synonyme')).toBe(SYN_SOLL);
    expect(zelle(4, 'Status')).toBe('geschrieben');
    expect(zelle(4, 'Stand')).toBe('2026-09-26');
    for (const s of ['Artikel', 'noindex', 'Ueberschreiben', 'Befund', 'Soll_SEO_Titel', 'Soll_Meta', 'Notiz', 'Extra'])
      expect(zelle(4, s)).toBe('');
    expect(tab[1]).toEqual(BESTAND);          // andere Zeilen unveraendert
    expect(tab[2]).toEqual(KAT_670);          // Kategorie-Zeile mit gleicher Zahl nicht als Treffer
  });

  test('neue Zeile, Pfad nicht eindeutig -> leer + Hinweis', async () => {
    produkt.categories = [{ id: 556 }, { id: 686 }];
    const r = await rufe();
    expect(zelle(4, 'Pfad')).toBe('');
    expect(zelle(4, 'Oberkategorie')).toBe('Crocodiles Hamburg');
    expect(r.hinweise[0]).toMatch(/Pfad nicht eindeutig/);
  });

  test('vorhandene Zeile mit leerem Soll -> Ist, Soll, Stand; unbekannte Spalte und Status bleiben', async () => {
    tab.push(zeile({ Typ: 'Artikel', Name: 'Alt', Pfad: 'X > Y', WC_ID: '21126', Ist_Keyphrase: 'alt', Status: 'zurückgestellt',
      Notiz: 'Hand', Befund: 'b', Extra: 'bleibt', Stand: '2026-09-01' }));
    const r = await rufe();
    expect(r).toMatchObject({ aktion: 'aktualisieren', zeile: 4, hinweise: [] });
    expect(zelle(4, 'Ist_Keyphrase')).toBe('Malle Prinz Ultras Bauchtasche');
    expect(zelle(4, 'Soll_Keyphrase')).toBe('Malle Prinz Ultras Bauchtasche');
    expect(zelle(4, 'Soll_Synonyme')).toBe(SYN_SOLL);
    expect(zelle(4, 'Stand')).toBe('2026-09-26');
    expect(zelle(4, 'Extra')).toBe('bleibt');
    expect(zelle(4, 'Status')).toBe('zurückgestellt');
    expect(zelle(4, 'Name')).toBe('Alt');
    expect(zelle(4, 'Pfad')).toBe('X > Y');
    expect(zelle(4, 'Notiz')).toBe('Hand');
    expect(zelle(4, 'Befund')).toBe('b');
  });

  test('Soll = alter Ist -> Soll folgt dem neuen Ist', async () => {
    tab.push(zeile({ Typ: 'Artikel', WC_ID: '21126', Ist_Keyphrase: 'Alte KP', Soll_Keyphrase: 'alte kp',
      Ist_Synonyme: '["x, y"]', Soll_Synonyme: 'x, y' }));
    const r = await rufe();
    expect(r.hinweise).toEqual([]);
    expect(zelle(4, 'Soll_Keyphrase')).toBe('Malle Prinz Ultras Bauchtasche');
    expect(zelle(4, 'Soll_Synonyme')).toBe(SYN_SOLL);
  });

  test('abweichendes Soll bleibt stehen, Hinweis', async () => {
    tab.push(zeile({ Typ: 'Artikel', WC_ID: '21126', Ist_Keyphrase: 'Alte KP', Soll_Keyphrase: 'Geplante KP',
      Ist_Synonyme: '["x"]', Soll_Synonyme: 'geplant' }));
    const r = await rufe();
    expect(zelle(4, 'Soll_Keyphrase')).toBe('Geplante KP');
    expect(zelle(4, 'Soll_Synonyme')).toBe('geplant');
    expect(zelle(4, 'Ist_Keyphrase')).toBe('Malle Prinz Ultras Bauchtasche');
    expect(r.hinweise).toEqual(['Karte hat abweichendes Soll (Soll_Keyphrase, Soll_Synonyme, Zeile 4) – bitte pruefen.']);
  });

  test('Synonyme ohne Klammern im Shop -> Ist roh, Soll gleich', async () => {
    produkt.meta_data = yoast('Malle Prinz Ultras Bauchtasche', 'a, b');
    await rufe();
    expect(zelle(4, 'Ist_Synonyme')).toBe('a, b');
    expect(zelle(4, 'Soll_Synonyme')).toBe('a, b');
  });

  test('zwei Zeilen mit der WC_ID -> 409, nichts geschrieben', async () => {
    tab.push(zeile({ Typ: 'Artikel', WC_ID: '21126' }), zeile({ Typ: 'Artikel', WC_ID: '21126' }));
    await expect(rufe()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Zeilen 4, 5/) });
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('unveraendert -> kein Schreiben', async () => {
    await rufe();
    values.batchUpdate.mockClear();
    const r = await rufe();
    expect(r).toMatchObject({ aktion: 'aktualisieren', geschrieben: [] });
    expect(values.batchUpdate).not.toHaveBeenCalled();
  });

  test('Sheet-Fehler -> wirft; Shop wird nie geschrieben', async () => {
    batchFehler = Object.assign(new Error('Quota exceeded'), { status: 429 });
    await expect(rufe()).rejects.toThrow('Quota exceeded');
    expect(wcPut).not.toHaveBeenCalled();
  });

  test('keine Zahl als wcId -> 400', async () => {
    await expect(k.seoKarteNachziehen('abc')).rejects.toMatchObject({ status: 400 });
  });
});

// ── Route ───────────────────────────────────────────────────────────────────

describe('POST /api/seo/karte', () => {
  let request, app;
  beforeAll(async () => {
    request = (await import('supertest')).default;
    const express = (await import('express')).default;
    app = express();
    app.use(express.json());
    app.use('/api/seo', (await import('../routes/seo-meta.js')).default);
  });
  test('200 mit Ergebnis', async () => {
    const res = await request(app).post('/api/seo/karte').send({ wcId: '21126' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ aktion: 'neu', zeile: 4 });
  });
  test('Sheet-Fehler -> Status und Grund', async () => {
    batchFehler = Object.assign(new Error('Quota exceeded'), { status: 429 });
    const res = await request(app).post('/api/seo/karte').send({ wcId: '21126' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Quota exceeded');
  });
});

// ── Frontend-Block ──────────────────────────────────────────────────────────

describe('Frontend-Block SEO-Karte', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const a = html.indexOf('// ── SEO-Karte: Anfang'), e = html.indexOf('// ── SEO-Karte: Ende ──');
  const fe = new Function(`${html.slice(a, e)}\n return { seoKarteMeldungen };`)();

  test('Fehler -> Toast "SEO_Karte nicht aktualisiert: <Grund>"', () => {
    expect(fe.seoKarteMeldungen(null, 'Quota exceeded')).toEqual([{ text: 'SEO_Karte nicht aktualisiert: Quota exceeded', typ: 'error' }]);
  });
  test('neu / aktualisiert / Hinweise / nichts geschrieben', () => {
    expect(fe.seoKarteMeldungen({ aktion: 'neu', zeile: 675, geschrieben: ['Typ'], hinweise: [], abweichungen: [] }))
      .toEqual([{ text: 'SEO_Karte: neue Zeile 675', typ: 'success' }]);
    expect(fe.seoKarteMeldungen({ aktion: 'aktualisieren', zeile: 9, geschrieben: ['Stand'], hinweise: ['Karte hat abweichendes Soll'], abweichungen: [] }))
      .toEqual([{ text: 'SEO_Karte: Zeile 9 aktualisiert', typ: 'success' }, { text: 'SEO_Karte: Karte hat abweichendes Soll', typ: 'warn' }]);
    expect(fe.seoKarteMeldungen({ aktion: 'aktualisieren', zeile: 9, geschrieben: [], hinweise: [], abweichungen: [] })).toEqual([]);
  });
  test('Abweichung beim Zuruecklesen -> Fehler-Toast', () => {
    expect(fe.seoKarteMeldungen({ zeile: 9, geschrieben: ['Stand'], abweichungen: ['Stand: steht "x" statt "y"'] })[0].typ).toBe('error');
  });
  test('yoastSchreiben ruft die Karte erst nach dem Zuruecklesen', () => {
    const i = html.indexOf('async function yoastSchreiben');
    const body = html.slice(i, html.indexOf('\n      }\n', i));
    expect(body.indexOf('const nach = await apiJson')).toBeGreaterThan(0);
    expect(body.indexOf('seoKarteNachziehen(wcId)')).toBeGreaterThan(body.indexOf('const nach = await apiJson'));
  });
});
