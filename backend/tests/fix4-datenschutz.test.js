// FIX4 Teil A (Datenschutz). Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beispieleAus, buildSystemBlocks } from '../lib/chatCore.js';
import { datumAus, grenzeVon, bestellEintraegePlan, trikotsPlan, anfragenPlan, loeschlaufText } from '../utils/loeschlauf.js';
import { fundstellenPlan, fundstellenAntwort } from '../utils/kunde-fundstellen.js';
import { bestellungFuerBrowser } from '../utils/bestell-felder.js';
import { fehlerHandler, OEFFENTLICH_TEXT } from '../middleware/fehlerHandler.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = p => readFileSync(resolve(hier, p), 'utf8');
const JETZT = new Date('2026-11-20T08:00:00Z');

describe('Beispiele im Kundenchat nur aus Agent_Wissen', () => {
  test('nur Typ "beispiel", leer = Hinweis, echte Anfragen nie gelesen', () => {
    const werte = [['Typ', 'Schluessel', 'Wert', 'Notiz'], ['produkt', 'x', 'y'], ['Beispiel', 'Vereinsshirt 1-farbig', 'Menge 30 · ca. 14 €'], ['beispiel', '', 'leer']];
    expect(beispieleAus(werte)).toEqual([{ text: 'Vereinsshirt 1-farbig', wert: 'Menge 30 · ca. 14 €' }]);
    expect(buildSystemBlocks('KB', beispieleAus(werte), {})[0].text).toContain('1. Vereinsshirt 1-farbig | Menge 30 · ca. 14 €');
    expect(buildSystemBlocks('KB', [], {})[0].text).toContain('(keine Beispiele hinterlegt)');
    expect(lies('../lib/chatCore.js')).not.toMatch(/Kundenanfragen|Produkt-Beschreibung|Preisvorschlag/);
  });
  test('MC: vierte Sektion "Beispiele für den Kundenchat"', () => {
    const html = lies('../../frontend/index.html');
    expect(html).toContain('id="aw-beispiel-wrap"');
    expect(html).toContain("['produkt', 'ton', 'info', 'beispiel'].forEach(typ => {");
  });
});

