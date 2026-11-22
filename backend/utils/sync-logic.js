// Pure sync-logic helpers – no external dependencies, fully testable.
import { parseDeZahl } from './zahl-de.js';

export function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseDeZahl(val.toString());
  return Number.isNaN(n) ? fallback : n;
}

import { wcTagDE, deHeuteBerlin, berlinDatum as berlinTagC4 } from './berlin-tag.js';   // GT1 C4

/** TT.MM.JJJJ eines Zeitpunkts - fuer Sheet-Daten (UTC-Mitternacht) unveraendert; "heute" = deHeuteBerlin, WC-Zeiten = wcTagDE (GT1 C4). */
export function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

export const WC_STATES_VERKAUF = ['processing', 'completed', 'on-hold'];
export const WC_STATES_STORNO  = ['refunded', 'cancelled'];
export const STORNO_MARKER     = 'Storniert/Rückerstattet';

// ── PA2 Teil B: Sperre ──────────────────────────────────────────────────────
// Fehlt fuer einen Partner-Eintrag EK oder Druck (LEER; 0 ist erlaubt), wird
// der Verkauf trotzdem erfasst: Status "gesperrt", Spalte "Sperre" = Grund,
// Betragsspalten leer. Nichts geht verloren, nichts wird mit 0 gerechnet.
// Die Abrechnung waehlt nur Status "offen" und laesst gesperrte Zeilen damit aus.
export const STATUS_GESPERRT = 'gesperrt';
export const SPALTE_SPERRE   = 'Sperre';
// Spalten, die eine gesperrte Zeile leer laesst und das Entsperren fuellt.
export const BETRAG_SPALTEN  = ['Lizenzgebühr', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto'];

export const leerWert = v => v === null || v === undefined || String(v).trim() === '';

/** Grund der Sperre fuer einen Artikel-Eintrag { ekLeer, druckLeer }, oder null. */
export function sperrGrund(e) {
  if (!e) return null;
  if (e.ekLeer && e.druckLeer) return 'EK und Druck fehlen';
  if (e.ekLeer)   return 'EK fehlt';
  if (e.druckLeer) return 'Druck fehlt';
  return null;
}

/**
 * Hinweise fuer Vorschau und Erstellen einer Abrechnung: gesperrte Zeilen im
 * Zeitraum (werden nicht abgerechnet) und Nachzuegler (offene Zeilen VOR dem
 * Zeitraumbeginn, sonst fallen spaet erfasste oder entsperrte Verkaeufe raus).
 * @param {object} o { header, rows, partnerId, von: Date, bis: Date, parseDate }
 */
export function abrechnungHinweise({ header, rows, partnerId, von, bis, parseDate }) {
  const h = c => header.indexOf(c);
  const eigene = (rows ?? []).filter(r => r[h('Partner-ID')] === partnerId);
  const datum = r => parseDate(r[h('Datum')] ?? '');
  const gesperrt = eigene.filter(r => (r[h('Status')] ?? '') === STATUS_GESPERRT)
    .filter(r => { const d = datum(r); return d && d >= von && d <= bis; });
  const nach = eigene.filter(r => (r[h('Status')] ?? '') === 'offen')
    .filter(r => { const d = datum(r); return d && d < von; });
  const fruehest = nach.map(r => r[h('Datum')]).sort((a, b) => parseDate(a) - parseDate(b))[0] ?? null;
  const hinweise = [];
  if (gesperrt.length)
    hinweise.push(`${gesperrt.length} Zeile(n) im Zeitraum gesperrt (EK/Druck fehlt), nicht abgerechnet.`);
  if (nach.length)
    hinweise.push(`${nach.length} offene Zeile(n) vor dem Zeitraumbeginn (früheste ${fruehest}) – nicht in dieser Abrechnung, Zeitraum früher beginnen lassen.`);
  return { gesperrtImZeitraum: gesperrt.length, nachzuegler: nach.length, fruehesterNachzuegler: fruehest, hinweise };
}

/**
 * Liegt eine Bestellung vor dem Vertragsbeginn des Partners (Spalte Vertrag-ab)?
 *
 * Verglichen wird der Kalendertag aus date_created (WC liefert Shop-Ortszeit
 * ohne Zeitzone, "2024-12-31T23:10:00" ist also der 31.12.). Bestellungen am
 * Stichtag selbst gehoeren zur Vereinbarung. Ohne Vertragsbeginn (null) gibt
 * es keine Grenze.
 */
export function vorVertragsbeginn(dateCreated, beginn) {
  if (!beginn) return false;
  const m = String(dateCreated ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) < beginn.getTime();
}

/**
 * Bestellungen, fuer die der Sync Verkaufszeilen schreibt.
 *
 * Neben den laufenden Verkaeufen (processing/completed/on-hold) auch
 * Bestellungen, die beim ersten Sync schon storniert/erstattet sind. Frueher
 * entstand fuer die gar nichts: keine Verkaufszeile, also auch keine
 * Gegenbuchung, weil buildStornoRows nur vorhandene Zeilen negiert. Nach
 * einem Neu-Sync fehlten damit alle Paare, die es gab, solange der Sync
 * rechtzeitig lief. Jetzt entstehen Verkauf und Gegenbuchung in derselben
 * Runde (Summe 0).
 *
 * Nur bezahlte Bestellungen (date_paid gesetzt): eine nie bezahlte, abgebrochene
 * Bestellung war nie ein Verkauf. Und nur nach afterParam angelegte - die
 * Stornos werden voll-historisch geladen, der Verkaufszeitraum aber nicht.
 */
export function ordersFuerVerkaufszeilen(orders, stornoOrders, afterParam) {
  const ab = afterParam ? new Date(afterParam) : null;
  const nachgeholt = (stornoOrders ?? []).filter(o =>
    o.date_paid && (!ab || new Date(o.date_created) > ab));
  return [...(orders ?? []), ...nachgeholt];
}

/**
 * Erzeugt negative Gegeneinträge für bestehende Verkaufs-Zeilen, deren Order in WC
 * auf refunded/cancelled steht.
 *
 * Alle Spalten werden über vh() aus der Kopfzeile aufgelöst - eine eingefügte
 * Spalte verschiebt die Gegenbuchung damit nicht mehr. Fehlt eine Pflichtspalte,
 * bricht die Funktion ab, statt in falsche Zellen zu schreiben.
 *
 * Negiert werden: Stückzahl, VK-Preis-Brutto, Lizenzgebühr, Gewinn-netto,
 * Lizenz-Anteil, Porto-Saldo, Anteil-Brutto.
 */
export function buildStornoRows(vRows, vh, stornoOrders, partnerFilter) {
  const ordIdx = vh('Order-ID');
  const artIdx = vh('Artikelnummer');
  const varIdx = vh('Variante');
  const pIdx   = vh('Partner-ID');
  const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);

  const refundDate = new Map(
    stornoOrders.map(o => [String(o.id), wcTagDE(o.date_modified || o.date_created)])
  );

  // Alle Spalten ueber die Kopfzeile aufloesen, nicht nur die vier oben.
  // Fest verdrahtete Indizes und vh()-Lookups nebeneinander halten nur,
  // solange die Kopfzeile unveraendert bleibt: kommt eine Spalte dazu, wandern
  // die Lookups mit, die Zahlen nicht - die Gegenbuchung negiert dann fremde
  // Zellen, Status und Marker landen falsch, und die Duplikaterkennung liest
  // ins Leere, wodurch Stornos doppelt gebucht werden.
  const pflicht = (name) => {
    const i = vh(name);
    if (i === -1) {
      throw Object.assign(
        new Error(`Spalte "${name}" fehlt in der Kopfzeile der Verkaeufe - `
                + 'Storno-Gegenbuchung abgebrochen, um keine falschen Zellen zu schreiben.'),
        { status: 500 },
      );
    }
    return i;
  };

  // Betragsspalten, die in der Gegenbuchung negiert werden.
  const NEG_COLS = [
    'Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr',
    'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto',
  ].map(pflicht);
  const STATUS_COL = pflicht('Status');
  const DATE_COL   = pflicht('Datum');
  const STORNO_COL = pflicht('Storno-Status');
  // PA2 Teil B: optional. Die Gegenbuchung einer gesperrten Zeile ist ebenfalls
  // gesperrt, mit demselben Grund und leeren Betraegen (das Entsperren rechnet beide).
  const SPERRE_COL = vh(SPALTE_SPERRE);
  // Positions-ID (optional, neue Zeilen): Gegenbuchung je Position, auch bei zwei gleichen Positionen.
  const POS_COL = vh('Positions-ID');
  const dupKeyOf = r => {
    const posId = POS_COL === -1 ? '' : String(r[POS_COL] ?? '').trim();
    return posId ? `${r[ordIdx]}|pos:${posId}|${r[pIdx]}` : `${r[ordIdx]}|${r[artIdx]}|${varKey(r[varIdx])}|${r[pIdx]}`;
  };

  // Breite der Gegenbuchung: so weit, wie die Kopfzeile reicht.
  const BREITE = Math.max(
    STORNO_COL, STATUS_COL, DATE_COL, ordIdx, artIdx, varIdx, pIdx, SPERRE_COL, POS_COL, ...NEG_COLS,
  ) + 1;

  // NB1: Teilerstattungs-Zeilen ("Erstattung #…", "Versanderstattung #…") sind keine Ganz-Stornos.
  // Sie sperren die Gegenbuchung nicht, werden aber mitgerechnet: das Storno negiert die SUMME aus
  // Ursprungszeile und schon gebuchten Teilerstattungen - sonst waere erstattete Ware doppelt abgezogen.
  const istTeil = r => {
    const s = String(r[STORNO_COL] ?? '');
    return s.startsWith('Erstattung #') || s.startsWith('Versanderstattung #');
  };
  const stornoDone = new Set();
  const teilSumme = new Map();   // dupKey -> Summe je NEG-Spalte der Teilerstattungen
  for (const r of vRows) {
    if ((r[STORNO_COL] ?? '') === '') continue;
    if (!istTeil(r)) { stornoDone.add(dupKeyOf(r)); continue; }
    const k = dupKeyOf(r);
    const s = teilSumme.get(k) ?? new Map();
    for (const i of NEG_COLS) if (!leerWert(r[i])) s.set(i, (s.get(i) ?? 0) + toFloat(r[i]));
    teilSumme.set(k, s);
  }
  const rund = x => Math.round((x + Number.EPSILON) * 100) / 100;

  const out = [];
  for (const r of vRows) {
    const oid = String(r[ordIdx] ?? '');
    if (!refundDate.has(oid)) continue;
    if ((r[STORNO_COL] ?? '') !== '') continue;
    if (partnerFilter && !partnerFilter.has(r[pIdx])) continue;

    const dupKey = dupKeyOf(r);
    if (stornoDone.has(dupKey)) continue;
    stornoDone.add(dupKey);

    const teil = teilSumme.get(dupKey);
    const counter = [];
    for (let i = 0; i < BREITE; i++) {
      let v = r[i] ?? '';
      // Leer bleibt leer (gesperrte Zeile), 0 bleibt 0 - nie -0.
      if (NEG_COLS.includes(i) && !leerWert(v)) {
        const x = teil ? rund(toFloat(v) + (teil.get(i) ?? 0)) : toFloat(v);
        v = x === 0 ? 0 : -x;
      }
      counter[i] = v;
    }
    // Alles schon per Teilerstattung zurueck: keine leere Gegenbuchung.
    if (teil && NEG_COLS.every(i => leerWert(counter[i]) || counter[i] === 0)) continue;
    counter[DATE_COL]   = refundDate.get(oid) || r[DATE_COL] || deHeuteBerlin();
    counter[STATUS_COL] = (r[STATUS_COL] ?? '') === STATUS_GESPERRT ? STATUS_GESPERRT : 'offen';
    counter[STORNO_COL] = STORNO_MARKER;
    out.push(counter);
  }
  return out;
}

