// FB1: Feedback aus MC ins eigene Sheet. Nur erfundene Texte, KI und Sheets als Attrappe.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: () => { throw new Error('kein echter Sheets-Client im Test'); } } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: async () => ({}), googleAuthMitScopes: () => ({}) }));

const fb = await import('../utils/feedback.js');
const lib = await import('../lib/feedback.js');
const { feedbackHandler, FEEDBACK_MAX } = await import('../routes/feedback.js');
const { requireApiKey, _schluesselMerkerLeeren } = await import('../middleware/auth.js');
const { _secretCacheLeeren } = await import('../utils/secrets.js');
const { DEFAULT_MODELS } = await import('../lib/modelConfig.js');
const { SECRET_KEYS } = await import('../utils/secrets.js');

const hier = dirname(fileURLToPath(import.meta.url));
const quelle = p => readFileSync(resolve(hier, p), 'utf8');

const TEXT = 'Im Lager-Dialog ist der Knopf „alles“ am Handy zu klein, ich treffe ihn kaum.';
const KONTEXT = { ansicht: '#lager/bestand', ansichtLesbar: 'Lager → Bestand', dialog: 'Lager buchen', objekt: 'AU-2026-0041', breite: 375, mcStand: 'abc1234' };
const KI_OK = { kategorie: 'Bedienung', titel: 'Knopf alles im Lager-Dialog zu klein', bereich: 'Lager', zusammenfassung: 'Der Knopf ist am Handy schwer zu treffen.',
  loesungsidee: 'Tippfläche vergrößern.', aufwand: 'klein', aehnlich: ['FB-0002', 'FB-9999'], personendaten: false };

const neuesSheet = (zeilen = []) => {
  const tabs = { Feedback: [[...fb.SPALTEN], ...zeilen] };
  return { tabs, sheets: sheetsAttrappe(() => tabs) };
};
const altZeile = (nr, titel) => fb.SPALTEN.map(s => (s === 'FB-Nr' ? nr : s === 'KI_Titel' ? titel : s === 'Status' ? 'neu' : ''));
const basis = (sheets, extra = {}) => ({
  eingabe: { text: TEXT, kontext: KONTEXT }, wer: 'Nicole', sheets, sheetIdLesen: async () => 'sheet-x', modellLesen: async () => 'claude-haiku-5-5',
  jetzt: () => new Date('2026-11-21T14:05:00Z'), aufruf: jest.fn(async () => ({ text: JSON.stringify(KI_OK), nutzung: { ein: 900, aus: 120 } })), ...extra,
});
const zelle = (tabs, zeile, spalte) => tabs.Feedback[zeile][fb.SPALTEN.indexOf(spalte)];

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });

describe('Eingabe und Kontext', () => {
  test('leer = nicht senden, mehr als 2.000 Zeichen abgelehnt - Meldung ohne den Text', () => {
    expect(() => fb.pruefeEingabe({ text: '   ' })).toThrow(expect.objectContaining({ status: 422, code: 'text_leer' }));
    expect(() => fb.pruefeEingabe({})).toThrow(expect.objectContaining({ code: 'text_leer' }));
    const lang = 'GEHEIMWORT '.repeat(200);
    let e; try { fb.pruefeEingabe({ text: lang }); } catch (x) { e = x; }
    expect(e).toMatchObject({ status: 422, code: 'text_lang' });
    expect(e.message).not.toContain('GEHEIMWORT');
    expect(fb.pruefeEingabe({ text: 'x'.repeat(fb.TEXT_MAX) }).text).toHaveLength(2000);
  });
  test('Kontext wird gesiebt: Ansicht, Gerät, Stand nur in fester Form', () => {
    const e = fb.pruefeEingabe({ text: TEXT, kontext: KONTEXT });
    expect(e).toMatchObject({ ansicht: '#lager/bestand', ansichtLesbar: 'Lager → Bestand', dialog: 'Lager buchen', objekt: 'AU-2026-0041', geraet: 'Handy · 375 px', mcStand: 'abc1234' });
    expect(fb.pruefeEingabe({ text: TEXT, kontext: { breite: 1280, ansicht: 'auftraege/liste', mcStand: 'lokal' } })).toMatchObject({ geraet: 'Desktop · 1280 px', ansicht: '#auftraege/liste', mcStand: 'lokal' });
    const unsinn = fb.pruefeEingabe({ text: TEXT, kontext: { ansicht: 'javascript:alert(1)', breite: 'x', mcStand: '<b>', dialog: '=SUMME(A1)<x>', ansichtLesbar: 'A'.repeat(200) } });
    expect(unsinn).toMatchObject({ ansicht: '', geraet: '', mcStand: '', dialog: 'SUMME(A1)x' });
    expect(unsinn.ansichtLesbar).toHaveLength(80);
    expect(fb.pruefeEingabe({ text: TEXT, kontext: 'kaputt' })).toMatchObject({ ansicht: '', objekt: '' });
  });
  test('Objekt nur als Nummer - ein Name kommt nie durch', () => {
    const o = objekt => fb.pruefeEingabe({ text: TEXT, kontext: { objekt } }).objekt;
    for (const ok of ['AU-2026-0041', 'AG-2026-0012', 'K-00017', 'FB-2026-0007', 'JFN #48211', 'HONK #991', 'JFN-2026-0019', 'BS-003', 'P-001']) expect(o(ok)).toBe(ok);
    for (const nein of ['Erika Mustermann', 'AU-2026-0041 Erika', 'Familie Probe', 'K-00017 Muster GmbH', '48211', '']) expect(o(nein)).toBe('');
  });
  test('Wer nur fuer Inhaber und Nicole', () => {
    expect(fb.werAus('inhaber')).toBe('Inhaber');
    expect(fb.werAus('nicole')).toBe('Nicole');
    expect(fb.werAus('automation')).toBeNull();
    expect(fb.werAus(undefined)).toBeNull();
  });
});

