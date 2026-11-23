// DK1: Oberflaeche der Druckkosten (Auftragsansicht) und der Pflege-Ansicht Artikel -> Druckmaße. Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handTeile } from '../utils/druckkosten.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const block = (von, bis) => {
  const a = html.indexOf(von), b = html.indexOf(bis);
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  return html.slice(a, b);
};
const anzeige = block('// ── Druckkosten-Anzeige: Anfang', '// ── Druckkosten-Anzeige: Ende ──');
const pflege = block('// ── Druckmaße-Pflege: Anfang', '// ── Druckmaße-Pflege: Ende ──');
const apT = v => String(v ?? '').trim();
const kuEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const apEuroText = c => (c === null || c === undefined ? '–' : `${(c / 100).toFixed(2).replace('.', ',')} €`);

describe('Druckkosten in der Auftragsansicht', () => {
  const auZ = { daten: { druck: { hand: true, express: true, druckmasse: true } } };
  const f = new Function('apT', 'kuEsc', 'apEuroText', 'auZ', `${anzeige}\nreturn { dkHandTeile, dkGruppen, dkKalkHtml };`)(apT, kuEsc, apEuroText, auZ);

  test('dkHandTeile = handTeile des Backends', () => {
    for (const z of ['Brust 10,5x5; Rücken 28x17,5', 'Ärmel links 8 × 4', '', 'kaputt']) expect(f.dkHandTeile(z)).toEqual(handTeile(z));
  });
  const auftrag = (druck, extra = {}) => ({
    Auftrag_Nr: 'AU-2026-0099', Status: 'Design',
    positionen: [
      { Position_ID: 'AU-2026-0099-01', Art: 'lshop', lshop: { modell: 'X1', farbe: 'Black' }, Motiv: 'Skyline', Menge: 2 },
      { Position_ID: 'AU-2026-0099-02', Art: 'lshop', lshop: { modell: 'X1', farbe: 'Black' }, Motiv: 'Skyline', Menge: 1 },
      { Position_ID: 'AU-2026-0099-03', Art: 'frei', Freitext: 'Tasse', Druck: 'Stick', Menge: 1 },
    ],
    preise: { umsatzMitEk: 5000, druck: { express: false, gesamt: 1573, rohertragNachDruck: 2000, rohertragNachDruckProzent: 40, offen: 0, positionen: druck } },
    ...extra,
  });
  const ok = { status: 'ok', quelle: 'tabelle', teile: [{ position: 'Rücken', breite: 28, hoehe: 17.5 }], flaeche: 490, stueck: 524.26, netto: 1049 };

  test('eine Zeile je Gruppe, Kosten, Express, Rohertrag nach Druck, kein DTF', () => {
    const h = f.dkKalkHtml(auftrag([ok, { ...ok, netto: 524 }, { status: 'kein_dtf', text: 'Druckkosten nicht berechnet (kein DTF)' }]));
    expect((h.match(/class="dk-gruppe"/g) || []).length).toBe(2);
    expect(h).toContain('Rücken 28 × 17,5');
    expect(h).toContain('15,73 €');
    expect(h).toContain('Rohertrag nach Druck');
    expect(h).toContain('(40 %)');
    expect(h).toContain('data-hilfe="dk-kein-dtf"');
    expect(h).toContain('data-dk-express');
    expect(h).not.toMatch(/data-dk-express[^>]*checked/);
  });
  test('Preis fehlt / ohne Maß: Hinweis statt Betrag; ohne Spalte keine Knöpfe', () => {
    const h = f.dkKalkHtml(auftrag([{ status: 'preis_fehlt', text: 'Druckkosten: Preis fehlt (Einstellungen)', teile: ok.teile, flaeche: 490, quelle: 'tabelle' }, { status: 'ohne_mass', text: 'Druckmaße fehlen' }, { status: 'kein_dtf' }]));
    expect(h).toContain('data-hilfe="dk-preis-fehlt"');
    expect(h).toContain('Druckkosten: Preis fehlt (Einstellungen)');
    expect(h).toContain('data-dk-hand="0"');
    auZ.daten.druck.hand = false;
    expect(f.dkKalkHtml(auftrag([ok, ok, { status: 'kein_dtf' }]))).not.toContain('data-dk-hand');
    auZ.daten.druck.hand = true;
  });
  test('"merken" nur bei freien Maßen mit Motiv', () => {
    const a = auftrag([ok, ok, { status: 'kein_dtf' }]);
    expect(f.dkKalkHtml(a)).not.toContain('data-dk-merken');
    a.positionen[0].Druckmasse_Hand = 'Rücken 28x17,5';
    a.positionen[1].Druckmasse_Hand = 'Rücken 28x17,5';
    expect(f.dkKalkHtml(a)).toContain('data-dk-merken="0"');
  });
  test('storniert: nichts änderbar', () => {
    const h = f.dkKalkHtml(auftrag([ok, ok, { status: 'kein_dtf' }], { Status: 'storniert' }));
    expect(h).not.toContain('data-dk-hand');
    expect(h).toMatch(/data-dk-express[^>]*disabled/);
  });
});

describe('Pflege-Ansicht Druckmaße', () => {
  const f = new Function(`${pflege}\nreturn { dkmFiltern, dkmPreiseText };`)();
  const zeilen = [
    { id: 'DM-0002', bezug: 'Skyline', position: 'Brust', groesse: 'alle', notiz: '', aktiv: true },
    { id: 'DM-0001', bezug: 'Anker', position: 'Rücken', groesse: 'alle', notiz: 'groß', aktiv: true },
    { id: 'DM-0003', bezug: 'Skyline', position: 'Nacken', groesse: 'alle', notiz: '', aktiv: false },
  ];
  test('Suche je Wort, inaktive nur mit Haken, sortiert nach Motiv', () => {
    expect(f.dkmFiltern(zeilen).map(z => z.id)).toEqual(['DM-0001', 'DM-0002']);
    expect(f.dkmFiltern(zeilen, { inaktive: true, suche: 'sky' }).map(z => z.id)).toEqual(['DM-0002', 'DM-0003']);
    expect(f.dkmFiltern(zeilen, { suche: 'anker groß' }).map(z => z.id)).toEqual(['DM-0001']);
  });
  test('Einstellungen als Satz, fehlender Preis wird genannt', () => {
    expect(f.dkmPreiseText({ normal: { ok: true, modell: 'bogen', qmBrutto: 100 }, express: { ok: false, text: 'Druckkosten: Preis fehlt (Einstellungen)' }, verschnitt: 15 }))
      .toMatch(/normal 100,00 €\/m² brutto \(Bogenpreis\) · Express: Druckkosten: Preis fehlt \(Einstellungen\) · Verschnitt 15 %/);
  });
  test('Verdrahtung: Unterpunkt artikel/druckmasse, Modus-Knopf mit Mouse-over, nur /api/druckmasse, nie löschen', () => {
    expect(html).toContain("{ id: 'druckmasse', panel: 'products', knopf: '#mode-btn-druckmasse', neuLaden: true }");
    expect(html).toMatch(/id="mode-btn-druckmasse" data-hilfe="dkm-modus"/);
    expect(pflege).not.toMatch(/method:\s*'DELETE'|\/loeschen|\btitle=/);
    expect(new Set([...pflege.matchAll(/\/api\/[\w/-]+/g)].map(m => m[0]))).toEqual(new Set(['/api/druckmasse']));
    expect(anzeige + pflege).not.toMatch(/console\.|localStorage|sessionStorage/);
  });
});
