// QU1: ein Weg fuer alle Sheets-Zugriffe - zaehlen, Zwischenspeicher je Reiter, Buendeln, 429-Wiederholung.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { google } from 'googleapis';
import {
  umhuelleSheets, mitSheetsKontext, frischLesen, imWiederholRahmen, _zuruecksetzen, _zaehlerStand, logMinute,
  reiterAus, ursprungAus, cacheErlaubt, ttlFuer, kontingentAus, AUSGELASTET_TEXT, AUSGELASTET_CODE, TTL_STANDARD_MS,
} from '../lib/sheetsZentral.js';
import { mitWiederholung } from '../lib/googleRetry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const quelle = p => readFileSync(resolve(__dirname, '..', p), 'utf8');

const ID = 'tabelle-1';
const LESEN = { ursprung: 'GET /api/test', cache: true };

/** Attrappe eines googleapis-Sheets-Clients: zaehlt echte Aufrufe, liefert je Reiter Werte. */
function attrappe({ verzoegerung = 0, fehlerFolge = [] } = {}) {
  const aufrufe = [];
  const daten = new Map([['A', [['k'], ['1']]], ['B', [['k'], ['2']]], ['Config', [['k'], ['c']]]]);
  const folge = [...fehlerFolge];
  const warte = () => (verzoegerung ? new Promise(r => setTimeout(r, verzoegerung)) : Promise.resolve());
  const naechsterFehler = () => {
    const st = folge.shift();
    if (!st) return null;
    return Object.assign(new Error("Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user' of service 'sheets.googleapis.com'"),
      { response: { status: st, data: { error: { message: 'x', details: [{ metadata: { quota_limit: 'ReadRequestsPerMinutePerUser' } }] } } }, status: st, code: st });
  };
  const values = {
    async get(p) { aufrufe.push(['get', p.range]); await warte(); const f = naechsterFehler(); if (f) throw f; return { data: { values: structuredClone(daten.get(reiterAus(p.range)) ?? []) } }; },
    async batchGet(p) { aufrufe.push(['batchGet', p.ranges.join(',')]); await warte(); const f = naechsterFehler(); if (f) throw f;
      return { data: { valueRanges: p.ranges.map(r => ({ values: structuredClone(daten.get(reiterAus(r)) ?? []) })) } }; },
    async update(p) { aufrufe.push(['update', p.range]); await warte(); daten.set(reiterAus(p.range), [['k'], ['neu']]); return { data: {} }; },
    async batchUpdate(p) { aufrufe.push(['batchUpdate']); await warte(); for (const d of p.requestBody.data) daten.set(reiterAus(d.range), [['k'], ['neu']]); return { data: {} }; },
    async append(p) { aufrufe.push(['append', p.range]); return { data: {} }; },
  };
  const spreadsheets = {
    values,
    async get() { aufrufe.push(['spreadsheets.get']); return { data: { sheets: [] } }; },
    async batchUpdate() { aufrufe.push(['spreadsheets.batchUpdate']); return { data: {} }; },
  };
  return { client: { spreadsheets }, aufrufe, daten };
}

let jetzt;
let logs;
beforeEach(() => {
  jetzt = Date.parse('2026-11-23T09:00:05Z');
  logs = [];
  _zuruecksetzen({ log: z => logs.push(z), jetzt: () => jetzt, sleep: async () => {} });
  delete process.env.SHEETS_CACHE_MS;
});

const lies = (s, range) => s.spreadsheets.values.get({ spreadsheetId: ID, range });

