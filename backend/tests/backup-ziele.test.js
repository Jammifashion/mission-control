// Befund B18: backup-daily.js sicherte nur GOOGLE_SHEET_ID, also das
// SSOT-Sheet. Das Business-Sheet - Partner_Verkäufe, Partner_Abrechnungen,
// Partner, Partner_Artikel, Kalkulation_Fixkosten - lag in keinem Backup.
// Aufgefallen ist das erst, als in HK_Partner_Verkäufe 66 Zeilen fehlten und es
// nichts gab, woraus man sie hätte holen können.
//
// Diese Suite haelt zwei Dinge fest, die man beim naechsten Umbau leicht wieder
// verliert: dass beide Spreadsheets gesichert werden, und dass eine fehlende ID
// den Lauf abbricht statt still nur eine Datei zu schreiben.

import { jest } from '@jest/globals';

// dotenv wuerde hier die echte .env laden und damit beide IDs setzen - dann
// koennte der Test "fehlende ID" nie fehlschlagen sehen.
jest.unstable_mockModule('dotenv', () => ({
  default: { config: jest.fn() },
  config: jest.fn(),
}));

const sheetsGet = jest.fn();
const valuesGet = jest.fn();
const filesCreate = jest.fn();
const filesList = jest.fn();
const filesDelete = jest.fn();
const filesUpdate = jest.fn();

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class { constructor(o) { this.o = o; } } },
    sheets: jest.fn(() => ({ spreadsheets: { get: sheetsGet, values: { get: valuesGet } } })),
    drive:  jest.fn(() => ({ files: { create: filesCreate, list: filesList, delete: filesDelete, update: filesUpdate } })),
  },
}));

let runBackup, ZIELE, ohneIds;

const ENV_KEYS = [
  'GOOGLE_SHEET_ID', 'BUSINESS_SHEET_ID', 'GOOGLE_DRIVE_SHARED_DRIVE_ID',
  'GOOGLE_DRIVE_BACKUP_DAILY_ID', 'GOOGLE_DRIVE_BACKUP_MONTHLY_ID',
  'GOOGLE_CREDENTIALS_JSON',
];
let gesichert = {};

beforeAll(async () => {
  ({ runBackup, ZIELE, ohneIds } = await import('../scripts/backup-daily.js'));
});

describe('ohneIds()', () => {
  const sheetId  = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
  const ordnerId = '1fAkEoRdNeRiD0123456789abcdefXYZ';

  test('IDs werden geschwaerzt', () => {
    expect(ohneIds(`not found: ${sheetId} in ${ordnerId}.`)).toBe('not found: <id> in <id>.');
  });

  test.each([
    'BUSINESS_Backup-2026-09-15.json.gz',
    'SSOT_Backup-2026-09-15.json.gz',
    'BUSINESS_Backup-2026-09.json.gz',
    'MC-Backup-2026-08-03.json.gz',
  ])('Backup-Dateiname %s bleibt lesbar', name => {
    expect(ohneIds(`${name}: Insufficient permissions (${sheetId})`))
      .toBe(`${name}: Insufficient permissions (<id>)`);
  });
});

