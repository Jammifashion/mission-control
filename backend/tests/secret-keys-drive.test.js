// Cloud Run setzt per --set-env-vars nur NODE_ENV und GOOGLE_PROJECT_ID; alles
// andere kommt ueber loadAllSecrets() aus dem Secret Manager nach process.env.
// Die Drive-IDs standen nicht in SECRET_KEYS - /api/backup/manual scheiterte
// deshalb in Cloud Run mit "GOOGLE_DRIVE_SHARED_DRIVE_ID fehlt", obwohl das
// Secret angelegt war. Diese Suite haelt fest: jede GOOGLE_DRIVE_*-Variable,
// die der Backup-Code liest, wird auch geladen.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

jest.unstable_mockModule('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {},
}));

const here = dirname(fileURLToPath(import.meta.url));
const QUELLEN = ['../scripts/backup-daily.js', '../routes/backup.js'];

const driveNamen = datei => {
  const src = readFileSync(resolve(here, datei), 'utf8');
  return [...src.matchAll(/process\.env\.(GOOGLE_DRIVE_[A-Z0-9_]+)/g)].map(m => m[1]);
};

let SECRET_KEYS;
beforeAll(async () => {
  ({ SECRET_KEYS } = await import('../utils/secrets.js'));
});

describe('Drive-IDs in SECRET_KEYS', () => {
  test('die drei Drive-Secrets stehen drin', () => {
    expect(SECRET_KEYS).toEqual(expect.arrayContaining([
      'GOOGLE_DRIVE_SHARED_DRIVE_ID',
      'GOOGLE_DRIVE_BACKUP_DAILY_ID',
      'GOOGLE_DRIVE_BACKUP_MONTHLY_ID',
    ]));
  });

  test.each(QUELLEN)('jede GOOGLE_DRIVE_*-Variable aus %s wird geladen', datei => {
    const namen = driveNamen(datei);
    expect(namen.length).toBeGreaterThan(0);
    for (const n of namen) expect(SECRET_KEYS).toContain(n);
  });
});
