// AM-3: Rohlinge eines Auftrags bereitstellen bzw. die Uebergabe zuruecknehmen - reine Logik ohne Netz.
// Schreiben in lib/auftragBereitstellen.js (Korb, Lager_Buchungen, Auftrag_Positionen, Auftraege: EIN values.batchUpdate).
//
// Je noch nicht uebergebener Position:
//   🛒 bestellen  -> neue eigene Zeile im L-Shop-Warenkorb, Referenz = Auftragsnummer (nie Kunde, Spitzname, Kurztitel)
//   📦 aus Lager  -> Abgang abgang_auftrag am Lager_Ort, Bezug = Auftragsnummer, nie negativ (sonst "teilen": Rest bestellen)
//   ✓ vorhanden   -> nichts;  frei (leer) -> "noch zu besorgen (nicht über L-Shop)", nichts
// Namen stehen nirgends: Korb-Referenz und Lager-Bezug sind die AU-Nr., die Lager-Notiz die Position_ID.

import { STATUS as KORB_STATUS, HERKUNFT as KORB_HERKUNFT, naechsteEigenNummer } from './korb-logic.js';
import { ART as LAGER_ART, WARENART, bestandAus, bestandVon, naechsteBuchungNr, buchungId, VORGANG_MUSTER, buchungenDesVorgangs } from './lager.js';
import { ART, HERKUNFT, aktivePositionen, istUebergeben, naechstePositionId, schrittIndex, fehler, POSITION_SPALTEN, STORNIERT } from './auftraege.js';

const t = v => String(v ?? '').trim();
export const QUELLE_AUFTRAG = 'auftrag';
export const GRUND_GEAENDERT = 'Auftrag geändert';
// Bereitstellen und Zuruecknehmen gehen bis einschliesslich "bestellt" (Rohlinge oft parallel zum Design).
export const BEREITSTELLEN_BIS = 'bestellt';

/** Darf der Auftrag (noch) Rohlinge bereitstellen? Haengt spaeter auch an der Auftragsart (AM-3a, "Aufgabe" ohne Rohlinge). */
export function kannBereitstellen(auftrag) {
  return auftrag.Status !== STORNIERT && schrittIndex(auftrag.Status) >= 0 && schrittIndex(auftrag.Status) <= schrittIndex(BEREITSTELLEN_BIS);
}

/**
 * Plan fuer "Rohlinge bereitstellen".
 * @param {object} o
 * @param {object}   o.auftrag
 * @param {object[]} o.positionen    alle Positionen (Reiter), aktive werden gefiltert
 * @param {object[]} o.korbZeilen    Warenkorb (korbZeilen)
 * @param {object[]} o.buchungen     Lager (buchungenAus) - frisch gelesen, der Bestand zaehlt jetzt, nicht beim Erfassen
 * @param {string[]} o.orte          aktive Lagerorte
 * @param {Set}      o.waehlbar      L-Shop-Nummern, die bestellt werden duerfen
 * @param {Map}      o.info          ArticleNr -> { modell, farbe, groesse } (nur Anzeige)
 * @param {boolean}  o.teilen        reicht der Lagerbestand nicht: was da ist aus dem Lager, Rest bestellen
 * @param {object}   o.ortWahl       Position_ID -> Ort (wenn der gespeicherte Ort nicht mehr aktiv ist)
 * @param {string}   o.vorgang       Kennung gegen Doppelklick (steht in den Lager-Zeilen)
 */
