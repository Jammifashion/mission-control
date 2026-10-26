// BO4b-1/BO4b-2: Belege von L-Shop - Logik (utils/lshop-belege.js) und Abruf (lib/lshopBelege.js) gegen ein
// In-Memory-Sheet und eine FTP-Attrappe. Waechter ORDER/AB, Dekodierung nach BOM (UTF-16!), nur neue
// Dateien laden, Hash-Aenderung, Trockenlauf, Fehllaeufe (Chat ab 3 in Folge, 1/h), Schreiben vor Melden.
// BO4b-2: Lieferbestaetigung je Paket, Sendungen, Erstbestand still, EDI versandt, Archiv (Attrappe).
// Testdaten ohne echte Zugangsdaten, Adressen oder Kundennummern.

import {
  BELEGE_TAB, BELEGE_SPALTEN, ORDNER, ERGEBNIS, ART, dekodiere, findeOrderIds, orderIdAusDateiname, bewerteOrderDatei,
  bewerteAb, fehlerSerie, fehllaufMelden, eintragGeaendert, belegeSpalten, ftpZeit, orderLiegtZuLange, sha256,
  buildBelegeAlarmNachricht, buildFtpFehlerNachricht, SENDUNGEN_TAB, SENDUNGEN_SPALTEN, BelegFormatFehler,
  leseLieferbestaetigung, bewertePaket, archivJahr, mimeFuer, istErstbestandsDatei, MAX_NEUE_BELEGE_JE_LAUF,
} from '../utils/lshop-belege.js';
import { ArchivFehler, ArchivKonflikt } from '../lib/belegArchiv.js';
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

function aufbau({ belege = [], ediZeilen, sendungen = [], ohneSendungen = false } = {}) {
  const tabs = {
    [BELEGE_TAB]: [BELEGE_SPALTEN, ...belege],
    [EDI_TAB]: [EDI_SPALTEN, ...(ediZeilen ?? [['JFN-2026-0001', '2026-09-21', 'Testdatei'], ['JFN-2026-0002', '2026-10-22', 'Entwurf'], ['JFN-2026-0003', '2026-10-22', 'gesendet']])],
  };
  if (!ohneSendungen) tabs[SENDUNGEN_TAB] = [SENDUNGEN_SPALTEN, ...sendungen];
  return { tabs, ...machSheets(tabs) };
}

/** FTP-Attrappe: inhalt = { ORDNER: { datei: Buffer } }. */
function ftpAttrappe(inhalt = {}, { fehler } = {}) {
  const geladen = [];
  const ftp = async fn => {
    if (fehler) throw fehler;
    return fn({
      liste: async o => Object.entries(inhalt[o] ?? {}).map(([name, buf]) => datei(name, { size: buf.length })),
      lade: async (o, d, opt) => { geladen.push(`${o}/${d}${opt?.maxBytes ? `<=${opt.maxBytes}` : ''}`); return inhalt[o][d]; },
    });
  };
  return { ftp, geladen };
}

/** Archiv-Attrappe: merkt Ablagen; fehler(name) -> Error-Instanz oder null. */
function archivAttrappe({ fehler = () => null } = {}) {
  const abgelegt = [];
  const archiv = async a => {
    const e = fehler(a.name);
    if (e) throw e;
    abgelegt.push({ art: a.art, jahr: a.jahr, name: a.name, mime: a.mime, laenge: a.buf.length, dryRun: a.dryRun });
    return a.dryRun ? { status: 'wuerde angelegt', id: '' } : { status: 'neu', id: `drv-${a.name}` };
  };
  return { archiv, abgelegt };
}

const lauf = (o = {}) => runBelegeAbruf({ archiv: archivAttrappe().archiv, melde: async () => true, jetzt: JETZT, ...o });
const zeilenAb = tabs => tabs[BELEGE_TAB].slice(1).map(r => Object.fromEntries(BELEGE_SPALTEN.map((n, i) => [n, r[i] ?? ''])));
const sendungenAb = tabs => tabs[SENDUNGEN_TAB].slice(1).map(r => Object.fromEntries(SENDUNGEN_SPALTEN.map((n, i) => [n, r[i] ?? ''])));

