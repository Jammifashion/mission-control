// Lieferbarkeit L-Shop (BO7-1) - reine Logik, ohne Zugriffe. Ein-/Ausgabe in lib/lshopLieferbarkeit.js.
//
// Quellen: Bestandsdatei stockfile.csv vom L-Shop-FTP (alle 30 min neu, article;stock;catalog) und die
// Auslaufliste "Auslaufartikel - Stand TT.MM.JJJJ….xlsx" (Inhaber legt sie freitags in "L-Shop Auslauf" ab).
// Ziel: Reiter LShop_Lieferbarkeit, nur unsere genutzten Nummern (Varianten aktiv, Korb, Lager).
//   stock leer      = Nummer steht nicht in der Bestandsdatei -> bei L-Shop nicht mehr gefuehrt
//   Null_seit       = Zeitpunkt, seit dem stock durchgehend 0 (oder nicht gefuehrt) ist; fuer BO7-3 (14 Tage)
//   Auslauf ja/nein = NUR aus der Auslaufliste (Discontinued bleibt nur harte Sperre 3/6)
// Chat nur, wenn der Rohling einer OFFENEN Korb-Position wechselt (lieferbar -> 0 / nicht gefuehrt,
// nein -> ja auf der Auslaufliste); einmal je Wechsel, weil der Reiter danach den neuen Stand traegt.

export const LIEFERBARKEIT_TAB = 'LShop_Lieferbarkeit';
export const LIEFERBARKEIT_SPALTEN = ['ArticleNr', 'CatalogNr', 'stock', 'Stand_Datei', 'Auslauf', 'Auslaufdatum', 'Quelle_Liste', 'Geaendert_Am', 'Null_seit'];
export const AUSLAUF_ORDNER = 'L-Shop Auslauf';
export const AUSLAUF_DATEI_RE = /^Auslaufartikel - Stand (\d{2})\.(\d{2})\.(\d{4})\b.*\.xlsx$/i;
export const LISTE_ALT_TAGE = 14;
export const STAND_ALT_STUNDEN = 6;   // FTP-Fehler: erst ab diesem Alter des letzten Stands ist der Lauf rot
export const NR_RE = /^\d{10}$/;

const t = v => String(v ?? '').trim();

export class FormatFehler extends Error {
  constructor(message) { super(message); this.name = 'FormatFehler'; this.status = 422; this.code = 'format'; }
}

// ── Bestandsdatei ────────────────────────────────────────────────────────────

/**
 * stockfile.csv (UTF-8 mit BOM, CRLF, ";", Kopf article;stock;catalog in beliebiger Reihenfolge)
 * -> Map ArticleNr -> { stock, catalog }. Spalten nur ueber den Namen; falscher Kopf / keine Zeilen -> FormatFehler.
 */
export function leseBestandCsv(buf) {
  const text = (Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf ?? '')).replace(/^﻿/, '');
  const zeilen = text.split(/\r?\n/);
  const kopf = (zeilen[0] ?? '').split(';').map(s => t(s).replace(/^"|"$/g, '').toLowerCase());
  const i = { article: kopf.indexOf('article'), stock: kopf.indexOf('stock'), catalog: kopf.indexOf('catalog') };
  if (i.article < 0 || i.stock < 0) throw new FormatFehler(`Bestandsdatei: Kopf "${kopf.join(';').slice(0, 60)}" - erwartet article;stock;catalog.`);
  const map = new Map();
  let ungueltig = 0;
  for (const z of zeilen.slice(1)) {
    if (!t(z)) continue;
    const w = z.split(';').map(s => t(s).replace(/^"|"$/g, ''));
    const nr = w[i.article], stock = Number(w[i.stock]);
    if (!NR_RE.test(nr) || !Number.isInteger(stock) || stock < 0) { ungueltig++; continue; }
    map.set(nr, { stock, catalog: i.catalog >= 0 ? t(w[i.catalog]) : '' });
  }
  if (!map.size) throw new FormatFehler('Bestandsdatei ohne gültige Zeilen.');
  return { bestand: map, ungueltig };
}

// ── Auslaufliste ─────────────────────────────────────────────────────────────

