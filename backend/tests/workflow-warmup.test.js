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
];

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

describe('oeffentliches Actions-Log: keine ungefilterte Antwortausgabe', () => {
  const text = name => readFileSync(resolve(dir, name), 'utf8');

  test('backup-daily.yml gibt den Fehlertext der Antwort nicht roh aus', () => {
    expect(text('backup-daily.yml')).not.toMatch(/then \{error\}/);
  });
});

describe('Trikot-Sync: Ausgabe nur als Zaehler', () => {
  const text = readFileSync(resolve(dir, 'trikot-sync-daily.yml'), 'utf8');

  test.each(['sync-partner-daily.yml', 'trikot-sync-daily.yml', 'backup-daily.yml'])(
    '%s gibt die Antwort nie ungefiltert aus (kein jq . und kein cat response.json)', name => {
      const t = readFileSync(resolve(dir, name), 'utf8');
      expect(t).not.toMatch(/jq\s+\.\s/);
      expect(t).not.toMatch(/cat\s+response\.json/);
    });

  test('Trikot: nur Zaehlerfelder, keine Zahlart-Namen, kein Zeilen-/Namensfeld', () => {
    expect(text).toMatch(/\{gelesen, neu, dubletten, quellen,/);
    expect(text).toMatch(/zahlarten: \(\(\.zahlarten \/\/ \{\}\) \| length\)/);
    expect(text).not.toMatch(/\.zeilen|\.name|Name|Nummer/);
  });
});

describe('modell-check.yml: Fehlerausgabe', () => {
  const name = 'modell-check.yml';
  const s = schritte(name);
  const text = readFileSync(resolve(dir, name), 'utf8');

  test('Fehlertext nicht roh: fester Text statt {error}, keine ungefilterte Ausgabe', () => {
    expect(text).not.toMatch(/then \{error\}/);
    expect(text).toMatch(/then \{error: "Modell-Check fehlgeschlagen"\}/);
    expect(text).not.toMatch(/jq\s+\.\s/);
    expect(text).not.toMatch(/cat\s+response\.json/);
  });

  test('Hilfsskript wird geholt, der POST ruft bei Fehler die maskierte Zeile auf, kein --retry', () => {
    const checkout = s.find(x => /actions\/checkout/.test(x.uses ?? ''));
    expect(checkout.with['sparse-checkout']).toBe('.github/scripts');
    const posts = s.filter(x => /-X POST/.test(x.run ?? ''));
    expect(posts).toHaveLength(1);
    expect(posts[0].run).toMatch(/antwort-fehler\.mjs response\.json "\$\{http:-\?\}" \|\| true/);
    for (const x of s) expect(x.run ?? '').not.toMatch(/--retry/);
  });
});
