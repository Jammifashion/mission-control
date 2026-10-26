// BO4b-2: Archiv der L-Shop-Belege in der geteilten Ablage (lib/belegArchiv.js) gegen eine Drive-Attrappe.
// Ordner L-Shop Belege/<Art>/<Jahr> anlegen (nur anlegen), Datei unveraendert hochladen und per MD5 +
// Groesse zuruecklesen, gleicher Name: gleiche MD5 -> vorhandene ID, andere -> Konflikt, nie ueberschreiben.
// Quelltext: kein Loeschen/Ueberschreiben/Papierkorb, Scope drive.file nur hier.

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { archiviere, zielOrdner, richteArchivEin, md5, ArchivFehler, ArchivKonflikt, WURZEL, ARCHIV_SCOPES, _archivCacheLeeren } from '../lib/belegArchiv.js';

const hier = dirname(fileURLToPath(import.meta.url));
const backend = resolve(hier, '..');
const DRIVE = 'shared-drive-id-xyz';

/** Drive-Attrappe: Dateien { id, name, parent, mimeType, md5Checksum, size }. */
function driveAttrappe({ dateien = [], kaputtesMd5 = false, fehler } = {}) {
  let n = 0;
  const aufrufe = { list: 0, create: [] };
  const files = {
    list: async ({ q }) => {
      aufrufe.list++;
      if (fehler) throw fehler;
      const parent = /'([^']+)' in parents/.exec(q)[1];
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)[1].replace(/\\'/g, "'");
      const nurOrdner = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      return { data: { files: dateien.filter(f => f.parent === parent && f.name === name && (!nurOrdner || f.mimeType === 'application/vnd.google-apps.folder')) } };
    },
    create: async ({ requestBody, media }) => {
      const f = { id: `id${++n}`, name: requestBody.name, parent: requestBody.parents[0], mimeType: requestBody.mimeType };
      if (media) {
        const teile = [];
        for await (const c of media.body) teile.push(Buffer.from(c));
        const buf = Buffer.concat(teile);
        f.md5Checksum = kaputtesMd5 ? 'falsch' : md5(buf);
        f.size = String(buf.length);
        f.inhalt = buf;
      }
      dateien.push(f);
      aufrufe.create.push({ name: f.name, parent: f.parent, mimeType: f.mimeType, media: Boolean(media), mediaMime: media?.mimeType });
      return { data: { id: f.id, md5Checksum: f.md5Checksum, size: f.size } };
    },
  };
  return { drive: { files }, dateien, aufrufe };
}

const XML = Buffer.from([0xff, 0xfe, ...Buffer.from('<root/>', 'utf16le')]);
const opts = (d, o = {}) => ({ art: 'Lieferbestaetigung', jahr: '2026', name: 'DeliveryConfirmation_20261021204643.xml', buf: XML, mime: 'application/xml', drive: d.drive, driveId: DRIVE, ...o });

beforeEach(() => _archivCacheLeeren());

describe('archiviere', () => {
  test('neu: legt L-Shop Belege/Lieferbestaetigung/2026 an, laedt unveraendert hoch, MD5 + Groesse zurueckgelesen', async () => {
    const d = driveAttrappe();
    const r = await archiviere(opts(d));
    expect(r).toEqual({ status: 'neu', id: 'id4' });
    expect(d.aufrufe.create.map(c => [c.name, c.mimeType])).toEqual([
      [WURZEL, 'application/vnd.google-apps.folder'], ['Lieferbestaetigung', 'application/vnd.google-apps.folder'],
      ['2026', 'application/vnd.google-apps.folder'], ['DeliveryConfirmation_20261021204643.xml', 'application/xml'],
    ]);
    expect(d.aufrufe.create[0].parent).toBe(DRIVE);
    expect(d.aufrufe.create[3]).toMatchObject({ media: true, mediaMime: 'application/xml', parent: 'id3' });
    expect(d.dateien.at(-1).inhalt.equals(XML)).toBe(true);
  });

  test('zweiter Aufruf mit gleicher Datei: vorhandene ID, nichts doppelt angelegt', async () => {
    const d = driveAttrappe();
    const a = await archiviere(opts(d));
    _archivCacheLeeren();
    const b = await archiviere(opts(d));
    expect(b).toEqual({ status: 'vorhanden', id: a.id });
    expect(d.aufrufe.create).toHaveLength(4);
  });

  test('gleicher Name, anderer Inhalt -> ArchivKonflikt, nichts ueberschrieben; mehrfach -> Konflikt', async () => {
    const d = driveAttrappe();
    await archiviere(opts(d));
    await expect(archiviere(opts(d, { buf: Buffer.from('anders') }))).rejects.toBeInstanceOf(ArchivKonflikt);
    expect(d.aufrufe.create).toHaveLength(4);
    d.dateien.push({ ...d.dateien.at(-1), id: 'doppelt' });
    await expect(archiviere(opts(d))).rejects.toThrow(/2-mal im Archiv/);
  });

  test('Ruecklesen weicht ab -> ArchivFehler; Drive-Fehler -> ArchivFehler ohne IDs', async () => {
    await expect(archiviere(opts(driveAttrappe({ kaputtesMd5: true })))).rejects.toThrow(/Rücklesen weicht ab/);
    const e = await archiviere(opts(driveAttrappe({ fehler: Object.assign(new Error(`backend error in ${DRIVE}`), { code: 503 }) }))).catch(x => x);
    expect(e).toBeInstanceOf(ArchivFehler);
    expect(e.message).toBe('Drive 503: backend error in <id>');
  });

  test('Trockenlauf: legt weder Ordner noch Datei an', async () => {
    const d = driveAttrappe();
    expect(await archiviere(opts(d, { dryRun: true }))).toEqual({ status: 'wuerde angelegt', id: '' });
    expect(d.aufrufe.create).toEqual([]);
    await archiviere(opts(d));
    _archivCacheLeeren();
    const d2 = driveAttrappe({ dateien: d.dateien.filter(f => f.mimeType === 'application/vnd.google-apps.folder') });
    expect(await archiviere(opts(d2, { dryRun: true }))).toEqual({ status: 'wuerde angelegt', id: '' });
    expect(d2.aufrufe.create).toEqual([]);
  });

  test('Ordner mehrfach -> ArchivFehler; unbekannte Art / Jahr -> ArchivFehler; Name mit Apostroph sicher', async () => {
    const d = driveAttrappe({ dateien: [
      { id: 'a', name: WURZEL, parent: DRIVE, mimeType: 'application/vnd.google-apps.folder' },
      { id: 'b', name: WURZEL, parent: DRIVE, mimeType: 'application/vnd.google-apps.folder' },
    ] });
    await expect(archiviere(opts(d))).rejects.toThrow(/mehrfach/);
    await expect(zielOrdner({ art: 'Bestand', jahr: '2026', drive: driveAttrappe().drive, driveId: DRIVE })).rejects.toThrow(/Unbekannte Belegart/);
    await expect(zielOrdner({ art: 'Rechnung_PDF', jahr: '26', drive: driveAttrappe().drive, driveId: DRIVE })).rejects.toThrow(/Ungültiges Jahr/);
    const d3 = driveAttrappe();
    expect((await archiviere(opts(d3, { name: "R'1.xml" }))).status).toBe('neu');
  });
});

