import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';

const TAB_CONFIG = 'Config';
const TTL_MS      = 5 * 60 * 1000;
const PREFIX      = 'modell.';
const VALID_MODEL_RE = /^(claude|gemini)-[a-z0-9.\-]+$/;

// Rolle → Modell-ID. Dient als Fallback, falls das Config-Sheet nicht
// erreichbar ist, keinen Eintrag für die Rolle hat, oder der Eintrag
// nicht gegen VALID_MODEL_RE matcht.
export const DEFAULT_MODELS = {
  'chat-kunde':      'claude-sonnet-5',
  'klassifizierung': 'gemini-3.1-flash-lite',
  'seo-text':        'gemini-3.5-flash-lite',
  'agent-intern':    'claude-sonnet-5',
};

// Generischer Fallback für Rollen, die nicht in DEFAULT_MODELS bekannt sind.
// getModel() darf nie undefined zurückgeben – auch für Tippfehler/neue,
// noch nicht deklarierte Rollen muss ein sinnvolles Modell herauskommen.
const FALLBACK_ROLLE = 'agent-intern';

// Cache: { models: { rolle: wert }, cachedAt } – analog agentWissenHelper.js
let _cache = null;

export function invalidateCache() {
  _cache = null;
}

async function getSheets() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth });
}

async function loadModelsFromSheet() {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) return {};

  const sheets = await getSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB_CONFIG}!A:E`,
  });

  const [header, ...rawRows] = data.values ?? [];
  if (!header) return {};

  const h = col => header.indexOf(col);
  const iSchluessel = h('Schlüssel');
  const iWert       = h('Wert');
  if (iSchluessel === -1 || iWert === -1) return {};

  const rows = rawRows.filter(r => r.some(c => c) && !(r[0] ?? '').startsWith('//'));

  const models = {};
  rows.forEach(r => {
    const schluessel = String(r[iSchluessel] ?? '').trim();
    if (!schluessel.startsWith(PREFIX)) return;
    const rolle = schluessel.slice(PREFIX.length).trim();
    if (!rolle) return;
    models[rolle] = String(r[iWert] ?? '').trim();
  });

  return models;
}

// Liefert die aktuelle Rollen→Wert-Map aus dem Cache oder frisch vom Sheet.
// Wirft nie – bei jedem Fehler wird eine leere Map zurückgegeben, sodass
// getModel() auf DEFAULT_MODELS zurückfällt. Der Fehlerfall wird NICHT
// gecacht, damit der nächste Aufruf es erneut versucht.
async function getModelsMap() {
  if (_cache && Date.now() - _cache.cachedAt < TTL_MS) {
    return _cache.models;
  }
  try {
    const models = await loadModelsFromSheet();
    _cache = { models, cachedAt: Date.now() };
    return models;
  } catch (e) {
    console.warn('modelConfig: Config-Sheet nicht erreichbar, nutze Defaults:', e.message);
    return {};
  }
}

// Löst eine Rolle auf. Reihenfolge:
//  1. Sheet-Wert, falls vorhanden UND gültiges Format (claude-... / gemini-...)
//  2. DEFAULT_MODELS[rolle]
//  3. Bei unbekannter Rolle: DEFAULT_MODELS[FALLBACK_ROLLE] (+ Warnung)
// Liefert nie undefined. Gemeinsame Basis für getModel() und getModelInfo(),
// damit beide garantiert dasselbe Ergebnis für dieselbe Rolle liefern.
async function resolveModel(rolle) {
  const bekannteRolle = Object.prototype.hasOwnProperty.call(DEFAULT_MODELS, rolle);
  if (!bekannteRolle) {
    console.warn(`modelConfig: unbekannte Rolle "${rolle}" angefragt – nutze Fallback-Rolle "${FALLBACK_ROLLE}".`);
    rolle = FALLBACK_ROLLE;
  }

  const fallback = DEFAULT_MODELS[rolle];
  const models    = await getModelsMap();
  const roh       = models[rolle];
  // Sheet-Werte werden bereits in loadModelsFromSheet() getrimmt – hier
  // trotzdem nochmal, damit resolveModel() auch robust bleibt, falls
  // getModelsMap() künftig aus einer anderen, ungetrimmten Quelle speist.
  const sheetWert = typeof roh === 'string' ? roh.trim() : roh;

  if (sheetWert === undefined || sheetWert === '') {
    return { rolle, modell: fallback, quelle: 'fallback' };
  }

  if (!VALID_MODEL_RE.test(sheetWert)) {
    console.warn(`modelConfig: ungültiger Modell-Wert für Rolle "${rolle}": "${sheetWert}" – nutze Fallback "${fallback}".`);
    return { rolle, modell: fallback, quelle: 'fallback' };
  }

  return { rolle, modell: sheetWert, quelle: 'sheet' };
}

// Liefert nur die Modell-ID (String) – unveränderte Signatur/Semantik für
// bestehende Aufrufstellen.
export async function getModel(rolle) {
  const { modell } = await resolveModel(rolle);
  return modell;
}

// Liefert zusätzlich die Quelle ('sheet' | 'fallback') und die effektiv
// verwendete Rolle (bei unbekannter Rolle: FALLBACK_ROLLE) – für Diagnose-
// Tooling wie backend/scripts/check-config.js.
export async function getModelInfo(rolle) {
  return resolveModel(rolle);
}
