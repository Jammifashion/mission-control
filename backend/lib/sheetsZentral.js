// Ein Weg fuer alle Google-Sheets-Zugriffe (QU1): zaehlen, Lese-Zwischenspeicher je Reiter, gleiche Lesungen
// buendeln, einmal wiederholen bei 429. Grund: Sheets erlaubt je Dienstkonto 60 Leseanfragen pro Minute (AUD1, BK1) -
// das ist die enge Stelle, nicht die Datenmenge.
//
// Eingehaengt an EINER Stelle: `google.sheets` (googleapis-Singleton) wird beim Import dieses Moduls ersetzt, jeder
// Client aus `google.sheets({ version: 'v4', auth })` laeuft danach hierueber - die rund 100 Aufrufstellen in lib/,
// routes/ und scripts/ bleiben unveraendert. index.js importiert das Modul als Erstes.
//
// Regeln:
//  - Zwischenspeicher NUR in Lese-Kontexten: GET-Anfragen und die wenigen lesenden POST-Routen (`LESENDE_POST`).
//    Schreibende Anfragen (POST/PUT/PATCH/DELETE), Hintergrundlaeufe (Scheduler/Workflows = POST), Skripte und alles
//    unter einer Schreibsperre (`frischLesen`) lesen IMMER frisch bei Google - "vor dem Schreiben frisch lesen" (TR2-1).
//  - Jeder Schreibaufruf (update, batchUpdate, append, clear, batchClear, spreadsheets.batchUpdate) macht die Eintraege
//    der betroffenen Reiter sofort ungueltig - vor UND nach dem Aufruf (eine Lesung, die waehrenddessen lief, wird nicht
//    gespeichert). Unbekannter Reiter / Struktur = ganze Tabelle ungueltig.
//  - Aenderungen von Hand im Google Sheet sieht MC in Lese-Kontexten spaetestens nach der TTL des Reiters.
//  - Gleichzeitige gleiche Lesungen (gleiche Parameter, gleicher Stand) teilen sich EINE Anfrage.
//  - 429: einmal nach kurzer Pause wiederholen (nur Lesen; nicht, wenn googleRetry schon wiederholt). Bleibt es bei 429,
//    bekommt der Fehler den Text `AUSGELASTET_TEXT` und Code `google_ausgelastet` (Status bleibt 429).
//  - Log: je Minute EINE Zeile `sheets_req_minute` (Zaehler je Ursprung/Methode/Reiter, nie Werte, Tabellen-IDs oder
//    Kunden-/Auftragsnummern - Pfadteile mit Ziffern werden zu ":x"), bei 429 eine Zeile `sheets_quota` mit dem
//    Kontingent-Namen (je Nutzer oder je Projekt).
//  - SHEETS_CACHE_MS (Umgebung) ueberschreibt die Standard-TTL; 0 schaltet den Zwischenspeicher ab (Zaehlen bleibt).

import { AsyncLocalStorage } from 'node:async_hooks';
import { google } from 'googleapis';

export const AUSGELASTET_TEXT = 'Google ist gerade ausgelastet – bitte in einer Minute noch einmal.';
export const AUSGELASTET_CODE = 'google_ausgelastet';

export const TTL_STANDARD_MS = 30_000;
/** TTL je Reiter (Name wie im Sheet). Stammdaten, die sich selten aendern, laenger; 0 = nie zwischenspeichern. */
export const TTL_JE_REITER = {
  Config: 60_000,
  Struktur_Kategorien: 60_000,
  Struktur_Lieferzeiten: 60_000,
  LShop_Modelle: 60_000,
  Modelle_Zusatz: 60_000,
  Lager_Orte: 60_000,
  Trikot_Artikel: 60_000,
  Partner: 60_000,
  FP_Partner: 60_000,
  FP_Artikel_Kategorie: 60_000,
  Fixkosten: 60_000,
  Agent_Wissen: 60_000,
};

/** POST-Routen, die nur lesen (Pfad ohne Query). Alles andere mit POST liest frisch. */
export const LESENDE_POST = [
  /^\/api\/bestellen\/produktion\/stand$/,
  /^\/api\/mika\/(frage|suche)$/,
];

