// TR2: Ansicht "Trikots (JFN)" in frontend/index.html - reine Anzeige aus dem Block "Trikots", gefuettert
// mit der echten Backend-Logik (utils/trikot-ansicht.js). Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { trikotZeilen, baueTrikotAnsicht, HINWEISE } from '../utils/trikot-ansicht.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Trikots: Anfang');
const bis = html.indexOf('// ── Trikots: Ende ──');
const T = new Function(`${html.slice(von, bis)}
return { TR_HINWEISE, trZeileHtml, trGruppeHtml, trListeHtml, trSummeText };`)();
// TR2-Teil der Sektion (bis zum TR3-Block "Trikot-Formular", der schreiben darf).
const sektion = html.slice(html.indexOf('// ── SECTION: Trikots (TR2) ──'), html.indexOf('// ── Trikot-Formular: Anfang'));

const KOPF = ['Zeilen-ID', 'Bestelldatum', 'Order-ID', 'Kunde', 'Produktname', 'Groesse', 'Name', 'Nummer', 'Quelle', 'Rohtext',
  'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz', 'Ersetzt'];
const z = (id, order, prod, gr, name, nr, roh, charge, bam = '', status = '', ersetzt = '', notiz = '') =>
  [id, '2026-01-01', order, 'Erika Muster', prod, gr, name, nr, 'addon', roh, charge, bam, '', status, notiz, ersetzt];
const daten = baueTrikotAnsicht(trikotZeilen([
  KOPF,
  z('1|1|1', '501', 'Verein Heimtrikot', 'L', 'ALPHA', '7', 'Wunschname: ALPHA', '2', '14.09.2026', 'ok'),
  z('2|1|1', '502', 'Verein Heimtrikot', 'XL', 'BETA', '10', 'Name - Nummer: BETA 10', '2', '14.09.2026', 'ersetzt', '', 'Änderung'),
  z('INT-2026-0001', '502', 'Verein Heimtrikot', 'XL', 'NEU', '10', '', '4', '', '', '2|1|1'),
  z('3|1|1', '503', 'Verein Auswärtstrikot', '120', '', '', 'Name - Nummer: <b>GAMMA</b> 3', ''),
]));

describe('Block Trikots', () => {
  test('Hinweistexte = Backend (Spiegel)', () => {
    expect(T.TR_HINWEISE).toEqual(HINWEISE);
  });

  test('Gruppen: offen zuerst und aufgeklappt, Charge mit "x von y da" und Lieferung', () => {
    const h = T.trListeHtml(daten);
    expect(h.indexOf('noch nicht beim Produzenten')).toBeLessThan(h.indexOf('Bestellung 4'));
    expect(h.indexOf('Bestellung 4')).toBeLessThan(h.indexOf('Bestellung 2'));
    expect(h).toMatch(/data-charge="" open>/);
    expect(h).toMatch(/<span data-hilfe="tr-da">2 von 2 da<\/span>/);
    expect(h).toMatch(/Lieferung ca\. 14\.10\.2026/);
    expect(h).toMatch(/Bestellung 4<\/strong><span><span data-hilfe="tr-da">0 von 1 da<\/span><\/span><span class="tr-hinweis">Bestellt_Am fehlt/);
    expect(h).not.toContain('Erika');
    expect(T.trSummeText(daten)).toBe('Trikots (JFN) · 1 noch nicht beim Produzenten · 2 Bestellungen · 2 von 3 da');
  });

  test('Name/Nummer leer: Kundenangabe offen und gelb, escaped, nie in Name/Nummer uebernommen', () => {
    const zeile = daten.gruppen[0].zeilen[0];
    const h = T.trZeileHtml(zeile);
    expect(h).toMatch(/tr-zeile tr-gelb/);
    expect(h).toMatch(/<details class="tr-angabe tr-angabe-gelb" open><summary data-hilfe="tr-kundenangabe">Name\/Nummer nicht übernommen – Kundenangabe:/);
    expect(h).toContain('&#60;b&#62;GAMMA&#60;/b&#62; 3');
    expect(h).toMatch(/<strong>–<\/strong> · –/);
    expect(h).toMatch(/data-tr-bestellung="503" data-hilfe="tr-bestellung">#503/);
  });

  test('Ersatz: beide Zeilen verbunden, ersetzt beim Kunden noch offen', () => {
    const [ok, alt] = daten.gruppen.find(g => g.charge === '2').zeilen;
    expect(T.trZeileHtml(ok)).toMatch(/lb-st-geliefert">da</);
    const ha = T.trZeileHtml(alt);
    expect(ha).toMatch(/>ersetzt<\/span>/);
    expect(ha).toMatch(/ersetzt durch Bestellung 4 \(INT-2026-0001\)/);
    expect(ha).toMatch(/<details class="tr-angabe"><summary/);   // Name/Nummer da -> nur aufklappbar
    const hn = T.trZeileHtml(daten.gruppen.find(g => g.charge === '4').zeilen[0]);
    expect(hn).toMatch(/Ersatz für Zeile 3 aus Bestellung 2/);
    expect(hn).toMatch(/INT-2026-0001 · Zeile 4/);
  });
});

describe('Einbindung', () => {
  test('Unterreiter, Panel, Navigation (nur JFN), Lader beim Oeffnen', () => {
    expect(html).toMatch(/data-subtab="tab-lshop-bestellungen">L-Shop-Bestellungen<\/button>\s*<button class="sub-tab" data-subtab="tab-trikots">Trikots \(JFN\)<\/button>/);
    expect(html).toMatch(/<div id="tab-trikots" class="sub-tab-panel">/);
    expect(html).toMatch(/\{ id: 'trikots', +panel: 'orders', knopf: '#panel-orders \.sub-tab\[data-subtab="tab-trikots"\]', neuLaden: true, shop: false \}/);
    expect(html).toMatch(/if \(btn\.dataset\.subtab === 'tab-trikots'\) loadTrikots\(\);/);
  });
  test('nur lesen: ein GET, kein Schreibweg, kein Kunde', () => {
    expect(sektion).toMatch(/apiFetch\(`\$\{API_BASE\(\)\}\/api\/bestellen\/trikots`/);
    expect(sektion).not.toMatch(/method: '(POST|PUT|PATCH|DELETE)'/);
    expect(sektion).not.toMatch(/localStorage|kunde\b/i);
  });
  test('Sprung zur Bestellansicht: nur markieren, nicht aufklappen', () => {
    expect(sektion).toMatch(/psSpringeZu\(link\.dataset\.trBestellung\);\n\s*oeffneAnsicht\('bestellen', 'bestellungen'\);/);
    const ps = html.slice(html.indexOf('function psSprungAusfuehren()'), html.indexOf('async function loadOrders()'));
    expect(ps).toMatch(/classList\.add\('tr-markiert'\)/);
    expect(ps).not.toMatch(/psZeilenAnlegen|offen\.add/);
  });
});
