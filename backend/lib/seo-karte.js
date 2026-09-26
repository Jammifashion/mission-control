// SEO_Karte-Zeile eines Artikels nach dem Yoast-Speichern nachziehen (Befehl M9).
//
// Heute der einzige Schreiber der SEO_Karte im Code. Aufrufer: POST
// /api/seo/karte (routes/seo-meta.js), das Frontend ruft sie aus
// yoastSchreiben() NACH dem Zuruecklesen der Yoast-Felder. Ein Fehler hier
// macht das Yoast-Speichern nicht rueckgaengig.
//
// Regeln (auftrag-M9):
//  - Nur Zeilen mit Typ "Artikel", Schluessel WC_ID. Kategorien nie.
//  - Header-basiert, RAW, nur die Zellen, die sich aendern - jede andere
//    Spalte (auch unbekannte Zusatzspalten) bleibt, wie sie ist.
//  - Keine Zeile: neue Zeile unter der letzten Datenzeile. Ist_* aus dem
//    Shop (Ist_Synonyme = Yoast-Rohwert), Soll_Keyphrase = Ist, Soll_Synonyme
//    = Ist ohne ["..."], Stand = heute, Typ "Artikel", Status "geschrieben",
//    Pfad/Oberkategorie aus den Shop-Kategorien (kartePfad), Artikel leer.
//  - Genau eine Zeile: Ist_* und Stand. Soll_* nur, wenn leer oder gleich dem
//    bisherigen Ist (kein offener Plan); sonst Hinweis.
//  - Mehrere Zeilen: nichts schreiben, Fehler 409.
//  - Nie: noindex, Ueberschreiben, Befund, Soll_SEO_Titel, Soll_Meta, Notiz,
//    Status/Name/Pfad einer bestehenden Zeile, andere Zeilen, Filter.
//
// Pfad-Regel (gemessen 26.09. an 548 Artikel-Zeilen mit genau einer
// Blattkategorie: 527 gleich, die 21 anderen stammen aus einer spaeter
// umbenannten Oberkategorie): Pfad = Namen der WC-Kategorie-Kette der
// EINEN Blattkategorie (zugeordnete Kategorie, die nicht Vorfahr einer
// anderen zugeordneten ist), "A > B > C". Mehrere Blaetter: nicht eindeutig,
// Pfad leer + Hinweis (bei 23 solchen Zeilen hatte ein Mensch gewaehlt).
// Oberkategorie = erster Teil des Pfads (570 von 574), bei mehreren Blaettern
// nur, wenn alle dieselbe Oberkategorie haben.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getWcClient } from './shopConfig.js';
import { requireHeader } from '../utils/sheet-headers.js';
import { colLetter } from '../utils/sheet-spalten.js';
import { synonymeListe, karteVergessen } from './seo-ssot.js';

export const TAB_SEO_KARTE = 'SEO_Karte';
const CTX = `Reiter "${TAB_SEO_KARTE}"`;

export const YOAST = {
  keyphrase: '_yoast_wpseo_focuskw',
  synonyme:  '_yoast_wpseo_keywordsynonyms',
  titel:     '_yoast_wpseo_title',
  meta:      '_yoast_wpseo_metadesc',
};

// Spalten, die M9 liest oder schreibt. Alle Pflicht.
const SPALTEN = ['Typ', 'Name', 'Pfad', 'Artikel', 'Ist_Keyphrase', 'Ist_Synonyme', 'Ist_SEO_Titel',
  'Ist_Meta', 'WC_ID', 'Oberkategorie', 'Soll_Keyphrase', 'Soll_Synonyme', 'Status', 'Stand'];

const t = v => String(v ?? '').trim();
const norm = v => t(v).toLowerCase().replace(/\s+/g, ' ');

