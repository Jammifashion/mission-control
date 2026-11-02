// BO7-1: Lieferbarkeit L-Shop - Bestandsdatei (stockfile.csv), Auslaufliste, Reiter LShop_Lieferbarkeit, Chat nur
// bei offenen Korb-Positionen. Nur erfundene Daten (Nummern, Mengen, Zugang).

import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import {
  LIEFERBARKEIT_TAB, LIEFERBARKEIT_SPALTEN, FormatFehler, leseBestandCsv, listenDatum, waehleNeuesteListe, leseAuslaufListe,
  listenAlterTage, genutzteNummern, planLieferbarkeit, altAusWerten, buildLieferbarkeitNachricht,
} from '../utils/lshop-lieferbarkeit.js';
import { runLieferbarkeit, findeAuslaufListe, LIEFERBARKEIT_BESCHAEFTIGT, _lieferbarkeitSperreLoesen } from '../lib/lshopLieferbarkeit.js';
import { ladeBestandsdatei, LShopFtpFehler, MAX_BESTAND_BYTES } from '../lib/lshopFtp.js';
import { _secretCacheLeeren } from '../utils/secrets.js';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { machSheets, grundTabs } from './hilfen/korb-sheet.js';

const A = '1000000001', B = '1000000002', C = '1000000003', D = '1000000004';
const T1 = new Date('2026-11-03T10:47:00Z'), T2 = new Date('2026-11-03T11:47:00Z'), T3 = new Date('2026-11-03T12:47:00Z');
const csv = (zeilen, { bom = true } = {}) => Buffer.from(`${bom ? '﻿' : ''}article;stock;catalog\r\n${zeilen.map(z => z.join(';')).join('\r\n')}\r\n`, 'utf8');

describe('Bestandsdatei', () => {
  test('BOM, CRLF, ";" - Map Nummer -> stock/catalog; ungueltige Zeilen gezaehlt', () => {
    const { bestand, ungueltig } = leseBestandCsv(csv([[A, '12', 'JH001'], [B, '0', 'JH001'], ['123', '5', 'X'], [C, '-1', 'X']]));
    expect([...bestand.entries()]).toEqual([[A, { stock: 12, catalog: 'JH001' }], [B, { stock: 0, catalog: 'JH001' }]]);
    expect(ungueltig).toBe(2);
  });
  test('Spalten ueber den Namen (andere Reihenfolge), ohne BOM', () => {
    const { bestand } = leseBestandCsv(Buffer.from(`catalog;article;stock\n${'X1'};${A};3\n`));
    expect(bestand.get(A)).toEqual({ stock: 3, catalog: 'X1' });
  });
  test('falscher Kopf / leer -> FormatFehler', () => {
    expect(() => leseBestandCsv(Buffer.from('nr;menge\n1;2'))).toThrow(FormatFehler);
    expect(() => leseBestandCsv(csv([]))).toThrow(/ohne gültige Zeilen/);
  });
});

describe('Auslaufliste', () => {
  test('neueste nach dem NAMENSdatum, nicht nach Aenderungszeit; fremde Namen zaehlen nicht', () => {
    const f = [
      { name: 'Auslaufartikel - Stand 26.10.2026.de.xlsx', modifiedTime: '2026-11-01T00:00:00Z' },
      { name: 'Auslaufartikel - Stand 30.10.2026.de.xlsx', modifiedTime: '2026-10-30T00:00:00Z' },
      { name: 'Auslaufartikel Kopie.xlsx', modifiedTime: '2026-11-02T00:00:00Z' },
    ];
    expect(waehleNeuesteListe(f).name).toMatch(/30\.10\.2026/);
    expect(listenDatum('Auslaufartikel - Stand 30.10.2026.xlsx')).toBe('2026-10-30');
    expect(waehleNeuesteListe([{ name: 'x.xlsx' }])).toBeNull();
    expect(listenAlterTage('Auslaufartikel - Stand 30.10.2026.de.xlsx', new Date('2026-11-14T09:00:00Z'))).toBe(15);
  });
  test('Spalten ueber den Namen, Datum als Date oder Text, ohne Datum = leer', () => {
    const m = leseAuslaufListe({ kopf: ['Masterartikel', 'Artikelnummer', 'Auslaufdatum'], zeilen: [
      ['JH001', A, new Date('2026-12-31T00:00:00Z')], ['JH001', B, ''], ['JH001', C, '15.01.2027'], ['x', 'kein', ''],
    ] });
    expect([...m.entries()]).toEqual([[A, '2026-12-31'], [B, ''], [C, '2027-01-15']]);
    expect(() => leseAuslaufListe({ kopf: ['Nummer'], zeilen: [[A]] })).toThrow(/Artikelnummer/);
  });
});