describe('Loeschlauf 12 Monate', () => {
  test('Datum: ISO, TT.MM.JJJJ, Seriennummer; Grenze', () => {
    expect(datumAus('2025-11-01T10:00:00')?.toISOString().slice(0, 10)).toBe('2025-11-01');
    expect(datumAus('3.10.2025')?.toISOString().slice(0, 10)).toBe('2025-10-03');
    expect(datumAus(45962)?.toISOString().slice(0, 10)).toBe('2025-11-01');
    expect(datumAus('bald')).toBeNull();
    expect(grenzeVon(JETZT).toISOString().slice(0, 10)).toBe('2025-11-20');
  });
  test('Bestellseite: Termin-Datum zaehlt, sonst Zeit; nur Rueckenname und Wunsch', () => {
    const eintraege = [['Eintrag_ID', 'Termin_ID', 'Kuerzel', 'Trikot_Name', 'Wunsch', 'Zeit'],
      ['BE-1', 'BT-1', 'AB', 'Lotta', '', '2026-01-01'], ['BE-2', 'BT-2', 'CD', 'Mats', 'Gold', '2025-01-01'], ['BE-3', '', 'EF', 'Ole', '', '2025-06-01'], ['BE-4', 'BT-1', 'GH', '', '', '']];
    const termine = [['Termin_ID', 'Datum'], ['BT-1', '2025-11-19'], ['BT-2', '2026-03-01']];
    const p = bestellEintraegePlan({ eintraege, termine, jetzt: JETZT });
    expect(p.leeren.map(x => [x.id, x.zellen.map(z => z.feld)])).toEqual([['BE-1', ['Trikot_Name']], ['BE-3', ['Trikot_Name']]]);
    expect(p.zaehler).toEqual({ faellig: 2, jung: 1, ohneDatum: 0, ausnahme: 0 });
  });
  test('Trikots: Geliefert_Am vor Bestelldatum; Name, Kunde, Rohtext', () => {
    const trikots = [['Zeilen-ID', 'Bestelldatum', 'Kunde', 'Name', 'Rohtext', 'Geliefert_Am'],
      ['1|1|1', '2025-01-01T10:00:00', 'Erika Beispiel', 'ERIKA', 'x', 46000], ['2|1|1', '2025-01-01T10:00:00', 'Max Muster', 'MAX', '', '']];
    const p = trikotsPlan({ trikots, jetzt: JETZT });
    expect(p.leeren.map(x => x.id)).toEqual(['2|1|1']);
    expect(p.zaehler.jung).toBe(1);
  });
  test('Kundenanfragen: nur ohne Auftrag/Bestellung; Statistikfelder bleiben', () => {
    const anfragen = [['Anfrage-ID', 'Datum', 'Kunde-Name', 'Kunde-Email', 'Produkt-Beschreibung', 'Menge', 'Status', 'WC-Order-ID'],
      ['KA-1', '01.10.2025', 'Erika', 'e@example.invalid', 'Shirts', '10', 'Abgeschlossen', ''],
      ['KA-2', '01.10.2025', 'Max', '', 'Hoodies', '5', 'Abgeschlossen', ''],
      ['KA-3', '01.10.2025', 'Ole', '', 'Tassen', '2', 'Abgeschlossen', '123']];
    const auftraege = [['Auftrag_Nr', 'Anfrage_ID'], ['AU-2025-0001', 'KA-2']];
    const p = anfragenPlan({ anfragen, auftraege, jetzt: JETZT });
    expect(p.leeren.map(x => [x.id, x.zellen.map(z => z.feld)])).toEqual([['KA-1', ['Kunde-Name', 'Kunde-Email', 'Produkt-Beschreibung']]]);
    expect(p.zaehler.ausnahme).toBe(2);
  });
  test('Chat-Text nur Anzahlen; Route/Workflow: scharf nur mit Variable', () => {
    const t = loeschlaufText({ scharf: false, ergebnis: { Bestellseite: { zaehler: { faellig: 2 } }, Trikots: { fehler: 'quota' } } });
    expect(t).toBe('🧹 Datenschutz-Löschlauf (Trockenlauf)\nBestellseite: 2 fällig\nTrikots: Fehler (quota)');
    expect(lies('../routes/system.js')).toContain('const scharf = req.body?.scharf === true;');
    expect(lies('../../.github/workflows/loeschlauf-weekly.yml')).toContain("SCHARF: ${{ vars.LOESCHLAUF_SCHARF == 'ja' }}");
    expect(lies('../scripts/loeschlauf.js')).toContain("const WRITE = process.argv.includes('--write');");
  });
});

