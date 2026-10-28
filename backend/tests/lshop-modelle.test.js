// LS4: Ansicht "L-Shop-Modelle" (lib/lshopModelle.js, utils/lshop-modelle.js, routes/lshop.js).
// Sheet, Drive und WC sind In-Memory-Mocks; alle Werte sind Platzhalter (erfundene Preise).
// Es wird nie ein echtes Sheet beschrieben.

import { jest } from '@jest/globals';
import { Readable } from 'stream';

// ── In-Memory-Sheet mit A1-Bereichen ('Reiter'!A5:D6, Reiter!1:1, 'Reiter') ──
let tabs, calls, formate, ids;
const colIdx = b => [...b].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
const nichtDa = r => Object.assign(new Error(`Unable to parse range: ${r}`), { status: 400 });
function bereich(range) {
  const [roh, teil = ''] = range.split('!');
  const tab = roh.replace(/^'|'$/g, '');
  if (!tabs[tab]) throw nichtDa(range);
  let m;
  if ((m = /^(\d+):(\d+)$/.exec(teil))) return { tab, r0: +m[1] - 1, r1: +m[2] - 1, c0: 0, c1: null };
  if ((m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?$/.exec(teil))) {
    return { tab, c0: colIdx(m[1]), r0: +m[2] - 1, c1: m[3] ? colIdx(m[3]) : colIdx(m[1]), r1: m[3] ? (m[4] ? +m[4] - 1 : null) : +m[2] - 1 };
  }
  return { tab, r0: 0, r1: null, c0: 0, c1: null };
}
function lesen(range) {
  const b = bereich(range);
  const z = tabs[b.tab];
  const bis = b.r1 ?? z.length - 1;
  const out = [];
  for (let r = b.r0; r <= bis; r++) out.push((z[r] ?? []).slice(b.c0, b.c1 == null ? undefined : b.c1 + 1));
  while (out.length && !out.at(-1).some(c => String(c ?? '') !== '')) out.pop();
  return out;
}
function schreiben(range, werte) {
  const b = bereich(range);
  werte.forEach((row, i) => {
    const z = b.r0 + i;
    while (tabs[b.tab].length <= z) tabs[b.tab].push([]);
    row.forEach((v, j) => { tabs[b.tab][z][b.c0 + j] = v; delete (formate[b.tab] ?? {})[`${z},${b.c0 + j}`]; });
  });
}
const values = {
  get: jest.fn(async ({ range }) => ({ data: { values: lesen(range).map(r => [...r]) } })),
  batchGet: jest.fn(async ({ ranges }) => ({ data: { valueRanges: ranges.map(r => {
    const b = bereich(r);
    return { values: [tabs[b.tab].slice(1).map(z => (z[b.c0] === undefined ? '' : String(z[b.c0])))] };
  }) } })),
  update: jest.fn(async ({ range, requestBody, valueInputOption }) => {
    calls.push({ art: 'update', range, valueInputOption });
    schreiben(range, requestBody.values);
    return { data: {} };
  }),
  batchUpdate: jest.fn(async ({ requestBody }) => {
    calls.push({ art: 'vbatch', ranges: requestBody.data.map(d => d.range) });
    for (const d of requestBody.data) schreiben(d.range, d.values);
    return { data: {} };
  }),
  clear: jest.fn(async ({ range }) => {
    calls.push({ art: 'clear', range });
    const b = bereich(range);
    tabs[b.tab].length = Math.min(tabs[b.tab].length, b.r0);
    return { data: {} };
  }),
  append: jest.fn(async () => { calls.push({ art: 'append' }); return { data: {} }; }),
};
const spreadsheets = {
  values,
  get: jest.fn(async ({ ranges, includeGridData }) => {
    if (includeGridData) {
      return { data: { sheets: [{ data: ranges.map(r => {
        const [, tab, sp, nr] = /^'?([^'!]+)'?!([A-Z]+)(\d+)$/.exec(r);
        const typ = formate[tab]?.[`${Number(nr) - 1},${colIdx(sp)}`];
        return { rowData: [{ values: [typ ? { userEnteredFormat: { numberFormat: { type: typ } } } : {}] }] };
      }) }] } };
    }
    return { data: { sheets: Object.keys(tabs).map(title => ({ properties: { title, sheetId: (ids[title] ??= 100 + Object.keys(ids).length), gridProperties: { rowCount: 1000, columnCount: 26 } } })) } };
  }),
  batchUpdate: jest.fn(async ({ requestBody }) => {
    calls.push({ art: 'batchUpdate', requests: requestBody.requests });
    const replies = requestBody.requests.map(r => {
      if (r.repeatCell) {
        const { sheetId, startRowIndex, startColumnIndex } = r.repeatCell.range;
        const tab = Object.keys(ids).find(k => ids[k] === sheetId);
        formate[tab] ??= {};
        for (let z = startRowIndex; z < tabs[tab].length + 100; z++)
          formate[tab][`${z},${startColumnIndex}`] = r.repeatCell.cell.userEnteredFormat.numberFormat.type;
      }
      if (!r.addSheet) return {};
      tabs[r.addSheet.properties.title] = [];
      ids[r.addSheet.properties.title] = 999;
      return { addSheet: { properties: { ...r.addSheet.properties, sheetId: 999 } } };
    });
    return { data: { replies } };
  }),
};
const sheets = { spreadsheets };

