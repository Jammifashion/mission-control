// Karton-Scan (BO4b-5 Schritt 2): reine Logik - Link-Muster, PDF-Text lesen, Karton gegen den Korb abgleichen.
// Ein-/Ausgabe in lib/karton.js. Keine Zugriffe, kein Netz.
//
// Der QR-Code auf dem L-Shop-Karton fuehrt zu einer PDF je KARTON (Inhaber 27.10.):
//   https://textilelogistics.eu/pdf/<2>/<2>/<Kundennummer>_<Karton-ID>_<64 Hex>.pdf
// ⚠️ Der Link enthaelt unsere L-Shop-Kundennummer: nie speichern, loggen, zurueckgeben oder in Fehlertexte.
// Weitergegeben wird nur die Karton-ID.
//
// PDF-Aufbau (gemessen 27.10., Text-PDF ohne Kompression, Type1/WinAnsi): je Textstueck ein Block
// "BT /Fx n Tf x y Td (Text) Tj ET". Seite 1 oben links: "LA… VA…", order_id, (leer), Commission. Je Gruppe:
// Referenzzeile links (unsere reference), Kopfzeile "Article-No | SKU | Color | Size | Ord. | Qty.", Datenzeilen,
// "Subtotal". Am Ende eine Gesamtzeile, unten die Seitenzahl. Jede Datenzeile ist ein Stueck (Ord. 1) - gleiche
// Zeilen stehen mehrfach. Menge = Summe "Ord." je reference + SKU. "Qty" ist falsch und wird nie benutzt.

import zlib from 'zlib';

export const KARTON_LINK = /^https:\/\/textilelogistics\.eu\/pdf\/[0-9A-F]{2}\/[0-9A-F]{2}\/(\d{1,12})_(\d{1,12})_[0-9A-F]{64}\.pdf$/;
export const MAX_KARTON_BYTES = 1024 * 1024;
const t = v => String(v ?? '').trim();

function fehler(msg, status) { const e = new Error(msg); e.status = status; return e; }

/** Link pruefen -> { kunde, kartonId }; ungueltig -> 400 ohne den Link im Text. */
export function kartonLink(link) {
  const m = KARTON_LINK.exec(t(link));
  if (!m) throw fehler('Link ungültig - nur der QR-Link vom L-Shop-Karton (textilelogistics.eu/pdf/…) geht.', 400);
  return { kunde: m[1], kartonId: m[2] };
}

// WinAnsi (cp1252) 0x80-0x9F; Rest wie Latin-1.
const CP1252 = { 0x80: '€', 0x84: '„', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0x91: '‘', 0x92: '’', 0x85: '…' };
function pdfString(roh) {
  let s = '';
  for (let i = 0; i < roh.length; i++) {
    const c = roh[i];
    if (c !== '\\') { s += c; continue; }
    const n = roh[++i];
    if (/[0-7]/.test(n)) {
      let okt = n;
      while (okt.length < 3 && /[0-7]/.test(roh[i + 1] ?? '')) okt += roh[++i];
      s += String.fromCharCode(parseInt(okt, 8));
    } else s += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n] ?? n;
  }
  return [...s].map(ch => CP1252[ch.charCodeAt(0)] ?? ch).join('');
}

/** Inhalts-Streams der PDF (unkomprimiert; FlateDecode als Rueckfall). */
function streams(buf) {
  const roh = buf.toString('latin1');
  const out = [];
  let pos = 0;
  while ((pos = roh.indexOf('stream', pos)) >= 0) {
    if (roh.slice(pos - 3, pos) === 'end') { pos += 6; continue; }
    let start = pos + 6;
    if (roh[start] === '\r') start++;
    if (roh[start] === '\n') start++;
    const ende = roh.indexOf('endstream', start);
    if (ende < 0) break;
    const dict = roh.slice(Math.max(0, roh.lastIndexOf('<<', pos)), pos);
    let inhalt = roh.slice(start, ende);
    if (/\/FlateDecode/.test(dict)) {
      try { inhalt = zlib.inflateSync(buf.subarray(start, ende)).toString('latin1'); } catch { inhalt = ''; }
    }
    if (/\bBT\b/.test(inhalt)) out.push(inhalt);
    pos = ende + 9;
  }
  return out;
}

