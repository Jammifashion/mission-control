// BO4c: EDI-Datei per Knopf an L-Shop senden. ALLES gegen nachgebaute FTP-Clients und ein In-Memory-Sheet -
// nie gegen den echten Server. Zugangsdaten, Preise und Staffel-Betraege sind erfunden.
//  - lib/lshopFtpSenden.js: nur ORDER, Namensmuster, Groesse, kein Ueberschreiben, genau ein Upload,
//    "nicht-da" NUR vor Beginn der Uebertragung (Aenderung A), Fehler ohne Zugangsdaten, Quelltext-Regeln
//  - lib/lshopEdi.js ediSenden/ediSendenVorschau/ediZurueckAufEntwurf: Ablauf und alle Fehlerfaelle
//  - Staffel/Netto (Backend und Browser-Block), Waechter (eigen, Abgeholt, zu lange, haengend = Aenderung B)

import { jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sendeBestellung, SENDE_ERGEBNIS, MAX_BESTELL_BYTES } from '../lib/lshopFtpSenden.js';
import { _secretCacheLeeren } from '../utils/secrets.js';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import {
  EDI_TAB, EDI_SPALTEN, EDI_STATUS, versandstaffel, staffelStand, nettoSummen, euro, entwuerfeAus, gesendetPlan,
  sendbarkeit, ediSpalten, HAENGT_MIN, buildGesendetNachricht, buildSendenAlarmNachricht,
} from '../utils/edi-bestellung.js';
import { ediErzeugen, ediSenden, ediSendenVorschau, ediZurueckAufEntwurf, ediAlsGesendet, _customerIdCacheLeeren } from '../lib/lshopEdi.js';
import { runBelegeAbruf, _belegeSperreLoesen } from '../lib/lshopBelege.js';
import { BELEGE_TAB, BELEGE_SPALTEN, SENDUNGEN_TAB, SENDUNGEN_SPALTEN, bewerteOrderDatei, abgeholtPlan, haengendPlan, ORDNER, MERKER_ZU_LANGE, MERKER_HAENGT } from '../utils/lshop-belege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, NR, NR2 } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const backend = resolve(hier, '..');
const HOST = 'ftp.beispiel.test', USER = 'nutzer-x', PASS = 'pw-geheim-123';
const NAME = 'JFN-2026-0002_20261022-1000.xml';
const INHALT = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<order/>\n');

// ── FTP-Attrappe: STOR liest die Quelle erst nach "150" (wie basic-ftp), Ablauf per Optionen steuerbar ──
function ftpClient({ vorher = [], accessFehler, listeFehler, listeFehlerNach, stor = 'ok', danach } = {}) {
  const c = { aufrufe: [], closed: 0, hochgeladen: [], listen: 0 };
  c.access = async o => { c.aufrufe.push('access'); if (accessFehler) throw accessFehler; };
  c.list = async p => {
    c.aufrufe.push(`list ${p}`);
    c.listen++;
    if (listeFehler || (listeFehlerNach && c.listen > 1)) throw listeFehler ?? listeFehlerNach;
    if (c.listen === 1) return vorher.map(e => ({ isFile: true, ...e }));
    return (danach ?? [...vorher, ...c.hochgeladen]).map(e => ({ isFile: true, ...e }));
  };
  c.uploadFrom = async (quelle, pfad) => {
    c.aufrufe.push(`uploadFrom ${pfad}`);
    if (stor === 'abgelehnt') { const e = new Error('553 Could not create file.'); e.code = 553; throw e; }
    if (stor === 'keine-antwort') { const e = new Error('Timeout (control socket)'); throw e; }
    const teile = [];
    for await (const t of quelle) teile.push(t);     // "150": jetzt fliessen Daten
    const buf = Buffer.concat(teile);
    if (stor === 'abbruch') { const e = new Error(`read ECONNRESET ${HOST} 10.0.0.7:21`); e.code = 'ECONNRESET'; throw e; }
    if (stor === 'halb') { c.hochgeladen.push({ name: pfad.split('/').pop(), size: Math.floor(buf.length / 2) }); return { code: 226 }; }
    if (stor === 'ohne-226') return { code: 150 };
    c.hochgeladen.push({ name: pfad.split('/').pop(), size: buf.length });
    return { code: 226, message: 'Transfer complete' };
  };
  c.close = () => { c.closed++; };
  // Absichtlich vorhanden, darf nie aufgerufen werden:
  for (const n of ['remove', 'rename', 'ensureDir', 'removeDir', 'send']) c[n] = () => { throw new Error(`${n} aufgerufen`); };
  return c;
}
const senden = (c, o = {}) => sendeBestellung({ dateiname: NAME, inhalt: INHALT, clientFabrik: () => c, ...o });

beforeEach(() => {
  _secretCacheLeeren();
  process.env.LSHOP_FTP_HOST = HOST;
  process.env.LSHOP_EDI_FTP_USER = USER;
  process.env.LSHOP_EDI_FTP_PASS = PASS;
});

