import {
  parseArtikel, matchItem, extractFields, extractVarianteNameNummer, bestimmeQuelle, buildRohtext,
  buildRowsForOrder, resolveTrikotColumns, toSheetRow, existingIds,
  juengstesBestelldatum, SCRIPT_COLUMNS, MANUAL_COLUMNS,
} from '../utils/trikot-logic.js';
import { MissingHeaderError } from '../utils/sheet-headers.js';

const ART_VALUES = [
  ['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'],
  ['', 19365, '', true],
  ['', 20064, '', 'WAHR'],
  ['TRK-AUS', 11111, '', false],
  ['TRK-SKU', '', '', 'TRUE'],
];

const TRIKOT_HEADER = [...SCRIPT_COLUMNS, ...MANUAL_COLUMNS];

// Struktur wie in echten Bestellungen (Stand 09/2026), Werte anonymisiert.
const ORDER = {
  id: 20626,
  date_created: '2026-09-09T12:33:43',
  customer_note: 'Bitte bis Freitag',
  billing: { first_name: 'Max', last_name: 'Muster', company: '' },
  line_items: [
    {
      id: 900, product_id: 19365, variation_id: 20207, sku: 'HEIMTrikot-1', quantity: 2,
      name: 'Heimtrikot 26/27',
      meta_data: [
        { key: 'pa_name-nummer', display_key: 'Name - Nummer', value: 'wunschname-wunschnummer', display_value: 'WUNSCHNAME - WUNSCHNUMMER' },
        { key: 'pa_groesse', display_key: 'Größe', value: '3xl', display_value: '3XL' },
        { key: 'Wunschname', display_key: 'Wunschname', value: 'Muster', display_value: 'Muster' },
        { key: 'Wunschnummer', display_key: 'Wunschnummer', value: '57', display_value: '57' },
        { key: '_deliverytime', display_key: '_deliverytime', value: '666', display_value: '666' },
      ],
    },
    {
      id: 901, product_id: 19365, variation_id: 20271, sku: 'HEIMTrikot-1', quantity: 3,
      name: 'Heimtrikot 26/27',
      meta_data: [
        { key: 'pa_name-nummer', display_key: 'Name - Nummer', value: 'spieler-11', display_value: 'SPIELER - 11' },
        { key: 'pa_groesse', display_key: 'Größe', value: 'xl', display_value: 'XL' },
      ],
    },
    { id: 902, product_id: 555, variation_id: 0, sku: 'ANDERES', quantity: 1, name: 'Tasse', meta_data: [] },
    { id: 903, product_id: 777, variation_id: 0, sku: 'TRK-SKU', quantity: 1, name: 'Blanko', meta_data: [] },
  ],
};

describe('parseArtikel / matchItem', () => {
  const art = parseArtikel(ART_VALUES);

  test('nur aktive Produkt-IDs, auch WAHR aus deutschem Sheet', () => {
    expect([...art.productIds.keys()]).toEqual([19365, 20064]);
  });

  test('SKU-Match nur bei gepflegter Artikelnummer', () => {
    expect([...art.skus.keys()]).toEqual(['TRK-SKU']);
    expect(matchItem({ product_id: 1, sku: 'TRK-SKU' }, art)).toBe('TRK-SKU');
    expect(matchItem({ product_id: 1, sku: 'TRK-AUS' }, art)).toBeNull();
    expect(matchItem({ product_id: 19365, sku: 'x' }, art)).toBe('');
  });

  test('fehlende Spalte wirft', () => {
    expect(() => parseArtikel([['Artikelnummer', 'Produkt-ID']])).toThrow(MissingHeaderError);
  });
});

describe('extractFields / Quelle', () => {
  test('Synonyme case-insensitiv, display_value bevorzugt', () => {
    const f = extractFields(ORDER.line_items[0].meta_data);
    expect(f).toEqual({ name: 'Muster', nummer: '57', groesse: '3XL', farbe: '' });
    expect(bestimmeQuelle(ORDER.line_items[0], f)).toBe('addon');
  });

  test('Synonyme greifen nicht auf "Name - Nummer"', () => {
    const f = extractFields(ORDER.line_items[1].meta_data);
    expect(f.name).toBe('');
    expect(f.nummer).toBe('');
  });

  test('"Name - Nummer" wird am letzten " - " zerlegt', () => {
    expect(extractVarianteNameNummer(ORDER.line_items[1].meta_data))
      .toEqual({ name: 'SPIELER', nummer: '11' });
    expect(extractVarianteNameNummer([{ key: 'pa_name-nummer', display_value: 'JANINE - PEPPY - 24' }]))
      .toEqual({ name: 'JANINE - PEPPY', nummer: '24' });
  });

  test('Platzhalter WUNSCHNAME - WUNSCHNUMMER liefert nichts', () => {
    expect(extractVarianteNameNummer(ORDER.line_items[0].meta_data)).toBeNull();
    expect(extractVarianteNameNummer([{ key: 'pa_name-nummer', display_value: 'OHNETRENNER' }])).toBeNull();
  });

  test('kein Treffer → notiz, auch bei Variationsartikel', () => {
    expect(bestimmeQuelle({ variation_id: 20202 }, { ...extractFields([]), variante: null })).toBe('notiz');
  });

  test('Teilstring zählt nicht als Treffer', () => {
    expect(extractFields([{ key: 'Vorname', value: 'X' }]).name).toBe('');
  });
});

