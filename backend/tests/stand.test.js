// Stand-Anzeige: welcher Code laeuft, Backend UND Oberflaeche.
//
// Backend: GET /health meldet commit (7 Zeichen) und gebaut (ISO-8601), ohne
// API-Key und ohne weitere Umgebung. Fehlt der Wert, "unbekannt" - weiter 200.
// Oberflaeche: index.html traegt zwei Platzhalter, die deploy.yml stempelt.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret:   jest.fn(async key => process.env[key] ?? ''),
  loadAllSecrets: jest.fn(),
}));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const index      = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const pages      = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
const backendWf  = readFileSync(resolve(root, '.github/workflows/deploy-backend.yml'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');

// Nicht als ein Literal, sonst traefe das sed im Workflow auch diese Datei.
const P_COMMIT = '__MC_' + 'COMMIT__';
const P_GEBAUT = '__MC_' + 'GEBAUT__';

let request, app, leseStand;

beforeAll(async () => {
  process.env.MC_API_KEY = 'geheim';
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  const { requireApiKey } = await import('../middleware/auth.js');
  const stand = await import('../utils/stand.js');
  leseStand = stand.leseStand;

  // Derselbe Aufbau wie in index.js: /health liegt hinter der Schranke.
  app = express();
  app.use(requireApiKey);
  app.get('/health', stand.healthHandler);
});

afterEach(() => {
  delete process.env.MC_COMMIT;
  delete process.env.MC_GEBAUT;
});

describe('GET /health meldet den Stand', () => {
  test('mit gesetztem Wert: commit 7 Zeichen, gebaut gesetzt, status ok', async () => {
    process.env.MC_COMMIT = 'a8be8b2c0ffee1234567890abcdef1234567890a';
    process.env.MC_GEBAUT = '2026-09-23T10:15:00Z';
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.commit).toBe('a8be8b2');
    expect(res.body.gebaut).toBe('2026-09-23T10:15:00Z');
  });

  test('ohne Wert: "unbekannt", weiter 200 und ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.commit).toBe('unbekannt');
    expect(res.body.gebaut).toBe('unbekannt');
  });

  test('braucht keinen API-Key', async () => {
    process.env.MC_COMMIT = 'a8be8b2';
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  test('gibt nichts ausser status, ts, commit, gebaut aus', async () => {
    process.env.MC_COMMIT = 'a8be8b2';
    process.env.MC_GEBAUT = '2026-09-23T10:15:00Z';
    const res = await request(app).get('/health');
    expect(Object.keys(res.body).sort()).toEqual(['commit', 'gebaut', 'status', 'ts']);
  });

  test('Muell im Wert wird "unbekannt", nicht durchgereicht', () => {
    expect(leseStand({ MC_COMMIT: 'nicht-hex', MC_GEBAUT: 'gestern' }))
      .toEqual({ commit: 'unbekannt', gebaut: 'unbekannt' });
    expect(leseStand({ MC_COMMIT: '', MC_GEBAUT: '' }))
      .toEqual({ commit: 'unbekannt', gebaut: 'unbekannt' });
  });
});

describe('Backend-Stand kommt als Build-Arg ins Image', () => {
  test('Dockerfile reicht ARG an ENV durch', () => {
    expect(dockerfile).toMatch(/ARG MC_COMMIT/);
    expect(dockerfile).toMatch(/ARG MC_GEBAUT/);
    expect(dockerfile).toMatch(/ENV MC_COMMIT=\$MC_COMMIT MC_GEBAUT=\$MC_GEBAUT/);
  });

  test('Workflow uebergibt beide Build-Args', () => {
    expect(backendWf).toMatch(/--build-arg MC_COMMIT=/);
    expect(backendWf).toMatch(/--build-arg MC_GEBAUT=/);
  });

  test('Stand wird nicht als Service-Variable gesetzt', () => {
    // --set-env-vars ersetzt alle Variablen; der Stand hat dort nichts zu suchen.
    expect(backendWf).not.toMatch(/env-vars[^\n]*MC_(COMMIT|GEBAUT)/);
  });
});

describe('Oberflaechen-Stand', () => {
  test('index.html traegt jeden Platzhalter genau einmal, im Meta-Tag', () => {
    expect(index.split(P_COMMIT)).toHaveLength(2);
    expect(index.split(P_GEBAUT)).toHaveLength(2);
    expect(index).toContain(`<meta name="mc-commit" content="${P_COMMIT}" />`);
    expect(index).toContain(`<meta name="mc-gebaut" content="${P_GEBAUT}" />`);
  });

  test('sonst kommt "__MC_" in index.html nicht vor', () => {
    expect(index.split('__MC_')).toHaveLength(3);
  });

  test('ohne Stempel zeigt die Oberflaeche "lokal"', () => {
    expect(index).toMatch(/kurzCommit\([^)]*mc-commit[^)]*\)\?\.content\) \?\? 'lokal'/);
  });

  test('Backend nicht erreichbar ist ein Text, kein Toast', () => {
    const start = index.indexOf('SECTION: Stand-Anzeige');
    const ende  = index.indexOf('zeigeStand();', start);
    const block = index.slice(start, ende);
    expect(block).toContain('Backend nicht erreichbar');
    expect(block).not.toMatch(/showToast/);
  });

  test('Pages-Workflow stempelt beide Platzhalter und bricht ab, wenn einer bleibt', () => {
    expect(pages).toMatch(/sed -i .*__MC_COMMIT__.*__MC_GEBAUT__.*frontend\/index\.html/);
    expect(pages).toMatch(/grep -q "__MC_" frontend\/index\.html/);
  });

  test('gestempelt wird vor dem Upload des Artefakts', () => {
    const stempel = pages.indexOf('Stand stempeln');
    const upload  = pages.indexOf('upload-pages-artifact');
    expect(stempel).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(stempel);
  });
});
