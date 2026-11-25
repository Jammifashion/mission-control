// DTF-Ablage (DT1): geteilte Ablage "DTF Druckdateien Jammifashion" - eigener Ordner, NICHT die Ablage "Mission Control".
// ID = Umgebung DTF_ORDNER_ID, sonst gleichnamiges Secret (Betriebsangabe, nie im Code; fehlt -> 503 `dtf_einrichtung`).
//
// Zwei Anmeldungen (wie Belege/Entwuerfe):
//  - lesen mit drive.readonly (getGoogleAuth): Motiv-Dateien legt der Inhaber von Hand ab - die sieht drive.file nicht.
//  - schreiben mit drive.file: nur Ordner Motive/ Kunden/ Bestellungen/ (legt das Setup an), Upload in Motive/<Bezug>/, Kopie der
//    Kundenmotive nach Kunden/<AU-Nr>/ (lesen -> hochladen, kein files.copy) und die Bestell-XML. Nie loeschen, nie ueberschreiben,
//    nie freigeben (das Dienstkonto ist dort ohnehin nur Mitwirkender).
// Vorschaubilder nur ueber das Backend (thumbnailLink verlaesst es nie, Muster KS7). Log/Fehlertexte ohne Drive-IDs.

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { getGoogleAuth, googleAuthMitScopes } from './googleAuth.js';
import { getSecret } from '../utils/secrets.js';
import { vorschauUrl, ORDNER_MIME } from '../utils/bestell-entwuerfe.js';
import { fehler, DATEI_TYPEN, DATEI_MAX_BYTE, sichererDateiname, pixelMasse } from '../utils/dtf-korb.js';

// antwort-DT1-3: Rueckmeldung/ wird nur angelegt (leer) - Nicos Rueckmeldungen lesen kommt spaeter.
export const ORDNER = { MOTIVE: 'Motive', KUNDEN: 'Kunden', BESTELLUNGEN: 'Bestellungen', RUECKMELDUNG: 'Rueckmeldung' };
const SCHREIB_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const INFO_MS = 10 * 60 * 1000, ZEIT_MS = 15000, BILD_MS = 10 * 60 * 1000;
const t = v => String(v ?? '').trim();
const qText = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export const md5 = buf => createHash('md5').update(buf).digest('hex');

let _lesen = null, _schreiben = null;
async function driveLesen() { if (!_lesen) _lesen = google.drive({ version: 'v3', auth: await getGoogleAuth() }); return _lesen; }
function driveSchreiben() { if (!_schreiben) _schreiben = google.drive({ version: 'v3', auth: googleAuthMitScopes(SCHREIB_SCOPES) }); return _schreiben; }

let infoCache = new Map();   // id -> { zeit, info }
let ordnerCache = new Map(); // "<parent>/<name>" -> id
let nameCache = new Map();   // ordnerId -> { name, parent }
let bildCache = new Map();   // "<id>|<groesse>" -> { zeit, buf, typ }
export function _dtfAblageCacheLeeren() { infoCache = new Map(); ordnerCache = new Map(); nameCache = new Map(); bildCache = new Map(); }

/** ID der DTF-Ablage oder 503. */
export async function dtfAblageId() {
  const env = t(process.env.DTF_ORDNER_ID);
  if (env) return env;
  let s = '';
  try { s = t(await getSecret('DTF_ORDNER_ID')); } catch { s = ''; }
  if (!s) throw fehler('DTF-Ablage ist nicht eingerichtet (Secret DTF_ORDNER_ID fehlt).', 503, 'dtf_einrichtung');
  return s;
}
const mcAblage = () => t(process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID);

function driveFehler(err, was) {
  if (err?.status && err?.code && typeof err.code === 'string') return err;
  const st = err?.code ?? err?.response?.status;
  return fehler(`${was} gerade nicht möglich${st ? ` (Drive ${st})` : ''} – gleich noch einmal.`, 502, 'drive');
}

async function kinder(drive, driveId, parentId, name, nurOrdner) {
  const { data } = await drive.files.list({
    corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 10,
    q: `'${parentId}' in parents and name = '${qText(name)}' and trashed = false${nurOrdner ? ` and mimeType = '${ORDNER_MIME}'` : ''}`,
    fields: 'files(id,name,md5Checksum,size,mimeType)',
  });
  return data.files ?? [];
}

