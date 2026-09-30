// Wiederholung fuer Google-Sheets-Aufrufe bei kurzzeitigen Fehlern (429/500/502/503/504).
//
// Bewusst eng:
//  - Nur LESEN (values.get, values.batchGet, spreadsheets.get) und values.batchUpdate.
//    batchUpdate schreibt feste Bereiche mit festen Werten: dieselbe Anfrage zweimal
//    ausgefuehrt ergibt denselben Zustand.
//  - NIE wiederholt: values.append (eine 5xx-Antwort kann ein ausgefuehrtes Anhaengen sein ->
//    Dublette), values.update/clear, spreadsheets.batchUpdate (Struktur), die Chat-Meldung
//    (chatNotify.js) und WooCommerce-POST/Create. Diese Aufrufe laufen unveraendert durch
//    den Wrapper bzw. benutzen ihn nicht.
//  - 1 Aufruf + bis zu 3 Wiederholungen nach 1 s, 2 s, 4 s.
//  - Log mit Versuchsnummer und Status, nie mit Fehlertext, Tabellen-IDs oder Werten.
//
// Nicht abgedeckt: Fehler, die Google nie erreichen (Netzwerk, ECONNRESET) und Fehler vor
// der App (Cloud-Run-Kaltstart) - dafuer der Warm-up-Schritt im Workflow.

export const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
export const PAUSEN_MS = [1000, 2000, 4000];

const pause = ms => new Promise(r => setTimeout(r, ms));

/** HTTP-Status eines googleapis/gaxios-Fehlers, sonst null. */
export function statusVon(err) {
  const z = err?.response?.status ?? err?.status ?? err?.code;
  const n = Number(z);
  return Number.isInteger(n) ? n : null;
}

/**
 * fn ausfuehren, bei 429/5xx bis zu PAUSEN_MS.length mal wiederholen.
 * @param {() => Promise<any>} fn
 * @param {{ label?: string, sleep?: (ms:number)=>Promise<void>, log?: (msg:string)=>void }} [o]
 */
export async function mitWiederholung(fn, { label = 'google', sleep = pause, log = m => console.warn(m) } = {}) {
  const versuche = PAUSEN_MS.length + 1;
  for (let v = 1; ; v++) {
    try {
      return await fn();
    } catch (err) {
      const status = statusVon(err);
      if (v >= versuche || !RETRY_STATUS.has(status)) throw err;
      const ms = PAUSEN_MS[v - 1];
      log(`[google-retry] ${label} Versuch ${v}/${versuche} fehlgeschlagen (HTTP ${status}), naechster in ${ms} ms`);
      await sleep(ms);
    }
  }
}

// Flache Kopie statt Proxy: googleapis-Ressourcen haben nicht konfigurierbare Felder, ein Proxy
// darf dafuer nur den Originalwert liefern. Methoden werden an das Original gebunden.
function kopie(ziel) {
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

function umhuelle(ziel, name, wiederholbar, unterobjekte, opts) {
  const out = kopie(ziel);
  for (const k of wiederholbar) {
    if (typeof ziel[k] !== 'function') continue;
    const orig = ziel[k].bind(ziel);
    out[k] = (...args) => mitWiederholung(() => orig(...args), { ...opts, label: `${name}.${k}` });
  }
  for (const [k, wrap] of Object.entries(unterobjekte)) if (ziel[k]) out[k] = wrap(ziel[k]);
  return out;
}

/**
 * Sheets-Client mit Wiederholung fuer die erlaubten Aufrufe; alles andere unveraendert.
 * @param {object} sheets google.sheets({ version: 'v4', auth })
 */
export function sheetsMitWiederholung(sheets, opts = {}) {
  const values = v => umhuelle(v, 'sheets.values', new Set(['get', 'batchGet', 'batchUpdate']), {}, opts);
  const spreadsheets = sp => umhuelle(sp, 'sheets.spreadsheets', new Set(['get']), { values }, opts);
  return umhuelle(sheets, 'sheets', new Set(), { spreadsheets }, opts);
}
