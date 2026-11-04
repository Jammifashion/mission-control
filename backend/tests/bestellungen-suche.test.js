// BS1: Suche in offenen Bestellungen (Block "Produktion-Stand" in frontend/index.html). Nur ERFUNDENE Bestellungen.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Produktion-Stand: Anfang');
const bis = html.indexOf('// ── Produktion-Stand: Ende');
const F = new Function(`${html.slice(von, bis)}\nreturn { psSuche, psSucheKopf, psNorm, psPosition, psSicht };`)();

const li = (id, name, sku, extra = {}) => ({ id, name, sku, quantity: 1, meta_data: [], ...extra });
const groesse = g => ({ key: 'pa_groesse', display_key: 'Größe', display_value: g });
const orders = [
  { id: 101, number: '101', status: 'processing', line_items: [li(1, 'Tobi Torpedo Fluffy Hoodie - L', 'TT-HOOD/L', { parent_name: 'Tobi Torpedo Fluffy Hoodie', quantity: 2, meta_data: [groesse('L')] })] },
  { id: 102, number: '102', status: 'on-hold', line_items: [li(2, 'Tasse Erfunden', 'TASSE-1'), li(3, 'Tobi Torpedo Shirt - M', 'TT-SHIRT/M', { parent_name: 'Tobi Torpedo Shirt', meta_data: [groesse('M')] })] },
  { id: 103, number: '103', status: 'processing', line_items: [li(4, 'Müller Mütze', 'MM-1')] },
  // Trikot: der Variantenname traegt den Rueckennamen - gesucht wird nur im Elternnamen, nie im Feld "Name"
  { id: 104, number: '104', status: 'processing', line_items: [li(5, 'Heimtrikot - ERIKA - 7', 'TRIKOT-H', { parent_name: 'Heimtrikot', meta_data: [{ key: 'name-nummer', display_key: 'Name - Nummer', display_value: 'ERIKA - 7' }, groesse('XL')] })] },
];

describe('BS1: Suche', () => {
  test('unter 2 Zeichen = inaktiv, alles wie vorher', () => {
    for (const q of ['', ' ', 'a']) {
      const s = F.psSuche(orders, q);
      expect(s.aktiv).toBe(false);
      expect(s.orders).toBe(orders);
    }
  });
  test('Treffer ueber Artikelname, SKU, Bestell-Nr.; Gross/Klein egal', () => {
    expect(F.psSuche(orders, 'TOBI').orders.map(o => o.id)).toEqual([101, 102]);
    expect(F.psSuche(orders, 'tasse-1').orders.map(o => o.id)).toEqual([102]);
    expect(F.psSuche(orders, '103').orders.map(o => o.id)).toEqual([103]);
  });
  test('mehrere Woerter: alle in einer Position (oder Bestell-Nr.)', () => {
    expect(F.psSuche(orders, 'tobi hoodie').orders.map(o => o.id)).toEqual([101]);
    expect(F.psSuche(orders, 'tasse hoodie').orders).toEqual([]);   // verteilt auf verschiedene Bestellungen/Positionen
    expect(F.psSuche(orders, '102 shirt').orders.map(o => o.id)).toEqual([102]);
    expect(F.psSuche(orders, 'tobi m').orders.map(o => o.id)).toEqual([102]);   // Groesse M nur im Shirt
  });
  test('Umlaute tolerant (ä = ae), auch umgekehrt', () => {
    expect(F.psSuche(orders, 'mueller').orders.map(o => o.id)).toEqual([103]);
    expect(F.psSuche(orders, 'MÜTZE').orders.map(o => o.id)).toEqual([103]);
    expect(F.psNorm('Größe Ärmel')).toBe('groesse aermel');
  });
  test('Rueckenname/Nummer werden nie durchsucht, Groesse schon', () => {
    expect(F.psSuche(orders, 'erika').orders).toEqual([]);
    expect(F.psSuche(orders, 'heimtrikot xl').orders.map(o => o.id)).toEqual([104]);
    expect(F.psPosition(orders[3].line_items[0])).toMatchObject({ name: 'Heimtrikot', merkmal: 'XL' });
  });
  test('Treffer je Bestellung: passende Positionen (Menge, Name, Groesse) fuer die Hervorhebung', () => {
    const s = F.psSuche(orders, 'tobi');
    expect(s.treffer.get('101')).toEqual([{ menge: 2, name: 'Tobi Torpedo Fluffy Hoodie', merkmal: 'L', text: expect.any(String) }]);
    expect(s.treffer.get('102').map(p => p.name)).toEqual(['Tobi Torpedo Shirt']);
    expect(F.psSucheKopf(2, 4, 'tobi')).toBe('2 von 4 offenen Bestellungen enthalten „tobi“');
    expect(F.psSucheKopf(0, 4, 'xyz')).toBe('Keine offene Bestellung enthält „xyz“');
  });
  test('wirkt zusaetzlich zu "wartet auf Teile" (Suche laeuft auf der Sicht des Filters)', () => {
    const sicht = F.psSicht(orders, { wartetAufTeile: [102, 103] }, 'wartet');
    expect(F.psSuche(sicht, 'tobi').orders.map(o => o.id)).toEqual([102]);
  });
  test('Verdrahtung: nur offene Status, Seitenschleife mit Obergrenze + Hinweis, nichts gespeichert', () => {
    expect(html).toContain("/api/woocommerce/orders?per_page=100&page=${page}&status=pending,processing,on-hold");
    expect(html).toMatch(/for \(let page = 1; page <= PS_MAX_SEITEN; page\+\+\)/);
    expect(html).toContain('if (page === PS_MAX_SEITEN) psZustand.grenze = true;');
    expect(html).toContain('data-hilfe="ps-grenze"');
    const teil = html.slice(html.indexOf('// BS1: Suche (kurz verzoegert'), html.indexOf("document.getElementById('ps-filter')?.addEventListener"));
    expect(teil).not.toMatch(/localStorage|sessionStorage|location\.hash|history\.|apiFetch|console\./);
    // Feld ohne eigenen Hilfetext (Mouse-over am Label daneben), kein title
    expect(html).toMatch(/<label for="ps-suche" class="ps-suche-label" data-hilfe="ps-suche" tabindex="0">Suche<\/label>\s*<input id="ps-suche"(?![^>]*data-hilfe)(?![^>]*title=)[^>]*>/);
  });
});