describe('Kontext', () => {
  test('Ursprung ohne Daten: Pfadteile mit Ziffern werden :x, Query faellt weg', () => {
    expect(ursprungAus('get', '/api/auftraege/kunden/K-00012/historie?x=1')).toBe('GET /api/auftraege/kunden/:x/historie');
    expect(ursprungAus('POST', '/api/intern/lshop-korb/abgleich')).toBe('POST /api/intern/lshop-korb/abgleich');
  });
  test('Zwischenspeicher nur GET und die lesenden POST-Routen', () => {
    expect(cacheErlaubt('GET', '/api/dashboard')).toBe(true);
    expect(cacheErlaubt('POST', '/api/bestellen/produktion/stand?shop=JFN')).toBe(true);
    expect(cacheErlaubt('POST', '/api/mika/frage')).toBe(true);
    expect(cacheErlaubt('POST', '/api/auftraege/neu')).toBe(false);
    expect(cacheErlaubt('POST', '/api/intern/lshop-korb/abgleich')).toBe(false);
    expect(cacheErlaubt('PUT', '/api/sheets/x')).toBe(false);
  });
  test('Reiter aus Bereichen', () => {
    expect(reiterAus("'Auftrag Positionen'!A1:ZZ")).toBe('Auftrag Positionen');
    expect(reiterAus('Kunden!A:Z')).toBe('Kunden');
    expect(reiterAus('Kunden')).toBe('Kunden');
    expect(reiterAus('A1:Z')).toBe('*');
    expect(reiterAus("'It''s'!A1")).toBe("It's");
  });
  test('TTL je Reiter, Umgebung schaltet ab', () => {
    expect(ttlFuer(['A'])).toBe(TTL_STANDARD_MS);
    expect(ttlFuer(['Config'])).toBe(60_000);
    expect(ttlFuer(['Config', 'A'])).toBe(TTL_STANDARD_MS);
    process.env.SHEETS_CACHE_MS = '0';
    expect(ttlFuer(['A'])).toBe(0);
  });
});