// ── Drive (Stammdatei) und WC ──────────────────────────────────────────────
let csvText, streamAufrufe;
const drive = { files: {
  list: jest.fn(async () => ({ data: { files: [{ id: 'f-neu', name: 'DE_Standard_DE_EUR_07.09.2026.csv', size: '200', modifiedTime: '2026-09-26T09:52:31Z' }] } })),
  get: jest.fn(async () => {
    streamAufrufe++;
    const buf = Buffer.from(csvText, 'utf8');
    const teile = [];
    for (let i = 0; i < buf.length; i += 11) teile.push(buf.subarray(i, i + 11));
    return { data: Readable.from(teile) };
  }),
} };
const wcFuer = shop => ({ get: jest.fn(async (_p, params) => ({ data: params.page > 1 ? [] : (shop === 'jfn' ? [{ sku: 'E3000/Shirt' }] : []) })) });

const chat = [];
jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => sheets, drive: () => drive } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({ getWcClient: s => wcFuer(s === 'honk' ? 'honk' : 'jfn') }));
// Ohne Webhook-Adresse sendet notify() nicht (Ergebnis "fehlgeschlagen"); der Text wird in den
// Bibliothekstests ueber eine eigene notify-Funktion geprueft.
jest.unstable_mockModule('../utils/secrets.js', () => ({ SECRET_KEYS: [], getSecret: jest.fn(async () => ''), loadAllSecrets: jest.fn() }));

process.env.GOOGLE_SHEET_ID = 'ssot';
process.env.BUSINESS_SHEET_ID = 'business';
process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = 'drive-1';

const ls = await import('../lib/lshopStammdaten.js');
const lm = await import('../lib/lshopModelle.js');
const u = await import('../utils/lshop-modelle.js');
const { _resetLShopCache } = await import('../lib/lshop.js');
const { buildLShopModelleNachricht } = await import('../lib/chatNotify.js');

// ── Stammdatei-Fixture (erfundene Werte) ────────────────────────────────────
const CSV_KOPF = ['ArticleNr', 'CatalogNr', '10CartonsPrice', 'color1', 'color2', 'color3', 'color4', 'Size', 'Brand', 'Discontinued',
  'CatNrManufacturer', 'EAN', 'Description', 'Consistence', 'Grammage', 'QtyCarton'];