// ── Schluessel mit Positions-ID, Startpunkt mit Ueberlappung, Kostensatz je Bestelldatum ──
//
// Neue Verkaufszeilen tragen die Positions-ID der Shop-Bestellung (line_item.id) in einer
// eigenen Spalte. Zwei gleiche Positionen einer Bestellung sind damit zwei Zeilen.
// Altzeilen ohne Positions-ID zaehlen weiter ueber den alten Schluessel
// (Bestellung | Artikel | Variante | Partner) - eine schon erfasste Bestellung bekommt
// beim erneuten Lesen also keine zusaetzliche Zeile (Nachtragen nur bewusst).
export const SPALTE_POSITION   = 'Positions-ID';
export const UEBERLAPPUNG_TAGE = 14;

const varianteKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
export const posSchluessel = (orderId, positionId, partnerId) => `${orderId}|pos:${positionId}|${partnerId}`;
export const altSchluessel = (orderId, artikel, variante, partnerId) => `${orderId}|${artikel}|${varianteKey(variante)}|${partnerId}`;

/**
 * Bestand der schon erfassten Verkaeufe (ohne Storno-Gegenbuchungen).
 * @param {any[][]} rows
 * @param {(col:string)=>number} vh
 * @param {{ bestellung: string, artikel: string }} spalten  Spaltennamen (Lizenz: Order-ID/Artikelnummer, FP: WC-Bestellnummer/Artikelname)
 */