describe('Zwischenspeicher', () => {
  test('Treffer: zweite gleiche Lesung kommt aus dem Speicher, als unabhaengige Kopie', async () => {
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, async () => {
      const r1 = await lies(s, 'A!A1:ZZ');
      r1.data.values[1]._sheetRow = 5;   // readTab haengt Felder an
      r1.data.values.push(['x']);
      const r2 = await lies(s, 'A!A1:ZZ');
      expect(r2.data.values).toEqual([['k'], ['1']]);
    });
    expect(aufrufe).toHaveLength(1);
    expect(_zaehlerStand()).toMatchObject({ google_lesen: 1, cache: 1 });
  });

  test('Ablauf nach der TTL; Config laenger', async () => {
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, async () => {
      await lies(s, 'A!A1:ZZ'); await lies(s, 'Config!A1:ZZ');
      jetzt += TTL_STANDARD_MS + 1;
      await lies(s, 'A!A1:ZZ'); await lies(s, 'Config!A1:ZZ');
    });
    expect(aufrufe.map(a => a[1])).toEqual(['A!A1:ZZ', 'Config!A1:ZZ', 'A!A1:ZZ']);
  });

  test('Schreiben in einen Reiter macht genau dessen Eintraege ungueltig', async () => {
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, async () => {
      await lies(s, 'A!A1:ZZ'); await lies(s, 'B!A1:ZZ');
      await s.spreadsheets.values.batchGet({ spreadsheetId: ID, ranges: ['A!A1:ZZ', 'Config!A1:ZZ'] });
    });
    await frischLesen(() => s.spreadsheets.values.update({ spreadsheetId: ID, range: 'B!A2', requestBody: { values: [['neu']] } }));
    let r;
    await mitSheetsKontext(LESEN, async () => {
      await lies(s, 'A!A1:ZZ');                                  // Speicher
      r = await lies(s, 'B!A1:ZZ');                              // neu gelesen
      await s.spreadsheets.values.batchGet({ spreadsheetId: ID, ranges: ['A!A1:ZZ', 'Config!A1:ZZ'] });   // Speicher
    });
    expect(r.data.values[1]).toEqual(['neu']);
    expect(aufrufe.filter(a => a[0] !== 'update').map(a => a[1])).toEqual(['A!A1:ZZ', 'B!A1:ZZ', 'A!A1:ZZ,Config!A1:ZZ', 'B!A1:ZZ']);
  });

  test('batchUpdate ueber mehrere Reiter, Struktur-Aenderung und andere Tabelle', async () => {
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    const alle = () => mitSheetsKontext(LESEN, async () => {
      await s.spreadsheets.values.batchGet({ spreadsheetId: ID, ranges: ['A!A1:ZZ', 'Config!A1:ZZ'] });
      await lies(s, 'B!A1:ZZ');
    });
    await alle();
    await s.spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { data: [{ range: 'Config!B2', values: [[1]] }] } });
    await alle();   // batchGet neu, B aus dem Speicher
    expect(aufrufe.filter(a => a[0] === 'batchGet')).toHaveLength(2);
    expect(aufrufe.filter(a => a[0] === 'get')).toHaveLength(1);
    await s.spreadsheets.values.update({ spreadsheetId: 'andere', range: 'B!A1', requestBody: {} });
    await alle();   // andere Tabelle: nichts ungueltig
    expect(aufrufe.filter(a => ['get', 'batchGet'].includes(a[0]))).toHaveLength(3);
    await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [] } });
    await alle();   // Struktur: alles neu
    expect(aufrufe.filter(a => ['get', 'batchGet'].includes(a[0]))).toHaveLength(5);
  });

  test('append und Bereich ohne Reiter: ganze Tabelle bzw. Reiter ungueltig', async () => {
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, () => lies(s, 'A1:Z'));
    await s.spreadsheets.values.append({ spreadsheetId: ID, range: 'B!A1', requestBody: {} });
    await mitSheetsKontext(LESEN, () => lies(s, 'A1:Z'));   // unbekannter Reiter: jede Schreibung zaehlt
    expect(aufrufe.filter(a => a[0] === 'get')).toHaveLength(2);
  });

  test('Eine Lesung, waehrend der geschrieben wird, wird nicht gespeichert', async () => {
    const { client, aufrufe } = attrappe({ verzoegerung: 20 });
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, async () => {
      const lesung = lies(s, 'A!A1:ZZ');
      await frischLesen(() => s.spreadsheets.values.update({ spreadsheetId: ID, range: 'A!A2', requestBody: {} }));
      await lesung;
      await lies(s, 'A!A1:ZZ');
    });
    expect(aufrufe.filter(a => a[0] === 'get')).toHaveLength(2);
  });

  test('Frisch: Schreib-Kontext, Sperre (frischLesen) und ohne Anfrage lesen immer bei Google', async () => {
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, () => lies(s, 'A!A1:ZZ'));
    await mitSheetsKontext(LESEN, () => frischLesen(() => lies(s, 'A!A1:ZZ')));
    await mitSheetsKontext({ ursprung: 'POST /api/auftraege/neu', cache: false }, () => lies(s, 'A!A1:ZZ'));
    await lies(s, 'A!A1:ZZ');
    expect(aufrufe).toHaveLength(4);
    expect(_zaehlerStand().cache).toBe(0);
  });

  test('SHEETS_CACHE_MS=0 schaltet den Speicher ab', async () => {
    process.env.SHEETS_CACHE_MS = '0';
    const { client, aufrufe } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext(LESEN, async () => { await lies(s, 'A!A1:ZZ'); await lies(s, 'A!A1:ZZ'); });
    expect(aufrufe).toHaveLength(2);
  });
});