describe('sendeBestellung (lib/lshopFtpSenden.js)', () => {
  test('liegt: listen, EIN Upload nach /ORDER/<name>, neu listen, Groesse stimmt, schliesst', async () => {
    const c = ftpClient();
    expect(await senden(c)).toEqual({ ergebnis: SENDE_ERGEBNIS.LIEGT, groesse: INHALT.length, hinweis: '' });
    expect(c.aufrufe).toEqual(['access', 'list /ORDER/', `uploadFrom /ORDER/${NAME}`, 'list /ORDER/']);
    expect(c.hochgeladen).toEqual([{ name: NAME, size: INHALT.length }]);
    expect(c.closed).toBe(1);
  });

  test('226, aber Datei schon weg -> abgeholt ("sofort abgeholt")', async () => {
    expect(await senden(ftpClient({ danach: [] }))).toMatchObject({ ergebnis: SENDE_ERGEBNIS.ABGEHOLT, hinweis: 'sofort abgeholt' });
  });

  test('nicht-da NUR vor Beginn der Uebertragung: Anmeldung, erste Liste, Server lehnt STOR ab', async () => {
    const f = Object.assign(new Error(`connect ECONNREFUSED ${HOST}`), { code: 'ECONNREFUSED' });
    for (const c of [ftpClient({ accessFehler: f }), ftpClient({ listeFehler: new Error('530 Login incorrect') }), ftpClient({ stor: 'abgelehnt' })]) {
      const r = await senden(c);
      expect(r.ergebnis).toBe(SENDE_ERGEBNIS.NICHT_DA);
      expect(c.hochgeladen).toEqual([]);
      expect(c.closed).toBe(1);
    }
  });

  test('unklar ab Beginn der Uebertragung - auch wenn die Datei danach nicht in der Liste steht (Aenderung A)', async () => {
    const abbruch = ftpClient({ stor: 'abbruch', danach: [] });
    expect(await senden(abbruch)).toMatchObject({ ergebnis: SENDE_ERGEBNIS.UNKLAR, hinweis: expect.stringMatching(/Abbruch während der Übertragung/) });
    expect(abbruch.aufrufe.filter(a => a.startsWith('uploadFrom'))).toHaveLength(1);   // kein zweiter Versuch
    // Keine Antwort auf STOR (Zeitlimit, kein Fehlercode) - Server koennte schon schreiben -> unklar
    expect((await senden(ftpClient({ stor: 'keine-antwort' }))).ergebnis).toBe(SENDE_ERGEBNIS.UNKLAR);
    expect((await senden(ftpClient({ stor: 'ohne-226' }))).ergebnis).toBe(SENDE_ERGEBNIS.UNKLAR);
    expect((await senden(ftpClient({ stor: 'halb' }))).ergebnis).toBe(SENDE_ERGEBNIS.UNKLAR);           // Groesse falsch
    expect((await senden(ftpClient({ listeFehlerNach: new Error('ETIMEDOUT') }))).ergebnis).toBe(SENDE_ERGEBNIS.UNKLAR);
  });

  test('kein Ueberschreiben: gleicher Name oder dieselbe order_id liegt schon -> unklar, kein Upload', async () => {
    for (const da of [NAME, 'JFN-2026-0002_20261021-0900.xml']) {
      const c = ftpClient({ vorher: [{ name: da, size: 10 }] });
      expect(await senden(c)).toMatchObject({ ergebnis: SENDE_ERGEBNIS.UNKLAR, hinweis: expect.stringContaining(da) });
      expect(c.aufrufe.some(a => a.startsWith('uploadFrom'))).toBe(false);
    }
    const anders = ftpClient({ vorher: [{ name: 'JFN-2026-0009_20261021-0900.xml', size: 10 }] });
    expect((await senden(anders)).ergebnis).toBe(SENDE_ERGEBNIS.LIEGT);
  });

  test('nur Namensmuster, nur Inhalt bis 1 MB - sonst Fehler vor jeder Verbindung', async () => {
    const c = ftpClient();
    for (const dateiname of ['../x.xml', 'ORDER/JFN-2026-0002_20261022-1000.xml', 'JFN-2026-0002.xml', 'JFN-2026-0002_20261022-1000.tmp']) {
      await expect(senden(c, { dateiname })).rejects.toThrow(/Dateiname/);
    }
    await expect(senden(c, { inhalt: Buffer.alloc(MAX_BESTELL_BYTES + 1, 'x') })).rejects.toThrow(/größer/);
    await expect(senden(c, { inhalt: Buffer.alloc(0) })).rejects.toThrow(/leer/);
    expect(c.aufrufe).toEqual([]);
  });

  test('Hinweise ohne Host, IP, Benutzer, Passwort', async () => {
    const f = Object.assign(new Error(`connect ECONNREFUSED 10.1.2.3:21 ${HOST} user ${USER} pass ${PASS}`), { code: 'ECONNREFUSED' });
    const hinweise = [
      (await senden(ftpClient({ accessFehler: f }))).hinweis,
      (await senden(ftpClient({ stor: 'abbruch' }))).hinweis,
    ].join(' | ');
    for (const g of [HOST, USER, PASS, '10.1.2.3', '10.0.0.7']) expect(hinweise).not.toContain(g);
  });

  test('ohne Zugang -> nicht-da, kein Client', async () => {
    process.env.LSHOP_EDI_FTP_PASS = '';
    _secretCacheLeeren();
    const c = ftpClient();
    expect((await senden(c)).ergebnis).toBe(SENDE_ERGEBNIS.NICHT_DA);
    expect(c.aufrufe).toEqual([]);
  });
});

describe('Quelltext-Regeln beider FTP-Module', () => {
  const ohneKommentar = f => readFileSync(join(backend, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  test('Sende-Modul ruft am Client nur access, list, uploadFrom, close', () => {
    const code = ohneKommentar('lib/lshopFtpSenden.js');
    expect([...new Set([...code.matchAll(/client\.(\w+)/g)].map(m => m[1]))].sort()).toEqual(['access', 'close', 'list', 'uploadFrom']);
    for (const verboten of ['remove', 'rename', 'ensureDir', 'removeDir', 'clearWorkingDir', 'appendFrom', '.send(', 'DELE', 'RNFR', 'MKD']) expect(code).not.toContain(verboten);
  });
  test('uploadFrom steht nur im Sende-Modul (ganzes Backend)', () => {
    const treffer = [];
    const lauf = dir => {
      for (const n of readdirSync(dir)) {
        if (['node_modules', 'tests', '.git'].includes(n)) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) lauf(p);
        else if (/\.(c|m)?js$/.test(n) && /uploadFrom\s*\(/.test(ohneKommentar(p.slice(backend.length + 1)))) treffer.push(n);
      }
    };
    lauf(backend);
    expect(treffer).toEqual(['lshopFtpSenden.js']);
  });
});

// ═══ Ablauf (lib/lshopEdi.js) gegen ein In-Memory-Sheet ═══════════════════════
const JETZT = () => new Date('2026-10-22T08:00:00Z');   // 10:00 Berlin
const UM = iso => () => new Date(iso);
const CONFIG_KOPF = ['Schlüssel', 'Wert', 'Anbieter', 'Beschreibung', 'Geändert-Am'];
const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'offen', Menge: '1', LShop_ArticleNr: NR, ...o }[s] ?? ''));
const EK1 = '12,34', EK2 = '5,5';   // erfundene Preise

