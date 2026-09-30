// Kaltstart-Schutz und Fehlerausgabe der Workflows: GET /health als eigener Schritt vor dem
// ersten POST, bei Fehlern HTTP-Code plus maskierter Text (.github/scripts/antwort-fehler.mjs).
// Anlass: sync-partner-daily Lauf #142 (30.09.) scheiterte mit 500, bevor die App den Request sah.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import yaml from 'js-yaml';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const schritte = name => Object.values(yaml.load(readFileSync(resolve(dir, name), 'utf8')).jobs).flatMap(j => j.steps);

// Datei, Anzahl der POST-Schritte
const WORKFLOWS = [
  ['sync-partner-daily.yml', 3],
  ['trikot-sync-daily.yml', 1],
  ['backup-daily.yml', 1],
].filter(([name]) => {
  // Workflows, die noch nicht umgestellt sind, werden erst mit ihrem Commit geprueft.
  return /aufwecken/i.test(readFileSync(resolve(dir, name), 'utf8'));
});

describe.each(WORKFLOWS)('%s', (name, anzahlPosts) => {
  const s = schritte(name);
  const warm = s.findIndex(x => /aufwecken/i.test(x.name));

  test('Warm-up ist der erste Schritt, vor dem ersten POST', () => {
    expect(warm).toBe(0);
    const erstePost = s.findIndex(x => /-X POST/.test(x.run ?? ''));
    expect(erstePost).toBeGreaterThan(warm);
  });

  test('ruft GET /health (nicht /health/full) und pollt alle 5 s bis 60 s', () => {
    const run = s[warm].run;
    expect(run).toMatch(/"\$API_URL\/health"/);
    expect(run).not.toMatch(/health\/full/);
    expect(run).not.toMatch(/-X POST/);
    expect(run).toMatch(/sleep 5/);
    expect(run).toMatch(/-ge 60/);
    expect(run).toMatch(/\[ "\$http" = "200" \] && exit 0/);
  });

  test('ohne 200 wird der Lauf rot mit klarer Meldung', () => {
    expect(s[warm].run).toMatch(/::error::Backend antwortet nicht mit HTTP 200/);
    expect(s[warm].run).toMatch(/exit 1/);
  });

  test('kein --retry an irgendeinem Schritt', () => {
    for (const x of s) expect(x.run ?? '').not.toMatch(/--retry/);
  });

  test('Fehlerausgabe: Hilfsskript wird geholt und in jedem POST-Schritt bei Fehler aufgerufen', () => {
    const checkout = s.find(x => /actions\/checkout/.test(x.uses ?? ''));
    expect(checkout.with['sparse-checkout']).toBe('.github/scripts');
    const posts = s.filter(x => /-X POST/.test(x.run ?? ''));
    expect(posts).toHaveLength(anzahlPosts);
    for (const p of posts) expect(p.run).toMatch(/antwort-fehler\.mjs response\.json "\$\{http:-\?\}" \|\| true/);
  });
});

describe('sync-partner-daily.yml: Reihenfolge', () => {
  test('Abgleich kommt nach dem Warm-up', () => {
    const s = schritte('sync-partner-daily.yml');
    const abgleich = s.findIndex(x => /artikel\/abgleich/.test(x.name));
    expect(abgleich).toBeGreaterThan(s.findIndex(x => /aufwecken/i.test(x.name)));
  });
});

test('mindestens sync-partner-daily.yml ist umgestellt (Pruefung laeuft nicht leer)', () => {
  expect(WORKFLOWS.map(w => w[0])).toContain('sync-partner-daily.yml');
});
