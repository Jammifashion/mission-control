// FB1: Feedback-Knopf und Dialog in MC (Quelltext + reine Logik des Blocks "Feedback"). Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TEXT_MAX, pruefeEingabe } from '../utils/feedback.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Feedback: Anfang'), html.indexOf('// ── Feedback: Ende ──'));
const F = new Function(`${block}\nreturn { FB_TEXT_MAX, FB_DIALOG_NAMEN, fbDialogName, fbObjektAus, fbAnsichtLesbar, fbZaehlerText, fbKontextText };`)();
const sektion = html.slice(html.indexOf('// ── SECTION: Feedback (FB1) ──'), html.indexOf('// ── SECTION: Kundenanfragen Extern ──'));
const dialog = html.slice(html.indexOf('<div id="fb-dialog"'), html.indexOf('<!-- Shop-Auswahl Modal'));

describe('Knopf und Dialog', () => {
  test('Knopf im Kopf mit Mouse-over, ohne title', () => {
    const knopf = /<button id="feedback-oeffnen"[^>]*>/.exec(html)[0];
    expect(knopf).toContain('data-hilfe="feedback-oeffnen"');
    expect(knopf).not.toMatch(/\btitle=/);
    expect(html.indexOf('id="feedback-oeffnen"')).toBeLessThan(html.indexOf('id="abmelden-kopf"'));
  });
  test('Dialog: Textfeld 2.000 Zeichen, Hinweis wortgleich, ⓘ, kein Auswahlfeld fuer "Wer"', () => {
    expect(dialog).toContain('<textarea id="fb-text" class="form-input fb-text" rows="5" maxlength="2000"');
    expect(dialog).toContain('Der Text geht zur Einordnung an Claude (Anthropic) und wird im Feedback-Sheet gespeichert. Bitte keine Kundendaten.');
    expect(dialog).toContain('data-hilfe-gruppe="feedback"');
    expect(dialog).not.toMatch(/<select|type="radio"/);
    expect(dialog).not.toMatch(/\btitle=|\son[a-z]+=/);
    for (const id of ['fb-senden', 'fb-abbrechen', 'fb-schliessen']) expect(dialog).toMatch(new RegExp(`id="${id}"[^>]*data-hilfe="`));
  });
  test('Hilfe-Texte und Gruppe vorhanden', () => {
    for (const k of ['feedback-oeffnen', 'fb-text', 'fb-senden']) expect(html).toMatch(new RegExp(`'${k}':\\s+\\{ name: '`));
    expect(html).toContain("'feedback': ['fb-text', 'fb-senden', 'dialog-abbrechen', 'dialog-schliessen'],");
    expect(html).toMatch(/'navigation': \['shop-badge', 'feedback-oeffnen', 'abmelden'/);
  });
  test('Handy: Tippflaechen 44 px, Feld 16 px, Dialog liegt ueber allen anderen', () => {
    expect(html).toContain('#fb-dialog { z-index: 60; }');
    expect(html).toContain('.kopf-feedback { min-width: 44px; min-height: 44px;');
    expect(html).toContain('#fb-dialog .fb-text { font-size: 16px;');
    expect(html).toContain('#fb-dialog .korb-aktion, #fb-dialog .hilfe-i { min-height: 44px; }');
  });
});

describe('Verhalten (Quelltext)', () => {
  test('nur senden: POST /api/feedback, kein Lesen, kein Browser-Speicher fuer Text oder "Wer"', () => {
    expect(sektion).toContain('`${API_BASE()}/api/feedback`');
    expect(html.split('`${API_BASE()}/api/feedback`').length - 1).toBe(1);   // genau ein Aufruf, kein GET
    expect(sektion).not.toMatch(/localStorage\.setItem|sessionStorage/);
    expect(sektion).toContain('localStorage.getItem(ANMELDE_NAME_KEY)');           // "Wer" nur angezeigt
    expect(sektion).not.toMatch(/JSON\.stringify\(\{[^}]*wer/);                      // nie im Request
  });
  test('Kontext wird VOR dem Oeffnen gesammelt; Fehler laesst den Text stehen; Erfolg nennt die Nummer', () => {
    expect(sektion.indexOf('fbZ.kontext = fbKontextSammeln();')).toBeLessThan(sektion.indexOf("fbEl('fb-dialog').hidden = false;"));
    expect(sektion).toContain("d.id !== 'fb-dialog'");
    expect(sektion).toContain('Feedback gerade nicht möglich');
    expect(sektion).toContain("showToast(`${d.nr} gespeichert – danke!`, 'success');");
    const fehlerZweig = sektion.slice(sektion.indexOf('if (!res.ok) {'), sektion.indexOf("fbEl('fb-text').value = '';"));
    expect(fehlerZweig).toContain('return;');
    expect(sektion).toContain('if (fbZ.laeuft) return;');                             // Doppelklick
    expect(sektion).not.toMatch(/oeffneAnsicht\(|location\.|history\./);             // Ansicht dahinter bleibt
  });
});

describe('Block Feedback (reine Logik)', () => {
  test('Grenze wie im Backend', () => { expect(F.FB_TEXT_MAX).toBe(TEXT_MAX); expect(F.fbZaehlerText(12)).toBe('12/2000'); });
  test('Fenster mit festem Namen - nie der Titel aus dem Fenster', () => {
    expect(F.fbDialogName('au-dialog')).toBe('Auftrag erfassen/bearbeiten');
    expect(F.fbDialogName('korb-lager-dialog')).toBe('aus Lager nehmen');
    expect(F.fbDialogName('neues-fenster-x')).toBe('neues-fenster-x');
    expect(F.fbDialogName('')).toBe('');
    // jedes Fenster der Seite hat einen Namen
    const ids = [...html.matchAll(/id="([a-z0-9-]+)" class="edi-dialog/g)].map(m => m[1]).filter(id => !['fb-dialog', 'anmelde-maske'].includes(id));
    expect(ids.length).toBeGreaterThan(15);
    for (const id of ids) expect(F.FB_DIALOG_NAMEN[id]).toBeTruthy();
  });
  test('Objekt nur als Nummer; was der Block liefert, laesst das Backend durch', () => {
    expect(F.fbObjektAus('AU-2026-0037 · Geburtstagsshirts Familie Probe ⓘ Schließen')).toBe('AU-2026-0037');
    expect(F.fbObjektAus('Kunde K-00017 – Erika Mustermann')).toBe('K-00017');
    expect(F.fbObjektAus('L-Shop-Bestellung JFN-2026-0019')).toBe('JFN-2026-0019');
    expect(F.fbObjektAus('Erika Mustermann, Musterweg 3')).toBe('');
    for (const t of ['AU-2026-0037 · Familie', 'Kunde K-00017', 'Aufgabe AG-2026-0012', 'Bestellseite BS-003']) {
      const o = F.fbObjektAus(t);
      expect(pruefeEingabe({ text: 'x', kontext: { objekt: o } }).objekt).toBe(o);
    }
  });
  test('Ansicht lesbar aus der Navigations-Tabelle', () => {
    const B = { auftraege: { label: 'Aufträge', punkte: [{ id: 'liste', label: 'Aufträge' }, { id: 'todos', label: 'Offene To-dos' }] },
      bestellen: { label: 'Bestellen & Produktion', punkte: [{ id: 'lshop-korb', knopf: '#x' }] }, dashboard: { punkte: [{ id: 'start' }] } };
    expect(F.fbAnsichtLesbar(B, 'auftraege', 'liste')).toBe('Aufträge → Aufträge');
    expect(F.fbAnsichtLesbar(B, 'auftraege', 'todos')).toBe('Aufträge → Offene To-dos');
    expect(F.fbAnsichtLesbar(B, 'bestellen', 'lshop-korb', '  L-Shop-Warenkorb (JFN) 4 ')).toBe('Bestellen & Produktion → L-Shop-Warenkorb');
    expect(F.fbAnsichtLesbar(B, 'dashboard', 'start')).toBe('Dashboard');
    expect(F.fbAnsichtLesbar(B, 'gibtsnicht', 'x')).toBe('');
  });
  test('Zeile unter dem Feld: Von, Ansicht, Fenster, Objekt', () => {
    expect(F.fbKontextText({ ansichtLesbar: 'Lager → Bestand', dialog: 'Lager buchen', objekt: 'AU-2026-0041' }, 'nicole'))
      .toBe('Von: nicole · Ansicht: Lager → Bestand · Fenster: Lager buchen · AU-2026-0041');
    expect(F.fbKontextText({ ansichtLesbar: 'Dashboard', dialog: '', objekt: '' }, '')).toBe('Ansicht: Dashboard');
  });
});