const PREISE = ['4,25', '7,77', '9,13', '3,33', '6,66'];
const z = (nr, cat, o = {}) => ({ ArticleNr: nr, CatalogNr: cat, '10CartonsPrice': '4,25', color1: 'Black', Size: 'M', Brand: 'Marke', Discontinued: '0', CatNrManufacturer: cat, EAN: '', Description: `${cat} Name`, Consistence: '100% Baumwolle', Grammage: '180 g/m²', QtyCarton: '10', ...o });
const DATEI = [
  z('1000000001', 'E3000', { CatNrManufacturer: '3000/3099', Description: 'Men´s Premium-T' }),
  z('1000000002', 'E3000', { Size: 'L', CatNrManufacturer: '3000/3099', Description: 'Men´s Premium-T' }),
  z('1000000011', 'BCTU03T', { CatNrManufacturer: 'TU03T', Description: 'Unisex Tee', '10CartonsPrice': '7,77' }),
  z('1000000012', 'BCTU03T', { CatNrManufacturer: 'TU03T', Description: 'Unisex Tee', color1: 'White', Discontinued: '1', '10CartonsPrice': '7,77' }),
  z('1000000021', 'BY289', { Description: 'Ladies Fluffy Hoody', '10CartonsPrice': '9,13' }),
  z('1000000022', 'BY289', { Description: 'Ladies Fluffy Hoody', Size: '5XL', '10CartonsPrice': '9,13' }),
  z('1000000031', 'BY284', { Description: 'Fluffy Hoody', '10CartonsPrice': '9,13' }),
  z('1000000041', 'AB0100', { CatNrManufacturer: '0100', Description: 'Cap A', '10CartonsPrice': '3,33' }),
  z('1000000042', 'CD0100', { CatNrManufacturer: '0100', Description: 'Cap B', '10CartonsPrice': '3,33' }),
  z('1000000051', 'XT903', { Description: 'Bag', Discontinued: '6', '10CartonsPrice': '6,66' }),
];
const baueCsv = zeilen => '﻿' + [CSV_KOPF.join(';'), ...zeilen.map(o => CSV_KOPF.map(n => o[n] ?? '').join(';'))].join('\r\n') + '\r\n';
const JETZT = new Date('2026-10-28T10:00:00Z');
const deps = { sheets, drive, wcFuer, jetzt: JETZT };
const schreibAufrufe = () => calls.filter(c => ['update', 'clear', 'append', 'batchUpdate', 'vbatch'].includes(c.art));
const zeilenVon = tab => { const [k, ...r] = tabs[tab]; return r.filter(x => x.some(c => String(c ?? '') !== '')).map(x => Object.fromEntries(k.map((n, i) => [n, x[i] ?? '']))); };
const modelleIn = () => [...new Set(zeilenVon('LShop_Modelle').map(r => r.CatalogNr))].sort();

async function basis() {
  tabs = {
    Partner_Artikel: [['Partner-ID', 'Artikelnummer']],
    Varianten: [['SSOT-ID', 'LShop_ArticleNr']],
    Erfassungsmaske: [['ID', 'L-Shop-Artikelnummer']],
    Modelle_Zusatz: [['CatalogNr', 'Notiz', 'Eingetragen', 'Status'], ['BY284', 'alt', '2026-10-01', 'zurückgezogen']],
  };
  calls = []; formate = {}; ids = {}; streamAufrufe = 0; chat.length = 0;
  csvText = baueCsv(DATEI);
  _resetLShopCache();
  // Ausgangsstand wie im echten Sheet: LShop_Modelle mit E3000 (aus dem Shop).
  await ls.stammdatenLauf({ modus: 'uebernehmen', datei: 'DE_Standard_DE_EUR_07.09.2026.csv', ...deps });
  calls = []; streamAufrufe = 0;
  _resetLShopCache();
}
beforeEach(basis);