describe('buildRohtext', () => {
  test('meta_data ohne "_"-Schlüssel plus Kundennotiz', () => {
    const t = buildRohtext(ORDER.line_items[0], ORDER);
    expect(t).toContain('Größe: 3XL');
    expect(t).toContain('Wunschname: Muster');
    expect(t).toContain('Kundennotiz: Bitte bis Freitag');
    expect(t).not.toContain('_deliverytime');
  });

  test('nie leer', () => {
    expect(buildRohtext({ meta_data: [] }, {})).not.toBe('');
  });
});

describe('buildRowsForOrder', () => {
  const rows = buildRowsForOrder(ORDER, parseArtikel(ART_VALUES), '2026-09-14T08:00:00');

  test('individuell: eine Zeile je Stück, vorgefertigt: eine Zeile mit Menge', () => {
    expect(rows.map(r => [r['Zeilen-ID'], r['Stueck']])).toEqual([
      ['20626|900|1', 1],
      ['20626|900|2', 1],
      ['20626|901|1', 3],
      ['20626|903|1', 1],
    ]);
  });

  test('Artikelnummer: Trikot_Artikel, sonst SKU', () => {
    expect(rows[0]['Artikelnummer']).toBe('HEIMTrikot-1');
    expect(rows[3]['Artikelnummer']).toBe('TRK-SKU');
  });

  test('Variante: Name/Nummer aus dem Merkmal, Quelle variante', () => {
    expect([rows[2]['Name'], rows[2]['Nummer'], rows[2]['Quelle']]).toEqual(['SPIELER', '11', 'variante']);
    expect([rows[0]['Name'], rows[0]['Nummer']]).toEqual(['Muster', '57']);
  });

  test('Kunde, Bestelldatum, Quelle', () => {
    expect(rows[0]['Kunde']).toBe('Max Muster');
    expect(rows[0]['Bestelldatum']).toBe('2026-09-09T12:33:43');
    expect(rows[3]['Quelle']).toBe('notiz');
  });
});

describe('toSheetRow – manuelle Spalten bleiben unberührt', () => {
  test('Standardlayout: genau A–O, keine P–T', () => {
    const cols = resolveTrikotColumns(TRIKOT_HEADER);
    const row = toSheetRow(cols, { 'Zeilen-ID': '1|2|1', 'Stueck': 1 });
    expect(row).toHaveLength(15);
    expect(row[0]).toBe('1|2|1');
  });

  test('manuelle Spalte zwischen Skriptspalten bekommt null (= übersprungen)', () => {
    const header = [...SCRIPT_COLUMNS.slice(0, 5), 'Notiz', ...SCRIPT_COLUMNS.slice(5)];
    const row = toSheetRow(resolveTrikotColumns(header), { 'Kunde': 'X' });
    expect(row[5]).toBeNull();
    expect(row[6]).toBe('X');
  });

  test('fehlende Skriptspalte wirft', () => {
    expect(() => resolveTrikotColumns(TRIKOT_HEADER.filter(h => h !== 'Rohtext'))).toThrow(MissingHeaderError);
  });
});

describe('Bestand', () => {
  const values = [
    TRIKOT_HEADER,
    ['20617|1|1', '', '2026-09-08T23:31:28'],
    ['20626|900|1', '', '2026-09-09T12:33:43'],
  ];

  test('existingIds', () => {
    expect(existingIds(values)).toEqual(new Set(['20617|1|1', '20626|900|1']));
  });

  test('jüngstes Bestelldatum als Tag, leerer Reiter → null', () => {
    expect(juengstesBestelldatum(values)).toBe('2026-09-09');
    expect(juengstesBestelldatum([TRIKOT_HEADER])).toBeNull();
    expect(juengstesBestelldatum(undefined)).toBeNull();
  });
});
