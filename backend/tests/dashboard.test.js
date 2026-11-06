// DB1: Dashboard - Zaehlregeln (utils/dashboard.js), Route-Logik (lib/dashboard.js) mit Attrappen. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  baueDashboard, shopBestellung, versandArt, alterTage, tagBerlin, zeitMs, pruefsumme, gelesenAus, gelesenZeile, istTrikotBestellung,
  KOPF_GELESEN, LANGE_AB_TAGE, ROT_AB_TAGE,
} from '../utils/dashboard.js';
import { leseDashboard, setzeHinweisGelesen, _dashboardCacheLeeren } from '../lib/dashboard.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const JETZT = new Date('2026-11-06T10:00:00Z');   // 11:00 Berlin
const artikel = { productIds: new Map([[777, 'TRIKOT-HEIM']]), skus: new Map() };
const tageVor = n => { const d = new Date(Date.UTC(2026, 10, 6 - n, 9, 0, 0)); return d.toISOString().slice(0, 19); };   // Shop-Ortszeit ohne Zone
const order = (id, { tage = 1, status = 'processing', note = '', pid = 1, lines = [{ method_id: 'flat_rate', instance_id: '2', method_title: 'Versand' }], total = '10.00' } = {}) => ({
  id, number: String(id), status, date_created: tageVor(tage), total, currency: 'EUR', billing: { first_name: 'Erika', last_name: `Beispiel${id}`, email: 'x@example.invalid' },
  customer_note: note, shipping_lines: lines, line_items: [{ product_id: pid, sku: 'X' }, { product_id: 5, sku: 'Y' }],
});
const norm = (o, shop = 'jfn') => shopBestellung(o, shop, { artikel });

describe('Tage und Zeit (Kalendertage Europe/Berlin)', () => {
  test('Shop-Zeit ohne Zone = Berliner Tag, ISO mit Z wird umgerechnet', () => {
    expect(tagBerlin('2026-11-01T23:30:00')).toBe('2026-11-01');
    expect(tagBerlin('2026-11-01T23:30:00Z')).toBe('2026-11-02');   // 00:30 Berlin
    expect(alterTage('2026-10-30T08:00:00', JETZT)).toBe(7);
    expect(alterTage('', JETZT)).toBeNull();
  });
  test('zeitMs: Shop-Ortszeit (Winter = UTC+1)', () => {
    expect(zeitMs('2026-11-06T11:00:00')).toBe(JETZT.getTime());
    expect(zeitMs('2026-07-01T12:00:00')).toBe(Date.parse('2026-07-01T10:00:00Z'));   // Sommer = UTC+2
  });
});

