// KI-Schnellannahme (SA1): POST /api/auftraege/schnell { text } -> Vorschlag fuer den Dialog "Neuer Auftrag".
// Logik in utils/auftrag-schnell.js. SCHREIBT NICHTS (kein Sheet, kein Eingang, kein Auftrag).
//
// Datenschutz (Inhaber 17.11.):
//  - Der Rohtext geht NUR an die Claude-API (Rolle `auftrag-schnell` muss claude-… sein, sonst 503) und wird hier
//    weder gespeichert noch geloggt. Fehler werden zu festen Meldungen ohne Text/Antwortinhalt umgeschrieben.
//  - Die Kundenliste geht nie an die KI: MC sucht selbst (leseKunden + sucheKunden) und gibt nur Kunden_Nr zurueck.
//  - Die KI-Antwort lebt nur im Speicher dieses Aufrufs; der Browser haelt sie nur, solange der Dialog offen ist.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { getModel } from './modelConfig.js';
import { textAufruf, anbieterVon, schluesselFehlt, KiAbgeschnittenError, KiAbgelehntError, KiZeitlimitError } from './modellAufruf.js';
import { ladeLShopZeilen } from './lshop.js';
import { lshopModellVarianten } from './lshopKorb.js';
import { leseKunden } from './kunden.js';
import { leseKundenHistorie } from './auftraege.js';
import { KANAELE } from '../utils/auftraege.js';
import {
  TEXT_MIN, TEXT_MAX, KI_SCHEMA, systemPrompt, userPrompt, heuteBerlin, pruefeKiAntwort, KiUnsinnError,
  kundenVorschlaege, terminPruefen, kanalPruefen, modellZuordnen, gruppeVorschlag, baueVorschlag, kundeNeuPruefen,
  drucknamePruefen, notizOhneNamen, kurztitelOhneNamen,
} from '../utils/auftrag-schnell.js';

const ANREDEN = new Set(['frau', 'herr', 'herrn', 'dr', 'prof', 'familie', 'fam']);   // SA4: Anreden bleiben in der Notiz

export const ROLLE = 'auftrag-schnell';
export const ZEITLIMIT_MS = 30_000;

const fehler = (msg, status, code) => Object.assign(new Error(msg), { status, code });

async function sheetsClient() { return google.sheets({ version: 'v4', auth: await getGoogleAuth() }); }

/** Eingabe pruefen: Text Pflicht, TEXT_MIN..TEXT_MAX Zeichen. Fehlertexte ohne den Text. */
export function pruefeEingabe(eingabe) {
  const text = typeof eingabe?.text === 'string' ? eingabe.text.trim() : '';
  if (text.length < TEXT_MIN) throw fehler(`Bitte etwas mehr Text eingeben (mindestens ${TEXT_MIN} Zeichen).`, 422, 'text_kurz');
  if (text.length > TEXT_MAX) throw fehler(`Text zu lang (höchstens ${TEXT_MAX} Zeichen) – bitte kürzen oder aufteilen.`, 422, 'text_lang');
  return text;
}

/** KI-Aufruf; jeder Fehler wird zu einer festen Meldung ohne Text oder Antwortinhalt. */
async function kiStruktur({ text, heute, aufruf, modellId }) {
  let roh;
  try {
    roh = (await aufruf({
      modellId, system: systemPrompt(KANAELE), prompt: userPrompt(text, heute),
      art: 'schnell', rolle: ROLLE, jsonSchema: KI_SCHEMA, zeitlimitMs: ZEITLIMIT_MS,
    })).text;
  } catch (e) {
    if (e instanceof KiZeitlimitError || e instanceof KiAbgeschnittenError || e instanceof KiAbgelehntError) throw e;
    if (e?.status === 503) throw e;
    const s = Number(e?.status) || 0;
    if (e?.name === 'APIConnectionTimeoutError' || /timeout/i.test(String(e?.name))) throw new KiZeitlimitError({ modellId, ms: ZEITLIMIT_MS });
    throw fehler(`KI nicht erreichbar${s ? ` (Status ${s})` : ''} – bitte später erneut versuchen.`, 502, 'ki_fehler');
  }
  return pruefeKiAntwort(roh);
}

/**
 * Vorschlag bauen.
 * @param {object} o  { eingabe: { text }, jetzt, aufruf (Attrappe im Test), sheets, kundenLesen, historieLesen, modelleLesen, variantenLesen }
 */