function aufbau({ staffel = [['lshop.versandstufe.1.ab', '50'], ['lshop.versandstufe.1.kosten', '7'], ['lshop.versandstufe.2.ab', '100'], ['lshop.versandstufe.2.kosten', '0']] } = {}) {
  const tabs = grundTabs();
  tabs.LShop_Modelle[0].push('10CartonsPrice');
  tabs.LShop_Modelle.forEach((z, i) => { if (i) z.push(z[0] === NR ? EK1 : z[0] === NR2 ? EK2 : ''); });
  tabs[TAB_KORB].push(
    korbZeile({ Schluessel: 'JFN:10001:1', Bestellnummer: '10001', Position: '1' }),
    korbZeile({ Schluessel: 'JFN:10002:7', Bestellnummer: '10002', Position: '7', LShop_ArticleNr: NR2, Menge: '3' }),
  );
  tabs.Config = [CONFIG_KOPF, ['lshop.customer_id', '00000000', '', '', ''], ...staffel.map(([k, w]) => [k, w, '', '', ''])];
  tabs[EDI_TAB] = [EDI_SPALTEN, ['JFN-2026-0001', '2026-09-21', 'Testdatei']];
  const m = machSheets(tabs);
  // values.batchUpdate je Aufruf merken (machSheets sammelt nur die Bereiche)
  const aufrufe = [];
  const bu = m.sheets.spreadsheets.values.batchUpdate;
  m.sheets.spreadsheets.values.batchUpdate = async a => { aufrufe.push(a.requestBody.data.map(d => d.range)); return bu(a); };
  return { tabs, sheets: m.sheets, batch: aufrufe, ...m };
}
const auswahl = tabs => tabs[TAB_KORB].slice(1).map(r => ({ schluessel: r[0], status: 'offen' }));
async function mitEntwurf(o = {}) {
  const a = aufbau(o);
  await ediErzeugen({ auswahl: auswahl(a.tabs), versandart: o.versandart ?? 'DHL', sheets: a.sheets, jetzt: o.erzeugt ?? JETZT });
  a.batch.length = 0;
  return a;
}
const ediWert = (tabs, n, zeile = 2) => tabs[EDI_TAB][zeile][EDI_SPALTEN.indexOf(n)] ?? '';
const korbWert = (tabs, n, zeile) => tabs[TAB_KORB][zeile][KORB_SPALTEN.indexOf(n)] ?? '';
const fakes = (ergebnis = { ergebnis: SENDE_ERGEBNIS.LIEGT, groesse: 1, hinweis: '' }) => ({
  senden: jest.fn(async () => ergebnis),
  archiv: jest.fn(async () => ({ status: 'neu', id: 'drive-1' })),
  melde: jest.fn(async () => true),
});
const col = n => String.fromCharCode(65 + EDI_SPALTEN.indexOf(n));
const kcol = n => String.fromCharCode(65 + KORB_SPALTEN.indexOf(n));

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot';
  process.env.BUSINESS_SHEET_ID = 'ssot';
  _resetLShopCache();
  _customerIdCacheLeeren();
});