export function bereitstellenPlan({ auftrag, positionen, korbZeilen, buchungen, orte, waehlbar, info = new Map(), teilen = false, ortWahl = {}, vorgang = '', jetzt }) {
  if (!kannBereitstellen(auftrag)) throw fehler(`${auftrag.Auftrag_Nr}: Rohlinge bereitstellen geht nur bis „${BEREITSTELLEN_BIS}“.`, 409, 'status');
  const nr = auftrag.Auftrag_Nr;
  const iso = new Date(jetzt).toISOString();
  const jahr = new Date(jetzt).getUTCFullYear();
  const akt = aktivePositionen(positionen, nr);
  const offen = akt.filter(p => !istUebergeben(p));
  const bestand = bestandAus(buchungen);
  const verbraucht = new Map();
  const frei = (schluessel, ort) => bestandVon(bestand, schluessel, ort) - (verbraucht.get(`${schluessel}|${ort}`) ?? 0);
  const nimm = (schluessel, ort, n) => verbraucht.set(`${schluessel}|${ort}`, (verbraucht.get(`${schluessel}|${ort}`) ?? 0) + n);
  const eigen = naechsteEigenNummer(korbZeilen ?? [], jahr);
  const eigenPraefix = eigen.slice(0, -4);
  let eigenN = Number(eigen.slice(-4));
  let buchN = naechsteBuchungNr(buchungen, jahr);
  const neuerKorbKey = () => `${eigenPraefix}${String(eigenN++).padStart(4, '0')}`;
  const anzeige = p => ({ positionId: p.Position_ID, art: p.Art, articleNr: p.LShop_ArticleNr, freitext: p.Freitext, menge: Number(p.Menge) || 0, ...(info.get(p.LShop_ArticleNr) ?? {}) });

  const vorschau = [], korbNeu = [], lagerNeu = [], posFelder = [], posNeu = [], probleme = [], knapp = [];
  const korbZeile = (articleNr, menge) => {
    const key = neuerKorbKey();
    korbNeu.push({
      Schluessel: key, Shop: 'JFN', Herkunft: KORB_HERKUNFT.EIGEN, Bestellnummer: '', Position: '', Referenz: nr, 'SSOT-ID': '',
      LShop_ArticleNr: articleNr, Menge: String(menge), Status: KORB_STATUS.OFFEN, Grund: '', Hinweis: '', Status_Datum: iso, Bestell_ID: '',
      Notiz: '', Angelegt: iso, Quelle_Lauf: 'Auftrag', Stand: iso, Lager_Ziel: '',
    });
    return key;
  };
  const lagerZeile = (articleNr, menge, ort, positionId) => {
    const id = buchungId(jahr, buchN++);
    lagerNeu.push({
      Buchung_ID: id, Datum: iso, Art: LAGER_ART.ABGANG_AUFTRAG, Warenart: WARENART.ROHLING, Schluessel: `LS:${articleNr}`, Menge: -menge,
      Ort: ort, Grund: 'Auftrag', Bezug: nr, Quelle: QUELLE_AUFTRAG, Notiz: positionId, Storno_von: '', Stand: iso, Vorgang: t(vorgang),
    });
    nimm(`LS:${articleNr}`, ort, menge);
    return id;
  };

  let neuIdx = 0;
  for (const p of offen) {
    const menge = Number(p.Menge) || 0;
    const herkunft = p.Art === ART.LSHOP ? (t(p.Herkunft) || HERKUNFT.BESTELLEN) : t(p.Herkunft);
    if (p.Art === ART.FREI) { vorschau.push({ ...anzeige(p), aktion: herkunft === HERKUNFT.VORHANDEN ? 'vorhanden' : 'frei' }); continue; }
    if (herkunft === HERKUNFT.VORHANDEN) { vorschau.push({ ...anzeige(p), aktion: 'vorhanden' }); continue; }
    const a = t(p.LShop_ArticleNr);
    if (herkunft === HERKUNFT.BESTELLEN) {
      if (!waehlbar?.has(a)) { probleme.push({ code: 'nicht_waehlbar', positionId: p.Position_ID, text: `Position ${p.Position_ID}: L-Shop-Nummer nicht (mehr) bestellbar.` }); vorschau.push({ ...anzeige(p), aktion: 'korb', problem: 'nicht bestellbar' }); continue; }
      const key = korbZeile(a, menge);
      posFelder.push({ zeile: p._zeile, positionId: p.Position_ID, felder: { Korb_Schluessel: key, Stand: iso } });
      vorschau.push({ ...anzeige(p), aktion: 'korb', korbSchluessel: key });
      continue;
    }
    // aus Lager
    const ort = t(ortWahl?.[p.Position_ID]) || t(p.Lager_Ort);
    if (!(orte ?? []).includes(ort)) {
      probleme.push({ code: 'ort', positionId: p.Position_ID, text: `Position ${p.Position_ID}: Lagerort ${ort ? `„${ort}“ ist nicht mehr aktiv` : 'fehlt'} – bitte Ort wählen.` });
      vorschau.push({ ...anzeige(p), aktion: 'lager', ort, problem: 'ort' });
      continue;
    }
    const da = Math.max(0, frei(`LS:${a}`, ort));
    const ortFeld = ort !== t(p.Lager_Ort) ? { Lager_Ort: ort } : {};
    if (da >= menge) {
      const id = lagerZeile(a, menge, ort, p.Position_ID);
      posFelder.push({ zeile: p._zeile, positionId: p.Position_ID, felder: { Lager_Buchung: id, ...ortFeld, Stand: iso } });
      vorschau.push({ ...anzeige(p), aktion: 'lager', ort, da });
      continue;
    }
    knapp.push({ positionId: p.Position_ID, menge, da, ort });
    if (!teilen) {
      probleme.push({ code: 'knapp', positionId: p.Position_ID, text: `Position ${p.Position_ID}: nur ${da} im Lager (${ort}), ${menge} gebraucht.` });
      vorschau.push({ ...anzeige(p), aktion: 'lager', ort, da, problem: 'knapp' });
      continue;
    }
    if (!waehlbar?.has(a)) { probleme.push({ code: 'nicht_waehlbar', positionId: p.Position_ID, text: `Position ${p.Position_ID}: Rest kann nicht bestellt werden (L-Shop-Nummer nicht bestellbar).` }); continue; }
    if (da === 0) {
      const key = korbZeile(a, menge);
      posFelder.push({ zeile: p._zeile, positionId: p.Position_ID, felder: { Herkunft: HERKUNFT.BESTELLEN, Lager_Ort: '', Korb_Schluessel: key, Stand: iso } });
      vorschau.push({ ...anzeige(p), aktion: 'korb', korbSchluessel: key, geteilt: true });
      continue;
    }
    const id = lagerZeile(a, da, ort, p.Position_ID);
    posFelder.push({ zeile: p._zeile, positionId: p.Position_ID, felder: { Menge: String(da), Lager_Buchung: id, ...ortFeld, Stand: iso } });
    const key = korbZeile(a, menge - da);
    const restId = naechstePositionId(positionen, nr, neuIdx++);
    posNeu.push({
      ...Object.fromEntries(POSITION_SPALTEN.map(s => [s, ''])), ...p, _zeile: undefined,
      Position_ID: restId, Menge: String(menge - da), Herkunft: HERKUNFT.BESTELLEN, Lager_Ort: '', Lager_Buchung: '', Korb_Schluessel: key,
      Fertig: '', Fertig_Am: '', Stand: iso,
    });
    vorschau.push({ ...anzeige(p), menge: da, aktion: 'lager', ort, da, geteilt: true });
    vorschau.push({ ...anzeige(p), positionId: restId, menge: menge - da, aktion: 'korb', korbSchluessel: key, geteilt: true });
  }
  return { vorschau, korbNeu, lagerNeu, posFelder, posNeu, probleme, knapp, zuTun: korbNeu.length + lagerNeu.length > 0 };
}

