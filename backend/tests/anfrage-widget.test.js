// Quellvertrag fuer frontend/anfrage.html.
//
// Das Widget ist Inline-JavaScript in einer HTML-Datei, und diese Suite laeuft
// ohne DOM (jest testEnvironment: node). Echtes Verhalten laesst sich hier
// also nicht ausfuehren - was sich pruefen laesst, ist die Verdrahtung.
//
// Gerade die ist der Punkt: der Kundenkanal darf nicht stumm scheitern. Wenn
// jemand den error-callback entfernt, den Timeout herausnimmt oder die
// Begruessung wieder in den Boot-Pfad zurueckschiebt (wo es noch keinen
// Turnstile-Token gibt), faellt das hier auf - und nicht erst dadurch, dass
// sich Kunden nicht mehr melden.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/anfrage.html'),
  'utf8',
);

describe('Turnstile-Verdrahtung', () => {
  test('Widget meldet Fehler an onTurnstileError', () => {
    expect(html).toContain('data-error-callback="onTurnstileError"');
    expect(html).toMatch(/function onTurnstileError\s*\(/);
  });

  test('onTurnstileError zeigt den Kontakt-Fallback', () => {
    const fn = html.match(/function onTurnstileError\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
    expect(fn).not.toBeNull();
    expect(fn[1]).toContain('zeigeKontaktFallback');
  });

  test('Timeout von 10 s ist gesetzt und loest den Fallback aus', () => {
    expect(html).toMatch(/TURNSTILE_TIMEOUT_MS\s*=\s*10000/);
    expect(html).toMatch(/setTimeout\(\s*\(\)\s*=>\s*zeigeKontaktFallback/);
    expect(html).toContain('TURNSTILE_TIMEOUT_MS,');
  });

  test('erfolgreicher Token stoppt den Timeout', () => {
    const fn = html.match(/function onTurnstileSuccess\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
    expect(fn).not.toBeNull();
    expect(fn[1]).toContain('clearTimeout(_turnstileTimer)');
  });
});

describe('Begruessung haengt am Turnstile-Token', () => {
  // Der Server verlangt beim ersten Request ausnahmslos einen Turnstile-Token.
  // Ein __init__ im Boot-Pfad haette keinen und liefe in 403.
  test("callChat('__init__') steht ausschliesslich in onTurnstileSuccess", () => {
    const treffer = [...html.matchAll(/callChat\('__init__'/g)];
    expect(treffer).toHaveLength(1);

    const start = html.indexOf('function onTurnstileSuccess');
    const ende  = html.indexOf('function onTurnstileError');
    expect(start).toBeGreaterThan(-1);
    expect(ende).toBeGreaterThan(start);
    expect(treffer[0].index).toBeGreaterThan(start);
    expect(treffer[0].index).toBeLessThan(ende);
  });

  test('einmaliges Ausloesen ueber _booted', () => {
    expect(html).toMatch(/if\s*\(!_booted\)\s*\{/);
    expect(html).toContain('_booted = true;');
  });
});

describe('Kontakt-Fallback', () => {
  // Werte aus dem Reiter Agent_Wissen (Schluessel 'kontakt_fallback' und
  // Abschnitt ERREICHBARKEIT der Wissensbasis). Sie sind hier gespiegelt,
  // weil der Fallback gerade dann greift, wenn das Backend nicht antwortet -
  // er kann sie also nicht nachladen. Weichen sie im Sheet ab, muss diese
  // Stelle mitgezogen werden.
  test('nennt Telefon und E-Mail aus dem Agent-Wissen', () => {
    expect(html).toContain('0179 903 73 61');
    expect(html).toContain('info@jammifashion.de');
  });

  test('Telefon und Mail sind anklickbar', () => {
    expect(html).toMatch(/href="tel:\$\{KONTAKT\.telHref\}"/);
    expect(html).toMatch(/href="mailto:\$\{KONTAKT\.email\}"/);
    expect(html).toMatch(/telHref:\s*'\+491799037361'/);
  });

  test('nennt die Erreichbarkeitszeiten', () => {
    expect(html).toMatch(/zeiten:\s*'Montag bis Freitag, 9–16 Uhr'/);
  });

  test('blendet Eingabe und Turnstile aus, statt sie tot stehen zu lassen', () => {
    const fn = html.match(/function zeigeKontaktFallback\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
    expect(fn).not.toBeNull();
    expect(fn[1]).toContain("inputBar.style.display = 'none'");
    expect(fn[1]).toContain("tw.style.display = 'none'");
  });

  test('wird nur einmal gezeigt', () => {
    const fn = html.match(/function zeigeKontaktFallback\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
    expect(fn[1]).toContain('if (_fallbackGezeigt) return;');
  });

  test('greift auch, wenn schon der erste Request scheitert', () => {
    // Ohne Session gibt es keinen Chat, in dem eine Fehlerblase helfen wuerde.
    expect(html).toMatch(/if\s*\(!_chatSession\)\s*\{\s*\n\s*zeigeKontaktFallback/);
  });
});

describe('Session-Token', () => {
  test('wird gesendet, sobald vorhanden, und aus der Antwort uebernommen', () => {
    expect(html).toContain('chatSession: _chatSession');
    expect(html).toContain('_chatSession = data.chatSession;');
  });

  test('Turnstile-Token geht nur mit, solange es keine Session gibt', () => {
    expect(html).toMatch(/const tokenToSend = _chatSession \? undefined : \(_turnstileToken \|\| undefined\)/);
  });
});
