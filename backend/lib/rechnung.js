// RE1: "Abrechnen" - Sammelrechnung aus Auftraegen als Lexware-Entwurf. Logik utils/rechnung.js, Lexware-Aufruf lib/lexwareRechnung.js.
// Ablauf Anlegen (unter der Auftrags-Sperre, alles frisch gelesen):
//   pruefen (Stand wie gesehen, kein Kennzeichen, Plan ohne Probleme) -> Kennzeichen "unklar" + Tag ZUERST schreiben (stirbt der Lauf
//   mitten im Senden, bleibt "unklar" stehen statt eines stillen Doppels) -> genau EIN POST -> angelegt: ID + "entwurf", To-do
//   "Rechnung" erledigt | nicht: Kennzeichen wieder leer | unklar: bleibt "unklar" + Chat. Jeder Schreibschritt zurueckgelesen.
// Log/Chat: nur AU-Nummern und Anzahl - nie Namen, Betraege, Antwortinhalt.

import {
  mitAuftragSperre, liesAuftraege, lshopInfo, nummernAus, schreibeAuftragsZellen, auftragZellenAus, liesAuftragZusatz,
} from './auftraege.js';
import { leseKunden } from './kunden.js';
import { sheetsClient, sheetId, liesEintraege, liesZugaengeTermine } from './bestellseite.js';
import { notify } from './chatNotify.js';
import { legeRechnungsentwurfAn, rechnungenBereit, rechnungSchluessel, sucheEntwuerfe } from './lexwareRechnung.js';
import { TAB_AUFTRAEGE } from '../utils/auftraege.js';
import { TAB_TODOS } from '../utils/aufgaben.js';
import { auftragSummen, positionAusZeile } from '../utils/auftrag-preise.js';
import { berlinDatum } from '../utils/berlin-tag.js';
import {
  RECHNUNG_SPALTEN, RE_STATUS, LINK_BASIS, abrechnenListe, rechnungsPlan, bruttoAbgleich, kennzeichenFelder, leerFelder, kennzeichenPlan,
  hatKennzeichen, istStorniert, chatText,
} from '../utils/rechnung.js';

const t = v => String(v ?? '').trim();
const fehler = (text, status = 422, code) => Object.assign(new Error(text), { status, code });

function pruefeSpalten(a) {
  const fehlt = RECHNUNG_SPALTEN.filter(s => a.idx[s] === undefined);
  if (fehlt.length) throw fehler(`Spalten ${fehlt.join(', ')} fehlen in Auftraege – erst scripts/setup-auftraege-reiter.js --write.`, 409, 'einrichtung');
}

async function kontaktVon(kundenNr, sheets) {
  const { kunden } = await leseKunden({ sheets });
  const k = kunden.find(x => x.Kunden_Nr === kundenNr);
  if (!k) throw fehler(`Kunde ${kundenNr || '(leer)'} gibt es nicht.`, 404, 'kunde');
  return t(k.Lexoffice_ID);
}

/** "für wen" je Position aus der Bestellseite (nur uebernommene Eintraege). Fehlt der Reiter: leer. */
async function fuerJePosition(sheets, spreadsheetId) {
  const je = new Map();
  let e = null;
  try { e = await liesEintraege(sheets, spreadsheetId); } catch { return je; }
  for (const x of e?.zeilen ?? []) {
    const pid = t(x.Position_ID), f = t(x.Fuer);
    if (!pid || !f || t(x.Status) !== 'übernommen') continue;
    const l = je.get(pid) ?? [];
    if (!l.includes(f)) l.push(f);
    je.set(pid, l);
  }
  return je;
}