/** Ordner unter parent finden bzw. (anlegen) anlegen - mit drive.file: nur selbst angelegte sind sichtbar. */
async function ordner(drive, driveId, parentId, name, anlegen) {
  const k = `${parentId}/${name}`;
  if (ordnerCache.has(k)) return ordnerCache.get(k);
  const da = await kinder(drive, driveId, parentId, name, true);
  if (da.length > 1) throw fehler(`Ordner „${name}“ gibt es mehrfach in der DTF-Ablage – bitte bereinigen.`, 409, 'dtf_ordner');
  let id = da[0]?.id ?? null;
  if (!id && anlegen) {
    const { data } = await drive.files.create({ requestBody: { name, mimeType: ORDNER_MIME, parents: [parentId] }, supportsAllDrives: true, fields: 'id' });
    id = data.id;
  }
  if (id) ordnerCache.set(k, id);
  return id;
}

/** Pfad (Ordnernamen) unter der DTF-Ablage anlegen/finden -> id. */
async function pfadOrdner(teile, { anlegen = true, drive = driveSchreiben() } = {}) {
  const driveId = await dtfAblageId();
  let parent = driveId;
  for (const teil of teile) {
    parent = await ordner(drive, driveId, parent, teil, anlegen);
    if (!parent) return null;
  }
  return parent;
}

/** Einrichtung: Motive/ Kunden/ Bestellungen/ (nur mit write). Warnt, wenn ein gleichnamiger Ordner von Hand angelegt wurde. */
export async function richteDtfAblageEin({ write = false } = {}) {
  const log = [];
  const driveId = await dtfAblageId();
  const lesen = await driveLesen(), schreiben = driveSchreiben();
  for (const name of Object.values(ORDNER)) {
    const eigen = await kinder(schreiben, driveId, driveId, name, true);
    const alle = await kinder(lesen, driveId, driveId, name, true);
    if (eigen.length === 1) { log.push(`Drive: ${name}/ vorhanden (von MC angelegt) – nicht angefasst.`); continue; }
    if (alle.length > eigen.length) log.push(`⚠ Drive: ${name}/ gibt es schon (von Hand angelegt) – MC kann dort nicht schreiben; bitte umbenennen, dann Setup erneut.`);
    if (!write) { log.push(`Drive: ${name}/ fehlt -> würde angelegt.`); continue; }
    if (alle.length > eigen.length) continue;
    const id = await ordner(schreiben, driveId, driveId, name, true);
    log.push(id ? `✓ Drive: ${name}/ angelegt.` : `✗ Drive: ${name}/ nicht angelegt.`);
  }
  return log;
}

/** Rechte des Dienstkontos auf der DTF-Ablage (nur lesen). */
export async function ablageRechte() {
  const driveId = await dtfAblageId();
  const { data } = await (await driveLesen()).drives.get({ driveId, fields: 'name,capabilities(canAddChildren,canEdit,canDeleteChildren)' });
  return { name: data.name, anlegen: !!data.capabilities?.canAddChildren, bearbeiten: !!data.capabilities?.canEdit, loeschen: !!data.capabilities?.canDeleteChildren };
}

// ── Lesen ────────────────────────────────────────────────────────────────────

const FELDER = 'id,name,mimeType,size,md5Checksum,driveId,parents,trashed,thumbnailLink,imageMediaMetadata(width,height),modifiedTime';

/** Ordnerpfad einer Datei unterhalb der Ablage ("Motive/CH-X"), ueber parents (zwischengespeichert). */
async function pfadVon(drive, parents, driveId) {
  const teile = [];
  let p = parents?.[0];
  for (let i = 0; p && p !== driveId && i < 8; i++) {
    let n = nameCache.get(p);
    if (!n) {
      const { data } = await drive.files.get({ fileId: p, fields: 'id,name,parents', supportsAllDrives: true });
      n = { name: data.name, parent: data.parents?.[0] ?? null };
      nameCache.set(p, n);
    }
    teile.unshift(n.name);
    p = n.parent;
  }
  return teile.join('/');
}

/**
 * Info je Datei-ID (10 min zwischengespeichert): { da, name, pfad, mime, breitePx, hoehePx, ablage: 'dtf'|'mc'|'fremd' }.
 * Nicht gefunden / Papierkorb -> da false. Drive nicht erreichbar -> da null (Ampel "unbekannt"), kein Fehler.
 */
