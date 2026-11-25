// AU-UX1: Auftragsansicht entruempelt - Aktionsleiste mit Menue "mehr …", bezahlt eindeutig, "fertig" einmal je Zeile,
// Preise in einer Zeile, Kalkulation zeigen/verbergen, Bearbeiten-Dialog kompakt, Startdatum DTF als Anzeige-Hilfe.
// Die Maß-Regeln (orange/leise) prueft druckkosten-frontend.test.js. Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import { machSheets } from './hilfen/korb-sheet.js';
import { leseDruckKontext } from '../lib/druckmasse.js';
import { startDatumAus, DTF_CONFIG_SCHLUESSEL, DTF_START_SCHLUESSEL } from '../utils/druckkosten.js';
import { startDatumAus as startAusKorb } from '../lib/dtfKorb.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const kuEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const leiste = html.slice(html.indexOf('<div class="korb-reihe ku-knoepfe au-aktionen">'), html.indexOf('<div id="au-d-dk">'));
const menue = leiste.slice(leiste.indexOf('<div id="au-mehr-menue"'));
const sichtbar = leiste.slice(0, leiste.indexOf('<div class="au-mehr-wrap">'));
const ids = t => [...t.matchAll(/<button[^>]*\bid="([a-z-]+)"/g)].map(m => m[1]);

describe('Aktionsleiste', () => {
  test('sichtbar: Hauptaktion (accent), bereitstellen, bezahlt, Storno zurück, Platz für Abrechnen, + Aufgabe, mehr …', () => {
    expect(ids(sichtbar)).toEqual(['au-weiter', 'au-bereitstellen', 'au-bezahlt', 'au-storno-zurueck', 'au-aufgabe-neu']);
    expect(sichtbar).toMatch(/class="korb-aktion korb-aktion-haupt" id="au-weiter"/);
    expect((sichtbar.match(/korb-aktion-haupt/g) || []).length).toBe(1);   // nur EINE Hauptaktion
    expect(sichtbar).toContain('<span id="au-re-knopf" class="au-re-knopf"></span>');
    expect(leiste).toMatch(/id="au-mehr" aria-haspopup="menu" aria-expanded="false" aria-controls="au-mehr-menue" data-hilfe="au-mehr">mehr …<\/button>/);
  });
  test('Menü „mehr …“: seltene Aktionen, stornieren zuletzt in --danger, jeder Punkt mit Mouse-over', () => {
    expect(ids(menue)).toEqual(['au-zurueck', 'au-design-skip', 'au-bezahlt-zurueck', 'au-wie-letztes', 'au-bestellseite', 'au-bearbeiten', 'au-storno']);
    expect(menue).toMatch(/role="menu"/);
    for (const b of menue.match(/<button[^>]*>/g)) {
      expect(b).toContain('role="menuitem"');
      expect(b).toMatch(/data-hilfe="[a-z-]+"/);
      expect(b).not.toMatch(/\btitle=/);
    }
    expect(menue).toMatch(/class="au-menue-punkt ku-gefahr" id="au-storno"/);
    expect(html).toMatch(/\.au-menue-punkt\.ku-gefahr \{ color: var\(--danger\); \}/);
    const handy = html.slice(html.indexOf('.au-gruppe-felder .au-dn-zeigen'), html.indexOf('.au-menue-punkt { min-height: 44px; }') + 40);
    expect(handy).toContain('@media (max-width: 600px) {');
    expect(handy).toContain('.au-mehr-wrap { display: contents; }');
    expect(handy.length).toBeLessThan(900);
  });
  test('Tastatur: ↓ öffnet, ↑/↓/Pos1/Ende wählen, Esc schließt mit Fokus zurück, Klick daneben schließt', () => {
    const js = html.slice(html.indexOf('const auMehrPunkte = '), html.indexOf('/** KS4: Knoepfe fuer Auftraege aus einer Bestellseite'));
    expect(js).toContain("if (e.key === 'ArrowDown') { e.preventDefault(); auMehrAuf(); }");
    expect(js).toContain('{ ArrowDown: l[(i + 1) % l.length], ArrowUp: l[(i - 1 + l.length) % l.length], Home: l[0], End: l[l.length - 1] }[e.key]');
    expect(js).toContain("if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); auMehrZu(true); }");
    expect(js).toContain("!e.target.closest('.au-mehr-wrap')) auMehrZu();");
    expect(html).toContain('auMehrZeichnen();   // AU-UX1');
  });
  test('Abrechnen … nur oben und nur, solange abrechenbar und nicht abgerechnet', () => {
    const src = html.slice(html.indexOf('function auReKnopfHtml(r) {'), html.indexOf('/** Status-Leiste: je Schritt Name + Datum'));
    const auReKnopfHtml = new Function('kuEsc', `${src}\nreturn auReKnopfHtml;`)(kuEsc);
    expect(auReKnopfHtml({ abrechenbar: true, auftragNr: 'AU-2026-0901' })).toContain('data-au-abrechnen="AU-2026-0901" data-hilfe="au-abrechnen">Abrechnen …</button>');
    expect(auReKnopfHtml({ abrechenbar: true, auftragNr: 'AU-2026-0901', kennzeichen: { status: 'entwurf' } })).toBe('');
    expect(auReKnopfHtml({ abrechenbar: false, auftragNr: 'AU-2026-0901' })).toBe('');
    expect(auReKnopfHtml(null)).toBe('');
    expect(html).toContain("if (r.abrechenbar) return teile.join('');");
  });
});

