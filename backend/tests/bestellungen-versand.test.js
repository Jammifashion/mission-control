// BS2: Versandart an der Bestellkarte (Abholung hervorgehoben) + Filter Status/Versandart. Nur ERFUNDENE Bestellungen.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Produktion-Stand: Anfang'), bis = html.indexOf('// ── Produktion-Stand: Ende');
const F = new Function(`${html.slice(von, bis)}\nreturn { psVersandArt, psVersandHtml, psFiltern, psFacetten, psSuche, psSicht };`)();

const sl = (method_id, instance_id, method_title) => [{ method_id, instance_id: String(instance_id), method_title }];
const o = (id, status, lines, name = 'Artikel') => ({ id, status, shipping_lines: lines, line_items: [{ id: 1, name, sku: `SKU-${id}`, quantity: 1, meta_data: [] }] });
const ORDERS = [
  o(1, 'processing', sl('free_shipping', 1, 'Kostenlose Lieferung'), 'Hoodie'),
  o(2, 'processing', sl('local_pickup', 6, 'Abholung während der Saison im Stadion'), 'Trikot'),
  o(3, 'on-hold', sl('local_pickup', 3, 'Abholung in Wrist'), 'Hoodie'),
  o(4, 'on-hold', sl('flat_rate', 2, 'Versandkostenpauschale')),
  o(5, 'pending', sl('flat_rate', 4, 'Versand Österreich')),
  o(6, 'processing', []),
];

describe('Kennzeichen je Methode', () => {
  const art = (lines, shop = 'jfn') => F.psVersandArt({ shipping_lines: lines }, shop);
  test('Stadion, Wrist (auch alter Titel), Sammelbestellung - ueber method_id + instance_id', () => {
    expect(art(sl('local_pickup', 6, 'irgendein neuer Titel'))).toEqual({ art: 'abholung', icon: '🏟', text: 'Abholung Stadion' });
    expect(art(sl('local_pickup', 3, 'Abholung in Wrist'))).toEqual({ art: 'abholung', icon: '📍', text: 'Abholung Wrist' });
    expect(art(sl('local_pickup', 3, 'Abholung vor Ort'))).toMatchObject({ text: 'Abholung Wrist' });
    expect(art(sl('local_pickup', 5, 'Sammelbestellung'))).toMatchObject({ art: 'abholung', text: 'Abholung Sammelbestellung' });
  });
  test('Titel nur als Rueckfall: unbekannte Instanz mit altem Titel "Abholung vor Ort" -> Wrist; unbekannte Abholung -> Titel', () => {
    expect(art(sl('local_pickup', 9, 'Abholung vor Ort'))).toMatchObject({ art: 'abholung', text: 'Abholung Wrist' });
    expect(art(sl('pickup_location', 0, 'Abholpunkt Halle'))).toEqual({ art: 'abholung', icon: '📍', text: 'Abholpunkt Halle' });
  });
  test('Versand DE/AT dezent; unbekannte Methode zeigt den Titel; ohne Versandzeile', () => {
    expect(art(sl('free_shipping', 1, 'Kostenlose Lieferung'))).toEqual({ art: 'versand', icon: '', text: 'Versand' });
    expect(art(sl('flat_rate', 2, 'Versandkostenpauschale'))).toMatchObject({ text: 'Versand' });
    expect(art(sl('flat_rate', 4, 'Pauschale'))).toMatchObject({ text: 'Versand AT' });
    expect(art(sl('dhl_express', 7, 'Express-Kurier'))).toEqual({ art: 'versand', icon: '', text: 'Express-Kurier', unbekannt: true });
    expect(art([])).toMatchObject({ art: 'ohne', text: 'ohne Versandart' });
  });
  test('HONK: keine JFN-Instanzen (flat_rate/4 ist dort kein AT, local_pickup/6 kein Stadion)', () => {
    expect(art(sl('flat_rate', 4, 'Standardversand'), 'honk')).toMatchObject({ text: 'Versand' });
    expect(art(sl('local_pickup', 6, 'Abholung'), 'honk')).toEqual({ art: 'abholung', icon: '📍', text: 'Abholung' });
  });
  test('HTML: Abholung hervorgehoben mit Mouse-over, Versand dezent, Titel escaped, kein title=', () => {
    expect(F.psVersandHtml({ art: 'abholung', icon: '🏟', text: 'Abholung Stadion' }))
      .toBe('<span class="ps-versand ps-versand-abholung" tabindex="0" data-hilfe="ps-versand-abholung">🏟 Abholung Stadion</span>');
    expect(F.psVersandHtml({ art: 'versand', icon: '', text: '<b>X</b>' }))
      .toBe('<span class="ps-versand ps-versand-versand" tabindex="0" data-hilfe="ps-versand-versand">&#60;b&#62;X&#60;/b&#62;</span>');
    expect(html.slice(von, bis)).not.toMatch(/\stitle=/);
  });
});

