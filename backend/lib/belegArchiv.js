// Archiv der L-Shop-Belege in der geteilten Ablage (BO4b-2) - die einzige Stelle, die in Drive SCHREIBT
// (Test beleg-archiv.test.js). Ziel: <geteilte Ablage>/L-Shop Belege/<Art>/<Jahr>/<Dateiname>,
// Art = Lieferbestaetigung | Auftragsbestaetigung | Rechnung_XML | Rechnung_PDF. Nie die Bestandsdatei.
//
// Eigene Anmeldung mit dem engsten Scope drive.file: MC sieht und aendert nur Dateien und Ordner, die
// es selbst angelegt hat (nicht Backups, nicht Stammdaten, nichts von Hand Abgelegtes). Deshalb legt
// MC auch den Ordner "L-Shop Belege" selbst an - ein von Hand angelegter waere unsichtbar.
//
// Regeln: Datei unveraendert (Bytes, gleicher Name, keine Umwandlung), nach dem Hochladen size + MD5
// zurueckgelesen. Name schon da: gleiche MD5 -> vorhandene ID, nichts angelegt; andere MD5 oder mehrfach
// -> ArchivKonflikt (Alarm, nichts ueberschrieben). NIE loeschen, ueberschreiben oder in den Papierkorb.
// Wiederholbar: ein zweiter Aufruf mit derselben Datei legt nichts doppelt an.

import { createHash } from 'crypto';
import { Readable } from 'stream';
import { google } from 'googleapis';
import { googleAuthMitScopes } from './googleAuth.js';

export const ARCHIV_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
export const WURZEL = 'L-Shop Belege';
export const ARTEN = ['Lieferbestaetigung', 'Auftragsbestaetigung', 'Rechnung_XML', 'Rechnung_PDF', 'Bestellung'];   // Bestellung: BO4c (gesendete EDI-Datei)
const ORDNER_MIME = 'application/vnd.google-apps.folder';

/** Drive nicht erreichbar oder Ruecklesen weicht ab -> Datei gilt als nicht verarbeitet. */
export class ArchivFehler extends Error {
  constructor(message) { super(message); this.name = 'ArchivFehler'; this.code = 'archiv'; }
}
/** Gleicher Name mit anderem Inhalt (oder mehrfach) -> Alarm, nichts ueberschrieben. */
export class ArchivKonflikt extends Error {
  constructor(message) { super(message); this.name = 'ArchivKonflikt'; this.code = 'archiv_konflikt'; }
}

let _drive = null;
function driveClient() {
  if (!_drive) _drive = google.drive({ version: 'v3', auth: googleAuthMitScopes(ARCHIV_SCOPES) });
  return _drive;
}

const ordnerCache = new Map();   // "<driveId>/<pfad>" -> id
export function _archivCacheLeeren() { ordnerCache.clear(); _drive = null; }

export const md5 = buf => createHash('md5').update(buf).digest('hex');
const qText = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const ohneIds = (s, ids) => { let x = String(s ?? ''); for (const i of ids) if (i) x = x.split(i).join('<id>'); return x.slice(0, 160); };

async function kinder(drive, driveId, parentId, name, nurOrdner) {
  const { data } = await drive.files.list({
    corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true,
    q: `'${parentId}' in parents and name = '${qText(name)}' and trashed = false${nurOrdner ? ` and mimeType = '${ORDNER_MIME}'` : ''}`,
    fields: 'files(id,name,md5Checksum,size,mimeType)', pageSize: 10,
  });
  return data.files ?? [];
}

/** Ordner finden oder (wenn anlegen) anlegen. Mehrfach vorhanden -> ArchivFehler. */
async function ordner(drive, driveId, parentId, name, anlegen) {
  const da = await kinder(drive, driveId, parentId, name, true);
  if (da.length > 1) throw new ArchivFehler(`Ordner "${name}" gibt es mehrfach - bitte in Drive bereinigen.`);
  if (da.length === 1) return { id: da[0].id, neu: false };
  if (!anlegen) return { id: null, neu: false };
  const { data } = await drive.files.create({
    requestBody: { name, mimeType: ORDNER_MIME, parents: [parentId] }, supportsAllDrives: true, fields: 'id',
  });
  return { id: data.id, neu: true };
}