function fehler(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// ── Reine Logik (backend/tests/seo-karte.test.js) ───────────────────────────

/** WC liefert Namen HTML-kodiert ("Kids &amp; Teens"). */
export function entities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Pfad und Oberkategorie aus den Kategorien des Artikels.
 * @param {number[]} katIds   Kategorien des Artikels
 * @param {object[]} kategorien alle WC-Kategorien [{ id, name, parent }]
 * @returns {{ pfad: string, oberkategorie: string, hinweis: string|null }}
 */
export function kartePfad(katIds, kategorien) {
  const byId = new Map((kategorien ?? []).map(k => [Number(k.id), k]));
  const kette = id => {
    const out = [];
    for (let x = byId.get(Number(id)), n = 0; x && n < 20; x = byId.get(Number(x.parent)), n++) out.unshift(x);
    return out;
  };
  const ids = [...new Set((katIds ?? []).map(Number))].filter(id => byId.has(id));
  if (!ids.length) return { pfad: '', oberkategorie: '', hinweis: 'Pfad nicht eindeutig: Artikel ohne bekannte Kategorie – Pfad und Oberkategorie leer.' };
  const vorfahren = new Set(ids.flatMap(id => kette(id).slice(0, -1).map(k => Number(k.id))));
  const blaetter = ids.filter(id => !vorfahren.has(id));
  const pfade = blaetter.map(id => kette(id).map(k => entities(k.name).trim()).join(' > '));
  const ober = [...new Set(pfade.map(p => p.split(' > ')[0]))];
  if (pfade.length === 1) return { pfad: pfade[0], oberkategorie: ober[0], hinweis: null };
  return {
    pfad: '',
    oberkategorie: ober.length === 1 ? ober[0] : '',
    hinweis: `Pfad nicht eindeutig (${pfade.join(' | ')}) – Pfad${ober.length === 1 ? '' : ' und Oberkategorie'} leer, bitte in der SEO_Karte setzen.`,
  };
}

/** Yoast-Rohwert -> Soll-Form ohne ["..."]: "a, b, c". */
export function sollSynonyme(roh) {
  return synonymeListe(roh).join(', ');
}

/**
 * Was an der Karte zu schreiben ist.
 * @param {object} o
 * @param {object[]} o.treffer  Artikel-Zeilen mit dieser WC_ID [{ zeile, werte: {Spalte: Wert} }]
 * @param {object}   o.ist      { name, keyphrase, synonyme, titel, meta } aus dem Shop
 * @param {object}   o.pfad     Ergebnis von kartePfad
 * @param {string}   o.heute    "YYYY-MM-DD"
 * @param {string}   o.wcId
 * @returns {{ aktion: 'neu'|'aktualisieren', zellen: Object<string,string>, hinweise: string[] }}
 */
export function karteAenderung({ treffer, ist, pfad, heute, wcId }) {
  const liste = treffer ?? [];
  if (liste.length > 1)
    throw fehler(`WC_ID ${wcId} steht ${liste.length}× in der SEO_Karte (Zeilen ${liste.map(z => z.zeile).join(', ')}) – nichts geschrieben.`, 409);

  const istZellen = {
    Ist_Keyphrase: t(ist.keyphrase),
    Ist_Synonyme:  String(ist.synonyme ?? '').trim(),
    Ist_SEO_Titel: t(ist.titel),
    Ist_Meta:      t(ist.meta),
    Stand:         heute,
  };
  const sollKp  = istZellen.Ist_Keyphrase;
  const sollSyn = sollSynonyme(istZellen.Ist_Synonyme);

  if (!liste.length) {
    return {
      aktion: 'neu',
      zellen: {
        Typ: 'Artikel', Name: t(entities(ist.name)), Pfad: pfad.pfad, Artikel: '',
        WC_ID: String(wcId), Oberkategorie: pfad.oberkategorie, Status: 'geschrieben',
        ...istZellen, Soll_Keyphrase: sollKp, Soll_Synonyme: sollSyn,
      },
      hinweise: pfad.hinweis ? [pfad.hinweis] : [],
    };
  }

  const alt = liste[0].werte;
  const zellen = { ...istZellen };
  const hinweise = [];
  const kpFrei  = !t(alt.Soll_Keyphrase) || norm(alt.Soll_Keyphrase) === norm(alt.Ist_Keyphrase);
  const synFrei = !t(alt.Soll_Synonyme)
    || norm(sollSynonyme(alt.Soll_Synonyme)) === norm(sollSynonyme(alt.Ist_Synonyme));
  if (kpFrei) zellen.Soll_Keyphrase = sollKp;
  if (synFrei) zellen.Soll_Synonyme = sollSyn;
  const abweichend = [!kpFrei && 'Soll_Keyphrase', !synFrei && 'Soll_Synonyme'].filter(Boolean);
  if (abweichend.length)
    hinweise.push(`Karte hat abweichendes Soll (${abweichend.join(', ')}, Zeile ${liste[0].zeile}) – bitte pruefen.`);
  return { aktion: 'aktualisieren', zellen, hinweise };
}

/** Heute in Berlin als YYYY-MM-DD. */
export function heuteBerlin(jetzt = new Date()) {
  return jetzt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

// ── Lesen / Schreiben ───────────────────────────────────────────────────────

let _katCache = null;   // { zeit, liste }
export function _resetKarteCache() { _katCache = null; }

async function wcKategorien(wc) {
  if (_katCache && Date.now() - _katCache.zeit < 10 * 60 * 1000) return _katCache.liste;
  const liste = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get('products/categories', { per_page: 100, page, _fields: 'id,name,parent' });
    liste.push(...(Array.isArray(data) ? data : []));
    if (!Array.isArray(data) || data.length < 100) break;
  }
  _katCache = { zeit: Date.now(), liste };
  return liste;
}

const metaWert = (md, key) => {
  const e = (Array.isArray(md) ? md : []).find(m => m && m.key === key);
  return e && typeof e.value === 'string' ? e.value : '';
};

/**
 * Karte fuer einen Artikel nachziehen. Liest den Artikel selbst neu aus dem
 * Shop (context=edit) - die Karte bekommt den Shop-Stand, nicht den
 * Formularwert.
 * @returns {Promise<{ aktion, zeile, geschrieben: string[], hinweise: string[], abweichungen: string[] }>}
 */
export async function seoKarteNachziehen(wcId, { sheets, spreadsheetId = process.env.GOOGLE_SHEET_ID, wc, heute } = {}) {
  const id = t(wcId);
  if (!/^\d+$/.test(id)) throw fehler('wcId fehlt oder ist keine Zahl.');
  if (!spreadsheetId) throw fehler('GOOGLE_SHEET_ID fehlt.', 500);
  const shop = wc ?? getWcClient();
  const api  = sheets ?? google.sheets({ version: 'v4', auth: await getGoogleAuth() });

  const { data: p } = await shop.get(`products/${id}`, { context: 'edit' });
  const ist = {
    name: p.name,
    keyphrase: metaWert(p.meta_data, YOAST.keyphrase),
    synonyme:  metaWert(p.meta_data, YOAST.synonyme),
    titel:     metaWert(p.meta_data, YOAST.titel),
    meta:      metaWert(p.meta_data, YOAST.meta),
  };

  const { data } = await api.spreadsheets.values.get({
    spreadsheetId, range: TAB_SEO_KARTE, valueRenderOption: 'FORMATTED_VALUE',
  });
  const werte = data.values ?? [];
  const header = werte[0] ?? [];
  if (!header.length) throw fehler(`${CTX} fehlt oder hat keine Kopfzeile.`, 500);
  const idx = Object.fromEntries(SPALTEN.map(s => [s, requireHeader(header, s, CTX)]));
  const zeileObj = r => Object.fromEntries(SPALTEN.map(s => [s, String(r?.[idx[s]] ?? '')]));

  let letzte = 1;
  const treffer = [];
  werte.forEach((r, i) => {
    if (i === 0) return;
    if ((r ?? []).some(c => t(c))) letzte = i + 1;
    if (t(r?.[idx.Typ]) === 'Artikel' && t(r?.[idx.WC_ID]) === id) treffer.push({ zeile: i + 1, werte: zeileObj(r) });
  });

  const pfad = treffer.length ? { pfad: '', oberkategorie: '', hinweis: null }
    : kartePfad((p.categories ?? []).map(c => c.id), await wcKategorien(shop));
  const { aktion, zellen, hinweise } = karteAenderung({ treffer, ist, pfad, heute: heute ?? heuteBerlin(), wcId: id });
  const zeile = aktion === 'neu' ? letzte + 1 : treffer[0].zeile;

  // Nur Zellen, die sich aendern (bei "neu": alle gesetzten).
  const alt = treffer[0]?.werte ?? {};
  const schreiben = Object.entries(zellen).filter(([s, w]) => aktion === 'neu' ? w !== '' : alt[s] !== w);
  if (schreiben.length) {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: schreiben.map(([s, w]) => ({ range: `${TAB_SEO_KARTE}!${colLetter(idx[s])}${zeile}`, values: [[w]] })),
      },
    });
    karteVergessen();   // Kollisionspruefung (M4) sieht sofort den neuen Stand
  }

  // Zuruecklesen: jede geschriebene Zelle gegen ihren Wert.
  const abweichungen = [];
  if (schreiben.length) {
    const ende = colLetter(header.length - 1);
    const { data: z } = await api.spreadsheets.values.get({
      spreadsheetId, range: `${TAB_SEO_KARTE}!A${zeile}:${ende}${zeile}`, valueRenderOption: 'FORMATTED_VALUE',
    });
    const r = z.values?.[0] ?? [];
    for (const [s, w] of schreiben) if (String(r[idx[s]] ?? '') !== w) abweichungen.push(`${s}: steht "${r[idx[s]] ?? ''}" statt "${w}"`);
  }
  return { aktion, zeile, geschrieben: schreiben.map(([s]) => s), hinweise, abweichungen };
}

