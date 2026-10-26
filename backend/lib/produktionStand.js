// Bestellansicht (PS1) - Ein-/Ausgabe fuer POST /api/bestellen/produktion/stand, Logik in
// utils/produktion-stand.js. NUR LESEN: Produktions_Status, Warenkorb_LShop, BO4d-Bestellungen
// (leseLShopBestellungen) und - nur fuer Positionen ohne Korb-Zeile - der Kontext des Korb-Abgleichs
// plus die Produkttypen aus dem Shop (ladeProdukte, 1 Anfrage je 100, Pruefseite -> 503).
// Die Bestellungen selbst schickt der Browser mit (er hat sie gerade aus dem Shop): kein zweiter
// Bestellabruf. Antwort ohne Kundennamen.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeKontext, ladeProdukte } from './lshopKorb.js';
import { leseLShopBestellungen } from './lshopBestellungen.js';
import { normalizeShop } from '../utils/shop-spalte.js';
import { TAB_KORB, korbZeilen, korbSchluessel, stufeEin } from '../utils/korb-logic.js';
import { psZustaende, baueStand, wartetAufTeile } from '../utils/produktion-stand.js';

export const TAB_PS = 'Produktions_Status';
export const MAX_BESTELLUNGEN = 300;
const PS_BEREICH = 'A1:Z5000';   // ganze Breite wie routes/sheets.js (Shop, Fertig, Fertig_Am hinten)

const t = v => String(v ?? '').trim();
function fehler(msg, status) { const e = new Error(msg); e.status = status; return e; }

async function sheetsClient() {
  return sheetsMitWiederholung(google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
}

/** Eingabe pruefen und auf die noetigen Felder kuerzen (nur Zahlen-IDs). */
export function bestellungenEingabe(roh) {
  if (!Array.isArray(roh)) throw fehler('bestellungen erwartet eine Liste.', 400);
  if (roh.length > MAX_BESTELLUNGEN) throw fehler(`Höchstens ${MAX_BESTELLUNGEN} Bestellungen auf einmal.`, 400);
  const id = v => { const s = t(v); if (!/^\d{1,12}$/.test(s)) throw fehler(`Ungültige ID "${s}".`, 400); return s; };
  return roh.map(o => ({
    id: id(o?.id), date_created: t(o?.date_created),
    line_items: (Array.isArray(o?.line_items) ? o.line_items : []).map(li => ({
      id: id(li?.id), name: t(li?.name).slice(0, 200), quantity: Number(li?.quantity) || 1,
      product_id: t(li?.product_id), variation_id: t(li?.variation_id), sku: t(li?.sku),
    })),
  }));
}

export async function leseProduktionStand({ shop, bestellungen: roh, sheets: s, wcFuer = getWcClient, jetzt = () => new Date() } = {}) {
  const bestellungen = bestellungenEingabe(roh);
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 503);
  const sheets = s ?? await sheetsClient();
  const jfn = normalizeShop(shop) === 'jfn';

  const { data: psDaten } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_PS}'!${PS_BEREICH}`, valueRenderOption: 'FORMATTED_VALUE' });
  const { zustaende, fertigSpalte } = psZustaende(psDaten.values ?? [], shop);

  let korb = new Map();
  const bestellungJe = new Map();
  let einstufen = () => undefined;
  if (jfn && bestellungen.length) {
    const { data: k } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_KORB}'`, valueRenderOption: 'FORMATTED_VALUE' });
    const zeilen = (k.values ?? []).length ? korbZeilen(k.values).zeilen : [];
    korb = new Map(zeilen.map(z => [t(z.Schluessel), z]));
    const bo = await leseLShopBestellungen({ shop, sheets, jetzt });
    for (const b of bo.bestellungen ?? []) for (const p of b.positionen ?? []) bestellungJe.set(t(p.schluessel), b);

    // Einstufung nur, wo der Korb die Position nicht kennt (heute: Trikots, Fanartikel).
    const ohne = bestellungen.flatMap(o => o.line_items.filter(li => !korb.has(korbSchluessel('jfn', o.id, li.id))));
    if (ohne.length) {
      const ktx = await ladeKontext(sheets, spreadsheetId);
      const pids = [...new Set(ohne.map(li => li.product_id))].filter(x => x && x !== '0');
      const produkte = pids.length ? await ladeProdukte(wcFuer('jfn'), pids) : new Map();
      einstufen = li => stufeEin(li, produkte.get(li.product_id), ktx).klasse;
    }
  }

  const stand = baueStand({
    shop, bestellungen, ps: zustaende, korb, bestellungJe, einstufen,
    korbSchluessel: (nr, pos) => korbSchluessel('jfn', nr, pos), jetzt: jetzt(),
  });
  return {
    shop: normalizeShop(shop), fertigSpalte, bestellungen: stand,
    wartetAufTeile: wartetAufTeile(stand).map(b => b.id),
  };
}