/** "Auslaufartikel - Stand 30.10.2026.de.xlsx" -> "2026-10-30"; kein Muster -> null. */
export function listenDatum(name) {
  const m = AUSLAUF_DATEI_RE.exec(t(name));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Neueste Liste nach dem Namensdatum, bei gleichem Datum die zuletzt geaenderte. -> Datei oder null */
export function waehleNeuesteListe(dateien) {
  return (dateien ?? []).filter(f => listenDatum(f.name))
    .sort((a, b) => listenDatum(b.name).localeCompare(listenDatum(a.name)) || t(b.modifiedTime).localeCompare(t(a.modifiedTime)))[0] ?? null;
}

const alsTag = v => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = t(v?.result ?? v?.text ?? v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/**
 * Blatt der Auslaufliste als { kopf: string[], zeilen: any[][] } -> Map ArticleNr -> Auslaufdatum (JJJJ-MM-TT oder '').
 * Spalten ueber den Namen: Artikelnummer (Pflicht), Auslaufdatum (optional).
 */
export function leseAuslaufListe({ kopf, zeilen }) {
  const k = (kopf ?? []).map(x => t(x).toLowerCase());
  const iNr = k.indexOf('artikelnummer'), iDat = k.indexOf('auslaufdatum');
  if (iNr < 0) throw new FormatFehler('Auslaufliste: Spalte "Artikelnummer" fehlt.');
  const map = new Map();
  for (const z of zeilen ?? []) {
    const nr = t(z?.[iNr]?.result ?? z?.[iNr]?.text ?? z?.[iNr]);
    if (!NR_RE.test(nr)) continue;
    map.set(nr, iDat >= 0 ? alsTag(z[iDat]) : '');
  }
  if (!map.size) throw new FormatFehler('Auslaufliste ohne Artikelnummern.');
  return map;
}

/** Tage zwischen Listendatum und jetzt (Kalendertage UTC). */
export function listenAlterTage(name, jetzt = new Date()) {
  const d = listenDatum(name);
  return d ? Math.floor((Date.parse(jetzt.toISOString().slice(0, 10)) - Date.parse(d)) / 86_400_000) : null;
}

// ── Genutzte Nummern ─────────────────────────────────────────────────────────

/**
 * Unsere Nummern: Varianten aktiv (Aktiv TRUE), alle Korb-Zeilen, Lager-Schluessel LS:<Nr>.
 * -> { nummern: Set, korbOffen: Map Nr -> Anzahl offener Positionen }
 */
export function genutzteNummern({ varianten = [], korb = [], buchungen = [] }) {
  const nummern = new Set();
  for (const v of varianten) if (/^true$/i.test(t(v.Aktiv)) && NR_RE.test(t(v.LShop_ArticleNr))) nummern.add(t(v.LShop_ArticleNr));
  const korbOffen = new Map();
  for (const z of korb) {
    const nr = t(z.LShop_ArticleNr);
    if (!NR_RE.test(nr)) continue;
    nummern.add(nr);
    if (t(z.Status) === 'offen') korbOffen.set(nr, (korbOffen.get(nr) ?? 0) + 1);
  }
  for (const b of buchungen) { const s = t(b.Schluessel ?? b.schluessel); if (s.startsWith('LS:') && NR_RE.test(s.slice(3))) nummern.add(s.slice(3)); }
  return { nummern, korbOffen };
}

// ── Plan ─────────────────────────────────────────────────────────────────────

const altNull = a => t(a.stock) === '' || Number(t(a.stock)) === 0;

/**
 * Neuer Stand des Reiters.
 * @param {object} o
 * @param {Set<string>} o.nummern            genutzte Nummern
 * @param {Map} o.bestand                    leseBestandCsv().bestand
 * @param {Map|null} o.auslauf               leseAuslaufListe(); null = keine Liste lesbar -> Auslauf-Spalten bleiben
 * @param {string} o.listeName
 * @param {Map<string, object>} o.alt        bisherige Zeilen je ArticleNr (Spaltennamen als Schluessel)
 * @param {string} o.standDatei              Zeit der Bestandsdatei (ISO)
 * @param {Date} o.jetzt
 * -> { zeilen: [{...}], wechsel: [{ nr, art: 'null'|'auslauf', catalog, auslaufdatum }], summen }
 */
export function planLieferbarkeit({ nummern, bestand, auslauf = null, listeName = '', alt = new Map(), standDatei, jetzt = new Date() }) {
  const iso = jetzt.toISOString();
  const zeilen = [], wechsel = [];
  const summen = { nummern: 0, lieferbar: 0, null: 0, nichtGefuehrt: 0, auslauf: 0, neu: 0, geaendert: 0 };
  for (const nr of [...nummern].sort()) {
    const b = bestand.get(nr);
    const a = alt.get(nr);
    const stock = b ? b.stock : '';
    const istNull = !b || b.stock === 0;
    const aus = auslauf ? (auslauf.has(nr) ? 'ja' : 'nein') : (t(a?.Auslauf) || 'nein');
    const ausDatum = auslauf ? (auslauf.get(nr) ?? '') : t(a?.Auslaufdatum);
    const quelle = auslauf ? listeName : t(a?.Quelle_Liste);
    const gleich = a && t(a.stock) === String(stock) && t(a.Auslauf) === aus && t(a.Auslaufdatum) === ausDatum;
    const z = {
      ArticleNr: nr, CatalogNr: b?.catalog || t(a?.CatalogNr), stock, Stand_Datei: standDatei,
      Auslauf: aus, Auslaufdatum: ausDatum, Quelle_Liste: quelle,
      Geaendert_Am: gleich ? t(a.Geaendert_Am) : iso,
      Null_seit: istNull ? (a && altNull(a) && t(a.Null_seit) ? t(a.Null_seit) : iso) : '',
    };
    zeilen.push(z);
    summen.nummern++;
    if (!b) summen.nichtGefuehrt++; else if (b.stock === 0) summen.null++; else summen.lieferbar++;
    if (aus === 'ja') summen.auslauf++;
    if (!a) summen.neu++; else if (!gleich) summen.geaendert++;
    // Wechsel nur gegen einen vorhandenen Vorher-Stand (Erstbestand still)
    // BO7-4: beide Wechsel tragen Auslauf und Bestand - die Meldung nennt "laeuft aus" UND "schon 0" in einer Zeile
    const info = { catalog: z.CatalogNr, gefuehrt: Boolean(b), auslauf: aus === 'ja', auslaufdatum: ausDatum, istNull };
    if (a && istNull && !altNull(a)) wechsel.push({ nr, art: 'null', ...info });
    if (a && aus === 'ja' && t(a.Auslauf) !== 'ja') wechsel.push({ nr, art: 'auslauf', ...info });
  }
  return { zeilen, wechsel, summen };
}

/** Zeilen des Plans als Werte in Spaltenreihenfolge (stock als Zahl, sonst Text). */
export const alsWerte = zeilen => zeilen.map(z => LIEFERBARKEIT_SPALTEN.map(n => (n === 'stock' && z[n] !== '' ? Number(z[n]) : String(z[n] ?? ''))));

/** Bisherige Reiter-Werte (Kopf + Zeilen) -> Map ArticleNr -> Zeile. Kopf muss alle Spalten tragen. */
export function altAusWerten(werte) {
  const [kopf = [], ...rest] = werte ?? [];
  const idx = Object.fromEntries(LIEFERBARKEIT_SPALTEN.map(n => [n, kopf.map(t).indexOf(n)]));
  const fehlen = LIEFERBARKEIT_SPALTEN.filter(n => idx[n] < 0);
  if (kopf.length && fehlen.length) throw new FormatFehler(`${LIEFERBARKEIT_TAB}: Spalte(n) fehlen: ${fehlen.join(', ')}.`);
  const map = new Map();
  for (const r of rest) {
    const nr = t(r[idx.ArticleNr]);
    if (!NR_RE.test(nr)) continue;
    map.set(nr, Object.fromEntries(LIEFERBARKEIT_SPALTEN.map(n => [n, t(r[idx[n]])])));
  }
  return map;
}

/** Juengster Stand_Datei im Reiter (ISO) oder ''. */
export const letzterStand = alt => [...alt.values()].map(a => t(a.Stand_Datei)).filter(Boolean).sort().at(-1) ?? '';

// ── Chat ─────────────────────────────────────────────────────────────────────

const tagDe = s => (/^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ? s.split('-').reverse().join('.') : '');

/** Nur Wechsel bei Nummern mit offenen Korb-Positionen; ohne solche -> null (nichts zu melden). */
export function buildLieferbarkeitNachricht(wechsel, korbOffen) {
  const rel = (wechsel ?? []).filter(w => korbOffen.has(w.nr));
  if (!rel.length) return null;
  // BO7-4: eine Zeile je Nummer, auch wenn sie im selben Lauf auf 0 faellt UND auf die Auslaufliste kommt
  const jeNr = new Map();
  for (const w of rel) {
    const v = jeNr.get(w.nr) ?? {};
    jeNr.set(w.nr, { ...v, ...w, gefuehrt: w.gefuehrt ?? v.gefuehrt ?? true,
      istNull: Boolean(v.istNull || w.istNull || w.art === 'null'), auslauf: Boolean(v.auslauf || w.auslauf || w.art === 'auslauf'),
      auslaufdatum: w.auslaufdatum || v.auslaufdatum || '' });
  }
  const zeilen = [...jeNr.values()].map(w => {
    const n = korbOffen.get(w.nr);
    const auslauf = `läuft aus${tagDe(w.auslaufdatum) ? ` (bis ${tagDe(w.auslaufdatum)})` : ''}`;
    let was;
    if (!w.gefuehrt) was = 'nicht mehr bei L-Shop geführt';
    else if (w.auslauf && w.istNull) was = `${auslauf} – bei L-Shop schon 0, da kommt wohl nichts mehr`;
    else if (w.istNull) was = 'jetzt nicht lieferbar (Bestand 0)';
    else was = auslauf;
    return `• ${w.nr}${w.catalog ? ` (${w.catalog})` : ''}: ${was} · ${n} offene Position${n === 1 ? '' : 'en'}`;
  });
  return `⚠️ L-Shop-Lieferbarkeit – offene Korb-Positionen betroffen:\n${zeilen.join('\n')}\nBitte im Warenkorb prüfen (Lager, anderes Modell oder warten).`;
}

// ── BO7-2: Anzeige (nur lesen) ───────────────────────────────────────────────
// Vier Stufen, ueberall gleich: lieferbar (gruen) · bei L-Shop 0 (grau, "seit" aus Null_seit) · laeuft aus (gelb, nur aus
// der Auslaufliste) · nicht mehr gefuehrt (rot, stock leer). BO7-4: dazu "laeuft aus · schon 0" (orange). Reihenfolge der
// Schwere: nicht gefuehrt > laeuft aus · schon 0 > laeuft aus > 0.
// BO7-4: "laeuft aus · schon 0" (Auslaufliste UND stock 0) = dringendste Stufe nach "nicht gefuehrt" - da kommt nichts mehr nach.
export const STUFE = { LIEFERBAR: 'lieferbar', NULL: 'null', AUSLAUF: 'auslauf', AUSLAUF_NULL: 'auslauf_null', WEG: 'nicht_gefuehrt' };
export const STAND_VERALTET_STUNDEN = 3;

/** Reiterzeile (Spaltennamen als Schluessel) -> { stufe, stock, nullSeit, auslaufdatum } */
export function stufeAus(z) {
  const s = t(z?.stock);
  const stock = s === '' ? null : Number(s);
  const aus = t(z?.Auslauf) === 'ja';
  const stufe = stock === null ? STUFE.WEG : aus && stock === 0 ? STUFE.AUSLAUF_NULL : aus ? STUFE.AUSLAUF : stock === 0 ? STUFE.NULL : STUFE.LIEFERBAR;
  return { stufe, stock, nullSeit: t(z?.Null_seit), auslaufdatum: t(z?.Auslaufdatum) };
}

/**
 * Reiterwerte (Kopf + Zeilen) -> { je: Map ArticleNr -> stufeAus, stand } fuer die Anzeige.
 * stand: { datei (ISO), veraltet (> 3 h), liste (Dateiname), listeTage, listeAlt (> 14 Tage) } oder null ohne Zeilen.
 */
export function lieferbarkeitAusWerten(werte, jetzt = new Date()) {
  const alt = altAusWerten(werte);
  const je = new Map([...alt].map(([nr, z]) => [nr, stufeAus(z)]));
  if (!alt.size) return { je, stand: null };
  const datei = letzterStand(alt);
  const liste = [...alt.values()].map(z => t(z.Quelle_Liste)).find(Boolean) ?? '';
  const listeTage = liste ? listenAlterTage(liste, jetzt) : null;
  return {
    je,
    stand: {
      datei, veraltet: !datei || jetzt.getTime() - Date.parse(datei) > STAND_VERALTET_STUNDEN * 3_600_000,
      liste, listeTage, listeAlt: !liste || (listeTage ?? 0) > LISTE_ALT_TAGE,
    },
  };
}