// ── Reine Logik ─────────────────────────────────────────────────────────────
describe('utils/lshop-modelle', () => {
  test('Eingabe: Nummer (mit Ziffer, ohne Leerzeichen) oder Name (ab 3 Zeichen)', () => {
    expect(u.eingabeArt(' by289 ')).toEqual({ text: 'by289', wert: 'BY289', art: 'nummer' });
    expect(u.eingabeArt('3005').art).toBe('nummer');
    expect(u.eingabeArt('Fluffy').art).toBe('name');
    expect(u.eingabeArt('Ladies  Fluffy').text).toBe('Ladies Fluffy');
    expect(u.eingabeArt('ab').art).toBe('leer');
    expect(u.eingabeArt('').art).toBe('leer');
  });

  test('Treffer: exakt, Hersteller-Nummer (auch "3000/3099"), endet auf, Name', () => {
    const e = s => u.eingabeArt(s);
    expect(u.trefferArt(e('BCTU03T'), { catalogNr: 'BCTU03T', hersteller: 'TU03T' })).toBe('exakt');
    expect(u.trefferArt(e('TU03T'), { catalogNr: 'BCTU03T', hersteller: 'TU03T' })).toBe('hersteller');
    expect(u.trefferArt(e('3099'), { catalogNr: 'E3000', hersteller: '3000/3099' })).toBe('hersteller');
    expect(u.trefferArt(e('3000'), { catalogNr: 'E3000', hersteller: '3000/3099' })).toBe('hersteller');
    expect(u.trefferArt(e('3005'), { catalogNr: 'SN003005', hersteller: 'X' })).toBe('endet');
    expect(u.trefferArt(e('Fluffy'), { catalogNr: 'BY289', name: 'Ladies Fluffy Hoody' })).toBe('name');
    expect(u.trefferArt(e('Fluffy'), { catalogNr: 'BY289', name: 'Hoodie' })).toBeNull();
    expect(u.trefferArt(e('BY2'), { catalogNr: 'BY289', hersteller: 'BY289' })).toBeNull();
  });

  test('Suche: exakt gewinnt, sonst Vorschlaege nach Rang (nie still uebernommen), sonst nicht', () => {
    expect(u.bewerteSuche(new Map([['E3000', 'endet'], ['BY289', 'exakt']]))).toEqual({ stufe: 'gefunden', catalogNr: 'BY289' });
    const v = u.bewerteSuche(new Map([['ZZ9', 'name'], ['E3005', 'endet'], ['BCTU03T', 'hersteller']]));
    expect(v.stufe).toBe('vorschlag');
    expect(v.vorschlaege.map(x => x.catalogNr)).toEqual(['BCTU03T', 'E3005', 'ZZ9']);
    const viele = new Map(Array.from({ length: 12 }, (_, i) => [`M${i}`, 'name']));
    expect(u.bewerteSuche(viele)).toMatchObject({ mehr: true });
    expect(u.bewerteSuche(viele).vorschlaege).toHaveLength(u.MAX_VORSCHLAEGE);
    expect(u.bewerteSuche(new Map())).toEqual({ stufe: 'nicht' });
  });

  test('Ampel: da / liste / zurueckgezogen / suchen', () => {
    const o = { bestandModelle: new Set(['E3000']), zusatz: [{ catalogNr: 'BY289', status: '' }, { catalogNr: 'BY284', status: 'zurückgezogen' }] };
    expect(u.ampelStufe(u.eingabeArt('e3000'), o)).toBe('da');
    expect(u.ampelStufe(u.eingabeArt('BY289'), o)).toBe('liste');
    expect(u.ampelStufe(u.eingabeArt('BY284'), o)).toBe('zurueckgezogen');
    expect(u.ampelStufe(u.eingabeArt('XY123'), o)).toBe('suchen');
    expect(u.ampelStufe(u.eingabeArt('Fluffy'), o)).toBe('suchen');
  });

  test('Fremdaenderungen: nur neue Zeilen der neuen Modelle sind erlaubt', () => {
    const lauf = (z, neuJeModell = {}) => ({ zeilen: { geaendert: 0, ausgelaufen: 0, reaktiviert: 0, nameErgaenzt: 0, ...z }, neuJeModell });
    expect(u.fremdAenderungen(lauf({}, { BY289: 2 }), ['by289'])).toEqual([]);
    expect(u.fremdAenderungen(lauf({ geaendert: 3 }), ['BY289']).join()).toMatch(/3 bestehende Zeile/);
    expect(u.fremdAenderungen(lauf({ ausgelaufen: 1 }), []).join()).toMatch(/auslaufen/);
    expect(u.fremdAenderungen(lauf({ nameErgaenzt: 5 }), []).join()).toMatch(/Artikelname/);
    expect(u.fremdAenderungen(lauf({}, { BY289: 2, JH001: 4 }), ['BY289']).join()).toMatch(/neue Zeilen auch für JH001/);
  });

  test('Notiz: einzeilig, max. 80, kein fuehrendes "="', () => {
    expect(u.bereinigeNotiz(' =SUMME(A1)\nfür  Verein ')).toBe('SUMME(A1) für Verein');
    expect([...u.bereinigeNotiz('x'.repeat(200))]).toHaveLength(80);
  });

  test('Zusatz-Plan: neu, wieder aktiv (zurueckgezogen), schon auf der Liste, Doppelte einmal', () => {
    const { zeilen } = u.zusatzZeilen([['CatalogNr', 'Notiz', 'Eingetragen', 'Status'], ['BY289', '', '', ''], ['BY284', 'alt', '2026-10-01', 'zurückgezogen']]);
    const p = u.zusatzPlan(zeilen, [{ catalogNr: 'by289' }, { catalogNr: 'BY284', notiz: 'neu' }, { catalogNr: 'E3005' }, { catalogNr: 'E3005' }]);
    expect(p.vorhanden).toEqual(['BY289']);
    expect(p.reaktivieren.map(r => [r.catalogNr, r.zeile, r.notizNeu])).toEqual([['BY284', 3, 'neu']]);
    expect(p.neu).toEqual([{ catalogNr: 'E3005', notiz: '' }]);
    expect(u.zusatzZeileWerte(['CatalogNr', 'Status', 'Eingetragen', 'Notiz', 'X'], { catalogNr: 'e3005', notiz: 'n', eingetragen: '2026-10-28' }))
      .toEqual(['E3005', '', '2026-10-28', 'n', '']);
    expect(u.fehlendeZusatzSpalten(['CatalogNr', 'Notiz'])).toEqual(['Eingetragen', 'Status']);
  });
});

