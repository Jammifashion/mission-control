// BO4a: EDI-Entwurf im Frontend (index.html). Block "EDI-Pruefung" mit einem Parser-Double,
// dazu die Einbindung: Knopf in der Aktionsleiste, "alle offenen wählen", Dialog, nur die zwei
// Routen vorschau/erzeugen, kein Versand, kein Speichern im Browser.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (von, bis) => {
  const a = html.indexOf(von), b = html.indexOf(bis, a);
  if (a < 0 || b < a) throw new Error(`Block ${von} fehlt`);
  return html.slice(a, b);
};
const { ediXmlImBrowserOk, ediErzeugenFrei } = new Function(
  `${block('// ── EDI-Pruefung: Anfang', '// ── EDI-Pruefung: Ende ──')}\nreturn { ediXmlImBrowserOk, ediErzeugenFrei };`)();

// Parser-Double wie DOMParser: liefert parsererror, Wurzelname und Anzahl <item>.
const parser = ({ fehler = false, wurzel = 'order', items = 1 } = {}) => class {
  parseFromString() {
    return {
      documentElement: { nodeName: wurzel },
      getElementsByTagName: tag => ({ length: tag === 'parsererror' ? (fehler ? 1 : 0) : tag === 'item' ? items : 0 }),
    };
  }
};
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<order></order>\n';

describe('ediXmlImBrowserOk / ediErzeugenFrei', () => {
  test('gueltig', () => {
    expect(ediXmlImBrowserOk(XML, parser())).toEqual({ ok: true, grund: '' });
  });
  test.each([
    ['ohne Deklaration', '<order></order>', parser()],
    ['Adressblock', XML.replace('</order>', '<shippingaddress/></order>'), parser()],
    ['Parser-Fehler', XML, parser({ fehler: true })],
    ['falsche Wurzel', XML, parser({ wurzel: 'html' })],
    ['keine Position', XML, parser({ items: 0 })],
    ['kein Text', null, parser()],
  ])('%s -> nicht ok', (_n, xml, P) => {
    expect(ediXmlImBrowserOk(xml, P).ok).toBe(false);
  });
  test('Knopf nur frei bei gruen + XML + Browser-Pruefung ok', () => {
    expect(ediErzeugenFrei({ gruen: true, xml: XML }, { ok: true })).toBe(true);
    expect(ediErzeugenFrei({ gruen: false, xml: XML }, { ok: true })).toBe(false);
    expect(ediErzeugenFrei({ gruen: true, xml: null }, { ok: true })).toBe(false);
    expect(ediErzeugenFrei({ gruen: true, xml: XML }, { ok: false })).toBe(false);
    expect(ediErzeugenFrei(null, null)).toBe(false);
  });
});

describe('Einbindung', () => {
  const edi = block('// ── EDI-Entwurf (BO4a) ──', '// ── SECTION: L-Shop-Bestellübersicht ──');

  test('Knopf in der Aktionsleiste, "alle offenen wählen" im Korb, Dialog zu Beginn verborgen', () => {
    const leiste = block('<div id="korb-leiste"', '</div>');
    expect(leiste).toContain('id="korb-edi-btn"');
    expect(html).toMatch(/id="korb-alle-btn"[^>]*>alle offenen wählen</);
    expect(html).toMatch(/<div id="edi-dialog"[^>]*hidden>/);
    expect(html).toMatch(/id="edi-erzeugen" disabled>/);
  });

  test('nur die Routen vorschau/erzeugen, kein Versand, kein Speichern im Browser', () => {
    expect(edi).toContain('/api/bestellen/lshop-korb/edi/${pfad}');
    expect([...edi.matchAll(/ediAnfrage\('(\w+)'\)/g)].map(m => m[1]).sort()).toEqual(['erzeugen', 'vorschau']);
    expect(edi).not.toMatch(/ftp|localStorage|sessionStorage/i);
  });

  test('vor dem Download prueft der Browser mit DOMParser', () => {
    const klick = edi.slice(edi.indexOf('async function ediErzeugenKlick'), edi.indexOf('function ediOeffnen'));
    expect(klick.indexOf('ediXmlImBrowserOk(r.xml, DOMParser)')).toBeGreaterThan(-1);
    expect(klick.indexOf('ediXmlImBrowserOk(r.xml, DOMParser)')).toBeLessThan(klick.indexOf('ediHerunterladen(r.xml'));
    // nach dem Erzeugen gesperrt: ein zweiter Klick vergibt keine weitere Nummer
    expect(klick).toMatch(/ediHerunterladen\(r\.xml, r\.dateiname\);[\s\S]*gruen: false/);
  });
});