export async function dateiInfos(ids, { drive: d, jetzt = Date.now, frisch = false } = {}) {
  const out = new Map();
  const offen = [...new Set((ids ?? []).map(t).filter(Boolean))];
  let driveId = '';
  try { driveId = await dtfAblageId(); } catch { /* ohne Ablage: alles unbekannt */ }
  const drive = d ?? await driveLesen();
  const warte = [];
  for (const id of offen) {
    const c = infoCache.get(id);
    if (c && !frisch && jetzt() - c.zeit < INFO_MS) { out.set(id, c.info); continue; }
    warte.push(id);
  }
  for (let i = 0; i < warte.length; i += 5) {
    await Promise.all(warte.slice(i, i + 5).map(async id => {
      let info;
      try {
        const { data } = await drive.files.get({ fileId: id, fields: FELDER, supportsAllDrives: true });
        const ablage = data.driveId === driveId ? 'dtf' : data.driveId && data.driveId === mcAblage() ? 'mc' : 'fremd';
        info = { da: !data.trashed && ablage !== 'fremd', name: data.name, mime: data.mimeType, ablage,
          breitePx: Number(data.imageMediaMetadata?.width) || null, hoehePx: Number(data.imageMediaMetadata?.height) || null,
          pfad: ablage === 'dtf' ? [await pfadVon(drive, data.parents, driveId), data.name].filter(Boolean).join('/') : data.name,
          _thumb: data.thumbnailLink ?? '', _size: Number(data.size) || 0, _md5: data.md5Checksum ?? '', _parents: data.parents ?? [] };
        infoCache.set(id, { zeit: jetzt(), info });
      } catch (err) {
        const st = Number(err?.code ?? err?.response?.status);
        info = [403, 404].includes(st) ? { da: false } : { da: null };
        if (info.da === false) infoCache.set(id, { zeit: jetzt(), info });
      }
      out.set(id, info);
    }));
  }
  return out;
}
export const dateiOeffentlich = (id, i) => ({ id, name: i?.name ?? '', pfad: i?.pfad ?? '', breitePx: i?.breitePx ?? null, hoehePx: i?.hoehePx ?? null, ablage: i?.ablage ?? '', da: i?.da ?? null });

/** Suche nach Dateinamen in der ganzen DTF-Ablage (Bilder/PDF/SVG), hoechstens 30. */
export async function sucheDateien(q, { drive: d } = {}) {
  const s = t(q);
  if (s.length < 2) return [];
  if (s.length > 60) throw fehler('Suchbegriff: höchstens 60 Zeichen.');
  const driveId = await dtfAblageId();
  const drive = d ?? await driveLesen();
  try {
    const typen = DATEI_TYPEN.map(m => `mimeType = '${m}'`).join(' or ');
    const { data } = await drive.files.list({
      corpora: 'drive', driveId, includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 30, orderBy: 'name',
      q: `name contains '${qText(s)}' and trashed = false and (${typen})`, fields: `files(${FELDER})`,
    });
    const liste = [];
    for (const f of data.files ?? []) {
      const info = { da: true, name: f.name, mime: f.mimeType, ablage: 'dtf', breitePx: Number(f.imageMediaMetadata?.width) || null,
        hoehePx: Number(f.imageMediaMetadata?.height) || null, pfad: [await pfadVon(drive, f.parents, driveId), f.name].filter(Boolean).join('/'),
        _thumb: f.thumbnailLink ?? '', _size: Number(f.size) || 0, _md5: f.md5Checksum ?? '', _parents: f.parents ?? [] };
      infoCache.set(f.id, { zeit: Date.now(), info });
      liste.push(dateiOeffentlich(f.id, info));
    }
    return liste;
  } catch (err) { throw driveFehler(err, 'Suche'); }
}

/** Entwuerfe eines Auftrags: Ordner "Entwürfe/<AU-Nr>" in der Ablage "Mission Control" (nur lesen). */
export async function auftragEntwuerfe(auNr, { drive: d } = {}) {
  if (!/^AU-\d{4}-\d{4}$/.test(t(auNr))) return [];
  const mc = mcAblage();
  if (!mc) return [];
  const drive = d ?? await driveLesen();
  try {
    const wurzel = (await kinder(drive, mc, mc, 'Entwürfe', true))[0];
    if (!wurzel) return [];
    const o = (await kinder(drive, mc, wurzel.id, t(auNr), true))[0];
    if (!o) return [];
    const typen = DATEI_TYPEN.map(m => `mimeType = '${m}'`).join(' or ');
    const { data } = await drive.files.list({
      corpora: 'drive', driveId: mc, includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 30, orderBy: 'name',
      q: `'${o.id}' in parents and trashed = false and (${typen})`, fields: `files(${FELDER})`,
    });
    return (data.files ?? []).map(f => {
      const info = { da: true, name: f.name, mime: f.mimeType, ablage: 'mc', breitePx: Number(f.imageMediaMetadata?.width) || null,
        hoehePx: Number(f.imageMediaMetadata?.height) || null, pfad: f.name, _thumb: f.thumbnailLink ?? '', _size: Number(f.size) || 0,
        _md5: f.md5Checksum ?? '', _parents: f.parents ?? [], _au: t(auNr) };
      infoCache.set(f.id, { zeit: Date.now(), info });
      return dateiOeffentlich(f.id, info);
    });
  } catch (err) { throw driveFehler(err, 'Entwürfe lesen'); }
}