describe('Kacheln', () => {
  const offen = [
    order(1, { tage: 7 }),                                   // genau 7 = noch nicht lange
    order(2, { tage: 8, status: 'on-hold', total: '20.00' }), // lange, gelb, Zahlung offen
    order(3, { tage: 15 }),                                  // lange, rot
    order(4, { tage: 50, pid: 777 }),                        // Trikot (Mischbestellung) -> nie "lange", aber > 6 Wochen
    order(5, { tage: 2, note: 'Bitte vor Freitag', lines: [{ method_id: 'local_pickup', instance_id: '3', method_title: 'Abholung vor Ort' }] }),
  ];
  const au = {
    auftraege: [
      { Auftrag_Nr: 'AU-2026-0001', Kurztitel: 'Polos', Kunden_Nr: 'K-00001', Status: 'bestellt', Angelegt: '2026-10-20T08:00:00Z', ware: 'bestellt', Zustaendig: 'Nicole', preise: { brutto: 11900 } },
      { Auftrag_Nr: 'AU-2026-0002', Kurztitel: 'Tassen', Kunden_Nr: 'K-00002', Status: 'fertig', Angelegt: '2026-10-01T08:00:00Z', ware: 'da', Zustaendig: 'Christian', preise: { brutto: 5000 } },
      { Auftrag_Nr: 'AU-2026-0003', Kurztitel: 'Neu', Kunden_Nr: 'K-00001', Status: 'Anfrage', Angelegt: '2026-11-06T08:30:00Z', ware: '', Zustaendig: '', preise: { brutto: 0 } },
    ],
    aufgaben: [{ Aufgabe_Nr: 'AG-2026-0001', Kurztitel: 'Muster', Status: 'offen', Zustaendig: 'Nicole', Angelegt: '2026-11-05T12:00:00Z' }],
    todos: [
      { Todo_ID: 'T1', Bezug: 'AU-2026-0001', Faellig: '2026-11-05', Erledigt: '' },
      { Todo_ID: 'T2', Bezug: 'AU-2026-0002', Faellig: '2026-11-06', Erledigt: '' },
      { Todo_ID: 'T3', Bezug: 'AU-2026-0002', Faellig: '2026-11-01', Erledigt: 'ja' },
    ],
  };
  const basis = {
    shops: { jfn: { offen: offen.map(o => norm(o)), neu: [], woche: [] }, honk: { offen: [norm(order(9, { tage: 9 }), 'honk')], neu: [], woche: [] } },
    au, kunden: new Map([['K-00001', 'Testverein']]), jetzt: JETZT,
    rueckstand: { zahlen: { positionen: 3, stueck: 5, kritisch: 1 }, liste: { veraltet: false }, je: { shop: { 'JFN:3': { status: 'ca. KW 46' } }, auftrag: {} } },
    trikots: { summen: { offen: 4, goalieOffen: 1 } },
  };

  test('Wartet lange: > 7 Tage (7 = nein), rot ab > 14, Shop + Auftraege, ohne Trikot-Bestellungen, Gruende', () => {
    const d = baueDashboard(basis);
    const k = d.kacheln.lange;
    expect(k.liste.map(x => [x.nr, x.tage])).toEqual([['AU-2026-0001', 17], ['3', 15], ['9', 9], ['2', 8]]);   // nach Tagen absteigend
    expect(k.liste.find(x => x.nr === '1')).toBeUndefined();
    expect(k.liste.find(x => x.nr === '4')).toBeUndefined();   // Trikot fliegt raus, auch mit weiteren Artikeln
    expect(k.rot).toBe(true);
    expect(k.liste.find(x => x.nr === '2').grund).toContain('Zahlung offen');
    expect(k.liste.find(x => x.nr === '3').grund).toContain('L-Shop-Rückstand: ca. KW 46');
    expect(k.liste.find(x => x.nr === 'AU-2026-0001').grund).toContain('wartet auf Ware');
    expect(k.liste.find(x => x.nr === 'AU-2026-0002')).toBeUndefined();   // fertig = wartet nicht mehr auf Produktion
    expect(LANGE_AB_TAGE).toBe(7); expect(ROT_AB_TAGE).toBe(14);
  });
  test('Grenzen: 14 Tage = gelb, 15 = rot', () => {
    const nur = tage => baueDashboard({ ...basis, au: { auftraege: [], aufgaben: [], todos: [] }, shops: { jfn: { offen: [norm(order(1, { tage }))], neu: [], woche: [] }, honk: { offen: [], neu: [], woche: [] } } }).kacheln.lange;
    expect(nur(14).rot).toBe(false);
    expect(nur(15).rot).toBe(true);
    expect(nur(7).zahl).toBe(0);
    expect(nur(8).zahl).toBe(1);
  });
  test('Kundenhinweise ungelesen; gelesen gilt fuer alle; geaenderte Notiz = wieder ungelesen', () => {
    expect(baueDashboard(basis).kacheln.hinweise.zahl).toBe(1);
    const p = pruefsumme('Bitte vor Freitag');
    const gelesen = gelesenAus([KOPF_GELESEN, ['JFN', '5', p, 'N', JETZT.toISOString()]]);
    expect(baueDashboard({ ...basis, gelesen }).kacheln.hinweise.zahl).toBe(0);
    const geaendert = { ...basis, gelesen, shops: { ...basis.shops, jfn: { ...basis.shops.jfn, offen: [norm(order(5, { tage: 2, note: 'Bitte vor Samstag' }))] } } };
    expect(baueDashboard(geaendert).kacheln.hinweise.zahl).toBe(1);
  });
  test('To-dos, Ware, Abholung, Trikots, Rueckstand', () => {
    const k = baueDashboard(basis).kacheln;
    expect(k.todos).toEqual({ ueberfaellig: 1, heute: 1 });
    expect(k.ware.zahl).toBe(1);
    expect(k.abholung.zahl).toBe(1);
    expect(k.trikots).toEqual({ nichtBeimProduzenten: 4, goalie: 1, ueber6Wochen: 1 });
    expect(k.rueckstand).toMatchObject({ positionen: 3, stueck: 5, kritisch: 1, veraltet: false });
  });
  test('meine/alle: nur Auftraege/Aufgaben/To-dos der Person; Shop bleibt', () => {
    const n = baueDashboard({ ...basis, wer: 'Nicole' });
    expect(n.kacheln.todos).toEqual({ ueberfaellig: 1, heute: 0 });
    expect(n.auftraege.bestellt).toBe(1);
    expect(n.auftraege.fertigNichtBezahlt).toBe(0);
    expect(n.kacheln.abholung.zahl).toBe(1);
    expect(baueDashboard({ ...basis, wer: 'Hacker' }).wer).toBe('');
  });
  test('Eigene Auftraege: Status-Zahlen + Termin/Aufgaben (aus der alten Kachel)', () => {
    const a = baueDashboard(basis).auftraege;
    expect(a).toMatchObject({ Anfrage: 1, bestellt: 1, fertigNichtBezahlt: 1, offen: 3, aufgabenOffen: 1 });
  });
  test('Neu in 24 h: Shop + AU/AG gemeinsam, neueste oben, Storno nicht', () => {
    const neu = [norm(order(20, { tage: 0, note: 'x' })), norm({ ...order(21, { tage: 0 }), status: 'cancelled' }), norm(order(22, { tage: 2 }))];
    const d = baueDashboard({ ...basis, shops: { ...basis.shops, jfn: { ...basis.shops.jfn, neu } } });
    expect(d.neu.map(x => x.nr)).toEqual(['AU-2026-0003', '20', 'AG-2026-0001']);   // 09:30 vor 09:00 Berlin vor gestern 13:00
    expect(d.neu[1]).toMatchObject({ hinweis: true, shopKurz: 'JFN' });
    expect(baueDashboard({ ...basis, au: { auftraege: [], aufgaben: [], todos: [] } }).neu).toEqual([]);
  });
  test('Geld: heute, 7 Tage, offen (on-hold + fertig nicht bezahlt brutto)', () => {
    const woche = [norm(order(30, { tage: 0, total: '12.50' })), norm(order(31, { tage: 3, total: '7.50' })), norm({ ...order(32, { tage: 1 }), status: 'refunded' })];
    const g = baueDashboard({ ...basis, shops: { ...basis.shops, jfn: { ...basis.shops.jfn, woche } } }).geld;
    expect(g).toMatchObject({ heute: 12.5, sieben: 20, offen: 70 });
    expect(g.tage).toHaveLength(7);
    expect(g.tage[6].tag).toBe('2026-11-06');
  });
  test('Teilfehler: nur die betroffenen Kacheln fehlen', () => {
    const d = baueDashboard({ ...basis, fehler: { rueckstand: true, shop_honk: true } });
    expect(d.kacheln.rueckstand).toEqual({ fehlt: ['rueckstand'] });
    expect(d.kacheln.hinweise).toEqual({ fehlt: ['shop_honk'] });
    expect(d.kacheln.todos.ueberfaellig).toBe(1);
    expect(d.auftraege.bestellt).toBe(1);
  });
  test('Leere Daten: alles 0, keine Fehler', () => {
    const d = baueDashboard({ shops: { jfn: { offen: [], neu: [], woche: [] }, honk: { offen: [], neu: [], woche: [] } }, au: { auftraege: [], aufgaben: [], todos: [] }, rueckstand: { zahlen: { positionen: 0, stueck: 0, kritisch: 0 } }, trikots: { summen: { offen: 0, goalieOffen: 0 } }, jetzt: JETZT });
    expect(d.kacheln.lange.zahl).toBe(0);
    expect(d.neu).toEqual([]);
    expect(d.wartend.liste).toEqual([]);
  });
});

