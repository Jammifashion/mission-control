// MI1: Mika im Browser (frontend/index.html) - Anzeige, Spruenge, Knopf nie ueber offenen Fenstern, Spiegel zum Backend.
// Nur erfundene Daten.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LISTEN, ZIEL_ARTEN, FEHLER_TEXT, mikaDringend } from '../utils/mika.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Mika: Anfang'), html.indexOf('// ── Mika: Ende ──'));
const { mikaAntwortHtml, MIKA_LISTEN, MIKA_ZIEL_ARTEN, MIKA_FEHLER } = new Function(`${block}\nreturn { mikaAntwortHtml, MIKA_LISTEN, MIKA_ZIEL_ARTEN, MIKA_FEHLER };`)();
const sektion = html.slice(html.indexOf('// ── SECTION: Mika (MI1) ──'), html.indexOf('// ── SECTION: Feedback (FB1) ──'));
const css = html.slice(html.indexOf('/* ── Mika: CSS (MI1)'), html.indexOf('/* ── Mika: CSS Ende ── */'));
const markup = html.slice(html.indexOf('<!-- MI1: Mika'), html.indexOf('<!-- FB1: Feedback'));
const tag = id => (new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html) ?? [''])[0];

describe('Spiegel zum Backend (utils/mika.js)', () => {
  test('Ziel-Arten, Listen, Fehlertext gleich', () => {
    expect(MIKA_ZIEL_ARTEN).toEqual(ZIEL_ARTEN);
    expect(Object.keys(MIKA_LISTEN).sort()).toEqual([...LISTEN].sort());
    expect(MIKA_FEHLER).toBe(FEHLER_TEXT);
    expect(MIKA_FEHLER).toBe('Mika findet gerade nichts – bitte die Liste direkt öffnen.');
  });
});

describe('Anzeige', () => {
  const antwort = mikaDringend({
    dash: { fehler: [], kacheln: { lange: { liste: Array.from({ length: 7 }, (_, i) => ({ art: 'shop', shop: 'jfn', shopKurz: 'JFN', nr: String(90100 + i), id: 90100 + i, tage: 30 - i, grund: [] })) } } },
    au: { auftraege: [{ Auftrag_Nr: 'AU-2026-0003', Kurztitel: '<img src=x onerror=alert(1)>', Status: 'fertig' }] }, jetzt: new Date('2026-11-18T10:00:00Z'),
  });
  const { html: h, ziele } = mikaAntwortHtml(antwort);
  test('Eintraege als Knoepfe mit Mouse-over, Ziel als Index in eine feste Liste', () => {
    expect((h.match(/<button type="button" class="mika-eintrag" data-mika-ziel="\d+" data-hilfe="mika-sprung">/g) ?? []).length).toBe(6);
    expect(ziele[0]).toEqual({ art: 'shop', shop: 'jfn', id: '90100' });
    expect(h).not.toMatch(/<[^>]*\s(title|on\w+|href)=/);   // kein Attribut dieser Art (der maskierte Kurztitel ist nur Text)
  });
  test('"… und n weitere" springt in die Liste', () => {
    expect(h).toContain('… und 2 weitere</button>');
    expect(h).toMatch(/class="korb-link mika-mehr" data-mika-ziel="(\d+)" data-hilfe="mika-mehr"/);
    const i = Number(/class="korb-link mika-mehr" data-mika-ziel="(\d+)"/.exec(h)[1]);
    expect(ziele[i]).toEqual({ art: 'liste', liste: 'lange' });
  });
  test('Text immer maskiert (Kurztitel ist Freitext)', () => {
    expect(h).not.toContain('<img');
    expect(h).toContain('&#60;img');
  });
  test('fremde Ziel-Art wird kein Knopf', () => {
    const r = mikaAntwortHtml({ titel: 't', gruppen: [{ titel: 'g', eintraege: [{ text: 'x', ziel: { art: 'url', href: 'https://example.invalid' } }], mehr: 0, anzahl: 1 }] });
    expect(r.ziele).toEqual([]);
    expect(r.html).not.toContain('<button');
  });
  test('leer, unvollstaendig, nichts', () => {
    expect(mikaAntwortHtml({ titel: 'Was ist dringend?', gruppen: [], leer: 'Nichts Dringendes.' }).html).toContain('<p class="mika-leer">Nichts Dringendes.</p>');
    expect(mikaAntwortHtml({ titel: 't', gruppen: [], unvollstaendig: true }).html).toContain('mika-hinweis');
    expect(mikaAntwortHtml(null)).toEqual({ html: '', ziele: [] });
  });
});