describe('ediSenden', () => {
  test('Erfolg: "wird gesendet", EIN Upload, dann EIN batchUpdate Status+Korb (genau diese Zellen), Archiv, Chat ohne Preise', async () => {
    const { tabs, sheets, batch } = await mitEntwurf();
    const f = fakes();
    const r = await ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') });
    expect(r).toMatchObject({ ok: true, orderId: 'JFN-2026-0002', positionen: 2, stueck: 4, versandart: 'DHL', ergebnis: 'liegt', dateiname: 'JFN-2026-0002_20261022-1100.xml' });
    expect(f.senden).toHaveBeenCalledTimes(1);
    const { dateiname, inhalt } = f.senden.mock.calls[0][0];
    const xml = inhalt.toString('utf8');
    expect(dateiname).toBe('JFN-2026-0002_20261022-1100.xml');
    expect(xml).toContain('<order_date>22.10.2026</order_date>');   // Sendetag
    expect(xml).toContain('<shipping_method>DHL</shipping_method>');
    for (const preis of ['12,34', '12.34', '5,5', '5.5', '€']) expect(xml).not.toContain(preis);
    expect(batch).toEqual([
      [`'${EDI_TAB}'!${col('Status')}3`, `'${EDI_TAB}'!${col('Sendeversuch')}3`, `'${EDI_TAB}'!${col('Sende_Hinweis')}3`],
      [`'${EDI_TAB}'!${col('Status')}3`, `'${EDI_TAB}'!${col('Gesendet')}3`, `'${EDI_TAB}'!${col('Dateiname')}3`, `'${EDI_TAB}'!${col('Sende_Hinweis')}3`,
        ...[2, 3].flatMap(z => ['Status', 'Bestell_ID', 'Status_Datum', 'Stand'].map(n => `'${TAB_KORB}'!${kcol(n)}${z}`))],
      [`'${EDI_TAB}'!${col('Drive_ID')}3`],
    ]);
    expect([ediWert(tabs, 'Status'), ediWert(tabs, 'Gesendet'), ediWert(tabs, 'Dateiname'), ediWert(tabs, 'Drive_ID'), ediWert(tabs, 'Abgeholt')])
      .toEqual(['gesendet', '2026-10-22T09:00:00.000Z', 'JFN-2026-0002_20261022-1100.xml', 'drive-1', '']);
    expect([korbWert(tabs, 'Status', 1), korbWert(tabs, 'Bestell_ID', 2)]).toEqual(['bestellt', 'JFN-2026-0002']);
    expect(f.archiv).toHaveBeenCalledWith(expect.objectContaining({ art: 'Bestellung', jahr: '2026', name: dateiname, mime: 'application/xml' }));
    expect(f.archiv.mock.calls[0][0].buf.equals(inhalt)).toBe(true);   // unveraendert archiviert
    expect(f.melde).toHaveBeenCalledTimes(1);
    const chat = f.melde.mock.calls[0][0];
    expect(chat).toBe('📤 L-Shop gesendet: JFN-2026-0002 · 2 Pos. / 4 Stk · DHL');
  });

  test('abgeholt: gilt als gesendet, Sende_Hinweis "sofort abgeholt", Abgeholt = jetzt', async () => {
    const { tabs, sheets } = await mitEntwurf();
    const f = fakes({ ergebnis: SENDE_ERGEBNIS.ABGEHOLT, hinweis: 'sofort abgeholt' });
    await ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') });
    expect([ediWert(tabs, 'Status'), ediWert(tabs, 'Sende_Hinweis'), ediWert(tabs, 'Abgeholt')]).toEqual(['gesendet', 'sofort abgeholt', '2026-10-22T09:00:00.000Z']);
    expect(f.melde.mock.calls[0][0]).toMatch(/sofort abgeholt/);
  });

  test('nicht-da: zurueck auf Entwurf, 502, Korb unveraendert, kein Chat', async () => {
    const { tabs, sheets } = await mitEntwurf();
    const korb = JSON.stringify(tabs[TAB_KORB]);
    const f = fakes({ ergebnis: SENDE_ERGEBNIS.NICHT_DA, hinweis: 'Anmeldung: ECONNREFUSED' });
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') }))
      .rejects.toMatchObject({ status: 502, ergebnis: 'nicht-da' });
    expect(ediWert(tabs, 'Status')).toBe('Entwurf');
    expect(ediWert(tabs, 'Sende_Hinweis')).toMatch(/nicht gesendet .*ECONNREFUSED/);
    expect(JSON.stringify(tabs[TAB_KORB])).toBe(korb);
    expect(f.melde).not.toHaveBeenCalled();
    expect(f.archiv).not.toHaveBeenCalled();
  });

  test('unklar: Status unklar, Alarm, 502 "Nicht nochmal senden"; danach kein zweiter Upload moeglich', async () => {
    const { tabs, sheets } = await mitEntwurf();
    const f = fakes({ ergebnis: SENDE_ERGEBNIS.UNKLAR, hinweis: 'Abbruch während der Übertragung: ECONNRESET' });
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') }))
      .rejects.toMatchObject({ status: 502, ergebnis: 'unklar', message: expect.stringMatching(/Nicht nochmal senden/) });
    expect([ediWert(tabs, 'Status'), ediWert(tabs, 'Sende_Hinweis')]).toEqual(['unklar', 'Abbruch während der Übertragung: ECONNRESET']);
    expect(korbWert(tabs, 'Status', 1)).toBe('offen');
    expect(f.melde).toHaveBeenCalledTimes(1);
    expect(f.melde.mock.calls[0][0]).toMatch(/unklar, ob JFN-2026-0002 angekommen ist[\s\S]*Nicht nochmal senden/);
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:05:00Z') })).rejects.toMatchObject({ status: 409 });
    expect(f.senden).toHaveBeenCalledTimes(1);
  });

  test('Modul wirft unerwartet -> unklar (nie wiederholt)', async () => {
    const { tabs, sheets } = await mitEntwurf();
    const f = fakes();
    f.senden.mockRejectedValueOnce(new Error('kaputt'));
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') })).rejects.toMatchObject({ ergebnis: 'unklar' });
    expect(ediWert(tabs, 'Status')).toBe('unklar');
    expect(f.senden).toHaveBeenCalledTimes(1);
  });

  test('Datei liegt, Sheet-Schreiben scheitert -> Alarm mit order_id, 500, Status bleibt "wird gesendet"', async () => {
    const a = await mitEntwurf();
    const f = fakes();
    const bu = a.sheets.spreadsheets.values.batchUpdate;
    let n = 0;
    a.sheets.spreadsheets.values.batchUpdate = async x => { if (++n === 2) throw new Error('Quota exceeded'); return bu(x); };
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets: a.sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') }))
      .rejects.toMatchObject({ status: 500, ergebnis: 'sheet' });
    expect(ediWert(a.tabs, 'Status')).toBe('wird gesendet');
    expect(f.melde.mock.calls[0][0]).toMatch(/JFN-2026-0002 ist bei L-Shop, aber Status\/Korb nicht geschrieben/);
    // Waechter: "wird gesendet" ist eigen
    expect(bewerteOrderDatei({ name: 'JFN-2026-0002_20261022-1100.xml' }, new Map([['JFN-2026-0002', 'wird gesendet']]), new Date()).ergebnis).toBe('eigen');
  });

  test('Archiv scheitert: Bestellung bleibt gesendet, Hinweis im Chat und in der Antwort', async () => {
    const { tabs, sheets } = await mitEntwurf();
    const f = fakes();
    f.archiv.mockRejectedValueOnce(new Error('Drive 503'));
    const r = await ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') });
    expect(r.archivHinweis).toMatch(/Archiv: Drive 503/);
    expect(ediWert(tabs, 'Status')).toBe('gesendet');
    expect(f.melde.mock.calls[0][0]).toMatch(/⚠️ Archiv/);
  });

  test('Position nicht mehr offen -> 422, nichts gesendet, nichts geschrieben', async () => {
    const { tabs, sheets, batch } = await mitEntwurf();
    tabs[TAB_KORB][2][KORB_SPALTEN.indexOf('Status')] = 'abgewählt';
    const f = fakes();
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/überholt/) });
    expect(f.senden).not.toHaveBeenCalled();
    expect(batch).toEqual([]);
  });

  test('Testdatei, gesendet, zu alt (> 24 h) -> gesperrt, nie gesendet', async () => {
    const { sheets } = await mitEntwurf();
    const f = fakes();
    await expect(ediSenden({ orderId: 'JFN-2026-0001', sheets, ...f, jetzt: JETZT })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Testdatei/) });
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-23T08:01:00Z') })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/älter als 24 Stunden/) });
    await expect(ediSenden({ orderId: 'JFN-2026-9999', sheets, ...f, jetzt: JETZT })).rejects.toMatchObject({ status: 404 });
    expect(f.senden).not.toHaveBeenCalled();
  });

  test.each([
    ['MESZ', '2026-10-22T08:00:00Z', '2026-10-22T11:29:00Z', '2026-10-22T11:30:00Z'],   // 13:29 / 13:30 Sommerzeit
    ['MEZ', '2026-11-02T08:00:00Z', '2026-11-02T12:29:00Z', '2026-11-02T12:30:00Z'],    // 13:29 / 13:30 Winterzeit
  ])('Express nach 13:30 (%s) ist beim Senden rot', async (_, erzeugt, vorher, nachher) => {
    const a = await mitEntwurf({ versandart: 'EX007', erzeugt: UM(erzeugt) });
    const v = await ediSendenVorschau({ orderId: 'JFN-2026-0002', sheets: a.sheets, jetzt: UM(vorher) });
    expect(v.gruen).toBe(true);
    const f = fakes();
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets: a.sheets, ...f, jetzt: UM(nachher) }))
      .rejects.toMatchObject({ status: 422, pruefung: { punkte: expect.arrayContaining([expect.objectContaining({ regel: 'express_senden', ok: false, stufe: 'rot' })]) } });
    expect(f.senden).not.toHaveBeenCalled();
    expect(ediWert(a.tabs, 'Status')).toBe('Entwurf');
  });

  test('zwei Klicks zugleich: der zweite bekommt 409, genau ein Upload', async () => {
    const { sheets } = await mitEntwurf();
    let freigeben;
    const f = fakes();
    f.senden.mockImplementationOnce(() => new Promise(r => { freigeben = () => r({ ergebnis: SENDE_ERGEBNIS.LIEGT, hinweis: '' }); }));
    const erster = ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:00Z') });
    await new Promise(r => setTimeout(r, 20));
    await expect(ediSenden({ orderId: 'JFN-2026-0002', sheets, ...f, jetzt: UM('2026-10-22T09:00:01Z') })).rejects.toMatchObject({ status: 409 });
    freigeben();
    await erster;
    expect(f.senden).toHaveBeenCalledTimes(1);
  });
});

