// PPS1: Zugang zu den Partnerportalen (partner.html, partner-festpreis.html). Einzige Stelle fuer Pruefen und Erzeugen.
//
// Im Business-Sheet (Reiter `Partner` und `FP_Partner`) steht je Partner hinten `Token_Hash` = SHA-256 (hex) des Tokens.
// Uebergang: solange die alte Spalte `Token` noch Klartext traegt und `Token_Hash` leer ist, gilt der Klartext (gehasht
// verglichen). Hat eine Zeile einen Hash, zaehlt NUR der Hash. Ist `Token` ueberall leer, gibt es nur noch den Hash.
// Ein bestehender Link (UUID v4, 122 Bit Zufall) bleibt derselbe: sein Hash wird nur einmal ausgerechnet (Umstellungsskript).
// Neue Tokens erzeugt nur das Backend: randomBytes(32), base64url. Der Klartext verlaesst MC genau einmal (Antwort an MC).
//
// Nie den Token oder seinen Hash in Log, Fehlertext, Antwort an das Portal oder Tests mit echten Werten.

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const SPALTE_TOKEN = 'Token';           // alt: Klartext, wird nach der Umstellung geleert
export const SPALTE_HASH  = 'Token_Hash';      // neu, hinten angehaengt
export const PORTAL_SEITE = {
  lizenz:    'https://jammifashion.github.io/mission-control/partner.html',
  festpreis: 'https://jammifashion.github.io/mission-control/partner-festpreis.html',
};

const HEX64 = /^[0-9a-f]{64}$/;

export function tokenHash(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

// Vergleich zweier Hashes (hex) mit fester Laufzeit. Ungueltige Werte = ungleich.
export function hashGleich(a, b) {
  const x = String(a ?? '').trim().toLowerCase();
  const y = String(b ?? '').trim().toLowerCase();
  if (!HEX64.test(x) || !HEX64.test(y)) return false;
  return timingSafeEqual(Buffer.from(x, 'hex'), Buffer.from(y, 'hex'));
}

// Sucht die Zeile zum Token. Liefert { zeile, art: 'hash' | 'klartext' } oder null.
// Jede Zeile wird geprueft (keine Abkuerzung beim ersten Treffer), damit die Laufzeit nicht von der Position abhaengt.
export function findeZeileZumToken(header, rows, token) {
  const t = String(token ?? '').trim();
  if (!t) return null;
  const iHash = header.indexOf(SPALTE_HASH);
  const iTok  = header.indexOf(SPALTE_TOKEN);
  if (iHash === -1 && iTok === -1) return null;
  const gesucht = tokenHash(t);
  let treffer = null;
  for (const r of rows) {
    const h = iHash !== -1 ? String(r[iHash] ?? '').trim() : '';
    let ok, art;
    if (h) { ok = hashGleich(h, gesucht); art = 'hash'; }
    else {
      const k = iTok !== -1 ? String(r[iTok] ?? '').trim() : '';
      ok = k !== '' && hashGleich(tokenHash(k), gesucht);
      art = 'klartext';
    }
    if (ok && !treffer) treffer = { zeile: r, art };
  }
  return treffer;
}

// Zustand fuer MC (ohne Wert): 'hash' | 'klartext' | ''.
export function zugangArt(header, row) {
  const iHash = header.indexOf(SPALTE_HASH);
  const iTok  = header.indexOf(SPALTE_TOKEN);
  if (iHash !== -1 && String(row[iHash] ?? '').trim()) return 'hash';
  if (iTok !== -1 && String(row[iTok] ?? '').trim()) return 'klartext';
  return '';
}

// Klartext fuer "Link kopieren" in MC - nur im Uebergang und nur, solange kein Hash gesetzt ist
// (sonst koennte ein alter Klartext neben einem neuen Hash stehen und waere ohnehin ungueltig).
export function klartextFuerMc(header, row) {
  return zugangArt(header, row) === 'klartext' ? String(row[header.indexOf(SPALTE_TOKEN)] ?? '').trim() : '';
}

export function neuerToken() {
  return randomBytes(32).toString('base64url');
}

export function portalLink(art, token, { shop } = {}) {
  const basis = PORTAL_SEITE[art];
  if (!basis) throw new Error(`Unbekannte Portal-Art ${art}.`);
  const shopTeil = art === 'lizenz' && shop === 'honk' ? '&shop=honk' : '';
  return `${basis}?token=${encodeURIComponent(token)}${shopTeil}`;
}

// Plan fuer das Umstellungsskript (reine Logik). Je Zeile mit Klartext:
//  - Hash leer            -> Hash schreiben ('neu')
//  - Hash = Hash(Klartext) -> nichts ('schon')
//  - Hash anders           -> nichts, Konflikt (der Hash gilt, der Klartext ist veraltet) ('konflikt')
// leeren=true: Klartext leeren, aber NUR in Zeilen, deren Hash SCHON im Sheet steht und zum Klartext passt ('schon').
// Hash schreiben und Klartext leeren sind zwei getrennte Laeufe (dazwischen: Push + Test an einem echten Link).
// Konfliktzeilen werden nie angefasst.
export function umstellungsPlan(header, rows, { leeren = false } = {}) {
  const iTok = header.indexOf(SPALTE_TOKEN);
  const iHash = header.indexOf(SPALTE_HASH);
  const plan = { neu: [], schon: [], konflikt: [], leeren: [], ohneToken: 0, nurHash: 0 };
  rows.forEach((r, i) => {
    const k = iTok !== -1 ? String(r[iTok] ?? '').trim() : '';
    const h = iHash !== -1 ? String(r[iHash] ?? '').trim() : '';
    if (!k) { if (h) plan.nurHash++; else plan.ohneToken++; return; }
    const soll = tokenHash(k);
    if (!h) plan.neu.push({ index: i, hash: soll });
    else if (hashGleich(h, soll)) { plan.schon.push({ index: i }); if (leeren) plan.leeren.push({ index: i }); }
    else plan.konflikt.push({ index: i });
  });
  return plan;
}
