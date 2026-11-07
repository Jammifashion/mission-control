// KS4: Bestellseite in MC - "in Termin … verschieben", "an Fanshop geliefert", "gedruckt" - reine Logik ohne Netz.
// Schreiben in lib/bestellStand.js (Bestellseiten- + Auftrags-Sperre, ein batchUpdate, zurueckgelesen). Nie Korb, nie Trikot-Reiter.
//
// Verschieben (bericht-KS4 0.3): nicht uebernommen -> nur Termin_ID. Uebernommen -> neue Position im Auftrag des Ziel-Termins (KS3-Regeln),
// Herkunft "✓ schon vorhanden" mit Verweis auf die Korb-Zeile (🛒 / KS3-1) bzw. auf die alte Position (📦 ausgebucht); die alte Position wird
// "Entfernt" + Verschoben_Nach (ganz) bzw. Menge kleiner + Verschoben_Nach (Teil). Trikots: nur der Eintrag (Trikot-Zeile bleibt).
// Gesperrt: storniert, geliefert, Ziel nicht spaeter als der bisherige Termin.

import { E_STATUS, E_ART, terminVergangen } from './bestell-eintraege.js';
import {
  POSITION_SPALTEN, PREIS_SPALTEN, HERKUNFT, ART, STORNIERT, fehler, naechstePositionId, naechsteAuftragNr, korbSchluesselVon, aktivePositionen,
  statusWechsel, schrittIndex,
} from './auftraege.js';
import { zielAuftrag, terminAuftraege, terminAuftragNeu, GRUND_MAX } from './bestell-uebernahme.js';
import { berlinDatum } from './berlin-tag.js';

const t = v => String(v ?? '').trim();
const ein = v => t(v).replace(/\s+/g, ' ');
const liste = (alt, neu) => [...t(alt).split(/[,;\s]+/).map(t).filter(Boolean), neu].filter((x, i, l) => l.indexOf(x) === i).join(', ');

/** Herkunft/Verweis der neuen Position: die Ware bleibt dieselbe. */
export function herkunftNachVerschieben(pos) {
  const h = t(pos.Herkunft) || (pos.Art === ART.LSHOP ? HERKUNFT.BESTELLEN : '');
  const k = korbSchluesselVon(pos);
  if (k) return { Herkunft: HERKUNFT.VORHANDEN, Verweis: k, Lager_Ort: '' };
  if (h === HERKUNFT.LAGER) return t(pos.Lager_Buchung) ? { Herkunft: HERKUNFT.VORHANDEN, Verweis: t(pos.Position_ID), Lager_Ort: '' }
    : { Herkunft: HERKUNFT.LAGER, Verweis: '', Lager_Ort: t(pos.Lager_Ort) };
  if (h === HERKUNFT.VORHANDEN) return { Herkunft: HERKUNFT.VORHANDEN, Verweis: t(pos.Verweis), Lager_Ort: '' };
  return { Herkunft: h, Verweis: '', Lager_Ort: '' };   // 🛒 noch nicht bereitgestellt bzw. frei
}

/**
 * Plan "in Termin … verschieben".
 * @param {object} o
 * @param {object} o.zugang
 * @param {object[]} o.termine     Termine des Zugangs (mit Datum)
 * @param {object} o.zielTermin    vorhandener oder neu geplanter Termin (neu: ohne _zeile)
 * @param {object[]} o.eintraege   alle Eintraege (frisch)
 * @param {{id, stand}[]} o.auswahl
 * @param {object[]} o.auftraege, o.positionen
 * @returns {{ schon?, eintragFelder, positionAenderungen, positionenNeu, auftragNeu, zielAuftragNr, terminAuftragNr, anzahl, hinweise }}
 */
