// Einen Reiter des SSOT-Sheets header-basiert lesen - nur lesen.
//
// Erst die Kopfzeile, dann genau die benoetigten Spalten per batchGet ueber
// die GANZE Hoehe und Breite (nicht readRange 'A1:Z1000' aus routes/sheets.js,
// das schneidet still ab). Spalten werden ueber den Namen gefunden
// (requireHeader/normHeader); fehlt eine, wirft das Lesen mit dem Namen.
// FORMATTED_VALUE: Zahlen kommen als angezeigter Text (ArticleNr bleibt
// "1000412880"). Zeilen werden ueber den Index zusammengefuehrt - alle Spalten
// stammen aus demselben Abruf. Ganz leere Zeilen fallen weg.
//
// Benutzt von lib/lshop.js (LShop_Modelle) und lib/seo-ssot.js (Motive,
// Struktur_Kategorien, SEO_Karte).

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { requireHeader, findHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';

export const CACHE_MS = 5 * 60 * 1000;

const t = v => String(v ?? '').trim();

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

/**
 * @param {object} o
 * @param {string} o.tab       Reitername.
 * @param {Object<string,string>} o.spalten  Feld -> Spaltenname (alle Pflicht).
 * @param {Object<string,string>} [o.optional] Feld -> Spaltenname; fehlt die Spalte, fehlt das Feld.
 * @param {object} [o.sheets]  Sheets-Client (Tests); sonst aus googleAuth.
 * @param {string} [o.spreadsheetId]  Standard: GOOGLE_SHEET_ID.
 * @returns {Promise<object[]>} Zeilen als { feld: string }.
 */
export async function leseReiterSpalten({ tab, spalten, optional = {}, sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID } = {}) {
  const ctx = `Reiter "${tab}"`;
  if (!spreadsheetId) {
    const e = new Error('GOOGLE_SHEET_ID fehlt.');
    e.status = 500;
    throw e;
  }
  const api = sheets ?? await sheetsClient();
  const { data: kopf } = await api.spreadsheets.values.get({ spreadsheetId, range: `${tab}!1:1` });
  const header = kopf.values?.[0] ?? [];
  if (!header.length) {
    const e = new Error(`${ctx} fehlt oder hat keine Kopfzeile.`);
    e.status = 500;
    throw e;
  }

  const felder = [
    ...Object.entries(spalten).map(([feld, name]) => ({ feld, idx: requireHeader(header, name, ctx) })),
    ...Object.entries(optional).map(([feld, name]) => ({ feld, idx: findHeader(header, name) })).filter(f => f.idx >= 0),
  ];
  const { data } = await api.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: felder.map(({ idx }) => `${tab}!${colLetter(idx)}2:${colLetter(idx)}`),
    majorDimension: 'COLUMNS',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const werte  = (data.valueRanges ?? []).map(vr => vr.values?.[0] ?? []);
  const anzahl = Math.max(0, ...werte.map(s => s.length));

  const zeilen = [];
  for (let i = 0; i < anzahl; i++) {
    const z = {};
    felder.forEach(({ feld }, j) => { z[feld] = t(werte[j]?.[i]); });
    if (felder.some(({ feld }) => z[feld])) zeilen.push(z);
  }
  return zeilen;
}

/**
 * Kleiner Zeit-Cache je Schluessel (Reiter + Sheet). Eine Instanz je Modul.
 */
export function reiterCache(ms = CACHE_MS) {
  const speicher = new Map();
  return {
    async hole(schluessel, laden) {
      const e = speicher.get(schluessel);
      if (e && Date.now() - e.zeit < ms) return e.wert;
      const wert = await laden();
      speicher.set(schluessel, { zeit: Date.now(), wert });
      return wert;
    },
    leeren() { speicher.clear(); },
  };
}