beforeEach(() => {
  gesichert = {};
  for (const k of ENV_KEYS) { gesichert[k] = process.env[k]; delete process.env[k]; }

  process.env.GOOGLE_SHEET_ID               = 'ssot-id';
  process.env.BUSINESS_SHEET_ID             = 'business-id';
  process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID  = 'drive-id';
  process.env.GOOGLE_DRIVE_BACKUP_DAILY_ID  = 'daily-folder';
  process.env.GOOGLE_DRIVE_BACKUP_MONTHLY_ID = 'monthly-folder';

  sheetsGet.mockReset();
  valuesGet.mockReset();
  filesCreate.mockReset();
  filesList.mockReset();
  filesDelete.mockReset();
  filesUpdate.mockReset();
  filesUpdate.mockResolvedValue({ data: {} });

  sheetsGet.mockImplementation(async ({ spreadsheetId }) => ({
    data: spreadsheetId === 'ssot-id'
      ? { properties: { title: 'JF_Master_Inventur_SSoT' }, sheets: [{ properties: { title: 'Erfassungsmaske' } }] }
      : { properties: { title: 'JF_Business' }, sheets: [
          { properties: { title: 'Partner_Verkäufe' } },
          { properties: { title: 'Kalkulation_Fixkosten' } },
        ] },
  }));
  valuesGet.mockResolvedValue({ data: { values: [['Kopf'], ['Wert']] } });
  filesCreate.mockResolvedValue({ data: { id: 'neue-datei', name: 'x', size: '123' } });
  filesList.mockResolvedValue({ data: { files: [] } });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

const namen = () => filesCreate.mock.calls.map(c => c[0].requestBody.name);

describe('ZIELE', () => {
  test('enthaelt beide Spreadsheets', () => {
    expect(ZIELE.map(z => z.envKey).sort()).toEqual(['BUSINESS_SHEET_ID', 'GOOGLE_SHEET_ID']);
  });

  test('jedes Ziel hat ein unterscheidbares Praefix', () => {
    const p = ZIELE.map(z => z.praefix);
    expect(p).toContain('SSOT');
    expect(p).toContain('BUSINESS');
    expect(new Set(p).size).toBe(p.length);
  });
});

describe('beide Spreadsheets werden gesichert', () => {
  test('zwei Dateien, je mit Praefix und Datum', async () => {
    const r = await runBackup();
    expect(r.dateien).toBe(2);
    const heute = new Date().toISOString().slice(0, 10);
    expect(namen()).toEqual([`SSOT_Backup-${heute}.json.gz`, `BUSINESS_Backup-${heute}.json.gz`]);
  });

  test('jede Datei traegt die ID ihres eigenen Spreadsheets', async () => {
    const r = await runBackup();
    const ssot = r.backups.find(b => b.praefix === 'SSOT');
    const biz  = r.backups.find(b => b.praefix === 'BUSINESS');
    expect(ssot.spreadsheetId).toBe('ssot-id');
    expect(biz.spreadsheetId).toBe('business-id');
    expect(biz.sheetName).toBe('JF_Business');
    expect(biz.tabCount).toBe(2);
  });

  test('beide landen im Daily-Ordner', async () => {
    await runBackup();
    for (const c of filesCreate.mock.calls) {
      expect(c[0].requestBody.parents).toEqual(['daily-folder']);
    }
  });

  test('jeder Reiter jedes Spreadsheets wird gelesen', async () => {
    await runBackup();
    const gelesen = valuesGet.mock.calls.map(c => `${c[0].spreadsheetId}!${c[0].range}`);
    expect(gelesen).toContain('ssot-id!Erfassungsmaske');
    expect(gelesen).toContain('business-id!Partner_Verkäufe');
    expect(gelesen).toContain('business-id!Kalkulation_Fixkosten');
  });
});

describe('fehlende Spreadsheet-ID bricht ab', () => {
  test.each([
    ['GOOGLE_SHEET_ID'],
    ['BUSINESS_SHEET_ID'],
  ])('%s fehlt → Fehler, und keine Datei hochgeladen', async (key) => {
    delete process.env[key];
    await expect(runBackup()).rejects.toThrow(key);
    expect(filesCreate).not.toHaveBeenCalled();
  });

  test('leere ID zaehlt als fehlend', async () => {
    process.env.BUSINESS_SHEET_ID = '   ';
    await expect(runBackup()).rejects.toThrow('BUSINESS_SHEET_ID');
    expect(filesCreate).not.toHaveBeenCalled();
  });

  test('fehlen beide, nennt die Meldung beide', async () => {
    delete process.env.GOOGLE_SHEET_ID;
    delete process.env.BUSINESS_SHEET_ID;
    const err = await runBackup().catch(e => e);
    expect(err.message).toContain('GOOGLE_SHEET_ID');
    expect(err.message).toContain('BUSINESS_SHEET_ID');
  });
});

describe('ein scheiterndes Ziel macht den Lauf rot', () => {
  // Das zweite Sheet nicht lesbar (Rechte, Tippfehler in der ID): die erste
  // Datei darf bleiben, gruen werden darf der Lauf nicht.
  test('die lesbare Datei wird geschrieben, runBackup wirft trotzdem', async () => {
    sheetsGet.mockImplementation(async ({ spreadsheetId }) => {
      if (spreadsheetId === 'business-id') throw new Error('The caller does not have permission');
      return { data: { properties: { title: 'SSoT' }, sheets: [{ properties: { title: 'Erfassungsmaske' } }] } };
    });
    const err = await runBackup().catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/unvollständig/);
    expect(err.message).toContain('BUSINESS');
    expect(namen()).toHaveLength(1);
    expect(namen()[0]).toMatch(/^SSOT_Backup-/);
  });

  // Das Actions-Log ist oeffentlich: die Meldung nennt Praefix und envKey,
  // aber nie die Spreadsheet-ID.
  test('Fehlermeldung enthaelt keine Spreadsheet-ID', async () => {
    const langeId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
    process.env.BUSINESS_SHEET_ID = langeId;
    sheetsGet.mockImplementation(async ({ spreadsheetId }) => {
      if (spreadsheetId === langeId) throw new Error(`Requested entity was not found: ${langeId}`);
      return { data: { properties: { title: 'SSoT' }, sheets: [{ properties: { title: 'Erfassungsmaske' } }] } };
    });
    const err = await runBackup().catch(e => e);
    expect(err.message).toContain('BUSINESS');
    expect(err.message).toContain('BUSINESS_SHEET_ID');
    expect(err.message).not.toContain(langeId);
    expect(err.message).not.toContain('ssot-id');
  });
});

// Befund B19: das Cloud-Run-Konto ist nur Content-Manager, files.delete geht
// nicht. Alte Backups wandern per files.update in den Papierkorb.
describe('Aufbewahrung: Papierkorb statt Loeschen', () => {
  const alt = '2020-01-01T00:00:00.000Z';
  const neu = () => new Date().toISOString();

  test('Abfrage filtert "trashed = false" - sonst Papierkorb-Dateien bei jedem Lauf erneut', async () => {
    await runBackup();
    expect(filesList).toHaveBeenCalledTimes(2);
    for (const c of filesList.mock.calls) {
      expect(c[0].q).toContain('trashed = false');
      expect(c[0].supportsAllDrives).toBe(true);
    }
  });

  test('alte Backup-Dateien: files.update {trashed:true}, nie files.delete', async () => {
    filesList.mockImplementation(async ({ q }) => ({
      data: { files: q.includes('daily-folder')
        ? [{ id: 'f1', name: 'SSOT_Backup-2020-01-01.json.gz', createdTime: alt },
           { id: 'f2', name: 'BUSINESS_Backup-2020-01-01.json.gz', createdTime: alt }]
        : [] },
    }));
    const r = await runBackup();
    expect(filesDelete).not.toHaveBeenCalled();
    expect(filesUpdate.mock.calls.map(c => c[0])).toEqual([
      { fileId: 'f1', supportsAllDrives: true, requestBody: { trashed: true } },
      { fileId: 'f2', supportsAllDrives: true, requestBody: { trashed: true } },
    ]);
    expect(r.cleanupWarnungen).toEqual([]);
  });

  test('fremde Dateien und junge Backups bleiben unberuehrt', async () => {
    filesList.mockResolvedValue({ data: { files: [
      { id: 'x1', name: 'Notizen.txt', createdTime: alt },
      { id: 'x2', name: 'backup-SSOT_Backup-2020.json.gz', createdTime: alt },
      { id: 'x3', name: 'HONK_Backup-2020-01-01.json.gz', createdTime: alt },
      { id: 'x4', name: 'SSOT_Backup-heute.json.gz', createdTime: neu() },
    ] } });
    await runBackup();
    expect(filesUpdate).not.toHaveBeenCalled();
    expect(filesDelete).not.toHaveBeenCalled();
  });

  // Altlast vor a3b9a1b: MC-Backup-<Datum> / MC-Backup-<Monat>.
  test('MC-Backup-Altlast: aelter als Cutoff wird verschoben, juengere nicht', async () => {
    filesList.mockImplementation(async ({ q }) => ({
      data: { files: q.includes('daily-folder')
        ? [{ id: 'm1', name: 'MC-Backup-2026-08-03.json.gz', createdTime: alt },
           { id: 'm2', name: 'MC-Backup-heute.json.gz',      createdTime: neu() }]
        : [{ id: 'm3', name: 'MC-Backup-2020-01.json.gz',    createdTime: alt }] },
    }));
    await runBackup();
    expect(filesUpdate.mock.calls.map(c => c[0].fileId)).toEqual(['m1', 'm3']);
    expect(filesDelete).not.toHaveBeenCalled();
  });

  test('MC-Backup- wird nie geschrieben, nur aufgeraeumt', async () => {
    await runBackup();
    expect(namen().some(n => n.startsWith('MC-Backup-'))).toBe(false);
  });

  test('fremde Dateien nie, auch nicht mit aehnlichem Namen', async () => {
    filesList.mockResolvedValue({ data: { files: [
      { id: 'y1', name: 'MC-Notizen.json.gz',           createdTime: alt },
      { id: 'y2', name: 'Kopie von MC-Backup-2020.gz',  createdTime: alt },
      { id: 'y3', name: 'mc-backup-2020-01-01.json.gz', createdTime: alt },
    ] } });
    await runBackup();
    expect(filesUpdate).not.toHaveBeenCalled();
  });

  test('Rate limit: Backoff, dann erneuter Versuch', async () => {
    filesList.mockImplementation(async ({ q }) => ({
      data: { files: q.includes('daily-folder')
        ? [{ id: 'f1', name: 'SSOT_Backup-2020-01-01.json.gz', createdTime: alt }]
        : [] },
    }));
    filesUpdate
      .mockRejectedValueOnce(Object.assign(new Error('User rate limit exceeded'), { code: 403 }))
      .mockResolvedValue({ data: {} });
    const r = await runBackup();
    expect(filesUpdate).toHaveBeenCalledTimes(2);
    expect(r.cleanupWarnungen).toEqual([]);
  });

  test('Fehler beim Aufraeumen: nicht fatal, als cleanupWarnungen ohne IDs zurueck', async () => {
    const ordnerId = '0AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    filesList.mockImplementation(async ({ q }) => {
      if (q.includes('daily-folder')) throw new Error(`File not found: ${ordnerId}.`);
      return { data: { files: [] } };
    });
    const r = await runBackup();
    expect(r.dateien).toBe(2);
    expect(r.cleanupWarnungen).toHaveLength(1);
    expect(r.cleanupWarnungen[0]).toMatch(/^Daily-Cleanup fehlgeschlagen/);
    expect(r.cleanupWarnungen[0]).not.toContain(ordnerId);
  });

  test('scheitert das Verschieben einer Datei, nennt die Warnung den Dateinamen', async () => {
    filesList.mockImplementation(async ({ q }) => ({
      data: { files: q.includes('monthly-folder')
        ? [{ id: 'f9', name: 'BUSINESS_Backup-2020-01.json.gz', createdTime: alt }]
        : [] },
    }));
    filesUpdate.mockRejectedValue(Object.assign(new Error('Insufficient permissions'), { code: 403 }));
    const r = await runBackup();
    expect(r.cleanupWarnungen).toEqual([
      'Monthly-Cleanup fehlgeschlagen: BUSINESS_Backup-2020-01.json.gz: Insufficient permissions',
    ]);
  });
});

