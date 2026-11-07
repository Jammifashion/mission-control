// PPS1: "Link neu erzeugen" fuer einen Partner (Lizenz: Reiter `Partner`, Festpreis: `FP_Partner`), Logik in
// utils/partner-token.js. Der alte Link ist danach sofort ungueltig: `Token_Hash` bekommt den neuen Hash, die alte
// Klartext-Spalte `Token` wird geleert. Der neue Link geht genau einmal an MC zurueck und wird nirgends gespeichert.
// Fehlt die Spalte `Token_Hash` -> 409 `einrichtung` (scripts/setup-partner-token-hash.js). Schreibt nur diese zwei
// Zellen (RAW) und liest sie zurueck. Nie Token/Hash in Log oder Fehlertext.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { SPALTE_TOKEN, SPALTE_HASH, tokenHash, neuerToken, portalLink } from '../utils/partner-token.js';

const TAB_JE_ART = { lizenz: 'Partner', festpreis: 'FP_Partner' };

const fehler = (status, code, meldung) => Object.assign(new Error(meldung), { status, code });

export async function erzeugeNeuenPartnerLink({ art, partnerId, sheets: sheetsArg } = {}) {
  const tab = TAB_JE_ART[art];
  if (!tab) throw fehler(400, 'art', 'Unbekannte Portal-Art.');
  const pid = String(partnerId ?? '').trim();
  if (!pid) throw fehler(400, 'partner', 'Partner-ID fehlt.');
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) throw fehler(503, 'konfiguration', 'BUSINESS_SHEET_ID nicht konfiguriert.');
  const sheets = sheetsMitWiederholung(sheetsArg ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() }));

  // Ganze Breite lesen (Token_Hash steht hinten).
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${tab}'` });
  const [header = [], ...rows] = data.values ?? [];
  const iId = header.indexOf('Partner-ID');
  const iHash = header.indexOf(SPALTE_HASH);
  const iTok = header.indexOf(SPALTE_TOKEN);
  if (iId === -1) throw fehler(409, 'einrichtung', `Spalte Partner-ID fehlt in ${tab}.`);
  if (iHash === -1) throw fehler(409, 'einrichtung', `Spalte ${SPALTE_HASH} fehlt in ${tab} – erst scripts/setup-partner-token-hash.js.`);
  const treffer = rows.map((r, i) => ({ r, zeile: i + 2 })).filter(x => String(x.r[iId] ?? '').trim() === pid);
  if (!treffer.length) throw fehler(404, 'partner', `Partner ${pid} nicht gefunden.`);
  if (treffer.length > 1) throw fehler(409, 'mehrdeutig', `Partner ${pid} steht mehrfach in ${tab} – nichts geändert.`);
  const { r, zeile } = treffer[0];

  const token = neuerToken();
  const hash = tokenHash(token);
  const zellen = [{ range: `'${tab}'!${colLetter(iHash)}${zeile}`, wert: hash }];
  if (iTok !== -1) zellen.push({ range: `'${tab}'!${colLetter(iTok)}${zeile}`, wert: '' });

  // batchUpdate wird bei 429/5xx wiederholt - gleiche Werte, also unschaedlich.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'RAW', data: zellen.map(z => ({ range: z.range, values: [[z.wert]] })) },
  });
  const { data: zurueck } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId, ranges: zellen.map(z => z.range),
  });
  const ok = zellen.every((z, i) => String(zurueck.valueRanges?.[i]?.values?.[0]?.[0] ?? '') === z.wert);
  if (!ok) throw fehler(500, 'zuruecklesen', `Neuer Link für ${pid} nicht sicher gespeichert – bitte erneut erzeugen.`);

  const iShop = header.indexOf('Shop');
  const shop = iShop !== -1 ? String(r[iShop] ?? '').trim().toLowerCase() : '';
  console.log(`[partnerLink] neuer Link für ${pid} (${tab}) gespeichert.`);
  return { partnerId: pid, link: portalLink(art, token, { shop }) };
}
