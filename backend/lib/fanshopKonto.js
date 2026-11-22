// GS2 Teil B: Fanshop-Konto eines Festpreis-Partners (Saldo, Fanshop offen, Belege, offene Fanshop-Bestellungen). NUR LESEN.
// Logik utils/fanshop-konto.js. Quellen: FP_Partner.Kunden_Nr (Business), Kunden-Sheet (Lexoffice_ID), fpSaldo (Teil A), Auftraege/Positionen
// (SSOT), Bestell_Eintraege ("für wen" -> nur Vorname), FP_Abrechnungen (Gutschrift-Kennzeichen), Lexware-Belegliste ueber den Belegleser
// (RE2, nur GET). Ergebnis 10 min je Partner + Sicht (MC/Portal); faellt Lexware aus: lexware "unbekannt", keine geratene Zahl.
// Nichts ins Log ausser Partner-ID und Ergebnisart.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { leseKunden } from './kunden.js';
import { liesAuftraege, lshopInfo, nummernAus } from './auftraege.js';
import { liesEintraege } from './bestellseite.js';
import { leseBelegliste } from './lexwareBelege.js';
import { fpSaldo } from '../routes/festpreis-public.js';
import { bauZwischenspeicher } from '../utils/partner-uebersicht.js';
import { fanshopKonto } from '../utils/fanshop-konto.js';
import { SPALTE_KUNDE } from '../utils/gutschrift.js';

const t = v => String(v ?? '').trim();
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const speicher = bauZwischenspeicher();
export const _fanshopKontoLeeren = () => speicher.leeren();

async function werte(sheets, spreadsheetId, tab) {
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    return data.values ?? [];
  } catch (err) {
    if (err?.code === 400 || err?.response?.status === 400) return [];
    throw err;
  }
}

/** "für wen" je Position aus der Bestellseite (nur uebernommene Eintraege). Fehlt der Reiter: leer. */
async function fuerJePosition(sheets, spreadsheetId) {
  const je = new Map();
  let e = null;
  try { e = await liesEintraege(sheets, spreadsheetId); } catch { return je; }
  for (const x of e?.zeilen ?? []) {
    const pid = t(x.Position_ID), f = t(x.Fuer);
    if (!pid || !f || t(x.Status) !== 'übernommen') continue;
    je.set(pid, [...(je.get(pid) ?? []), f]);
  }
  return je;
}

/** Kunden_Nr des FP-Partners ('' = nicht verknuepft). */
export async function kundenNrVon(sheets, spreadsheetId, partnerId) {
  const [kopf = [], ...z] = await werte(sheets, spreadsheetId, 'FP_Partner');
  const k = kopf.map(t), iP = k.indexOf('Partner-ID'), iK = k.indexOf(SPALTE_KUNDE);
  if (iK === -1) return '';
  return t(z.find(r => t(r[iP]) === partnerId)?.[iK]);
}

/**
 * @param {{ partnerId, mitEntwuerfen: boolean, sheets?, belegeLesen? }} o
 * @returns {Promise<{ aktiv: false } | object>} siehe fanshopKonto
 */
export async function leseFanshopKonto({ partnerId, mitEntwuerfen = false, sheets: s, belegeLesen = leseBelegliste } = {}) {
  return speicher.hole(`${partnerId}:${mitEntwuerfen ? 'mc' : 'portal'}`, async () => {
    const sheets = s ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });
    const biz = process.env.BUSINESS_SHEET_ID, ssot = process.env.GOOGLE_SHEET_ID;
    if (!biz || !ssot) throw Object.assign(new Error('Sheet-IDs fehlen.'), { status: 503 });
    const kundenNr = await kundenNrVon(sheets, biz, partnerId);
    if (!kundenNr) return { aktiv: false };
    const { kunden } = await leseKunden({ sheets });
    const kontaktId = t(kunden.find(k => k.Kunden_Nr === kundenNr)?.Lexoffice_ID);
    const saldo = await fpSaldo(sheets, biz, partnerId);
    const [kopf = [], ...abr] = await werte(sheets, biz, 'FP_Abrechnungen');
    const ka = kopf.map(t);
    const gutschriften = abr.filter(r => t(r[ka.indexOf('Partner-ID')]) === partnerId && ID_RE.test(t(r[ka.indexOf('Gutschrift_Lexware_ID')])))
      .map(r => ({ abrechnung: t(r[ka.indexOf('Abrechnungs-ID')]), id: t(r[ka.indexOf('Gutschrift_Lexware_ID')]) }));
    const { a, p } = await liesAuftraege(sheets, ssot);
    const eigeneNr = new Set(a.zeilen.filter(x => t(x.Kunden_Nr) === kundenNr).map(x => t(x.Auftrag_Nr)));
    const akt = p.zeilen.filter(x => eigeneNr.has(t(x.Auftrag_Nr)));
    const { info } = await lshopInfo(sheets, ssot, nummernAus(akt));
    const fuerJe = await fuerJePosition(sheets, ssot);
    let belege = null;
    if (ID_RE.test(kontaktId)) {
      try {
        const r = await belegeLesen({ voucherType: 'invoice,creditnote', voucherStatus: 'any', contactId: kontaktId, sort: 'voucherDate,DESC' }, { maxSeiten: 4 });
        belege = new Map(r.belege.map(b => [b.id, b]));
      } catch (err) {
        console.warn(`GS2: Lexware-Belege für ${partnerId} nicht lesbar (${err?.code ?? err?.lexwareStatus ?? err?.name ?? 'Fehler'}) – Stand unbekannt.`);
      }
    }
    return fanshopKonto({
      kundenNr, auftraege: a.zeilen, positionen: p.zeilen, info, fuerJe, gutschriften, belege, mitEntwuerfen,
      auszahlung: { saldo: saldo.saldoBrutto, ausstehend: saldo.ausstehendBrutto, laufend: saldo.laufendBrutto + saldo.entwurfBrutto, abgerechnetBis: saldo.abgerechnetBis },
    });
  });
}