/** Pfad L-Shop Belege/<art>/<jahr>; mit anlegen=false -> id null, wenn ein Teil fehlt. */
export async function zielOrdner({ art, jahr, anlegen = true, drive = driveClient(), driveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID } = {}) {
  if (!driveId) throw new ArchivFehler('GOOGLE_DRIVE_SHARED_DRIVE_ID fehlt.');
  if (!ARTEN.includes(art)) throw new ArchivFehler(`Unbekannte Belegart "${art}".`);
  if (!/^20\d{2}$/.test(String(jahr))) throw new ArchivFehler(`Ungültiges Jahr "${jahr}".`);
  let parent = driveId;
  const pfad = [];
  for (const teil of [WURZEL, art, String(jahr)]) {
    pfad.push(teil);
    const key = `${driveId}/${pfad.join('/')}`;
    if (ordnerCache.has(key)) { parent = ordnerCache.get(key); continue; }
    const o = await ordner(drive, driveId, parent, teil, anlegen);
    if (!o.id) return null;
    ordnerCache.set(key, o.id);
    parent = o.id;
  }
  return parent;
}

/**
 * Eine Belegdatei archivieren.
 * -> { status: 'neu' | 'vorhanden' | 'wuerde angelegt', id }
 * Wirft ArchivKonflikt (gleicher Name, anderer Inhalt / mehrfach) oder ArchivFehler (Drive, Ruecklesen).
 */
export async function archiviere({ art, jahr, name, buf, mime, dryRun = false, drive = driveClient(), driveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID } = {}) {
  const ids = [driveId];
  const summe = md5(buf);
  try {
    const parent = await zielOrdner({ art, jahr, anlegen: !dryRun, drive, driveId });
    if (!parent) return { status: 'wuerde angelegt', id: '' };
    const da = await kinder(drive, driveId, parent, name, false);
    if (da.length > 1) throw new ArchivKonflikt(`${art}/${jahr}/${name} gibt es ${da.length}-mal im Archiv`);
    if (da.length === 1) {
      if (da[0].md5Checksum === summe) return { status: 'vorhanden', id: da[0].id };
      throw new ArchivKonflikt(`${art}/${jahr}/${name} liegt im Archiv mit anderem Inhalt - nichts überschrieben`);
    }
    if (dryRun) return { status: 'wuerde angelegt', id: '' };
    const { data } = await drive.files.create({
      requestBody: { name, parents: [parent], mimeType: mime },
      media: { mimeType: mime, body: Readable.from(buf) },
      supportsAllDrives: true, fields: 'id,md5Checksum,size',
    });
    if (data.md5Checksum !== summe || String(data.size) !== String(buf.length)) {
      throw new ArchivFehler(`${art}/${jahr}/${name}: Rücklesen weicht ab (Größe/MD5)`);
    }
    return { status: 'neu', id: data.id };
  } catch (err) {
    if (err instanceof ArchivKonflikt || err instanceof ArchivFehler) throw err;
    const code = err?.code ?? err?.response?.status ?? '';
    throw new ArchivFehler(`Drive${code ? ` ${code}` : ''}: ${ohneIds(err?.message ?? err, ids)}`);
  }
}

/** Einrichtung: L-Shop Belege + vier Art-Ordner + Jahr anlegen (nur mit write). -> Logzeilen. */
export async function richteArchivEin({ write = false, jahr = String(new Date().getFullYear()), drive = driveClient(), driveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID } = {}) {
  const log = [];
  for (const art of ARTEN) {
    const vorher = await zielOrdner({ art, jahr, anlegen: false, drive, driveId });
    if (vorher) { log.push(`Drive: ${WURZEL}/${art}/${jahr} vorhanden - nicht angefasst.`); continue; }
    if (!write) { log.push(`Drive: ${WURZEL}/${art}/${jahr} fehlt -> wuerde angelegt.`); continue; }
    const id = await zielOrdner({ art, jahr, anlegen: true, drive, driveId });
    log.push(id ? `✓ Drive: ${WURZEL}/${art}/${jahr} angelegt.` : `✗ Drive: ${WURZEL}/${art}/${jahr} nicht angelegt.`);
    if (!id) throw new ArchivFehler(`${WURZEL}/${art}/${jahr} nicht angelegt.`);
  }
  return log;
}
