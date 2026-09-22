// Fokus-Keyphrase und Synonyme aus Mission Control nach Yoast schreiben.
//
// Grundlage: der Verlusttest an 21031 (22.09.). Beide Felder sind ueber
// meta_data schreibbar, und ein PUT mit schmalem meta_data-Body raeumt nichts
// ab - 35 Schluessel vorher, 35 nachher, keiner verloren.
//
// Drei Dinge haelt diese Datei fest:
//  1. Die Sheet-Spalte "Fokus_Synonyme" wird bei Bedarf angelegt (Backend).
//  2. Der Yoast-PUT traegt AUSSCHLIESSLICH meta_data - kein sku, keine
//     attributes, keine variations, kein status, kein brands. Genau dieser
//     Zuschnitt ist gemessen; alles andere ist es nicht.
//  3. Leere Felder werden NICHT geschrieben, damit ein leeres Eingabefeld
//     keine von Hand gepflegte Keyphrase still loescht.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

let request, app, values, tab;

beforeAll(async () => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  values = { get: jest.fn(), update: jest.fn(), append: jest.fn(), batchUpdate: jest.fn() };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values } });
  const { default: router } = await import('../routes/sheets.js');
  app = express();
  app.use(express.json());
  app.use('/api/sheets', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

const setzeTab = rows => { tab = rows.map(r => [...r]); };

beforeEach(() => {
  values.get.mockReset().mockImplementation(async ({ range }) => {
    const teil = range.slice(range.indexOf('!') + 1);
    const [von, bis] = teil.split(':').map(Number);
    return { data: { values: tab.slice(von - 1, bis).map(r => [...r]) } };
  });
  for (const f of ['update', 'append', 'batchUpdate']) values[f].mockReset().mockResolvedValue({ data: {} });
});

const KOPF    = ['ID', 'SEO_Status', 'Produkt-ID', 'Produktname', 'Artikelnummer'];
const BESTAND = ['JFN-2026-0001', 'Ausstehend', '100', 'Shirt', 'JF-1'];

const patch = fields => request(app).post('/api/sheets/erfassung/patch-fields')
  .send({ row: 2, fields });
const kopfUpdates  = () => values.update.mock.calls.filter(c => /!\D+1$/.test(c[0].range));
const zeilenUpdate = () => values.update.mock.calls.find(c => c[0].range === 'Erfassungsmaske!A2')?.[0];

// ── Sheet-Spalte ────────────────────────────────────────────────────────────
describe('Spalte Fokus_Synonyme in der Erfassungsmaske', () => {
  test('Spalte fehlt → wird hinten angehaengt, Wert steht in der Zeile', async () => {
    setzeTab([KOPF, BESTAND]);
    const res = await patch({ Fokus_Synonyme: 'Ugly Sweater Herren, Weihnachtssweater' });

    expect(res.status).toBe(200);
    expect(kopfUpdates()).toHaveLength(1);
    expect(kopfUpdates()[0][0]).toMatchObject({
      range: 'Erfassungsmaske!F1',
      requestBody: { values: [['Fokus_Synonyme']] },
    });
    expect(zeilenUpdate().requestBody.values[0][5]).toBe('Ugly Sweater Herren, Weihnachtssweater');
  });

  test('Keyphrase und Synonyme zusammen → beide Spalten, in dieser Reihenfolge', async () => {
    setzeTab([KOPF, BESTAND]);
    await patch({ SEO_Status: 'Erledigt', Fokus_Keyphrase: 'weihnachtspullover', Fokus_Synonyme: 'ugly sweater' });

    const bereiche = kopfUpdates().map(c => c[0].range);
    expect(bereiche).toEqual(['Erfassungsmaske!F1', 'Erfassungsmaske!G1']);
    expect(kopfUpdates()[0][0].requestBody.values).toEqual([['Fokus_Keyphrase']]);
    expect(kopfUpdates()[1][0].requestBody.values).toEqual([['Fokus_Synonyme']]);
  });

  test('Bestandszeilen bleiben leer: nur Kopf und die eigene Zeile', async () => {
    setzeTab([KOPF, BESTAND, BESTAND, BESTAND]);
    await patch({ Fokus_Synonyme: 'a, b' });
    expect(values.update.mock.calls.map(c => c[0].range).sort())
      .toEqual(['Erfassungsmaske!A2', 'Erfassungsmaske!F1']);
  });

  test('fields ohne Synonyme → keine Spalte angelegt', async () => {
    setzeTab([KOPF, BESTAND]);
    await patch({ SEO_Status: 'Erledigt' });
    expect(kopfUpdates()).toHaveLength(0);
  });
});

describe('GET /erfassung/seo-pending reicht die Synonyme durch', () => {
  test('ohne Spalte: 200, synonyme leer', async () => {
    setzeTab([KOPF, BESTAND]);
    const res = await request(app).get('/api/sheets/erfassung/seo-pending');
    expect(res.status).toBe(200);
    expect(res.body[0].synonyme).toBe('');
  });

  test('mit Spalte: Wert kommt an', async () => {
    setzeTab([[...KOPF, 'Fokus_Synonyme'], [...BESTAND, 'ugly sweater, weihnachtssweater']]);
    const res = await request(app).get('/api/sheets/erfassung/seo-pending');
    expect(res.body[0].synonyme).toBe('ugly sweater, weihnachtssweater');
  });
});

// ── Frontend: der Schreibweg im SEO-Flow ────────────────────────────────────
describe('Frontend: Yoast-Schreibweg', () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
  );
  const saveBlock = html.slice(html.indexOf("getElementById('btn-seo-save').addEventListener"));
  const yoastBlock = saveBlock.slice(
    saveBlock.indexOf('── Yoast-Schreibweg'),
    saveBlock.indexOf('if (yoastLeer.length)'),
  );

  // ⚠️ Der Yoast-Block NENNT die verbotenen Felder in seinem eigenen
  // Warnkommentar ("kein sku, keine attributes … KEIN brands"). Eine
  // Negativpruefung auf dem Rohtext schluege deshalb am Hinweis fehl, nicht am
  // Code. Darum vor der Pruefung die Kommentarzeilen entfernen - wer das
  // "vereinfacht", laesst den Test ueber seine eigene Warnung stolpern.
  const ohneKommentare = s => s.split('\n').filter(z => !z.trim().startsWith('//')).join('\n');

  test('Eingabefeld fuer Synonyme existiert, direkt bei der Keyphrase', () => {
    expect(html).toMatch(/id="seo-synonyme"/);
    expect(html.indexOf('id="seo-synonyme"')).toBeGreaterThan(html.indexOf('id="seo-keyphrase"'));
  });

  test('beim Laden wird das Feld aus dem Sheet gefuellt', () => {
    expect(html).toMatch(/getElementById\('seo-synonyme'\)\.value\s*=\s*seoCurrentItem\.synonyme/);
  });

  test('Speichern schreibt Fokus_Synonyme ins Sheet', () => {
    expect(saveBlock).toMatch(/'Fokus_Synonyme':\s*document\.getElementById\('seo-synonyme'\)\.value\.trim\(\)/);
  });

  test('beide Yoast-Felder werden gesetzt', () => {
    expect(yoastBlock).toMatch(/_yoast_wpseo_focuskw/);
    expect(yoastBlock).toMatch(/_yoast_wpseo_keywordsynonyms/);
  });

  // Der Kern: genau dieser Body-Zuschnitt ist an 21031 gemessen.
  test('der PUT-Body enthaelt AUSSCHLIESSLICH meta_data', () => {
    const code = ohneKommentare(yoastBlock);
    expect(code).toMatch(/body:\s*JSON\.stringify\(\{\s*meta_data:\s*yoastMeta\s*\}\)/);
    for (const verboten of [/\bsku\b/, /\battributes\b/, /\bvariations\b/, /\bbrands\b/, /\bstatus:/]) {
      expect(code).not.toMatch(verboten);
    }
  });

  test('leere Felder werden nicht geschrieben', () => {
    expect(yoastBlock).toMatch(/if \(yoastKeyphrase\)\s*yoastMeta\.push/);
    expect(yoastBlock).toMatch(/if \(yoastSynonyme\)\s*yoastMeta\.push/);
    // und der PUT unterbleibt ganz, wenn beide leer sind
    expect(yoastBlock).toMatch(/if \(yoastMeta\.length\)/);
  });

  test('warum nicht geschrieben wurde, steht in der Rueckmeldung', () => {
    expect(saveBlock).toMatch(/leer – in Yoast nicht überschrieben/);
    expect(saveBlock).toMatch(/statusMsg\.textContent\s*=\s*yoastText/);
  });

  // ⚠️ seo-status-msg liegt INNERHALB von seo-article-panel (index.html:1125
  // bzw. 1214), und das Panel geht beim Speichern auf display:none - einige
  // Zeilen VOR der Zuweisung des Statustexts. Der Statustext allein erreicht
  // den Nutzer also nicht. Die Meldung muss zusaetzlich in den Toast, der
  // unabhaengig vom Panel steht. Wer das zurueckdreht, macht die Rueckmeldung
  // wieder unsichtbar, ohne dass ein Test es merkt - darum dieser hier.
  test('die Yoast-Meldung geht in den Toast, nicht nur in den verdeckten Statustext', () => {
    expect(saveBlock).toMatch(/showToast\(\s*\[[^\]]*yoastText\s*\]/);

    const panelZu = saveBlock.indexOf("seo-article-panel').style.display = 'none'");
    expect(panelZu).toBeGreaterThan(-1);
    // Die Reihenfolge ist bekannt und bewusst: Panel zu, danach die Meldung.
    expect(saveBlock.indexOf('statusMsg.textContent = yoastText')).toBeGreaterThan(panelZu);
  });

  test('zurueckgelesen wird, was tatsaechlich in Yoast steht', () => {
    // Beleg ist der REST-Ruecklesewert, nicht die PUT-Antwort: Yoast Premium
    // ist abgelaufen, das Synonymfeld zeigt die Oberflaeche womoeglich nicht.
    expect(yoastBlock).toMatch(/In Yoast steht jetzt/);
    expect(yoastBlock).toMatch(/nach\.meta_data/);
  });

  test('schlaegt der PUT fehl, bleibt der Sheet-Stand und die Meldung ist sichtbar', () => {
    expect(yoastBlock).toMatch(/Yoast NICHT geschrieben/);
    expect(yoastBlock).toMatch(/Sheet-Eintrag bleibt erhalten/);
    // Der Fehler wird gefangen, statt den ganzen Handler abzubrechen.
    expect(yoastBlock).toMatch(/catch \(e\)/);
  });

  test('der Yoast-PUT laeuft NACH patch-fields', () => {
    // Reihenfolge ist die Begruendung der Leer-Regel: das Sheet ist die Quelle,
    // Yoast die Kopie. Andersherum bliebe der Sheet-Stand bei einem Fehler weg.
    expect(saveBlock.indexOf('erfassung/patch-fields'))
      .toBeLessThan(saveBlock.indexOf('── Yoast-Schreibweg'));
  });
});