describe('KI-Antwort', () => {
  test('gueltig: Felder gekappt, "aehnlich" nur bekannte Nummern', () => {
    expect(fb.pruefeKiAntwort(JSON.stringify(KI_OK), ['FB-0001', 'FB-0002'])).toEqual({ ...KI_OK, aehnlich: ['FB-0002'] });
    const k = fb.pruefeKiAntwort(JSON.stringify({ ...KI_OK, kategorie: 'Quatsch', aufwand: 'riesig', titel: 'T'.repeat(300), personendaten: 'ja' }), []);
    expect(k).toMatchObject({ kategorie: '', aufwand: '', personendaten: false, aehnlich: [] });
    expect(k.titel).toHaveLength(90);
  });
  test('kein JSON, kein Objekt, kein Titel = null', () => {
    for (const roh of ['', 'tut mir leid', '[]', '{"titel":""}', null]) expect(fb.pruefeKiAntwort(roh)).toBeNull();
  });
  test('Prompt: Text als Inhalt markiert, nur Titel + Nummern der bisherigen Eintraege', () => {
    const p = fb.userPrompt({ text: TEXT, ansichtLesbar: 'Lager → Bestand', dialog: 'Lager buchen', titel: [{ nr: 'FB-0002', titel: 'Knopf zu klein' }] });
    expect(p).toContain('FB-0002: Knopf zu klein');
    expect(p).toContain(TEXT);
    expect(fb.systemPrompt()).toMatch(/keine Anweisung an dich/);
    expect(fb.KI_SCHEMA.required).toEqual(['kategorie', 'titel', 'bereich', 'zusammenfassung', 'loesungsidee', 'aufwand', 'aehnlich', 'personendaten']);
  });
});