describe('Plan', () => {
  const bestand = new Map([[A, { stock: 5, catalog: 'JH001' }], [B, { stock: 0, catalog: 'JH001' }]]);
  const nummern = new Set([A, B, C]);

  test('genutzte Nummern: Varianten nur aktiv, Korb alle (offene gezaehlt), Lager LS:', () => {
    const g = genutzteNummern({
      varianten: [{ Aktiv: 'TRUE', LShop_ArticleNr: A }, { Aktiv: 'FALSE', LShop_ArticleNr: D }, { Aktiv: 'TRUE', LShop_ArticleNr: '' }],
      korb: [{ LShop_ArticleNr: B, Status: 'offen' }, { LShop_ArticleNr: B, Status: 'offen' }, { LShop_ArticleNr: C, Status: 'geliefert' }],
      buchungen: [{ Schluessel: `LS:${D}` }, { Schluessel: 'WC:501' }],
    });
    expect([...g.nummern].sort()).toEqual([A, B, C, D]);
    expect([...g.korbOffen.entries()]).toEqual([[B, 2]]);
  });

  test('erster Lauf: fehlt in der Datei = nicht gefuehrt (stock leer), 0 und fehlend setzen Null_seit; kein Wechsel', () => {
    const p = planLieferbarkeit({ nummern, bestand, auslauf: new Map([[A, '2026-12-31']]), listeName: 'L1', standDatei: 'S1', jetzt: T1 });
    expect(p.zeilen.map(z => [z.ArticleNr, z.stock, z.Auslauf, z.Auslaufdatum, z.Null_seit])).toEqual([
      [A, 5, 'ja', '2026-12-31', ''], [B, 0, 'nein', '', T1.toISOString()], [C, '', 'nein', '', T1.toISOString()]]);
    expect(p.summen).toMatchObject({ nummern: 3, lieferbar: 1, null: 1, nichtGefuehrt: 1, auslauf: 1, neu: 3 });
    expect(p.wechsel).toEqual([]);
  });

  test('Null_seit bleibt, solange 0; zurueckgesetzt bei Bestand; Wechsel lieferbar -> 0 und nein -> ja', () => {
    const p1 = planLieferbarkeit({ nummern, bestand, auslauf: new Map(), listeName: 'L1', standDatei: 'S1', jetzt: T1 });
    const alt = altAusWerten([LIEFERBARKEIT_SPALTEN, ...p1.zeilen.map(z => LIEFERBARKEIT_SPALTEN.map(n => String(z[n])))]);
    const b2 = new Map([[A, { stock: 0, catalog: 'JH001' }], [B, { stock: 7, catalog: 'JH001' }]]);
    const p2 = planLieferbarkeit({ nummern, bestand: b2, auslauf: new Map([[B, '']]), listeName: 'L2', alt, standDatei: 'S2', jetzt: T2 });
    const z = Object.fromEntries(p2.zeilen.map(x => [x.ArticleNr, x]));
    expect(z[A].Null_seit).toBe(T2.toISOString());
    expect(z[B].Null_seit).toBe('');
    expect(z[C].Null_seit).toBe(T1.toISOString());   // weiter nicht gefuehrt: seit dem ersten Lauf
    expect(z[C].Geaendert_Am).toBe(T1.toISOString());   // unveraendert
    expect(p2.wechsel).toEqual([{ nr: A, art: 'null', catalog: 'JH001', gefuehrt: true }, { nr: B, art: 'auslauf', catalog: 'JH001', auslaufdatum: '' }]);
  });

  test('ohne lesbare Liste bleiben Auslauf, Datum und Quelle wie bisher', () => {
    const alt = new Map([[A, { ArticleNr: A, stock: '5', Auslauf: 'ja', Auslaufdatum: '2026-12-31', Quelle_Liste: 'L1', Geaendert_Am: 'x', Null_seit: '' }]]);
    const p = planLieferbarkeit({ nummern: new Set([A]), bestand, auslauf: null, alt, standDatei: 'S2', jetzt: T2 });
    expect(p.zeilen[0]).toMatchObject({ Auslauf: 'ja', Auslaufdatum: '2026-12-31', Quelle_Liste: 'L1', Geaendert_Am: 'x' });
  });

  test('Chat: nur Nummern mit offenen Positionen, ohne Preise; sonst nichts', () => {
    const w = [{ nr: A, art: 'null', catalog: 'JH001', gefuehrt: true }, { nr: B, art: 'auslauf', catalog: 'JH001', auslaufdatum: '2026-12-31' },
      { nr: C, art: 'null', catalog: 'X', gefuehrt: false }];
    const text = buildLieferbarkeitNachricht(w, new Map([[A, 1], [B, 2]]));
    expect(text).toMatch(new RegExp(`${A} \\(JH001\\): jetzt nicht lieferbar \\(Bestand 0\\) · 1 offene Position\\b`));
    expect(text).toMatch(new RegExp(`${B} \\(JH001\\): läuft aus \\(bis 31\\.12\\.2026\\) · 2 offene Positionen`));
    expect(text).not.toContain(C);
    expect(text).not.toMatch(/€|EUR|Preis/);
    expect(buildLieferbarkeitNachricht(w, new Map([[D, 1]]))).toBeNull();
  });
});

