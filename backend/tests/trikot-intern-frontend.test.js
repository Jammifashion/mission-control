// TR6: Oberflaeche der internen Trikotbestellung (frontend/index.html). Nur ERFUNDENE Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Trikots: Anfang'), bis = html.indexOf('// ── Trikots: Ende');
const T = new Function(`${html.slice(von, bis)}\nreturn { trZeileHtml, trGruppeHtml, trInternHtml, trStatusHtml };`)();
const ui = html.slice(html.indexOf('// ── TR6: interne Trikotbestellung (INT-…) ──'), html.indexOf('// ── SECTION: Lager (BO5-1) ──'));
const zeile = (o = {}) => ({ zeile: 9, id: 'INT-2026-0003', orderId: '', produktKurz: 'Heim', groesse: 'M', name: 'MUSTER', nummer: '7', hinweise: [], ersetztDurch: [], ersatzFuer: null,
  kundenangabe: [], status: '', charge: '', referenz: '', intern: true, bearbeitbar: true, aenderbar: true, storniert: false, ...o });

describe('TR6 Oberflaeche', () => {
  test('Knopf, Dialog und Schreibwege; Referenz und Namen nie in Adresse/Speicher', () => {
    expect(html).toContain('id="ti-neu" data-hilfe="ti-neu">+ Interne Trikotbestellung</button>');
    expect(html).toContain('<div id="ti-dialog" class="edi-dialog"');
    expect(html).toContain('id="ti-plus" data-hilfe="ti-plus">+ weiteres Trikot</button>');
    expect(ui).toContain("`${API_BASE()}/api/bestellen/${a ? 'trikots/aendern' : 'trikots/intern'}`");   // TR7: aendern = jede Zeile ohne Charge
    expect(ui).toContain('vorher: tiZ.vorher');
    expect(ui).toContain('/api/bestellen/trikots/intern/entfernen');
    expect(ui).not.toMatch(/localStorage|sessionStorage|location\.hash|history\./);
    expect(ui).not.toMatch(/console\./);
  });
  test('Zeile: Referenz AU-… als Link, ändern/entfernen nur wenn bearbeitbar', () => {
    const h = T.trZeileHtml(zeile({ referenz: 'AU-2026-0003' }));
    expect(h).toContain('data-tr-au="AU-2026-0003" data-hilfe="ti-auftrag">Auftrag AU-2026-0003</button>');
    expect(h).toContain('data-ti-aendern="9"');
    expect(h).toContain('data-ti-weg="9"');
    expect(T.trInternHtml(zeile({ referenz: 'Vereinsfeier' }))).toContain('Referenz: Vereinsfeier');
    expect(T.trZeileHtml(zeile({ bearbeitbar: false, aenderbar: false, aendernGesperrt: true, charge: '4' }))).not.toContain('data-ti-');
  });
  test('Gruppe "entfernt": eingeklappt, Status entfernt, keine Knoepfe', () => {
    const g = T.trGruppeHtml({ storniert: true, anzahl: 1, zeilen: [zeile({ storniert: true, bearbeitbar: false, status: 'storniert' })] });
    expect(g).toMatch(/^<details class="tr-gruppe tr-gruppe-entfernt" data-charge=""><summary>/);
    expect(g).not.toMatch(/<details[^>]*\sopen/);
    expect(g).toContain('data-hilfe="ti-entfernt">entfernt</span>');
    expect(g).not.toContain('data-ti-weg');
  });
  test('Auftrag: Hinweis "n Trikots (Trikot-Seite)" nur lesend', () => {
    expect(html).toContain('<div id="au-d-trikots"></div>');
    expect(html).toContain('${n} Trikot${n === 1 ? \'\' : \'s\'} (Trikot-Seite)');
    const f = new Function(`${ui.slice(ui.indexOf('const trZaehleReferenz'), ui.indexOf('\n', ui.indexOf('const trZaehleReferenz')))}\nreturn trZaehleReferenz;`)();
    const daten = { gruppen: [{ zeilen: [{ referenz: 'AU-2026-0003' }, { referenz: 'AU-2026-0004' }] }, { charge: '2', zeilen: [{ referenz: 'AU-2026-0003' }] }, { storniert: true, zeilen: [{ referenz: 'AU-2026-0003' }] }] };
    expect(f(daten, 'AU-2026-0003')).toBe(2);
  });

  test('TR7: Shop-Zeile ohne Charge -> "ändern …" ohne "entfernen"; mit Charge gesperrt mit Mouse-over; GK-Kennzeichen', () => {
    const shop = zeile({ id: '50001|1|1', orderId: '50001', intern: false, bearbeitbar: false, aenderbar: true, goalie: true });
    const h = T.trZeileHtml(shop);
    expect(h).toContain('data-ti-aendern="9"');
    expect(h).not.toContain('data-ti-weg');
    expect(h).toContain('<span class="tr-gk" tabindex="0" data-hilfe="tr-goalie">GK</span>');   // TR10: Fokus fuer den Mouse-over
    const g = T.trZeileHtml({ ...shop, aenderbar: false, aendernGesperrt: true, charge: '4' });
    expect(g).toContain('aria-disabled="true" data-hilfe="tr-aendern-gesperrt">ändern …</button>');
    expect(g).not.toContain('data-ti-aendern');
    expect(html).toContain("'tr-aendern-gesperrt':  { name: 'ändern …', text: 'Schon beim Hersteller – Änderung nur über Ersatz (TR3b).' }");
  });
  test('TR7: Dialog hat den GK-Schalter je Trikot, Shop-Zeile mit festem Trikot', () => {
    expect(ui).toContain('data-ti-feld="goalie"');
    expect(ui).toContain('data-hilfe="ti-goalie"');
    expect(ui).toContain("f.type === 'checkbox' ? f.checked : f.value");
    expect(ui).toContain('<span class="ti-fest">');
  });
});