/** Textstuecke je Seite: [{ x, y, s }] (Td-Koordinaten, je BT neu). */
function textstuecke(inhalt) {
  const stuecke = [];
  let x = 0, y = 0;
  const re = /\bBT\b|(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g;
  for (const m of inhalt.matchAll(re)) {
    if (m[0] === 'BT') { x = 0; y = 0; }
    else if (m[1] !== undefined) { x = +m[5]; y = +m[6]; }
    else if (m[7] !== undefined) { x += +m[7]; y += +m[8]; }
    else stuecke.push({ x: Math.round(x), y: Math.round(y), s: pdfString(m[9]).trim() });
  }
  return stuecke;
}

const SPALTEN = [['Article-No', 'articleNo'], ['SKU', 'sku'], ['Color', 'color'], ['Size', 'size'], ['Ord.', 'ord'], ['Qty.', 'qty']];

/**
 * Karton-PDF lesen.
 * -> { orderId, la, va, gruppen: [{ reference, zeilen: [{articleNo, sku, color, size, ord}] }], positionen, stueck, hinweise }
 * positionen = je reference + SKU zusammengefasst (ord = Summe), Qty nie.
 */
export function leseKartonPdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw fehler('Keine PDF.', 422);
  const seiten = streams(buf).map(textstuecke);
  if (!seiten.length) throw fehler('PDF ohne lesbaren Text.', 422);
  let orderId = '', la = '', va = '';
  const gruppen = [];
  const hinweise = [];
  let spalten = null;          // [{ x, feld }] aus der letzten Kopfzeile
  let linksZuletzt = '';       // letzte Textzeile ganz links (Kandidat fuer die reference)
  let gruppe = null;
  let subtotalOrd = 0;
  for (const stuecke of seiten) {
    const zeilen = new Map();
    for (const s of stuecke) (zeilen.get(s.y) ?? zeilen.set(s.y, []).get(s.y)).push(s);
    for (const [, z] of [...zeilen].sort((a, b) => b[0] - a[0])) {
      z.sort((a, b) => a.x - b.x);
      const texte = z.map(s => s.s).filter(Boolean);
      if (!texte.length) continue;
      const ganz = texte.join(' ');
      if (texte.includes('Article-No') && texte.includes('SKU')) {
        spalten = SPALTEN.map(([kopf, feld]) => ({ x: z.find(s => s.s === kopf || (kopf === 'Qty.' && s.s === 'Qty'))?.x, feld })).filter(c => c.x !== undefined);
        gruppe = { reference: linksZuletzt, zeilen: [] };
        gruppen.push(gruppe);
        linksZuletzt = '';
        continue;
      }
      if (texte[0] === 'Subtotal') { subtotalOrd += Number(texte[1]) || 0; continue; }
      if (/^Page\s+\d+\/\d+$|^Seite\s+\d+\/\d+$/i.test(ganz) || z[0].y < 40) continue;
      const sku = spalten && z.find(s => /^\d{10}$/.test(s.s));
      if (sku && gruppe) {
        const zeile = {};
        for (const s of z) {
          const sp = [...spalten].reverse().find(c => c.x <= s.x + 5);
          if (sp && sp.feld !== 'qty') zeile[sp.feld] = zeile[sp.feld] ? `${zeile[sp.feld]} ${s.s}` : s.s;
        }
        const ord = Number(zeile.ord);
        if (!/^\d{10}$/.test(zeile.sku ?? '') || !Number.isInteger(ord) || ord < 0) { hinweise.push('Zeile nicht lesbar'); continue; }
        gruppe.zeilen.push({ articleNo: t(zeile.articleNo), sku: zeile.sku, color: t(zeile.color), size: t(zeile.size), ord });
        continue;
      }
      // Kopf: LA/VA, order_id; sonst Textzeile links (Commission oder reference)
      const laM = /\bLA\d{8}\b/.exec(ganz), vaM = /\bVA\d{8}\b/.exec(ganz), oM = /\bJFN-\d{4}-\d{4}\b/.exec(ganz);
      if (!la && laM) la = laM[0];
      if (!va && vaM) va = vaM[0];
      if (!orderId && oM && ganz === oM[0]) { orderId = oM[0]; continue; }
      if (laM || vaM) continue;
      if (z[0].x < 60 && z.length === 1) linksZuletzt = ganz;
    }
  }
  const je = new Map();
  for (const g of gruppen) for (const z of g.zeilen) {
    const k = `${g.reference}\u0000${z.sku}`;
    const p = je.get(k) ?? je.set(k, { reference: g.reference, sku: z.sku, articleNo: z.articleNo, color: z.color, size: z.size, ord: 0, zeilen: 0 }).get(k);
    p.ord += z.ord; p.zeilen++;
  }
  const positionen = [...je.values()];
  const stueck = positionen.reduce((n, p) => n + p.ord, 0);
  if (subtotalOrd && subtotalOrd !== stueck) hinweise.push(`Summe Ord. ${stueck} weicht von den Zwischensummen (${subtotalOrd}) ab`);
  if (!orderId) hinweise.push('keine order_id im Karton');
  if (!positionen.length) hinweise.push('keine Positionen gelesen');
  return { orderId, la, va, gruppen, positionen, stueck, hinweise };
}

