// LK1: Links wieder kopierbar - Token zusaetzlich VERSCHLUESSELT speichern (Bestellseiten, Partner, FP_Partner).
//
// Geprueft wird weiter NUR ueber den SHA-256-Hash (Token_Hash, timingSafeEqual). Daneben steht hinten die Spalte
// `Token_Verschluesselt` = AES-256-GCM des Tokens, zufaelliger IV (12 Byte) je Wert, Auth-Tag 16 Byte. Der Wert ist an seine
// Zeile gebunden (Zusatzdaten = Kontext, z. B. "bestellseite:BS-001", "lizenz:P-001"): in eine andere Zeile kopiert, laesst
// er sich nicht entschluesseln. Form: `v1.<iv>.<tag>.<geheimtext>` (base64url). `v1` = Schluessel-Version (spaeterer
// Schluesselwechsel: neue Version + neues Secret, alte Werte bleiben lesbar, bis neu erzeugt).
//
// Schluessel nur im Secret Manager (`LINK_SCHLUESSEL`, 32 Byte, als 64 Hex-Zeichen oder base64), nie im Sheet, Code, Log,
// Postfach. Fehlt er, laufen die Links weiter (nur der Hash zaehlt), MC zeigt "Kopieren nicht verfuegbar".
// Fehlertexte nennen nie Token, Schluessel oder Geheimtext.

import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'crypto';

export const SPALTE_VERSCHLUESSELT = 'Token_Verschluesselt';
export const VERSION = 'v1';
export const SECRET_JE_VERSION = { v1: 'LINK_SCHLUESSEL' };

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const B64URL = /^[A-Za-z0-9_-]+$/;

export class LinkSchluesselFehler extends Error {
  constructor(meldung = 'Link lässt sich nicht entschlüsseln.') { super(meldung); this.name = 'LinkSchluesselFehler'; this.code = 'link_schluessel'; }
}

/** Schluessel aus dem Secret-Text: 64 Hex-Zeichen oder base64/base64url von genau 32 Byte. Sonst null. */
export function schluesselAus(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return b.length === 32 ? b : null;
  }
  return null;
}

function pruefeSchluessel(schluessel) {
  if (!Buffer.isBuffer(schluessel) || schluessel.length !== 32) throw new LinkSchluesselFehler('Link-Schlüssel fehlt oder ist ungültig.');
}
function pruefeKontext(kontext) {
  const k = String(kontext ?? '').trim();
  if (!k) throw new LinkSchluesselFehler('Kontext fehlt.');
  return Buffer.from(k, 'utf8');
}

/** Token verschluesseln. Jeder Aufruf mit neuem Zufalls-IV (gleicher Token -> anderer Wert). */
export function verschluessele(token, schluessel, kontext, { iv = randomBytes(IV_LEN) } = {}) {
  pruefeSchluessel(schluessel);
  const aad = pruefeKontext(kontext);
  const klar = String(token ?? '');
  if (!klar) throw new LinkSchluesselFehler('Nichts zu verschlüsseln.');
  const c = createCipheriv(ALGO, schluessel, iv, { authTagLength: TAG_LEN });
  c.setAAD(aad);
  const geheim = Buffer.concat([c.update(klar, 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64url'), c.getAuthTag().toString('base64url'), geheim.toString('base64url')].join('.');
}

/** Version eines gespeicherten Werts ('' = kein gueltiges Format). */
export function versionVon(wert) {
  const teile = String(wert ?? '').trim().split('.');
  return teile.length === 4 && SECRET_JE_VERSION[teile[0]] ? teile[0] : '';
}

/** Entschluesseln. Falscher Schluessel, falscher Kontext, verfaelschter Wert -> LinkSchluesselFehler (ohne Inhalt). */
export function entschluessele(wert, schluessel, kontext) {
  pruefeSchluessel(schluessel);
  const aad = pruefeKontext(kontext);
  const teile = String(wert ?? '').trim().split('.');
  if (teile.length !== 4 || teile[0] !== VERSION || !teile.slice(1).every(x => B64URL.test(x))) throw new LinkSchluesselFehler('Gespeicherter Wert hat kein gültiges Format.');
  const iv = Buffer.from(teile[1], 'base64url');
  const tag = Buffer.from(teile[2], 'base64url');
  const geheim = Buffer.from(teile[3], 'base64url');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN || !geheim.length) throw new LinkSchluesselFehler('Gespeicherter Wert hat kein gültiges Format.');
  try {
    const d = createDecipheriv(ALGO, schluessel, iv, { authTagLength: TAG_LEN });
    d.setAAD(aad);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(geheim), d.final()]).toString('utf8');
  } catch {
    throw new LinkSchluesselFehler();
  }
}

const sha256 = x => createHash('sha256').update(String(x), 'utf8').digest('hex');

/**
 * Token fuer "Link kopieren" in MC.
 *   { status: 'ok', token }        - entschluesselt UND Hash passt zum Token_Hash der Zeile
 *   { status: 'alt' }              - kein verschluesselter Wert (Link vor LK1 erzeugt): erst einmal neu erzeugen
 *   { status: 'kein_schluessel' }  - Secret fehlt: Kopieren nicht verfuegbar, Links laufen weiter
 *   { status: 'fehler' }           - laesst sich nicht entschluesseln oder gehoert nicht zum gueltigen Hash (veraltet)
 *   { status: 'ohne_link' }        - Zeile hat gar keinen Link
 */
export function tokenFuerMc({ wert, hash, schluessel, kontext }) {
  const h = String(hash ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return { status: 'ohne_link' };
  if (!String(wert ?? '').trim()) return { status: 'alt' };
  if (!schluessel) return { status: 'kein_schluessel' };
  let token;
  try { token = entschluessele(wert, schluessel, kontext); } catch { return { status: 'fehler' }; }
  const passt = timingSafeEqual(Buffer.from(sha256(token), 'hex'), Buffer.from(h, 'hex'));
  return passt ? { status: 'ok', token } : { status: 'fehler' };
}

/** Texte fuer MC (ohne Wert). Gemeinsam fuer Bestellseiten und Partner. */
export const LINK_HINWEIS = {
  alt: 'Dieser Link wurde vor LK1 erstellt – zum Kopieren einmal neu erzeugen (alter wird ungültig).',
  kein_schluessel: 'Kopieren nicht verfügbar (Link-Schlüssel fehlt). Der Link funktioniert weiter.',
  fehler: 'Gespeicherter Link passt nicht mehr – zum Kopieren einmal neu erzeugen (alter wird ungültig).',
  ohne_link: 'Noch kein Link erzeugt.',
};

/** Fehlerobjekt fuer die Routen: 409 mit Code = Status, Text aus LINK_HINWEIS. */
export function linkFehler(status) {
  return Object.assign(new Error(LINK_HINWEIS[status] ?? 'Link nicht verfügbar.'), { status: 409, code: `link_${status}` });
}