describe('Bausteine', () => {
  test('Trikot-Bestellung: Produkt-ID, Order-ID im Reiter; HONK nie', () => {
    expect(istTrikotBestellung(order(1, { pid: 777 }), 'jfn', artikel)).toBe(true);
    expect(istTrikotBestellung(order(2), 'jfn', artikel, new Set(['2']))).toBe(true);
    expect(istTrikotBestellung(order(3), 'jfn', artikel)).toBe(false);
    expect(istTrikotBestellung(order(4, { pid: 777 }), 'honk', artikel)).toBe(false);
  });
  test('Bestellung ohne Adresse/Mail', () => {
    const b = norm(order(1));
    expect(JSON.stringify(b)).not.toContain('example.invalid');
    expect(b.kunde).toBe('Erika Beispiel1');
  });
  test('Versandart = psVersandArt der Oberflaeche (Abholung gleich erkannt)', () => {
    const start = html.indexOf('const PS_ABHOLUNG = {');
    const code = html.slice(start, html.indexOf('\n      }\n', html.indexOf('function psVersandArt')) + 8);
    const psVersandArt = new Function(`${code}\nreturn psVersandArt;`)();
    const faelle = [
      [], [{ method_id: 'local_pickup', instance_id: '6', method_title: 'Stadion' }], [{ method_id: 'local_pickup', instance_id: '3', method_title: 'x' }],
      [{ method_id: 'pickup_location', instance_id: '1', method_title: 'Sammel' }], [{ method_id: 'irgendwas', instance_id: '1', method_title: 'Abholung im Laden' }],
      [{ method_id: 'flat_rate', instance_id: '2', method_title: 'Abholung?' }], [{ method_id: 'free_shipping', instance_id: '1', method_title: 'Gratis' }],
    ];
    for (const shop of ['jfn', 'honk']) for (const lines of faelle) {
      const a = psVersandArt({ shipping_lines: lines }, shop), b = versandArt({ shipping_lines: lines }, shop);
      expect([lines, shop, b.art, b.icon]).toEqual([lines, shop, a.art, a.icon]);
      if (a.art === 'abholung') expect(b.text).toBe(a.text);
    }
  });
  test('gelesen-Zeile: nur Shop, Nr, Pruefsumme, Kuerzel, Zeit', () => {
    expect(gelesenZeile({ shop: 'honk', nr: '12', pruef: 'abcdef0123456789', wer: 'Nicole', jetzt: JETZT })).toEqual(['HONK', '12', 'abcdef0123456789', 'N', JETZT.toISOString()]);
    expect(gelesenZeile({ shop: 'jfn', nr: '1', pruef: 'a', wer: '', jetzt: JETZT })[3]).toBe('');
    expect(pruefsumme('')).toBe('');
    expect(pruefsumme(' a\r\nb ')).toBe(pruefsumme('a\nb'));   // Windows-Umbruch und Rand zaehlen nicht, sonst jedes Zeichen
  });
});

