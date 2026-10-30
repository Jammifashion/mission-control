// Wareneingang Trikots (TR4) - reine Logik. Ein-/Ausgabe in lib/trikotWareneingang.js.
//
// Haken "da" = Status (S) "ok" + Geliefert_Am (R) = heute, NUR wenn beide Zellen leer sind und die Zeile eine
// Charge hat. Rueckweg ("doch nicht da") leert beide, NUR wenn noch genau der gesehene Haken-Stand drinsteht
// ("ok" + dasselbe Datum). "ersetzt" und alle anderen Werte in S fasst MC nie an (Inhaber 30.10.).
// Geliefert_Am wird wie Bestellt_Am als Datumswert (Seriennummer, Format dd.mm.yyyy) geschrieben.

import { requireHeader } from './sheet-headers.js';

export const RICHTUNGEN = ['setzen', 'zurueck'];
const t = v => String(v ?? '').trim();
const fehler = (msg, status) => Object.assign(new Error(msg), { status });
const spalte = i => String.fromCharCode(65 + i);

/**
 * @param {any[][]} unf   Reiter Trikots, UNFORMATTED_VALUE (mit Kopfzeile)
 * @param {any[][]} fmt   Reiter Trikots, FORMATTED_VALUE (fuer das gesehene Datum)
 * @param {{ richtung: string, auswahl: {id:string, zeile:number, geliefertAm?:string}[], serial: number }} o
 */
export function wareneingangPlan(unf, fmt, { richtung, auswahl, serial }) {
  if (!RICHTUNGEN.includes(richtung)) throw fehler('Richtung muss "setzen" oder "zurueck" sein.', 400);
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Trikots gewählt.', 400);
  const [kopf = []] = unf ?? [];
  const ctx = 'Reiter Trikots';
  const iId = requireHeader(kopf, 'Zeilen-ID', ctx), iP = requireHeader(kopf, 'Charge', ctx);
  const iR = requireHeader(kopf, 'Geliefert_Am', ctx), iS = requireHeader(kopf, 'Status', ctx);
  const probleme = [], zeilen = [], gesehen = new Set();
  for (const a of auswahl) {
    const z = Number(a?.zeile);
    const r = unf[z - 1];
    const text = s => probleme.push({ zeile: z || a?.zeile, text: s });
    if (!Number.isInteger(z) || z < 2 || !r) { text(`Zeile ${a?.zeile} gibt es nicht.`); continue; }
    if (gesehen.has(z)) { text(`Zeile ${z} doppelt gewählt.`); continue; }
    gesehen.add(z);
    if (t(r[iId]) !== t(a.id)) { text(`Zeile ${z} hat sich geändert (andere Zeilen-ID) – bitte neu laden.`); continue; }
    if (!t(r[iP])) { text(`Zeile ${z} ist noch nicht beim Produzenten bestellt.`); continue; }
    const st = t(r[iS]), dat = t(r[iR]), datText = t(fmt?.[z - 1]?.[iR]);
    if (richtung === 'setzen') {
      if (st || dat) { text(`Zeile ${z} ist nicht mehr offen (Status „${st || '–'}“${dat ? `, geliefert ${datText || dat}` : ''}).`); continue; }
    } else {
      if (st.toLowerCase() !== 'ok' || !dat) { text(`Zeile ${z} hat keinen Haken von MC (Status „${st || '–'}“) – nichts zurückgenommen.`); continue; }
      if (datText !== t(a.geliefertAm)) { text(`Zeile ${z}: Geliefert am ist inzwischen ${datText} – bitte neu laden.`); continue; }
    }
    zeilen.push(z);
  }
  const zellen = probleme.length ? [] : zeilen.sort((x, y) => x - y).flatMap(z => [
    { range: `'Trikots'!${spalte(iS)}${z}`, values: [[richtung === 'setzen' ? 'ok' : '']] },
    { range: `'Trikots'!${spalte(iR)}${z}`, values: [[richtung === 'setzen' ? serial : '']] },
  ]);
  return { probleme, zellen, zeilen, spalten: { R: spalte(iR), S: spalte(iS), iR } };
}