export function verkaufsBestand(rows, vh, { bestellung, artikel }) {
  const pos = new Set(), alt = new Set();
  const iPos = vh(SPALTE_POSITION), iSt = vh('Storno-Status');
  for (const r of rows ?? []) {
    if (iSt !== -1 && String(r[iSt] ?? '') !== '') continue;
    const o = r[vh(bestellung)] ?? '', p = r[vh('Partner-ID')] ?? '';
    const posId = iPos === -1 ? '' : String(r[iPos] ?? '').trim();
    if (posId) pos.add(posSchluessel(o, posId, p));
    else alt.add(altSchluessel(o, r[vh(artikel)] ?? '', r[vh('Variante')], p));
  }
  return { pos, alt };
}

/** Ist diese Position fuer diesen Partner schon erfasst? Merkt sie sich, wenn nein (merken = true). */
export function schonErfasst(bestand, { orderId, positionId, artikel, variante, partnerId }, merken = true) {
  const ak = altSchluessel(orderId, artikel, variante, partnerId);
  // Ohne Positions-ID (nicht vom Shop geliefert): alter Schluessel wie bisher.
  if (positionId === undefined || positionId === null || String(positionId) === '') {
    if (bestand.alt.has(ak)) return true;
    if (merken) bestand.alt.add(ak);
    return false;
  }
  const pk = posSchluessel(orderId, positionId, partnerId);
  if (bestand.pos.has(pk) || bestand.alt.has(ak)) return true;
  if (merken) bestand.pos.add(pk);
  return false;
}

