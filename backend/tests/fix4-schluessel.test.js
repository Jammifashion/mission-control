// FIX4 Sicherheits-Nacharbeiten:
// X-API-Key zeitkonstant (SHA-256 + timingSafeEqual), fehlend/leer = abgelehnt; auch die Sync-Routen im Partnerportal.
// Entwurfsbilder der Bestellseite: privat zwischenspeicherbar, aber mit Vary: Authorization.
// Festpreis-Portal gibt nur feste Felder heraus (keine ganzen Sheet-Zeilen).

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret:   jest.fn(async key => process.env[key] ?? ''),
  loadAllSecrets: jest.fn(),
}));

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lies = datei => readFileSync(resolve(backend, datei), 'utf8');

let request, express, schluesselGleich, requireApiKey;

beforeAll(async () => {
  ({ default: request } = await import('supertest'));
  ({ default: express } = await import('express'));
  ({ schluesselGleich, requireApiKey } = await import('../middleware/auth.js'));
});

describe('schluesselGleich', () => {
  test('gleich / ungleich / andere Laenge', () => {
    expect(schluesselGleich('abc-123', 'abc-123')).toBe(true);
    expect(schluesselGleich('abc-124', 'abc-123')).toBe(false);
    expect(schluesselGleich('abc', 'abc-123-sehr-lang')).toBe(false);   // ungleiche Laenge wirft nicht
  });
  test('fehlend oder leer ist nie gleich - auch nicht zwei leere oder zwei fehlende', () => {
    expect(schluesselGleich(undefined, 'x')).toBe(false);
    expect(schluesselGleich('x', undefined)).toBe(false);
    expect(schluesselGleich(undefined, undefined)).toBe(false);
    expect(schluesselGleich('', '')).toBe(false);
    expect(schluesselGleich('', 'x')).toBe(false);
    expect(schluesselGleich(['x', 'x'], 'x')).toBe(false);   // doppelter Header
  });
  test('Quelltext: timingSafeEqual ueber SHA-256, kein !== mehr auf dem Schluessel', () => {
    const q = lies('middleware/auth.js');
    expect(q).toMatch(/timingSafeEqual\(sha256\(gegeben\), sha256\(erwartet\)\)/);
    expect(q).not.toMatch(/key\s*!==\s*expected/);
    const pp = lies('routes/partnerPortal.js');
    expect(pp).not.toMatch(/\['x-api-key'\]\s*!==/);
    expect((pp.match(/apiSchluesselName\(req\.headers\['x-api-key'\]\)/g) ?? []).length).toBe(2);   // SI2: Schluessel-Liste
  });
});

describe('requireApiKey', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(requireApiKey);
    app.get('/x', (_req, res) => res.json({ ok: true }));
  });
  afterEach(() => { delete process.env.MC_API_KEY; });

  test('richtiger Schluessel -> 200, falscher/fehlender -> 401', async () => {
    process.env.MC_API_KEY = 'geheim-test';
    expect((await request(app).get('/x').set('X-API-Key', 'geheim-test')).status).toBe(200);
    expect((await request(app).get('/x').set('X-API-Key', 'geheim-tesT')).status).toBe(401);
    expect((await request(app).get('/x')).status).toBe(401);
  });
  test('Secret leer -> auch ein leerer Header oeffnet nicht', async () => {
    process.env.MC_API_KEY = '';
    expect((await request(app).get('/x').set('X-API-Key', '')).status).toBe(401);
    expect((await request(app).get('/x')).status).toBe(401);
  });
});

describe('Entwurfsbild der Bestellseite', () => {
  let bauRouter;
  beforeAll(async () => { ({ bauRouter } = await import('../routes/bestellseite.js')); }, 60000);   // laedt googleapis - dauert
  test('Cache-Control privat + Vary: Authorization', async () => {
    const app = express();
    app.use('/api/bestellseite', bauRouter({ entwurf: async () => ({ typ: 'image/png', buf: Buffer.from('png') }) }));
    const res = await request(app).get('/api/bestellseite/entwurf/1?groesse=klein').set('Authorization', `Bearer ${'T'.repeat(43)}`);   // Form wie randomBytes(32) base64url
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers.vary).toMatch(/Authorization/);
  });
  test('MC-Gegenstueck (X-API-Key) haengt Vary ebenfalls an', () => {
    expect(lies('routes/bestellseiten.js')).toMatch(/res\.vary\('X-API-Key'\)/);
  });
});

describe('Festpreis-Portal: feste Feldlisten', () => {
  test('Felder = was partner-festpreis.html liest', async () => {
    const { PORTAL_VERKAUF_FELDER, PORTAL_ABRECHNUNG_FELDER } = await import('../routes/festpreis-public.js');
    expect(PORTAL_VERKAUF_FELDER).toEqual(['Datum', 'WC-Bestellnummer', 'Artikelname', 'Stückzahl', 'Storno-Status', 'Status Abrechnung']);
    expect(PORTAL_ABRECHNUNG_FELDER).toEqual(['Abrechnungs-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Status', 'Erstellt-Am',
      'Gesamt-Netto', 'Gesamt-Brutto', 'Positionen']);
    const html = readFileSync(resolve(backend, '../frontend/partner-festpreis.html'), 'utf8');
    for (const f of [...PORTAL_VERKAUF_FELDER, ...PORTAL_ABRECHNUNG_FELDER]) expect(html).toContain(`r['${f}']`);
  });
  test('Positionen: nur interne Bestellungen (datum/bezeichnung/anzahl/summe) + interneSumme', async () => {
    const { portalPositionen } = await import('../routes/festpreis-public.js');
    const roh = JSON.stringify({ intern: [{ datum: '01.11.2026', bezeichnung: 'Test', anzahl: 2, summe: 10, id: 'X-1', ek: 3 }],
      interneSumme: 10, porto: { bestellungen: ['500'] }, verpackung: { bestellungen: ['500'] }, produkte: [{ ek: 1 }] });
    expect(JSON.parse(portalPositionen(roh))).toEqual({ intern: [{ datum: '01.11.2026', bezeichnung: 'Test', anzahl: 2, summe: 10 }], interneSumme: 10 });
    expect(portalPositionen('')).toBe('');
    expect(portalPositionen('kaputt')).toBe('');
    expect(portalPositionen('[1,2]')).toBe('');
  });
  test('Quelltext: keine ganzen Zeilen mehr (rowToObj nur ueber nurFelder)', () => {
    const q = lies('routes/festpreis-public.js');
    expect(q).toMatch(/nurFelder\(rowToObj\(header, r\), PORTAL_VERKAUF_FELDER\)/);
    expect(q).toMatch(/nurFelder\(rowToObj\(header, r\), PORTAL_ABRECHNUNG_FELDER\)/);
  });
});