describe('Buendeln', () => {
  test('gleichzeitige gleiche Lesungen teilen sich eine Anfrage, jede bekommt eine eigene Kopie', async () => {
    const { client, aufrufe } = attrappe({ verzoegerung: 20 });
    const s = umhuelleSheets(client);
    const [r1, r2, r3] = await Promise.all([
      mitSheetsKontext(LESEN, () => lies(s, 'A!A1:ZZ')),
      mitSheetsKontext({ ursprung: 'GET /api/anders', cache: true }, () => lies(s, 'A!A1:ZZ')),
      mitSheetsKontext(LESEN, () => lies(s, 'A!A1:ZZ')),
    ]);
    expect(aufrufe).toHaveLength(1);
    r1.data.values.push(['x']);
    expect(r2.data.values).toEqual([['k'], ['1']]);
    expect(r3.data.values).toEqual([['k'], ['1']]);
    expect(_zaehlerStand()).toMatchObject({ google_lesen: 1, gebuendelt: 2 });
  });

  test('frische Lesungen haengen sich nie an eine laufende an', async () => {
    const { client, aufrufe } = attrappe({ verzoegerung: 20 });
    const s = umhuelleSheets(client);
    await Promise.all([
      mitSheetsKontext(LESEN, () => lies(s, 'A!A1:ZZ')),
      frischLesen(() => lies(s, 'A!A1:ZZ')),
    ]);
    expect(aufrufe).toHaveLength(2);
  });
});

describe('429', () => {
  test('einmal nach Pause wiederholt, Kontingent-Name im Log', async () => {
    const { client, aufrufe } = attrappe({ fehlerFolge: [429] });
    const s = umhuelleSheets(client);
    const r = await mitSheetsKontext(LESEN, () => lies(s, 'A!A1:ZZ'));
    expect(r.data.values).toEqual([['k'], ['1']]);
    expect(aufrufe).toHaveLength(2);
    expect(_zaehlerStand()).toMatchObject({ google_lesen: 2, fehler_429: 1 });
    const q = logs.map(z => JSON.parse(z)).find(z => z.event === 'sheets_quota');
    expect(q).toEqual({ event: 'sheets_quota', methode: 'values.get', kontingent: 'ReadRequestsPerMinutePerUser', ursprung: 'GET /api/test', versuch: 1 });
  });

  test('bleibt es bei 429: freundlicher Text, Code, Status 429', async () => {
    const { client } = attrappe({ fehlerFolge: [429, 429] });
    const s = umhuelleSheets(client);
    const err = await mitSheetsKontext(LESEN, () => lies(s, 'A!A1:ZZ')).catch(e => e);
    expect(err.message).toBe(AUSGELASTET_TEXT);
    expect(err.code).toBe(AUSGELASTET_CODE);
    expect(err.status).toBe(429);
    expect(JSON.stringify(logs)).not.toMatch(/Quota exceeded|tabelle-1/);
  });

  test('andere Fehler und Schreiben werden hier nie wiederholt', async () => {
    const { client, aufrufe } = attrappe({ fehlerFolge: [500] });
    const s = umhuelleSheets(client);
    await expect(lies(s, 'A!A1:ZZ')).rejects.toThrow();
    expect(aufrufe).toHaveLength(1);
  });

  test('innerhalb von googleRetry keine zweite Wiederholung hier (googleRetry wiederholt selbst)', async () => {
    const { client, aufrufe } = attrappe({ fehlerFolge: [429] });
    const s = umhuelleSheets(client);
    const r = await mitWiederholung(() => lies(s, 'A!A1:ZZ'), { sleep: async () => {}, log: () => {} });
    expect(r.data.values).toEqual([['k'], ['1']]);
    expect(aufrufe).toHaveLength(2);   // 1 Fehler + 1 Wiederholung durch googleRetry, nicht 3
    await expect(imWiederholRahmen(() => umhuelleSheets(attrappe({ fehlerFolge: [429] }).client).spreadsheets.values.get({ spreadsheetId: ID, range: 'A!A1' })))
      .rejects.toMatchObject({ code: AUSGELASTET_CODE });
  });

  test('googleRetry wiederholt 429 nur einmal (5xx weiter bis zu dreimal)', async () => {
    const f = st => Object.assign(new Error('x'), { response: { status: st } });
    let n = 0;
    await expect(mitWiederholung(async () => { n++; throw f(429); }, { sleep: async () => {}, log: () => {} })).rejects.toThrow();
    expect(n).toBe(2);
    n = 0;
    await expect(mitWiederholung(async () => { n++; throw f(503); }, { sleep: async () => {}, log: () => {} })).rejects.toThrow();
    expect(n).toBe(4);
  });

  test('Kontingent aus der Fehlermeldung, wenn details fehlen', () => {
    const err = { message: "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute' of service" };
    expect(kontingentAus(err)).toBe('Read requests / Read requests per minute');
  });
});

