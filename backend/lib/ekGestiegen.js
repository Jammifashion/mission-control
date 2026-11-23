// PR1 Teil B: Leseliste "EK gestiegen" - NUR LESEN (nur Sheets, kein Shop-Abruf). Logik utils/ek-gestiegen.js.
// EK/Marge nur in MC - nie Bestellseite, Portal, Lexware, Chat, Log.
import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { leseReiterSpalten } from './ssot-reiter.js';
import { ladeLShopZeilen, farbwert } from './lshop.js';
import { parseKonfiguration } from '../utils/partner-kalkulation.js';
import { TAB_EK_VERLAUF, verlaufJe } from '../utils/ek-verlauf.js';
import { ekGestiegen, ekGestiegenText, PROZENT_STANDARD } from '../utils/ek-gestiegen.js';

const t = v => String(v ?? '').trim();

async function partnerJeProdukt(sheets, spreadsheetId, tab) {
  try {
    const z = await leseReiterSpalten({ tab, spalten: { partner: 'Partner-ID', produkt: 'Produkt-ID' }, sheets, spreadsheetId });
    return new Map(z.filter(x => t(x.produkt)).map(x => [t(x.produkt), t(x.partner)]));
  } catch { return new Map(); }
}

export async function leseEkGestiegen({ prozent = PROZENT_STANDARD, seit = '', sheets: s } = {}) {
  const sheets = s ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });
  const ssot = process.env.GOOGLE_SHEET_ID, biz = process.env.BUSINESS_SHEET_ID;
  let verlauf = new Map();
  try {
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: ssot, range: `'${TAB_EK_VERLAUF}'`, valueRenderOption: 'UNFORMATTED_VALUE' });
    const [kopf = [], ...z] = data.values ?? [];
    verlauf = verlaufJe(z.map(r => Object.fromEntries(kopf.map((k, i) => [t(k), r[i]]))));
  } catch {
    return { seit: '', prozent, artikel: [], hinweis: `Reiter ${TAB_EK_VERLAUF} fehlt – erst scripts/setup-ek-verlauf.js --write, dann füllt ihn das nächste L-Shop-Stammdaten-Update.` };
  }
  const [lshop, varianten, maske, festpreis, lizenz, fix] = await Promise.all([
    ladeLShopZeilen({ sheets, spreadsheetId: ssot }),
    leseReiterSpalten({ tab: 'Varianten', sheets, spreadsheetId: ssot, spalten: { ssot: 'SSOT-ID', articleNr: 'LShop_ArticleNr' }, optional: { preis: 'Preis', aktiv: 'Aktiv' } }),
    leseReiterSpalten({ tab: 'Erfassungsmaske', sheets, spreadsheetId: ssot, spalten: { id: 'ID' }, optional: { produktId: 'Produkt-ID', name: 'Produktname', kategorien: 'Kategorien' } }),
    partnerJeProdukt(sheets, biz, 'FP_Artikel'),
    partnerJeProdukt(sheets, biz, 'Partner_Artikel'),
    sheets.spreadsheets.values.get({ spreadsheetId: biz, range: "'Kalkulation_Fixkosten'" }).then(r => r.data.values ?? []).catch(() => []),
  ]);
  const [fk = [], ...fz] = fix;
  const mwst = fk.length ? parseKonfiguration(fz, fk).mwstProzent : 19;
  const modelle = lshop.map(z => ({ articleNr: t(z.articleNr), catalogNr: t(z.catalogNr), farbe: farbwert(z.color1, z.color2), groesse: t(z.size) }));
  const r = ekGestiegen({ verlauf, modelle, varianten, maske, festpreis, lizenz, prozent, seit, mwst });
  return { ...r, text: ekGestiegenText(r) };
}