// ── Lauf gegen In-Memory-Sheet, Drive- und FTP-Attrappe ─────────────────────
async function xlsx(nummern) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Auslaufartikel');
  ws.addRow(['Artikelnummer', 'Masterartikel', 'Farbe', 'Größe', 'Markenname', 'Beschreibung', 'Auslaufdatum']);
  for (const [nr, d] of nummern) ws.addRow([nr, 'JH001', 'Black', 'M', 'Muster', 'Muster-Shirt', d ? new Date(`${d}T00:00:00Z`) : null]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function machDrive(dateien, { ordner = [{ id: 'ORD', name: 'L-Shop Auslauf' }] } = {}) {
  const inhalt = new Map(dateien.map(f => [f.id, f.buf]));
  return {
    aufrufe: [],
    files: {
      list: jest.fn(async ({ q }) => {
        if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) return { data: { files: ordner } };
        if (q.includes("'ORD' in parents")) return { data: { files: dateien.filter(f => f.imOrdner) } };
        return { data: { files: dateien } };
      }),
      get: jest.fn(async ({ fileId }) => ({ data: inhalt.get(fileId) })),
      create: jest.fn(), update: jest.fn(), delete: jest.fn(),
    },
  };
}
const ftp = (zeilen, stand = '2026-11-03T10:30:12.000Z') => jest.fn(async () => { const buf = csv(zeilen); return { buf, stand, bytes: buf.length }; });

function tabsMit({ korb = [], lieferbarkeit = [LIEFERBARKEIT_SPALTEN] } = {}) {
  const tabs = grundTabs();
  tabs.Varianten = [['SSOT-ID', 'Aktiv', 'WC_Variation_ID', 'LShop_ArticleNr'], ['0001', 'TRUE', '501', A], ['0001', 'TRUE', '502', B], ['0002', 'FALSE', '503', D]];
  tabs[TAB_KORB] = [KORB_SPALTEN, ...korb.map(o => KORB_SPALTEN.map(n => o[n] ?? ''))];
  tabs.Lager_Buchungen = [['Buchung_ID', 'Schluessel'], ['LB-2026-00001', `LS:${C}`]];
  if (lieferbarkeit) tabs[LIEFERBARKEIT_TAB] = lieferbarkeit;
  return tabs;
}
const korbZeile = (nr, status = 'offen') => ({ Schluessel: `JFN:1:${nr}`, Herkunft: 'shop', LShop_ArticleNr: nr, Menge: '1', Status: status });