describe('Zaehler und Log', () => {
  test('eine Zeile je Minute, ohne Werte und Tabellen-IDs; ueber_60 markiert', async () => {
    const { client } = attrappe();
    const s = umhuelleSheets(client);
    await mitSheetsKontext({ ursprung: ursprungAus('GET', '/api/auftraege/kunden/K-00012/historie'), cache: false }, async () => {
      for (let i = 0; i < 61; i++) await lies(s, 'A!A1:ZZ');
    });
    jetzt += 60_000;
    await lies(s, 'B!A1:ZZ');   // neue Minute -> alte Zeile wird geschrieben
    const z = JSON.parse(logs.find(l => l.includes('sheets_req_minute')));
    expect(z).toMatchObject({ event: 'sheets_req_minute', minute: '2026-11-23T09:00', google_lesen: 61, ueber_60: true });
    expect(z.je[0]).toEqual({ a: 'google_lesen', u: 'GET /api/auftraege/kunden/:x/historie', m: 'values.get', r: 'A', n: 61 });
    expect(JSON.stringify(logs)).not.toMatch(/tabelle-1|K-00012|"1"/);
    expect(logMinute().google_lesen).toBe(1);
  });
});

describe('Einhaengen', () => {
  test('google.sheets v4 liefert den umhuellten Client', () => {
    const c = google.sheets({ version: 'v4' });
    expect(c.__qu1).toBe(true);
    expect(typeof c.spreadsheets.values.get).toBe('function');
    expect(typeof c.spreadsheets.values.batchUpdate).toBe('function');
    expect(typeof c.spreadsheets.batchUpdate).toBe('function');
  });

  test('index.js: Modul zuerst, Kontext NACH dem Body-Parser', () => {
    const s = quelle('index.js');
    expect(s.indexOf("from './lib/sheetsZentral.js'")).toBeLessThan(s.indexOf("from './routes/"));
    const json = s.indexOf('app.use(express.json(');
    const kontext = s.indexOf('app.use(sheetsKontext)');
    expect(json).toBeGreaterThan(0);
    expect(kontext).toBeGreaterThan(json);
    expect(kontext).toBeLessThan(s.indexOf("app.use('/api/"));
  });

  test('Schreibsperren lesen frisch', () => {
    for (const f of ['auftraege', 'bestellseite', 'druckmasse', 'fpSperre', 'kunden', 'lager', 'trikotIntern', 'lshopKorb', 'lshopStammdaten']) {
      expect([f, /return await frischLesen\(fn\)/.test(quelle(`lib/${f}.js`))]).toEqual([f, true]);
    }
  });
});

// ── Vorher/Nachher: simulierter Arbeitsablauf ────────────────────────────────
// Lesefolge je Route wie im Code gezaehlt (Bericht QU1, kalt): "A+B" = ein batchGet, "T#k" = Kopfzeile von T
// (leseReiterSpalten liest erst die Kopfzeile, dann die Spalten), "meta" = spreadsheets.get. Die modul-eigenen
// Zwischenspeicher (Auftraege 30 s, LShop_Modelle 5 min ...) sind NICHT nachgebildet: "vorher" ist eine Obergrenze.
const AUFTRAEGE = ['Auftraege+Auftrag_Positionen', 'Warenkorb_LShop', 'Auftraege+Auftrag_Positionen', 'Warenkorb_LShop',
  'LShop_Modelle#k', 'LShop_Modelle', 'LShop_Lieferbarkeit', 'LShop_Modelle#k', 'LShop_Modelle', 'LShop_EK_Verlauf',
  'Druckmasse', 'Config', 'Aufgaben', 'Auftrag_Todos'];
