// L-Shop-Rueckstandsliste (RS1) - reine Logik ohne Netz. Lesen aus Drive in lib/rueckstand.js.
//
// Die Datei (jeden Mittwoch per Mail, vom Apps Script als Rueckstandsliste_JJJJ-MM-TT.xlsx abgelegt) ist ein xlsx ohne
// Standard-Stil: exceljs findet kein Blatt (Blattdatei "Sheet1.xml" gross geschrieben), openpyxl bricht ab. Deshalb liest
// leseXlsxZeilen das Zip selbst (jszip): Beziehung workbook -> erstes Blatt, sharedStrings, Zellen nach Spaltenbuchstabe.
// Gelesen werden NUR die Spalten A-O. P-T (Lieferempfaenger, Strasse, PLZ, Ort, Land) werden nie gelesen, nie gespeichert,
// nie geloggt. Kommission kann Kundenbezug tragen - sie dient nur der Zuordnung und geht nie in Log/Chat.

export const RUECKSTAND_MUSTER = /^Rueckstandsliste_(\d{4})-(\d{2})-(\d{2})\.xlsx$/;
export const SPALTEN = ['kundenNr', 'auftrag', 'inet', 'fremdbeleg', 'kommission', 'bestelldatum', 'articleNr', 'katalogNr',
  'bezeichnung', 'farbe', 'groesse', 'bestellt', 'geliefert', 'rueckstand', 'liefertermin'];   // A-O, P-T nie
export const VERALTET_TAGE = 8;
export const STATUS = { SOFORT: 'sofort', KW: 'kw', KLAERUNG: 'in Klärung', UNBEKANNT: 'unbekannt', SONST: 'sonstig' };

const t = v => String(v ?? '').trim();
const xmlText = s => String(s ?? '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const spalteIndex = ref => [...String(ref).replace(/\d+/g, '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/**
 * xlsx (Buffer) -> Zeilen (Array je Zeile, Zellwerte als Text, nur die ersten `breite` Spalten). jszip wird uebergeben.
 * Leere Zeilen bleiben als [] stehen (Zeilennummer = Index + 1).
 */
export async function leseXlsxZeilen(buffer, JSZip, { breite = 15 } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const datei = name => Object.values(zip.files).find(f => f.name.toLowerCase() === name.toLowerCase());
  const wb = await datei('xl/workbook.xml')?.async('string');
  const rels = await datei('xl/_rels/workbook.xml.rels')?.async('string');
  if (!wb || !rels) throw new Error('Rückstandsliste: keine xlsx-Datei (workbook fehlt).');
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  const ziel = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
  const pfad = ziel ? (ziel.startsWith('/') ? ziel.slice(1) : `xl/${ziel}`) : '';
  const blatt = await (datei(pfad) ?? Object.values(zip.files).find(f => /^xl\/worksheets\/[^/]+\.xml$/i.test(f.name)))?.async('string');
  if (!blatt) throw new Error('Rückstandsliste: kein Tabellenblatt gefunden.');
  const ss = await datei('xl/sharedStrings.xml')?.async('string') ?? '';
  const shared = [...ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => xmlText(x[1])).join(''));
  const zeilen = [];
  for (const row of blatt.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const nr = Number(/\br="(\d+)"/.exec(row[1] ?? row[3] ?? '')?.[1] ?? zeilen.length + 1);
    const z = [];
    for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = c[1], inhalt = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/i.exec(attr)?.[1];
      const i = ref ? spalteIndex(ref) : z.length;
      if (i < 0 || i >= breite) continue;
      const typ = /\bt="([^"]+)"/.exec(attr)?.[1] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inhalt)?.[1];
      z[i] = typ === 's' ? (shared[Number(v)] ?? '') : typ === 'inlineStr' ? [...inhalt.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => xmlText(x[1])).join('') : xmlText(v ?? '');
    }
    zeilen[nr - 1] = Array.from({ length: breite }, (_, i) => t(z[i]));
  }
  return Array.from({ length: zeilen.length }, (_, i) => zeilen[i] ?? []);
}

/** "1.0" / "2" / 2 -> 2; sonst null. */
export const zahl = v => { const n = Number(t(v).replace(',', '.')); return Number.isFinite(n) && t(v) !== '' ? Math.round(n) : null; };
/** LieferantArtNr: 10 Ziffern (auch als "9000000120.0" oder 9.00000012E9 gelesen). */
export function articleNr(v) {
  const s = t(v);
  if (/^\d{10}$/.test(s)) return s;
  const n = Number(s);
  return Number.isInteger(n) && String(n).length === 10 ? String(n) : '';
}

/**
 * Liefertermin-Text -> Teilmengen [{ menge, status, kw, jahr, text }]. Form "n Stk <Status>", mehrere moeglich (Zeilenumbruch,
 * Komma, Semikolon oder einfach hintereinander). Ohne "n Stk": eine Teilmenge ohne Menge.
 */
