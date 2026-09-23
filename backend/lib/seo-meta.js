// SEO-Titel und Meta-Beschreibung fuer Yoast - DETERMINISTISCH, ohne
// Sprachmodell. Die Regeln stehen hier, an genau einer Stelle. index.html
// spiegelt den reinen Bau-Teil im Block "SEO-Meta: Anfang" (Muster sku.js),
// backend/tests/seo-meta.test.js prueft beide auf gleiche Ergebnisse.
//
// Geschrieben wird ueber denselben Weg wie Keyphrase und Synonyme
// (79e1ccd/849c65b): PUT products/<id> mit AUSSCHLIESSLICH meta_data, Schluessel
// _yoast_wpseo_title und _yoast_wpseo_metadesc.
//
// ⚠️ GEMESSEN (M1, 23.09.): "<Keyphrase> %%sep%% %%sitename%%" ueber die REST in
// _yoast_wpseo_title geschrieben, wird von Yoast aufgeloest und zeigt
// "... | JammiFashion". Das Trennzeichen steht in Yoast global auf |. Die
// Platzhalter darum WOERTLICH so schreiben - nicht " | JammiFashion" einsetzen,
// sonst haengt der Titel nicht mehr an der globalen Einstellung.
//
// Kein Aufruf an seo-text oder agent-intern, kein Modell - absichtlich.

import { materialAusEigenschaften, MATERIAL_PLACEHOLDER } from './seo-prompt.js';
import { groessenRang } from './groessen.js';

export const META_MAX          = 160;   // Zeichen, nicht Bytes
export const TITEL_VORLAGE     = '%%sep%% %%sitename%%';
export const WRIST_SATZ        = 'gedruckt nach Bestellung in Wrist';
// _lieferzeit des WooCommerce-Produkts: nur 21 ist selbst bedruckte Ware.
// 20/22/666 sind Beschaffungs- und Zukaufware bzw. Trikots (extern gedruckt).
export const LIEFERZEIT_SELBST = '21';

export const YOAST_TITEL_KEY    = '_yoast_wpseo_title';
export const YOAST_METADESC_KEY = '_yoast_wpseo_metadesc';
export const LIEFERZEIT_KEY     = '_lieferzeit';

// ── Reiner Bau-Teil (gespiegelt in index.html) ──────────────────────────────

/** Laenge in Zeichen (Codepoints), nicht in Bytes und nicht in UTF-16-Einheiten. */
export function zeichenLaenge(text) {
  return [...String(text ?? '')].length;
}

/** "<Keyphrase> %%sep%% %%sitename%%" - oder null bei leerer Keyphrase. */
export function baueSeoTitel(keyphrase) {
  const k = String(keyphrase ?? '').trim();
  return k ? `${k} ${TITEL_VORLAGE}` : null;
}

/** "in Schwarz" / "in Pink und Schwarz" / "in A, B und C" / "in 4 Farben". */
export function farbenText(farben) {
  const liste = [];
  for (const f of Array.isArray(farben) ? farben : []) {
    const w = String(f ?? '').trim();
    if (w && !liste.some(x => x.toLowerCase() === w.toLowerCase())) liste.push(w);
  }
  if (!liste.length) return '';
  if (liste.length === 1) return `in ${liste[0]}`;
  if (liste.length <= 3) return `in ${liste.slice(0, -1).join(', ')} und ${liste[liste.length - 1]}`;
  return `in ${liste.length} Farben`;
}

// Rang einer Groesse: lib/groessen.js (eine Stelle, auch fuer die Shop-Sortierung).

/**
 * Kleinste und groesste Groesse der Variantenauswahl.
 * @returns {{ text: string|null, hinweis: string|null }}
 */