describe('Knopf und Fenster', () => {
  test('Knopf: Mouse-over statt title, rund, >= 44 px', () => {
    expect(tag('mika-knopf')).toMatch(/data-hilfe="mika-oeffnen"/);
    expect(tag('mika-knopf')).not.toMatch(/\btitle=/);
    expect(css).toMatch(/\.mika-knopf \{[^}]*width: 3\.25rem; height: 3\.25rem; border-radius: 50%/);   // 52 px
  });
  test('Kopf "Mika – hilft dir beim Finden", kein Hinweis auf KI im Fenster', () => {
    expect(markup).toContain('<strong id="mika-titel">Mika – hilft dir beim Finden</strong>');
    const sichtbar = markup.replace(/<!--[\s\S]*?-->/g, '');
    const hilfe = [...html.matchAll(/'(mika-[a-z-]+)':\s+\{ name: '([^']*)', text: '([^']*)' \}/g)].map(m => m[2] + m[3]).join(' ');
    expect(hilfe.length).toBeGreaterThan(100);
    for (const t of [sichtbar, hilfe]) expect(t).not.toMatch(/\bKI\b|Claude|künstlich/i);
  });
  test('drei feste Fragen, kein freies Chatfeld, keine Spracheingabe', () => {
    expect([...markup.matchAll(/data-mika-frage="(\w+)"/g)].map(m => m[1])).toEqual(['heute', 'dringend', 'suche']);
    expect(markup).not.toMatch(/<textarea|webkitSpeechRecognition|SpeechRecognition/);
    expect(sektion).not.toMatch(/SpeechRecognition/);
    expect((markup.match(/<input /g) ?? []).length).toBe(1);   // nur das Nummernfeld
  });
  test('Knopf ist ausgeblendet, solange irgendein Fenster offen ist (jede Form aus NV_DIALOG)', () => {
    const nv = /const NV_DIALOG = '([^']+)'/.exec(html)[1].split(',').map(x => x.trim());
    const has = /body:has\(([^)]+(?:\)[^)]*)*?)\) \.mika-knopf \{ display: none; \}/.exec(css);
    expect(has).not.toBeNull();
    for (const sel of [...nv, '#ps-bild-gross:not([hidden])', '#mika-fenster:not([hidden])']) expect([sel, css.includes(sel)]).toEqual([sel, true]);
    expect(tag('anmelde-maske')).toMatch(/class="edi-dialog"/);   // Anmeldung = .edi-dialog -> auch dort weg
    // liegt unter jedem Fenster (z-index < .edi-dialog 50)
    expect(Number(/\.mika-knopf \{[^}]*z-index: (\d+)/.exec(css)[1])).toBeLessThan(50);
  });
  test('Aktionsleiste unten und Ende jeder Ansicht bleiben frei', () => {
    expect(css).toContain('.korb-leiste { padding-right: 4.5rem; }');
    expect(css).toContain('.panel { padding-bottom: 5rem; }');
    expect(css).toContain('body:has(#neue-version:not([hidden])) .mika-knopf { bottom: 5rem; }');
  });
  test('Handy: Blatt von unten (volle Breite), Feld 16 px, Tippflaechen 44 px', () => {
    expect(css).toMatch(/@media \(max-width: 600px\) \{[\s\S]*\.mika-fenster \{ left: 0; right: 0; bottom: 0; width: auto;/);
    expect(css).toMatch(/\.mika-suche-reihe \.form-input \{[^}]*min-height: 44px; font-size: 16px;/);
    expect(css).toMatch(/\.mika-eintrag \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.mika-fragen \.korb-aktion \{[^}]*min-height: 44px/);
  });
  test('Farben nur ueber Variablen', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });
  test('ⓘ im Fenster, Fenster bekommt Tooltips wie die anderen', () => {
    expect(markup).toMatch(/data-hilfe-gruppe="mika" aria-controls="hilfe-mika"/);
    expect(html).toMatch(/const HILFE_FENSTER = '[^']*#mika-fenster'/);
  });
});