export const AMPEL = { OK: 'ok', GELB: 'gelb', ROT: 'rot' };

/**
 * Karton gegen den Korb abgleichen.
 * @param {object}   o
 * @param {object}   o.karton      leseKartonPdf(...)
 * @param {object[]} o.korbZeilen  korbZeilen(...).zeilen
 * @param {Function} o.referenz    Korb-Zeile -> reference (referenzFuer aus utils/edi-bestellung.js)
 * @param {object}   [o.schonDa]   Zeile aus LShop_Kartons zu dieser Karton-ID ({ Eingang })
 * -> { ampel, grund, positionen: [{ ...pdf, schluessel, menge, status, ampel, text, waehlbar, vorgewaehlt }], nichtImKarton }
 */
export function kartonAbgleich({ karton, korbZeilen, referenz, schonDa }) {
  const id = t(karton.orderId);
  const derBestellung = (korbZeilen ?? []).filter(z => t(z.Bestell_ID) === id && id);
  if (!id || !derBestellung.length) {
    return { ampel: AMPEL.ROT, grund: id ? `${id} ist keine bekannte L-Shop-Bestellung im Korb` : 'keine order_id im Karton', positionen: [], nichtImKarton: [] };
  }
  const jeRefSku = new Map();
  for (const z of derBestellung) jeRefSku.set(`${referenz(z)}\u0000${t(z.LShop_ArticleNr)}`, z);
  const benutzt = new Set();
  const positionen = karton.positionen.map(p => {
    const z = jeRefSku.get(`${p.reference}\u0000${p.sku}`);
    const basis = { ...p, schluessel: z?.Schluessel ?? '', menge: z ? Number(z.Menge) || 0 : null, status: z?.Status ?? '' };
    if (!z) return { ...basis, ampel: AMPEL.GELB, text: 'nicht im Korb', waehlbar: false, vorgewaehlt: false };
    benutzt.add(z.Schluessel);
    if (z.Status === 'geliefert') return { ...basis, ampel: AMPEL.GELB, text: 'schon geliefert', waehlbar: false, vorgewaehlt: false };
    if (z.Status !== 'bestellt') return { ...basis, ampel: AMPEL.GELB, text: `Status "${z.Status}"`, waehlbar: false, vorgewaehlt: false };
    if (basis.menge !== p.ord) return { ...basis, ampel: AMPEL.GELB, text: `Menge anders (Korb ${basis.menge}, Karton ${p.ord})`, waehlbar: true, vorgewaehlt: false };
    return { ...basis, ampel: AMPEL.OK, text: 'passt', waehlbar: true, vorgewaehlt: true };
  });
  const nichtImKarton = derBestellung.filter(z => !benutzt.has(z.Schluessel) && z.Status === 'bestellt')
    .map(z => ({ schluessel: z.Schluessel, reference: referenz(z), sku: t(z.LShop_ArticleNr), menge: Number(z.Menge) || 0 }));
  const gelb = positionen.some(p => p.ampel !== AMPEL.OK) || karton.hinweise.length > 0;
  return {
    ampel: schonDa || gelb ? AMPEL.GELB : AMPEL.OK,
    grund: schonDa ? `Karton schon eingegangen am ${t(schonDa.Eingang).slice(0, 10)}` : '',
    positionen, nichtImKarton,
  };
}

// Protokoll der bestaetigten Kartons (SSOT). Nie Link, nie Kundennummer.
export const KARTONS_TAB = 'LShop_Kartons';
export const KARTONS_SPALTEN = ['Karton_ID', 'LA', 'VA', 'order_id', 'Eingang', 'Quelle', 'Positionen', 'Abweichungen', 'Datei', 'Drive_ID', 'Stand'];
export const kartonDatei = (la, kartonId) => `${t(la) || 'ohne-LA'}_${t(kartonId)}.pdf`;
