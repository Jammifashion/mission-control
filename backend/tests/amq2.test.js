// AMQ2: "Preise eingeben" beim neuen Auftrag - Kundenart Person -> brutto, sonst netto; Handumschaltung bleibt. Erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const stueck = html.slice(html.indexOf('const auEingabeVorschlag'), html.indexOf('      function auKundeSetzen(k) {'));

/** Logik mit nachgebildetem Umschalter ausfuehren. */
function umgebung({ modus = 'neu', bruttoGesperrt = false, eingabe = 'netto' } = {}) {
  const sel = { value: eingabe, querySelector: () => ({ disabled: bruttoGesperrt }) };
  const auDlg = { modus, eingabe, eingabeHand: false, entwurf: [{ preis: 25.1261, preisText: '29,90' }] };
  let gezeichnet = 0;
  const f = new Function('auDlg', 'auEl', 'auEntwurfZeichnen', 'auPreisSummeZeichnen', `${stueck}\nreturn { auEingabeVorschlag, auEingabeVorbelegen };`)(
    auDlg, () => sel, () => { gezeichnet++; }, () => {});
  return { ...f, auDlg, sel, gezeichnet: () => gezeichnet };
}

describe('AMQ2 Vorbelegung Preis-Eingabe', () => {
  test('Person -> brutto, Firma/Verein -> netto, ohne Kunde -> netto', () => {
    const { auEingabeVorschlag } = umgebung();
    expect(auEingabeVorschlag({ Art: 'Person' })).toBe('brutto');
    expect(auEingabeVorschlag({ Art: 'Firma' })).toBe('netto');
    expect(auEingabeVorschlag({ Art: 'Verein' })).toBe('netto');
    expect(auEingabeVorschlag(null)).toBe('netto');
  });
  test('neuer Auftrag: Kunde gewaehlt -> Umschalter folgt; Kundenwechsel setzt neu; Preise neu angezeigt', () => {
    const u = umgebung();
    u.auEingabeVorbelegen({ Art: 'Person' });
    expect([u.auDlg.eingabe, u.sel.value]).toEqual(['brutto', 'brutto']);
    expect(u.auDlg.entwurf[0].preisText).toBeUndefined();   // Anzeige neu aus dem gespeicherten Netto-Wert
    expect(u.auDlg.entwurf[0].preis).toBe(25.1261);          // Wert bleibt
    u.auEingabeVorbelegen({ Art: 'Verein' });
    expect(u.sel.value).toBe('netto');
    u.auEingabeVorbelegen(null);
    expect(u.sel.value).toBe('netto');
  });
  test('Handumschaltung wird beim Kundenwechsel nicht ueberschrieben', () => {
    const u = umgebung();
    u.auEingabeVorbelegen({ Art: 'Person' });
    u.auDlg.eingabeHand = true; u.auDlg.eingabe = 'netto'; u.sel.value = 'netto';   // Inhaber stellt von Hand um
    u.auEingabeVorbelegen({ Art: 'Person' });
    expect(u.sel.value).toBe('netto');
  });
  test('bestehender Auftrag (bearbeiten) unveraendert; ohne Spalte nur netto', () => {
    const b = umgebung({ modus: 'bearbeiten', eingabe: 'netto' });
    b.auEingabeVorbelegen({ Art: 'Person' });
    expect([b.auDlg.eingabe, b.gezeichnet()]).toEqual(['netto', 0]);
    const o = umgebung({ bruttoGesperrt: true });
    o.auEingabeVorbelegen({ Art: 'Person' });
    expect(o.sel.value).toBe('netto');
  });
  test('Einbindung: bei Kundenwahl, Hand-Merker beim Oeffnen zurueck, beim Umschalten gesetzt', () => {
    expect(html).toContain('        auEingabeVorbelegen(k);   // AMQ2');
    expect(html).toContain('auDlg.eingabeHand = false;   // AMQ2');
    expect(html).toContain('auDlg.eingabeHand = true;   // AMQ2');
  });
});