/** Vorschaubild (klein 200 px / gross 1200 px) - nur Dateien der DTF-Ablage bzw. Entwuerfe in "Mission Control". */
export async function vorschau(id, groesse, { holen = fetch, jetzt = Date.now } = {}) {
  const g = groesse === 'gross' ? 'gross' : 'klein';
  const k = `${t(id)}|${g}`;
  const c = bildCache.get(k);
  if (c && jetzt() - c.zeit < BILD_MS) return c;
  const info = (await dateiInfos([id])).get(t(id));
  if (!info?.da || !['dtf', 'mc'].includes(info.ablage)) throw fehler('Datei nicht gefunden.', 404, 'kein_bild');
  const url = vorschauUrl(info._thumb, g === 'gross' ? 1200 : 200);
  if (!url) throw fehler('Für diese Datei gibt es (noch) kein Vorschaubild.', 404, 'kein_bild');
  let res;
  try {
    res = await holen(url, { redirect: 'error', signal: AbortSignal.timeout(ZEIT_MS) });
    if ([401, 403].includes(res.status)) {
      const tok = (await (await (await getGoogleAuth()).getClient()).getAccessToken())?.token;
      if (tok) res = await holen(url, { redirect: 'error', headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(ZEIT_MS) });
    }
  } catch { throw fehler('Vorschaubild gerade nicht erreichbar.', 502, 'drive'); }
  if (!res.ok) throw fehler(`Vorschaubild gerade nicht erreichbar (${res.status}).`, 502, 'drive');
  const typ = String(res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!/^image\//.test(typ)) throw fehler('Kein Bild.', 502, 'kein_bild');
  const buf = Buffer.from(await res.arrayBuffer());
  const e = { zeit: jetzt(), buf, typ };
  bildCache.set(k, e);
  if (bildCache.size > 200) bildCache.delete(bildCache.keys().next().value);
  return e;
}

// ── Schreiben (drive.file) ───────────────────────────────────────────────────

/** Upload in Motive/<Bezug>/ (Originalname). Gleicher Name: gleiche MD5 -> vorhandene Datei, sonst 409. */
export async function ladeMotivHoch({ bezug, name, mime, buf, drive = driveSchreiben() } = {}) {
  const b = t(bezug);
  if (!b || b.length > 60 || /[\\/]/.test(b)) throw fehler('Bezug für den Ordner fehlt oder enthält „/“.');
  const n = sichererDateiname(name);
  if (!DATEI_TYPEN.includes(t(mime))) throw fehler('Dateityp bitte PNG, JPG, WEBP, TIFF, SVG oder PDF.');
  if (!buf?.length) throw fehler('Datei ist leer.');
  if (buf.length > DATEI_MAX_BYTE) throw fehler('Datei ist zu groß (höchstens 40 MB).', 413, 'zu_gross');
  const summe = md5(buf);
  try {
    const driveId = await dtfAblageId();
    const parent = await pfadOrdner([ORDNER.MOTIVE, b], { drive });
    const da = await kinder(drive, driveId, parent, n, false);
    if (da.length) {
      if (da.length === 1 && da[0].md5Checksum === summe) return { id: da[0].id, name: n, vorhanden: true, px: pixelMasse(buf) };
      throw fehler(`„${n}“ liegt in Motive/${b} schon mit anderem Inhalt – bitte umbenennen.`, 409, 'datei_vorhanden');
    }
    const { data } = await drive.files.create({
      requestBody: { name: n, parents: [parent], mimeType: mime }, media: { mimeType: mime, body: Readable.from(buf) },
      supportsAllDrives: true, fields: 'id,md5Checksum,size',
    });
    if (data.md5Checksum !== summe || String(data.size) !== String(buf.length)) throw fehler('Upload: Rücklesen weicht ab – bitte in Drive prüfen.', 502, 'drive');
    infoCache.delete(data.id);
    return { id: data.id, name: n, vorhanden: false, px: pixelMasse(buf) };
  } catch (err) { throw driveFehler(err, 'Hochladen'); }
}

/**
 * Kundenmotiv (Entwurf in "Mission Control") nach Kunden/<AU-Nr>/ kopieren: lesen (readonly) -> hochladen (drive.file).
 * Gleicher Name + gleiche MD5 = schon da. -> { id, pfad }
 */
export async function kopiereKundenmotiv({ id, auNr, lesen: l, schreiben = driveSchreiben() } = {}) {
  if (!/^AU-\d{4}-\d{4}$/.test(t(auNr))) throw fehler('Kundenmotiv: Auftragsnummer fehlt.');
  const info = (await dateiInfos([id])).get(t(id));
  if (!info?.da || info.ablage !== 'mc') throw fehler('Kundenmotiv nicht gefunden.', 404, 'kein_bild');
  const lesen = l ?? await driveLesen();
  try {
    const r = await lesen.files.get({ fileId: t(id), alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    const buf = Buffer.from(r.data);
    if (buf.length > DATEI_MAX_BYTE) throw fehler('Kundenmotiv ist zu groß (höchstens 40 MB).', 413, 'zu_gross');
    const driveId = await dtfAblageId();
    const parent = await pfadOrdner([ORDNER.KUNDEN, t(auNr)], { drive: schreiben });
    const name = sichererDateiname(info.name);
    const pfad = `${ORDNER.KUNDEN}/${t(auNr)}/${name}`;
    const summe = md5(buf);
    const da = await kinder(schreiben, driveId, parent, name, false);
    if (da.length) {
      if (da.length === 1 && da[0].md5Checksum === summe) return { id: da[0].id, pfad };
      throw fehler(`${pfad} liegt schon mit anderem Inhalt – bitte in Drive prüfen.`, 409, 'datei_vorhanden');
    }
    const { data } = await schreiben.files.create({
      requestBody: { name, parents: [parent], mimeType: info.mime }, media: { mimeType: info.mime, body: Readable.from(buf) },
      supportsAllDrives: true, fields: 'id,md5Checksum,size',
    });
    if (data.md5Checksum !== summe) throw fehler('Kopie: Rücklesen weicht ab – bitte in Drive prüfen.', 502, 'drive');
    return { id: data.id, pfad };
  } catch (err) { throw driveFehler(err, 'Kundenmotiv kopieren'); }
}

/**
 * Bestell-XML nach Bestellungen/<id>.xml - GENAU EIN Versuch, nie wiederholt.
 * -> { ergebnis: 'liegt', id } | { ergebnis: 'nicht-da', grund } (vor der Uebertragung abgelehnt) | { ergebnis: 'unklar', grund }
 */
export async function legeXmlAb({ dateiname, inhalt, drive = driveSchreiben() } = {}) {
  let parent;
  try {
    parent = await pfadOrdner([ORDNER.BESTELLUNGEN], { anlegen: false, drive });
    if (!parent) return { ergebnis: 'nicht-da', grund: 'Ordner Bestellungen/ fehlt – erst Setup (scripts/setup-dtf-korb.js --write).' };
    const driveId = await dtfAblageId();
    if ((await kinder(drive, driveId, parent, dateiname, false)).length) return { ergebnis: 'unklar', grund: `${dateiname} liegt schon in Bestellungen/.` };
  } catch (err) {
    return { ergebnis: 'nicht-da', grund: driveFehler(err, 'Ablegen').message };
  }
  const buf = Buffer.from(inhalt, 'utf8');
  try {
    const { data } = await drive.files.create({
      requestBody: { name: dateiname, parents: [parent], mimeType: 'application/xml' },
      media: { mimeType: 'application/xml', body: Readable.from(buf) }, supportsAllDrives: true, fields: 'id,size,md5Checksum',
    });
    if (String(data.size) !== String(buf.length) || data.md5Checksum !== md5(buf)) return { ergebnis: 'unklar', grund: 'Rücklesen weicht ab', id: data.id };
    return { ergebnis: 'liegt', id: data.id };
  } catch (err) {
    const st = Number(err?.response?.status ?? err?.code);
    // 4xx = Anfrage abgelehnt (es entsteht keine Datei); alles andere (Zeitlimit, 5xx, Netz) = unklar
    if (st >= 400 && st < 500 && st !== 408) return { ergebnis: 'nicht-da', grund: `Drive ${st}` };
    return { ergebnis: 'unklar', grund: st ? `Drive ${st}` : 'keine Antwort' };
  }
}

/** Liegt Bestellungen/<dateiname> (fuer "Prüfen" bei unklar)? -> { liegt, id } */
export async function findeXml(dateiname, { drive = driveSchreiben() } = {}) {
  try {
    const parent = await pfadOrdner([ORDNER.BESTELLUNGEN], { anlegen: false, drive });
    if (!parent) return { liegt: false };
    const da = await kinder(drive, await dtfAblageId(), parent, dateiname, false);
    return da.length ? { liegt: true, id: da[0].id } : { liegt: false };
  } catch (err) { throw driveFehler(err, 'Prüfen'); }
}
