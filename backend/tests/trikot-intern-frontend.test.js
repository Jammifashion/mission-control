// TR6: Oberflaeche der internen Trikotbestellung (frontend/index.html). Nur ERFUNDENE Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Trikots: Anfang'), bis = html.indexOf('// ── Trikots: Ende');
const T = new Function(`${html.slice(von, bis)}\nreturn { trZeileHtml, trGruppeHtml, trInternHtml, trStatusHtml };`)();
const ui = html.slice(html.indexOf('// ── TR6: interne Trikotbestellung (INT-…) ──'), html.indexOf('// ── SECTION: Lager (BO5-1) ──'));
const zeile = (o = {}) => ({ zeile: 9, id: 'INT-2026-0003', orderId: '', produktKurz: 'Heim', groesse: 'M', name: 'MUSTER', nummer: '7', hinweise: [], ersetztDurch: [], ersatzFuer: null,
  kundenangabe: [], status: '', charge: '', referenz: '', intern: true, bearbeitbar: true, storniert: false, ...o });

describe('TR6 Oberflaeche', () => {
  test('Knopf, Dialog und Schreibwege; Referenz und Namen nie in Adresse/Speicher', () => {
    expect(html).toContain('id="ti-neu" data-hilfe="ti-neu">+ Interne Trikotbestellung</button>');
    expect(html).toContain('<div id="ti-dialog" class="edi-dialog"');
    expect(html).toContain('id="ti-plus" data-hilfe="ti-plus">+ weiteres Trikot</button>');
    expect(ui).toContain("`${API_BASE()}/api/bestellen/trikots/intern${a ? '/aendern' : ''}`");
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
    expect(T.trZeileHtml(zeile({ bearbeitbar: false, charge: '4' }))).not.toContain('data-ti-');
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
});
