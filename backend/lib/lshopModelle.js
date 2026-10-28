// Ansicht "L-Shop-Modelle" (LS4): neue L-Shop-Modelle als Sammelliste aufnehmen.
// Logik in utils/lshop-modelle.js, Stammdaten-Lauf in lib/lshopStammdaten.js (LS1).
//
//   ampel        - nur Sheets (LShop_Modelle, Modelle_Zusatz), < 1 s, schreibt nichts
//   pruefen      - EIN Stammdaten-Trockenlauf mit den Eingaben + Suche in der Stammdatei
//                  (CatalogNr, Hersteller-Nummer, "endet auf", Name), schreibt nichts
//   uebernehmen  - Stammdaten-Lauf "uebernehmen" mit den gewaehlten Modellen; direkt vor
//                  dem Schreiben geprueft: alle gefunden, KEINE Fremdaenderungen (sonst
//                  409, nichts geschrieben). Erst NACH dem erfolgreichen Lauf die Zeilen
//                  in Modelle_Zusatz (kein append, zurueckgelesen). Scheitert nur dieser
//                  letzte Schritt, stehen die Modelle trotzdem in LShop_Modelle und
//                  bleiben dort (LS1 fuehrt einmal uebernommene ArticleNr weiter).
//   zurueckziehen - Modelle_Zusatz.Status = "zurückgezogen" (nie loeschen); LShop_Modelle
//                  bleibt (Inhaber 28.10.).
// Alles ausser der Ampel unter der Stammdaten-Sperre (409 "laeuft gerade").
// Keine Preise in Antwort, Log oder Chat; nichts aus der Datei ausser Name, Marke,
// Farben, Groessen, Discontinued.

import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth.js';
import { ladeLShopZeilen, lshopAuswertung, _resetLShopCache, TAB_LSHOP } from './lshop.js';
import { stammdatenLauf, mitStammdatenSperre, modellAus, TAB_ZUSATZ } from './lshopStammdaten.js';
import { schreibeNeueZeilen, ersetzeZeile } from './sheet-zeilen.js';
import {
  eingabeArt, trefferArt, bewerteSuche, ampelStufe, fremdAenderungen, zusatzZeilen, fehlendeZusatzSpalten,
  zusatzPlan, zusatzZeileWerte, berlinTag, istZurueckgezogen, ZURUECKGEZOGEN, MAX_EINGABEN, MAX_VORSCHLAEGE, RANG,
} from '../utils/lshop-modelle.js';

const t = v => String(v ?? '').trim();
const U = v => t(v).toUpperCase();

function fehler(msg, status = 400, extra = {}) {
  return Object.assign(new Error(msg), { status, ...extra });
}

async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await getGoogleAuth() });
}

function eingabenListe(eingaben) {
  if (!Array.isArray(eingaben) || !eingaben.length) throw fehler('Keine Modelle angegeben.');
  if (eingaben.length > MAX_EINGABEN) throw fehler(`Höchstens ${MAX_EINGABEN} Modelle auf einmal.`);
  return eingaben.map(eingabeArt);
}

/** Modelle_Zusatz frisch lesen (UNFORMATTED). Fehlt der Reiter -> 409 mit Einrichtungshinweis. */
export async function leseZusatz({ sheets, ssotId = process.env.GOOGLE_SHEET_ID } = {}) {
  let werte;
  try {
    ({ data: { values: werte = [] } } = await sheets.spreadsheets.values.get({ spreadsheetId: ssotId, range: `'${TAB_ZUSATZ}'`, valueRenderOption: 'UNFORMATTED_VALUE' }));
  } catch (err) {
    if (err?.status === 400 || /Unable to parse range/i.test(String(err?.message))) throw fehler(`${TAB_ZUSATZ} fehlt – Einrichtung nötig.`, 409, { code: 'einrichtung' });
    throw err;
  }
  return { werte, ...zusatzZeilen(werte) };
}

/** Kurzansicht eines Modells (ohne Preise) aus Zeilen im Format von lib/lshop.js. */
export function vorschauAus(zeilen) {
  if (!zeilen?.length) return null;
  const a = lshopAuswertung(zeilen);
  return {
    catalogNr: U(zeilen[0].catalogNr),
    name: t(zeilen.find(z => t(z.bezeichnung))?.bezeichnung),
    marke: a.marken[0] ?? '',
    farben: a.alleFarben,
    groessen: a.groessen,
    auslaufend: [...new Set(a.auslaufend.map(x => x.farbe))],
    gesperrt: [...new Set(a.gesperrt.map(x => x.farbe))].filter(f => !a.alleFarben.includes(f)),
  };
}

