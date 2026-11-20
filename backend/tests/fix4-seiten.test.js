// FIX4: CSP je Seite , Service Worker + Token nur im #-Teil ,
// Zwischenstand verwerfen auf der Bestellseite , KI-Hinweis im Kundenchat . Nur Quelltext.
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend');
const lies = d => readFileSync(resolve(frontend, d), 'utf8');
const SEITEN = readdirSync(frontend).filter(d => d.endsWith('.html'));
const BACKEND = 'https://mission-control-backend-181760755456.europe-west1.run.app';

const cspVon = html => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  if (!m) return null;
  return Object.fromEntries(m[1].split(';').map(x => x.trim()).filter(Boolean).map(x => { const [k, ...w] = x.split(/\s+/); return [k, w]; }));
};

describe('CSP-Meta auf jeder Seite', () => {
  test('alle bekannten Seiten sind dabei', () => {
    expect(SEITEN).toEqual(expect.arrayContaining(['index.html', 'partner.html', 'partner-festpreis.html', 'anfrage.html', 'bestellen.html']));
  });
  test.each(SEITEN)('%s: object-src none, base-uri none, kein frame-ancestors, Backend erlaubt', datei => {
    const html = lies(datei);
    const csp = cspVon(html);
    expect(csp).not.toBeNull();
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'none'"]);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toBeUndefined();   // wirkt per Meta nicht
    expect(html).not.toMatch(/frame-ancestors/);
    expect(csp['connect-src']).toContain(BACKEND);
    // so frueh wie moeglich: vor dem ersten Skript und vor jedem Stylesheet
    const pos = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(pos).toBeLessThan(html.indexOf('<script'));
    expect(pos).toBeLessThan(html.search(/<link|<style/));
  });
  test('MC: Service Worker und Manifest bleiben erlaubt', () => {
    const csp = cspVon(lies('index.html'));
    expect(csp['worker-src']).toEqual(["'self'"]);
    expect(csp['manifest-src']).toEqual(["'self'"]);
  });
  test('anfrage.html: Turnstile als Skript und Frame', () => {
    const csp = cspVon(lies('anfrage.html'));
    expect(csp['script-src']).toContain('https://challenges.cloudflare.com');
    expect(csp['frame-src']).toEqual(['https://challenges.cloudflare.com']);
  });
  test('bestellen.html: Bilder nur Shop-CDN/Shop + blob: (Entwuerfe)', () => {
    const csp = cspVon(lies('bestellen.html'));
    expect(csp['img-src']).toEqual(expect.arrayContaining(['blob:', 'https://i0.wp.com', 'https://i3.wp.com']));
    expect(csp['img-src']).not.toContain('https:');
  });
  test.each(SEITEN)('%s: keine Inline-Event-Handler (Voraussetzung fuer die naechste Stufe)', datei => {
    expect(lies(datei)).not.toMatch(/<[a-z][^>]*\son(click|change|input|load|error|submit|keydown|keyup)=/i);
  });
});

describe('Bestellseite nie im Cache, Token nur im #-Teil', () => {
  test('sw.js: /bestellen.html in NIE_CACHEN, nicht im PRECACHE', () => {
    const sw = lies('sw.js');
    expect(/const NIE_CACHEN = \[([\s\S]*?)\];/.exec(sw)[1]).toContain('/bestellen.html');
    expect(/const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1]).not.toContain('bestellen.html');
  });
  test('bestellen.html liest keinen ?t= mehr', () => {
    const seite = lies('bestellen.html');
    const block = seite.slice(seite.indexOf('// ── Bestellseite-Token: Anfang'), seite.indexOf('// ── Bestellseite-Token: Ende ──'));
    expect(block).not.toMatch(/location\.search/);
    expect(block).not.toMatch(/\\\?\|&\)t=/);
    const F = new Function(`${block}\nreturn { bsTokenAusAdresse };`)();
    const tok = 'X'.repeat(43);
    expect(F.bsTokenAusAdresse(`#t=${tok}`)).toBe(tok);
    expect(F.bsTokenAusAdresse('', `?t=${tok}`)).toBe('');
    expect(F.bsTokenAusAdresse('#t=%E0%A4%A')).toBe('');   // kaputte Kodierung wirft nicht
  });
});

describe('Zwischenstand verwerfen', () => {
  const seite = lies('bestellen.html');
  test('Knopf im Korb neben dem Hinweis zum Zwischenspeichern, mit Rueckfrage', () => {
    const block = seite.slice(seite.indexOf('// ── Bestellseite-Anzeige: Anfang'), seite.indexOf('// ── Bestellseite-Anzeige: Ende ──'));
    const F = new Function(`${block}\nreturn { bsKorbHtml };`)();
    const h = F.bsKorbHtml([{ menge: 1, text: 'Testartikel' }], 'TK', true);
    expect(h).toContain('id="bs-verwerfen"');
    expect(h).toContain('Zwischenstand verwerfen');
    expect(h.indexOf('zwischengespeichert')).toBeLessThan(h.indexOf('bs-verwerfen'));
    expect(F.bsKorbHtml([], 'TK', true)).toBe('');
    const handler = seite.slice(seite.indexOf("b.id === 'bs-verwerfen'"), seite.indexOf('b.dataset.korbWeg !== undefined'));
    expect(handler).toMatch(/confirm\(/);
    expect(handler).toMatch(/BS\.korb = \[\]/);
    expect(handler).toMatch(/removeItem\(zw\.schluessel\)/);
  });
});

describe('KI-Hinweis im Kundenchat', () => {
  const seite = lies('anfrage.html');
  test('Hinweis sichtbar vor der Eingabe, Datenschutz-Link in neuem Tab', () => {
    expect(seite).toContain('Du schreibst mit einem KI-Assistenten (Claude, Anthropic). Deine Angaben nutzen wir für deine Anfrage.');
    expect(seite).toMatch(/<a href="https:\/\/jammifashion\.de\/datenschutz\/" target="_blank" rel="noopener noreferrer">Datenschutz<\/a>/);
    const hinweis = seite.indexOf('id="ki-hinweis"');
    expect(hinweis).toBeGreaterThan(-1);
    expect(hinweis).toBeLessThan(seite.indexOf('id="input-bar"'));
    expect(seite.slice(hinweis - 40, hinweis)).not.toMatch(/hidden|display:\s*none/);
  });
});
