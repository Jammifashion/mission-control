// PPS1: "Link neu erzeugen" fuer einen Partner (Lizenz: Reiter `Partner`, Festpreis: `FP_Partner`), Logik in
// utils/partner-token.js. Der alte Link ist danach sofort ungueltig: `Token_Hash` bekommt den neuen Hash, die alte
// Klartext-Spalte `Token` wird geleert. Fehlt die Spalte `Token_Hash` -> 409 `einrichtung` (scripts/setup-partner-token-hash.js).
// LK1: Steht hinten `Token_Verschluesselt`, kommt der neue Token dort AES-256-GCM-verschluesselt hinein (utils/link-schluessel.js,
// Kontext "<art>:<Partner-ID>") - ohne Schluessel wird die Zelle GELEERT (ein alter verschluesselter Wert gehoerte zum alten
// Link). `zeigePartnerLink` gibt den Link fuer "Link kopieren" an MC (nur hinter dem API-Key). Schreibt nur diese Zellen (RAW)
// und liest sie zurueck. Nie Token/Hash/verschluesselten Wert in Log oder Fehlertext.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { sheetsMitWiederholung } from './googleRetry.js';
import { ladeLinkSchluessel } from './linkSchluessel.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { SPALTE_TOKEN, SPALTE_HASH, tokenHash, neuerToken, portalLink, zugangArt, klartextFuerMc } from '../utils/partner-token.js';
import { SPALTE_VERSCHLUESSELT, verschluessele, tokenFuerMc, linkFehler } from '../utils/link-schluessel.js';

const TAB_JE_ART = { lizenz: 'Partner', festpreis: 'FP_Partner' };

const fehler = (status, code, meldung) => Object.assign(new Error(meldung), { status, code });
export const partnerKontext = (art, partnerId) => `${art}:${String(partnerId ?? '').trim()}`;

async function liesPartner({ art, partnerId, sheets: sheetsArg }) {
  const tab = TAB_JE_ART[art];
  if (!tab) throw fehler(400, 'art', 'Unbekannte Portal-Art.');
  const pid = String(partnerId ?? '').trim();
  if (!pid) throw fehler(400, 'partner', 'Partner-ID fehlt.');
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) throw fehler(503, 'konfiguration', 'BUSINESS_SHEET_ID nicht konfiguriert.');
  const sheets = sheetsMitWiederholung(sheetsArg ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() }));
  // Ganze Breite lesen (Token_Hash / Token_Verschluesselt stehen hinten).
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `'${tab}'` });
  const [header = [], ...rows] = data.values ?? [];
  const iId = header.indexOf('Partner-ID');
  if (iId === -1) throw fehler(409, 'einrichtung', `Spalte Partner-ID fehlt in ${tab}.`);
  const treffer = rows.map((r, i) => ({ r, zeile: i + 2 })).filter(x => String(x.r[iId] ?? '').trim() === pid);
  if (!treffer.length) throw fehler(404, 'partner', `Partner ${pid} nicht gefunden.`);
  if (treffer.length > 1) throw fehler(409, 'mehrdeutig', `Partner ${pid} steht mehrfach in ${tab} – nichts geändert.`);
  const { r, zeile } = treffer[0];
  const iShop = header.indexOf('Shop');
  const shop = iShop !== -1 ? String(r[iShop] ?? '').trim().toLowerCase() : '';
  return { tab, pid, sheetId, sheets, header, r, zeile, shop };
}

export async function erzeugeNeuenPartnerLink({ art, partnerId, sheets: sheetsArg, schluesselLaden = ladeLinkSchluessel } = {}) {
  const { tab, pid, sheetId, sheets, header, zeile, shop } = await liesPartner({ art, partnerId, sheets: sheetsArg });
  const iHash = header.indexOf(SPALTE_HASH);
  const iTok = header.indexOf(SPALTE_TOKEN);
  const iVer = header.indexOf(SPALTE_VERSCHLUESSELT);
  if (iHash === -1) throw fehler(409, 'einrichtung', `Spalte ${SPALTE_HASH} fehlt in ${tab} – erst scripts/setup-partner-token-hash.js.`);

  const token = neuerToken();
  const hash = tokenHash(token);
  const zellen = [{ range: `'${tab}'!${colLetter(iHash)}${zeile}`, wert: hash }];
  if (iTok !== -1) zellen.push({ range: `'${tab}'!${colLetter(iTok)}${zeile}`, wert: '' });
  let kopierbar = false;
  if (iVer !== -1) {
    const schluessel = await schluesselLaden();
    const wert = schluessel ? verschluessele(token, schluessel, partnerKontext(art, pid)) : '';
    kopierbar = Boolean(wert);
    zellen.push({ range: `'${tab}'!${colLetter(iVer)}${zeile}`, wert });
  }

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

  console.log(`[partnerLink] neuer Link für ${pid} (${tab}) gespeichert${kopierbar ? ' (kopierbar)' : ''}.`);
  return { partnerId: pid, link: portalLink(art, token, { shop }), kopierbar };
}

/** LK1: Link fuer "Link kopieren" (nur MC). Uebergang PPS1: Klartext ohne Hash gilt wie bisher. Sonst 409 link_<status>. */
export async function zeigePartnerLink({ art, partnerId, sheets: sheetsArg, schluesselLaden = ladeLinkSchluessel } = {}) {
  const { pid, header, r, shop } = await liesPartner({ art, partnerId, sheets: sheetsArg });
  if (zugangArt(header, r) === 'klartext') return { partnerId: pid, link: portalLink(art, klartextFuerMc(header, r), { shop }) };
  const iVer = header.indexOf(SPALTE_VERSCHLUESSELT);
  const wert = iVer !== -1 ? r[iVer] : '';
  const hash = r[header.indexOf(SPALTE_HASH)];
  const schluessel = String(wert ?? '').trim() ? await schluesselLaden() : null;
  const e = tokenFuerMc({ wert, hash, schluessel, kontext: partnerKontext(art, pid) });
  if (e.status !== 'ok') throw linkFehler(e.status);
  return { partnerId: pid, link: portalLink(art, e.token, { shop }) };
}

/** Fuer die MC-Listen: kann "Link kopieren" ohne neuen Link gehen? (ohne Schluessel zu laden; ohne Wert) */
export function partnerKopierbar(header, row) {
  if (zugangArt(header, row) === 'klartext') return true;
  const iVer = header.indexOf(SPALTE_VERSCHLUESSELT);
  return iVer !== -1 && Boolean(String(row[iVer] ?? '').trim());
}