export const PAUSE_429_MS = 2000;
const SPEICHER_MAX_ZEICHEN = 40_000_000;   // grob ~80 MB im Speicher; aelteste Eintraege fliegen zuerst
const LOG_JE_MAX = 40;

const kontext = new AsyncLocalStorage();       // { ursprung, cache }
const wiederholRahmen = new AsyncLocalStorage(); // googleRetry wiederholt schon -> hier nicht noch einmal

// ── Kontext ─────────────────────────────────────────────────────────────────

/** Pfad ohne Daten: Teile mit Ziffern oder sehr lange Teile werden ":x". */
export function ursprungAus(method, pfad) {
  const p = String(pfad ?? '').split('?')[0]
    .split('/').map(t => (/\d/.test(t) || t.length > 40 ? ':x' : t)).join('/');
  return `${String(method ?? '').toUpperCase()} ${p}`.trim();
}

export function cacheErlaubt(method, pfad) {
  const m = String(method ?? '').toUpperCase();
  const p = String(pfad ?? '').split('?')[0];
  if (m === 'GET' || m === 'HEAD') return true;
  return m === 'POST' && LESENDE_POST.some(re => re.test(p));
}

/** Express-Middleware (index.js, vor allen Routern): Ursprung + Lese-Kontext fuer die ganze Anfrage. */
export function sheetsKontext(req, _res, next) {
  const pfad = req.originalUrl ?? req.url;
  kontext.run({ ursprung: ursprungAus(req.method, pfad), cache: cacheErlaubt(req.method, pfad) }, next);
}

/** fn ohne Zwischenspeicher ausfuehren (Schreibsperren: vor dem Schreiben frisch lesen). */
export function frischLesen(fn) {
  const k = kontext.getStore();
  return kontext.run({ ursprung: k?.ursprung ?? 'ohne-anfrage', cache: false }, fn);
}

/** Fuer Laeufe ohne Anfrage (Tests, Skripte): eigener Ursprung, Zwischenspeicher nach Wahl. */
export function mitSheetsKontext({ ursprung, cache = false }, fn) {
  return kontext.run({ ursprung, cache }, fn);
}

/** googleRetry: innerhalb seiner Wiederholung keine zweite 429-Wiederholung hier. */
export function imWiederholRahmen(fn) { return wiederholRahmen.run(true, fn); }

// ── Reiter aus Bereichen ────────────────────────────────────────────────────

const A1_RE = /^\$?[A-Z]{0,3}\$?\d*(:\$?[A-Z]{0,3}\$?\d*)?$/i;
/** Reitername aus einem A1-Bereich; '*' = unbekannt (Bereich ohne Reiter = erster Reiter). */
export function reiterAus(range) {
  const r = String(range ?? '').trim();
  if (!r) return '*';
  const i = r.lastIndexOf('!');
  if (i < 0) return A1_RE.test(r) ? '*' : r.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  return r.slice(0, i).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
}

function reiterDerSchreibung(methode, p = {}) {
  const rb = p.requestBody ?? p.resource ?? {};
  switch (methode) {
    case 'values.update': case 'values.append': case 'values.clear': return [reiterAus(p.range)];
    case 'values.batchUpdate': return (rb.data ?? []).map(d => reiterAus(d?.range));
    case 'values.batchClear': return (rb.ranges ?? []).map(reiterAus);
    default: return ['*'];   // Struktur, ByDataFilter: ganze Tabelle
  }
}

// ── Stand je Tabelle (Generationen) ─────────────────────────────────────────