describe('richteArchivEin', () => {
  test('Trockenlauf nichts, --write fuenf Art-Ordner (BO4c: + Bestellung) + Jahr, danach vorhanden', async () => {
    const d = driveAttrappe();
    const t = await richteArchivEin({ jahr: '2026', drive: d.drive, driveId: DRIVE });
    expect(t).toHaveLength(5);
    expect(t[4]).toMatch(/Bestellung\/2026 fehlt/);
    expect(t[0]).toMatch(/fehlt -> wuerde angelegt/);
    expect(d.aufrufe.create).toEqual([]);
    const w = await richteArchivEin({ write: true, jahr: '2026', drive: d.drive, driveId: DRIVE });
    expect(w.every(z => z.startsWith('✓'))).toBe(true);
    expect(d.aufrufe.create).toHaveLength(1 + 5 + 5);
    _archivCacheLeeren();
    const n = await richteArchivEin({ write: true, jahr: '2026', drive: d.drive, driveId: DRIVE });
    expect(n.every(z => z.includes('vorhanden - nicht angefasst'))).toBe(true);
    expect(d.aufrufe.create).toHaveLength(11);
  });
});

describe('Quelltext-Regeln', () => {
  const code = readFileSync(join(backend, 'lib/belegArchiv.js'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  test('nie loeschen, ueberschreiben, Papierkorb, Freigaben', () => {
    for (const verboten of ['files.delete', 'files.update', 'emptyTrash', 'permissions', 'files.copy', 'drives.']) expect(code).not.toContain(verboten);
    expect(code).not.toMatch(/trashed\s*[:=]\s*true/);
    expect(code).not.toMatch(/addParents|removeParents/);
    expect([...code.matchAll(/files\.(\w+)/g)].map(m => m[1]).sort()).toEqual(['create', 'create', 'list']);
  });

  test('engster Scope drive.file, nur hier', () => {
    expect(ARCHIV_SCOPES).toEqual(['https://www.googleapis.com/auth/drive.file']);
    const treffer = [];
    const lauf = dir => {
      for (const n of readdirSync(dir)) {
        if (['node_modules', 'tests', '.git'].includes(n)) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) lauf(p);
        else if (/\.js$/.test(n) && readFileSync(p, 'utf8').includes('auth/drive.file')) treffer.push(relative(backend, p).replace(/\\/g, '/'));
      }
    };
    lauf(backend);
    expect(treffer).toEqual(['lib/belegArchiv.js']);
  });

  test('Drive-Dateien anlegen nur im Archiv und im Backup', () => {
    const treffer = [];
    const lauf = dir => {
      for (const n of readdirSync(dir)) {
        if (['node_modules', 'tests', '.git'].includes(n)) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) lauf(p);
        else if (/\.js$/.test(n) && /drive\.files\.create|files\.create\(/.test(readFileSync(p, 'utf8'))) treffer.push(relative(backend, p).replace(/\\/g, '/'));
      }
    };
    lauf(backend);
    expect(treffer.sort()).toEqual(['lib/belegArchiv.js', 'scripts/backup-daily.js']);
  });
});