// ── Ampel, Pruefen ──────────────────────────────────────────────────────────
describe('Ampel und Pruefen', () => {
  test('Ausgangsstand: nur E3000 in LShop_Modelle, BY284 zurueckgezogen zaehlt nicht', () => {
    expect(modelleIn()).toEqual(['E3000']);
  });

  test('Ampel nur aus den Sheets (kein Datei-Abruf, nichts geschrieben)', async () => {
    const r = await lm.modelleAmpel({ eingaben: ['e3000', 'BY289', 'BY284', 'Fluffy', 'TU03T'], sheets });
    expect(r.ergebnisse.map(e => e.stufe)).toEqual(['da', 'suchen', 'zurueckgezogen', 'suchen', 'suchen']);
    expect(r.ergebnisse[0].vorschau).toMatchObject({ catalogNr: 'E3000', groessen: ['M', 'L'] });
    expect(streamAufrufe).toBe(0);
    expect(schreibAufrufe()).toEqual([]);
  });

  test('Pruefen: gefunden mit Vorschau, Schreibweisen als Vorschlag, Mehrfachtreffer = Auswahl, nicht gefunden', async () => {
    const r = await lm.modellePruefen({ eingaben: ['E3000', 'BY289', 'TU03T', 'Fluffy', '0100', 'ZZ1'], ...deps });
    const s = Object.fromEntries(r.ergebnisse.map(e => [e.eingabe, e]));
    expect(s.E3000).toMatchObject({ stufe: 'da', catalogNr: 'E3000' });
    expect(s.BY289).toMatchObject({ stufe: 'gefunden', catalogNr: 'BY289', vorschau: { name: 'Ladies Fluffy Hoody', marke: 'Marke', farben: ['Black'], groessen: ['M', '5XL'] } });
    expect(s.TU03T.stufe).toBe('vorschlag');
    expect(s.TU03T.vorschlaege.map(v => [v.catalogNr, v.weg])).toEqual([['BCTU03T', 'hersteller']]);
    expect(s.TU03T.vorschlaege[0].vorschau.auslaufend).toEqual(['White']);
    expect(s.Fluffy.vorschlaege.map(v => v.catalogNr)).toEqual(['BY284', 'BY289']);
    expect(s['0100'].vorschlaege.map(v => v.catalogNr)).toEqual(['AB0100', 'CD0100']);
    expect(s.ZZ1).toEqual({ eingabe: 'ZZ1', modell: 'ZZ1', art: 'nummer', stufe: 'nicht' });
    expect(r.datei).toEqual({ name: 'DE_Standard_DE_EUR_07.09.2026.csv', datum: '07.09.2026' });
    expect(r.darfUebernehmen).toBe(true);
    expect(r.fremd).toEqual([]);
    expect(streamAufrufe).toBe(1);
    expect(schreibAufrufe()).toEqual([]);
    const text = JSON.stringify(r);
    for (const p of PREISE) expect(text).not.toContain(p);
    expect(text).not.toMatch(/10CartonsPrice|EAN/);
  });

  test('Tippfehler: aehnliche Nummer aus dem Stammdaten-Lauf als Vorschlag ("BY289X" -> BY289)', async () => {
    const r = await lm.modellePruefen({ eingaben: ['BY289X'], ...deps });
    expect(r.ergebnisse[0]).toMatchObject({ stufe: 'vorschlag', vorschlaege: [{ catalogNr: 'BY289', weg: 'aehnlich', schonDa: false }] });
  });

  test('Fremdaenderung (Preis in der Datei geaendert) -> Pruefen meldet, Uebernehmen 409, nichts geschrieben', async () => {
    csvText = baueCsv(DATEI.map(x => (x.CatalogNr === 'E3000' ? { ...x, '10CartonsPrice': '5,55' } : x)));
    const r = await lm.modellePruefen({ eingaben: ['BY289'], ...deps });
    expect(r.darfUebernehmen).toBe(false);
    expect(r.fremd.join()).toMatch(/2 bestehende Zeile\(n\) würden geändert/);
    calls = [];
    await expect(lm.modelleUebernehmen({ auswahl: [{ catalogNr: 'BY289' }], datei: r.datei.name, ...deps }))
      .rejects.toMatchObject({ status: 409, code: 'fremdaenderungen' });
    expect(schreibAufrufe()).toEqual([]);
    expect(zeilenVon('Modelle_Zusatz').map(x => x.CatalogNr)).toEqual(['BY284']);
  });
});