describe('Filter und Zaehler', () => {
  const ids = l => l.map(x => x.id);
  test('Status', () => {
    expect(ids(F.psFiltern(ORDERS, { status: 'processing' }))).toEqual([1, 2, 6]);
    expect(ids(F.psFiltern(ORDERS, { status: 'on-hold' }))).toEqual([3, 4]);
    expect(ids(F.psFiltern(ORDERS, { status: 'pending' }))).toEqual([5]);
  });
  test('Versand: Abholung = alle Abholarten; Versand = alles andere, auch ohne Versandart', () => {
    expect(ids(F.psFiltern(ORDERS, { versand: 'abholung' }))).toEqual([2, 3]);
    expect(ids(F.psFiltern(ORDERS, { versand: 'versand' }))).toEqual([1, 4, 5, 6]);
  });
  test('kombiniert: Status + Versand', () => {
    expect(ids(F.psFiltern(ORDERS, { status: 'on-hold', versand: 'abholung' }))).toEqual([3]);
  });
  test('Zaehler: Status unter dem Versandfilter, Versand unter dem Statusfilter', () => {
    expect(F.psFacetten(ORDERS, {})).toEqual({
      status: { alle: 6, processing: 3, 'on-hold': 2, pending: 1 }, versand: { alle: 6, abholung: 2, versand: 4 } });
    expect(F.psFacetten(ORDERS, { status: 'processing', versand: 'abholung' })).toEqual({
      status: { alle: 2, processing: 1, 'on-hold': 1, pending: 0 }, versand: { alle: 3, abholung: 1, versand: 2 } });
  });
  test('kombinierbar mit BS1-Suche und "wartet auf Teile" (Reihenfolge des Backends)', () => {
    const gefiltert = F.psFiltern(ORDERS, { versand: 'abholung' });
    const s = F.psSuche(gefiltert, 'hoodie');
    expect(ids(s.orders)).toEqual([3]);
    const wartet = F.psSicht(ORDERS, { wartetAufTeile: [3, 1, 2] }, 'wartet');
    expect(ids(F.psFiltern(wartet, { status: 'processing' }))).toEqual([1, 2]);
  });
});

describe('Einbindung', () => {
  test('Kennzeichen an jeder Karte (je Shop), Filter-Knoepfe mit Mouse-over, Wahl nur als Schalterwert gespeichert', () => {
    expect(html).toContain('${psVersandHtml(psVersandArt(o, currentShop()))}');
    for (const k of ['alle', 'processing', 'on-hold', 'pending']) expect(html).toContain(`data-pstatus="${k}" data-hilfe="ps-status-${k}"`);
    expect(html).toContain('data-pversand="abholung" data-hilfe="ps-versand-filter-abholung"');
    expect(html).toContain("const PS_STATUS_KEY = 'mc_bestellungen_status', PS_VERSAND_KEY = 'mc_bestellungen_versand';");
    expect(html).toContain('localStorage.setItem(PS_STATUS_KEY, f)');
    expect(html).toContain('localStorage.setItem(PS_VERSAND_KEY, f)');
    expect(html).toContain("if (k === 'pending') btn.hidden = !fac.status.pending && psZustand.status !== 'pending';");
  });
});
