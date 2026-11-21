// SI2: Betriebsangaben (Projekt, Dienstkonten, Ablage-Ordner, Partner-Sonderregeln) nicht im Repo.
// Der Deploy holt Projekt/Dienstkonto/Workload-Identity aus GitHub-Repo-Variablen und stoppt mit Meldung, wenn eine fehlt.
import { jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [], getSecret: jest.fn(async () => ''), loadAllSecrets: jest.fn(),
}));

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lies = p => readFileSync(resolve(repo, p), 'utf8');

function dateien(dir, ausser = new Set(['node_modules', 'tests', '.git'])) {
  const out = [];
  for (const n of readdirSync(dir)) {
    if (ausser.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...dateien(p, ausser));
    else if (/\.(js|mjs|yml|yaml|html)$/.test(n)) out.push(p);
  }
  return out;
}

describe('Deploy-Workflow nimmt Repo-Variablen', () => {
  const wf = lies('.github/workflows/deploy-backend.yml');
  test('Projekt, Dienstkonto, Anbieter nur aus vars', () => {
    expect(wf).toContain('GCP_PROJECT_ID:   ${{ vars.GCP_PROJECT_ID }}');
    expect(wf).toContain('workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}');
    expect(wf).toContain('service_account: ${{ vars.GCP_SA }}');
    expect(wf).toContain('--service-account ${GCP_SA}');
    expect(wf).toContain('GOOGLE_PROJECT_ID=${GCP_PROJECT_ID}');
    expect(wf).not.toMatch(/projects\/\d{6,}\//);                      // keine Projektnummer
    expect(wf).not.toMatch(/[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/);
  });
  test('Pruefschritt steht vor Checkout und Anmeldung und bricht mit Meldung ab', () => {
    const pruef = wf.indexOf('name: Repo-Variablen pruefen');
    expect(pruef).toBeGreaterThan(0);
    expect(wf.indexOf('name: Google Auth')).toBeGreaterThan(pruef);
    const block = wf.slice(pruef, wf.indexOf('name: Checkout', pruef));
    expect(block).toContain('for n in GCP_PROJECT_ID GCP_SA GCP_WIF_PROVIDER; do');
    expect(block).toMatch(/::error::GitHub-Repo-Variable\(n\) fehlen:\$fehlt .*Kein Deploy\."\n\s+exit 1/);
  });
});

describe('Keine Betriebsangaben im Code', () => {
  const quellen = [
    ...dateien(resolve(repo, 'backend')), ...dateien(resolve(repo, '.github')), ...dateien(resolve(repo, 'tools')),
    resolve(repo, '.env.example'), resolve(repo, 'CLAUDE.md'),
  ];
  test.each([
    ['Dienstkonto-Adresse', /\b(?!job-test@|fremd@)[a-z][a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/],
    ['Projekt-Kennung mit Nummer', /mission-control-\d{6}/],
    ['Drive-Ordner-ID als Konstante', /ORDNER_ID\s*=\s*[^;\n]*['"][A-Za-z0-9_-]{25,}['"]/],
  ])('%s', (_name, re) => {
    const treffer = quellen.filter(f => re.test(readFileSync(f, 'utf8'))).map(f => f.slice(repo.length + 1));
    expect(treffer).toEqual([]);
  });
});

describe('Rueckstandsliste: Ordner aus der Umgebung', () => {
  test('fehlt der Ordner, 503 rueckstand_einrichtung - kein geratener Ordner', async () => {
    delete process.env.RUECKSTAND_ORDNER_ID;
    const { leseRueckstand, _rueckstandCacheLeeren } = await import('../lib/rueckstand.js');
    _rueckstandCacheLeeren();
    const list = jest.fn();
    await expect(leseRueckstand({ drive: { files: { list } } })).rejects.toMatchObject({ status: 503, code: 'rueckstand_einrichtung' });
    expect(list).not.toHaveBeenCalled();
  });
  test('mit Ordner aus der Umgebung wird genau dieser gelesen', async () => {
    process.env.RUECKSTAND_ORDNER_ID = 'ordner-erfunden';
    const { leseRueckstand, _rueckstandCacheLeeren } = await import('../lib/rueckstand.js');
    _rueckstandCacheLeeren();
    const list = jest.fn(async () => ({ data: { files: [] } }));
    const r = await leseRueckstand({ drive: { files: { list } } });
    expect(r.liste).toBeNull();
    expect(list.mock.calls[0][0].q).toBe("'ordner-erfunden' in parents and trashed = false");
    delete process.env.RUECKSTAND_ORDNER_ID;
  });
});
