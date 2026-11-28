// AU-UX2: Menue-Zahl "neue Bestellseiten-Eintraege" (eine Zaehlregel) und Block "Übergeben" in Aufträge.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { ungepruefteZahlen } from '../utils/bestell-uebernahme.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const route = readFileSync(resolve(hier, '../routes/bestellseiten.js'), 'utf8');
const lib = readFileSync(resolve(hier, '../lib/bestellseite.js'), 'utf8');
const zahlBlock = html.slice(html.indexOf('// ── Bestellseiten-Zahl: Anfang'), html.indexOf('// ── Bestellseiten-Zahl: Ende ──'));

describe('Teil A: eine Zaehlregel, Menue-Zahl', () => {
  test('ungepruefteZahlen zaehlt eingegangen + Altstand geprüft, nie übernommen/storniert', () => {
    expect(ungepruefteZahlen([
      { Zugang_ID: 'BS-001', Status: 'eingegangen' }, { Zugang_ID: 'BS-001', Status: '' }, { Zugang_ID: 'BS-002', Status: 'geprüft' },
      { Zugang_ID: 'BS-002', Status: 'übernommen' }, { Zugang_ID: 'BS-003', Status: 'storniert' },
    ]).zahl).toBe(3);
  });
  test('KS8-Knopf und Route nutzen dieselbe Funktion', () => {
    expect(lib).toMatch(/ungepruefteZahlen\(/);
    expect(lib).not.toMatch(/OFFEN\.includes/);
    expect(route).toMatch(/router\.get\('\/offen', mitMeldung\(async \(\) => \(\{ zahl: \(await leseUngepruefte\(\)\)\.zahl \}\)\)\)/);
    // /offen steht vor den Routen mit :zugangId
    expect(route.indexOf("router.get('/offen'")).toBeLessThan(route.indexOf("router.get('/:zugangId"));
  });
  test('Zahl am Hauptreiter Aufträge und am Unterpunkt Bestellseiten, Optik wie die vorhandene Zahl', () => {
    expect(html).toMatch(/<button data-bereich="auftraege"[^>]*>.*<span id="nav-auftraege-badge" class="nav-badge"><\/span><\/button>/);
    expect(zahlBlock).toContain('#bereich-leiste [data-punkt="bestellseiten"]');
    expect(zahlBlock).toContain("classList.toggle('has-count', n > 0)");
    expect(zahlBlock).toContain('noch nicht übernommen');
    expect(zahlBlock).toContain('/api/bestellseiten/offen');
    expect(zahlBlock).not.toMatch(/setInterval|setTimeout|title=/);
  });
  test('nachgefuehrt aus Dashboard und Bestellseiten-Liste, einmal beim Start', () => {
    expect(html).toContain('bsZahlSetzen(j.kacheln?.bestellseiten?.zahl);');
    expect(html).toMatch(/bsZahlSetzen\(\(bsmZ\.daten\?\.zugaenge \?\? \[\]\)\.reduce/);
    expect(html).toMatch(/monInitOnLoad\(\);\s*\n\s*bsZahlLaden\(\);/);
  });
});

describe('Teil B: Block "Übergeben"', () => {
  test('übergebene unten im eingeklappten Block, nicht bezahlt orange (--warning), nie --danger', () => {
    expect(html).toContain('const auIstUebergeben = a => a?.Status === \'übergeben\';');
    expect(html).toContain('<details class="au-ueb-block" id="au-ueb-block"');
    expect(html).toMatch(/\.ku-chip\.au-nicht-bezahlt \{ border-color: var\(--warning\); color: var\(--warning\); \}/);
    expect(html).not.toMatch(/au-nicht-bezahlt[^\n]*--danger/);
    expect(html).toContain('auUebBlockHtml(unten, auUebOffen() || !oben.length)');
  });
  test('auf/zu nur per localStorage mit try/catch, ausserhalb der Auftrags-Sektion', () => {
    expect(html).toMatch(/function auUebOffen\(\) \{ try \{ return localStorage\.getItem\('mc_au_uebergeben_offen'\) === 'ja'; \} catch/);
    const sektion = html.slice(html.indexOf('// ── SECTION: Aufträge – Liste, Ansicht, Erfassen (AM-2) ──'), html.indexOf('// ── SECTION: Artikelerfassung ──'));
    expect(sektion).not.toMatch(/localStorage/);
  });
  test('Mouse-over fuer Blockkopf und Kennzeichen, in der Hilfe-Gruppe auftraege', () => {
    for (const k of ['au-uebergeben-block', 'au-nicht-bezahlt']) {
      expect(html).toMatch(new RegExp(`'${k}':\\s+\\{ name:`));
      expect(html).toContain(`'au-ware', 'au-uebergeben-block', 'au-nicht-bezahlt'`);
    }
  });
});