// ── lib/dashboard.js mit Attrappen ──
const wcAttrappe = (orders, einzel = {}) => {
  const aufrufe = [];
  return {
    aufrufe,
    get: async (pfad, params = {}) => {
      aufrufe.push([pfad, params.status ?? (params.after ? 'after' : '')]);
      if (pfad.startsWith('orders/')) return { data: einzel[pfad.slice(7)] ?? null };
      const liste = params.status ? orders.filter(o => o.status === params.status) : orders;
      return { data: params.page > 1 ? [] : liste };
    },
  };
};
const sheetsAttrappe = (tabs) => {
  const updates = [];
  return {
    updates,
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          const name = range.match(/^'([^']+)'/)?.[1];
          if (!(name in tabs)) { const e = new Error('Unable to parse range'); e.code = 400; throw e; }
          const m = range.match(/!A(\d+):[A-Z]+(\d+)$/);
          const w = tabs[name];
          return { data: { values: m ? w.slice(+m[1] - 1, +m[2]) : w } };
        },
        update: async ({ range, requestBody }) => {
          const name = range.match(/^'([^']+)'/)[1]; const m = range.match(/!A(\d+)/);
          requestBody.values.forEach((z, i) => { tabs[name][+m[1] - 1 + i] = z; });
          updates.push(range);
        },
      },
      batchUpdate: async () => ({}),
      get: async () => ({ data: { sheets: Object.keys(tabs).map(title => ({ properties: { title, sheetId: 1, gridProperties: { rowCount: 500, columnCount: 10 } } })) } }),
    },
  };
};