export function groessenSpanne(groessen) {
  const liste = (Array.isArray(groessen) ? groessen : [])
    .map(g => String(g ?? '').trim()).filter(Boolean);
  if (!liste.length) return { text: null, hinweis: null };

  const raenge = liste.map(g => ({ g, r: groessenRang(g) }));
  const unklar = raenge.filter(x => !x.r).map(x => x.g);
  if (unklar.length || new Set(raenge.map(x => x.r.klasse)).size > 1) {
    return {
      text: null,
      hinweis: `Größen nicht sortierbar (${liste.join(', ')}) – Größenspanne weggelassen.`,
    };
  }
  const sortiert = [...raenge].sort((a, b) => a.r.rang - b.r.rang);
  const von = sortiert[0].g;
  const bis = sortiert[sortiert.length - 1].g;
  if (sortiert[0].r.rang === sortiert[sortiert.length - 1].r.rang) {
    return { text: `Größe ${von}`, hinweis: null };
  }
  return { text: `Größen ${von} bis ${bis}`, hinweis: null };
}

/** Rohwert von _lieferzeit aus meta_data, getrimmt - oder null. */
export function lieferzeitAusMeta(metaData) {
  const eintrag = (Array.isArray(metaData) ? metaData : []).find(m => m && m.key === LIEFERZEIT_KEY);
  if (!eintrag || eintrag.value == null) return null;
  if (typeof eintrag.value === 'object') return null;       // unerwartete Form = unlesbar
  const w = String(eintrag.value).trim();
  return w || null;
}

// Satzteil ohne End-Punkt und Randleerzeichen.
function teil(text) {
  return String(text ?? '').trim().replace(/[\s.,;]+$/, '');
}

// Satz mit grossem Anfang und genau einem Punkt am Ende.
function satz(text) {
  const t = teil(text);
  if (!t) return '';
  return t.charAt(0).toLocaleUpperCase('de-DE') + t.slice(1) + '.';
}

/**
 * Meta-Beschreibung nach der Grundform
 *   "<Keyphrase> in <Farben>, <Faserangabe>, <Grammatur>. Größen <von> bis
 *    <bis>, gedruckt nach Bestellung in Wrist."
 *
 * Fehlende Teile fallen weg, Satzzeichen und Satzanfang werden danach
 * gerichtet. Ueber META_MAX Zeichen wird in fester Reihenfolge gekuerzt:
 * (1) Grammatur, (2) Groessenspanne. Der Wrist-Satz bleibt. Reicht das nicht,
 * wird NICHT geschrieben - abgeschnitten wird nie.
 *
 * @param {object}   e
 * @param {string}   e.keyphrase
 * @param {string[]} e.farben        Werte der Farbachse, Shop-Schreibweise
 * @param {string}   e.faserangabe   Ergebnis NACH filterMaterialFarben
 * @param {string}   e.faserMeldung  Meldung der Nachbedingung (dann weglassen)
 * @param {string}   e.grammatur
 * @param {string[]} e.groessen      Variantenauswahl
 * @param {string}   e.lieferzeit    Rohwert von _lieferzeit
 * @returns {{ text: string|null, laenge: number, schreiben: boolean,
 *             weggelassen: string[], hinweise: string[] }}
 */