// Lieferbestaetigung wie gemessen: UTF-16 LE mit BOM, Kopf "utf-8", je Paket ein dataset, CDATA, leere
// Felder mit einem Leerzeichen. Adressfelder mit Platzhaltern - sie duerfen nirgends ankommen.
const paket = ({ nr, va = 'VA00000001', la = 'LA00000001', kd = ' ', url } = {}) => `
<dataset>
<KundeDE><![CDATA[99999999]]></KundeDE>
<VorgangDE><![CDATA[${va} / ${la}]]></VorgangDE>
<KdBestellNrDE><![CDATA[${kd}]]></KdBestellNrDE>
<Paketnummer><![CDATA[${nr}]]></Paketnummer>
<Frachtfuehrer><![CDATA[DHL]]></Frachtfuehrer>
<Gewicht><![CDATA[5.54]]></Gewicht>
<Name1><![CDATA[Platzhalter Firma]]></Name1>
<Name2><![CDATA[Platzhalter Name]]></Name2>
<Zusatz><![CDATA[Platzhalter Zusatz]]></Zusatz>
<Plz><![CDATA[00000]]></Plz>
<Ort><![CDATA[Platzhalterort]]></Ort>
<MailDE><![CDATA[platzhalter@example.test]]></MailDE>
<Url><![CDATA[${url ?? `https://textilelogistics.eu/tracking/de/${nr}/00000/${va}`}]]></Url>
<INETNummer><![CDATA[1234567]]></INETNummer>
<Kommission><![CDATA[ ]]></Kommission>
</dataset>`;
const lb = (...pakete) => utf16(`<?xml version="1.0" encoding="utf-8"?>\r\n<root>${pakete.map(paket).join('')}\r\n</root>`);
const NR1 = '00340434000000000001', NR2 = '00340434000000000002', NR3 = '00340434000000000003';

beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; });

describe('runBelegeAbruf (BO4b-1)', () => {
  test('leerer FTP: nichts geschrieben, nichts gemeldet', async () => {
    const { sheets, aufrufe } = aufbau();
    const meldungen = [];
    const r = await lauf({ sheets, ftp: ftpAttrappe().ftp, melde: async t => meldungen.push(t) });
    expect(r).toMatchObject({ ftp: 'ok', neueZeilen: 0, alarme: [], sendungenNeu: 0 });
    expect(aufrufe.update).toEqual([]);
    expect(meldungen).toEqual([]);
  });

  test('fremde Datei in ORDER: eine Zeile, ein Alarm; zweiter Lauf meldet nicht noch einmal; ORDER wird nie geladen', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const { ftp, geladen } = ftpAttrappe({ [ORDNER.ORDER]: { 'bestellung.xml': Buffer.from('x') } });
    const r = await lauf({ sheets, ftp, melde: async t => { meldungen.push(t); return true; } });
    expect(r.alarme).toEqual([{ ordner: 'ORDER', datei: 'bestellung.xml', hinweis: expect.stringMatching(/nicht von MC/) }]);
    expect(zeilenAb(tabs)).toEqual([expect.objectContaining({ Ordner: 'ORDER', Datei: 'bestellung.xml', Art: ART.ORDER, Ergebnis: 'alarm', Hash: '', Drive_ID: '' })]);
    expect(meldungen).toHaveLength(1);
    expect(geladen).toEqual([]);

    const r2 = await lauf({ sheets, ftp, melde: async t => meldungen.push(t) });
    expect(r2.neueZeilen).toBe(0);
    expect(meldungen).toHaveLength(1);
  });

  test('AB zu Entwurf JFN-2026-0002 (UTF-16) -> Alarm; AB zu gesendeter order_id -> erkannt + Info; beide archiviert', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const a = archivAttrappe();
    const { ftp } = ftpAttrappe({ [ORDNER.AB]: {
      'AB_1.xml': utf16(ab('JFN-2026-0002')),
      'AB_2.xml': utf8bom(ab('JFN-2026-0003')),
    } });
    const r = await lauf({ sheets, ftp, archiv: a.archiv, melde: async t => { meldungen.push(t); return true; } });
    expect(r.alarme).toEqual([{ ordner: ORDNER.AB, datei: 'AB_1.xml', hinweis: 'JFN-2026-0002 ist nur "Entwurf"' }]);
    expect(r.abErkannt).toEqual([{ datei: 'AB_2.xml', orderIds: ['JFN-2026-0003'] }]);
    const z = zeilenAb(tabs);
    expect(z.map(x => [x.Datei, x.order_id, x.Ergebnis, x.Drive_ID])).toEqual([['AB_1.xml', 'JFN-2026-0002', 'alarm', 'drv-AB_1.xml'], ['AB_2.xml', 'JFN-2026-0003', 'erkannt', 'drv-AB_2.xml']]);
    expect(z[0].Hash).toBe(sha256(utf16(ab('JFN-2026-0002'))));
    expect(a.abgelegt.map(x => [x.art, x.name, x.mime])).toEqual([['Auftragsbestaetigung', 'AB_1.xml', 'application/xml'], ['Auftragsbestaetigung', 'AB_2.xml', 'application/xml']]);
    expect(meldungen).toHaveLength(2);
    expect(meldungen[0]).toMatch(/nicht von uns/);
    expect(meldungen[1]).toMatch(/Auftragsbestätigung eingegangen/);
  });

  test('protokollierte, unveraenderte AB wird nicht geladen; veraenderte (Hash) -> Alarm, nicht archiviert', async () => {
    const buf = utf8bom(ab('JFN-2026-0003'));
    const e = datei('AB_2.xml', { size: buf.length });
    const alt = BELEGE_SPALTEN.map(n => ({
      Ordner: ORDNER.AB, Datei: 'AB_2.xml', Groesse: String(buf.length), Hash: sha256(buf), Geaendert_FTP: ftpZeit(e),
      Gelesen: '2026-10-22T17:00:00.000Z', Art: ART.AB, order_id: 'JFN-2026-0003', Ergebnis: 'erkannt', Drive_ID: 'drv-alt',
    }[n] ?? ''));
    const { sheets } = aufbau({ belege: [alt] });
    const f = ftpAttrappe({ [ORDNER.AB]: { 'AB_2.xml': buf } });
    const r = await lauf({ sheets, ftp: f.ftp });
    expect(f.geladen).toEqual([]);
    expect(r.neueZeilen).toBe(0);

    const anders = utf8bom(ab('JFN-2026-0003') + ' ');
    const { tabs: t2, sheets: s2 } = aufbau({ belege: [alt] });
    const a = archivAttrappe();
    const r2 = await lauf({ sheets: s2, ftp: ftpAttrappe({ [ORDNER.AB]: { 'AB_2.xml': anders } }).ftp, archiv: a.archiv });
    expect(r2.alarme[0].hinweis).toMatch(/Datei verändert/);
    expect(zeilenAb(t2).at(-1)).toMatchObject({ Ergebnis: ERGEBNIS.VERAENDERT, Hash: sha256(anders) });
    expect(a.abgelegt).toEqual([]);
  });

  test('Trockenlauf: bewertet, Archiv nur pruefend, schreibt nichts, meldet nichts', async () => {
    const { sheets, aufrufe } = aufbau();
    const meldungen = [];
    const a = archivAttrappe();
    const { ftp } = ftpAttrappe({ [ORDNER.ORDER]: { 'fremd.xml': Buffer.from('x') }, [ORDNER.LB]: { 'DeliveryConfirmation_20261021204643.xml': lb({ nr: NR1 }) } });
    const r = await lauf({ dryRun: true, sheets, ftp, archiv: a.archiv, melde: async t => meldungen.push(t) });
    expect(r.alarme).toHaveLength(1);
    expect(r).toMatchObject({ sendungenNeu: 1, archiv: { wuerdeAngelegt: 1, neu: 0 } });
    expect(a.abgelegt[0].dryRun).toBe(true);
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.batchUpdate).toEqual([]);
    expect(meldungen).toEqual([]);
  });

  test('FTP-Fehler: Zeile "Lauf/fehler", Chat erst beim 3. in Folge, danach "ok nach Fehlern"', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const melde = async t => { meldungen.push(t); return true; };
    const kaputt = ftpAttrappe({}, { fehler: new LShopFtpFehler('FTP: ETIMEDOUT') }).ftp;
    const r1 = await lauf({ sheets, ftp: kaputt, melde });
    expect(r1).toMatchObject({ ftp: 'fehler', grund: 'FTP: ETIMEDOUT', inFolge: 1, gemeldet: false });
    await lauf({ sheets, ftp: kaputt, melde });
    expect(meldungen).toEqual([]);
    const r3 = await lauf({ sheets, ftp: kaputt, melde });
    expect(r3).toMatchObject({ inFolge: 3, gemeldet: true });
    expect(meldungen).toHaveLength(1);
    await lauf({ sheets, ftp: kaputt, melde });   // gedrosselt
    expect(meldungen).toHaveLength(1);
    await lauf({ sheets, ftp: ftpAttrappe().ftp, melde });
    expect(zeilenAb(tabs).map(z => z.Ergebnis)).toEqual(['fehler', 'fehler', 'fehler (gemeldet)', 'fehler', 'ok nach Fehlern']);
    expect(zeilenAb(tabs).every(z => z.Art === ART.LAUF)).toBe(true);
  });

  test('andere Fehler (nicht FTP) bleiben Fehler; Reiter fehlt -> 409; Sperre -> 409', async () => {
    const { sheets } = aufbau();
    await expect(lauf({ sheets, ftp: async () => { throw new TypeError('kaputt'); } })).rejects.toThrow('kaputt');

    const leer = machSheets({ [EDI_TAB]: [EDI_SPALTEN], [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN] });
    await expect(lauf({ sheets: leer.sheets, ftp: ftpAttrappe().ftp })).rejects.toMatchObject({ status: 409 });
    const ohneS = aufbau({ ohneSendungen: true });
    await expect(lauf({ sheets: ohneS.sheets, ftp: ftpAttrappe().ftp })).rejects.toThrow(/LShop_Sendungen" fehlt/);

    let loslassen;
    const haengt = async fn => { await new Promise(r => { loslassen = r; }); return fn({ liste: async () => [], lade: async () => Buffer.alloc(0) }); };
    const erster = lauf({ sheets, ftp: haengt });
    await new Promise(r => setImmediate(r));
    await expect(lauf({ sheets, ftp: ftpAttrappe().ftp })).rejects.toMatchObject({ status: 409, message: BELEGE_BESCHAEFTIGT });
    loslassen();
    await erster;
  });

  test('Schreiben vor Melden: scheitert das Schreiben, geht kein Alarm raus', async () => {
    const { sheets } = aufbau();
    sheets.spreadsheets.values.update = async () => { throw new Error('Sheets weg'); };
    const meldungen = [];
    const { ftp } = ftpAttrappe({ [ORDNER.ORDER]: { 'fremd.xml': Buffer.from('x') } });
    await expect(lauf({ sheets, ftp, melde: async t => meldungen.push(t) })).rejects.toThrow('Sheets weg');
    expect(meldungen).toEqual([]);
  });
});

// ── BO4b-2 ───────────────────────────────────────────────────────────────────

describe('leseLieferbestaetigung', () => {
  test('1, 2 und 3 Pakete; zwei VA in einer Datei; getrimmt; leere Felder; nur die benoetigten Felder', () => {
    expect(leseLieferbestaetigung(lb({ nr: NR1 }))).toHaveLength(1);
    const drei = leseLieferbestaetigung(lb({ nr: NR1 }, { nr: NR2, va: 'VA00000002', la: 'LA00000005' }, { nr: NR3 }));
    expect(drei.map(p => [p.paketnummer, p.va, p.la])).toEqual([[NR1, 'VA00000001', 'LA00000001'], [NR2, 'VA00000002', 'LA00000005'], [NR3, 'VA00000001', 'LA00000001']]);
    expect(drei[0]).toEqual({
      paketnummer: NR1, va: 'VA00000001', la: 'LA00000001', orderIdRoh: '', frachtfuehrer: 'DHL', gewicht: '5.54',
      url: `https://textilelogistics.eu/tracking/de/${NR1}/00000/VA00000001`, hinweise: [],
    });
    expect(Object.keys(drei[0])).not.toEqual(expect.arrayContaining(['name1', 'plz', 'mail', 'kunde']));
    expect(JSON.stringify(drei)).not.toMatch(/Platzhalter|platzhalter@|99999999|1234567/);
  });
  test('fremder Tracking-Link weggelassen (Hinweis); unlesbar -> BelegFormatFehler', () => {
    const [p] = leseLieferbestaetigung(lb({ nr: NR1, url: 'https://boese.example/x' }));
    expect(p).toMatchObject({ url: '', hinweise: ['Tracking-Link nicht freigegeben (https://boese.example) - weggelassen'] });   // BO4e: Host steht im Hinweis
    expect(() => leseLieferbestaetigung(utf16('<root></root>'))).toThrow(BelegFormatFehler);
    expect(() => leseLieferbestaetigung(utf16('<root><dataset><Paketnummer>x</Paketnummer></dataset></root>'))).toThrow(/Paketnummer/);
    expect(() => leseLieferbestaetigung(lb({ nr: NR1, va: 'XX1' }))).toThrow(/VorgangDE/);
  });
  test('Zuordnung: Portal, eigen, unbekannt, Entwurf, fremd', () => {
    const st = new Map([['JFN-2026-0002', 'Entwurf'], ['JFN-2026-0003', 'gesendet'], ['JFN-2026-0004', 'versandt']]);
    expect(bewertePaket({ orderIdRoh: '' }, st)).toEqual({ art: 'portal', orderId: '', hinweis: '' });
    expect(bewertePaket({ orderIdRoh: 'JFN-2026-0003' }, st).art).toBe('eigen');
    expect(bewertePaket({ orderIdRoh: 'JFN-2026-0004' }, st).art).toBe('eigen');
    expect(bewertePaket({ orderIdRoh: 'JFN-2026-0099' }, st)).toMatchObject({ art: 'alarm', hinweis: 'JFN-2026-0099 nicht in LShop_EDI_Dateien' });
    expect(bewertePaket({ orderIdRoh: 'JFN-2026-0002' }, st).hinweis).toBe('JFN-2026-0002 ist nur "Entwurf"');
    expect(bewertePaket({ orderIdRoh: 'PO-4711' }, st)).toMatchObject({ art: 'alarm', orderId: '' });
  });
  test('Archiv-Jahr aus dem Dateinamen, sonst FTP-Zeit Berlin; MIME', () => {
    expect(archivJahr('DeliveryConfirmation_20251231220000.xml', { modifiedAt: new Date('2026-09-22T08:25:00Z') })).toBe('2025');
    expect(archivJahr('rechnung.pdf', { modifiedAt: new Date('2026-12-31T23:30:00Z') })).toBe('2027');
    expect(mimeFuer('a.PDF')).toBe('application/pdf');
    expect(mimeFuer('a.xml')).toBe('application/xml');
  });
});