/** Doppelklick: hat dieser Vorgang schon Lager-Zeilen? (Korb-Zeilen erkennt der Uebergabe-Vermerk an der Position.) */
export const schonBereitgestellt = (buchungen, vorgang) => VORGANG_MUSTER.test(t(vorgang)) && buchungenDesVorgangs(buchungen, vorgang).length > 0;

/**
 * "Übergabe zurücknehmen" je Position (bis einschliesslich "bestellt" des Auftrags):
 *  Korb: nur offen (oder schon herausgenommen) -> abgewaehlt mit Grund "Auftrag geändert", Korb_Schluessel an der Position leer.
 *        bestellt/geliefert/aus dem Lager -> 409 gesperrt.
 *  Lager: Gegenbuchung (korrektur, Storno_von) der Abgang-Buchung, Lager_Buchung leer.
 */
export function zuruecknehmenPlan({ auftrag, positionen, positionId, korbZeilen, buchungen, vorgang = '', jetzt }) {
  if (!kannBereitstellen(auftrag)) throw fehler(`${auftrag.Auftrag_Nr}: zurücknehmen geht nur bis „${BEREITSTELLEN_BIS}“.`, 409, 'status');
  const p = aktivePositionen(positionen, auftrag.Auftrag_Nr).find(x => x.Position_ID === t(positionId));
  if (!p) throw fehler('Position gibt es nicht (mehr) – bitte neu laden.', 409, 'konflikt');
  if (!istUebergeben(p)) return { unveraendert: true, position: p };
  const iso = new Date(jetzt).toISOString();
  const jahr = new Date(jetzt).getUTCFullYear();
  const plan = { position: p, korb: null, lagerNeu: [], posFelder: { Stand: iso } };
  if (t(p.Korb_Schluessel)) {
    const z = (korbZeilen ?? []).find(x => x.Schluessel === t(p.Korb_Schluessel));
    if (z && ![KORB_STATUS.OFFEN, KORB_STATUS.ABGEWAEHLT].includes(z.Status)) {
      throw fehler(`Position ${p.Position_ID}: im Korb schon „${z.Status}“ – nicht mehr zurücknehmbar.`, 409, 'gesperrt');
    }
    if (z && z.Status === KORB_STATUS.OFFEN) plan.korb = { zeile: z._zeile, schluessel: z.Schluessel, werte: { Status: KORB_STATUS.ABGEWAEHLT, Grund: GRUND_GEAENDERT, Status_Datum: iso, Stand: iso } };
    plan.posFelder.Korb_Schluessel = '';
  }
  if (t(p.Lager_Buchung)) {
    const b = (buchungen ?? []).find(x => x.id === t(p.Lager_Buchung));
    const schonGegen = b && (buchungen ?? []).some(x => x.stornoVon === b.id);
    if (b && !schonGegen) {
      plan.lagerNeu.push({
        Buchung_ID: buchungId(jahr, naechsteBuchungNr(buchungen, jahr)), Datum: iso, Art: LAGER_ART.KORREKTUR, Warenart: b.warenart || WARENART.ROHLING,
        Schluessel: b.schluessel, Menge: Math.abs(b.menge), Ort: b.ort, Grund: GRUND_GEAENDERT, Bezug: auftrag.Auftrag_Nr, Quelle: QUELLE_AUFTRAG,
        Notiz: p.Position_ID, Storno_von: b.id, Stand: iso, Vorgang: t(vorgang),
      });
    }
    plan.posFelder.Lager_Buchung = '';
  }
  return plan;
}