describe('runLieferbarkeit', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot';
    _lieferbarkeitSperreLoesen();
  });
  const liste30 = async () => [{ id: 'L30', name: 'Auslaufartikel - Stand 30.10.2026.de.xlsx', modifiedTime: '2026-10-30T14:00:00Z', size: '1000', imOrdner: true, buf: await xlsx([[B, '2026-12-31']]) }];

  test('Trockenlauf: rechnet, schreibt nichts, meldet nichts', async () => {
    const { sheets, aufrufe } = machSheets(tabsMit({ korb: [korbZeile(A)] }));
    const notifyFn = jest.fn();
    const r = await runLieferbarkeit({ dryRun: true, sheets, drive: machDrive(await liste30()), driveId: 'D', ftpLade: ftp([[A, 3, 'JH001'], [B, 0, 'JH001']]), notifyFn, jetzt: () => T1 });
    expect(r).toMatchObject({ ftp: 'ok', geschrieben: 0, chat: 'trockenlauf', dateiZeilen: 2, liste: { name: expect.stringMatching(/30\.10/), quelle: 'ordner' },
      summen: { nummern: 3, lieferbar: 1, null: 1, nichtGefuehrt: 1, auslauf: 1 } });
    expect(aufrufe.update).toEqual([]);
    expect(aufrufe.batchUpdate).toEqual([]);
    expect(notifyFn).not.toHaveBeenCalled();
  });

  test('echter Lauf: EIN values.update ueber die Strecke, kein append, zurueckgelesen; Erstbestand ohne Chat', async () => {
    const tabs = tabsMit({ korb: [korbZeile(A)] });
    const { sheets, aufrufe } = machSheets(tabs);
    const notifyFn = jest.fn().mockResolvedValue(true);
    const r = await runLieferbarkeit({ sheets, drive: machDrive(await liste30()), driveId: 'D', ftpLade: ftp([[A, 3, 'JH001'], [B, 0, 'JH001']]), notifyFn, jetzt: () => T1 });
    expect(r).toMatchObject({ geschrieben: 3, chat: 'nichts zu melden', wechsel: 0 });
    expect(aufrufe.append).toBe(0);
    expect(aufrufe.update).toEqual([`'${LIEFERBARKEIT_TAB}'!A1:I4`]);
    expect(tabs[LIEFERBARKEIT_TAB].slice(1).map(z => [z[0], z[2], z[4]])).toEqual([[A, 3, 'nein'], [B, 0, 'ja'], [C, '', 'nein']]);
    expect(notifyFn).not.toHaveBeenCalled();
  });

  test('Chat einmal je Wechsel und nur fuer offene Positionen; danach still; weniger Nummern -> Rest geleert', async () => {
    const tabs = tabsMit({ korb: [korbZeile(A), korbZeile(C, 'bestellt')] });
    const { sheets } = machSheets(tabs);
    const notifyFn = jest.fn().mockResolvedValue(true);
    const drive = machDrive(await liste30());
    await runLieferbarkeit({ sheets, drive, driveId: 'D', ftpLade: ftp([[A, 3, 'JH001'], [B, 0, 'JH001'], [C, 4, 'X']]), notifyFn, jetzt: () => T1 });
    // A (offen) faellt auf 0, C (nur bestellt) faellt aus der Datei -> nur A wird gemeldet
    const r2 = await runLieferbarkeit({ sheets, drive, driveId: 'D', ftpLade: ftp([[A, 0, 'JH001'], [B, 0, 'JH001']]), notifyFn, jetzt: () => T2 });
    expect(r2).toMatchObject({ wechsel: 2, zuMelden: 1, chat: 'gesendet' });
    expect(notifyFn).toHaveBeenCalledTimes(1);
    expect(notifyFn.mock.calls[0][0]).toContain(A);
    expect(notifyFn.mock.calls[0][0]).not.toContain(C);
    const r3 = await runLieferbarkeit({ sheets, drive, driveId: 'D', ftpLade: ftp([[A, 0, 'JH001'], [B, 0, 'JH001']]), notifyFn, jetzt: () => T3 });
    expect(r3).toMatchObject({ wechsel: 0, chat: 'nichts zu melden' });
    expect(notifyFn).toHaveBeenCalledTimes(1);
    const iNull = LIEFERBARKEIT_SPALTEN.indexOf('Null_seit');
    expect(tabs[LIEFERBARKEIT_TAB].find(z => z[0] === A)[iNull]).toBe(T2.toISOString());
    // A nicht mehr genutzt -> Zeile verschwindet, die alte Zeile darunter wird geleert
    tabs[TAB_KORB] = [KORB_SPALTEN];
    tabs.Varianten = [tabs.Varianten[0], ['0001', 'TRUE', '502', B]];
    tabs.Lager_Buchungen = [['Buchung_ID', 'Schluessel']];
    await runLieferbarkeit({ sheets, drive, driveId: 'D', ftpLade: ftp([[B, 0, 'JH001']]), notifyFn, jetzt: () => T3 });
    expect(tabs[LIEFERBARKEIT_TAB].filter(z => z.some(x => String(x ?? '') !== '')).map(z => z[0])).toEqual(['ArticleNr', B]);
  });

  test('Lauf laeuft schon -> 409 mit fester Meldung (Route: 200 uebersprungen)', async () => {
    const { sheets } = machSheets(tabsMit());
    let los;
    const langsam = jest.fn(() => new Promise(r => { los = () => r({ buf: csv([[A, 1, 'X']]), stand: 'S', bytes: 1 }); }));
    const erster = runLieferbarkeit({ sheets, drive: machDrive([]), driveId: 'D', ftpLade: langsam, notifyFn: jest.fn(), jetzt: () => T1 });
    await new Promise(r => setTimeout(r, 20));
    await expect(runLieferbarkeit({ sheets, drive: machDrive([]), driveId: 'D', ftpLade: ftp([[A, 1, 'X']]), jetzt: () => T1 }))
      .rejects.toMatchObject({ status: 409, message: LIEFERBARKEIT_BESCHAEFTIGT });
    los();
    await erster;
  });

  test('FTP-Fehler: Stand frisch -> 200 ftp "fehler", nichts geschrieben; Stand > 6 h -> 502', async () => {
    const zeile = [A, 3, 'JH001', '2026-11-03T10:30:00.000Z', 'nein', '', 'L', 'x', ''];
    const { sheets, aufrufe } = machSheets(tabsMit({ lieferbarkeit: [LIEFERBARKEIT_SPALTEN, zeile] }));
    const kaputt = jest.fn(async () => { throw new LShopFtpFehler('FTP: ETIMEDOUT'); });
    const r = await runLieferbarkeit({ sheets, drive: machDrive([]), driveId: 'D', ftpLade: kaputt, jetzt: () => T1 });
    expect(r).toMatchObject({ ftp: 'fehler', grund: 'FTP: ETIMEDOUT' });
    expect(aufrufe.update).toEqual([]);
    await expect(runLieferbarkeit({ sheets, drive: machDrive([]), driveId: 'D', ftpLade: kaputt, jetzt: () => new Date('2026-11-03T17:00:00Z') }))
      .rejects.toMatchObject({ status: 502 });
  });

  test('Reiter fehlt: echter Lauf 409 (Einrichtung), Trockenlauf rechnet mit Hinweis', async () => {
    const { sheets } = machSheets(tabsMit({ lieferbarkeit: null }));
    await expect(runLieferbarkeit({ sheets, drive: machDrive([]), driveId: 'D', ftpLade: ftp([[A, 1, 'X']]), jetzt: () => T1 }))
      .rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    const r = await runLieferbarkeit({ dryRun: true, sheets, drive: machDrive([]), driveId: 'D', ftpLade: ftp([[A, 1, 'X']]), jetzt: () => T1 });
    expect(r.hinweise.join(' ')).toMatch(/Reiter LShop_Lieferbarkeit fehlt/);
  });

  test('Liste: Ordner vor Suche; Rueckfall-Suche ablageweit; alte Liste -> Hinweis; keine Liste -> Auslauf bleibt', async () => {
    const f26 = { id: 'L26', name: 'Auslaufartikel - Stand 26.10.2026.de.xlsx', modifiedTime: '2026-11-01T00:00:00Z', imOrdner: false };
    const f30 = { id: 'L30', name: 'Auslaufartikel - Stand 30.10.2026.de.xlsx', modifiedTime: '2026-10-30T00:00:00Z', imOrdner: true };
    expect((await findeAuslaufListe({ drive: machDrive([f26, f30]), driveId: 'D' }))).toMatchObject({ datei: { id: 'L30' }, quelle: 'ordner' });
    expect((await findeAuslaufListe({ drive: machDrive([f26], { ordner: [] }), driveId: 'D' }))).toMatchObject({ datei: { id: 'L26' }, quelle: 'suche' });
    const { sheets } = machSheets(tabsMit());
    const r = await runLieferbarkeit({ dryRun: true, sheets, drive: machDrive([{ ...f30, size: '10', buf: await xlsx([[A, '']]) }]), driveId: 'D',
      ftpLade: ftp([[A, 1, 'X']]), jetzt: () => new Date('2026-11-20T10:00:00Z') });
    expect(r.liste.alterTage).toBe(21);
    expect(r.hinweise.join(' ')).toMatch(/21 Tage alt - bitte neue ablegen/);
    const ohne = await runLieferbarkeit({ dryRun: true, sheets, drive: machDrive([], { ordner: [] }), driveId: 'D', ftpLade: ftp([[A, 1, 'X']]), jetzt: () => T1 });
    expect(ohne.hinweise.join(' ')).toMatch(/Keine Auslaufliste gefunden/);
  });

  test('Drive wird nur gelesen (list/get)', async () => {
    const drive = machDrive(await liste30());
    const { sheets } = machSheets(tabsMit());
    await runLieferbarkeit({ sheets, drive, driveId: 'D', ftpLade: ftp([[A, 1, 'X']]), notifyFn: jest.fn(), jetzt: () => T1 });
    expect(drive.files.create).not.toHaveBeenCalled();
    expect(drive.files.update).not.toHaveBeenCalled();
    expect(drive.files.delete).not.toHaveBeenCalled();
  });
});

