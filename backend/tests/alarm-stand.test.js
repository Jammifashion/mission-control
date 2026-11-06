// AL2: lesende Shop-Zeitueberschreitung erst bei der zweiten innerhalb von 2 h melden (Stand im Reiter Alarm_Stand).
// Nur ERFUNDENE Daten, Sheet im Speicher (tests/hilfen/korb-sheet.js).

import { jest } from '@jest/globals';
import { machSheets } from './hilfen/korb-sheet.js';
import { alarmEntscheidung, alarmSchluessel, TAB_ALARM, KOPF_ALARM, FENSTER_MS } from '../utils/alarm-stand.js';
import { zeitueberschreitungPruefen } from '../lib/alarmStand.js';

const T0 = Date.parse('2026-11-04T23:17:28Z');
const MIN = 60 * 1000;
const S = alarmSchluessel({ shop: 'JFN', ablauf: 'POST /api/intern/lshop-korb/abgleich' });

beforeEach(() => { for (const art of ['log', 'warn', 'error']) jest.spyOn(console, art).mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('alarmEntscheidung', () => {
  test('ohne vorige: erste, keine Meldung', () => {
    expect(alarmEntscheidung('', T0)).toEqual({ melden: false, grund: 'erste' });
  });
  test('vorige vor 60 min: zweite, Meldung mit Abstand', () => {
    expect(alarmEntscheidung(new Date(T0 - 60 * MIN).toISOString(), T0)).toEqual({ melden: true, grund: 'zweite', abstandMin: 60 });
  });
  test('vorige genau 2 h oder aelter: wieder erste', () => {
    expect(alarmEntscheidung(new Date(T0 - FENSTER_MS).toISOString(), T0).melden).toBe(false);
    expect(alarmEntscheidung(new Date(T0 - 3 * 60 * MIN).toISOString(), T0).melden).toBe(false);
  });
  test('vorige in der Zukunft oder kaputt: erste', () => {
    expect(alarmEntscheidung(new Date(T0 + MIN).toISOString(), T0).melden).toBe(false);
    expect(alarmEntscheidung('kein Datum', T0).melden).toBe(false);
  });
  test('Schluessel: Shop + Ablauf, ohne Query', () => {
    expect(alarmSchluessel({ shop: 'HONK', ablauf: 'GET /api/x?seite=2' })).toBe('HONK|GET /api/x');
  });
});

describe('zeitueberschreitungPruefen (Reiter Alarm_Stand)', () => {
  const lauf = (sheets, jetzt, schluessel = S) => zeitueberschreitungPruefen({ schluessel, zeit: new Date(jetzt).toISOString(), sheets, spreadsheetId: 'ssot', jetzt });

  test('erste -> still + Zeile angelegt; zweite nach 70 min -> Meldung + Zeile ersetzt; dritte nach 3 h -> wieder still', async () => {
    const tabs = { [TAB_ALARM]: [KOPF_ALARM] };
    const { sheets, aufrufe } = machSheets(tabs);
    expect(await lauf(sheets, T0)).toEqual({ melden: false, grund: 'erste' });
    expect(tabs[TAB_ALARM]).toHaveLength(2);
    expect(tabs[TAB_ALARM][1].slice(0, 2)).toEqual([S, '2026-11-04T23:17:28.000Z']);
    expect(await lauf(sheets, T0 + 70 * MIN)).toEqual({ melden: true, grund: 'zweite', abstandMin: 70 });
    expect(tabs[TAB_ALARM]).toHaveLength(2);
    expect(tabs[TAB_ALARM][1][1]).toBe(new Date(T0 + 70 * MIN).toISOString());
    expect(await lauf(sheets, T0 + 70 * MIN + 3 * 60 * MIN)).toMatchObject({ melden: false, grund: 'erste' });
    expect(aufrufe.append).toBe(0);
  });

  test('anderer Ablauf zaehlt getrennt', async () => {
    const tabs = { [TAB_ALARM]: [KOPF_ALARM] };
    const { sheets } = machSheets(tabs);
    await lauf(sheets, T0);
    expect(await lauf(sheets, T0 + 10 * MIN, alarmSchluessel({ shop: 'JFN', ablauf: 'POST /api/intern/lshop-belege/abruf' }))).toMatchObject({ melden: false });
    expect(tabs[TAB_ALARM]).toHaveLength(3);
  });

  test('Reiter fehlt oder Kopf anders -> sofort melden, nichts geschrieben', async () => {
    const leer = machSheets({});
    expect(await lauf(leer.sheets, T0)).toEqual({ melden: true, grund: 'kein_stand' });
    const tabs = { [TAB_ALARM]: [['Etwas', 'Anderes']] };
    const anders = machSheets(tabs);
    expect(await lauf(anders.sheets, T0)).toEqual({ melden: true, grund: 'kein_stand' });
    expect(tabs[TAB_ALARM]).toHaveLength(1);
  });

  test('ohne Sheet-ID -> sofort melden', async () => {
    expect(await zeitueberschreitungPruefen({ schluessel: S, spreadsheetId: '' })).toEqual({ melden: true, grund: 'kein_stand' });
  });

  test('Schreiben scheitert -> sofort melden', async () => {
    const tabs = { [TAB_ALARM]: [KOPF_ALARM] };
    const { sheets } = machSheets(tabs);
    sheets.spreadsheets.values.update = async () => { throw new Error('Sheets weg'); };
    expect(await lauf(sheets, T0)).toEqual({ melden: true, grund: 'fehler' });
  });
});

describe('Middleware: welche Zeitueberschreitung meldet sofort', () => {
  test('lesend: erst Pruefung im Reiter; schreibend (Ergebnis unklar): sofort ohne Pruefung', async () => {
    jest.resetModules();
    const pruefen = jest.fn().mockResolvedValue({ melden: false, grund: 'erste' });
    const notifyShopZeitueberschreitung = jest.fn().mockResolvedValue(true);
    jest.unstable_mockModule('../lib/alarmStand.js', () => ({ zeitueberschreitungPruefen: pruefen }));
    jest.unstable_mockModule('../lib/chatNotify.js', () => ({ notifyShopZeitueberschreitung, notifyHosterPruefseite: jest.fn() }));
    const { hosterPruefseiteHandler } = await import('../middleware/hosterPruefseite.js');
    const { ShopZeitueberschreitungError } = await import('../lib/hosterPruefseite.js');
    const res = () => { const r = { headersSent: false }; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
    const req = { method: 'POST', baseUrl: '/api/intern', path: '/lshop-korb/abgleich' };

    const r1 = res();
    await hosterPruefseiteHandler(new ShopZeitueberschreitungError({ shop: 'JFN', methode: 'get', pfad: 'orders', limitMs: 15000 }), req, r1, jest.fn());
    expect(pruefen).toHaveBeenCalledWith(expect.objectContaining({ schluessel: 'JFN|POST /api/intern/lshop-korb/abgleich' }));
    expect(notifyShopZeitueberschreitung).not.toHaveBeenCalled();
    expect(r1.status).toHaveBeenCalledWith(504);

    pruefen.mockResolvedValueOnce({ melden: true, grund: 'zweite', abstandMin: 60 });
    await hosterPruefseiteHandler(new ShopZeitueberschreitungError({ shop: 'JFN', methode: 'get', pfad: 'orders' }), req, res(), jest.fn());
    expect(notifyShopZeitueberschreitung).toHaveBeenCalledTimes(1);
    expect(notifyShopZeitueberschreitung).toHaveBeenLastCalledWith(expect.objectContaining({ vorigeVorMin: 60 }));

    pruefen.mockClear();
    await hosterPruefseiteHandler(new ShopZeitueberschreitungError({ shop: 'JFN', methode: 'put', pfad: 'products/1' }), req, res(), jest.fn());
    expect(pruefen).not.toHaveBeenCalled();
    expect(notifyShopZeitueberschreitung).toHaveBeenCalledTimes(2);
  });
});