const LAGER = ['meta', 'Lager_Buchungen', 'Lager_Artikel', 'Lager_Orte', 'Lager_Events'];
const ROUTEN = {
  dashboard: [...AUFTRAEGE, 'Kunden', 'Warenkorb_LShop+LShop_EDI_Dateien', 'Trikots', 'Trikot_Artikel', 'Hinweis_Gelesen', 'Bestell_Eintraege'],
  auftraege: AUFTRAEGE,
  kunden: ['Kunden'],
  bestellung: ['Produktions_Status', 'Warenkorb_LShop', ...LAGER, 'meta', 'LShop_EDI_Dateien+Warenkorb_LShop+LShop_Sendungen+LShop_Kartons',
    'LShop_Modelle#k', 'LShop_Modelle', 'Varianten', 'Erfassungsmaske#k', 'Erfassungsmaske', 'SKU_Extern#k', 'SKU_Extern',
    'Trikot_Artikel#k', 'Trikot_Artikel'],
  korb: ['meta', 'Warenkorb_LShop', 'LShop_Modelle#k', 'LShop_Modelle', 'Erfassungsmaske#k', 'Erfassungsmaske', 'LShop_Modelle#k',
    'LShop_Modelle', ...LAGER, 'LShop_Lieferbarkeit', 'Config'],
  portal: ['Partner', 'Partner_Verkaeufe', 'Partner_Interne_Bestellungen', 'Partner_Abrechnungen', 'Partner', 'Fixkosten'],
};
// Zwei Minuten Arbeit: Inhaber + Nicole, ein Partner im Portal; nach Aktionen laedt die Oberflaeche neu.
const ABLAUF = [
  [0, 'dashboard'], [0, 'dashboard'], [0, 'auftraege'], [0, 'kunden'], [0, 'auftraege'],
  [0, 'schreiben:Auftraege'], [0, 'auftraege'], [0, 'schreiben:Auftrag_Todos'], [0, 'auftraege'],
  [1, 'bestellung'], [1, 'schreiben:Produktions_Status'], [1, 'bestellung'], [1, 'schreiben:Produktions_Status'], [1, 'bestellung'],
  [1, 'korb'], [1, 'portal'], [1, 'portal'], [1, 'dashboard'], [1, 'schreiben:Warenkorb_LShop'], [1, 'korb'],
];

async function simuliere(mitSpeicher) {
  process.env.SHEETS_CACHE_MS = mitSpeicher ? '' : '0';
  const { client, aufrufe } = attrappe();
  const s = umhuelleSheets(client);
  const start = jetzt;
  const je = [0, 0];
  for (const [minute, was] of ABLAUF) {
    jetzt = start + minute * 60_000 + 1000;
    const vor = aufrufe.length;
    if (was.startsWith('schreiben:')) {
      await frischLesen(() => s.spreadsheets.values.update({ spreadsheetId: ID, range: `${was.slice(10)}!A2`, requestBody: {} }));
      continue;
    }
    await mitSheetsKontext({ ursprung: `GET /${was}`, cache: true }, async () => {
      for (const t of ROUTEN[was]) {
        if (t === 'meta') await s.spreadsheets.get({ spreadsheetId: ID });
        else if (t.includes('+')) await s.spreadsheets.values.batchGet({ spreadsheetId: ID, ranges: t.split('+').map(x => `${x}!A1:ZZ`) });
        else if (t.endsWith('#k')) await lies(s, `${t.slice(0, -2)}!1:1`);
        else await lies(s, `${t}!A1:ZZ`);
      }
    });
    je[minute] += aufrufe.length - vor;
  }
  return je;
}

test('simulierter Arbeitsablauf: Leseanfragen je Minute vorher/nachher', async () => {
  const vorher = await simuliere(false);
  _zuruecksetzen({ log: () => {}, jetzt: () => jetzt, sleep: async () => {} });
  const nachher = await simuliere(true);
  // fest, damit eine Aenderung an den Regeln auffaellt (Bericht QU1 nennt diese Zahlen)
  expect({ vorher, nachher }).toEqual({ vorher: [97, 116], nachher: [18, 40] });
});