// ── Uebernehmen, Zurueckziehen ──────────────────────────────────────────────
describe('Uebernehmen', () => {
  const ue = (auswahl, o = {}) => lm.modelleUebernehmen({ auswahl, datei: 'DE_Standard_DE_EUR_07.09.2026.csv', ...deps, ...o });

  test('neue Modelle: LShop_Modelle + Modelle_Zusatz (ohne append, zurueckgelesen), Chat ohne Preise', async () => {
    const r = await ue([{ catalogNr: 'by289', notiz: 'Verein X' }, { catalogNr: 'BCTU03T' }],
      { notify: async t => { chat.push(t); return true; }, baueMeldung: buildLShopModelleNachricht });
    expect(r).toMatchObject({ ok: true, modelle: ['BY289', 'BCTU03T'], zeilenNeu: 4, rueckgelesen: true, chat: 'gesendet', zusatz: { neu: ['BY289', 'BCTU03T'] } });
    expect(modelleIn()).toEqual(['BCTU03T', 'BY289', 'E3000']);
    const zus = zeilenVon('Modelle_Zusatz');
    expect(zus.map(x => [x.CatalogNr, x.Notiz, x.Eingetragen, x.Status])).toEqual([
      ['BY284', 'alt', '2026-10-01', 'zurückgezogen'], ['BY289', 'Verein X', '2026-10-28', ''], ['BCTU03T', '', '2026-10-28', ''],
    ]);
    expect(calls.some(c => c.art === 'append')).toBe(false);
    expect(chat.join('\n')).toMatch(/Neue L-Shop-Modelle aufgenommen: BY289, BCTU03T/);
    for (const p of PREISE) expect(chat.join('\n')).not.toContain(p);
    // zweites Mal: nichts mehr zu tun
    await expect(ue([{ catalogNr: 'BY289' }])).rejects.toMatchObject({ status: 409, code: 'schon_da' });
  });

  test('zurueckgezogenes Modell wird wieder aktiv (keine zweite Zeile)', async () => {
    const r = await ue([{ catalogNr: 'BY284', notiz: 'doch' }]);
    expect(r.zusatz).toMatchObject({ neu: [], wiederAktiv: ['BY284'] });
    expect(zeilenVon('Modelle_Zusatz').map(x => [x.CatalogNr, x.Notiz, x.Eingetragen, x.Status])).toEqual([['BY284', 'doch', '2026-10-28', '']]);
    expect(modelleIn()).toContain('BY284');
  });

  test('Modell nicht in der Stammdatei -> 409, nichts geschrieben', async () => {
    await expect(ue([{ catalogNr: 'ZZ123' }])).rejects.toMatchObject({ status: 409, code: 'nicht_gefunden' });
    expect(schreibAufrufe()).toEqual([]);
  });

  test('keine L-Shop-Modellnummer (vom Stammdaten-Lauf nicht erkannt) -> 400, nichts gelesen/geschrieben', async () => {
    await expect(ue([{ catalogNr: 'ZZ1' }])).rejects.toMatchObject({ status: 400 });
    await expect(ue([{ catalogNr: 'Fluffy' }])).rejects.toMatchObject({ status: 400 });
    expect(streamAufrufe).toBe(0);
    expect(schreibAufrufe()).toEqual([]);
  });

  test('Einrichtung fehlt (nur CatalogNr) -> 409, nichts geschrieben', async () => {
    tabs.Modelle_Zusatz = [['CatalogNr'], ['BY284']];
    await expect(ue([{ catalogNr: 'BY289' }])).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(schreibAufrufe()).toEqual([]);
  });

  test('andere Datei als bei der Pruefung -> 409', async () => {
    await expect(ue([{ catalogNr: 'BY289' }], { datei: 'DE_Standard_DE_EUR_01.08.2026.csv' })).rejects.toMatchObject({ status: 409 });
    expect(schreibAufrufe()).toEqual([]);
  });

  test('Zurueckziehen: Status gesetzt, nichts geloescht; LS1 zaehlt die Zeile nicht mehr als gebraucht', async () => {
    await ue([{ catalogNr: 'BY289' }]);
    const r = await lm.modellZurueckziehen({ catalogNr: 'by289', sheets });
    expect(r).toEqual({ ok: true, catalogNr: 'BY289', zeilen: 1 });
    expect(zeilenVon('Modelle_Zusatz').find(x => x.CatalogNr === 'BY289').Status).toBe('zurückgezogen');
    const q = await ls.sammleQuellen({ sheets, wcFuer, ssotId: 'ssot', businessId: 'business' });
    expect(q.quellen.Modelle_Zusatz).toEqual([]);
    expect(modelleIn()).toContain('BY289');                     // LShop_Modelle bleibt (Inhaber 28.10.)
    await expect(lm.modellZurueckziehen({ catalogNr: 'BY289', sheets })).rejects.toMatchObject({ status: 404 });
  });

  test('Liste: neueste zuerst, Status und ob in LShop_Modelle', async () => {
    await ue([{ catalogNr: 'BY289', notiz: 'n' }]);
    const l = await lm.zusatzListe({ sheets });
    expect(l.einrichtung).toEqual([]);
    expect(l.eintraege).toEqual([
      { catalogNr: 'BY289', notiz: 'n', eingetragen: '2026-10-28', status: 'aktiv', inBestand: true },
      { catalogNr: 'BY284', notiz: 'alt', eingetragen: '2026-10-01', status: 'zurückgezogen', inBestand: false },
    ]);
  });
});

