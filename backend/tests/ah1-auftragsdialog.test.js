// AH1: Auftragsdialog fuers Handy (U1-U5, U10, U13, U15), Handy-Grundgroessen, Statuszeile der Artikelmaske.
// Quelltext-Pruefungen + reine Hilfsfunktionen. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const ersterStyle = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const handy = html.slice(html.indexOf('/* ── Handy-Grundgrößen: Anfang'), html.indexOf('/* ── Handy-Grundgrößen: Ende ── */'));
const fn = name => {   // eine Funktionsdeklaration aus dem Quelltext (bis zur naechsten Zeile, die mit "      }" endet)
  const a = html.indexOf(`function ${name}(`);
  return html.slice(a, html.indexOf('\n      }\n', a) + 8);
};

describe('Handy-Grundgroessen (U2/UI2)', () => {
  test('ein Block am Ende des ersten <style>, nur bis 600 px', () => {
    expect(handy.length).toBeGreaterThan(200);
    expect(ersterStyle).toContain('/* ── Handy-Grundgrößen: Ende ── */');
    expect(ersterStyle.trimEnd().endsWith('/* ── Handy-Grundgrößen: Ende ── */')).toBe(true);   // steht zuletzt -> gewinnt bei gleicher Spezifitaet
    expect(handy).toContain('@media (max-width: 600px) {');
    expect((handy.match(/@media/g) ?? []).length).toBe(1);   // Desktop unveraendert
  });
  test('Felder 16 px (kein iPhone-Zoom), Tippflaechen 40 px, Auftragsdialog 44 px, Schrift 12 px', () => {
    expect(handy).toMatch(/select, textarea \{ font-size: 16px !important; \}/);
    expect(handy).toContain('.form-input, .form-select { min-height: 40px; }');
    expect(handy).toMatch(/#au-dialog \.korb-aktion[^{]*#au-raster input[^{]*#au-detail \.hilfe-i[^{]*\{ min-height: 44px; \}/);
    expect(handy).toMatch(/\.sub-tab, [^{]*\{ font-size: 12px; \}/);
    // Textknoepfe: Flaeche ueber Polster nur in Auftragsliste/-dialog/-ansicht; allgemein nicht (Nachbarn ueberdeckten sich, Messung AH1)
    expect(handy).toContain('#au-dialog button.korb-link, #au-detail button.korb-link, #au-liste button.korb-link { padding-block: 15px; margin-block: -15px; }');
    expect(handy).not.toMatch(/^s*button.korb-link {/m);
  });
});

describe('Auftragsdialog', () => {
  test('U1: Schliessen, Abbrechen und Esc fragen nach (nur mit Eingaben seit dem Oeffnen)', () => {
    expect(html).toContain("auEl('au-abbrechen').addEventListener('click', auDialogAbbrechen);");
    expect(html).toContain("auEl('au-schliessen').addEventListener('click', auDialogAbbrechen);");
    expect(html).toContain("auEl('au-dialog').addEventListener('keydown', e => { if (e.key === 'Escape') auDialogAbbrechen(); });");
    expect(html).toContain('auDlg.startStand = auDialogStand();');
    const ab = fn('auDialogAbbrechen');
    expect(ab).toContain("auDialogStand() !== auDlg.startStand && (auDlg.modus !== 'neu' || auDialogEingaben())");   // vorhandene Pruefung genutzt
    expect(ab).toContain("showConfirm('Eingaben verwerfen?'");
    // nach dem Speichern schliesst der Dialog ohne Frage
    expect(fn('auSpeichern')).toContain('auDialogSchliessen();');
  });
  test('U3: Fehlermeldung und Speichern/Abbrechen im festen Fuss, Pflichtfelder markiert, Tastatur', () => {
    const fuss = html.slice(html.indexOf('<div class="au-fuss">'), html.indexOf('id="au-abbrechen"'));
    expect(fuss).toContain('id="au-fehler"');
    expect(fuss).toContain('id="au-speichern"');
    expect(html).toMatch(/\.au-fuss \{ position: sticky; bottom: -1rem;/);
    expect(html).toContain('<input id="au-Kurztitel" type="text" class="form-input" maxlength="80" autocomplete="off" placeholder="z. B. Polos Saison 27" aria-required="true" />');
    expect(html).toContain('window.visualViewport');
  });
  test('U2: die ganze Listenzeile oeffnet, Bedienelemente in der Zeile nicht', () => {
    expect(html).toContain("if (e.target.closest('button, a, select, input, label')) return;");
    expect(html).toContain("const z = e.target.closest('.ku-zeile[data-au-nr], .ku-zeile[data-ag-nr]');");
  });
  test('U4: neue Gruppe uebernimmt Motiv, Druck, Preis der letzten L-Shop-Gruppe, orange bis bearbeitet', () => {
    expect(html).toContain("const AU_VORBELEG_FELDER = ['motiv', 'druck', 'preis', 'aufpreis'];");
    const ueb = fn('auRasterUebernehmen');
    expect(ueb).toContain("const letzte = !alt.length && !vb ? [...auDlg.entwurf].reverse().find(p => p.art === 'lshop') : null;");
    expect(ueb).toContain('vorbelegt: [...vonLetzter]');
    expect(html).toContain("'au-vorbelegt':");
    expect(html).toContain('data-hilfe="au-vorbelegt"');
    // die Markierung geht nicht an den Server (feste Feldliste)
    const anfrage = html.slice(html.indexOf('const auPositionenAnfrage = '), html.indexOf('}));', html.indexOf('const auPositionenAnfrage = ')));
    expect(anfrage).not.toContain('vorbelegt');
  });
  test('U5: Suchbegriff wird Name des neuen Kunden; Name nur, wenn er wie ein Name aussieht', () => {
    expect(html).toContain("kuDialogOeffnen(null, { nachSpeichern: k => auKundeSetzen(k), name: auNameAusSuche(q) })");
    const zeile = html.slice(html.indexOf('const auNameAusSuche = '), html.indexOf('\n', html.indexOf('const auNameAusSuche = ')));
    const auNameAusSuche = new Function(`${zeile}\nreturn auNameAusSuche;`)();
    expect(auNameAusSuche('  Fanclub Möwe ')).toBe('Fanclub Möwe');
    expect(auNameAusSuche('K-00012')).toBe('');
    expect(auNameAusSuche('0151 234')).toBe('');
    expect(auNameAusSuche('kasse@verein.example')).toBe('');
  });
  test('U13: Raster merkt sich Getipptes (Farbwechsel, Lager), neues Modell/Uebernehmen frisch; alte Antworten verworfen', () => {
    const z = fn('auRasterZeichnen');
    expect(z).toContain('const getippt = frisch ? auDlg.getippt : auRasterMerken();');
    expect(z).toContain('getippt.nr.get(r.articleNr) ?? vorhanden.get(r.articleNr) ?? getippt.groesse.get(r.groesse)');
    expect(fn('auModellWaehlen')).toContain('auRasterZeichnen({ frisch: true });');
    expect(fn('auModellWaehlen')).toContain('if (nr !== auDlg.modellNr) return;');
    expect(html).toContain('if (nr !== auDlg.suchNr) return;');
  });
});

describe('Auftragsansicht und Meldungen', () => {
  test('U10: Fehler nur noch ueber auDFehler (an der Zeile, ueberlebt Neuzeichnen, Erfolg leert)', () => {
    const direkt = html.match(/auEl\('au-d-fehler'\)\.textContent = /g) ?? [];
    expect(direkt.length).toBe(0);
    expect(html).toContain('queueMicrotask(auDFehlerZeigen);');
    expect((html.match(/auDFehler\(''\);/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
  test('U10: Bereitstellen-Fehler bleibt neben den Problemen der neuen Vorschau stehen', () => {
    expect(html).toContain("auEl('ab-fehler').textContent = [abZ.fehler, ...andere");
    expect(fn('abBereitstellen')).toContain('abZ.fehler = ohneSkriptname(e.message);');
  });
  test('U15: Fehlertoast bleibt bis zum Antippen; Skriptnamen fallen aus Meldungen', () => {
    const toast = fn('showToast');
    expect(toast).toContain("if (!fehler) setTimeout(");
    expect(toast).toContain("el.addEventListener('click', () => { el.remove(); toastStapeln(); });");
    const ohneSkriptname = new Function(`${fn('ohneSkriptname')}\nreturn ohneSkriptname;`)();
    expect(ohneSkriptname('Kunde gespeichert.')).toBe('Kunde gespeichert.');
    const t = ohneSkriptname('Spalte Design_Am fehlt – erst Setup (scripts/setup-auftraege-reiter.js --write).');
    expect(t).not.toMatch(/scripts|setup-|--write/);
    expect(t).toContain('Spalte Design_Am fehlt');
    expect(t).toContain('bitte dem Inhaber Bescheid geben');
    // feste Texte ohne Skriptnamen
    expect(html).not.toMatch(/textContent = [^;]*scripts\/setup-/);
    expect(html).not.toMatch(/'<div class="lager-warnung">[^']*scripts\/setup-/);
  });
});

describe('Artikelmaske (UI2 Teil 3)', () => {
  test('Statuszeile endet mit den Karten; STATUS nie leer', () => {
    const layout = html.slice(html.indexOf('/* ── Layout: Anfang'), html.indexOf('/* ── Layout: Ende ── */'));
    expect(layout).toContain('.panel .status-bar { max-width: var(--karten-max-breite); }');
    expect(html).toContain('<span id="prod-status-text" class="form-input accent" style="display:none;cursor:default;">—</span>');
    expect(html).not.toContain("getElementById('prod-status-text').textContent = '';");
  });
});
