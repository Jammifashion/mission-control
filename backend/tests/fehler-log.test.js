// Allgemeiner Fehlerhandler: ins Log kommt nur eine Kurzform des Fehlers.
import { jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { fehlerHandler, fehlerKurz } from '../middleware/fehlerHandler.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = rel => readFileSync(resolve(hier, '..', rel), 'utf8');

// Erfundene Werte - so wie ein HTTP-Client-Fehler Anfrage-Daten mit sich traegt.
const SCHLUESSEL = 'ck_testschluessel_0000';
const GEHEIM     = 'cs_testgeheimnis_1111';
const PERSON     = 'Erika Testperson';

function clientFehler() {
  const err = new Error('Request failed with status code 401');
  err.name = 'AxiosError';
  err.code = 'ERR_BAD_REQUEST';
  err.config = {
    url: 'https://shop.example.test/wp-json/wc/v3/orders',
    auth: { username: SCHLUESSEL, password: GEHEIM },
    headers: { Authorization: `Basic ${Buffer.from(`${SCHLUESSEL}:${GEHEIM}`).toString('base64')}` },
    data: JSON.stringify({ billing: { first_name: PERSON } }),
  };
  err.response = { status: 401, data: { message: 'x' }, config: err.config };
  err.request = { _header: `GET /?consumer_key=${SCHLUESSEL}` };
  return err;
}

function antwortAttrappe() {
  const res = { statusCode: 0, body: null };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  return res;
}

let logs;
beforeEach(() => {
  logs = [];
  jest.spyOn(console, 'error').mockImplementation((...a) => logs.push(a));
});
afterEach(() => jest.restoreAllMocks());

const geloggt = () => logs.map(a => a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')).join('\n');

test('Log enthaelt weder Schluessel noch Personendaten', () => {
  const req = { method: 'GET', baseUrl: '/api/woocommerce', path: '/orders', query: { token: 'q' } };
  fehlerHandler(clientFehler(), req, antwortAttrappe(), () => {});
  const text = geloggt();
  expect(text).not.toContain(SCHLUESSEL);
  expect(text).not.toContain(GEHEIM);
  expect(text).not.toContain(PERSON);
  expect(text).not.toContain(Buffer.from(`${SCHLUESSEL}:${GEHEIM}`).toString('base64'));
  // Jeder Log-Aufruf bekommt nur Text, nie ein Objekt.
  for (const a of logs) for (const x of a) expect(typeof x).toBe('string');
});

test('Kurzform: Name, Meldung, Status, Code, Pfad - ohne Abfrageteil', () => {
  const k = fehlerKurz(clientFehler(), { method: 'GET', baseUrl: '/api/x', path: '/y', originalUrl: '/api/x/y?token=geheim' });
  expect(k).toEqual({
    name: 'AxiosError', meldung: 'Request failed with status code 401',
    status: 401, code: 'ERR_BAD_REQUEST', pfad: 'GET /api/x/y',
  });
});

test('Antwort an den Aufrufer bleibt wie bisher', () => {
  const alt = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const err = Object.assign(new Error('Nicht gefunden.'), { status: 404 });
    const res = antwortAttrappe();
    fehlerHandler(err, { method: 'GET', path: '/' }, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Nicht gefunden.' });
  } finally { process.env.NODE_ENV = alt; }
});

test('Lange Meldungen werden gekuerzt, Nicht-Fehler geht auch', () => {
  expect(fehlerKurz(new Error('x'.repeat(5000))).meldung.length).toBe(300);
  expect(fehlerKurz('kaputt')).toEqual({ name: 'Error', meldung: 'kaputt' });
  expect(fehlerKurz(undefined).meldung).toBe('');
});

test('index.js nutzt den Handler und loggt kein ganzes Fehlerobjekt', () => {
  const src = lies('index.js');
  expect(src).toMatch(/app\.use\(fehlerHandler\)/);
  expect(src).not.toMatch(/console\.(error|warn|log)\(\s*err\s*\)/);
});

test('kein Backend-Modul loggt ein Fehlerobjekt als eigenes Argument', () => {
  const dateien = ['lib', 'routes', 'utils', 'middleware']
    .flatMap(d => readdirSync(resolve(hier, '..', d)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`));
  const muster = /console\.(error|warn|log)\([^\n]*[,(]\s*(err|e|error|fehler)\s*\)/;
  const treffer = dateien.filter(f => muster.test(lies(f)));
  expect(treffer).toEqual([]);
});