describe('runBelegeAbruf: Lieferbestaetigungen (BO4b-2)', () => {
  const LB1 = 'DeliveryConfirmation_20261021204643.xml';
  const LB2 = 'DeliveryConfirmation_20261023204000.xml';   // nach dem Stichtag des Erstbestands
  const lbZeile = (Datei = 'DeliveryConfirmation_20260824204025.xml') => BELEGE_SPALTEN.map(n => ({ Ordner: ORDNER.LB, Datei, Art: ART.LB, Ergebnis: 'portal', Gelesen: '2026-10-22T17:00:00Z' }[n] ?? ''));

  test('Erstbestand: Portal-Pakete still als Sendungen + Archiv, keine Adressfelder im Reiter', async () => {
    const { tabs, sheets } = aufbau();
    const meldungen = [];
    const a = archivAttrappe();
    const { ftp } = ftpAttrappe({ [ORDNER.LB]: { [LB1]: lb({ nr: NR1 }, { nr: NR2, va: 'VA00000002', la: 'LA00000002' }) } });
    const r = await lauf({ sheets, ftp, archiv: a.archiv, melde: async t => { meldungen.push(t); return true; } });
    expect(r).toMatchObject({ erstbestand: true, sendungenNeu: 2, archiv: { neu: 1 }, alarme: [] });
    expect(sendungenAb(tabs).map(s => [s.Paketnummer, s.VA, s.LA, s.order_id, s.Frachtfuehrer, s.Gewicht, s.Datei])).toEqual([
      [NR1, 'VA00000001', 'LA00000001', '', 'DHL', '5.54', LB1], [NR2, 'VA00000002', 'LA00000002', '', 'DHL', '5.54', LB1],
    ]);
    const alles = JSON.stringify(tabs);
    expect(alles).not.toMatch(/Platzhalter|platzhalter@|99999999|1234567/);
    expect(zeilenAb(tabs)).toEqual([expect.objectContaining({
      Ordner: ORDNER.LB, Datei: LB1, Art: ART.LB, Ergebnis: 'portal', VA: 'VA00000001 VA00000002', LA: 'LA00000001 LA00000002',
      Hinweis: '2 Pakete, 2 Portal', Drive_ID: `drv-${LB1}`,
    })]);
    expect(a.abgelegt[0]).toMatchObject({ art: 'Lieferbestaetigung', jahr: '2026', name: LB1 });
    expect(meldungen).toEqual([]);
  });

  test('Erstbestand bleibt still auch bei Alarm-Paketen; danach meldet eine eigene Lieferung (Info) und eine fremde (Alarm)', async () => {
    const { sheets } = aufbau();
    const meldungen = [];
    const melde = async t => { meldungen.push(t); return true; };
    await lauf({ sheets, ftp: ftpAttrappe({ [ORDNER.LB]: { [LB1]: lb({ nr: NR1, kd: 'JFN-2026-0099' }) } }).ftp, melde });
    expect(meldungen).toEqual([]);

    const r = await lauf({ sheets, melde, ftp: ftpAttrappe({ [ORDNER.LB]: {
      [LB1]: lb({ nr: NR1, kd: 'JFN-2026-0099' }),
      [LB2]: lb({ nr: NR2, kd: 'JFN-2026-0003' }, { nr: NR3, kd: 'JFN-2026-0003', la: 'LA00000002' }, { nr: '00340434000000000009', kd: 'JFN-2026-0002' }),
    } }).ftp });
    expect(r.erstbestand).toBe(false);
    expect(r.versandt).toEqual([{ orderId: 'JFN-2026-0003', datei: LB2, pakete: 2 }]);
    expect(r.ediVersandt).toEqual(['JFN-2026-0003']);
    expect(meldungen).toHaveLength(2);
    expect(meldungen[0]).toMatch(/Paket 00340434000000000009: JFN-2026-0002 ist nur "Entwurf"/);
    expect(meldungen[1]).toBe(`📦 L-Shop versandt: JFN-2026-0003 · 2 Pakete (DHL)\nTracking: https://textilelogistics.eu/tracking/de/${NR2}/00000/VA00000001 · https://textilelogistics.eu/tracking/de/${NR3}/00000/VA00000001`);
  });

  test('EDI-Status: gesendet -> versandt, nur die Status-Zelle; versandt bleibt, Entwurf nie', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ belege: [lbZeile()], ediZeilen: [['JFN-2026-0002', '', 'Entwurf'], ['JFN-2026-0003', '', 'gesendet'], ['JFN-2026-0004', '', 'versandt']] });
    await lauf({ sheets, ftp: ftpAttrappe({ [ORDNER.LB]: { [LB2]: lb({ nr: NR1, kd: 'JFN-2026-0003' }, { nr: NR2, kd: 'JFN-2026-0004' }, { nr: NR3, kd: 'JFN-2026-0002' }) } }).ftp });
    expect(tabs[EDI_TAB].slice(1).map(r => r[2])).toEqual(['Entwurf', 'versandt', 'versandt']);
    expect(aufrufe.batchUpdate).toEqual([`'${EDI_TAB}'!C3`]);
  });

  test('wiederholbar: vorhandene Paketnummer gleich -> keine zweite Zeile; anders -> Alarm, nicht ueberschrieben', async () => {
    const vorhanden = SENDUNGEN_SPALTEN.map(n => ({ Paketnummer: NR1, VA: 'VA00000001', LA: 'LA00000001', order_id: '', Frachtfuehrer: 'DHL', Tracking_URL: `https://textilelogistics.eu/tracking/de/${NR1}/00000/VA00000001` }[n] ?? ''));
    const anders = SENDUNGEN_SPALTEN.map(n => ({ Paketnummer: NR2, VA: 'VA00000077', LA: 'LA00000077' }[n] ?? ''));
    const { tabs, sheets } = aufbau({ belege: [lbZeile()], sendungen: [vorhanden, anders] });
    const r = await lauf({ sheets, ftp: ftpAttrappe({ [ORDNER.LB]: { [LB2]: lb({ nr: NR1 }, { nr: NR2 }) } }).ftp });
    expect(r.sendungenNeu).toBe(0);
    expect(sendungenAb(tabs)).toHaveLength(2);
    expect(sendungenAb(tabs)[1].VA).toBe('VA00000077');
    expect(r.alarme).toEqual([{ ordner: ORDNER.LB, datei: LB2, hinweis: `Paket ${NR2} schon gespeichert mit anderem Inhalt - nicht überschrieben` }]);
  });

  test('Archiv-Fehler: Datei nicht verarbeitet (keine Zeile, keine Sendung), Lauf "fehler"; naechster Lauf holt nach', async () => {
    const { tabs, sheets } = aufbau({ belege: [lbZeile()] });
    const kaputt = archivAttrappe({ fehler: () => new ArchivFehler('Drive 503: weg') });
    const inhalt = { [ORDNER.LB]: { [LB2]: lb({ nr: NR1 }) }, [ORDNER.RE_XML]: { 'RE_1.xml': Buffer.from('<r/>') } };
    const meldungen = [];
    const melde = async t => { meldungen.push(t); return true; };
    const r = await lauf({ sheets, ftp: ftpAttrappe(inhalt).ftp, archiv: kaputt.archiv, melde });
    expect(r.archiv.fehler).toBe(2);
    expect(sendungenAb(tabs)).toEqual([]);
    expect(zeilenAb(tabs).slice(1).map(z => [z.Art, z.Ergebnis])).toEqual([[ART.LAUF, 'fehler']]);
    expect(zeilenAb(tabs).at(-1).Hinweis).toMatch(/^Archiv: 2 Datei\(en\) nicht archiviert/);
    expect(meldungen).toEqual([]);
    await lauf({ sheets, ftp: ftpAttrappe(inhalt).ftp, archiv: kaputt.archiv, melde });
    await lauf({ sheets, ftp: ftpAttrappe(inhalt).ftp, archiv: kaputt.archiv, melde });
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toMatch(/kommen nicht an · 3 Läufe in Folge/);

    const r2 = await lauf({ sheets, ftp: ftpAttrappe(inhalt).ftp });
    expect(r2.archiv.neu).toBe(2);
    expect(sendungenAb(tabs).map(s => s.Paketnummer)).toEqual([NR1]);
    expect(zeilenAb(tabs).slice(-3).map(z => [z.Datei, z.Ergebnis])).toEqual([[LB2, 'portal'], ['RE_1.xml', 'archiviert'], ['', 'ok nach Fehlern']]);
  });

  test('Archiv-Konflikt (gleicher Name, anderer Inhalt): Alarm, Datei verarbeitet ohne Drive_ID', async () => {
    const { tabs, sheets } = aufbau({ belege: [lbZeile()] });
    const a = archivAttrappe({ fehler: () => new ArchivKonflikt('Lieferbestaetigung/2026/x liegt im Archiv mit anderem Inhalt - nichts überschrieben') });
    const meldungen = [];
    const r = await lauf({ sheets, ftp: ftpAttrappe({ [ORDNER.LB]: { [LB2]: lb({ nr: NR1 }) } }).ftp, archiv: a.archiv, melde: async t => { meldungen.push(t); return true; } });
    expect(r.archiv.konflikt).toBe(1);
    expect(zeilenAb(tabs).at(-1)).toMatchObject({ Datei: LB2, Ergebnis: 'alarm', Drive_ID: '', Hinweis: expect.stringMatching(/Archiv: .*anderem Inhalt/) });
    expect(meldungen[0]).toMatch(/anderem Inhalt/);
  });

  test('unlesbare Lieferbestaetigung: Alarm, archiviert, keine Sendung', async () => {
    const { tabs, sheets } = aufbau({ belege: [lbZeile()] });
    const r = await lauf({ sheets, ftp: ftpAttrappe({ [ORDNER.LB]: { [LB2]: utf16('<root/>') } }).ftp });
    expect(r.alarme[0].hinweis).toMatch(/unlesbar: keine Pakete/);
    expect(zeilenAb(tabs).at(-1)).toMatchObject({ Ergebnis: 'alarm', Drive_ID: `drv-${LB2}` });
    expect(sendungenAb(tabs)).toEqual([]);
  });

  test('Erstbestand ueber den Stichtag: alte Datei bleibt still, auch wenn das Protokoll schon Lieferbestaetigungen hat', async () => {
    expect(istErstbestandsDatei('DeliveryConfirmation_20261022235959.xml')).toBe(true);
    expect(istErstbestandsDatei('DeliveryConfirmation_20261023000000.xml')).toBe(false);
    expect(istErstbestandsDatei('rechnung.xml')).toBe(false);
    const { sheets } = aufbau({ belege: [lbZeile()] });
    const meldungen = [];
    const r = await lauf({ sheets, melde: async t => { meldungen.push(t); return true; }, ftp: ftpAttrappe({ [ORDNER.LB]: {
      'DeliveryConfirmation_20261020204000.xml': lb({ nr: NR1, kd: 'JFN-2026-0099' }),
    } }).ftp });
    expect(r.erstbestand).toBe(false);
    expect(r.alarme).toHaveLength(1);
    expect(meldungen).toEqual([]);
  });

  test('hoechstens 15 neue Belege je Lauf, der Rest im naechsten', async () => {
    const { sheets } = aufbau();
    const name = i => `DeliveryConfirmation_202610${String(i + 1).padStart(2, '0')}204000.xml`;
    const inhalt = { [ORDNER.LB]: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [name(i), lb({ nr: `0034043400000000${String(i).padStart(4, '0')}` })])) };
    const r1 = await lauf({ sheets, ftp: ftpAttrappe(inhalt).ftp });
    expect(MAX_NEUE_BELEGE_JE_LAUF).toBe(15);
    expect(r1).toMatchObject({ offen: 5, sendungenNeu: 15 });
    const f = ftpAttrappe(inhalt);
    const r2 = await lauf({ sheets, ftp: f.ftp });
    expect(r2).toMatchObject({ offen: 0, sendungenNeu: 5 });
    expect(f.geladen).toHaveLength(5);
  });

  test('Rechnung XML/PDF: nur archiviert (PDF bis 10 MB), keine Auswertung', async () => {
    const { tabs, sheets } = aufbau();
    const a = archivAttrappe();
    const f = ftpAttrappe({ [ORDNER.RE_XML]: { 'R_20261023.xml': Buffer.from('<r/>') }, [ORDNER.RE_PDF]: { 'R_20261023.pdf': Buffer.from('%PDF') } });
    await lauf({ sheets, ftp: f.ftp, archiv: a.archiv });
    expect(f.geladen).toEqual(['INVOICE/XML/R_20261023.xml', `INVOICE/PDF/R_20261023.pdf<=${10 * 1024 * 1024}`]);
    expect(a.abgelegt.map(x => [x.art, x.mime])).toEqual([['Rechnung_XML', 'application/xml'], ['Rechnung_PDF', 'application/pdf']]);
    expect(zeilenAb(tabs).map(z => [z.Art, z.Ergebnis])).toEqual([[ART.RE, 'archiviert'], [ART.RE, 'archiviert']]);
  });
});

