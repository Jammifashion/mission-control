// BO4b-1: Belege von L-Shop - Logik (utils/lshop-belege.js) und Abruf (lib/lshopBelege.js) gegen ein
// In-Memory-Sheet und eine FTP-Attrappe. Waechter ORDER/AB, Dekodierung nach BOM (UTF-16!), nur neue
// Dateien laden, Hash-Aenderung, Trockenlauf, Fehllaeufe (Chat ab 3 in Folge, 1/h), Schreiben vor Melden.
// Testdaten ohne echte Zugangsdaten, Adressen oder Kundennummern.

import {
  BELEGE_TAB, BELEGE_SPALTEN, ORDNER, ERGEBNIS, ART, dekodiere, findeOrderIds, orderIdAusDateiname, bewerteOrderDatei,
  bewerteAb, fehlerSerie, fehllaufMelden, eintragGeaendert, belegeSpalten, ftpZeit, orderLiegtZuLange, sha256,
  buildBelegeAlarmNachricht, buildFtpFehlerNachricht,
} from '../utils/lshop-belege.js';
import { runBelegeAbruf, richteBelegeEin, BELEGE_BESCHAEFTIGT } from '../lib/lshopBelege.js';
import { LShopFtpFehler } from '../lib/lshopFtp.js';
import { EDI_TAB, EDI_SPALTEN } from '../utils/edi-bestellung.js';
import { machSheets } from './hilfen/korb-sheet.js';

const JETZT = () => new Date('2026-10-22T18:00:00Z');
const utf16 = s => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const utf8bom = s => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, 'utf8')]);
const ab = id => `<?xml version="1.0" encoding="utf-8"?><Orderconfirmation><Kopf><![CDATA[${id}   ]]></Kopf></Orderconfirmation>`;
const edi = new Map([['JFN-2026-0001', 'Testdatei'], ['JFN-2026-0002', 'Entwurf'], ['JFN-2026-0003', 'gesendet']]);
const datei = (name, o = {}) => ({ name, size: 100, istDatei: true, modifiedAt: new Date('2026-10-22T17:58:00Z'), rawModifiedAt: '', ...o });

// ── Logik ────────────────────────────────────────────────────────────────────

