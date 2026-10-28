// LS4: Ansicht "L-Shop-Modelle" in frontend/index.html - reine Logik aus dem Block
// "L-Shop-Modelle: Anfang/Ende" (Sammelliste, Ampel, Auswahl) und die Verdrahtung im HTML.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── L-Shop-Modelle: Anfang');
const bis = html.indexOf('// ── L-Shop-Modelle: Ende ──');
const L = new Function(`${html.slice(von, bis)}
return { LSM_MAX, LSM_STUFEN, lsmStufe, lsmHinzufuegen, lsmMitAmpel, lsmMitErgebnis, lsmWaehle, lsmAuswahl, lsmVorschauText, lsmZeileHtml };`)();

describe('Block L-Shop-Modelle', () => {
  test('gefunden', () => {
    expect(von).toBeGreaterThan(0);
    expect(bis).toBeGreaterThan(von);
  });

  test('Hinzufuegen: getrimmt, keine Doppelten (Gross/Klein egal), leer und zu viele abgelehnt, Notiz max. 80', () => {
    let r = L.lsmHinzufuegen([], '  by289 ', ' Verein  X ');
    expect(r).toEqual({ liste: [{ text: 'by289', notiz: 'Verein X', stufe: 'neu' }], fehler: '' });
    expect(L.lsmHinzufuegen(r.liste, 'BY289', '').fehler).toMatch(/steht schon auf der Liste/);
    expect(L.lsmHinzufuegen(r.liste, '   ', '').fehler).toMatch(/eingeben/);
    const voll = Array.from({ length: L.LSM_MAX }, (_, i) => ({ text: `M${i}`, stufe: 'neu' }));
    expect(L.lsmHinzufuegen(voll, 'X1', '').fehler).toMatch(/Höchstens 30/);
    r = L.lsmHinzufuegen([], 'E3000', 'x'.repeat(200));
    expect([...r.liste[0].notiz]).toHaveLength(80);
  });

  test('Ampel nur fuer Zeilen ohne Ergebnis; "da" bringt Modell und Vorschau', () => {
    const liste = [{ text: 'e3000', stufe: 'neu' }, { text: 'BY289', stufe: 'gefunden', catalogNr: 'BY289' }];
    const neu = L.lsmMitAmpel(liste, [
      { eingabe: 'e3000', modell: 'E3000', stufe: 'da', vorschau: { name: 'T' } },
      { eingabe: 'BY289', modell: 'BY289', stufe: 'suchen' },
    ]);
    expect(neu[0]).toMatchObject({ stufe: 'da', catalogNr: 'E3000', vorschau: { name: 'T' } });
    expect(neu[1]).toBe(liste[1]);
  });

  test('Pruefergebnis, Vorschlag waehlen, Auswahl fuers Uebernehmen', () => {
    let liste = [
      { text: 'E3000', stufe: 'suchen' }, { text: 'BY289', stufe: 'suchen', notiz: 'n' }, { text: 'TU03T', stufe: 'suchen' },
      { text: 'Fluffy', stufe: 'suchen' }, { text: 'ZZ123', stufe: 'suchen' },
    ];
    liste = L.lsmMitErgebnis(liste, [
      { eingabe: 'E3000', stufe: 'da', catalogNr: 'E3000' },
      { eingabe: 'BY289', stufe: 'gefunden', catalogNr: 'BY289', vorschau: { name: 'Ladies Fluffy Hoody' } },
      { eingabe: 'TU03T', stufe: 'vorschlag', vorschlaege: [{ catalogNr: 'BCTU03T', weg: 'hersteller', vorschau: { name: 'Tee' } }] },
      { eingabe: 'Fluffy', stufe: 'vorschlag', vorschlaege: [{ catalogNr: 'BY284', weg: 'name' }, { catalogNr: 'BY289', weg: 'name' }] },
      { eingabe: 'ZZ123', stufe: 'nicht' },
    ]);
    expect(L.lsmAuswahl(liste)).toEqual([{ catalogNr: 'BY289', notiz: 'n' }]);
    liste = L.lsmWaehle(liste, 2, 'BCTU03T');
    expect(liste[2]).toMatchObject({ stufe: 'gewaehlt', catalogNr: 'BCTU03T', vorschau: { name: 'Tee' } });
    liste = L.lsmWaehle(liste, 3, 'BY289');                        // dasselbe Modell wie Zeile 2 -> einmal
    expect(L.lsmAuswahl(liste).map(a => a.catalogNr)).toEqual(['BY289', 'BCTU03T']);
    expect(L.lsmWaehle(liste, 4, 'BY289')[4]).toBe(liste[4]);      // kein Vorschlag -> unveraendert
    const schonDa = L.lsmWaehle([{ text: 'x', stufe: 'vorschlag', vorschlaege: [{ catalogNr: 'E3000', schonDa: true }] }], 0, 'E3000');
    expect(schonDa[0].stufe).toBe('da');
    expect(L.lsmAuswahl(schonDa)).toEqual([]);
  });

  test('Anzeige: maskiert, Stufe als Farbe, Vorschlags-Knoepfe mit Hilfe, Auslauf gelb', () => {
    const h = L.lsmZeileHtml({ text: '<b>', stufe: 'vorschlag', vorschlaege: [{ catalogNr: 'BCTU03T', weg: 'hersteller', vorschau: { name: '<i>Tee</i>' } }] }, 3);
    expect(h).not.toMatch(/<b>|<i>/);
    expect(h).toMatch(/lsm-gelb/);
    expect(h).toMatch(/data-lsm-waehle="3" data-modell="BCTU03T" data-hilfe="lsm-meintest"/);
    expect(h).toMatch(/Hersteller-Nummer/);
    const g = L.lsmZeileHtml({ text: 'BY289', stufe: 'gefunden', catalogNr: 'BY289', vorschau: { name: 'Hoody', marke: 'BYB', farben: ['Black', 'White'], groessen: ['XS', 'S', '5XL'], auslaufend: ['White'], gesperrt: [] } }, 0);
    expect(g).toMatch(/lsm-gruen/);
    expect(g).toMatch(/Hoody · BYB · 2 Farben · Größen XS–5XL/);
    expect(g).toMatch(/läuft aus: White/);
    expect(L.lsmZeileHtml({ text: 'ZZ1', stufe: 'nicht' }, 0)).toMatch(/lsm-rot/);
    for (const s of Object.keys(L.LSM_STUFEN)) expect(L.lsmStufe({ stufe: s }).text).toMatch(/\S/);
  });
});