const staende = new Map();   // spreadsheetId -> { alle, struktur, reiter: Map }
function stand(id) {
  let s = staende.get(id);
  if (!s) { s = { alle: 0, struktur: 0, reiter: new Map() }; staende.set(id, s); }
  return s;
}
function standSchnappschuss(id, reiter) {
  const s = stand(id);
  if (reiter.includes('*')) return `a${s.alle}`;
  return `s${s.struktur}|` + reiter.map(r => `${r}:${s.reiter.get(r) ?? 0}`).join('|');
}
function ungueltig(id, reiter) {
  const s = stand(id);
  s.alle++;
  if (reiter.includes('*')) s.struktur++;
  else for (const r of reiter) s.reiter.set(r, (s.reiter.get(r) ?? 0) + 1);
  for (const [k, e] of speicher) {
    if (e.id !== id) continue;
    if (reiter.includes('*') || e.reiter.includes('*') || e.reiter.some(r => reiter.includes(r))) entferne(k);
  }
}

// ── Zwischenspeicher ────────────────────────────────────────────────────────

const speicher = new Map();   // key -> { id, reiter, schnapp, bis, data, groesse }
let speicherZeichen = 0;
const laufend = new Map();    // key|schnapp -> Promise<data>

function entferne(k) {
  const e = speicher.get(k);
  if (!e) return;
  speicherZeichen -= e.groesse;
  speicher.delete(k);
}

export function ttlFuer(reiter) {
  const env = process.env.SHEETS_CACHE_MS;
  const standard = env !== undefined && env !== '' && Number.isFinite(Number(env)) ? Number(env) : TTL_STANDARD_MS;
  if (standard <= 0) return 0;
  if (reiter.includes('*')) return Math.min(standard, TTL_STANDARD_MS);
  return Math.min(...reiter.map(r => (r in TTL_JE_REITER ? TTL_JE_REITER[r] : standard)));
}