describe('DSGVO-Pruefliste', () => {
  const d = {
    kundenNr: 'K-00001', kunde: { Name: 'Erika Beispiel', 'E-Mail': 'erika@example.invalid' },
    auftraege: [['Auftrag_Nr', 'Kunden_Nr', 'Notiz'], ['AU-1', 'K-00001', 'ruft an'], ['AU-2', 'K-00002', 'x']],
    positionen: [['Position_ID', 'Auftrag_Nr', 'Notiz', 'Druckname'], ['AU-1-01', 'AU-1', '', 'Lotta'], ['AU-2-01', 'AU-2', 'y', '']],
    aufgaben: [['Aufgabe_Nr', 'Fuer', 'Notiz'], ['AG-1', 'K-00001', '']],
    bestellseiten: [['Zugang_ID', 'Kunden_Nr'], ['BS-001', 'K-00001']],
    eintraege: [['Eintrag_ID', 'Zugang_ID', 'Kuerzel', 'Notiz', 'Trikot_Name', 'Wunsch'], ['BE-1', 'BS-001', 'EB', '', '', ''], ['BE-2', 'BS-002', 'XY', '', '', '']],
    trikots: [['Zeilen-ID', 'Kunde', 'Name', 'Rohtext'], ['1', ' erika  beispiel ', 'ERIKA', ''], ['2', 'Max', 'MAX', '']],
    anfragen: [['Anfrage-ID', 'Kunde-Name', 'Kunde-Email'], ['KA-1', 'Jemand', 'ERIKA@example.invalid'], ['KA-2', 'Max', '']],
  };
  test('Treffer je Bereich, nur Anzahlen nach aussen', () => {
    const a = fundstellenAntwort(fundstellenPlan(d));
    expect(Object.fromEntries(a.map(x => [x.bereich, x.zeilen]))).toEqual({ auftraege: 1, positionen: 1, aufgaben: 0, bestellseite: 1, trikots: 1, anfragen: 1 });
    expect(JSON.stringify(a)).not.toMatch(/Erika|Lotta|ruft/);
  });
  test('MC: Liste im DSGVO-Schritt, leeren nur nach Rueckfrage', () => {
    const html = lies('../../frontend/index.html');
    expect(html).toContain('kuFundeLaden(k.Kunden_Nr);');
    expect(html).toMatch(/showConfirm\('Fundstellen leeren\?'/);
    expect(html).toMatch(/'ku-fund-leeren':\s+\{ name: 'leeren …'/);
  });
});

describe('Bestellungen nur mit angezeigten Feldern', () => {
  test('keine Lieferadresse, Mail, Telefon, Kundennotiz, Order-Meta, interne Positions-Meta', () => {
    const o = {
      id: 1, number: '1', status: 'processing', date_created: 'd', date_paid: null, total: '10', currency: 'EUR', payment_method_title: 'PayPal',
      billing: { first_name: 'Erika', last_name: 'Beispiel', city: 'Musterstadt', email: 'e@example.invalid', phone: '0123', address_1: 'Weg 1' },
      shipping: { address_1: 'Weg 1' }, customer_note: 'bitte klingeln', meta_data: [{ key: 'x', value: 'y' }],
      line_items: [{ id: 5, name: 'Shirt', parent_name: 'Shirt', quantity: 1, sku: 'S', product_id: 2, variation_id: 3, price: 10, image: { src: 'https://i0.wp.com/a.jpg', id: 9 },
        meta_data: [{ key: '_reduced_stock', value: 1 }, { key: 'pa_groesse', value: 'm', display_key: 'Größe', display_value: 'M' }] }],
      shipping_lines: [{ method_id: 'local_pickup', instance_id: '6', method_title: 'Stadion', total: '0' }], mc_admin_url: 'https://x/wp-admin/post.php?post=1&action=edit',
    };
    const b = bestellungFuerBrowser(o);
    expect(JSON.stringify(b)).not.toMatch(/example\.invalid|0123|Weg 1|klingeln|_reduced_stock/);
    expect(b.billing).toEqual({ first_name: 'Erika', last_name: 'Beispiel', city: 'Musterstadt' });
    expect(b.line_items[0].meta_data).toEqual([{ key: 'pa_groesse', value: 'm', display_key: 'Größe', display_value: 'M' }]);
    expect(b.line_items[0].image).toEqual({ src: 'https://i0.wp.com/a.jpg' });
    expect(b.shipping_lines).toEqual([{ method_id: 'local_pickup', instance_id: '6', method_title: 'Stadion' }]);
    expect(b.mc_admin_url).toBe(o.mc_admin_url);
  });
});

describe('oeffentliche Routen ohne internen Fehlertext', () => {
  const lauf = (err, oeffentlich) => {
    const res = { status: jest.fn(() => res), json: jest.fn() };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fehlerHandler(err, { mcOeffentlich: oeffentlich, method: 'GET', baseUrl: '/api/x', path: '/' }, res);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  };
  afterEach(() => jest.restoreAllMocks());
  test('5xx oeffentlich = fester Text + sauberer Code', () => {
    expect(lauf(Object.assign(new Error('Reiter Partner fehlt (quota)'), { status: 502, code: 'ki_fehler' }), true)).toEqual({ status: 502, body: { error: OEFFENTLICH_TEXT, code: 'ki_fehler' } });
    expect(lauf(Object.assign(new Error('x'), { code: 'ECONNRESET irgendwas' }), true).body).toEqual({ error: OEFFENTLICH_TEXT, code: 'fehler' });
  });
  test('4xx oeffentlich und MC bleiben wie bisher', () => {
    expect(lauf(Object.assign(new Error('Token ungültig'), { status: 401 }), true).body.error).toMatch(/^Error: Token ungültig|^Token ungültig/);
    expect(lauf(Object.assign(new Error('intern'), { status: 500 }), false).body.error).toMatch(/intern/);
  });
  test('index.js markiert die oeffentlichen Router', () => {
    const idx = lies('../index.js');
    for (const r of ["'/api/partner',      oeffentlich,", "'/api/anfragen',           oeffentlich,", "'/api/festpreis-public',   oeffentlich,", "'/api/bestellseite',       oeffentlich,"])
      expect(idx).toContain(r);
    expect(idx.indexOf('req.mcOeffentlich = false')).toBeLessThan(idx.indexOf('app.use(requireApiKey);'));
  });
});
