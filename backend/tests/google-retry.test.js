// Wiederholung fuer Google-Aufrufe: nur 429/5xx, nur Lesen + values.batchUpdate.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mitWiederholung, sheetsMitWiederholung, statusVon, PAUSEN_MS, RETRY_STATUS } from '../lib/googleRetry.js';

const fehler = status => Object.assign(new Error('Google sagt: geheime-tabellen-id-123456'), { response: { status } });
const ohnePause = () => { const pausen = []; return { sleep: async ms => { pausen.push(ms); }, pausen }; };

describe('mitWiederholung', () => {
  test('Konfiguration: 429/500/502/503/504, Pausen 1/2/4 s', () => {
    expect([...RETRY_STATUS].sort()).toEqual([429, 500, 502, 503, 504]);
    expect(PAUSEN_MS).toEqual([1000, 2000, 4000]);
  });

  test('Erfolg beim ersten Mal: ein Aufruf, keine Pause', async () => {
    const { sleep, pausen } = ohnePause(); const fn = jest.fn().mockResolvedValue('ok');
    await expect(mitWiederholung(fn, { sleep, log: () => {} })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1); expect(pausen).toEqual([]);
  });

  test.each([429, 500, 502, 503, 504])('HTTP %i wird wiederholt, dann Erfolg', async status => {
    const { sleep, pausen } = ohnePause();
    const fn = jest.fn().mockRejectedValueOnce(fehler(status)).mockResolvedValue('ok');
    await expect(mitWiederholung(fn, { sleep, log: () => {} })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2); expect(pausen).toEqual([1000]);
  });

  test('dauerhaft 503: 4 Aufrufe (1 + 3 Wiederholungen), Pausen 1/2/4 s, dann der Originalfehler', async () => {
    const { sleep, pausen } = ohnePause(); const err = fehler(503); const fn = jest.fn().mockRejectedValue(err);
    await expect(mitWiederholung(fn, { sleep, log: () => {} })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(4); expect(pausen).toEqual([1000, 2000, 4000]);
  });

  test.each([400, 401, 403, 404, 409])('HTTP %i wird nicht wiederholt', async status => {
    const { sleep, pausen } = ohnePause(); const fn = jest.fn().mockRejectedValue(fehler(status));
    await expect(mitWiederholung(fn, { sleep, log: () => {} })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1); expect(pausen).toEqual([]);
  });

  test('Fehler ohne Status (Netzwerk, ECONNRESET) wird nicht wiederholt', async () => {
    const fn = jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNRESET' }));
    await expect(mitWiederholung(fn, { sleep: async () => {}, log: () => {} })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('statusVon: response.status, status, numerischer code', () => {
    expect(statusVon({ response: { status: 429 } })).toBe(429);
    expect(statusVon({ status: 503 })).toBe(503);
    expect(statusVon({ code: '500' })).toBe(500);
    expect(statusVon({ code: 'ECONNRESET' })).toBeNull();
    expect(statusVon(null)).toBeNull();
  });

  test('Log: Versuchsnummer und Status, nie Fehlertext oder IDs', async () => {
    const zeilen = []; const fn = jest.fn().mockRejectedValueOnce(fehler(429)).mockRejectedValueOnce(fehler(503)).mockResolvedValue(1);
    await mitWiederholung(fn, { label: 'sheets.values.get', sleep: async () => {}, log: m => zeilen.push(m) });
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toMatch(/sheets\.values\.get Versuch 1\/4 .*HTTP 429/);
    expect(zeilen[1]).toMatch(/Versuch 2\/4 .*HTTP 503/);
    expect(zeilen.join(' ')).not.toMatch(/geheime|123456/);
  });
});

function fakeSheets(status) {
  const mk = () => jest.fn().mockRejectedValue(fehler(status));
  return {
    spreadsheets: {
      get: mk(), batchUpdate: mk(),
      values: { get: mk(), batchGet: mk(), batchUpdate: mk(), append: mk(), update: mk(), clear: mk() },
    },
  };
}

describe('sheetsMitWiederholung', () => {
  const opts = () => ({ sleep: async () => {}, log: () => {} });

  test.each([
    ['values.get', s => s.spreadsheets.values.get],
    ['values.batchGet', s => s.spreadsheets.values.batchGet],
    ['values.batchUpdate', s => s.spreadsheets.values.batchUpdate],
    ['spreadsheets.get', s => s.spreadsheets.get],
  ])('%s wird bei 503 wiederholt', async (name, hole) => {
    const roh = fakeSheets(503); const s = sheetsMitWiederholung(roh, opts());
    const pfad = name.split('.'); const fn = pfad.length === 2 && pfad[0] === 'values' ? s.spreadsheets.values[pfad[1]] : s.spreadsheets[pfad[1]];
    await expect(fn({ a: 1 })).rejects.toBeDefined();
    expect(hole(roh)).toHaveBeenCalledTimes(4);
    expect(hole(roh)).toHaveBeenCalledWith({ a: 1 });
  });

  test('values.append wird NIE wiederholt, auch nicht bei 503 und 429', async () => {
    for (const status of [503, 429, 500]) {
      const roh = fakeSheets(status); const s = sheetsMitWiederholung(roh, opts());
      await expect(s.spreadsheets.values.append({ range: 'A1' })).rejects.toBeDefined();
      expect(roh.spreadsheets.values.append).toHaveBeenCalledTimes(1);
    }
  });

  test('values.update, values.clear und spreadsheets.batchUpdate werden nicht wiederholt', async () => {
    const roh = fakeSheets(503); const s = sheetsMitWiederholung(roh, opts());
    await expect(s.spreadsheets.values.update({})).rejects.toBeDefined();
    await expect(s.spreadsheets.values.clear({})).rejects.toBeDefined();
    await expect(s.spreadsheets.batchUpdate({})).rejects.toBeDefined();
    expect(roh.spreadsheets.values.update).toHaveBeenCalledTimes(1);
    expect(roh.spreadsheets.values.clear).toHaveBeenCalledTimes(1);
    expect(roh.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
  });

  test('Erfolg wird durchgereicht, Nicht-Fehler-Antworten bleiben unveraendert', async () => {
    const roh = { spreadsheets: { values: { get: jest.fn().mockResolvedValue({ data: { values: [['a']] } }), append: jest.fn().mockResolvedValue({ ok: true }) } } };
    const s = sheetsMitWiederholung(roh, opts());
    await expect(s.spreadsheets.values.get({})).resolves.toEqual({ data: { values: [['a']] } });
    await expect(s.spreadsheets.values.append({})).resolves.toEqual({ ok: true });
  });

  test('429 beim Lesen, dann Erfolg: Ergebnis kommt an', async () => {
    const get = jest.fn().mockRejectedValueOnce(fehler(429)).mockResolvedValue({ data: 'ok' });
    const s = sheetsMitWiederholung({ spreadsheets: { values: { get } } }, opts());
    await expect(s.spreadsheets.values.get({})).resolves.toEqual({ data: 'ok' });
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('Geltungsbereich', () => {
  const lib = resolve(dirname(fileURLToPath(import.meta.url)), '../lib');
  const routes = resolve(dirname(fileURLToPath(import.meta.url)), '../routes');
  const text = p => readFileSync(p, 'utf8');

  test('Chat-Meldung und WooCommerce-Client benutzen den Wrapper nicht', () => {
    expect(text(resolve(lib, 'chatNotify.js'))).not.toMatch(/googleRetry/);
    expect(text(resolve(routes, 'woocommerce.js'))).not.toMatch(/googleRetry/);
  });

  test('Abgleich- und Sync-Routen holen ihren Sheets-Client mit Wrapper', () => {
    for (const f of ['partner-artikel.js', 'partnerPortal.js']) {
      expect(text(resolve(routes, f))).toMatch(/sheetsMitWiederholung\(google\.sheets/);
    }
  });
});
