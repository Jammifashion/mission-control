// DT1: DTF-Korb in index.html - Spiegel der Meter-Schaetzung, Scan-Adresse, Oberflaechen-Regeln.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { meterSchaetzung } from '../utils/dtf-korb.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── DTF-Meter: Anfang'), html.indexOf('// ── DTF-Meter: Ende'));
const { dtfMeter } = new Function(`${block}\nreturn { dtfMeter };`)();
const sektion = html.slice(html.indexOf('// ── SECTION: DTF-Korb (DT1) ──'), html.indexOf('// ── SECTION: DTF-Korb Ende ──'));

describe('Meter-Schaetzung: Spiegel des Backends', () => {
  const faelle = [
    [[{ breite: 10, hoehe: 10, menge: 57 }], { breiteCm: 57, verschnitt: 15 }],
    [[{ breite: 22, hoehe: 11, menge: 3 }, { breite: 9, hoehe: 10.5, menge: 14 }], { breiteCm: 57, verschnitt: 15, tarif: { qmBruttoCent: 2100 }, mindestCm: 200 }],
    [[{ breite: 28, hoehe: null, menge: 2 }], { breiteCm: 57, verschnitt: 0 }],
    [[{ breite: 10, hoehe: 10, menge: 57 }], { breiteCm: 57, verschnitt: 0, mindestCm: 100 }],
    [[], {}],
  ];
  test.each(faelle)('%j', (posten, o) => {
    expect(dtfMeter(posten, o)).toEqual(meterSchaetzung(posten, o));
  });
});

describe('Oberflaeche', () => {
  test('Scan-Adresse #dtf/scan/<id> fuehrt in den DTF-Korb, nur gueltige IDs', () => {
    expect(html).toContain("if (b === 'dtf' && p === 'scan' && /^DTF-\\d{4}-\\d{4}(-\\d{2,3})?$/.test(x)) { window.mcDtfScan = x; return findeAnsicht('bestellen', 'dtf'); }");
    expect(sektion).toContain('dtfScanZeigen');
  });
  test('kein title, keine Inline-Handler, keine festen Farben im Abschnitt', () => {
    expect(sektion).not.toMatch(/\btitle=/);
    expect(sektion).not.toMatch(/\son[a-z]+=/);
    expect(sektion).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
  test('Bilder nur ueber das Backend (Blob mit Schluessel), Absenden nur nach Rueckfrage', () => {
    expect(sektion).toContain('/api/dtf/datei/${encodeURIComponent(id)}/vorschau');
    expect(sektion).toMatch(/showConfirm\('An Nico absenden\?'/);
    expect(sektion).not.toMatch(/localStorage/);
  });
  test('Express wird nie mit normalen Zeilen zusammen bestellt', () => {
    expect(sektion).toContain("showToast('Express- und normale Zeilen bitte getrennt bestellen.'");
  });
});
