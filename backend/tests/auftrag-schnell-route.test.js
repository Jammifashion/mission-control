// SA1: Route POST /api/auftraege/schnell. Die Logik ist eine Attrappe; geprueft werden Antwort, Fehlerweg und dass
// der Rohtext auch im Fehlerfall nie ins Log kommt (Fehler gehen nicht an den allgemeinen Fehlerhandler).

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const schnellVorschlag = jest.fn();
jest.unstable_mockModule('../lib/auftragSchnell.js', () => ({ schnellVorschlag }));
const { default: router } = await import('../routes/auftraege.js');

const app = express();
app.use(express.json());
app.use('/api/auftraege', router);
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'allgemein' }); });

const TEXT = 'Erfundene Erika Beispiel möchte 4 Hoodies';
let spione;
beforeEach(() => { schnellVorschlag.mockReset(); spione = ['log', 'warn', 'error', 'info'].map(f => jest.spyOn(console, f).mockImplementation(() => {})); });
afterEach(() => spione.forEach(s => s.mockRestore()));
const log = () => spione.flatMap(s => s.mock.calls.flat()).map(x => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join('\n');

test('Erfolg: Vorschlag zurueck, Log nur Zahlen', async () => {
  schnellVorschlag.mockResolvedValue({ kunde: { vorschlaege: ['K-00001'], sicher: true }, gruppen: [{ ok: true }], frei: [] });
  const r = await request(app).post('/api/auftraege/schnell').send({ text: TEXT });
  expect(r.status).toBe(200);
  expect(schnellVorschlag.mock.calls[0][0].eingabe.text).toBe(TEXT);
  expect(log()).toMatch(/Schnellannahme: 1 Gruppen/);
  expect(log()).not.toMatch(/Erika|Hoodies/);
});

test.each([
  [Object.assign(new Error('Bitte etwas mehr Text'), { status: 422, code: 'text_kurz' }), 422, 'text_kurz'],
  [Object.assign(new Error('KI hat nicht rechtzeitig geantwortet'), { status: 504, code: 'ki_zeitlimit' }), 504, 'ki_zeitlimit'],
  [Object.assign(new Error('nicht verwertbar'), { status: 502, code: 'ki_unsinn' }), 502, 'ki_unsinn'],
])('bekannter Fehler %#: Status + Code, kein allgemeiner Handler', async (err, status, code) => {
  schnellVorschlag.mockRejectedValue(err);
  const r = await request(app).post('/api/auftraege/schnell').send({ text: TEXT });
  expect(r.status).toBe(status);
  expect(r.body.code).toBe(code);
  expect(log()).not.toMatch(/allgemein|Erika/);
});

test('unbekannter Fehler mit Text in der Meldung: 500 mit festem Text, nichts davon im Log oder in der Antwort', async () => {
  schnellVorschlag.mockRejectedValue(new Error(`kaputt bei: ${TEXT}`));
  const r = await request(app).post('/api/auftraege/schnell').send({ text: TEXT });
  expect(r.status).toBe(500);
  expect(JSON.stringify(r.body)).not.toMatch(/Erika/);
  expect(log()).not.toMatch(/Erika/);
});