// ── Sperre ──────────────────────────────────────────────────────────────────
describe('Sperre (eine Stammdaten-Lauf je Instanz)', () => {
  test('zweiter Lauf waehrenddessen -> 409 "laeuft gerade", danach wieder frei', async () => {
    let freigeben;
    const erster = ls.mitStammdatenSperre('Test', () => new Promise(r => { freigeben = r; }));
    await expect(lm.modellePruefen({ eingaben: ['BY289'], ...deps })).rejects.toMatchObject({ status: 409, code: 'laeuft_gerade' });
    await expect(ls.mitStammdatenSperre('Zweiter', async () => 1)).rejects.toMatchObject({ status: 409 });
    freigeben('ok');
    await expect(erster).resolves.toBe('ok');
    await expect(ls.mitStammdatenSperre('Danach', async () => 2)).resolves.toBe(2);
  });

  test('Fehler im Lauf gibt die Sperre wieder frei', async () => {
    await expect(ls.mitStammdatenSperre('kaputt', async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(ls.mitStammdatenSperre('danach', async () => 3)).resolves.toBe(3);
  });
});

// ── Routen ──────────────────────────────────────────────────────────────────
describe('Routen /api/lshop/modelle', () => {
  let app, request;
  beforeAll(async () => {
    ({ default: request } = await import('supertest'));
    const { default: express } = await import('express');
    const { default: router } = await import('../routes/lshop.js');
    app = express();
    app.use(express.json());
    app.use('/api/lshop', router);
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  });

  test('ampel + pruefen 200, Log ohne Preise und ohne Notiz', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect((await request(app).post('/api/lshop/modelle/ampel').send({ eingaben: ['BY289'] })).body.ergebnisse[0].stufe).toBe('suchen');
    const res = await request(app).post('/api/lshop/modelle/pruefen').send({ eingaben: ['BY289', 'TU03T'] });
    expect(res.status).toBe(200);
    const ausgabe = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(ausgabe).toMatch(/L-Shop-Modelle pruefen DE_Standard_DE_EUR_07\.09\.2026\.csv: eingaben=2 gefunden=1 vorschlag=1/);
    for (const p of PREISE) expect(ausgabe + JSON.stringify(res.body)).not.toContain(p);
  });

  test('leere Eingabe 400, zu viele 400', async () => {
    expect((await request(app).post('/api/lshop/modelle/pruefen').send({ eingaben: [] })).status).toBe(400);
    expect((await request(app).post('/api/lshop/modelle/ampel').send({ eingaben: Array(31).fill('E3000') })).status).toBe(400);
  });

  test('/stammdaten laeuft unter derselben Sperre', async () => {
    let freigeben;
    const lauf = ls.mitStammdatenSperre('Test', () => new Promise(r => { freigeben = r; }));
    const res = await request(app).post('/api/lshop/stammdaten').send({ modus: 'trockenlauf' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/läuft gerade/);
    freigeben();
    await lauf;
  });

  test('uebernehmen + liste + zurueckziehen', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const u1 = await request(app).post('/api/lshop/modelle/uebernehmen').send({ auswahl: [{ catalogNr: 'BY289', notiz: 'geheim' }], datei: 'DE_Standard_DE_EUR_07.09.2026.csv' });
    expect(u1.status).toBe(200);
    expect(['gesendet', 'fehlgeschlagen']).toContain(u1.body.chat);
    expect((await request(app).get('/api/lshop/modelle/liste')).body.eintraege[0].catalogNr).toBe('BY289');
    expect((await request(app).post('/api/lshop/modelle/zurueckziehen').send({ catalogNr: 'BY289' })).status).toBe(200);
    const ausgabe = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(ausgabe).toMatch(/uebernommen .*BY289/);
    expect(ausgabe).not.toContain('geheim');
  });
});