describe('Vorschau, Rueckwege, haengendes Senden (Aenderung B)', () => {
  test('Vorschau: schreibt nichts, Netto je Position, Summe, Staffel', async () => {
    const { sheets, batch } = await mitEntwurf();
    const v = await ediSendenVorschau({ orderId: 'JFN-2026-0002', sheets, jetzt: UM('2026-10-22T09:00:00Z') });
    expect(batch).toEqual([]);
    expect(v.netto.positionen.map(p => [p.itemnumber, p.menge, p.ek, p.zeile])).toEqual([[NR, 1, 12.34, 12.34], [NR2, 3, 5.5, 16.5]]);
    expect(v.netto.summe).toBe(28.84);
    expect(v.netto.staffel.stand).toMatchObject({ unterErster: true, fehlt: 21.16, naechste: { nr: 1 } });
  });

  test('"wird gesendet" > 10 min: wie unklar (Liste, Rueckwege); < 10 min: weder senden noch zurueck', async () => {
    const { tabs, sheets } = await mitEntwurf();
    tabs[EDI_TAB][2][EDI_SPALTEN.indexOf('Status')] = 'wird gesendet';
    tabs[EDI_TAB][2][EDI_SPALTEN.indexOf('Sendeversuch')] = '2026-10-22T09:00:00.000Z';
    const korb = (await import('../utils/korb-logic.js')).korbZeilen(tabs[TAB_KORB]).zeilen;
    expect(entwuerfeAus(tabs[EDI_TAB], korb, new Date('2026-10-22T09:05:00Z'))[0]).toMatchObject({ wirdGesendet: true, unklar: false, sendbar: false });
    expect(entwuerfeAus(tabs[EDI_TAB], korb, new Date('2026-10-22T09:11:00Z'))[0]).toMatchObject({ wirdGesendet: false, unklar: true });
    await expect(ediZurueckAufEntwurf({ orderId: 'JFN-2026-0002', sheets, jetzt: UM('2026-10-22T09:05:00Z') })).rejects.toMatchObject({ status: 409 });
    await expect(ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets, jetzt: UM('2026-10-22T09:05:00Z') })).rejects.toMatchObject({ status: 409 });
    await ediZurueckAufEntwurf({ orderId: 'JFN-2026-0002', sheets, jetzt: UM('2026-10-22T09:11:00Z') });
    expect([ediWert(tabs, 'Status'), ediWert(tabs, 'Sende_Hinweis')]).toEqual(['Entwurf', 'von Hand zurück auf Entwurf 2026-10-22T09:11:00.000Z']);
  });

  test('unklar -> "Als gesendet markieren" (frisch geprueft, Korb bestellt)', async () => {
    const { tabs, sheets } = await mitEntwurf();
    await ediSenden({ orderId: 'JFN-2026-0002', sheets, ...fakes({ ergebnis: 'unklar', hinweis: 'x' }), jetzt: UM('2026-10-22T09:00:00Z') }).catch(() => {});
    expect(ediWert(tabs, 'Status')).toBe('unklar');
    await ediAlsGesendet({ orderId: 'JFN-2026-0002', sheets, jetzt: UM('2026-10-22T10:00:00Z') });
    expect([ediWert(tabs, 'Status'), korbWert(tabs, 'Status', 1)]).toEqual(['gesendet', 'bestellt']);
  });

  test('gesendetPlan: von Hand nur aus Entwurf/unklar/haengend; Senden nur aus "wird gesendet"', () => {
    const kopf = EDI_SPALTEN;
    const zeile = (status, sv = '') => kopf.map(n => ({ order_id: 'JFN-2026-0005', Status: status, Korb_Schluessel: 'A', Sendeversuch: sv }[n] ?? ''));
    const korb = [{ Schluessel: 'A', Status: 'offen', _zeile: 2 }];
    const plan = (status, o = {}) => () => gesendetPlan({ ediWerte: [kopf, zeile(status, o.sv)], korbZeilen: korb, orderId: 'JFN-2026-0005', jetzt: '2026-10-22T10:00:00.000Z', erlaubt: o.erlaubt });
    expect(plan('Entwurf')).not.toThrow();
    expect(plan('unklar')).not.toThrow();
    expect(plan('wird gesendet', { sv: '2026-10-22T09:00:00.000Z' })).not.toThrow();       // haengt (60 min)
    expect(plan('wird gesendet', { sv: '2026-10-22T09:55:00.000Z' })).toThrow(/nicht als gesendet/);
    expect(plan('gesendet')).toThrow(/nicht als gesendet/);
    expect(plan('Entwurf', { erlaubt: ['wird gesendet'] })).toThrow();
    expect(HAENGT_MIN).toBe(10);
  });
});