export function parseLiefertermin(text) {
  const s = t(text).replace(/\s+/g, ' ');
  if (!s) return [];
  const teile = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*Stk\.?\s*(.*?)(?=\s*[,;]?\s*\d+(?:[.,]\d+)?\s*Stk\b|$)/gi)];
  const roh = teile.length ? teile.map(m => ({ menge: zahl(m[1]), rest: t(m[2]).replace(/[,;]$/, '') })) : [{ menge: null, rest: s }];
  return roh.map(({ menge, rest }) => {
    const kw = /KW\s*(\d{1,2})\s*\/\s*(\d{4})/i.exec(rest);
    const status = /sofort/i.test(rest) ? STATUS.SOFORT : kw ? STATUS.KW : /kl(?:ä|ae|a)rung/i.test(rest) ? STATUS.KLAERUNG : /unbekannt/i.test(rest) ? STATUS.UNBEKANNT : STATUS.SONST;
    return { menge, status, kw: kw ? Number(kw[1]) : null, jahr: kw ? Number(kw[2]) : null, text: rest };
  });
}
/** Kurztext fuer Kennzeichen: "sofort" · "ca. KW 46" · "in Klärung" · "unbekannt" (bei mehreren: "2× ca. KW 46 · 1× in Klärung"). */
export function statusText(teile) {
  const kurz = p => (p.status === STATUS.KW ? `ca. KW ${p.kw}` : p.status === STATUS.SONST ? p.text : p.status);
  if (!teile?.length) return '';
  if (teile.length === 1) return kurz(teile[0]);
  return teile.map(p => `${p.menge ?? '?'}× ${kurz(p)}`).join(' · ');
}
/** Dringlichste Stufe der Teilmengen: klaerung > unbekannt > kw > sofort (fuer Farbe/Zahl). */
export function stufe(teile) {
  const st = (teile ?? []).map(p => p.status);
  return st.includes(STATUS.KLAERUNG) ? 'klaerung' : st.includes(STATUS.UNBEKANNT) || st.includes(STATUS.SONST) ? 'unbekannt'
    : st.includes(STATUS.KW) ? 'kw' : st.includes(STATUS.SOFORT) ? 'sofort' : 'unbekannt';
}

/** "TT.MM.JJJJ" -> "JJJJ-MM-TT"; Excel-Seriennummer -> Datum; sonst ''. */
export function datumAus(v) {
  const s = t(v);
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const n = Number(s);
  if (s && Number.isFinite(n) && n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10);
  return '';
}

/**
 * Zeilen (leseXlsxZeilen) -> Positionen. Kopf in Zeile 1 (wird geprueft: "Rückstand" in N, "Liefertermin" in O), Datenzeilen =
 * Zeilen mit gueltiger LieferantArtNr (G) und Menge im Rueckstand (N); Leer- und Fusszeilen fallen weg. Nur Spalten A-O.
 */
export function rueckstandPositionen(zeilen) {
  const kopf = (zeilen?.[0] ?? []).map(t);
  if (!/r[uü]ckstand/i.test(kopf[13] ?? '') || !/liefertermin/i.test(kopf[14] ?? '')) {
    throw new Error('Rückstandsliste: Kopfzeile passt nicht (Spalte N „Menge im Rückstand“, O „Liefertermin“ erwartet).');
  }
  const aus = [];
  (zeilen ?? []).slice(1).forEach((r, i) => {
    const o = Object.fromEntries(SPALTEN.map((s, j) => [s, t(r?.[j])]));
    const nr = articleNr(o.articleNr), rueck = zahl(o.rueckstand);
    if (!nr || rueck === null) return;
    const teile = parseLiefertermin(o.liefertermin);
    aus.push({
      zeile: i + 2, auftrag: o.auftrag, fremdbeleg: o.fremdbeleg === '- / -' || o.fremdbeleg === '-' ? '' : o.fremdbeleg,
      kommission: o.kommission === '-' ? '' : o.kommission, bestelldatum: datumAus(o.bestelldatum), articleNr: nr, katalogNr: o.katalogNr,
      bezeichnung: o.bezeichnung, farbe: o.farbe, groesse: o.groesse, bestellt: zahl(o.bestellt), geliefert: zahl(o.geliefert),
      rueckstand: rueck, teile, status: statusText(teile), stufe: stufe(teile),
    });
  });
  return aus;
}