export async function schnellVorschlag({
  eingabe, jetzt = () => new Date(), aufruf = textAufruf, sheets: s,
  kundenLesen = leseKunden, historieLesen = leseKundenHistorie,
  modelleLesen = ladeLShopZeilen, variantenLesen = lshopModellVarianten, modellLesen = getModel,
} = {}) {
  const text = pruefeEingabe(eingabe);
  const modellId = await modellLesen(ROLLE);
  if (anbieterVon(modellId) !== 'anthropic') {
    throw fehler(`Rolle ${ROLLE} ist auf "${modellId}" gestellt – für die Schnellannahme ist nur Claude (Anthropic) zulässig.`, 503, 'ki_anbieter');
  }
  const fehlt = schluesselFehlt(modellId, ROLLE);
  if (fehlt) throw fehler(fehlt, 503, 'ki_schluessel');

  const heute = heuteBerlin(jetzt());
  const ki = await kiStruktur({ text, heute, aufruf, modellId });
  if (!ki.kunde.length && !ki.gruppen.length && !ki.frei.length && !ki.kurztitel) throw new KiUnsinnError('nichts erkannt');

  // Kunde: MC sucht selbst in der eigenen Liste (geht nie an die KI).
  const sheets = s ?? await sheetsClient();
  const { kunden } = await kundenLesen(s ? { sheets } : {});
  const kunde = kundenVorschlaege(kunden, ki.kunde);

  // Historie nur bei eindeutigem Kunden: seine noch waehlbaren Modelle zuerst.
  let historie = [];
  if (kunde.sicher) {
    try {
      const h = await historieLesen({ kundenNr: kunde.vorschlaege[0], ...(s ? { sheets } : {}) });
      historie = [...new Set((h?.gruppen ?? []).filter(g => g.modell && g.katalog !== false).map(g => g.modell))];
    } catch { historie = []; }   // Historie ist nur eine Hilfe
  }

  const zeilen = ki.gruppen.length ? await modelleLesen({ sheets }) : [];
  const variantenJe = new Map();
  const gruppen = [];
  for (const g of ki.gruppen) {
    const modell = modellZuordnen(g, zeilen, historie);
    let varianten = [];
    if (modell.catalogNr) {
      if (!variantenJe.has(modell.catalogNr)) {
        try { variantenJe.set(modell.catalogNr, (await variantenLesen({ catalogNr: modell.catalogNr, sheets })).varianten ?? []); }
        catch { variantenJe.set(modell.catalogNr, []); }
      }
      varianten = variantenJe.get(modell.catalogNr);
      if (!varianten.length) Object.assign(modell, { catalogNr: '', sicher: false, grund: `Modell ${modell.catalogNr} hat keine wählbaren Varianten.`, vorschlaege: [] });
    }
    gruppen.push(gruppeVorschlag(g, modell, varianten));
  }

  // SA4: Drucknamen nur, wenn woertlich im Text; Groesse davor nur, wenn es sie in der Gruppe gibt.
  const druckNamen = [];
  ki.gruppen.forEach((g, i) => {
    const groessen = [...g.groessen.map(x => x.groesse), ...gruppen[i].positionen.map(x => x.groesse)];
    const d = drucknamePruefen(g.druckname, text, groessen);
    druckNamen.push(...d.namen);
    gruppen[i].druckname = d.wert;
    gruppen[i].drucknameGrund = d.wert || d.weg ? `Drucknamen von der KI – bitte prüfen.${d.weg ? ` ${d.weg} Name(n) nicht im Text – weggelassen.` : ''}` : '';
  });
  const frei = ki.frei.map(f => {
    const d = drucknamePruefen(f.druckname, text, []);
    druckNamen.push(...d.namen);
    return { ...f, druckname: d.wert };
  });
  // Notiz ohne Personennamen: Drucknamen, Kontaktnamen aus dem Text, Person/Ansprechpartner der gefundenen Kunden.
  const kundeNeu = kundeNeuPruefen(ki.kundeNeu, text);   // SA2: nur woertlich Belegtes
  const kontakt = (kunden ?? []).filter(k => kunde.vorschlaege.includes(k.Kunden_Nr))
    .flatMap(k => [k.Ansprechpartner, k.Art === 'Person' ? k.Name : '']);
  const namen = [...druckNamen, kundeNeu.felder.ansprechpartner,
    kundeNeu.felder.art === 'Person' ? kundeNeu.felder.name : '', ...kontakt].flatMap(n => [n, ...String(n ?? '').split(/\s+/).filter(w => w.length >= 3 && !ANREDEN.has(w.toLowerCase().replace(/\.$/, '')))]);
  const notiz = notizOhneNamen(ki.notiz, namen);
  const kurztitel = kurztitelOhneNamen(ki.kurztitel, namen);   // SA5: Titel "Auftraggeber – Inhalt", nie ein Personenname

  return baueVorschlag({ ki: { ...ki, frei, kurztitel }, kunde, termin: terminPruefen(ki.termin, heute.datum), kanal: kanalPruefen(ki.kanal, KANAELE), gruppen,
    kundeNeu, notiz });
}
