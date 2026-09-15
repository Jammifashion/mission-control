// Die Erfassungsmaske wurde ueberall bis BZ (78 Spalten) gelesen. Eine Spalte
// dahinter - etwa eine zur Laufzeit angehaengte "Marke" - waere unsichtbar
// geblieben: POST /erfassung haette sie nie beschrieben, und ein Anhaengen
// ueber header.length haette auf eine belegte Spalte zeigen koennen.
// Seit dem Umbau werden ganze Zeilen gelesen ('1:2000', 'N:N').

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDNER  = ['routes', 'lib', 'utils', 'scripts'];

const quellen = ORDNER.flatMap(o =>
  readdirSync(join(backend, o), { recursive: true })
    .filter(f => String(f).endsWith('.js'))
    .map(f => join(o, String(f))),
);

// Erfassungsmaske!… oder ${TAB_ERF}!… / ${TAB_ERFASSUNG}!… bis zum Stringende.
const BEREICH = /(?:Erfassungsmaske|\$\{TAB_ERF(?:ASSUNG)?\})!([^'"`\s]*)/g;

const bereiche = quellen.flatMap(datei => {
  const src = readFileSync(join(backend, datei), 'utf8');
  return [...src.matchAll(BEREICH)].map(m => ({ datei, bereich: m[1] }));
});

// Endspalte begrenzt: Teil nach dem Doppelpunkt beginnt mit einem Buchstaben
// (BZ2000, BZ${row}) - oder der Start hat eine Spalte vor der Zeile (A1:…).
const begrenzt = b => b.includes(':') && b.split(':').some(teil => /^[A-Za-z]/.test(teil));

describe('Erfassungsmaske-Bereiche ohne feste Endspalte', () => {
  test('es werden ueberhaupt Bereiche gefunden', () => {
    expect(bereiche.filter(b => b.bereich.includes(':')).length).toBeGreaterThanOrEqual(10);
  });

  test('kein Bereich ist auf eine Spalte begrenzt', () => {
    expect(bereiche.filter(b => begrenzt(b.bereich))).toEqual([]);
  });

  test.each([
    ['A1:BZ2000', true],
    ['A${rowNum}:BZ${rowNum}', true],
    ['A:A', true],
    ['1:2000', false],
    ['${rowNum}:${rowNum}', false],
    ['1:1', false],
    ['A1', false],
  ])('Pruefregel: %s begrenzt=%s', (bereich, erwartet) => {
    expect(begrenzt(bereich)).toBe(erwartet);
  });
});