// ═══ Staffel und Netto ═══════════════════════════════════════════════════════
describe('Versandstaffel und Netto (erfundene Werte)', () => {
  const STUFEN = versandstaffel([['lshop.versandstufe.1.ab', '50'], ['lshop.versandstufe.1.kosten', '7,5'], ['lshop.versandstufe.2.ab', '1.000,00'], ['lshop.versandstufe.2.kosten', '0']]).stufen;
  test('Stufen aus Config: Zahlen deutsch/englisch, lueckenlos, steigend; sonst Fehlertext; leer -> keine Staffel', () => {
    expect(STUFEN).toEqual([{ nr: 1, ab: 50, kosten: 7.5 }, { nr: 2, ab: 1000, kosten: 0 }]);
    expect(versandstaffel([])).toEqual({ stufen: [], fehler: '' });
    expect(versandstaffel([['lshop.versandstufe.1.ab', ''], ['lshop.versandstufe.1.kosten', '']])).toEqual({ stufen: [], fehler: '' });
    expect(versandstaffel([['lshop.versandstufe.1.ab', '50']]).fehler).toMatch(/Stufe 1: Wert fehlt/);
    expect(versandstaffel([['lshop.versandstufe.1.ab', '50'], ['lshop.versandstufe.1.kosten', '1'], ['lshop.versandstufe.3.ab', '9'], ['lshop.versandstufe.3.kosten', '1']]).fehler).toMatch(/lückenlos/);
    expect(versandstaffel([['lshop.versandstufe.1.ab', '50'], ['lshop.versandstufe.1.kosten', '1'], ['lshop.versandstufe.2.ab', '40'], ['lshop.versandstufe.2.kosten', '0']]).fehler).toMatch(/größer/);
    expect([euro('1.234,50'), euro('12.5'), euro(3), euro(''), euro('abc')]).toEqual([1234.5, 12.5, 3, null, null]);
  });
  test('Stand: unter der ersten, dazwischen ("noch X €"), hoechste Stufe; ohne Staffel null', () => {
    expect(staffelStand(20, STUFEN)).toMatchObject({ unterErster: true, fehlt: 30, naechste: { nr: 1 } });
    expect(staffelStand(50, STUFEN)).toMatchObject({ unterErster: false, stufe: { nr: 1 }, fehlt: 950, hoechste: false });
    expect(staffelStand(1200, STUFEN)).toMatchObject({ stufe: { nr: 2 }, hoechste: true, fehlt: 0 });
    expect(staffelStand(10, [])).toBeNull();
  });
  test('Netto: EK x Menge, fehlender EK markiert, Summe ohne ihn', () => {
    const n = nettoSummen([{ schluessel: 'a', itemnumber: '1', quantity: '2' }, { schluessel: 'b', itemnumber: '2', quantity: '1' }], new Map([['1', '9,99']]));
    expect(n).toEqual({ positionen: [{ schluessel: 'a', itemnumber: '1', menge: 2, ek: 9.99, zeile: 19.98 }, { schluessel: 'b', itemnumber: '2', menge: 1, ek: null, zeile: null }], summe: 19.98, ekFehlt: 1 });
  });
  test('Chat-Texte ohne Preise und Namen', () => {
    const g = buildGesendetNachricht({ orderId: 'JFN-2026-0007', positionen: 3, stueck: 9, versandart: 'DHL' });
    const a = buildSendenAlarmNachricht({ orderId: 'JFN-2026-0007', positionen: 3, stueck: 9, versandart: 'DHL', grund: 'x', art: 'unklar' });
    for (const t of [g, a]) expect(t).not.toMatch(/€|\d+,\d\d|EK/);
  });
});