export function verschiebenPlan({ zugang, termine, zielTermin, eintraege, auswahl, grund, auftraege, positionen, vorgang, jetzt }) {
  const l = Array.isArray(auswahl) ? auswahl : [];
  if (!l.length) throw fehler('Keine Einträge gewählt.');
  if (l.length > 500) throw fehler('Höchstens 500 Einträge auf einmal.');
  const g = ein(grund);
  if (g.length > GRUND_MAX) throw fehler(`Grund: höchstens ${GRUND_MAX} Zeichen.`);
  if (!zielTermin || zielTermin.Zugang_ID !== zugang.Zugang_ID) throw fehler('Ziel-Termin gibt es auf dieser Bestellseite nicht.', 404);
  if (terminVergangen(zielTermin, jetzt)) throw fehler('Der Ziel-Termin ist vorbei.');
  const tJe = new Map((termine ?? []).map(x => [x.Termin_ID, x]));
  const gewaehlt = l.map(w => {
    const e = (eintraege ?? []).find(x => x.Eintrag_ID === t(w?.id) && x.Zugang_ID === zugang.Zugang_ID);
    if (!e) throw fehler(`Eintrag ${t(w?.id)} gibt es auf dieser Bestellseite nicht.`, 404);
    return { e, stand: t(w?.stand) };
  });
  // Doppelklick: alle schon im Ziel-Termin -> nichts zu tun
  if (gewaehlt.every(({ e }) => e.Termin_ID === zielTermin.Termin_ID)) return { schon: true, anzahl: gewaehlt.length };
  const iso = new Date(jetzt).toISOString(), tag = berlinDatum(new Date(jetzt));
  const posJe = new Map((positionen ?? []).map(p => [p.Position_ID, p]));
  const eintragFelder = [], hinweise = [];
  const jePosition = new Map();   // alte Position_ID -> Eintraege
  for (const { e, stand } of gewaehlt) {
    if (stand !== t(e.Stand)) throw fehler(`Eintrag ${e.Eintrag_ID} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
    const st = t(e.Status) || E_STATUS.EINGEGANGEN;
    if (st === E_STATUS.STORNIERT) throw fehler(`Eintrag ${e.Eintrag_ID} ist storniert.`, 409, 'storniert');
    if (e.Termin_ID === zielTermin.Termin_ID) throw fehler(`Eintrag ${e.Eintrag_ID} steht schon in diesem Termin.`, 409, 'gleich');
    const von = tJe.get(e.Termin_ID);
    if (von && /^\d{4}-\d{2}-\d{2}$/.test(t(von.Datum)) && !(t(zielTermin.Datum) > t(von.Datum))) {
      throw fehler(`Eintrag ${e.Eintrag_ID}: Verschieben nur in einen späteren Termin.`, 422, 'frueher');
    }
    const basis = { Termin_ID: zielTermin.Termin_ID, Verschoben_Von: e.Termin_ID, Verschoben_Grund: g, Stand: iso };
    if (st !== E_STATUS.UEBERNOMMEN) { eintragFelder.push({ eintrag: e, felder: basis }); continue; }
    if (t(e.Art) === E_ART.TRIKOT) {
      if (t(e.Geliefert_Am)) throw fehler(`Eintrag ${e.Eintrag_ID} ist schon geliefert.`, 409, 'geliefert');
      eintragFelder.push({ eintrag: e, felder: basis });   // Trikot-Zeile bleibt (Referenz im Rohtext), Auftrag_Nr bleibt
      continue;
    }
    const pos = posJe.get(t(e.Position_ID));
    if (!pos || t(pos.Entfernt)) throw fehler(`Eintrag ${e.Eintrag_ID}: Position ${t(e.Position_ID)} gibt es nicht (mehr) – bitte neu laden.`, 409, 'konflikt');
    if (t(pos.Versendet)) throw fehler(`Eintrag ${e.Eintrag_ID} ist schon an den Fanshop geliefert.`, 409, 'geliefert');
    if (!jePosition.has(pos.Position_ID)) jePosition.set(pos.Position_ID, { pos, eintraege: [] });
    jePosition.get(pos.Position_ID).eintraege.push({ e, basis });
  }
  let auftragNeu = null, zielNr = '', terminAuftragNr = null, nachtrag = false;
  const positionenNeu = [], positionAenderungen = [];
  if (jePosition.size) {
    const z = zielAuftrag({ zugang, termin: zielTermin, auftraege });
    zielNr = z.auftrag ? z.auftrag.Auftrag_Nr : naechsteAuftragNr(auftraege, tag.slice(0, 4));
    nachtrag = z.nachtrag;
    if (z.neu) auftragNeu = terminAuftragNeu({ zugang, termin: zielTermin, nr: zielNr, nachtrag: z.nachtrag, vorgang: `KS4-${t(vorgang)}`, iso, tag });
    for (const { pos, eintraege: es } of jePosition.values()) {
      if (pos.Auftrag_Nr === zielNr) throw fehler(`${pos.Position_ID} liegt schon im Auftrag des Ziel-Termins.`, 409, 'gleich');
      const a = (auftraege ?? []).find(x => x.Auftrag_Nr === pos.Auftrag_Nr);
      if (a?.Status === STORNIERT) throw fehler(`${pos.Auftrag_Nr} ist storniert – erst den Storno zurücknehmen.`, 409, 'storniert');
      const alle = (eintraege ?? []).filter(x => t(x.Position_ID) === pos.Position_ID && t(x.Status) === E_STATUS.UEBERNOMMEN);
      const posMenge = Number(t(pos.Menge)) || 0;
      const summe = es.reduce((s, x) => s + (Number(t(x.e.Menge)) || 0), 0);
      const ganz = alle.every(x => es.some(y => y.e.Eintrag_ID === x.Eintrag_ID)) || summe >= posMenge;
      const menge = ganz ? posMenge : summe;
      const id = naechstePositionId([...(positionen ?? []), ...positionenNeu], zielNr);
      positionenNeu.push({
        ...Object.fromEntries(POSITION_SPALTEN.map(s => [s, ''])),
        Position_ID: id, Auftrag_Nr: zielNr, Art: pos.Art, LShop_ArticleNr: t(pos.LShop_ArticleNr), Freitext: t(pos.Freitext), Menge: String(menge),
        Motiv: t(pos.Motiv), Druck: t(pos.Druck), Notiz: t(pos.Notiz), Fertig: t(pos.Fertig), Fertig_Am: t(pos.Fertig_Am), Stand: iso,
        ...Object.fromEntries(PREIS_SPALTEN.map(s => [s, pos[s] ?? ''])),
        ...herkunftNachVerschieben(pos),
      });
      positionAenderungen.push({ zeile: pos._zeile, positionId: pos.Position_ID, felder: ganz
        ? { Entfernt: tag, Verschoben_Nach: liste(pos.Verschoben_Nach, id), Stand: iso }
        : { Menge: posMenge - menge, Verschoben_Nach: liste(pos.Verschoben_Nach, id), Stand: iso } });
      if (!ganz) hinweise.push(`${pos.Position_ID}: ${menge} von ${posMenge} Stück verschoben, ${posMenge - menge} bleiben.`);
      for (const { e, basis } of es) eintragFelder.push({ eintrag: e, felder: { ...basis, Auftrag_Nr: zielNr, Position_ID: id } });
    }
    const vorher = terminAuftraege(zielTermin);
    terminAuftragNr = vorher.includes(zielNr) ? null : [...vorher, zielNr].join(', ');
  }
  return { eintragFelder, positionAenderungen, positionenNeu, auftragNeu, zielAuftragNr: zielNr, nachtrag, terminAuftragNr, anzahl: gewaehlt.length, hinweise };
}

/**
 * Plan "an Fanshop geliefert" bzw. Ruecknahme (zurueck = true) je Termin ODER je Auftrag.
 * Je Termin: alle aktiven Positionen der Auftraege des Termins + Trikot-Eintraege des Termins. Je Auftrag: dessen aktive Positionen + die
 * Trikot-Eintraege mit dieser Auftrag_Nr, die noch im Termin des Auftrags stehen (verschobene Trikots nicht).
 * Auftrag: von "fertig" auf "übergeben" (bzw. zurueck); davor bleibt der Status (Hinweis). Storniert: ausgelassen.
 * @returns {{ positionen: {zeile, positionId, felder}[], eintraege: {eintrag, felder}[], auftraege: {auftrag, felder}[], hinweise, unveraendert }}
 */
export function geliefertPlan({ termin = null, auftragNr = '', zurueck = false, eintraege, auftraege, positionen, jetzt }) {
  const tag = berlinDatum(new Date(jetzt)), iso = new Date(jetzt).toISOString();
  const auJe = new Map((auftraege ?? []).map(a => [a.Auftrag_Nr, a]));
  let nummern, trikots;
  if (termin) {
    const es = (eintraege ?? []).filter(e => e.Termin_ID === termin.Termin_ID && t(e.Status) === E_STATUS.UEBERNOMMEN);
    nummern = new Set([...terminAuftraege(termin), ...es.filter(e => t(e.Art) !== E_ART.TRIKOT).map(e => t(e.Auftrag_Nr))].filter(Boolean));
    trikots = es.filter(e => t(e.Art) === E_ART.TRIKOT);
  } else {
    const a = auJe.get(t(auftragNr));
    if (!a) throw fehler('Auftrag gibt es nicht.', 404);
    nummern = new Set([a.Auftrag_Nr]);
    trikots = (eintraege ?? []).filter(e => t(e.Status) === E_STATUS.UEBERNOMMEN && t(e.Art) === E_ART.TRIKOT && t(e.Auftrag_Nr) === a.Auftrag_Nr
      && (!t(a.Termin_ID) || e.Termin_ID === t(a.Termin_ID)));
  }
  const hinweise = [], posAus = [], eAus = [], auAus = [];
  for (const nr of nummern) {
    const a = auJe.get(nr);
    if (!a) continue;
    if (a.Status === STORNIERT) { hinweise.push(`${nr} ist storniert – ausgelassen.`); continue; }
    for (const p of aktivePositionen(positionen, nr)) {
      if (!zurueck && !t(p.Versendet)) posAus.push({ zeile: p._zeile, positionId: p.Position_ID, felder: { Versendet: tag, Stand: iso } });
      if (zurueck && t(p.Versendet)) posAus.push({ zeile: p._zeile, positionId: p.Position_ID, felder: { Versendet: '', Stand: iso } });
    }
    if (!zurueck && a.Status === 'fertig') auAus.push({ auftrag: a, felder: { ...statusWechsel(a, 'weiter', jetzt), Stand: iso } });
    else if (!zurueck && schrittIndex(a.Status) < schrittIndex('fertig')) hinweise.push(`${nr} steht auf „${a.Status}“ – Status bleibt, bitte von Hand weiter.`);
    if (zurueck && a.Status === 'übergeben') auAus.push({ auftrag: a, felder: { ...statusWechsel(a, 'zurueck', jetzt), Stand: iso } });
    else if (zurueck && a.Status === 'bezahlt') hinweise.push(`${nr} ist schon bezahlt – Status bleibt.`);
  }
  for (const e of trikots) {
    if (!zurueck && !t(e.Geliefert_Am)) eAus.push({ eintrag: e, felder: { Geliefert_Am: tag, Stand: iso } });
    if (zurueck && t(e.Geliefert_Am)) eAus.push({ eintrag: e, felder: { Geliefert_Am: '', Stand: iso } });
  }
  return { positionen: posAus, eintraege: eAus, auftraege: auAus, hinweise, unveraendert: !posAus.length && !eAus.length && !auAus.length };
}

/**
 * Plan "gedruckt" (= Haken fertig, KS4 0.2) fuer mehrere Positionen, auch ueber Auftraege hinweg. Schon im Zielzustand = uebersprungen.
 * @returns {{ aenderungen: {zeile, positionId, auftragNr, felder}[], unveraendert: number }}
 */
export function gedrucktPlan({ positionIds, gedruckt, auftraege, positionen, jetzt }) {
  const ids = [...new Set((Array.isArray(positionIds) ? positionIds : []).map(t).filter(Boolean))];
  if (!ids.length) throw fehler('Keine Positionen gewählt.');
  if (ids.length > 500) throw fehler('Höchstens 500 Positionen auf einmal.');
  const tag = berlinDatum(new Date(jetzt)), iso = new Date(jetzt).toISOString();
  const auJe = new Map((auftraege ?? []).map(a => [a.Auftrag_Nr, a]));
  const soll = gedruckt ? 'ja' : '';
  const aenderungen = [];
  let unveraendert = 0;
  for (const id of ids) {
    const p = (positionen ?? []).find(x => x.Position_ID === id);
    if (!p || t(p.Entfernt)) throw fehler(`Position ${id} gibt es nicht (mehr) – bitte neu laden.`, 409, 'konflikt');
    if (auJe.get(p.Auftrag_Nr)?.Status === STORNIERT) throw fehler(`${p.Auftrag_Nr} ist storniert.`, 409, 'storniert');
    if (t(p.Fertig) === soll) { unveraendert++; continue; }
    aenderungen.push({ zeile: p._zeile, positionId: id, auftragNr: p.Auftrag_Nr, felder: { Fertig: soll, Fertig_Am: gedruckt ? tag : '', Stand: iso } });
  }
  return { aenderungen, unveraendert };
}
