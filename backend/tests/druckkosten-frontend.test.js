// DK1/DK2: Oberflaeche der Druckkosten (Auftragsansicht) und der Pflege-Ansicht Artikel -> Druckmaße. Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handTeile, zuordnenVorschlag, POSITIONEN } from '../utils/druckkosten.js';

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
  const auZ = { daten: { druck: { hand: true, express: true, druckmasse: true, modell: true } } };
  const f = new Function('apT', 'kuEsc', 'apEuroText', 'auZ', `${anzeige}\nreturn { dkHandTeile, dkZuordnenVorschlag, dkGruppen, dkKalkHtml, dkPosFeldHtml, dkSetOptionen, DK_POSITIONEN };`)(apT, kuEsc, apEuroText, auZ);

  test('Spiegel: dkHandTeile = handTeile, Vorschlag = zuordnenVorschlag, Positionsliste gleich', () => {
    for (const z of ['Brust 10,5x5; Rücken 28x17,5', 'Ärmel links 8 × 4', 'Rücken 28x? H; Brust ?x12,5 B', 'Ruecken L boardgame club 29x32', '', 'kaputt']) {
      expect(f.dkHandTeile(z)).toEqual(handTeile(z));
    }
    const alt = 'Ruecken L boardgame club 29x32; ruecken M boardgame club 28x31; Brust M boardgame club 11x12.5';
    expect(f.dkZuordnenVorschlag(alt)).toEqual(zuordnenVorschlag(alt));
    expect(f.DK_POSITIONEN).toEqual(POSITIONEN);
  });
  const auftrag = (druck, extra = {}) => ({
    Auftrag_Nr: 'AU-2026-0099', Status: 'Design',
    positionen: [
      { Position_ID: 'AU-2026-0099-01', Art: 'lshop', lshop: { modell: 'X1', farbe: 'Black', groesse: 'M' }, Motiv: 'Skyline', Menge: 2 },
      { Position_ID: 'AU-2026-0099-02', Art: 'lshop', lshop: { modell: 'X1', farbe: 'Black', groesse: 'L' }, Motiv: 'Skyline', Menge: 1 },
      { Position_ID: 'AU-2026-0099-03', Art: 'frei', Freitext: 'Tasse', Druck: 'Stick', Menge: 1 },
    ],
    preise: { umsatzMitEk: 5000, druck: { express: false, gesamt: 1573, rohertragNachDruck: 2000, rohertragNachDruckProzent: 40, offen: 0, positionen: druck } },
    ...extra,
  });
  const ok = { status: 'ok', quelle: 'tabelle', teile: [{ position: 'Rücken', breite: 28, hoehe: 17.5, fuehrend: 'Breite' }], flaeche: 490, stueck: 524.26, netto: 1049 };
  const kein = { status: 'kein_dtf', text: 'Druckart ist nicht DTF – keine Druckkosten' };

  test('Kalkulation: je Größenzeile Maße (führende Seite fett), Quelle, Kosten; Summe und Rohertrag nach Druck', () => {
    const hoch = { ...ok, quelle: 'hand', teile: [{ position: 'Rücken', breite: 28, hoehe: 31, fuehrend: 'Hoehe' }], netto: 524 };
    const h = f.dkKalkHtml(auftrag([ok, hoch, kein]));
    expect((h.match(/class="dk-gruppe"/g) || []).length).toBe(2);
    expect((h.match(/class="dk-zeile-anzeige"/g) || []).length).toBe(2);   // Stick-Gruppe: ein Satz statt je Zeile
    expect(h).toContain('Rücken <b>28</b> × 17,5');
    expect(h).toContain('Rücken 28 × <b>31</b>');
    expect(h).toContain('(hinterlegt)');
    expect(h).toContain('(von Hand)');
    expect(h).toContain('10,49 €');
    expect(h).toContain('15,73 €');
    expect(h).toContain('Rohertrag nach Druck');
    expect(h).toContain('(40 %)');
    expect(h).toContain('data-hilfe="dk-kein-dtf"');
    expect(h).toContain('data-dk-pos="AU-2026-0099-02"');
    expect(h).not.toMatch(/data-dk-express[^>]*checked/);
  });
  test('nie still nichts: jeder Grund steht orange an der Position, dazu der Hinweis auf den Zwischenspeicher', () => {
    const gruende = [
      { status: 'preis_fehlt', text: 'Preis fehlt (Einstellungen)', teile: ok.teile, flaeche: 490, quelle: 'tabelle' },
      { status: 'seite_fehlt', text: 'Höhe fehlt für Rücken, Größe L (führende Seite Breite)', teile: [{ position: 'Rücken', breite: 28, hoehe: null, fuehrend: 'Breite' }], quelle: 'hand' },
      kein,
    ];
    const h = f.dkKalkHtml(auftrag(gruende));
    expect(h).toMatch(/class="au-lager-knapp dk-grund" data-hilfe="dk-preis-fehlt"[^>]*>Preis fehlt \(Einstellungen\)/);
    expect(h).toContain('Höhe fehlt für Rücken, Größe L (führende Seite Breite)');
    expect(h).toContain('Druckart ist nicht DTF');
    expect(h).toContain('data-hilfe="dk-aktualisiert"');
    const z = f.dkKalkHtml(auftrag([{ status: 'zuordnen', text: 'Maße bitte zuordnen (alter Freitext) – „Maße …“ öffnen', quelle: 'hand', teile: [] }, { status: 'ohne_mass', text: 'Maß fehlt für Größe L – „Maße …“ wählen oder eingeben' }, kein]));
    expect(z).toContain('data-hilfe="dk-zuordnen"');
    expect(z).toContain('Maß fehlt für Größe L');
  });
  test('Feld „Maße …“ je Größenzeile in der Auftragsansicht', () => {
    const a = auftrag([ok, { status: 'ohne_mass', text: 'Maß fehlt für Größe L – „Maße …“ wählen oder eingeben' }, kein]);
    const m = f.dkPosFeldHtml(a, a.positionen[0]);
    expect(m).toContain('data-dk-pos="AU-2026-0099-01"');
    expect(m).toContain('Maße: Rücken <b>28</b> × 17,5');
    expect(m).toContain('5,24 € je Teil netto');
    const l = f.dkPosFeldHtml(a, a.positionen[1]);
    expect(l).toContain('Maße wählen …');
    expect(l).toContain('Maß fehlt für Größe L');
    expect(f.dkPosFeldHtml(a, a.positionen[2])).toBe('');   // Stick: steht einmal in der Kalkulation
    auZ.daten.druck.hand = false;   // ohne Spalte: anzeigen, nicht anklickbar
    expect(f.dkPosFeldHtml(a, a.positionen[0])).not.toContain('data-dk-pos');
    auZ.daten.druck.hand = true;
  });
  test('Maß-Sets: zuerst die für Motiv + Größe (oder alle) + Modell, dann die übrigen', () => {
    const sets = [
      { bezug: 'Skyline', groesse: 'L', modell: '', teile: [{ position: 'Rücken', breite: 29, hoehe: 32 }] },
      { bezug: 'Skyline', groesse: 'M', modell: '', teile: [{ position: 'Rücken', breite: 28, hoehe: 31 }] },
      { bezug: 'Skyline', groesse: 'alle', modell: 'Y9', teile: [{ position: 'Brust', breite: 10, hoehe: 10 }] },
      { bezug: 'Anker', groesse: 'alle', modell: '', teile: [{ position: 'Brust', breite: 8, hoehe: 8 }] },
    ];
    const h = f.dkSetOptionen(sets, 'skyline', 'L', 'X1');
    const [eigen, andere] = h.split('<optgroup label="andere Motive">');
    expect(eigen).toContain('Skyline – Größe L');
    expect(eigen).not.toContain('Größe M');
    expect(andere).toContain('Größe M');
    expect(andere).toContain('Y9');
    expect(andere).toContain('Anker');
    expect(f.dkSetOptionen([], 'Skyline', 'L', '')).toContain('kein Maß-Set');
  });
  test('storniert: nichts änderbar', () => {
    const a = auftrag([ok, ok, kein], { Status: 'storniert' });
    expect(f.dkKalkHtml(a)).not.toContain('data-dk-pos');
    expect(f.dkPosFeldHtml(a, a.positionen[0])).not.toContain('data-dk-pos');
    expect(f.dkKalkHtml(a)).toMatch(/data-dk-express[^>]*disabled/);
  });
  test('Dialog: Position nur aus der Liste, Umschalter führende Seite, je Größenzeile gespeichert, merken + sofort neu laden', () => {
    const dialog = html.slice(html.indexOf('<div id="dk-dialog"'), html.indexOf('<div id="au-nachsehen"'));
    expect(dialog).toContain('id="dk-set"');
    expect(dialog).toContain('id="dk-alle-groessen"');
    expect(dialog).toContain('id="dk-merken"');
    expect(dialog).not.toMatch(/dk-pos"[^>]*maxlength|<datalist/);
    const rest = html.slice(html.indexOf('// ── Druckkosten-Anzeige: Ende ──'), html.indexOf("auEl('dk-abbrechen').addEventListener('click', dkSchliessen);"));
    expect(rest).toContain('class="form-select dk-pos-wahl"');
    expect(rest).toContain('data-hilfe="dk-fuehrend"');
    expect(rest).toContain("const ids = alle ? g.ids : [p.Position_ID];");
    expect(rest).toMatch(/dkPost\('merken'[\s\S]*auPost\('druckmasse-hand'[\s\S]*await loadAuftraege\(\)/);
    expect(html).toContain('+ dkPosFeldHtml(a, p)');
  });
  test('„Wie letztes Mal“ nimmt die Maße von Hand mit', () => {
    expect(html).toContain('e.druckmasseHand = apT(p.Druckmasse_Hand);');
    expect(html).toContain("...(!p.positionId && p.druckmasseHand ? { druckmasseHand: p.druckmasseHand } : {}),");
  });
});

describe('Pflege-Ansicht Druckmaße', () => {
  const f = new Function(`${pflege}\nreturn { dkmFiltern, dkmPreiseText, dkmListeHtml };`)();
  const zeilen = [
    { id: 'DM-0002', bezug: 'Skyline', position: 'Brust', groesse: 'alle', notiz: '', aktiv: true, fuehrend: 'Breite', modell: '', breite: 10, hoehe: 5 },
    { id: 'DM-0001', bezug: 'Anker', position: 'Rücken', groesse: 'alle', notiz: 'groß', aktiv: true, fuehrend: 'Hoehe', modell: 'X1', breite: 28, hoehe: 31 },
    { id: 'DM-0003', bezug: 'Skyline', position: 'Nacken', groesse: 'alle', notiz: '', aktiv: false, fuehrend: 'Breite', modell: '' },
  ];
  test('Suche je Wort, inaktive nur mit Haken, sortiert nach Motiv', () => {
    expect(f.dkmFiltern(zeilen).map(z => z.id)).toEqual(['DM-0001', 'DM-0002']);
    expect(f.dkmFiltern(zeilen, { inaktive: true, suche: 'sky' }).map(z => z.id)).toEqual(['DM-0002', 'DM-0003']);
    expect(f.dkmFiltern(zeilen, { suche: 'anker groß' }).map(z => z.id)).toEqual(['DM-0001']);
    expect(f.dkmFiltern(zeilen, { suche: 'x1' }).map(z => z.id)).toEqual(['DM-0001']);
  });
  test('DK2: Filter und Anzeige der führenden Seite, Modell', () => {
    expect(f.dkmFiltern(zeilen, { fuehrend: 'Hoehe' }).map(z => z.id)).toEqual(['DM-0001']);
    expect(f.dkmFiltern(zeilen, { fuehrend: 'Breite' }).map(z => z.id)).toEqual(['DM-0002']);
    const h = f.dkmListeHtml(f.dkmFiltern(zeilen));
    expect(h).toContain('28 × <b>31</b>');
    expect(h).toContain('<b>10</b> × 5');
    expect(h).toContain('>X1<');
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
    expect(html).toContain('<select id="dkm-f-position" class="form-select"');
    expect(html).toContain('id="dkm-f-fuehrend"');
    expect(html).toContain('id="dkm-fuehrend-filter"');
  });
});
