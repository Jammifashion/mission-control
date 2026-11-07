// SG1 (07.11.): Reiter SEO-Daten - Knopf "Beschreibung generieren" unter den Vorgaben, Hinweise sichtbar, Faser-Hinweis nur bei
// Textilien, Regel 10 Zeitbezug, Rueckfall-Keyphrase fuer SEO-Titel/Meta. Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { materialAusEigenschaften, FASER_FEHLT_HINWEIS } from '../lib/seo-prompt.js';
import { metaEingaben, baueSeoTitel } from '../lib/seo-meta.js';
import { pruefeGeneratorText, zeitJahre } from '../lib/seo-pruefung.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');

describe('1. Knopf "Beschreibung generieren" unter den Vorgaben', () => {
  const pos = s => html.indexOf(s);
  test('Reihenfolge Eigenschaften -> Generieren (+ Kurzmeldung) -> Kurzbeschreibung -> ... -> SEO Speichern', () => {
    const eig = pos('id="seo-eigenschaften"'), knopf = pos('id="btn-seo-generate"'), kurz = pos('id="seo-generate-msg"');
    const kb = pos('id="rich-seo-short"'), speichern = pos('id="btn-seo-save"');
    expect(eig).toBeGreaterThan(0);
    expect(knopf).toBeGreaterThan(eig);
    expect(kurz).toBeGreaterThan(knopf);
    expect(kb).toBeGreaterThan(kurz);
    expect(speichern).toBeGreaterThan(kb);
    expect(html.match(/id="btn-seo-generate"/g)).toHaveLength(1);
    expect(html).toContain('Erzeugt Kurzbeschreibung und Artikelbeschreibung aus den Feldern oben.');
    const aktionen = html.slice(html.lastIndexOf('<div class="panel-actions">', speichern), speichern + 200);
    expect(aktionen).not.toContain('btn-seo-generate');
    expect(html.slice(knopf - 120, knopf + 200)).not.toMatch(/\btitle=/);
  });
  const block = html.slice(html.indexOf('function seoGenerierenKurz'), html.indexOf('function generatorMeldungen('));
  const F = new Function(`${block}\nreturn { seoGenerierenKurz, seoKeyphraseEffektiv };`)();
  test('Kurzzeile: Anzahl Hinweise -> "siehe unten", sonst neutral', () => {
    expect(F.seoGenerierenKurz(['a', 'b'])).toEqual({ text: '2 Hinweise – siehe unten bei „SEO Speichern“.', rot: true });
    expect(F.seoGenerierenKurz([], true)).toEqual({ text: '1 Hinweis – siehe unten bei „SEO Speichern“.', rot: true });
    expect(F.seoGenerierenKurz([])).toEqual({ text: 'Erzeugt – bitte prüfen, dann unten speichern.', rot: false });
  });
  test('Kurzzeile wird nach dem Generieren und bei Fehlern gefuellt', () => {
    const gen = html.slice(html.indexOf("getElementById('btn-seo-generate').addEventListener"), html.indexOf('async function seoTextNachSpeichernPruefen'));
    expect(gen).toContain("document.getElementById('seo-generate-msg')");
    expect(gen).toContain('seoGenerierenKurz(meldungenAlle, gemeldet)');
    expect(gen).toMatch(/catch \(e\) \{[\s\S]*kurzMsg\.textContent = `Fehler: \$\{e\.message\}`/);
  });

  describe('4. Fokus-Keyphrase leer -> Produkttitel ohne Farbe/Groesse', () => {
    test('Feld gesetzt -> wie bisher; leer -> Rueckfall markiert; beides leer -> leer', () => {
      expect(F.seoKeyphraseEffektiv(' Fanschal Club ', 'Christbaum Kugel')).toEqual({ wert: 'Fanschal Club', ausTitel: false });
      expect(F.seoKeyphraseEffektiv('', 'Christbaum Kugel 4er Packung')).toEqual({ wert: 'Christbaum Kugel 4er Packung', ausTitel: true });
      expect(F.seoKeyphraseEffektiv('', '')).toEqual({ wert: '', ausTitel: false });
    });
    test('Backend: Rueckfall aus dem Produkttitel (ohne Farbe/Groesse), Titel nach Muster', () => {
      const e = metaEingaben({ eigenschaften: '', farben: ['Rot'], groessen: ['M', 'L'], produktname: 'Christbaum Kugel Rot M Testclub' });
      expect(e.keyphraseAusTitel).toBe('Christbaum Kugel Testclub');
      expect(baueSeoTitel(e.keyphraseAusTitel)).toBe('Christbaum Kugel Testclub %%sep%% %%sitename%%');
      expect(metaEingaben({ eigenschaften: '', farben: [], groessen: [] })).not.toHaveProperty('keyphraseAusTitel');
    });
    test('SEO-Reiter nutzt den Rueckfall fuer Titel/Meta und setzt ihn sichtbar ins Feld (nach dem Generieren und vor Sheet/Yoast)', () => {
      expect(html).toContain("produktname: seoCurrentItem?.produktname || '',");
      expect(html).toContain("seoKeyphraseEffektiv(document.getElementById('seo-keyphrase').value, ein.keyphraseAusTitel)");
      const save = html.slice(html.indexOf("getElementById('btn-seo-save').addEventListener"));
      expect(save.indexOf('seoKeyphraseAusTitelSetzen()')).toBeLessThan(save.indexOf('erfassung/patch-fields'));
      expect(save.indexOf('seoKeyphraseAusTitelSetzen()')).toBeGreaterThan(save.indexOf("if (!wcRes.ok)"));
    });
  });
});

describe('2. Faser-Hinweis nur bei Textilien', () => {
  const hinweis = (eig, groessen = []) => materialAusEigenschaften(eig, [], { groessen }).faserHinweis;
  test('Glaskugel/Tasse ohne Groessen: "Material: Glas" bleibt still', () => {
    expect(hinweis('Material: Glas\nDurchmesser: 8 cm')).toBeNull();
    expect(hinweis('Material: Keramik')).toBeNull();
    expect(hinweis('')).toBeNull();
  });
  test('Textil: Material-Zeile mit Faser/Stoff ohne Prozent, oder Groessen-Achse', () => {
    expect(hinweis('Material: Jersey')).toBe(FASER_FEHLT_HINWEIS);
    expect(hinweis('Material: Baumwolle')).toBe(FASER_FEHLT_HINWEIS);
    expect(hinweis('Schnitt: Regular', ['S', 'M'])).toBe(FASER_FEHLT_HINWEIS);
  });
  test('Faserangabe mit Prozent -> kein Hinweis', () => {
    expect(hinweis('Material: 100 % Baumwolle', ['S'])).toBeNull();
  });
});

describe('3. Regel 10 Zeitbezug', () => {
  const lang = (t, x = {}) => pruefeGeneratorText({ kurzbeschreibung: '', produktbeschreibung: `<h2>Logo</h2><p>${t}</p>`, ...x })
    .filter(h => /Zeitbezug|Jahreszahl/.test(h));
  test.each([
    ['Am Baum hängt sie dieses Jahr dazu.', 'dieses Jahr'],
    ['Perfekt für diesen Winter.', 'diesen Winter'],
    ['Heuer ein Muss.', 'Heuer'],
    ['Auch nächstes Jahr noch schön.', 'nächstes Jahr'],
    ['Für diese Saison gemacht.', 'diese Saison'],
  ])('%s -> Meldung', (satz, fund) => {
    expect(lang(satz)).toEqual([`Zeitbezug "${fund}" in Produktbeschreibung – Texte bleiben zeitlos (kein Jahr, keine Saison).`]);
  });
  test('Jahreszahl im Fliesstext meldet, Kollektions-/Saisonname, Produkt- und Kategoriename nicht', () => {
    expect(lang('Gedacht für die Halloween-Saison 2026.')).toEqual(['Jahreszahl "2026" in Produktbeschreibung – Texte bleiben zeitlos (kein Jahr, keine Saison).']);
    expect(lang('Teil der Halloween-Kollektion 2026.')).toEqual([]);
    expect(lang('Der Fanschal 2026/2027 und die Saison 2026/27.')).toEqual([]);
    expect(lang('Der Fanschal 2026 hält warm.', { produktname: 'Fanschal 2026' })).toEqual([]);
    expect(lang('Logo 2025 vorne.', { kategorien: 'Kollektion 2025' })).toEqual([]);
    expect(zeitJahre('ab 2028 und 2028', {})).toEqual(['2028', '2028']);
  });
  test('kein Fehlalarm bei "dieser Jahreszeit", "Kollektion 26/27", Zahlen ausserhalb 20xx', () => {
    expect(lang('Passend zu dieser Jahreszeit. Kollektion 26/27. 1999 gegründet, 150 g/m².')).toEqual([]);
  });
  test('Regel steht nur im Code, nie im Prompt', async () => {
    const { SEO_SYSTEM_PROMPT } = await import('../lib/seo-prompt.js');
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/dieses Jahr|heuer|zeitlos/i);
  });
});