describe('richteBelegeEin', () => {
  test('Trockenlauf schreibt nichts; --write legt beide Reiter an; alter Kopf bekommt Drive_ID; vorhanden -> nicht angefasst', async () => {
    const tabs = {};
    const m = machSheets(tabs);
    const struktur = [];
    m.sheets.spreadsheets.batchUpdate = async ({ requestBody }) => {
      struktur.push(requestBody.requests);
      const add = requestBody.requests.find(r => r.addSheet);
      if (add) { tabs[add.addSheet.properties.title] = []; return { data: { replies: [{ addSheet: { properties: { sheetId: 7 } } }] } }; }
      return { data: {} };
    };
    const archivEinrichten = async ({ write }) => [`Drive ${write ? 'angelegt' : 'wuerde angelegt'}`];
    const t = await richteBelegeEin({ sheets: m.sheets, archivEinrichten });
    expect(t.log.join('\n')).toMatch(/LShop_Belege" fehlt -> wuerde angelegt[\s\S]*LShop_Sendungen" fehlt -> wuerde angelegt[\s\S]*Drive wuerde angelegt/);
    expect(Object.keys(tabs)).toEqual([]);
    await richteBelegeEin({ write: true, sheets: m.sheets, archivEinrichten });
    expect(tabs[BELEGE_TAB]).toEqual([BELEGE_SPALTEN]);
    expect(tabs[SENDUNGEN_TAB]).toEqual([SENDUNGEN_SPALTEN]);
    expect(JSON.stringify(struktur)).toMatch(/"type":"TEXT"/);
    const n = await richteBelegeEin({ write: true, sheets: m.sheets, archivEinrichten });
    expect(n.log.slice(0, 2)).toEqual([`Reiter "${BELEGE_TAB}" vorhanden, Kopf vollständig - nicht angefasst.`, `Reiter "${SENDUNGEN_TAB}" vorhanden, Kopf vollständig - nicht angefasst.`]);

    const alt = { [BELEGE_TAB]: [BELEGE_SPALTEN.slice(0, -1), ['ORDER', 'x.xml']], [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN] };
    const m2 = machSheets(alt);
    const verbreitert = [];
    const getAlt = m2.sheets.spreadsheets.get;
    m2.sheets.spreadsheets.get = async o => { const r = await getAlt(o); r.data.sheets.forEach(x => { x.properties.gridProperties.columnCount = x.properties.title === BELEGE_TAB ? 13 : 11; }); return r; };
    m2.sheets.spreadsheets.batchUpdate = async ({ requestBody }) => { verbreitert.push(...requestBody.requests); return { data: {} }; };
    const r = await richteBelegeEin({ write: true, sheets: m2.sheets, archivEinrichten });
    expect(r.log.slice(0, 2)).toEqual([`Reiter "${BELEGE_TAB}": Spalte Drive_ID fehlt -> anhaengen (N1).`, '✓ Drive_ID angehaengt und zurueckgelesen.']);
    expect(alt[BELEGE_TAB][0].at(-1)).toBe('Drive_ID');
    expect(alt[BELEGE_TAB][1]).toEqual(['ORDER', 'x.xml']);
    expect(verbreitert).toEqual([{ appendDimension: { sheetId: 0, dimension: 'COLUMNS', length: 1 } }]);
  });
});
