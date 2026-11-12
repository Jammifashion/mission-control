// TR10: bestätigtes GK auf der Trikot-Seite als gefülltes Kästchen in der Warnfarbe; offenes "GK? prüfen" und die Karte der
// Shop-Bestellung bleiben, wie sie sind. Nur Oberflaeche.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const regel = sel => { const i = html.indexOf(`\n      ${sel} {`); return i < 0 ? '' : html.slice(i, html.indexOf('\n', i + 1)); };

describe('TR10: GK-Kästchen', () => {
  test('bestätigt = gefuellt --warning, Schrift --bg, nur Variablen', () => {
    const r = regel('.tr-gk');
    expect(r).toContain('background: var(--warning)');
    expect(r).toContain('color: var(--bg)');
    expect(r).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });
  test('offen "GK? prüfen" unveraendert: oranger Text, nur getoent', () => {
    const r = regel('.tr-gk-frage');
    expect(r).toContain('color: var(--warning)');
    expect(r).toContain('background: color-mix(in srgb, var(--warning) 14%, transparent)');
  });
  test('Trikotzeile, "noch nicht beim Produzenten" und Auswahl der Produzenten-Bestellung tragen Kästchen + Mouse-over, kein title', () => {
    expect(html).toContain(`const trGkHtml = z => (z.goalie ? '<span class="tr-gk" tabindex="0" data-hilfe="tr-goalie">GK</span>' : '');`);
    expect(html).toContain(`\${z.goalie ? ' <span class="tr-gk" data-hilfe="tr-goalie">GK</span>' : ''}`);
    expect(html).toContain("'tr-goalie':            { name: 'GK', text: 'Goalie bestätigt – beim Produzenten GK-Größe + GOALI.' }");
    expect(html).not.toMatch(/class="tr-gk"[^>]*title=/);
  });
  test('Karte der Shop-Bestellung unveraendert (" · GK" / " · GK n")', () => {
    expect(html).toContain("if (k && st.goalie) k.text += ` · GK${st.trikots > 1 ? ` ${st.goalie}` : ''}`;   // TR7");
  });
});