describe('Retention bleibt wie bisher', () => {
  test('Monatsdatei nur am 1., dann fuer beide Ziele', async () => {
    const ersterMai = new Date('2026-05-01T02:00:00Z');
    jest.useFakeTimers().setSystemTime(ersterMai);
    try {
      await runBackup();
      const monatlich = filesCreate.mock.calls
        .filter(c => c[0].requestBody.parents[0] === 'monthly-folder')
        .map(c => c[0].requestBody.name);
      expect(monatlich).toEqual(['SSOT_Backup-2026-05.json.gz', 'BUSINESS_Backup-2026-05.json.gz']);
    } finally { jest.useRealTimers(); }
  });

  test('an anderen Tagen keine Monatsdatei', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-12T02:00:00Z'));
    try {
      await runBackup();
      expect(filesCreate.mock.calls.every(c => c[0].requestBody.parents[0] === 'daily-folder')).toBe(true);
    } finally { jest.useRealTimers(); }
  });

  test('Cleanup laeuft je Ordner genau einmal', async () => {
    await runBackup();
    const ordner = filesList.mock.calls.map(c => c[0].q);
    expect(ordner.filter(q => q.includes('daily-folder'))).toHaveLength(1);
    expect(ordner.filter(q => q.includes('monthly-folder'))).toHaveLength(1);
  });
});