/** Kunden mit Auftraegen ohne Kennzeichen (fuer die Auswahl); Kunden mit Bestellseite zuerst (Fanshop vorausgewaehlt). */
export async function abrechnenKunden({ sheets: s, bereit = rechnungenBereit } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { a } = await liesAuftraege(sheets, spreadsheetId);
  let mitSeite = new Set();
  try { mitSeite = new Set((await liesZugaengeTermine(sheets, spreadsheetId)).z.zeilen.map(z => t(z.Kunden_Nr)).filter(Boolean)); } catch { /* ohne */ }
  const je = new Map();
  for (const x of a.zeilen) {
    if (istStorniert(x) || hatKennzeichen(x) || /^AG-/.test(t(x.Auftrag_Nr))) continue;
    je.set(t(x.Kunden_Nr), (je.get(t(x.Kunden_Nr)) ?? 0) + 1);
  }
  const kunden = [...je].map(([kundenNr, offen]) => ({ kundenNr, offen, bestellseite: mitSeite.has(kundenNr) }))
    .sort((x, y) => Number(y.bestellseite) - Number(x.bestellseite) || y.offen - x.offen);
  return { kunden, bereit: await bereit(), spalten: RECHNUNG_SPALTEN.every(c => a.idx[c] !== undefined) };
}

async function planFuer({ sheets, spreadsheetId, a, p, kundenNr, nrn, jetzt }) {
  const gewaehlt = nrn.map(nr => a.zeilen.find(x => x.Auftrag_Nr === nr)).filter(Boolean);
  if (gewaehlt.length !== nrn.length) throw fehler('Ein gewählter Auftrag fehlt.', 404);
  if (gewaehlt.some(x => t(x.Kunden_Nr) !== kundenNr)) throw fehler('Alle Aufträge müssen zum gewählten Kunden gehören.', 422, 'kunde');
  const akt = p.zeilen.filter(x => nrn.includes(t(x.Auftrag_Nr)) && !t(x.Entfernt));
  const { info } = await lshopInfo(sheets, spreadsheetId, nummernAus(akt));
  const fuerJe = await fuerJePosition(sheets, spreadsheetId);
  const kontaktId = await kontaktVon(kundenNr, sheets);
  const plan = rechnungsPlan({ auftraege: gewaehlt, positionen: p.zeilen, info, fuerJe, kontaktId, jetzt });
  // Abgleich mit der MC-Rechnung je Auftrag (auftragSummen) - nur Hinweis.
  const auBrutto = gewaehlt.reduce((s, x) => s + auftragSummen(akt.filter(y => y.Auftrag_Nr === x.Auftrag_Nr)
    .map(y => positionAusZeile(y, { groesse: info.get(t(y.LShop_ArticleNr))?.groesse ?? '' }))).brutto, 0);
  const hinweis = plan.probleme.length ? '' : bruttoAbgleich(plan.summen, auBrutto);
  return { gewaehlt, plan, kontaktId, hinweis };
}

/** Vorschau: Liste offen/abgerechnet und (fuer die Auswahl) Positionen + Summen. Schreibt nichts. */
export async function abrechnenVorschau({ kundenNr, von = '', bis = '', auswahl = null, sheets: s, jetzt = () => new Date(), bereit = rechnungenBereit } = {}) {
  const sheets = s ?? await sheetsClient();
  const spreadsheetId = sheetId();
  const { a, p } = await liesAuftraege(sheets, spreadsheetId);
  const liste = abrechnenListe({ auftraege: a.zeilen, positionen: p.zeilen, kundenNr, von, bis });
  const nrn = Array.isArray(auswahl) ? auswahl.map(t) : liste.offen.filter(x => !x.grund).map(x => x.auftragNr);
  let vorschau = null;
  if (nrn.length) {
    const r = await planFuer({ sheets, spreadsheetId, a, p, kundenNr, nrn, jetzt: jetzt() });
    vorschau = { auftraege: nrn, positionen: r.plan.positionen, summen: r.plan.summen, taxType: r.plan.taxType, probleme: r.plan.probleme, hinweis: r.hinweis };
  }
  return { ...liste, vorschau, bereit: await bereit(), spalten: RECHNUNG_SPALTEN.every(c => a.idx[c] !== undefined), linkBasis: LINK_BASIS };
}

