// FIX3 B4: Wochen-Lebenszeichen - Zaehlung (Workflow-Skript) und Text/Pruefung (Backend).
import { erfolgsTage, LAEUFE } from '../../.github/scripts/lebenszeichen.mjs';
import { lebenszeichenEingabe, lebenszeichenText, LEBENSZEICHEN_LAEUFE } from '../utils/lebenszeichen.js';
import { readFileSync } from 'fs';

const lauf = (zeit, schritt, conclusion = 'success') => ({ created_at: zeit, jobs: [{ steps: [{ name: 'Backend aufwecken', conclusion: 'success' }, { name: schritt, conclusion }] }] });
const S = 'POST /api/festpreis/verkaeufe/sync';

describe('erfolgsTage', () => {
  const seit = new Date('2026-11-12T06:30:00Z');
  test('zaehlt Tage mit erfolgreichem Schritt, nicht rote, nicht vor dem Fenster, doppelte Tage einmal', () => {
    const tage = erfolgsTage([
      lauf('2026-11-13T03:00:00Z', S), lauf('2026-11-13T09:00:00Z', S),   // Knopf/zweiter Lauf am selben Tag
      lauf('2026-11-14T03:00:00Z', S, 'failure'),
      lauf('2026-11-15T03:00:00Z', 'anderer Schritt'),
      lauf('2026-11-11T03:00:00Z', S),                                       // vor dem Fenster
      lauf('2026-11-16T03:00:00Z', S),
    ], S, seit);
    expect([...tage]).toEqual(['2026-11-13', '2026-11-16']);
  });
  test('FP-Sync zaehlt seinen eigenen Schritt, auch wenn der Partner-Sync-Lauf insgesamt rot war', () => {
    const r = { created_at: '2026-11-13T03:00:00Z', jobs: [{ steps: [
      { name: 'POST /api/partner/verkaeufe/sync-all (jfn)', conclusion: 'failure' }, { name: S, conclusion: 'success' }] }] };
    expect(erfolgsTage([r], S, seit).size).toBe(1);
    expect(erfolgsTage([r], 'POST /api/partner/verkaeufe/sync-all (jfn)', seit).size).toBe(0);
  });
  test('Schritt-Namen stehen wirklich in den Workflows', () => {
    for (const l of LAEUFE) {
      const yml = readFileSync(new URL(`../../.github/workflows/${l.workflow}`, import.meta.url), 'utf8');
      expect(yml).toContain(`- name: ${l.schritt}`);
    }
    expect(LAEUFE.map(l => l.name)).toEqual(LEBENSZEICHEN_LAEUFE);
  });
});

describe('lebenszeichenText / Eingabe', () => {
  test('alle 7/7 -> gruen', () => {
    const t = lebenszeichenText(LEBENSZEICHEN_LAEUFE.map(name => ({ name, n: 7, soll: 7 })));
    expect(t).toMatch(/^✅ Wochen-Lebenszeichen: alle Läufe gelaufen/);
    expect(t).toContain('✅ Trikot-Sync 7/7');
  });
  test('fehlender Lauf -> orange mit Anzahl', () => {
    const t = lebenszeichenText([{ name: 'Backup', n: 5, soll: 7 }, { name: 'FP-Sync', n: 7, soll: 7 }]);
    expect(t).toMatch(/^🟠 Wochen-Lebenszeichen: 1 Lauf/);
    expect(t).toContain('🟠 Backup 5/7 – 2 Tag(e) ohne erfolgreichen Lauf');
  });
  test('Eingabe: unbekannter Lauf / falsche Zahlen -> 400', () => {
    expect(() => lebenszeichenEingabe({ laeufe: [{ name: 'Fremd', n: 1, soll: 7 }] })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => lebenszeichenEingabe({ laeufe: [{ name: 'Backup', n: 8, soll: 7 }] })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => lebenszeichenEingabe({})).toThrow(expect.objectContaining({ status: 400 }));
    expect(lebenszeichenEingabe({ laeufe: [{ name: 'Backup', n: 7, soll: 7 }] })).toEqual([{ name: 'Backup', n: 7, soll: 7 }]);
  });
});