describe('Doppelungen und Beschriftung', () => {
  test('bezahlt: Leiste = Stand, Knopf = Tun („als bezahlt markieren“)', () => {
    expect(sichtbar).toContain('id="au-bezahlt" data-hilfe="au-bezahlt">als bezahlt markieren</button>');
    expect(html).toMatch(/'au-bezahlt':\s+\{ name: 'als bezahlt markieren'/);
  });
  test('„fertig“ je Zeile einmal: Haken mit Datum, kein zweites „fertig TT.MM.“', () => {
    expect(html).toContain("${p.Fertig === 'ja' && p.Fertig_Am ? `fertig ${auDatum(p.Fertig_Am)}` : 'fertig'}</label>");
    expect(html).not.toContain('`<small>fertig ${auDatum(p.Fertig_Am)}</small>`');
  });
  test('Kalkulation zeigen / verbergen je Zustand (nur CSS)', () => {
    expect(html).toContain('<summary data-hilfe="ap-kalkulation"><span class="ap-zu">Kalkulation zeigen</span><span class="ap-auf">Kalkulation verbergen</span></summary>');
    expect(html).toContain('.ap-kalk > summary .ap-auf, .ap-kalk[open] > summary .ap-zu { display: none; }');
    expect(html).not.toContain('>Kalkulation zeigen</summary>');
  });
  test('Preise: eine Zeile brutto · netto · Rohertrag, Rest aufklappbar; „geändert seit Angebot“ bleibt sichtbar', () => {
    const f = html.slice(html.indexOf('function auDetailPreise(a) {'), html.indexOf('// ── Druckkosten-Anzeige: Anfang'));
    expect(f).toContain('<div class="ap-kurz" data-hilfe="ap-kurz" tabindex="0"><span>brutto');
    expect(f).toContain("apSummenHtml({ ...s, ohnePreis: 0 })");
    expect(f).toMatch(/\$\{kurz\}\$\{versand\}\$\{angebotWarn\}\$\{kalk\}/);
    expect(f).not.toMatch(/<strong>Preise<\/strong><\/div>\$\{apSummenHtml\(s\)\}/);
  });
  test('Sammelhinweis „Maß fehlt“ oben, Sprung zur ersten Position', () => {
    expect(html).toContain("auEl('au-d-dk').innerHTML = dkSammelHtml(a);");
    expect(html).toContain("querySelectorAll('[data-dk-warn]')");
    expect(html).toContain('${dkKeinDtfHtml(a, g.positionen)}');
  });
});

describe('Bearbeiten-Dialog', () => {
  const f = html.slice(html.indexOf('function auEntwurfZeichnen() {'), html.indexOf('// AMQ1: ohne Positionen speicherbar'));
  test('gesperrte Gruppen: Lesezeile + Preisfelder, Rest unter „Details“ (Zustand bleibt beim Neuzeichnen)', () => {
    expect(f).toContain('if (!frei) {');
    expect(f).toContain('<div class="au-gruppe au-gruppe-gesperrt">');
    expect(f).toMatch(/auPreisZeileHtml\(g, gi\)\s*\n?\s*\+ `<details class="au-gruppe-details" data-au-details=/);
    expect(f).toContain('<summary data-hilfe="au-gruppe-details">Details</summary>${auHerkunftHtml(g, gi, frei)}${felder}</details>');
    expect(html).toContain("auEl('au-pos-liste').addEventListener('toggle', e => {");
  });
  test('Druckname erst auf Klick (offen, wenn schon ein Wert da ist)', () => {
    expect(f).toContain('const dnZeigen = auDlg.dnOffen?.has(g.key) || !!auDrucknameText(g.positionen) || !!dnGrund;');
    expect(f).toContain('data-hilfe="au-druckname-zeigen">+ Druckname</button>');
    expect(f).toContain('<div class="au-dn-feld"${dnZeigen ? \'\' : \' hidden\'}><label class="au-druckname" data-hilfe="au-druckname">');
  });
  test('Aufpreis groß nur bei mehr als einer Größe (eingetragener bleibt sichtbar)', () => {
    const z = html.slice(html.indexOf('function auPreisZeileHtml(g, gi) {'), html.indexOf('// PR1: Preisvergleich - Einstellungen und Uebernehmen'));
    expect(z).toContain("const aufpreisZeigen = new Set(g.positionen.map(p => p.groesse).filter(Boolean)).size > 1 || String(p0.aufpreis ?? '').trim() !== '';");
    expect(z).toContain("(g.art === 'lshop' && aufpreisZeigen ? feld('aufpreis'");
  });
  test('Rabatt-Feld und %/€ in einer Zeile', () => {
    expect(html).toMatch(/<label for="au-rabatt" data-hilfe="ap-rabatt">Rabatt auf den Auftrag<\/label>\s*<div class="ap-rabatt-zeile"><input id="au-rabatt"[^>]*\/>\s*<select id="au-rabatt-art"/);
  });
});

describe('Anzeige-Hilfe dtf.start_datum (nur lesen)', () => {
  test('ein Parser (utils), dtfKorb nutzt denselben; Setup der Druckmaße legt den Schlüssel nicht an', () => {
    expect(startAusKorb).toBe(startDatumAus);
    expect(startDatumAus('25.11.2026')).toBe('2026-11-25');
    expect(startDatumAus(46351)).toBe('2026-11-25');
    expect(startDatumAus('irgendwann')).toBe('');
    expect(DTF_CONFIG_SCHLUESSEL).not.toContain(DTF_START_SCHLUESSEL);
  });
  test('leseDruckKontext liefert start aus Config, ohne zu schreiben', async () => {
    process.env.BUSINESS_SHEET_ID = 'business-test';
    process.env.GOOGLE_SHEET_ID = 'ssot-test';
    const t = { Config: [['Schlüssel', 'Wert'], ['dtf.start_datum', '20.11.2026'], ['dtf.breite_cm', 57]] };
    const { sheets } = machSheets(t);
    const update = jest.spyOn(sheets.spreadsheets.values, 'update');
    const k = await leseDruckKontext({ sheets, spreadsheetId: 'ssot-test' });
    expect(k.start).toBe('2026-11-20');
    expect(update).not.toHaveBeenCalled();
    const ohne = await leseDruckKontext({ sheets: machSheets({ Config: [['Schlüssel', 'Wert']] }).sheets, spreadsheetId: 'ssot-test' });
    expect(ohne.start).toBe('');
  });
  test('GET /api/auftraege reicht es als druck.start durch', () => {
    const src = readFileSync(resolve(hier, '../lib/auftraege.js'), 'utf8');
    expect(src).toContain("start: dk.start ?? '' },");
  });
});
