// BO4h: Sende-Dialog nach dem Senden. Block `Senden-Ergebnis` (Antwort -> Anzeige) und der Rahmen des Dialogs
// (Box oben, Schliessen, Spinner, automatisches Schliessen) in index.html. Alle Werte erfunden.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Senden-Ergebnis: Anfang');
const bis = html.indexOf('// ── Senden-Ergebnis: Ende ──');
const { sendenAusgang, SENDEN_SCHLIESSEN_MS } = new Function(`${html.slice(von, bis)}\nreturn { sendenAusgang, SENDEN_SCHLIESSEN_MS };`)();
const a0 = html.indexOf('// ── SECTION: An L-Shop senden (BO4c) ──');
const sektion = html.slice(a0, html.indexOf('// ── SECTION:', a0 + 10));

describe('Ausgang des Sendens', () => {
  test.each(['liegt', 'abgeholt'])('Erfolg (%s): gruen, Knopf weg, schliesst nach 5 s', ergebnis => {
    const a = sendenAusgang({ ok: true, status: 200, j: { orderId: 'JFN-2026-0099', ergebnis } });
    expect(a).toMatchObject({ box: 'gruen', titel: 'JFN-2026-0099 an L-Shop gesendet.', schliessen: true, knopfWeg: true });
    expect(a.text).toMatch(/^Positionen stehen auf „bestellt“\./);
    expect(a.text.includes('abgeholt')).toBe(ergebnis === 'abgeholt');
    expect(SENDEN_SCHLIESSEN_MS).toBe(5000);
  });
  test('unklar: rot, "Nicht nochmal senden", bleibt offen', () => {
    const a = sendenAusgang({ ok: false, status: 502, j: { ergebnis: 'unklar', error: 'Unklar, ob … (x)' } });
    expect(a).toMatchObject({ box: 'rot', schliessen: false, knopfWeg: true });
    expect(a.titel).toMatch(/Nicht nochmal senden/);
  });
  test('nicht-da: gelb, Entwurf bleibt, bleibt offen', () => {
    const a = sendenAusgang({ ok: false, status: 502, j: { ergebnis: 'nicht-da', error: 'Nicht gesendet - … Der Entwurf bleibt.' } });
    expect(a).toMatchObject({ box: 'gelb', schliessen: false, knopfWeg: true, text: 'Nicht gesendet - … Der Entwurf bleibt.' });
    expect(sendenAusgang({ ok: false, status: 502, j: { ergebnis: 'nicht-da' } }).text).toMatch(/Der Entwurf bleibt/);
  });
  test('Pruefbericht rot (422) und sonstige Fehler: rot', () => {
    const p = { punkte: [{ regel: 'x', ok: false }] };
    expect(sendenAusgang({ ok: false, status: 422, j: { error: 'rot', pruefung: p } })).toMatchObject({ box: 'rot', pruefung: p, schliessen: false });
    expect(sendenAusgang({ ok: false, status: 500, j: null })).toMatchObject({ box: 'rot', text: 'HTTP 500' });
  });
  test('keine Antwort: rot, nicht nochmal senden', () => {
    expect(sendenAusgang({ fehler: 'Failed to fetch' })).toMatchObject({ box: 'rot', titel: 'Antwort fehlt – nicht nochmal senden.', schliessen: false });
  });
});

describe('Rahmen des Dialogs', () => {
  test('Box oben vor dem Kopf, mit aria-live', () => {
    expect(html.indexOf('id="senden-box"')).toBeLessThan(html.indexOf('id="senden-kopf"'));
    expect(html).toMatch(/id="senden-box" class="senden-box" role="status" aria-live="polite" hidden/);
  });
  test('waehrend des Sendens: Spinner-Text, Schliessen gesperrt; danach "Schließen"', () => {
    expect(sektion).toContain("zu.textContent = sendenZustand.gesendet && !sendenZustand.laeuft ? 'Schließen' : 'Abbrechen';");
    expect(sektion).toContain('zu.disabled = sendenZustand.laeuft;');
    expect(sektion).toContain('<span class="senden-spinner" aria-hidden="true"></span>wird gesendet …');
    expect(sektion).toMatch(/function sendenSchliessen\(\) \{\s+if \(sendenZustand\.laeuft\) return;/);
    expect(sektion).toContain('knopf.hidden = !!a?.knopfWeg;');
  });
  test('Erfolg: Timer schliesst, Bestellungen werden neu geladen; Oeffnen raeumt den Timer ab', () => {
    expect(sektion).toContain('if (sendenZustand.ausgang.schliessen) {\n            sendenZustand.zuTimer = setTimeout(sendenSchliessen, SENDEN_SCHLIESSEN_MS);');
    expect(sektion).toMatch(/finally \{[\s\S]*await loadLShopBestellungen\(\);/);
    expect(sektion).toMatch(/async function sendenOeffnen\(orderId\) \{\s+clearTimeout\(sendenZustand\.zuTimer\);/);
  });
  test('Box-Text nur ueber textContent (Fehlertexte vom Server)', () => {
    expect(sektion).toContain("box.querySelector('strong').textContent = a.titel;");
    expect(sektion).not.toMatch(/\$\{a\.(titel|text)\}/);
  });
  test('weiter genau ein Sende-Aufruf, nie ein zweiter Klick', () => {
    expect([...html.matchAll(/\/api\/bestellen\/lshop-korb\/edi\/senden`/g)]).toHaveLength(1);
    expect(sektion).toContain('if (!v?.gruen || sendenZustand.laeuft || sendenZustand.gesendet) return;');
  });
});