/** Datum der Liste aus dem Dateinamen (JJJJ-MM-TT) bzw. ''. */
export const listenDatum = name => { const m = RUECKSTAND_MUSTER.exec(t(name)); return m ? `${m[1]}-${m[2]}-${m[3]}` : ''; };
/** Neueste Datei nach Namensdatum (nur passende Namen). */
export const neuesteListe = dateien => [...(dateien ?? [])].filter(f => RUECKSTAND_MUSTER.test(t(f.name))).sort((a, b) => listenDatum(b.name).localeCompare(listenDatum(a.name)))[0] ?? null;
/** Alter in Kalendertagen (heute = JJJJ-MM-TT, Berlin). */
export function alterTage(datum, heute) {
  if (!datum || !heute) return null;
  return Math.round((Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${datum}T00:00:00Z`)) / 864e5);
}

/**
 * Zuordnung je Position. korb = korbZeilen(...).zeilen mit referenz (referenzFuer); edi = Set der order_ids.
 * Messung RS1 (06.11.): "Kommission" ist die Kommission der GANZEN Bestellung ("JFN Sammelbestellung KWnn"), nicht die
 * Positions-Referenz - zugeordnet wird deshalb ueber Fremdbeleg = Bestell_ID + ArticleNr (alle Korb-Positionen dieser
 * Bestellung mit derselben Nummer; mehrere moeglich). Nur falls das nichts findet: Kommission = Positions-Referenz (fuer
 * kuenftige Dateien). Fremdbeleg ist nur eine unserer order_ids -> Bezug nur L-Shop-Bestellung; sonst "ohne Bezug in MC".
 * Bezug: AU-Nr (Korb-Referenz AU-...), Shop-Bestellungen (Shop + Bestellnummer), L-Shop-Bestellung (order_id).
 */
export function zuordnen(positionen, { korb = [], edi = new Set() } = {}) {
  return positionen.map(p => {
    let k = p.fremdbeleg ? korb.filter(z => t(z.Bestell_ID) === p.fremdbeleg && t(z.LShop_ArticleNr) === p.articleNr) : [];
    let art = k.length ? 'bestellung' : '';
    if (!k.length && p.kommission) {
      k = korb.filter(z => z.referenz === p.kommission && t(z.LShop_ArticleNr) === p.articleNr);
      if (k.length) art = 'kommission';
    }
    const auftraege = [...new Set(k.map(z => t(z.Referenz)).filter(r => /^AU-\d{4}-\d{4}$/.test(r)))];
    const shops = [...new Map(k.filter(z => t(z.Herkunft) !== 'eigen' && t(z.Bestellnummer))
      .map(z => { const s = { shop: (t(z.Shop) || 'JFN').toUpperCase(), bestellnummer: t(z.Bestellnummer) }; return [`${s.shop}:${s.bestellnummer}`, s]; })).values()];
    const orderId = p.fremdbeleg && (edi.has(p.fremdbeleg) || k.length) ? p.fremdbeleg : '';
    return { ...p, zuordnung: art || (orderId ? 'lshop' : 'ohne'), korbSchluessel: k.map(x => t(x.Schluessel)), auftraege, shops, orderId };
  });
}

/**
 * Antwort fuer den Browser: Positionen OHNE Kommission/Kunden-Nr. (Kommission kann Kundenbezug tragen), dazu Kennzeichen je
 * Korb-Position, Auftrag und Shop-Bestellung (dringlichste Stufe, Kurztext, Stueck). Empfaenger/Adresse gibt es hier gar nicht.
 */
export function rueckstandAntwort(zugeordnet) {
  const je = { korb: {}, auftrag: {}, shop: {} };
  const rang = { klaerung: 4, unbekannt: 3, kw: 2, sofort: 1 };
  const dazu = (ziel, key, p) => {
    const alt = ziel[key];
    if (!alt) { ziel[key] = { stufe: p.stufe, status: p.status, stueck: p.rueckstand, positionen: 1 }; return; }
    alt.stueck += p.rueckstand; alt.positionen += 1;
    if ((rang[p.stufe] ?? 0) > (rang[alt.stufe] ?? 0)) Object.assign(alt, { stufe: p.stufe, status: p.status });
    else if (alt.status !== p.status && rang[p.stufe] === rang[alt.stufe] && p.stufe === 'kw') alt.status = [alt.status, p.status].sort().join(' / ');
  };
  for (const p of zugeordnet) {
    for (const s of p.korbSchluessel) dazu(je.korb, s, p);
    for (const a of p.auftraege) dazu(je.auftrag, a, p);
    for (const s of p.shops) dazu(je.shop, `${s.shop}:${s.bestellnummer}`, p);
  }
  const positionen = zugeordnet.map(({ kommission, kundenNr, teile, ...p }) => ({ ...p, teile: teile.map(({ text, ...x }) => x) }));
  return { positionen, je, zahlen: rueckstandZahlen(zugeordnet) };
}

/** Zahlen fuer das Dashboard (DB1): Positionen im Rueckstand, davon in Klärung/unbekannt; dazu ohne Bezug. */
export function rueckstandZahlen(zugeordnet) {
  const l = zugeordnet ?? [];
  return { positionen: l.length, stueck: l.reduce((s, p) => s + (p.rueckstand ?? 0), 0),
    kritisch: l.filter(p => ['klaerung', 'unbekannt'].includes(p.stufe)).length, ohneBezug: l.filter(p => p.zuordnung === 'ohne').length };
}
