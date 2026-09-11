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

jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class { constructor(o) { this.o = o; } } },
    sheets: jest.fn(() => ({ spreadsheets: { get: sheetsGet, values: { get: valuesGet } } })),
    drive:  jest.fn(() => ({ files: { create: filesCreate, list: filesList, delete: filesDelete } })),
  },
}));

let runBackup, ZIELE;

const ENV_KEYS = [
  'GOOGLE_SHEET_ID', 'BUSINESS_SHEET_ID', 'GOOGLE_DRIVE_SHARED_DRIVE_ID',
  'GOOGLE_DRIVE_BACKUP_DAILY_ID', 'GOOGLE_DRIVE_BACKUP_MONTHLY_ID',
  'GOOGLE_CREDENTIALS_JSON',
];
let gesichert = {};

beforeAll(async () => {
  ({ runBackup, ZIELE } = await import('../scripts/backup-daily.js'));
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