// Datensatz der Stammdatei -> Zeilenformat von lib/lshop.js (ohne Preis).
const alsLShopZeile = d => ({
  articleNr: d.ArticleNr, catalogNr: U(d.CatalogNr), color1: d.color1, color2: d.color2, size: d.Size,
  consistence: d.Consistence, grammage: d.Grammage, marke: d.Brand, herstellerNr: d.CatNrManufacturer,
  discontinued: d.Discontinued, bezeichnung: d.Description, status: '',
});

// ── Ampel ───────────────────────────────────────────────────────────────────

export async function modelleAmpel({ eingaben, sheets } = {}) {
  const liste = eingabenListe(eingaben);
  sheets ??= await sheetsClient();
  const [bestand, zusatz] = await Promise.all([ladeLShopZeilen({ sheets }), leseZusatz({ sheets }).catch(e => (e.code === 'einrichtung' ? { zeilen: [] } : Promise.reject(e)))]);
  const jeModell = new Map();
  for (const z of bestand) {
    const c = U(z.catalogNr);
    if (!jeModell.has(c)) jeModell.set(c, []);
    jeModell.get(c).push(z);
  }
  const bestandModelle = new Set(jeModell.keys());
  return {
    ergebnisse: liste.map(e => {
      const stufe = ampelStufe(e, { bestandModelle, zusatz: zusatz.zeilen });
      return { eingabe: e.text, modell: e.art === 'nummer' ? e.wert : '', art: e.art, stufe,
        ...(stufe === 'da' ? { vorschau: vorschauAus(jeModell.get(e.wert)) } : {}) };
    }),
  };
}

// ── Pruefen ─────────────────────────────────────────────────────────────────

/**
 * Sammelt waehrend des Trockenlaufs je Eingabe die Treffer der Stammdatei.
 * Zeilen (fuer die Vorschau) nur fuer Modelle, die eine Eingabe treffen; bei
 * Namenssuche hoechstens MAX_VORSCHLAEGE Modelle je Eingabe.
 */
export function suchSammler(liste) {
  const treffer = liste.map(() => new Map());        // je Eingabe: CatalogNr -> beste Art
  const zeilen = new Map();                           // CatalogNr -> Zeilen (lshop.js-Format)
  const gesehen = new Set();
  return {
    beobachte(z) {
      let gewollt = false;
      liste.forEach((e, i) => {
        const art = trefferArt(e, z);
        if (!art) return;
        const m = treffer[i];
        const alt = m.get(z.catalogNr);
        if (art === 'name' && !m.has(z.catalogNr) && m.size >= MAX_VORSCHLAEGE * 3) return;
        if (!alt || RANG[art] < RANG[alt]) m.set(z.catalogNr, art);
        gewollt = true;
      });
      if (!gewollt || gesehen.has(z.articleNr)) return;
      gesehen.add(z.articleNr);
      if (!zeilen.has(z.catalogNr)) zeilen.set(z.catalogNr, []);
      zeilen.get(z.catalogNr).push(alsLShopZeile(z.datensatz()));
    },
    treffer, zeilen,
  };
}