describe('dekodiere: nach BOM, nicht nach der XML-Kopfzeile', () => {
  test('UTF-16 LE mit BOM trotz encoding="utf-8" (Lieferbestaetigung, gemessen 22.10.)', () => {
    expect(dekodiere(utf16(ab('JFN-2026-0003')))).toContain('JFN-2026-0003');
  });
  test('UTF-8 mit BOM, UTF-16 BE mit BOM, UTF-16 LE ohne BOM, UTF-8 ohne BOM', () => {
    expect(dekodiere(utf8bom('Größe JFN-2026-0003'))).toBe('Größe JFN-2026-0003');
    const be = Buffer.from('<root>ä</root>', 'utf16le'); be.swap16();
    expect(dekodiere(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe('<root>ä</root>');
    expect(dekodiere(Buffer.from('<root>JFN-2026-0003</root>', 'utf16le'))).toBe('<root>JFN-2026-0003</root>');
    expect(dekodiere(Buffer.from('<root>Größe</root>', 'utf8'))).toBe('<root>Größe</root>');
  });
});

describe('order_id finden', () => {
  test('alle JFN-JJJJ-NNNN je einmal; Dateiname in ORDER', () => {
    expect(findeOrderIds('a JFN-2026-0003 b JFN-2026-0003 c JFN-2027-0001')).toEqual(['JFN-2026-0003', 'JFN-2027-0001']);
    expect(findeOrderIds('VA12345678')).toEqual([]);
    expect(orderIdAusDateiname('JFN-2026-0003_20261022-1915.xml')).toBe('JFN-2026-0003');
    expect(orderIdAusDateiname('bestellung.xml')).toBeNull();
    expect(orderIdAusDateiname('JFN-2026-0003_20261022-1915.xml.bak')).toBeNull();
  });
});

describe('Waechter ORDER', () => {
  const nun = JETZT();
  test('fremder Name, unbekannte order_id, Entwurf -> Alarm', () => {
    expect(bewerteOrderDatei(datei('bestellung.xml'), edi, nun)).toMatchObject({ ergebnis: ERGEBNIS.ALARM, orderId: '' });
    expect(bewerteOrderDatei(datei('JFN-2026-0099_20261022-1900.xml'), edi, nun).hinweis).toMatch(/nicht in LShop_EDI_Dateien/);
    expect(bewerteOrderDatei(datei('JFN-2026-0002_20261022-1100.xml'), edi, nun)).toMatchObject({ ergebnis: ERGEBNIS.ALARM, hinweis: expect.stringMatching(/"Entwurf"/) });
  });
  test('eigene, gesendete Datei -> eigen; liegt sie > 20 min, nur markiert (Alarm erst BO4c)', () => {
    expect(bewerteOrderDatei(datei('JFN-2026-0003_20261022-1958.xml'), edi, nun)).toMatchObject({ ergebnis: ERGEBNIS.EIGEN, zuLange: false });
    const alt = datei('JFN-2026-0003_20261022-1900.xml', { modifiedAt: new Date('2026-10-22T17:30:00Z') });
    expect(bewerteOrderDatei(alt, edi, nun)).toMatchObject({ ergebnis: ERGEBNIS.EIGEN, zuLange: true, hinweis: 'liegt seit 30 min' });
    expect(orderLiegtZuLange({ modifiedAt: undefined }, nun)).toBe(false);
  });
});

describe('Waechter Auftragsbestaetigung', () => {
  test('keine, unbekannte, Entwurf- oder Testdatei-order_id -> Alarm', () => {
    expect(bewerteAb('<x/>', edi)).toMatchObject({ ergebnis: ERGEBNIS.ALARM, hinweis: 'keine order_id von uns in der AB' });
    expect(bewerteAb(ab('JFN-2026-0099'), edi).ergebnis).toBe(ERGEBNIS.ALARM);
    expect(bewerteAb(ab('JFN-2026-0002'), edi).hinweis).toBe('JFN-2026-0002 ist nur "Entwurf"');
    expect(bewerteAb(ab('JFN-2026-0001'), edi).hinweis).toBe('JFN-2026-0001 ist nur "Testdatei"');
    expect(bewerteAb(`${ab('JFN-2026-0003')}${ab('JFN-2026-0002')}`, edi).ergebnis).toBe(ERGEBNIS.ALARM);
  });
  test('gesendete order_id -> erkannt, Auswertung folgt', () => {
    expect(bewerteAb(ab('JFN-2026-0003'), edi)).toMatchObject({ ergebnis: ERGEBNIS.ERKANNT, orderIds: ['JFN-2026-0003'] });
  });
});

describe('Fehllaeufe', () => {
  const lauf = (Ergebnis, Gelesen = '2026-10-22T17:00:00Z') => ({ Art: ART.LAUF, Ergebnis, Gelesen });
  test('Chat erst beim 3. in Folge; "ok nach Fehlern" setzt zurueck', () => {
    const nun = JETZT();
    expect(fehllaufMelden(fehlerSerie([]), nun)).toBe(false);
    expect(fehllaufMelden(fehlerSerie([lauf(ERGEBNIS.FEHLER)]), nun)).toBe(false);
    expect(fehllaufMelden(fehlerSerie([lauf(ERGEBNIS.FEHLER), lauf(ERGEBNIS.FEHLER)]), nun)).toBe(true);
    expect(fehlerSerie([lauf(ERGEBNIS.FEHLER), lauf(ERGEBNIS.FEHLER), lauf(ERGEBNIS.OK_NACH_FEHLERN)]).inFolge).toBe(0);
  });
  test('hoechstens 1 Meldung je Stunde', () => {
    const nun = JETZT();
    const z = [lauf(ERGEBNIS.FEHLER), lauf(ERGEBNIS.FEHLER), lauf(ERGEBNIS.FEHLER_GEMELDET, '2026-10-22T17:30:00Z')];
    expect(fehllaufMelden(fehlerSerie(z), nun)).toBe(false);
    expect(fehllaufMelden(fehlerSerie(z), new Date('2026-10-22T18:31:00Z'))).toBe(true);
  });
});

describe('Kleinteile', () => {
  test('Spalten ueber den Namen, fehlende -> 422', () => {
    expect(belegeSpalten(BELEGE_SPALTEN).Hash).toBe(3);
    expect(() => belegeSpalten(['Ordner', 'Datei'])).toThrow(/Hash/);
  });
  test('Aenderung an Groesse oder Zeitstempel; Zeit als ISO, sonst roh', () => {
    const e = datei('a.xml');
    const p = { Groesse: '100', Geaendert_FTP: ftpZeit(e) };
    expect(eintragGeaendert(e, p)).toBe(false);
    expect(eintragGeaendert({ ...e, size: 101 }, p)).toBe(true);
    expect(ftpZeit({ rawModifiedAt: 'Oct 22 17:00' })).toBe('Oct 22 17:00');
  });
  test('Chat-Texte nennen nur Ordner, Datei, Grund', () => {
    const t = buildBelegeAlarmNachricht([{ ordner: 'ORDER', datei: 'x.xml', hinweis: 'fremd' }]);
    expect(t).toContain('ORDER/x.xml: fremd');
    expect(buildFtpFehlerNachricht({ inFolge: 3, grund: 'FTP: ETIMEDOUT' })).toContain('3 Läufe in Folge');
  });
});

// ── Abruf gegen In-Memory-Sheet und FTP-Attrappe ──────────────────────────────

function aufbau({ belege = [], ediZeilen } = {}) {
  const tabs = {
    [BELEGE_TAB]: [BELEGE_SPALTEN, ...belege],
    [EDI_TAB]: [EDI_SPALTEN, ...(ediZeilen ?? [['JFN-2026-0001', '2026-09-21', 'Testdatei'], ['JFN-2026-0002', '2026-10-22', 'Entwurf'], ['JFN-2026-0003', '2026-10-22', 'gesendet']])],
  };
  return { tabs, ...machSheets(tabs) };
}

/** FTP-Attrappe: inhalt = { ORDNER: { datei: Buffer } }. */
function ftpAttrappe(inhalt = {}, { fehler } = {}) {
  const geladen = [];
  const ftp = async fn => {
    if (fehler) throw fehler;
    return fn({
      liste: async o => Object.entries(inhalt[o] ?? {}).map(([name, buf]) => datei(name, { size: buf.length })),
      lade: async (o, d) => { geladen.push(`${o}/${d}`); return inhalt[o][d]; },
    });
  };
  return { ftp, geladen };
}

const zeilenAb = tabs => tabs[BELEGE_TAB].slice(1).map(r => Object.fromEntries(BELEGE_SPALTEN.map((n, i) => [n, r[i] ?? ''])));

beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; });