describe('lib/dashboard', () => {
  beforeEach(() => _dashboardCacheLeeren());
  const quellen = {
    auftraege: async () => ({ auftraege: [], aufgaben: [], todos: [] }), kunden: async () => ({ kunden: [] }),
    rueckstand: async () => { throw new Error('Drive weg'); }, trikots: async () => ({ summen: { offen: 0, goalieOffen: 0 }, gruppen: [] }),
    trikotArtikel: async () => artikel, gelesen: async () => [KOPF_GELESEN],
  };
  test('eine Route, Shops nacheinander (processing, on-hold, Woche), Teilfehler nur Rueckstand', async () => {
    const jfn = wcAttrappe([order(1, { tage: 9 }), order(2, { status: 'on-hold', tage: 1 })]);
    const honk = wcAttrappe([]);
    const d = await leseDashboard({ jetzt: JETZT, sheets: sheetsAttrappe({}), wc: { jfn, honk }, quellen });
    expect(jfn.aufrufe).toEqual([['orders', 'processing'], ['orders', 'on-hold'], ['orders', 'after']]);
    expect(d.kacheln.rueckstand).toEqual({ fehlt: ['rueckstand'] });
    expect(d.fehlerText.rueckstand).toBe('Drive weg');
    expect(d.kacheln.lange.zahl).toBe(1);
  });
  test('Hinweis gelesen: Pruefsumme muss stimmen, Zeile ohne append, zweiter Klick schreibt nichts', async () => {
    const tabs = { Hinweis_Gelesen: [KOPF_GELESEN] };
    const s = sheetsAttrappe(tabs);
    const p = pruefsumme('Bitte klingeln');
    const wc = wcAttrappe([], { 77: { id: 77, number: '77', customer_note: 'Bitte klingeln' } });
    const r = await setzeHinweisGelesen({ eingabe: { shop: 'jfn', nr: '77', pruef: p, wer: 'Christian' }, sheets: s, wc, jetzt: () => JETZT });
    expect(r).toEqual({ ok: true, zeile: 2 });
    expect(tabs.Hinweis_Gelesen[1]).toEqual(['JFN', '77', p, 'C', JETZT.toISOString()]);
    expect(await setzeHinweisGelesen({ eingabe: { shop: 'jfn', nr: '77', pruef: p }, sheets: s, wc, jetzt: () => JETZT })).toEqual({ ok: true, schon: true });
    await expect(setzeHinweisGelesen({ eingabe: { shop: 'jfn', nr: '77', pruef: pruefsumme('alt') }, sheets: s, wc })).rejects.toMatchObject({ status: 409, code: 'geaendert' });
    await expect(setzeHinweisGelesen({ eingabe: { shop: 'xx', nr: '77', pruef: p }, sheets: s, wc })).rejects.toMatchObject({ status: 422 });
    await expect(setzeHinweisGelesen({ eingabe: { shop: 'jfn', nr: '77', pruef: p }, sheets: sheetsAttrappe({}), wc })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(JSON.stringify(tabs)).not.toContain('klingeln');
  });
});

describe('Shop aus dem Kennzeichen (Inhaber 06.11.)', () => {
  const b = (id, shop, opt) => shopBestellung(order(id, opt), shop, { artikel });
  const basis = {
    shops: { jfn: { offen: [b(1, 'jfn', { tage: 9, note: 'a' })], neu: [b(1, 'jfn', { tage: 0 })], woche: [b(1, 'jfn', { tage: 0, total: '10.00' })] },
      honk: { offen: [b(2, 'honk', { tage: 20, note: 'b' })], neu: [b(2, 'honk', { tage: 0 })], woche: [b(2, 'honk', { tage: 0, total: '5.00' })] } },
    au: { auftraege: [{ Auftrag_Nr: 'AU-2026-0001', Status: 'bestellt', Angelegt: '2026-10-01T08:00:00Z', ware: 'bestellt' }], aufgaben: [], todos: [] },
    rueckstand: { zahlen: { positionen: 1, stueck: 1, kritisch: 0 }, liste: {} }, trikots: { summen: { offen: 2, goalieOffen: 0 } }, jetzt: JETZT,
  };
  test('JFN: nur JFN-Bestellungen, Auftraege bleiben', () => {
    const d = baueDashboard({ ...basis, shop: 'jfn' });
    expect(d.shop).toBe('jfn');
    expect(d.kacheln.hinweise.zahl).toBe(1);
    expect(d.kacheln.lange.liste.map(x => x.nr)).toEqual(['AU-2026-0001', '1']);
    expect(d.geld.heute).toBe(10);
    expect(d.kacheln.trikots.nichtBeimProduzenten).toBe(2);
  });
  test('HONK: nur HONK, Rueckstand und Trikots "nur JFN", Trikot-Artikel-Fehler stoert HONK nicht', () => {
    const d = baueDashboard({ ...basis, shop: 'honk', fehler: { trikot_artikel: true } });
    expect(d.kacheln.hinweise.liste.map(x => x.shop)).toEqual(['honk']);
    expect(d.neu.filter(x => x.art === 'shop').map(x => x.shop)).toEqual(['honk']);
    expect(d.geld.heute).toBe(5);
    expect(d.kacheln.rueckstand).toEqual({ nurJfn: true });
    expect(d.kacheln.trikots).toEqual({ nurJfn: true });
    expect(d.kacheln.lange.zahl).toBe(2);
  });
  test('Route liest nur den gewaehlten Shop', async () => {
    _dashboardCacheLeeren();
    const jfn = wcAttrappe([]), honk = wcAttrappe([order(5, { tage: 1 })]);
    const quellen = { auftraege: async () => ({ auftraege: [], aufgaben: [], todos: [] }), kunden: async () => ({ kunden: [] }), rueckstand: async () => ({ zahlen: {} }),
      trikots: async () => ({ summen: {}, gruppen: [] }), trikotArtikel: async () => artikel, gelesen: async () => [KOPF_GELESEN] };
    const d = await leseDashboard({ shop: 'honk', jetzt: JETZT, sheets: sheetsAttrappe({}), wc: { jfn, honk }, quellen });
    expect(jfn.aufrufe).toEqual([]);
    expect(honk.aufrufe).toHaveLength(3);
    expect(d.shop).toBe('honk');
  });
});
