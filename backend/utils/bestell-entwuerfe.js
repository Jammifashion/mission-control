// KS7: Entwuerfe aus einem Google-Drive-Ordner auf der Bestellseite - reine Logik ohne Netz. Lesen/Ausliefern in lib/bestellEntwuerfe.js.
//
// Regeln (Inhaber/Otto 08.11.): Ordner nur in der geteilten Ablage "Mission Control" (das Dienstkonto liest dort ohnehin, nichts wird
// geteilt). Der Kunde sieht NIE eine Drive-Adresse oder -ID: die Liste traegt nur laufende Nummer, Titel (Dateiname ohne Endung) und
// Breite/Hoehe; die Bilder liefert das Backend nach Token-Pruefung. Achtung (Messung 08.11.): `thumbnailLink` (lh3.googleusercontent.com)
// laesst sich OHNE Anmeldung abrufen - er verlaesst das Backend nie.

export const ENTWURF_MAX = 30;                      // hoechstens so viele Dateien je Ordner
export const BILD_MAX_BYTE = 8 * 1024 * 1024;       // groesser -> "gross" ueber das Vorschaubild (1600 px)
export const ANTWORT_MAX_BYTE = 10 * 1024 * 1024;   // harte Grenze fuer jede ausgelieferte Datei
export const PX = { klein: 400, gross: 1600 };
export const BILD_TYPEN = ['image/jpeg', 'image/png', 'image/webp'];
export const NUR_VORSCHAU_TYPEN = ['application/pdf'];   // Canva-/PDF-Export: nur als Vorschaubild
export const ORDNER_MIME = 'application/vnd.google-apps.folder';
export const TITEL_MAX = 60;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
const t = v => String(v ?? '').trim();

export function fehler(text, status = 422, code) {
  const e = new Error(text);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/** Ordner-ID aus einem eingefuegten Drive-Link (…/folders/<id>, ?id=<id>) oder der nackten ID. Sonst ''. */
export function ordnerIdAus(link) {
  const s = t(link);
  if (!s) return '';
  const m = /\/folders\/([A-Za-z0-9_-]+)/.exec(s) || /[?&]id=([A-Za-z0-9_-]+)/.exec(s);
  const id = m ? m[1] : s;
  return DRIVE_ID.test(id) ? id : '';
}

/** Titel aus dem Dateinamen: ohne Endung, _ als Leerzeichen, hoechstens 60 Zeichen. */
export function titelAus(name) {
  const x = t(name).replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return x.length > TITEL_MAX ? `${x.slice(0, TITEL_MAX - 1)}…` : x;
}

/** Vorschaubild-Adresse in der gewuenschten Groesse - nur Google-Bildhosts, sonst ''. */
export function vorschauUrl(thumbnailLink, px) {
  const u = t(thumbnailLink);
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/.test(x.host)) return '';
  } catch { return ''; }
  return /=s\d+(-[a-z0-9-]+)?$/.test(u) ? u.replace(/=s\d+(-[a-z0-9-]+)?$/, `=s${px}`) : `${u}=s${px}`;
}

/**
 * Dateiliste des Ordners -> sortierte Entwuerfe (Name, de, numerisch), nur Bild- und PDF-Typen, hoechstens ENTWURF_MAX.
 * Interne Felder (_id, _mime, _thumb, _size, _stand) bleiben im Backend; `fuerSeite` gibt nur nr/titel/breite/hoehe weiter.
 * @param {{id,name,mimeType,size,thumbnailLink,imageMediaMetadata,modifiedTime,trashed}[]} dateien
 */
export function entwurfListe(dateien) {
  const ok = (dateien ?? []).filter(f => !f.trashed && (BILD_TYPEN.includes(f.mimeType) || (NUR_VORSCHAU_TYPEN.includes(f.mimeType) && t(f.thumbnailLink))));
  const sortiert = ok.sort((a, b) => t(a.name).localeCompare(t(b.name), 'de', { numeric: true, sensitivity: 'base' }));
  const liste = sortiert.slice(0, ENTWURF_MAX).map((f, i) => ({
    nr: i + 1, titel: titelAus(f.name) || `Entwurf ${i + 1}`,
    breite: Number(f.imageMediaMetadata?.width) || 0, hoehe: Number(f.imageMediaMetadata?.height) || 0,
    _id: t(f.id), _mime: f.mimeType, _thumb: t(f.thumbnailLink), _size: Number(f.size) || 0, _stand: t(f.modifiedTime),
  }));
  return { liste, mehr: sortiert.length > ENTWURF_MAX, ausgelassen: (dateien ?? []).filter(f => !f.trashed && f.mimeType !== ORDNER_MIME).length - ok.length };
}

/** Feste Feldauswahl fuer Seite und MC - nie ID, Adresse, Dateityp-Interna. */
export const fuerSeite = e => ({ nr: e.nr, titel: e.titel, breite: e.breite, hoehe: e.hoehe });

/**
 * Wie wird ein Entwurf ausgeliefert? -> { weg: 'vorschau', px } | { weg: 'datei' }
 * klein: immer das Vorschaubild (400 px); gross: Bilddatei, wenn <= BILD_MAX_BYTE, sonst/PDF Vorschaubild 1600 px.
 */
export function auslieferWeg(e, groesse) {
  const g = groesse === 'gross' ? 'gross' : 'klein';
  if (g === 'klein' || !BILD_TYPEN.includes(e._mime) || !e._size || e._size > BILD_MAX_BYTE) {
    if (!e._thumb) {
      if (BILD_TYPEN.includes(e._mime) && e._size && e._size <= BILD_MAX_BYTE) return { weg: 'datei' };
      throw fehler('Für diesen Entwurf gibt es (noch) kein Vorschaubild.', 404, 'kein_bild');
    }
    return { weg: 'vorschau', px: PX[g] };
  }
  return { weg: 'datei' };
}

/** Nummer aus der Adresse (1…ENTWURF_MAX), sonst 404. */
export function nrAus(v) {
  const n = Number(t(v));
  if (!Number.isInteger(n) || n < 1 || n > ENTWURF_MAX) throw fehler('Entwurf gibt es nicht.', 404, 'kein_bild');
  return n;
}