describe('Browser-Block "Netto-Staffel"', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const von = html.indexOf('// ── Netto-Staffel: Anfang');
  const bis = html.indexOf('// ── Netto-Staffel: Ende ──');
  const B = new Function(`${html.slice(von, bis)}\nreturn { nsStaffelStand, nsStaffelText, nsAuswahlSumme, nsNettoHtml };`)();
  const ST = { stufen: [{ nr: 1, ab: 50, kosten: 7.5 }, { nr: 2, ab: 100, kosten: 0 }], fehler: '' };

  test('nsStaffelStand = staffelStand (Backend)', () => {
    for (const s of [0, 49.99, 50, 75.5, 100, 250]) expect(B.nsStaffelStand(s, ST.stufen)).toEqual(staffelStand(s, ST.stufen));
  });
  test('Texte: gelb unter der ersten, "noch X €", hoechste Stufe, ohne Staffel grau, "mindestens" bei fehlendem EK', () => {
    expect(B.nsStaffelText(20, ST)).toMatchObject({ klasse: 'ns-gelb', text: expect.stringMatching(/unter der ersten Versandstufe – noch 30,00\s€ bis Stufe 1/) });
    expect(B.nsStaffelText(60, ST).text).toMatch(/^Stufe 1 \(Versand 7,50\s€\) · noch 40,00\s€ bis Stufe 2 \(versandkostenfrei\)$/);
    expect(B.nsStaffelText(120, ST, 1).text).toMatch(/^mindestens Stufe 2 \(versandkostenfrei\) · höchste Stufe erreicht$/);
    expect(B.nsStaffelText(10, { stufen: [], fehler: '' })).toEqual({ klasse: 'ns-grau', text: 'Versandstaffel nicht hinterlegt' });
  });
  test('Auswahl-Summe aus EK je Buendel', () => {
    const buendel = [{ ek: 2.5, positionen: [{ schluessel: 'a' }, { schluessel: 'b' }] }, { ek: null, positionen: [{ schluessel: 'c' }] }];
    expect(B.nsAuswahlSumme([{ schluessel: 'a', menge: 2 }, { schluessel: 'c', menge: 1 }], buendel)).toEqual({ summe: 5, ekFehlt: 1 });
  });
  test('Tabelle: EK fehlt markiert, Summe "mindestens", maskiert', () => {
    const h = B.nsNettoHtml({ positionen: [{ schluessel: 'a', itemnumber: '1', menge: 2, ek: 9.99, zeile: 19.98 }, { schluessel: 'b', itemnumber: '<2>', menge: 1, ek: null, zeile: null }], summe: 19.98, ekFehlt: 1, staffel: ST }, []);
    expect(h).toContain('EK fehlt');
    expect(h).toContain('mindestens');
    expect(h).toContain('19,98');
    expect(h).toContain('&#60;2&#62;');
  });
  test('Preise nie in Zaehlliste/Druck: Leisten-Summe sitzt in #korb-leiste, nicht in .zaehlliste', () => {
    expect(html).toMatch(/<div id="korb-leiste"[\s\S]*?id="korb-leiste-summe"[\s\S]*?<\/div>/);
    const zl = html.slice(html.indexOf('function zaehllisteHtml'), html.indexOf('function zaehllisteHtml') + 3000);
    expect(zl).not.toMatch(/\.ek\b|nsEuro|nsAuswahlSumme/);
  });
});

