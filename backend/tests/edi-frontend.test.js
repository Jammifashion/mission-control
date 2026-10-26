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
const { ediXmlImBrowserOk, ediErzeugenFrei, ediPunkteSichtbar, ediKnoepfe, ediNachErzeugen } = new Function(
  `${block('// ── EDI-Pruefung: Anfang', '// ── EDI-Pruefung: Ende ──')}\nreturn { ediXmlImBrowserOk, ediErzeugenFrei, ediPunkteSichtbar, ediKnoepfe, ediNachErzeugen };`)();

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
    // BO4f: gesperrt ueber aria-disabled (Erklaerung beim Darueberfahren), zu Beginn gesperrt
    expect(html).toMatch(/id="edi-senden" data-hilfe="edi-senden" aria-disabled="true">An L-Shop senden …</);
    expect(html).toMatch(/id="edi-erzeugen" data-hilfe="edi-entwurf" aria-disabled="true">Nur Entwurf \+ herunterladen</);
    expect(html).toMatch(/id="korb-edi-btn"[^>]*>L-Shop-Bestellung …</);
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
    expect(klick).toMatch(/gruen: false[\s\S]*ediHerunterladen\(r\.xml, r\.dateiname\);/);
  });
});

// ── BO4f: Senden direkt aus dem Dialog ──────────────────────────────────────
describe('BO4f: Knoepfe im Dialog "L-Shop-Bestellung"', () => {
  const edi = block('// ── EDI-Entwurf (BO4a) ──', '// ── SECTION: L-Shop-Bestellübersicht ──');
  const klick = edi.slice(edi.indexOf('async function ediErzeugenKlick'), edi.indexOf('function ediOeffnen'));
  const gruen = { gruen: true, xml: XML };

  test('beide Knoepfe nur bei gruenem Pruefbericht, gueltigem XML und ohne laufenden Aufruf; gesperrt mit Grund', () => {
    expect(ediKnoepfe(gruen, { ok: true }, false)).toEqual({ frei: true, hilfeSenden: 'edi-senden', hilfeEntwurf: 'edi-entwurf' });
    for (const [v, x, l] of [[{ ...gruen, gruen: false }, { ok: true }, false], [gruen, { ok: false }, false], [gruen, { ok: true }, true], [null, null, false]]) {
      expect(ediKnoepfe(v, x, l)).toEqual({ frei: false, hilfeSenden: 'edi-gesperrt', hilfeEntwurf: 'edi-gesperrt' });
    }
  });

  test('"An L-Shop senden …" sendet nie selbst: Entwurf anlegen, Dialog zu, Bestaetigungsdialog (BO4c) oeffnen, kein Download', () => {
    expect(ediNachErzeugen('senden', { orderId: 'JFN-2026-0009' })).toEqual({ download: false, schliessen: true, sendenFuer: 'JFN-2026-0009', hinweis: '' });
    // Der Klick ruft nur "erzeugen"; "…/edi/senden" kommt ausschliesslich aus dem Bestaetigungsdialog (sendenLos).
    expect(klick).toContain("ediAnfrage('erzeugen')");
    expect(klick).not.toMatch(/edi\/senden|sendenLos/);
    expect(klick).toMatch(/if \(nach\.sendenFuer\) sendenOeffnen\(nach\.sendenFuer\)/);
    const losAn = html.indexOf("getElementById('senden-los')?.addEventListener('click', sendenLos)");
    expect(losAn).toBeGreaterThan(0);
    expect([...html.matchAll(/\/api\/bestellen\/lshop-korb\/edi\/senden`/g)]).toHaveLength(1);   // nur in sendenLos
  });

  test('"Nur Entwurf + herunterladen": Download und Hinweis mit Link auf "Entwürfe"', () => {
    expect(ediNachErzeugen('entwurf', { orderId: 'JFN-2026-0009' })).toEqual({
      download: true, schliessen: false, sendenFuer: null, hinweis: 'Entwurf JFN-2026-0009 liegt in L-Shop-Bestellungen → Entwürfe, dort senden.',
    });
    expect(klick).toContain('data-edi-zu-entwuerfen="1"');
    expect(edi).toMatch(/data-edi-zu-entwuerfen[\s\S]*oeffneAnsicht\('bestellen', 'lshop-bestellungen'\)/);
  });

  test('Doppelklick: zweiter Klick waehrend des Laufs oder danach erzeugt nichts (laeuft + verbrauchter Bericht)', () => {
    expect(klick).toMatch(/^async function ediErzeugenKlick\(modus = 'entwurf'\) \{\s*if \(ediZustand\.laeuft \|\| !ediKnoepfe\(/);
    expect(klick.indexOf('ediZustand.laeuft = true')).toBeLessThan(klick.indexOf("ediAnfrage('erzeugen')"));
    expect(klick.indexOf('gruen: false };')).toBeLessThan(klick.indexOf('sendenOeffnen('));
    // gesperrte Knoepfe (aria-disabled) bleiben klickbar fuer den Browser - der Klick prueft selbst
    expect(edi).toContain("addEventListener('click', () => ediErzeugenKlick('senden'))");
  });

  test('Sperre nach Aenderung von Commission oder Versandart (wie bisher)', () => {
    expect(edi).toMatch(/'edi-commission'\)\?\.addEventListener\('input'[\s\S]*?gruen: false/);
    expect(edi).toMatch(/'edi-versandart'\)\?\.addEventListener\('change'[\s\S]*?gruen: false/);
  });

  test('Express-Zeilen nur bei Versandart EX…; Bestellschluss bleibt; beide Dialoge filtern', () => {
    const punkte = ['customer_id', 'express_spaet', 'express', 'express_senden', 'bestellschluss'].map(regel => ({ regel, ok: true }));
    expect(ediPunkteSichtbar(punkte, 'DHL').map(p => p.regel)).toEqual(['customer_id', 'bestellschluss']);
    expect(ediPunkteSichtbar(punkte, 'Standard').map(p => p.regel)).toEqual(['customer_id', 'bestellschluss']);
    expect(ediPunkteSichtbar(punkte, 'EX007').map(p => p.regel)).toEqual(punkte.map(p => p.regel));
    expect(edi).toContain('ediPruefungZeichnen(ediPunkteSichtbar(punkte, v.versandart))');
    expect(html).toContain("ediPruefungZeichnenIn('senden-pruefung', ediPunkteSichtbar(v.punkte, v.versandart))");
  });

  test('Dialog-Kopf neu, alter Satz "nur heruntergeladen" weg', () => {
    expect(html).toContain('<strong id="edi-titel">L-Shop-Bestellung</strong>');
    expect(html).toContain('Erst prüfen. Dann <strong>an L-Shop senden</strong> (mit Rückfrage) oder nur einen Entwurf speichern.');
    expect(html).not.toContain('Die Datei wird nur heruntergeladen');
  });
});