export async function modellePruefen({ eingaben, sheets, drive, wcFuer, jetzt, stream } = {}) {
  const liste = eingabenListe(eingaben);
  sheets ??= await sheetsClient();
  return mitStammdatenSperre('Prüfen (L-Shop-Modelle)', async () => {
    const sammler = suchSammler(liste);
    const nummern = liste.filter(e => e.art === 'nummer').map(e => e.wert);
    const lauf = await stammdatenLauf({
      modus: 'trockenlauf', sheets, drive, ...(wcFuer ? { wcFuer } : {}), ...(jetzt ? { jetzt } : {}), ...(stream ? { stream } : {}),
      zusatzModelle: nummern, beobachte: sammler.beobachte,
    });
    const [bestand, zusatz] = await Promise.all([ladeLShopZeilen({ sheets }), leseZusatz({ sheets }).catch(e => (e.code === 'einrichtung' ? { zeilen: [] } : Promise.reject(e)))]);
    const bestandModelle = new Set(bestand.map(z => U(z.catalogNr)));
    const ergebnisse = liste.map((e, i) => {
      const ampel = ampelStufe(e, { bestandModelle, zusatz: zusatz.zeilen });
      const r = bewerteSuche(sammler.treffer[i]);
      const basis = { eingabe: e.text, modell: e.art === 'nummer' ? e.wert : '', art: e.art };
      if (ampel === 'da') return { ...basis, stufe: 'da', catalogNr: e.wert, vorschau: vorschauAus(sammler.zeilen.get(e.wert)) };
      if (r.stufe === 'gefunden') return { ...basis, stufe: 'gefunden', catalogNr: r.catalogNr, liste: ampel, vorschau: vorschauAus(sammler.zeilen.get(r.catalogNr)) };
      if (r.stufe === 'vorschlag') {
        return { ...basis, stufe: 'vorschlag', mehr: r.mehr, vorschlaege: r.vorschlaege.map(v => ({
          ...v, schonDa: bestandModelle.has(v.catalogNr), vorschau: vorschauAus(sammler.zeilen.get(v.catalogNr)),
        })) };
      }
      // Tippfehler ("ZM108M" statt "Z108M"): die aehnlichen Nummern des Stammdaten-Laufs
      // (kandidaten(), Abstand 1 oder Praefix) als Vorschlag - ohne Vorschau.
      const aehnlich = e.art === 'nummer' ? (lauf.nichtTreffer.find(n => n.catalogNr === e.wert)?.kandidaten ?? []) : [];
      if (aehnlich.length) {
        return { ...basis, stufe: 'vorschlag', vorschlaege: aehnlich.map(c => ({
          catalogNr: c, weg: 'aehnlich', schonDa: bestandModelle.has(c), vorschau: vorschauAus(sammler.zeilen.get(c)),
        })) };
      }
      return { ...basis, stufe: 'nicht' };
    });
    const fremd = fremdAenderungen(lauf, nummern);
    return {
      datei: { name: lauf.datei.name, datum: lauf.datei.datum },
      ergebnisse,
      fremd,
      darfUebernehmen: fremd.length === 0,
      lauf: { neu: lauf.zeilen.neu, geaendert: lauf.zeilen.geaendert, ausgelaufen: lauf.zeilen.ausgelaufen, preisAenderungen: lauf.preisAenderungen },
    };
  });
}

// ── Uebernehmen ─────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {{ catalogNr: string, notiz?: string }[]} o.auswahl  gefundene bzw. gewaehlte Modelle
 * @param {string} o.datei  Dateiname der Pruefung
 */
export async function modelleUebernehmen({ auswahl, datei, sheets, drive, wcFuer, jetzt = new Date(), stream, notify = null, baueMeldung = null } = {}) {
  if (!Array.isArray(auswahl) || !auswahl.length) throw fehler('Keine Modelle zum Übernehmen.');
  if (auswahl.length > MAX_EINGABEN) throw fehler(`Höchstens ${MAX_EINGABEN} Modelle auf einmal.`);
  const modelle = [...new Set(auswahl.map(a => U(a.catalogNr)))];
  // Nur, was der Stammdaten-Lauf als Modellnummer erkennt (modellAus) - sonst fiele es dort
  // still heraus und die Zusatz-Zeile zeigte ins Leere.
  const falsch = modelle.filter(m => modellAus(m) !== m);
  if (falsch.length) throw fehler(`Keine gültige L-Shop-Modellnummer: ${falsch.join(', ')}.`);
  if (!t(datei)) throw fehler('Übernehmen braucht den Dateinamen der Prüfung (datei).');
  sheets ??= await sheetsClient();

  return mitStammdatenSperre('Übernehmen (L-Shop-Modelle)', async () => {
    // Einrichtung zuerst pruefen - sonst stuende das Modell in LShop_Modelle ohne Zusatz-Zeile.
    const z0 = await leseZusatz({ sheets });
    const fehlen = fehlendeZusatzSpalten(z0.kopf);
    if (fehlen.length) throw fehler(`${TAB_ZUSATZ}: Spalten ${fehlen.join(', ')} fehlen – Einrichtung nötig, nichts geschrieben.`, 409, { code: 'einrichtung' });
    // Schon in LShop_Modelle -> nichts zu tun (keine Zusatz-Zeile).
    _resetLShopCache();
    const vorher = new Set((await ladeLShopZeilen({ sheets })).map(r => U(r.catalogNr)));
    const schonDa = modelle.filter(m => vorher.has(m));
    modelle.splice(0, modelle.length, ...modelle.filter(m => !vorher.has(m)));
    auswahl = auswahl.filter(a => !vorher.has(U(a.catalogNr)));
    if (!modelle.length) throw fehler(`Schon in der Liste: ${schonDa.join(', ')} – nichts zu tun.`, 409, { code: 'schon_da' });

    const lauf = await stammdatenLauf({
      modus: 'uebernehmen', datei, sheets, drive, ...(wcFuer ? { wcFuer } : {}), jetzt, ...(stream ? { stream } : {}),
      zusatzModelle: modelle,
      vorSchreiben: a => {
        // Jedes neue Modell muss neue Zeilen bringen (schon vorhandene sind oben aussortiert).
        const nicht = modelle.filter(m => !(a.neuJeModell?.[m] > 0));
        if (nicht.length) throw fehler(`Nicht in der Stammdatei: ${nicht.join(', ')} – nichts geschrieben.`, 409, { code: 'nicht_gefunden' });
        const fremd = fremdAenderungen(a, modelle);
        if (fremd.length) throw fehler(`Der Lauf würde mehr ändern als die neuen Modelle (${fremd.join('; ')}). Erst das Stammdaten-Update in den Einstellungen – nichts geschrieben.`, 409, { code: 'fremdaenderungen', fremd });
      },
    });
    _resetLShopCache();

    // Modelle_Zusatz: frisch lesen, Plan, neue Zeilen ohne append, zurueckgezogene wieder aktiv.
    const z = await leseZusatz({ sheets });
    const plan = zusatzPlan(z.zeilen, auswahl);
    const tag = berlinTag(jetzt);
    if (plan.neu.length) {
      await schreibeNeueZeilen(sheets, process.env.GOOGLE_SHEET_ID, TAB_ZUSATZ,
        plan.neu.map(n => zusatzZeileWerte(z.kopf, { catalogNr: n.catalogNr, notiz: n.notiz, eingetragen: tag })));
    }
    for (const r of plan.reaktivieren) {
      const alt = z.kopf.map((_, j) => r.roh[j] ?? '');
      const neu = [...alt];
      neu[z.spalten.status] = '';
      neu[z.spalten.eingetragen] = tag;
      if (r.notizNeu) neu[z.spalten.notiz] = r.notizNeu;
      await ersetzeZeile(sheets, process.env.GOOGLE_SHEET_ID, TAB_ZUSATZ, r.zeile, alt, neu);
    }

    const antwort = {
      ok: true,
      datei: { name: lauf.datei.name, datum: lauf.datei.datum },
      modelle,
      zeilenNeu: lauf.zeilen.neu,
      zusatz: { neu: plan.neu.map(n => n.catalogNr), wiederAktiv: plan.reaktivieren.map(r => r.catalogNr), schonAufListe: plan.vorhanden },
      schonDa,
      rueckgelesen: lauf.rueckgelesen?.ok === true,
    };
    if (notify && baueMeldung) {
      let ok = false;
      try { ok = await notify(baueMeldung({ modelle, datum: lauf.datei.datum })); } catch { ok = false; }
      antwort.chat = ok ? 'gesendet' : 'fehlgeschlagen';
    }
    return antwort;
  });
}