describe('runBelegeAbruf', () => {
  test('leerer FTP: nichts geschrieben, nichts gemeldet', async () => {
    const { sheets, aufrufe } = aufbau();
    const meldungen = [];
    const r = await runBelegeAbruf({ sheets, ftp: ftpAttrappe().ftp, melde: async t => meldungen.push(t), jetzt: JETZT });
    expect(r).toMatchObject({ ftp: 'ok', neueZeilen: 0, alarme: [], geschrieben: null });
    expect(aufrufe.update).toEqual([]);
    expect(meldungen).toEqual([]);
  });

  test('fremde Datei in ORDER: eine Zeile, ein Alarm; zweiter Lauf meldet nicht noch einmal; ORDER wird nie geladen', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const { ftp, geladen } = ftpAttrappe({ [ORDNER.ORDER]: { 'bestellung.xml': Buffer.from('x') } });
    const r = await runBelegeAbruf({ sheets, ftp, melde: async t => { meldungen.push(t); return true; }, jetzt: JETZT });
    expect(r.alarme).toEqual([{ ordner: 'ORDER', datei: 'bestellung.xml', hinweis: expect.stringMatching(/nicht von MC/) }]);
    expect(zeilenAb(tabs)).toEqual([expect.objectContaining({ Ordner: 'ORDER', Datei: 'bestellung.xml', Art: ART.ORDER, Ergebnis: 'alarm', Hash: '' })]);
    expect(meldungen).toHaveLength(1);
    expect(geladen).toEqual([]);

    const r2 = await runBelegeAbruf({ sheets, ftp, melde: async t => meldungen.push(t), jetzt: JETZT });
    expect(r2.neueZeilen).toBe(0);
    expect(meldungen).toHaveLength(1);
  });

  test('AB zu Entwurf JFN-2026-0002 (UTF-16) -> Alarm; AB zu gesendeter order_id -> erkannt + Info', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const { ftp } = ftpAttrappe({ [ORDNER.AB]: {
      'AB_1.xml': utf16(ab('JFN-2026-0002')),
      'AB_2.xml': utf8bom(ab('JFN-2026-0003')),
    } });
    const r = await runBelegeAbruf({ sheets, ftp, melde: async t => { meldungen.push(t); return true; }, jetzt: JETZT });
    expect(r.alarme).toEqual([{ ordner: ORDNER.AB, datei: 'AB_1.xml', hinweis: 'JFN-2026-0002 ist nur "Entwurf"' }]);
    expect(r.abErkannt).toEqual([{ datei: 'AB_2.xml', orderIds: ['JFN-2026-0003'] }]);
    const z = zeilenAb(tabs);
    expect(z.map(x => [x.Datei, x.order_id, x.Ergebnis])).toEqual([['AB_1.xml', 'JFN-2026-0002', 'alarm'], ['AB_2.xml', 'JFN-2026-0003', 'erkannt']]);
    expect(z[0].Hash).toBe(sha256(utf16(ab('JFN-2026-0002'))));
    expect(meldungen).toHaveLength(2);
    expect(meldungen[0]).toMatch(/nicht von uns/);
    expect(meldungen[1]).toMatch(/Auftragsbestätigung eingegangen/);
  });

  test('protokollierte, unveraenderte AB wird nicht geladen; veraenderte (Hash) -> Alarm', async () => {
    const buf = utf8bom(ab('JFN-2026-0003'));
    const e = datei('AB_2.xml', { size: buf.length });
    const alt = BELEGE_SPALTEN.map(n => ({
      Ordner: ORDNER.AB, Datei: 'AB_2.xml', Groesse: String(buf.length), Hash: sha256(buf), Geaendert_FTP: ftpZeit(e),
      Gelesen: '2026-10-22T17:00:00.000Z', Art: ART.AB, order_id: 'JFN-2026-0003', Ergebnis: 'erkannt',
    }[n] ?? ''));
    const { sheets } = aufbau({ belege: [alt] });
    const a = ftpAttrappe({ [ORDNER.AB]: { 'AB_2.xml': buf } });
    const r = await runBelegeAbruf({ sheets, ftp: a.ftp, melde: async () => true, jetzt: JETZT });
    expect(a.geladen).toEqual([]);
    expect(r.neueZeilen).toBe(0);

    const anders = utf8bom(ab('JFN-2026-0003') + ' ');
    const { tabs: t2, sheets: s2 } = aufbau({ belege: [alt] });
    const b = ftpAttrappe({ [ORDNER.AB]: { 'AB_2.xml': anders } });
    const r2 = await runBelegeAbruf({ sheets: s2, ftp: b.ftp, melde: async () => true, jetzt: JETZT });
    expect(r2.alarme[0].hinweis).toMatch(/Datei verändert/);
    expect(zeilenAb(t2).at(-1)).toMatchObject({ Ergebnis: ERGEBNIS.VERAENDERT, Hash: sha256(anders) });
  });

  test('Lieferbestaetigungen und Rechnungen werden nur gezaehlt (BO4b-2)', async () => {
    const { tabs, sheets } = aufbau();
    const { ftp, geladen } = ftpAttrappe({ [ORDNER.LB]: { 'DeliveryConfirmation_20261021204643.xml': utf16('<root/>') }, [ORDNER.RE_XML]: {} });
    const r = await runBelegeAbruf({ sheets, ftp, melde: async () => true, jetzt: JETZT });
    expect(r.ordner).toMatchObject({ DELIVERYCONFIRMATION: 1, 'INVOICE/XML': 0 });
    expect(geladen).toEqual([]);
    expect(zeilenAb(tabs)).toEqual([]);
  });

  test('Trockenlauf: bewertet, schreibt nichts, meldet nichts', async () => {
    const { sheets, aufrufe } = aufbau();
    const meldungen = [];
    const { ftp } = ftpAttrappe({ [ORDNER.ORDER]: { 'fremd.xml': Buffer.from('x') } });
    const r = await runBelegeAbruf({ dryRun: true, sheets, ftp, melde: async t => meldungen.push(t), jetzt: JETZT });
    expect(r.alarme).toHaveLength(1);
    expect(aufrufe.update).toEqual([]);
    expect(meldungen).toEqual([]);
  });

  test('FTP-Fehler: Zeile "Lauf/fehler", Chat erst beim 3. in Folge, danach "ok nach Fehlern"', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const melde = async t => { meldungen.push(t); return true; };
    const kaputt = ftpAttrappe({}, { fehler: new LShopFtpFehler('FTP: ETIMEDOUT') }).ftp;
    const r1 = await runBelegeAbruf({ sheets, ftp: kaputt, melde, jetzt: JETZT });
    expect(r1).toMatchObject({ ftp: 'fehler', grund: 'FTP: ETIMEDOUT', inFolge: 1, gemeldet: false });
    await runBelegeAbruf({ sheets, ftp: kaputt, melde, jetzt: JETZT });
    expect(meldungen).toEqual([]);
    const r3 = await runBelegeAbruf({ sheets, ftp: kaputt, melde, jetzt: JETZT });
    expect(r3).toMatchObject({ inFolge: 3, gemeldet: true });
    expect(meldungen).toHaveLength(1);
    await runBelegeAbruf({ sheets, ftp: kaputt, melde, jetzt: JETZT });   // gedrosselt
    expect(meldungen).toHaveLength(1);
    await runBelegeAbruf({ sheets, ftp: ftpAttrappe().ftp, melde, jetzt: JETZT });
    expect(zeilenAb(tabs).map(z => z.Ergebnis)).toEqual(['fehler', 'fehler', 'fehler (gemeldet)', 'fehler', 'ok nach Fehlern']);
    expect(zeilenAb(tabs).every(z => z.Art === ART.LAUF)).toBe(true);
  });

  test('andere Fehler (nicht FTP) bleiben Fehler; Reiter fehlt -> 409; Sperre -> 409', async () => {
    const { sheets } = aufbau();
    await expect(runBelegeAbruf({ sheets, ftp: async () => { throw new TypeError('kaputt'); }, melde: async () => true, jetzt: JETZT })).rejects.toThrow('kaputt');

    const leer = machSheets({ [EDI_TAB]: [EDI_SPALTEN] });
    await expect(runBelegeAbruf({ sheets: leer.sheets, ftp: ftpAttrappe().ftp, jetzt: JETZT })).rejects.toMatchObject({ status: 409 });

    let loslassen;
    const haengt = async fn => { await new Promise(r => { loslassen = r; }); return fn({ liste: async () => [], lade: async () => Buffer.alloc(0) }); };
    const erster = runBelegeAbruf({ sheets, ftp: haengt, melde: async () => true, jetzt: JETZT });
    await new Promise(r => setImmediate(r));
    await expect(runBelegeAbruf({ sheets, ftp: ftpAttrappe().ftp, jetzt: JETZT })).rejects.toMatchObject({ status: 409, message: BELEGE_BESCHAEFTIGT });
    loslassen();
    await erster;
  });

  test('Schreiben vor Melden: scheitert das Schreiben, geht kein Alarm raus', async () => {
    const { sheets } = aufbau();
    sheets.spreadsheets.values.update = async () => { throw new Error('Sheets weg'); };
    const meldungen = [];
    const { ftp } = ftpAttrappe({ [ORDNER.ORDER]: { 'fremd.xml': Buffer.from('x') } });
    await expect(runBelegeAbruf({ sheets, ftp, melde: async t => meldungen.push(t), jetzt: JETZT })).rejects.toThrow('Sheets weg');
    expect(meldungen).toEqual([]);
  });
});

describe('richteBelegeEin', () => {
  test('Trockenlauf schreibt nichts; --write legt Kopf an; vorhanden -> nicht angefasst', async () => {
    const tabs = {};
    const m = machSheets(tabs);
    m.sheets.spreadsheets.batchUpdate = async ({ requestBody }) => {
      const add = requestBody.requests.find(r => r.addSheet);
      if (add) { tabs[add.addSheet.properties.title] = []; return { data: { replies: [{ addSheet: { properties: { sheetId: 7 } } }] } }; }
      return { data: {} };
    };
    const t = await richteBelegeEin({ sheets: m.sheets });
    expect(t.log[0]).toMatch(/wuerde angelegt/);
    expect(tabs[BELEGE_TAB]).toBeUndefined();
    const w = await richteBelegeEin({ write: true, sheets: m.sheets });
    expect(w.log.at(-1)).toMatch(/✓ Reiter angelegt/);
    expect(tabs[BELEGE_TAB]).toEqual([BELEGE_SPALTEN]);
    const n = await richteBelegeEin({ write: true, sheets: m.sheets });
    expect(n.log[0]).toMatch(/vorhanden .* nicht angefasst/);
  });
});