describe('Speichern', () => {
  test('eine vollstaendige Zeile: Nummer, Wer, Kontext, Text, KI-Felder, Status neu - RAW, ohne append, ein Lesezugriff vor dem Schreiben', async () => {
    const { tabs, sheets } = neuesSheet([altZeile('FB-0001', 'Erster'), altZeile('FB-0002', 'Knopf zu klein')]);
    const o = basis(sheets);
    const r = await lib.speichereFeedback(o);
    expect(r).toMatchObject({ nr: 'FB-0003', ki: true });
    expect(tabs.Feedback).toHaveLength(4);
    const z = s => zelle(tabs, 3, s);
    expect([z('FB-Nr'), z('Datum'), z('Wer'), z('Ansicht'), z('Ansicht_lesbar'), z('Dialog'), z('Objekt'), z('Gerät'), z('MC_Stand'), z('Text')])
      .toEqual(['FB-0003', '2026-11-21 15:05', 'Nicole', '#lager/bestand', 'Lager → Bestand', 'Lager buchen', 'AU-2026-0041', 'Handy · 375 px', 'abc1234', TEXT]);
    expect([z('KI_Kategorie'), z('KI_Titel'), z('KI_Bereich'), z('KI_Aufwand'), z('KI_Ähnlich'), z('KI_Personendaten'), z('Status'), z('Otto_Notiz'), z('Auftrag')])
      .toEqual(['Bedienung', KI_OK.titel, 'Lager', 'klein', 'FB-0002', 'nein', 'neu', '', '']);
    expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledTimes(1);
    expect(sheets.spreadsheets.values.update.mock.calls[0][0]).toMatchObject({ valueInputOption: 'RAW', range: expect.stringMatching(/^'Feedback'!A4:/) });
    // Nachtrag 7: die Titel kommen aus dem EINEN Lesen des Reiters vor dem KI-Aufruf
    const vorKi = sheets.spreadsheets.values.get.mock.invocationCallOrder.filter(n => n < o.aufruf.mock.invocationCallOrder[0]);
    expect(vorKi).toHaveLength(1);
    expect(o.aufruf.mock.calls[0][0]).toMatchObject({ art: 'schnell', rolle: 'feedback', zeitlimitMs: 30000, jsonSchema: fb.KI_SCHEMA });
    expect(o.aufruf.mock.calls[0][0].prompt).toContain('FB-0002: Knopf zu klein');
  });
  test('Formel-Schutz: ein Text mit "=" steht als Text in der Zelle (RAW)', async () => {
    const { tabs, sheets } = neuesSheet();
    await lib.speichereFeedback(basis(sheets, { eingabe: { text: '=HYPERLINK("https://example.test";"klick")', kontext: {} } }));
    expect(zelle(tabs, 1, 'Text')).toBe('=HYPERLINK("https://example.test";"klick")');
    expect(sheets.spreadsheets.values.update.mock.calls[0][0].valueInputOption).toBe('RAW');
  });
  test('KI faellt aus (Fehler, Zeitlimit, Unsinn, falscher Anbieter): Rohtext wird trotzdem gespeichert, KI-Spalten leer', async () => {
    const faelle = [
      { aufruf: jest.fn(async () => { throw Object.assign(new Error('boom'), { status: 529 }); }), grund: 'ki_529' },
      { aufruf: jest.fn(async () => { throw Object.assign(new Error('zeit'), { code: 'ki_zeitlimit', status: 504 }); }), grund: 'ki_zeitlimit' },
      { aufruf: jest.fn(async () => ({ text: 'kein json' })), grund: 'ki_unsinn' },
      { aufruf: jest.fn(), modellLesen: async () => 'gemini-3.5-flash-lite', grund: 'ki_anbieter' },
    ];
    for (const f of faelle) {
      const { tabs, sheets } = neuesSheet();
      const r = await lib.speichereFeedback(basis(sheets, f));
      expect(r).toMatchObject({ nr: 'FB-0001', ki: false, kiGrund: f.grund });
      expect(zelle(tabs, 1, 'Text')).toBe(TEXT);
      expect([zelle(tabs, 1, 'KI_Titel'), zelle(tabs, 1, 'KI_Kategorie'), zelle(tabs, 1, 'KI_Personendaten'), zelle(tabs, 1, 'Status')]).toEqual(['', '', '', 'neu']);
    }
    expect(faelle[3].aufruf).not.toHaveBeenCalled();   // Text nur an Claude (Anthropic)
  });
  test('Nachtrag 8: zwei schnelle Sendungen hintereinander - zwei Nummern, zwei Zeilen, nichts doppelt', async () => {
    const { tabs, sheets } = neuesSheet([altZeile('FB-0006', 'Alt')]);
    let frei; const warte = new Promise(r => { frei = r; });
    const langsam = jest.fn(async () => { await warte; return { text: JSON.stringify(KI_OK) }; });
    const a = lib.speichereFeedback(basis(sheets, { aufruf: langsam, eingabe: { text: 'Erste Rückmeldung zum Test', kontext: {} } }));
    const b = lib.speichereFeedback(basis(sheets, { eingabe: { text: 'Zweite Rückmeldung zum Test', kontext: {} } }));
    await new Promise(r => setTimeout(r, 20));
    expect(tabs.Feedback).toHaveLength(2);          // die zweite wartet in der Sperre
    frei();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.nr, rb.nr]).toEqual(['FB-0007', 'FB-0008']);
    expect(tabs.Feedback.slice(2).map(z => [z[0], z[fb.SPALTEN.indexOf('Text')]])).toEqual([['FB-0007', 'Erste Rückmeldung zum Test'], ['FB-0008', 'Zweite Rückmeldung zum Test']]);
  });
  test('Nummer = hoechste + 1, auch mit Luecken und Handzeilen; Titel-Fenster 200', () => {
    const werte = [[...fb.SPALTEN], altZeile('FB-0003', 'A'), altZeile('', 'von Hand'), altZeile('FB-0010', ''), altZeile('fb-0004', 'B')];
    const s = fb.standAus(werte);
    expect(s.naechste).toBe(11);
    expect(s.titel).toEqual([{ nr: 'FB-0003', titel: 'A' }, { nr: 'FB-0004', titel: 'B' }]);
    const viele = [[...fb.SPALTEN], ...Array.from({ length: 250 }, (_, i) => altZeile(fb.nrText(i + 1), `Titel ${i + 1}`))];
    const v = fb.standAus(viele);
    expect(v.titel).toHaveLength(200);
    expect(v.titel[0].nr).toBe('FB-0051');
    expect(fb.nrText(12345)).toBe('FB-12345');
  });
  test('Nachtrag 6: ohne FEEDBACK_SHEET_ID 503 - nichts gelesen, KI nicht gerufen; Kopfzeile fehlt = 503', async () => {
    const { sheets } = neuesSheet();
    const o = basis(sheets, { sheetIdLesen: async () => '' });
    await expect(lib.speichereFeedback(o)).rejects.toMatchObject({ status: 503, code: 'feedback_einrichtung' });
    expect(sheets.spreadsheets.values.get).not.toHaveBeenCalled();
    expect(o.aufruf).not.toHaveBeenCalled();
    const tabs = { Feedback: [['irgendwas']] };
    const p = basis(sheetsAttrappe(() => tabs));
    await expect(lib.speichereFeedback(p)).rejects.toMatchObject({ status: 503, code: 'feedback_einrichtung' });
    expect(p.aufruf).not.toHaveBeenCalled();
    expect(tabs.Feedback).toHaveLength(1);
  });
  test('feedbackSheetId wirft nie: Secret fehlt / Lesefehler = leer', async () => {
    expect(await lib.feedbackSheetId({ lies: async () => { throw new Error('NOT_FOUND'); } })).toBe('');
    expect(await lib.feedbackSheetId({ lies: async () => undefined })).toBe('');
    expect(await lib.feedbackSheetId({ lies: async () => '  abc  ' })).toBe('abc');
    expect(SECRET_KEYS).not.toContain('FEEDBACK_SHEET_ID');   // das Backend startet ohne das Secret
    expect(DEFAULT_MODELS.feedback).toMatch(/^claude-/);
  });
  test('Sheet nicht erreichbar oder Schreiben scheitert: fester Text ohne den Feedback-Text', async () => {
    const kaputt = { spreadsheets: { values: { get: jest.fn(async () => { throw Object.assign(new Error(`intern ${TEXT}`), { code: 403 }); }) } } };
    let e; try { await lib.speichereFeedback(basis(kaputt)); } catch (x) { e = x; }
    expect(e).toMatchObject({ status: 503 });
    expect(e.message).not.toContain('Knopf');
    const { sheets } = neuesSheet();
    sheets.spreadsheets.values.update.mockRejectedValueOnce(new Error(`kaputt ${TEXT}`));
    try { await lib.speichereFeedback(basis(sheets)); } catch (x) { e = x; }
    expect(e).toMatchObject({ status: 502, code: 'feedback_schreiben' });
    expect(e.message).not.toContain('Knopf');
  });
  test('ohne "wer" kein Speichern (403)', async () => {
    const { sheets } = neuesSheet();
    await expect(lib.speichereFeedback(basis(sheets, { wer: null }))).rejects.toMatchObject({ status: 403 });
  });
});