// ── Zurueckziehen und Liste ─────────────────────────────────────────────────

export async function modellZurueckziehen({ catalogNr, sheets } = {}) {
  const cat = U(catalogNr);
  if (eingabeArt(cat).art !== 'nummer') throw fehler('Modellnummer fehlt.');
  sheets ??= await sheetsClient();
  return mitStammdatenSperre('Zurückziehen (L-Shop-Modelle)', async () => {
    const z = await leseZusatz({ sheets });
    if (z.spalten.status < 0) throw fehler(`${TAB_ZUSATZ}: Spalte Status fehlt – Einrichtung nötig.`, 409, { code: 'einrichtung' });
    const aktiv = z.zeilen.filter(r => r.catalogNr === cat && !istZurueckgezogen(r.status));
    if (!aktiv.length) throw fehler(`${cat} steht nicht (mehr) auf der Liste.`, 404);
    for (const r of aktiv) {
      const alt = z.kopf.map((_, j) => r.roh[j] ?? '');
      const neu = [...alt];
      neu[z.spalten.status] = ZURUECKGEZOGEN;
      await ersetzeZeile(sheets, process.env.GOOGLE_SHEET_ID, TAB_ZUSATZ, r.zeile, alt, neu);
    }
    return { ok: true, catalogNr: cat, zeilen: aktiv.length };
  });
}

/** Eintraege in Modelle_Zusatz (neueste zuerst) und ob sie in LShop_Modelle stehen. */
export async function zusatzListe({ sheets } = {}) {
  sheets ??= await sheetsClient();
  const [z, bestand] = await Promise.all([leseZusatz({ sheets }), ladeLShopZeilen({ sheets })]);
  const da = new Set(bestand.map(r => U(r.catalogNr)));
  return {
    einrichtung: fehlendeZusatzSpalten(z.kopf),
    eintraege: [...z.zeilen].reverse().map(r => ({
      catalogNr: r.catalogNr, notiz: r.notiz, eingetragen: r.eingetragen,
      status: istZurueckgezogen(r.status) ? 'zurückgezogen' : 'aktiv', inBestand: da.has(r.catalogNr),
    })),
    reiter: { zusatz: TAB_ZUSATZ, modelle: TAB_LSHOP },
  };
}