// ── FTP: Bestandsdatei nur lesen ─────────────────────────────────────────────
describe('ladeBestandsdatei', () => {
  const HOST = 'ftp.beispiel.test', USER = 'bestand-x', PASS = 'pw-erfunden-9';
  beforeEach(() => {
    _secretCacheLeeren();
    Object.assign(process.env, { LSHOP_FTP_HOST: HOST, LSHOP_FTP_USER: USER, LSHOP_FTP_PASS: PASS, LSHOP_EDI_FTP_USER: 'edi', LSHOP_EDI_FTP_PASS: 'edi-pw' });
  });
  function attrappe({ liste = [{ name: 'stockfile.csv', isFile: true, size: 30, modifiedAt: new Date('2026-11-03T10:30:12Z') }], inhalt = csv([[A, 1, 'X']]) } = {}) {
    const c = {
      aufrufe: [], closed: 0,
      access: async o => { c.aufrufe.push(['access', o.user]); },
      list: async p => { c.aufrufe.push(['list', p]); return liste; },
      downloadTo: async (w, p) => { c.aufrufe.push(['downloadTo', p]); w.on('error', () => {}); await new Promise((res, rej) => w.write(inhalt, e => (e ? rej(e) : res()))); },
      close: () => { c.closed++; },
    };
    return c;
  }
  test('Konto "bestand", Wurzel, genau stockfile.csv; nur access/list/downloadTo/close', async () => {
    const c = attrappe();
    const r = await ladeBestandsdatei({ clientFabrik: () => c });
    expect(r.stand).toBe('2026-11-03T10:30:12.000Z');
    expect(leseBestandCsv(r.buf).bestand.get(A).stock).toBe(1);
    expect(c.aufrufe).toEqual([['access', USER], ['list', '/'], ['downloadTo', '/stockfile.csv']]);
    expect(c.closed).toBe(1);
    expect(MAX_BESTAND_BYTES).toBe(10 * 1024 * 1024);
  });
  test('Datei fehlt / zu gross -> LShopFtpFehler, Verbindung zu, ohne Zugangsdaten', async () => {
    const c = attrappe({ liste: [] });
    await expect(ladeBestandsdatei({ clientFabrik: () => c })).rejects.toThrow(/stockfile\.csv liegt nicht auf dem FTP/);
    expect(c.closed).toBe(1);
    const g = attrappe({ liste: [{ name: 'stockfile.csv', isFile: true, size: 11 * 1024 * 1024 }] });
    const e = await ladeBestandsdatei({ clientFabrik: () => g }).catch(x => x);
    expect(e).toBeInstanceOf(LShopFtpFehler);
    expect(String(e.message)).not.toMatch(new RegExp(`${HOST}|${USER}|${PASS}`));
    expect(g.aufrufe.some(a => a[0] === 'downloadTo')).toBe(false);
    const klein = attrappe({ liste: [{ name: 'stockfile.csv', isFile: true, size: 5 }], inhalt: Buffer.alloc(50) });
    await expect(ladeBestandsdatei({ clientFabrik: () => klein, maxBytes: 10 })).rejects.toThrow(/größer als 10 Bytes/);
  });
  test('ohne Bestands-Secrets -> nicht konfiguriert, keine Verbindung', async () => {
    process.env.LSHOP_FTP_USER = '';
    _secretCacheLeeren();
    const c = attrappe();
    await expect(ladeBestandsdatei({ clientFabrik: () => c })).rejects.toThrow(/LSHOP_FTP_USER/);
    expect(c.aufrufe).toEqual([]);
  });
});