// ═══ Waechter (lib/lshopBelege.js) ═══════════════════════════════════════════
describe('Waechter', () => {
  const JETZT_W = new Date('2026-10-22T10:00:00Z');
  const kopf = EDI_SPALTEN;
  const edi = (id, status, o = {}) => kopf.map(n => ({ order_id: id, Status: status, ...o }[n] ?? ''));

  test('eigen bei wird gesendet / gesendet / unklar / spaeter; Entwurf und Testdatei Alarm', () => {
    const name = 'JFN-2026-0005_20261022-1100.xml';
    for (const st of ['wird gesendet', 'gesendet', 'unklar', 'bestätigt', 'versandt']) {
      expect(bewerteOrderDatei({ name }, new Map([['JFN-2026-0005', st]]), JETZT_W).ergebnis).toBe('eigen');
    }
    for (const st of ['Entwurf', 'Testdatei']) expect(bewerteOrderDatei({ name }, new Map([['JFN-2026-0005', st]]), JETZT_W).ergebnis).toBe('alarm');
  });

  test('abgeholtPlan: nur per Knopf gesendet (Sendeversuch), Abgeholt leer, nicht mehr in ORDER, nicht "wird gesendet"', () => {
    const w = [kopf,
      edi('JFN-2026-0003', 'gesendet'),                                                     // von Hand gesendet -> nie
      edi('JFN-2026-0004', 'gesendet', { Sendeversuch: 'x' }),                              // weg -> Abgeholt
      edi('JFN-2026-0005', 'gesendet', { Sendeversuch: 'x' }),                              // liegt noch
      edi('JFN-2026-0006', 'unklar', { Sendeversuch: 'x' }),                                // weg -> Abgeholt
      edi('JFN-2026-0007', 'wird gesendet', { Sendeversuch: 'x' }),                         // laeuft evtl. noch
      edi('JFN-2026-0008', 'gesendet', { Sendeversuch: 'x', Abgeholt: '2026-10-21T00:00:00Z' }),
    ];
    const plan = abgeholtPlan({ ediWerte: w, orderListe: [{ name: 'JFN-2026-0005_20261022-1000.xml' }], jetzt: JETZT_W });
    expect(plan.map(p => [p.orderId, p.zeile, p.neu])).toEqual([['JFN-2026-0004', 3, JETZT_W.toISOString()], ['JFN-2026-0006', 5, JETZT_W.toISOString()]]);
  });

  test('haengendPlan: > 10 min einmal (Merker), < 10 min nicht', () => {
    const w = [kopf,
      edi('JFN-2026-0004', 'wird gesendet', { Sendeversuch: '2026-10-22T09:45:00Z' }),
      edi('JFN-2026-0005', 'wird gesendet', { Sendeversuch: '2026-10-22T09:55:00Z' }),
      edi('JFN-2026-0006', 'wird gesendet', { Sendeversuch: '2026-10-22T09:00:00Z', Sende_Hinweis: MERKER_HAENGT }),
    ];
    const plan = haengendPlan({ ediWerte: w, jetzt: JETZT_W, haengtMin: 10 });
    expect(plan.map(p => [p.orderId, p.neu, p.seitMin])).toEqual([['JFN-2026-0004', MERKER_HAENGT, 15]]);
  });

  function welt(ediZeilen, order) {
    const tabs = { [BELEGE_TAB]: [BELEGE_SPALTEN], [EDI_TAB]: [EDI_SPALTEN, ...ediZeilen], [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN] };
    const ftp = async fn => fn({ liste: async o => (o === ORDNER.ORDER ? order : []), lade: async () => Buffer.from('') });
    return { tabs, ftp, ...machSheets(tabs) };
  }
  const lauf = (w, o = {}) => { _belegeSperreLoesen(); return runBelegeAbruf({ sheets: w.sheets, ftp: w.ftp, archiv: async () => ({ status: 'neu', id: 'x' }), jetzt: () => JETZT_W, ...o }); };

  test('Lauf: Abgeholt gesetzt, haengendes Senden einmal gemeldet (Status bleibt), eigene Datei > 20 min einmal gemeldet', async () => {
    const alt = new Date(JETZT_W.getTime() - 25 * 60000);
    const w = welt([
      edi('JFN-2026-0004', 'gesendet', { Sendeversuch: '2026-10-22T09:00:00Z' }),
      edi('JFN-2026-0005', 'gesendet', { Sendeversuch: '2026-10-22T09:30:00Z' }),
      edi('JFN-2026-0006', 'wird gesendet', { Sendeversuch: '2026-10-22T09:00:00Z' }),
    ], [{ name: 'JFN-2026-0005_20261022-1130.xml', size: 10, istDatei: true, modifiedAt: alt }]);
    const meldungen = [];
    const melde = async t => { meldungen.push(t); return true; };
    const r = await lauf(w, { melde });
    expect(r.abgeholt).toEqual(['JFN-2026-0004']);
    expect(r.haengend).toEqual(['JFN-2026-0006']);
    const e = n => w.tabs[EDI_TAB].map(z => z[EDI_SPALTEN.indexOf(n)] ?? '');
    expect(e('Abgeholt').slice(1)).toEqual([JETZT_W.toISOString(), '', '']);
    expect(e('Status').slice(1)).toEqual(['gesendet', 'gesendet', 'wird gesendet']);   // Status nie geaendert
    expect(e('Sende_Hinweis')[3]).toBe(MERKER_HAENGT);
    expect(meldungen.join('\n')).toMatch(/liegt zu lange in ORDER[\s\S]*JFN-2026-0005_20261022-1130\.xml/);
    expect(meldungen.join('\n')).toMatch(/Senden hängt[\s\S]*JFN-2026-0006/);
    const zl = w.tabs[BELEGE_TAB].find(z => z[1] === 'JFN-2026-0005_20261022-1130.xml');
    expect(zl[BELEGE_SPALTEN.indexOf('Ergebnis')]).toBe('eigen');
    expect(zl[BELEGE_SPALTEN.indexOf('Hinweis')]).toContain(MERKER_ZU_LANGE);

    meldungen.length = 0;
    await lauf(w, { melde });
    expect(meldungen).toEqual([]);   // beides nur einmal
  });

  test('Trockenlauf schreibt und meldet nichts', async () => {
    const w = welt([edi('JFN-2026-0004', 'gesendet', { Sendeversuch: '2026-10-22T09:00:00Z' })], []);
    const melde = jest.fn();
    const r = await lauf(w, { dryRun: true, melde });
    expect(r.abgeholt).toEqual(['JFN-2026-0004']);
    expect(w.tabs[EDI_TAB][1][EDI_SPALTEN.indexOf('Abgeholt')] ?? '').toBe('');
    expect(melde).not.toHaveBeenCalled();
  });
});

describe('Anzeige der Entwuerfe (sendbar, Grund)', () => {
  test('sendbar nur frischer Entwurf mit allen Positionen offen', () => {
    const idx = ediSpalten(EDI_SPALTEN);
    const r = (o = {}) => EDI_SPALTEN.map(n => ({ order_id: 'JFN-2026-0009', Status: 'Entwurf', Korb_Schluessel: 'A B', Erzeugt: '2026-10-22T08:00:00Z', ...o }[n] ?? ''));
    const korb = [{ Schluessel: 'A', Status: 'offen' }, { Schluessel: 'B', Status: 'offen' }];
    const j = new Date('2026-10-22T10:00:00Z');
    expect(sendbarkeit(r(), idx, korb, j)).toMatchObject({ sendbar: true });
    expect(sendbarkeit(r({ Erzeugt: '2026-10-21T08:00:00Z' }), idx, korb, j).grund).toMatch(/älter als 24/);
    expect(sendbarkeit(r(), idx, [korb[0]], j).grund).toMatch(/überholt: nur 1 von 2/);
    expect(sendbarkeit(r({ Status: 'Testdatei' }), idx, korb, j).grund).toMatch(/Testdatei/);
    expect(EDI_STATUS).toMatchObject({ WIRD_GESENDET: 'wird gesendet', UNKLAR: 'unklar' });
  });
});