describe('Verdrahtung im HTML', () => {
  test('Modus-Knopf, Panel und Zeile in der Navigation', () => {
    expect(html).toMatch(/<button class="mode-btn" id="mode-btn-lshopmodelle">/);
    expect(html).toMatch(/<div id="lsm-panel" style="display:none;">/);
    expect(html).toMatch(/\{ id: 'lshop-modelle', panel: 'products', knopf: '#mode-btn-lshopmodelle'/);
  });

  test('jeder andere Modus blendet die Ansicht aus', () => {
    const anzahl = (html.match(/lsmAus\(\);/g) ?? []).length;
    expect(anzahl).toBe(3);   // setMode, setSeoMode, setSeAendernModus
  });

  test('Links aus Warenkorb und Erfassung fuehren hierher', () => {
    expect(html).toMatch(/data-lsm-link data-hilfe="lsm-link">Neues L-Shop-Modell aufnehmen/);
    expect(html).toMatch(/link\.dataset\.lsmLink = ''/);
    expect(html).toMatch(/window\.oeffneAnsicht\('artikel', 'lshop-modelle'\)/);
  });

  test('Uebernehmen nur nach Pruefen, mit Bestaetigung; keine Preise im Code der Ansicht', () => {
    const teil = html.slice(html.indexOf('// ── SECTION: L-Shop-Modelle (LS4) ──'), html.indexOf('// ── SECTION: SEO-Daten aendern (Befehl SE1) ──'));
    expect(teil).toMatch(/!lsm\.datei \|\| !lsm\.darf/);
    expect(teil).toMatch(/showConfirm\('L-Shop-Modelle übernehmen'/);
    expect(teil).not.toMatch(/10CartonsPrice|\.preis\b|\bek\b/i);
    expect(teil).toMatch(/localStorage\.setItem\(LSM_SPEICHER, JSON\.stringify\(lsm\.liste\.map\(z => \(\{ text: z\.text, notiz: z\.notiz \}\)\)\)\)/);
  });
});