export function baueMetaBeschreibung(e = {}) {
  const hinweise = [];
  const k = teil(e.keyphrase);
  if (!k) {
    return {
      text: null, laenge: 0, schreiben: false, weggelassen: [],
      hinweise: ['Keine Fokus-Keyphrase – keine Meta-Beschreibung.'],
    };
  }

  const farben = farbenText(e.farben);

  let faser = teil(e.faserangabe);
  if (e.faserMeldung) {
    hinweise.push(`Faserangabe weggelassen: ${e.faserMeldung}`);
    faser = '';
  } else if (!faser) {
    hinweise.push('Keine Faserangabe – Teil weggelassen.');
  }

  const grammatur = teil(e.grammatur);

  const spanne = groessenSpanne(e.groessen);
  if (spanne.hinweis) hinweise.push(spanne.hinweis);

  const lz = String(e.lieferzeit ?? '').trim();
  const wrist = lz === LIEFERZEIT_SELBST;
  if (!wrist) {
    hinweise.push(lz
      ? `_lieferzeit ist "${lz}", nicht ${LIEFERZEIT_SELBST} (nicht selbst bedruckt) – „${WRIST_SATZ}“ weggelassen.`
      : `_lieferzeit nicht lesbar – „${WRIST_SATZ}“ weggelassen.`);
  }

  const bauen = (mitGrammatur, mitGroessen) => {
    const erster  = [[k, farben].filter(Boolean).join(' '), faser, mitGrammatur ? grammatur : '']
      .filter(Boolean).join(', ');
    const zweiter = [mitGroessen ? spanne.text : '', wrist ? WRIST_SATZ : '']
      .filter(Boolean).join(', ');
    return [satz(erster), satz(zweiter)].filter(Boolean).join(' ');
  };

  const weggelassen = [];
  let mitGrammatur = !!grammatur;
  let mitGroessen  = !!spanne.text;
  let text = bauen(mitGrammatur, mitGroessen);

  if (zeichenLaenge(text) > META_MAX && mitGrammatur) {
    mitGrammatur = false;
    weggelassen.push('Grammatur');
    text = bauen(mitGrammatur, mitGroessen);
  }
  if (zeichenLaenge(text) > META_MAX && mitGroessen) {
    mitGroessen = false;
    weggelassen.push('Größenspanne');
    text = bauen(mitGrammatur, mitGroessen);
  }

  const laenge = zeichenLaenge(text);
  const schreiben = laenge <= META_MAX;
  if (!schreiben) {
    hinweise.push(`Meta-Beschreibung hat auch gekürzt ${laenge} Zeichen (max. ${META_MAX}) – nicht geschrieben.`);
  }
  return { text, laenge, schreiben, weggelassen, hinweise };
}

/**
 * Darf ein neuer Wert in ein Yoast-Feld?
 * Leerer Shop-Wert -> schreiben. Gleicher Wert -> unveraendert. Abweichender
 * Wert -> bleibt, ausser das Haekchen "ueberschreiben" ist gesetzt.
 *
 * @returns {{ aktion: 'schreiben'|'unveraendert'|'behalten'|'kein-wert' }}
 */
export function yoastEntscheidung({ neu, vorhanden, ueberschreiben = false } = {}) {
  const n = String(neu ?? '').trim();
  const v = String(vorhanden ?? '').trim();
  if (!n) return { aktion: 'kein-wert' };
  if (!v) return { aktion: 'schreiben' };
  if (v === n) return { aktion: 'unveraendert' };
  return { aktion: ueberschreiben ? 'schreiben' : 'behalten' };
}

// ── Nur Backend: Eingaben aus dem Eigenschaften-Freitext ────────────────────

/**
 * Grammatur aus einer Zeile "Grammatur: 280 g/m²" (auch "Stoffgewicht:").
 * Nur ueber das Label - eine Zahl mit "g" irgendwo im Text ist keine Angabe.
 */
export function grammaturAusEigenschaften(eigenschaften) {
  for (const zeile of String(eigenschaften ?? '').split('\n')) {
    const t = zeile.match(/^\s*(?:grammatur|stoffgewicht|flächengewicht|flaechengewicht)\s*:\s*(.+)$/i);
    if (t && /\d/.test(t[1])) return teil(t[1]);
  }
  return null;
}

/**
 * Faserangabe (NACH filterMaterialFarben, unveraendert) und Grammatur.
 * Der Platzhalter "[Material: bitte ergänzen]" ist keine Faserangabe.
 *
 * @returns {{ faserangabe: string|null, faserMeldung: string|null, grammatur: string|null }}
 */
export function metaEingaben({ eigenschaften, farben } = {}) {
  const { material, meldung } = materialAusEigenschaften(eigenschaften, farben);
  const faser = material && material !== MATERIAL_PLACEHOLDER ? material : null;
  return {
    faserangabe:  faser,
    faserMeldung: faser ? meldung : null,
    grammatur:    grammaturAusEigenschaften(eigenschaften),
  };
}