/**
 * Startpunkt fuer den Shop-Abruf: neuestes Bestelldatum im Reiter minus UEBERLAPPUNG_TAGE
 * (spaet bezahlte Bestellungen mit aelterem Anlagedatum kommen so noch dazu; Dubletten
 * verhindert der Schluessel). Ohne Zeilen: null (alles).
 */
export function syncStart(rows, datumIdx, parseDate, tage = UEBERLAPPUNG_TAGE) {
  let neuestes = null;
  for (const r of rows ?? []) {
    const d = parseDate(r[datumIdx] ?? '');
    if (d && (!neuestes || d > neuestes)) neuestes = d;
  }
  if (!neuestes) return null;
  return new Date(neuestes.getTime() - tage * 86400000).toISOString().slice(0, 19);
}

/** Kalendertag der Bestellung (WC date_created, Shop-Ortszeit) als JJJJ-MM-TT. */
export const bestellTag = order => String(order?.date_created ?? '').slice(0, 10);

/**
 * Kostensatz je Bestelltag (zwischengespeichert). `parse(datum)` = parseKonfiguration(rows, header, datum).
 * Liefert die Konfiguration; fehlende Positionen stehen in `.fehlend`.
 */
export function konfigJeTag(parse) {
  const cache = new Map();
  return tag => {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(String(tag)) ? tag : berlinTagC4(new Date());
    if (!cache.has(key)) cache.set(key, parse(new Date(`${key}T12:00:00Z`)));
    return cache.get(key);
  };
}

/**
 * Fehlende Fixkosten fuer die Bestelltage eines Laufs: [{ tag, fehlend: [Position…] }] (leer = alles da).
 * Der Sync schreibt dann nichts (409), statt mit 0 zu rechnen.
 */
export function fixkostenLuecken(tage, konfigFuer) {
  const out = [];
  for (const tag of [...new Set(tage)].sort()) {
    const f = konfigFuer(tag).fehlend ?? [];
    if (f.length) out.push({ tag, fehlend: f });
  }
  return out;
}
export function fixkostenFehler(luecken) {
  const text = luecken.slice(0, 5).map(l => `${l.tag}: ${l.fehlend.join(', ')}`).join('; ');
  return Object.assign(new Error(`Fixkosten fehlen in Kalkulation_Fixkosten (${text}${luecken.length > 5 ? ' …' : ''}) – nichts geschrieben.`),
    { status: 409, code: 'fixkosten_fehlen' });
}
