// NB1 Teil A: Nachtrag-Skript fuer Teilerstattungen - Trockenlauf schreibt nichts, Bestellungen ohne Verkaufsstatus
// bleiben dem Ganz-Storno. Nur erfundene Werte, Sheets und Shop als Attrappe.
import { nachtragErstattungen } from '../lib/nachtragErstattungen.js';

const KOPF = ['Partner-ID', 'Datum', 'Order-ID', 'Artikelnummer', 'Variante', 'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr',
  'Status', 'Produkt-ID', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto', 'Storno-Status'];
const TABS = {
  'Partner_Verkäufe': [KOPF,
    ['P-1', '01.10.2026', '500', 'Shirt', '11', '1', '20,00', '4,00', 'offen', '10', '8,00', '2,00', '1,50', '4,76', ''],
    ['P-1', '01.10.2026', '600', 'Cap', '21', '1', '10,00', '2,00', 'offen', '20', '4,00', '1,00', '0,75', '2,38', ''],
  ],
  'Partner': [['Partner-ID', 'Porto-Modell'], ['P-1', 'geteilt-50-50']],
  'Kalkulation_Fixkosten': [['Position', 'Wert']],
};
const sheetsAttrappe = () => {
  const schreibe = [];
  return {
    schreibe,
    spreadsheets: { values: {
      get: async ({ range }) => ({ data: { values: TABS[range.replace(/^'|'$/g, '')] ?? [] } }),
      update: async (x) => { schreibe.push(x); return {}; },
    } },
  };
};
const ORDERS = {
  500: { id: 500, status: 'completed', date_created: '2026-10-01T10:00:00', line_items: [{ id: 1, name: 'Shirt', product_id: 10, variation_id: 11, quantity: 1, total: '20.00' }] },
  600: { id: 600, status: 'refunded',  date_created: '2026-10-01T10:00:00', line_items: [{ id: 2, name: 'Cap', product_id: 20, variation_id: 21, quantity: 1, total: '10.00' }] },
};
const wcAttrappe = () => ({
  get: async (pfad) => {
    const m = /^orders\/(\d+)(\/refunds)?$/.exec(pfad);
    if (!m) throw new Error(`unerwartet: ${pfad}`);
    if (!m[2]) return { data: ORDERS[m[1]] };
    return { data: [{ id: 77, date_created: '2026-10-05T09:00:00', line_items: [{ product_id: 10, variation_id: 11, quantity: -1, total: '-20', meta_data: [{ key: '_refunded_item_id', value: '1' }] }], shipping_lines: [] }] };
  },
});

test('Trockenlauf: rechnet die Gegenbuchung, schreibt nichts; erstattete Bestellung bleibt dem Storno', async () => {
  const sheets = sheetsAttrappe();
  const r = await nachtragErstattungen({
    sheets, spreadsheetId: 'X', shop: 'jfn', nur: new Set(['500', '600']), write: false,
    drossel: async () => {}, wcFuer: () => wcAttrappe(),
  });
  expect(sheets.schreibe).toEqual([]);
  expect(r.zeilen).toBe(1);
  expect(r.bestellungen).toEqual(expect.arrayContaining([
    expect.objectContaining({ bestellung: '600', status: 'refunded', zeilen: 0 }),
    expect.objectContaining({ bestellung: '500', zeilen: 1, marken: ['P-1 Erstattung #77 (Stück -1)'] }),
  ]));
  expect(r.sicherung).toBeUndefined();
});
