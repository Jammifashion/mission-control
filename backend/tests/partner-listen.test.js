// PP3: Partnerportale - Abgerechnetes standardmaessig ausgeblendet, am Handy Karten. Block "Portal-Listen" (beide Portale). Erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const lies = n => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend', n), 'utf8');
const lizenz = lies('partner.html'), festpreis = lies('partner-festpreis.html');
const block = h => h.slice(h.indexOf('// ── Portal-Listen: Anfang'), h.indexOf('// ── Portal-Listen: Ende ──'));
const cssBlock = h => h.slice(h.indexOf('/* ── Portal-Listen CSS: Anfang'), h.indexOf('/* ── Portal-Listen CSS: Ende ── */'));
// document/window fuer den Block (nur addEventListener/matchMedia/getElementById)
const F = new Function('document', 'window', `${block(lizenz)}\nreturn { PL_KEY, plLies, plSchreib, plSicht, plKopfHtml, plTabelleHtml, plAbgerechnet };`)(
  { addEventListener: () => {}, getElementById: () => null }, {});

const speicher = (start = {}) => { const d = { ...start }; return { d, getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; };
const kaputt = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
const zeilen = [{ status: 'offen', n: 1 }, { status: 'abgerechnet', n: 2 }, { status: 'Abgerechnet ', n: 3 }, { status: 'in Prüfung', n: 4 }, { status: '', n: 5 }];

describe('Portal-Listen (beide Portale gleich)', () => {
  test('Block und CSS wortgleich in partner.html und partner-festpreis.html', () => {
    expect(block(lizenz).length).toBeGreaterThan(1500);
    expect(block(festpreis)).toBe(block(lizenz));
    expect(cssBlock(festpreis)).toBe(cssBlock(lizenz));
  });
  test('Standard aus: nur Offenes (alles ausser "abgerechnet"); an: alle', () => {
    const aus = F.plSicht(zeilen, false);
    expect(aus.zeilen.map(z => z.n)).toEqual([1, 4, 5]);
    expect(aus).toMatchObject({ offen: 3, abgerechnet: 2, alle: false });
    expect(F.plSicht(zeilen, true).zeilen).toHaveLength(5);
    expect(F.plSicht(null, false)).toMatchObject({ zeilen: [], offen: 0, abgerechnet: 0 });
  });
  test('Speichern/Lesen je Geraet: Standard aus, fehlender oder werfender Speicher -> aus, kein Fehler', () => {
    const s = speicher();
    expect(F.plLies(s)).toBe(false);
    expect(F.plSchreib(s, true)).toBe(true);
    expect(s.d[F.PL_KEY]).toBe('1');
    expect(F.plLies(s)).toBe(true);
    expect(F.plSchreib(s, false)).toBe(true);
    expect(F.PL_KEY in s.d).toBe(false);
    expect(F.plLies(null)).toBe(false);
    expect(F.plLies(kaputt)).toBe(false);
    expect(F.plSchreib(kaputt, true)).toBe(false);
    expect(F.plSchreib(null, true)).toBe(false);
    expect(F.PL_KEY).not.toMatch(/mc_/);   // getrennt von MC
  });
  test('Kopf: Zaehler, Schalter nur wenn es Abgerechnetes gibt', () => {
    expect(F.plKopfHtml(F.plSicht(zeilen, false))).toContain('3 offen · 2 abgerechnet');
    expect(F.plKopfHtml(F.plSicht(zeilen, false))).toContain('<input type="checkbox" data-pl-alle>');
    expect(F.plKopfHtml(F.plSicht(zeilen, true))).toContain('data-pl-alle checked');
    expect(F.plKopfHtml(F.plSicht([{ status: 'offen' }], false))).not.toContain('checkbox');
  });
  test('Tabelle: Rollen-Klassen fuer die Handy-Karten, Beschriftung, Storno; leer = freundlicher Satz', () => {
    const h = F.plTabelleHtml([{ titel: 'Datum', rolle: 'datum' }, { titel: 'Artikel', rolle: 'haupt' }, { titel: 'Summe', rolle: 'betrag', num: true }],
      [{ zellen: ['01.11.2026', 'Shirt', '9,90 €'], storno: true }], 'leer');
    expect(h).toContain('<table class="pl-tabelle">');
    expect(h).toContain('<td class="pl-betrag num" data-label="Summe">9,90 €</td>');
    expect(h).toContain('<tr class="pl-storno">');
    expect(F.plTabelleHtml([], [], 'Seit der letzten Abrechnung noch keine Verkäufe.')).toBe('<p class="empty">Seit der letzten Abrechnung noch keine Verkäufe.</p>');
  });
  test('Handy-CSS (<= 480 px): Tabellen werden Karten, keine seitliche Box, Kopf in einer Zeile', () => {
    const css = cssBlock(lizenz);
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('table.pl-tabelle thead { display: none; }');
    expect(css).toContain('.pl-wrap { overflow-x: visible; }');
    expect(css).toMatch(/td\.pl-neben::before \{ content: attr\(data-label\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
  });
});

describe.each([['partner.html', lizenz], ['partner-festpreis.html', festpreis]])('%s', (datei, html) => {
  test('Listen nutzen den Filter; Summen/Saldo bleiben ungefiltert', () => {
    expect(html).toContain('function renderVerkaeufe()');
    expect(html).toContain('function renderIntern()');
    expect((html.match(/const sicht = plSicht\(rows, plLies\(plSpeicher\(\)\)\);/g) ?? []).length).toBe(2);
    expect(html).toContain("'Seit der letzten Abrechnung noch keine Verkäufe.'");
    const saldo = html.slice(html.indexOf('async function loadSaldo'), html.indexOf('async function loadAbrechnungen'));
    expect(saldo).not.toMatch(/plSicht|plLies/);
  });
  test('Abrechnungen eingeklappt am Handy, mit Anzahl', () => {
    expect(html).toContain('<details class="card pl-abschnitt" id="pv-abr-box">');
    expect(html).toContain('plAnzahlSetzen(rows.length);');
    expect(html).toContain('plAbschnittOeffnen();');
  });
  test('alle Listen-Tabellen sind pl-Tabellen (keine rohen <table> mehr in den Listen)', () => {
    const listen = html.slice(html.indexOf('// ── Portal-Listen: Ende ──'), html.indexOf('// ── Eigenauftrag stellen'));
    expect(listen).not.toMatch(/<table>/);
  });
});

test('Festpreis: Offene Auszahlung steht oben, alte Spalten-Regel trifft die Karten nicht mehr', () => {
  const init = festpreis.slice(festpreis.indexOf('main.innerHTML = `\n'), festpreis.indexOf('plAbschnittOeffnen();   // PP3'));
  expect(init.indexOf('Offene Auszahlung')).toBeLessThan(init.indexOf('Meine Verkäufe'));
  expect(festpreis).toContain('table:not(.pl-tabelle) th:nth-child(n+5)');
});