function stabil(v) {
  if (Array.isArray(v)) return `[${v.map(stabil).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter(k => k !== 'auth').sort().map(k => `${JSON.stringify(k)}:${stabil(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const kopie = d => (d === undefined ? undefined : structuredClone(d));
const antwort = data => ({ data: kopie(data), status: 200, statusText: 'OK', headers: {} });

function speichern(key, eintrag) {
  const groesse = JSON.stringify(eintrag.data ?? null).length;
  if (groesse > SPEICHER_MAX_ZEICHEN / 4) return;
  entferne(key);
  speicher.set(key, { ...eintrag, groesse });
  speicherZeichen += groesse;
  for (const k of speicher.keys()) {
    if (speicherZeichen <= SPEICHER_MAX_ZEICHEN) break;
    entferne(k);
  }
}

// ── Zaehler + Log ───────────────────────────────────────────────────────────

let zaehlerMinute = null;
let zaehler = new Map();   // "art|ursprung|methode|reiter" -> n
const ARTEN = ['google_lesen', 'google_schreiben', 'cache', 'gebuendelt', 'fehler_429'];
let logFn = zeile => console.log(zeile);
let uhr = () => Date.now();

function minuteVon(ms) { return new Date(ms).toISOString().slice(0, 16); }

export function zaehle(art, methode, reiter) {
  const m = minuteVon(uhr());
  if (zaehlerMinute && m !== zaehlerMinute) logMinute();
  zaehlerMinute = m;
  const ursprung = kontext.getStore()?.ursprung ?? 'ohne-anfrage';
  const k = `${art}|${ursprung}|${methode}|${[...new Set(reiter)].sort().join(',')}`;
  zaehler.set(k, (zaehler.get(k) ?? 0) + 1);
}

/** Zeile der laufenden Minute schreiben und Zaehler leeren (auch vom Takt aufgerufen). */
export function logMinute() {
  if (!zaehlerMinute || !zaehler.size) { zaehlerMinute = null; return null; }
  const summen = Object.fromEntries(ARTEN.map(a => [a, 0]));
  const je = [];
  for (const [k, n] of zaehler) {
    const [a, u, m, r] = k.split('|');
    summen[a] += n;
    je.push({ a, u, m, r, n });
  }
  je.sort((x, y) => y.n - x.n);
  const zeile = { event: 'sheets_req_minute', minute: zaehlerMinute, ...summen,
    ueber_60: summen.google_lesen > 60, je: je.slice(0, LOG_JE_MAX) };
  zaehler = new Map();
  zaehlerMinute = null;
  logFn(JSON.stringify(zeile));
  return zeile;
}

const takt = setInterval(() => { if (zaehlerMinute && zaehlerMinute !== minuteVon(uhr())) logMinute(); }, 15_000);
takt.unref?.();

/** Kontingent-Name aus einem 429 (z. B. "ReadRequestsPerMinutePerUser"), sonst null. */
export function kontingentAus(err) {
  const details = err?.response?.data?.error?.details ?? err?.errors ?? [];
  for (const d of Array.isArray(details) ? details : []) {
    const m = d?.metadata ?? {};
    if (m.quota_limit || m.quota_metric) return String(m.quota_limit || m.quota_metric).slice(0, 80);
  }
  const text = String(err?.response?.data?.error?.message ?? err?.message ?? '');
  const t = text.match(/quota metric '([^']{1,60})' and limit '([^']{1,60})'/);
  return t ? `${t[1]} / ${t[2]}` : null;
}

const status = err => { const n = Number(err?.response?.status ?? err?.status ?? err?.code); return Number.isInteger(n) ? n : null; };

function ausgelastet(err) {
  try {
    err.message = AUSGELASTET_TEXT;
    err.code = AUSGELASTET_CODE;
    err.ausgelastet = true;
    if (err.status == null) err.status = 429;   // fehlerHandler antwortet mit err.status
  } catch { /* eingefrorenes Objekt: bleibt wie es ist */ }
  return err;
}

const pause = ms => new Promise(r => setTimeout(r, ms));
let schlafen = pause;

// ── Umhuellen ───────────────────────────────────────────────────────────────

async function googleLesen(methode, reiter, aufruf) {
  for (let v = 1; ; v++) {
    zaehle('google_lesen', methode, reiter);
    try {
      return await aufruf();
    } catch (err) {
      if (status(err) !== 429) throw err;
      zaehle('fehler_429', methode, reiter);
      logFn(JSON.stringify({ event: 'sheets_quota', methode, kontingent: kontingentAus(err),
        ursprung: kontext.getStore()?.ursprung ?? 'ohne-anfrage', versuch: v }));
      if (v === 1 && !wiederholRahmen.getStore()) { await schlafen(PAUSE_429_MS + Math.floor(Math.random() * 1000)); continue; }
      throw ausgelastet(err);
    }
  }
}

function leser(orig, methode, reiterVon) {
  return async (params = {}, ...rest) => {
    const id = params?.spreadsheetId ?? '';
    const reiter = reiterVon(params);
    const k = kontext.getStore();
    const ttl = k?.cache && id ? ttlFuer(reiter) : 0;
    const schnapp = standSchnappschuss(id, reiter);
    const key = `${methode}|${id}|${stabil(params)}`;

    if (ttl > 0) {
      const e = speicher.get(key);
      if (e && e.schnapp === schnapp && e.bis > uhr()) { zaehle('cache', methode, reiter); return antwort(e.data); }
      const lauf = laufend.get(`${key}|${schnapp}`);
      if (lauf) { zaehle('gebuendelt', methode, reiter); return antwort(await lauf); }
    }

    const p = googleLesen(methode, reiter, () => orig(params, ...rest)).then(res => {
      if (id && ttl > 0 && standSchnappschuss(id, reiter) === schnapp) {
        speichern(key, { id, reiter, schnapp, bis: uhr() + ttl, data: kopie(res?.data) });
      }
      return res;
    });
    if (ttl > 0) {
      const lk = `${key}|${schnapp}`;
      const nurDaten = p.then(r => kopie(r?.data));
      nurDaten.catch(() => {});
      laufend.set(lk, nurDaten);
      p.finally(() => { if (laufend.get(lk) === nurDaten) laufend.delete(lk); }).catch(() => {});
    }
    return p;
  };
}

function schreiber(orig, methode) {
  return async (params = {}, ...rest) => {
    const id = params?.spreadsheetId ?? '';
    const reiter = reiterDerSchreibung(methode, params);
    zaehle('google_schreiben', methode, reiter);
    if (id) ungueltig(id, reiter);
    try {
      return await orig(params, ...rest);
    } finally {
      if (id) ungueltig(id, reiter);
    }
  };
}

// Flache Kopie (wie googleRetry): googleapis-Ressourcen haben nicht konfigurierbare Felder.
function flach(ziel) {
  const out = {};
  for (let o = ziel; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      if (k === 'constructor' || k in out) continue;
      const wert = ziel[k];
      out[k] = typeof wert === 'function' ? wert.bind(ziel) : wert;
    }
  }
  return out;
}

const SCHREIBEN_VALUES = ['update', 'batchUpdate', 'append', 'clear', 'batchClear', 'batchUpdateByDataFilter', 'batchClearByDataFilter'];

/** Einen Sheets-Client (echt oder Attrappe) umhuellen. */
export function umhuelleSheets(sheets) {
  if (!sheets || sheets.__qu1) return sheets;
  const sp = sheets.spreadsheets;
  if (!sp) return sheets;
  const v = sp.values ? flach(sp.values) : undefined;
  if (v) {
    if (typeof v.get === 'function') v.get = leser(v.get, 'values.get', p => [reiterAus(p?.range)]);
    if (typeof v.batchGet === 'function') {
      v.batchGet = leser(v.batchGet, 'values.batchGet', p => {
        const r = (Array.isArray(p?.ranges) ? p.ranges : [p?.ranges]).filter(x => x != null).map(reiterAus);
        return r.length ? r : ['*'];
      });
    }
    if (typeof v.batchGetByDataFilter === 'function') v.batchGetByDataFilter = leser(v.batchGetByDataFilter, 'values.batchGetByDataFilter', () => ['*']);
    for (const m of SCHREIBEN_VALUES) if (typeof v[m] === 'function') v[m] = schreiber(v[m], `values.${m}`);
  }
  const s = flach(sp);
  if (v) s.values = v;
  if (typeof s.get === 'function') {
    s.get = leser(s.get, 'spreadsheets.get', p => {
      const r = (Array.isArray(p?.ranges) ? p.ranges : (p?.ranges ? [p.ranges] : [])).map(reiterAus);
      return r.length ? r : ['*'];
    });
  }
  if (typeof s.getByDataFilter === 'function') s.getByDataFilter = leser(s.getByDataFilter, 'spreadsheets.getByDataFilter', () => ['*']);
  if (typeof s.batchUpdate === 'function') s.batchUpdate = schreiber(s.batchUpdate, 'spreadsheets.batchUpdate');
  const out = flach(sheets);
  out.spreadsheets = s;
  Object.defineProperty(out, '__qu1', { value: true });
  return out;
}

/** `google.sheets` ersetzen (einmal). */
export function installiere(g = google) {
  // Test-Attrappen (ohne sheets oder jest.fn mit eigener Steuerung) bleiben unberuehrt
  if (typeof g?.sheets !== 'function' || g.sheets.__qu1 || g.sheets._isMockFunction) return;
  const orig = g.sheets.bind(g);
  const neu = (...args) => {
    const v = typeof args[0] === 'string' ? args[0] : args[0]?.version;   // VOR dem Aufruf: googleapis loescht version aus den Optionen
    const c = orig(...args);
    return v === 'v4' ? umhuelleSheets(c) : c;
  };
  Object.defineProperty(neu, '__qu1', { value: true });
  g.sheets = neu;
}
installiere();

// ── Fuer Tests ──────────────────────────────────────────────────────────────

export function _zuruecksetzen({ log, jetzt, sleep } = {}) {
  speicher.clear(); speicherZeichen = 0; laufend.clear(); staende.clear();
  zaehler = new Map(); zaehlerMinute = null;
  logFn = log ?? (zeile => console.log(zeile));
  uhr = jetzt ?? (() => Date.now());
  schlafen = sleep ?? pause;
}
export function _zaehlerStand() {
  const out = Object.fromEntries(ARTEN.map(a => [a, 0]));
  for (const [k, n] of zaehler) out[k.split('|')[0]] += n;
  return out;
}