describe('Route POST /api/feedback', () => {
  const app = speichern => {
    const a = express();
    a.use(express.json());
    a.use(requireApiKey);
    a.post('/api/feedback', feedbackHandler(speichern));
    return a;
  };
  let log, warn;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    Object.assign(process.env, { MC_API_KEY: 'k-inhaber', MC_API_KEY_NICOLE: 'k-nicole', MC_API_KEY_AUTOMATION: 'k-auto' });
    _secretCacheLeeren(); _schluesselMerkerLeeren();
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { log.mockRestore(); warn.mockRestore(); });

  test('Nachtrag 1: "Wer" kommt aus dem Schluessel, nie aus dem Body', async () => {
    const speichern = jest.fn(async () => ({ nr: 'FB-0007', ki: true, kiGrund: '', nutzung: { ein: 900, aus: 120 } }));
    const res = await request(app(speichern)).post('/api/feedback').set('X-API-Key', 'k-nicole').send({ text: TEXT, kontext: KONTEXT, wer: 'Inhaber', Wer: 'Inhaber' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nr: 'FB-0007', ki: true });
    expect(speichern).toHaveBeenCalledWith({ eingabe: { text: TEXT, kontext: KONTEXT }, wer: 'Nicole' });
    await request(app(speichern)).post('/api/feedback').set('X-API-Key', 'k-inhaber').send({ text: TEXT, wer: 'Nicole' });
    expect(speichern.mock.calls[1][0].wer).toBe('Inhaber');
  });
  test('Nachtrag 1: Automatik-Schluessel 403, ohne Schluessel 401 - nichts gespeichert', async () => {
    const speichern = jest.fn();
    const auto = await request(app(speichern)).post('/api/feedback').set('X-API-Key', 'k-auto').send({ text: TEXT });
    expect(auto.status).toBe(403);
    expect(auto.body.code).toBe('feedback_wer');
    expect((await request(app(speichern)).post('/api/feedback').send({ text: TEXT })).status).toBe(401);
    expect(speichern).not.toHaveBeenCalled();
  });
  test('Fehler: Status + fester Text + Code; der Feedback-Text steht in keiner Logzeile', async () => {
    const f503 = jest.fn(async () => { throw Object.assign(new Error('Feedback gerade nicht möglich – das Feedback-Sheet ist noch nicht eingerichtet.'), { status: 503, code: 'feedback_einrichtung' }); });
    const r503 = await request(app(f503)).post('/api/feedback').set('X-API-Key', 'k-nicole').send({ text: TEXT });
    expect(r503.status).toBe(503);
    expect(r503.body).toEqual({ error: expect.stringMatching(/^Feedback gerade nicht möglich/), code: 'feedback_einrichtung' });
    const f500 = jest.fn(async () => { throw new Error(`unerwartet: ${TEXT}`); });
    const r500 = await request(app(f500)).post('/api/feedback').set('X-API-Key', 'k-nicole').send({ text: TEXT });
    expect(r500.status).toBe(500);
    expect(r500.body).toEqual({ error: 'Feedback nicht gespeichert – bitte noch einmal senden.', code: 'feedback_fehler' });
    const ok = jest.fn(async () => ({ nr: 'FB-0001', ki: false, kiGrund: 'ki_zeitlimit', nutzung: null }));
    await request(app(ok)).post('/api/feedback').set('X-API-Key', 'k-nicole').send({ text: TEXT });
    const zeilen = [...log.mock.calls, ...warn.mock.calls].map(a => a.join(' ')).join('\n');
    expect(zeilen).toContain('FB-0001');
    expect(zeilen).not.toContain('Knopf');
    expect(zeilen).not.toContain(TEXT.slice(0, 12));
  });
  test('Quelltext: eigene Bremse, Fehler nie an den allgemeinen Fehlerhandler, kein Lesen in MC', () => {
    const route = quelle('../routes/feedback.js'), libQ = quelle('../lib/feedback.js'), index = quelle('../index.js');
    expect(FEEDBACK_MAX).toBeGreaterThan(0);
    expect(route).toContain("router.post('/', bremse, feedbackHandler());");
    expect(route).not.toMatch(/next\(/);
    expect(route).not.toMatch(/router\.(get|put|patch|delete)\(/);          // kein Lesen, kein Export
    expect(route).not.toMatch(/req\.body\??\.wer/i);
    expect(libQ).not.toMatch(/values\.append/);
    expect(libQ).not.toMatch(/console\.(log|warn|error)/);                   // die Route loggt - nur Nummer, Status, Code
    expect(index.indexOf("app.use('/api/feedback'")).toBeGreaterThan(index.indexOf('app.use(requireApiKey);'));
    expect(quelle('../utils/feedback.js')).not.toMatch(/console\./);
  });
});