describe('Verhalten (Quelltext)', () => {
  test('nur POST, Nummer nie in Adresse oder Browser-Speicher', () => {
    expect(sektion).toContain("apiFetch(`${API_BASE()}/api/mika/${pfad}`, { method: 'POST'");
    expect(sektion).not.toMatch(/localStorage|sessionStorage|history\.|location\.hash/);
  });
  test('Vorlesen ueber den gemeinsamen Baustein, keine Kopie', () => {
    expect(sektion).toContain('const mkv = vorleser({');
    expect(sektion).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/);
  });
  test('Fehler: fester Text; 422 = Text vom Server (fester Eingabe-Text)', () => {
    expect(sektion).toContain("if (res.status === 422 && j?.error) mikaFehler(j.error);");
    expect(sektion).toContain('else if (!res.ok || !j) mikaFehler(MIKA_FEHLER);');
    expect(sektion).toContain('catch { mikaFehler(MIKA_FEHLER); }');
  });
  test('keine Inline-Handler (CSP)', () => {
    expect(markup).not.toMatch(/\son[a-z]+=/);
  });

  // Spruenge mit Attrappen nachspielen
  const steuer = sektion.slice(sektion.indexOf('      function mikaSchliessen('), sektion.indexOf("      mkEl('mika-knopf').addEventListener"));
  const aufbau = () => {
    const aufrufe = [];
    const el = id => (el.cache[id] ??= { id, hidden: false, value: '', setAttribute() {}, focus() {}, scrollIntoView() {} });
    el.cache = {};
    const f = new Function('mkv', 'mkEl', 'mkZ', 'MIKA_LISTEN', 'MIKA_ZIEL_ARTEN', 'dbZ', 'dbEl', 'dbZeichnen', 'dbKachelKlick', 'dbFilterSetzen', 'oeffneAnsicht',
      'currentShop', 'setCurrentShop', 'psSpringeZu', 'lbSpringeZu', 'auZ', 'loadAuftraege', 'agDetailOeffnen', 'window', 'setTimeout',
      `${steuer}\nreturn { mikaSpringe };`);
    const merk = name => (...a) => { aufrufe.push([name, ...a]); };
    const api = f({ stopp: merk('vorlesen-stopp') }, el, { zurueck: null }, MIKA_LISTEN, MIKA_ZIEL_ARTEN, { wer: 'Nicole', detail: '' }, el, merk('dbZeichnen'),
      merk('dbKachelKlick'), merk('dbFilterSetzen'), merk('oeffneAnsicht'), () => 'jfn', merk('setCurrentShop'), merk('psSpringeZu'), merk('lbSpringeZu'),
      { daten: {} }, merk('loadAuftraege'), merk('agDetailOeffnen'), { auOeffnen: merk('auOeffnen') }, fn => fn());
    return { ...api, aufrufe, el };
  };
  test.each([
    [{ art: 'shop', shop: 'honk', id: '90015' }, [['setCurrentShop', 'honk', false], ['psSpringeZu', '90015'], ['oeffneAnsicht', 'bestellen', 'bestellungen']]],
    [{ art: 'au', nr: 'AU-2026-0001' }, [['auOeffnen', 'AU-2026-0001']]],
    [{ art: 'ag', nr: 'AG-2026-0001' }, [['oeffneAnsicht', 'auftraege', 'liste'], ['agDetailOeffnen', 'AG-2026-0001']]],
    [{ art: 'lshop', orderId: 'JFN-2026-0012' }, [['lbSpringeZu', 'JFN-2026-0012'], ['oeffneAnsicht', 'bestellen', 'lshop-bestellungen']]],
    [{ art: 'liste', liste: 'au-termin' }, [['dbFilterSetzen', { 'au-f': 'termin', 'au-art': 'auftraege' }], ['oeffneAnsicht', 'auftraege', 'liste']]],
    [{ art: 'liste', liste: 'rueckstand' }, [['dbKachelKlick', 'rueckstand']]],
    [{ art: 'liste', liste: 'lange' }, [['oeffneAnsicht', 'dashboard', 'start'], ['dbZeichnen']]],
    [{ art: 'liste', liste: 'todos-ueberfaellig' }, [['oeffneAnsicht', 'auftraege', 'todos']]],
  ])('Sprung %j: Mika schliesst, vorhandene Sprungfunktion', async (ziel, soll) => {
    const a = aufbau();
    await a.mikaSpringe(ziel);
    expect(a.aufrufe[0]).toEqual(['vorlesen-stopp']);
    expect(a.el.cache['mika-fenster'].hidden).toBe(true);
    expect(a.aufrufe.slice(1)).toEqual(soll);
  });
  test('To-dos: Filter und Zuständig wie im Dashboard', async () => {
    const a = aufbau();
    await a.mikaSpringe({ art: 'liste', liste: 'todos-heute' });
    expect(a.el.cache['td-f'].value).toBe('woche');
    expect(a.el.cache['td-zust-f'].value).toBe('Nicole');
  });
  test('unbekannte Ziel-Art tut nichts', async () => {
    const a = aufbau();
    await a.mikaSpringe({ art: 'url', href: 'x' });
    expect(a.aufrufe).toEqual([]);
  });
});

test('Knopf-Hilfe: alle Mika-Schluessel stehen in der Gruppe "mika"', () => {
  const gruppe = /'mika': \[([^\]]+)\]/.exec(html)[1];
  for (const k of [...new Set([...html.matchAll(/data-hilfe="(mika-[a-z-]+)"/g)].map(m => m[1]))]) expect([k, gruppe.includes(`'${k}'`)]).toEqual([k, true]);
  expect(jest).toBeDefined();
});
