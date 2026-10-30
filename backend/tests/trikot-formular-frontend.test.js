// TR3: Dialog "Produzenten-Bestellung" in frontend/index.html - reine Anzeige-Logik aus dem Block "Trikot-Formular".
// Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const trikots = html.slice(html.indexOf('// ── Trikots: Anfang'), html.indexOf('// ── Trikots: Ende ──'));
const formular = html.slice(html.indexOf('// ── Trikot-Formular: Anfang'), html.indexOf('// ── Trikot-Formular: Ende ──'));
const F = new Function(`${trikots}\n${formular}
return { trVorwahl, trAuswahlListe, trAuswahlSchluessel, trAuswahlHtml, trVorschauHtml, trFormularGrund };`)();

const zeilen = [
  { zeile: 5, id: '1|1|1', produktKurz: 'Heim', groesse: 'L', name: 'ALPHA', nummer: '7', hinweise: [] },
  { zeile: 6, id: '2|1|1', produktKurz: 'Heim', groesse: '120', name: '', nummer: '9', hinweise: ['name_leer'] },
  { zeile: 7, id: 'INT-2026-0001', produktKurz: 'Auswärts', groesse: 'S', name: '<b>X</b>', nummer: '07', hinweise: [] },
];
const vorschau = {
  charge: 7, nummer: '2026/07', dateiname: '7. Crocodiles Hamburg 26_27.xlsx',
  kopf: { bestelltAm: '30.10.2026', lieferung: '29.11.2026', team: 'Crocodiles Hamburg', nummer: '2026/07', wiederholung: 'NO' },
  positionen: [{ zeile: 5, artikel: 'Trikot schwarz', kragen: '', material: 'Heavy', groesse: 'L', name: 'ALPHA', nummer: '7' }],
  zaehler: [{ produkt: 'Heim', groesse: 'L', anzahl: 1 }], probleme: [], ohneZuordnung: [], einrichtung: [],
};

describe('Block Trikot-Formular', () => {
  test('Vorwahl: nur Zeilen ohne Hinweis; Auswahl-Liste und Schluessel', () => {
    const gew = F.trVorwahl(zeilen);
    expect([...gew]).toEqual([5, 7]);
    const a = F.trAuswahlListe(zeilen, gew);
    expect(a).toEqual([{ id: '1|1|1', zeile: 5 }, { id: 'INT-2026-0001', zeile: 7 }]);
    expect(F.trAuswahlSchluessel([...a].reverse())).toBe(F.trAuswahlSchluessel(a));
  });
  test('Auswahl-Liste: Hinweis sichtbar, escaped, Haken nur bei der Vorwahl', () => {
    const h = F.trAuswahlHtml(zeilen, new Set([5]));
    expect(h).toMatch(/data-tr-wahl="5" checked/);
    expect(h).toMatch(/data-tr-wahl="6">/);
    expect(h).toMatch(/\(Name nicht übernommen\)/);
    expect(h).toContain('&#60;b&#62;X&#60;/b&#62;');
  });
  test('Vorschau zeigt Kopf, Nummer vorlaeufig, Tabelle, Zaehler; ohne Zuordnung gelb', () => {
    const h = F.trVorschauHtml(vorschau);
    expect(h).toMatch(/2026\/07 \(vorläufig\)/);
    expect(h).toMatch(/<td>1<\/td><td>Trikot schwarz<\/td><td><\/td><td>Heavy<\/td><td>L<\/td><td>ALPHA<\/td><td>7<\/td><td><\/td>/);
    expect(h).toMatch(/1 Trikot · Heim L: 1 · Datei: 7\. Crocodiles Hamburg 26_27\.xlsx/);
    const g = F.trVorschauHtml({ ...vorschau, ohneZuordnung: [5], positionen: [{ ...vorschau.positionen[0], artikel: '' }] });
    expect(g).toMatch(/<tr class="tr-gelb"><td>1<\/td><td>keine Zuordnung/);
    expect(g).toMatch(/Ohne Zuordnung \(nicht exportierbar\): Zeile 5/);
  });
  test('Eintragen erst nach dem Download genau dieser Auswahl; gesperrt bei Problemen', () => {
    const auswahl = [{ id: '1|1|1', zeile: 5 }];
    const g = z => F.trFormularGrund({ vorschau, auswahl, heruntergeladen: '', laeuft: false, ...z });
    expect(g()).toBe('erst-download');
    expect(g({ heruntergeladen: F.trAuswahlSchluessel(auswahl) })).toBe('');
    expect(g({ heruntergeladen: F.trAuswahlSchluessel([{ id: '2|1|1', zeile: 6 }]) })).toBe('erst-download');
    expect(g({ laeuft: true })).toBe('laeuft');
    expect(g({ auswahl: [] })).toBe('leer');
    expect(g({ vorschau: { ...vorschau, ohneZuordnung: [5] } })).toBe('gesperrt');
    expect(g({ vorschau: { ...vorschau, einrichtung: ['Formular_Artikel'] } })).toBe('gesperrt');
  });
});

describe('Einbindung', () => {
  const teil = html.slice(html.indexOf('// ── Trikot-Formular: Anfang'), html.indexOf('// ── SECTION: Artikelerfassung ──'));
  test('Knopf, Dialog, drei Endpunkte, Bestaetigung vor dem Eintragen', () => {
    expect(html).toMatch(/id="tr-formular-oeffnen" data-hilfe="tr-formular">Produzenten-Bestellung …<\/button>/);
    expect(html).toMatch(/<div id="tr-dialog" class="edi-dialog" role="dialog" aria-modal="true" aria-labelledby="tr-titel" hidden>/);
    for (const p of ['vorschau', 'datei', 'eintragen']) expect(teil).toContain(`/api/bestellen/trikots/formular/${p}`);
    expect(teil).toMatch(/showConfirm\('Als bestellt eintragen'/);
    expect(teil).toMatch(/if \(grund\) \{ showToast\(/);   // nie still nichts
  });
  test('Datei geht nur an den Browser; keine Speicherung im Browser', () => {
    expect(teil).toMatch(/URL\.createObjectURL\(await res\.blob\(\)\)/);
    expect(teil).not.toMatch(/localStorage|sessionStorage/);
  });
});