/** To-dos "Rechnung…" der Auftraege (offen, nicht archiviert) -> Zellen zum Abhaken. */
async function rechnungTodos(sheets, spreadsheetId, nrn, heute, iso) {
  const { d } = await liesAuftragZusatz(sheets, spreadsheetId);
  if (!d || d.kaputt) return [];
  return d.zeilen.filter(x => nrn.includes(t(x.Bezug)) && /rechnung/i.test(t(x.Text)) && t(x.Erledigt) !== 'ja' && !t(x.Archiviert))
    .flatMap(x => auftragZellenAus(TAB_TODOS, d.idx, x._zeile, { Erledigt: 'ja', Erledigt_Am: heute, Stand: iso }));
}

/**
 * Rechnungsentwurf anlegen. eingabe { kundenNr, auftraege: [{ nr, stand }] }.
 * @returns {{ ok, ergebnis: 'angelegt'|'unklar', id?, link?, auftraege, todos }}
 */
export async function rechnungAnlegen({ eingabe, sheets: s, jetzt = () => new Date(), senden = legeRechnungsentwurfAn, melden = notify, schluesselLesen = rechnungSchluessel } = {}) {
  const kundenNr = t(eingabe?.kundenNr);
  const liste = Array.isArray(eingabe?.auftraege) ? eingabe.auftraege : [];
  if (!liste.length) throw fehler('Kein Auftrag gewählt.');
  const nrn = [...new Set(liste.map(x => t(x?.nr)))];
  const schluessel = await schluesselLesen();   // fehlt -> 503, vor jedem Schreiben
  return mitAuftragSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { a, p } = await liesAuftraege(sheets, spreadsheetId);
    pruefeSpalten(a);
    for (const w of liste) {
      const x = a.zeilen.find(z => z.Auftrag_Nr === t(w?.nr));
      if (!x) throw fehler(`${t(w?.nr)} gibt es nicht.`, 404);
      if (t(w?.stand) !== t(x.Stand)) throw fehler(`${x.Auftrag_Nr} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
      if (hatKennzeichen(x)) throw fehler(`${x.Auftrag_Nr} ist schon abgerechnet.`, 409, 'schon');
    }
    const { gewaehlt, plan } = await planFuer({ sheets, spreadsheetId, a, p, kundenNr, nrn, jetzt: jetzt() });
    if (plan.probleme.length) { const e = fehler('Rechnung so nicht möglich.', 422, 'probleme'); e.probleme = plan.probleme; throw e; }
    const iso = jetzt().toISOString(), heute = berlinDatum(jetzt());
    const zellen = felder => gewaehlt.flatMap(x => auftragZellenAus(TAB_AUFTRAEGE, a.idx, x._zeile, felder));
    // 1) Kennzeichen "unklar" vor dem Senden
    await schreibeAuftragsZellen(sheets, spreadsheetId, { zellen: zellen(kennzeichenFelder({ status: RE_STATUS.UNKLAR, am: heute, stand: iso })) });
    // 2) genau ein Versuch
    let r;
    try { r = await senden({ payload: plan.payload, schluessel }); } catch (err) { r = { ergebnis: 'unklar', grund: err?.name ?? 'Fehler' }; }
    if (r.ergebnis === 'angelegt') {
      const iso2 = new Date(Math.max(Date.now(), jetzt().getTime() + 1)).toISOString();
      const todos = await rechnungTodos(sheets, spreadsheetId, nrn, heute, iso2);
      await schreibeAuftragsZellen(sheets, spreadsheetId, { zellen: [...zellen(kennzeichenFelder({ id: r.id, status: RE_STATUS.ENTWURF, am: heute, stand: iso2 })), ...todos] });
      console.log(`RE1: Rechnungsentwurf angelegt für ${nrn.length} Auftrag/Aufträge (${nrn.join(', ')}).`);
      return { ok: true, ergebnis: 'angelegt', id: r.id, link: `${LINK_BASIS}${r.id}`, auftraege: nrn, todos: todos.length / 3 };
    }
    if (r.ergebnis === 'nicht') {
      await schreibeAuftragsZellen(sheets, spreadsheetId, { zellen: zellen(leerFelder(new Date(Math.max(Date.now(), jetzt().getTime() + 1)).toISOString())) });
      console.warn(`RE1: Rechnungsentwurf NICHT angelegt (${r.status ?? '-'}) für ${nrn.join(', ')}.`);
      try { await melden(chatText({ ergebnis: 'nicht', auftragNrn: nrn, grund: `Status ${r.status ?? '-'}` })); } catch { /* Chat optional */ }
      throw fehler(r.grund, r.status === 401 || r.status === 403 ? 503 : 422, r.status === 401 || r.status === 403 ? 'lexware_rechnungen' : 'lexware');
    }
    console.warn(`RE1: Ergebnis UNKLAR für ${nrn.join(', ')} – Kennzeichen „unklar“.`);
    try { await melden(chatText({ ergebnis: 'unklar', auftragNrn: nrn })); } catch { /* Chat optional */ }
    return { ok: false, ergebnis: 'unklar', grund: r.grund, auftraege: nrn };
  });
}

/** Kennzeichen von Hand: aktion angelegt (unklar -> entwurf, mit ID) | zuruecksetzen (entwurf/unklar -> leer). Fuer alle AU mit gleichem Kennzeichen. */
export async function rechnungKennzeichen({ eingabe, sheets: s, jetzt = () => new Date() } = {}) {
  const nr = t(eingabe?.nr), aktion = t(eingabe?.aktion);
  return mitAuftragSperre(async () => {
    const sheets = s ?? await sheetsClient();
    const spreadsheetId = sheetId();
    const { a } = await liesAuftraege(sheets, spreadsheetId);
    pruefeSpalten(a);
    const x = a.zeilen.find(z => z.Auftrag_Nr === nr);
    if (!x) throw fehler(`${nr} gibt es nicht.`, 404);
    if (t(eingabe?.stand) !== t(x.Stand)) throw fehler(`${nr} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    const plan = kennzeichenPlan({ auftrag: x, aktion, lexwareId: eingabe?.lexwareId });
    // Gleiche Sammelrechnung = gleicher Tag + gleiche ID/gleicher Status beim selben Kunden
    const gruppe = a.zeilen.filter(z => z.Kunden_Nr === x.Kunden_Nr && t(z.Rechnung_Status) === t(x.Rechnung_Status)
      && t(z.Rechnung_Am) === t(x.Rechnung_Am) && t(z.Rechnung_Lexware_ID) === t(x.Rechnung_Lexware_ID));
    const iso = jetzt().toISOString();
    const felder = plan.zuruecksetzen ? leerFelder(iso) : kennzeichenFelder({ id: plan.id, status: RE_STATUS.ENTWURF, am: t(x.Rechnung_Am), stand: iso });
    await schreibeAuftragsZellen(sheets, spreadsheetId, { zellen: gruppe.flatMap(z => auftragZellenAus(TAB_AUFTRAEGE, a.idx, z._zeile, felder)) });
    return { ok: true, auftraege: gruppe.map(z => z.Auftrag_Nr), aktion };
  });
}

/** "In Lexware nachsehen" (nur lesen): Rechnungsentwuerfe des Kunden seit dem Tag des Kennzeichens. */
export async function rechnungNachsehen({ nr, sheets: s, suche = sucheEntwuerfe } = {}) {
  const sheets = s ?? await sheetsClient();
  const { a } = await liesAuftraege(sheets, sheetId());
  const x = a.zeilen.find(z => z.Auftrag_Nr === t(nr));
  if (!x) throw fehler(`${t(nr)} gibt es nicht.`, 404);
  const kontaktId = await kontaktVon(t(x.Kunden_Nr), sheets);
  const r = await suche({ kontaktId, seit: t(x.Rechnung_Am) });
  return r.ok ? { ok: true, entwuerfe: r.entwuerfe.map(e => ({ ...e, link: `${LINK_BASIS}${e.id}` })) } : r;
}
