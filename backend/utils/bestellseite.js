// Bestellseite per Token (KS1), reine Logik ohne Netz. Lesen/Schreiben in lib/bestellseite.js.
//
// Zwei Arten Zugang (Inhaber 07.11.: "fuer jeden Auftrag" moeglich, Fanshop ist der erste Fall):
//   auftrag - genau ein AU-…; Artikel = Gruppen Modell + Farbe der Auftrag-Positionen; genau ein Termin.
//   dauer   - ein Kunde, Sortiment = Shop-Kategorie(n) mit allen Unterkategorien; mehrere Termine (je Termin spaeter ein AU-…).
// Die Artikelliste hat eine FESTE Feldauswahl (`artikelFuerSeite`): nie Preis, EK, L-Shop-Name oder Lieferant.
// Token: Klartext nur einmal in der Antwort an MC, im Sheet nur der SHA-256-Hash; Vergleich mit timingSafeEqual.
// Log und Fehlertexte: nur Zugang_ID/Termin_ID/Auftrag_Nr/Kunden_Nr und Zahlen - nie Token, nie Namen.

import crypto from 'crypto';
import { berlinDatum } from './berlin-tag.js';
import { groessenRang } from '../lib/groessen.js';

export const TAB_ZUGAENGE = 'Bestellseiten';
export const TAB_TERMINE = 'Bestell_Termine';
export const TAB_EINTRAEGE = 'Bestell_Eintraege';
export const TAB_BILDER = 'Bestell_Bilder';

export const ZUGANG_SPALTEN = [
  'Zugang_ID', 'Art', 'Kunden_Nr', 'Auftrag_Nr', 'Partner_ID', 'Token_Hash', 'Aktiv', 'Ablauf', 'Bestellschluss_Tage',
  'Empfohlen_Tage', 'Sortiment', 'Hinweis', 'Angelegt', 'Stand',
];
// Hinten: Haken "Design-Link zeigen" (nur Art auftrag) und Vorgang (Doppelklick-Schutz beim Anlegen).
// LK1: Token_Verschluesselt = Token AES-256-GCM (utils/link-schluessel.js) fuer "Link kopieren"; geprueft wird nur der Hash.
// KS6 (nur Art auftrag, Inhaber 08.11.: echter Kundentest): Titel auf der Seite, festes "bestellen bis", Auswahl fuer die Seite OHNE Mengen
// (JSON, getrennt von den Auftragspositionen), Personalisierung (Name/Nummer auf dem Textil), "Bestellung abschließen" erlaubt + Zeitpunkt.
export const ZUGANG_KS6 = ['Titel', 'Bestellschluss_Datum', 'Auswahl', 'Personalisierung', 'Abschliessen', 'Abgeschlossen'];
// KS7: Drive-Ordner mit Entwuerfen (ID, nur Backend/MC - nie an die Seite; die Seite bekommt nur `entwuerfe: true`).
export const ZUGANG_KS7 = ['Entwurf_Ordner'];
export const ZUGANG_OPTIONAL = ['Design_Link_Zeigen', 'Vorgang', 'Token_Verschluesselt', ...ZUGANG_KS6, ...ZUGANG_KS7];
/** LK1: Zusatzdaten der Verschluesselung - der Wert gehoert genau zu diesem Zugang. */
export const zugangKontext = zugangId => `bestellseite:${String(zugangId ?? '').trim()}`;
export const ZUGANG_ALLE = [...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL];
export const TERMIN_SPALTEN = ['Termin_ID', 'Zugang_ID', 'Datum', 'Notiz', 'Bestellschluss', 'Auftrag_Nr', 'Status', 'Angelegt', 'Stand'];
// Nur angelegt (KS1), beschrieben erst in KS2. Wie bericht-KS0 2, "Spieltag" -> Termin_ID.
export const EINTRAG_SPALTEN = [
  'Eintrag_ID', 'Zugang_ID', 'Termin_ID', 'Gegner_Notiz', 'Kuerzel', 'Art', 'WC_Variation_ID', 'LShop_ArticleNr', 'Freitext', 'Menge',
  'Fuer', 'Trikot_Name', 'Trikot_Nummer', 'Wunsch', 'Zeit', 'Nach_Schluss', 'Status', 'Auftrag_Nr', 'Position_ID', 'Stand',
];
// Zwischenspeicher Bilder (Knopf "Artikelliste aktualisieren"): je Produkt bzw. Variation eine Zeile.
export const BILD_SPALTEN = ['WC_ID', 'Art', 'Bild_URL', 'Status', 'Stand'];
// KS2: Kategorie-IDs je Produkt (fuer Trikots aus Trikot_Artikel, die nicht in der Maske stehen) - optional hinten.
export const BILD_OPTIONAL = ['Kategorien'];

export const ZUGANG_TEXT = ['Zugang_ID', 'Kunden_Nr', 'Auftrag_Nr', 'Ablauf', 'Sortiment', 'Angelegt', 'Stand'];
export const TERMIN_TEXT = ['Termin_ID', 'Zugang_ID', 'Datum', 'Bestellschluss', 'Auftrag_Nr', 'Angelegt', 'Stand'];
export const EINTRAG_TEXT = ['Eintrag_ID', 'Zugang_ID', 'Termin_ID', 'WC_Variation_ID', 'LShop_ArticleNr', 'Trikot_Nummer', 'Zeit', 'Auftrag_Nr', 'Position_ID', 'Stand'];
export const BILD_TEXT = ['WC_ID', 'Stand'];

export const ART = { AUFTRAG: 'auftrag', DAUER: 'dauer' };
export const STATUS = { AKTIV: 'aktiv', GESPERRT: 'gesperrt', ABGELAUFEN: 'abgelaufen' };
export const TERMIN_STATUS_OFFEN = 'offen';
export const STANDARD = { bestellschlussTage: 4, empfohlenTage: 7, auftragPlusTage: 30, saisonEnde: '06-30' };
export const TAGE_MAX = 60;
export const HINWEIS_MAX = 200;
export const TITEL_MAX = 60;
export const AUSWAHL_MAX = { eintraege: 30, farben: 20, name: 40, motiv: 80 };
export const BESTELLSCHLUSS_VOR_TERMIN = 7;   // KS6: Vorbelegung "bestellen bis" = Auftragstermin - 7 Tage
export const ZUGANG_NR_MUSTER = /^BS-\d{3,}$/;
export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;   // 32 Byte base64url ohne Auffuellung
export const KUNDEN_NR_MUSTER = /^K-\d{5}$/;
export const PARTNER_MUSTER = /^(?:FP|P)-\d{3}$/;
export const AU_NR_MUSTER = /^AU-\d{4}-\d{4}$/;
export const NOCH_ZU_BESORGEN = 'noch zu besorgen';

const t = v => String(v ?? '').trim();
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export function fehler(text, status = 422, code) {
  const e = new Error(text);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// ── Token ────────────────────────────────────────────────────────────────────

/** Neuer Token: 32 Zufallsbytes, base64url. Nur im Backend. */
export const erzeugeToken = (zufall = crypto.randomBytes) => zufall(32).toString('base64url');
/** SHA-256 hex - das Einzige, was ins Sheet geht. */
export const tokenHash = token => crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

/** Bearer-Token aus dem Header (nie aus Adresse oder Body). Ungueltige Form = ''. */
export function tokenAusHeader(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(t(header));
  return m && TOKEN_MUSTER.test(m[1]) ? m[1] : '';
}

/** Zugang zum Token suchen: Hash vergleichen mit timingSafeEqual ueber alle Zeilen (kein frueher Abbruch). */
export function findeZugang(zugaenge, token) {
  if (!TOKEN_MUSTER.test(t(token))) return null;
  const soll = Buffer.from(tokenHash(token), 'hex');
  let treffer = null;
  for (const z of zugaenge ?? []) {
    const h = t(z.Token_Hash);
    if (!/^[0-9a-f]{64}$/.test(h)) continue;
    if (crypto.timingSafeEqual(soll, Buffer.from(h, 'hex')) && !treffer) treffer = z;
  }
  return treffer;
}

// ── Zustand, Fristen ─────────────────────────────────────────────────────────

export const heuteBerlin = jetzt => berlinDatum(new Date(jetzt));
const istJa = v => ['ja', 'true', '1'].includes(t(v).toLowerCase());

/** aktiv | gesperrt | abgelaufen. Ablauf = letzter gueltiger Tag (Europe/Berlin). */
export function zugangStatus(z, jetzt) {
  if (!istJa(z?.Aktiv)) return STATUS.GESPERRT;
  const ab = t(z?.Ablauf);
  if (!DATUM.test(ab) || ab < heuteBerlin(jetzt)) return STATUS.ABGELAUFEN;
  return STATUS.AKTIV;
}

/** Tage auf ein JJJJ-MM-TT addieren (Kalendertage, ohne Zeitzone). */
export function plusTage(ymd, tage) {
  const [j, m, d] = ymd.split('-').map(Number);
  const x = new Date(Date.UTC(j, m - 1, d + tage));
  return x.toISOString().slice(0, 10);
}

/** Vorschlag Ablauf: dauer = naechster 30.06. (Saisonende); auftrag = Termin + 30 Tage, ohne Termin heute + 30. */
export function ablaufVorschlag(art, { jetzt, termin = '' } = {}) {
  const heute = heuteBerlin(jetzt);
  if (art === ART.DAUER) {
    const jahr = Number(heute.slice(0, 4));
    const diesJahr = `${jahr}-${STANDARD.saisonEnde}`;
    return heute <= diesJahr ? diesJahr : `${jahr + 1}-${STANDARD.saisonEnde}`;
  }
  const basis = DATUM.test(t(termin)) && t(termin) > heute ? t(termin) : heute;
  return plusTage(basis, STANDARD.auftragPlusTage);
}

/** Bestellschluss / Empfohlen zu einem Termin (Datum minus Tage), ohne Datum leer. */
export function fristen(datum, { bestellschlussTage, empfohlenTage }) {
  if (!DATUM.test(t(datum))) return { bestellschluss: '', empfohlen: '' };
  return { bestellschluss: plusTage(t(datum), -bestellschlussTage), empfohlen: plusTage(t(datum), -empfohlenTage) };
}

const tageWert = (v, standard, was) => {
  if (t(v) === '') return standard;
  const n = Number(t(v));
  if (!Number.isInteger(n) || n < 0 || n > TAGE_MAX) throw fehler(`${was}: ganze Zahl 0–${TAGE_MAX}.`);
  return n;
};
export const zugangTage = z => ({
  bestellschlussTage: (() => { try { return tageWert(z?.Bestellschluss_Tage, STANDARD.bestellschlussTage, 'Bestellschluss'); } catch { return STANDARD.bestellschlussTage; } })(),
  empfohlenTage: (() => { try { return tageWert(z?.Empfohlen_Tage, STANDARD.empfohlenTage, 'Empfohlen'); } catch { return STANDARD.empfohlenTage; } })(),
});

// ── KS6: Art auftrag - festes "bestellen bis", Titel, Auswahl ohne Mengen ──

/**
 * Fristen eines Termins fuer diesen Zugang. Art auftrag mit festem Datum (Bestellschluss_Datum): genau dieses, ohne "am besten bis";
 * sonst wie bisher Termin minus Tage (Fanshop unveraendert). Eine Stelle fuer Seite, Absenden und Aendern.
 */
export function terminFristen(termin, zugang) {
  const fest = t(zugang?.Bestellschluss_Datum);
  if (zugang?.Art === ART.AUFTRAG && DATUM.test(fest)) return { bestellschluss: fest, empfohlen: '' };
  return fristen(termin?.Datum, zugangTage(zugang));
}
/** Vorbelegung "bestellen bis": Auftragstermin - 7 Tage, nicht vor heute; ohne Termin leer. */
export function bestellschlussVorschlag(termin, jetzt) {
  if (!DATUM.test(t(termin))) return '';
  const d = plusTage(t(termin), -BESTELLSCHLUSS_VOR_TERMIN);
  const heute = heuteBerlin(jetzt);
  return d < heute ? heute : d;
}
const bestellschlussAus = (v, jetzt) => {
  const d = t(v);
  if (!d) return '';
  if (!DATUM.test(d)) throw fehler('„bestellen bis“ als Datum (JJJJ-MM-TT).');
  if (d < heuteBerlin(jetzt)) throw fehler('„bestellen bis“ liegt in der Vergangenheit.');
  return d;
};
const titelAus = v => {
  const x = t(v).replace(/\s+/g, ' ');
  if (x.length > TITEL_MAX) throw fehler(`Titel: höchstens ${TITEL_MAX} Zeichen.`);
  return x;
};
const jaLeer = v => (v === true ? 'ja' : '');
/** Zugang abgeschlossen ("Bestellung abschließen" auf der Seite)? Dann nur noch lesen. */
export const istAbgeschlossen = z => /^\d{4}-\d{2}-\d{2}T/.test(t(z?.Abgeschlossen));

/** Auswahl aus der Zelle lesen (JSON). Kaputt/leer = [] (dann Uebergang: Positionen des Auftrags). */
export function auswahlLesen(z) {
  const roh = t(z?.Auswahl);
  if (!roh) return [];
  try {
    const a = JSON.parse(roh);
    return Array.isArray(a) ? a.filter(x => x && t(x.modell) && Array.isArray(x.farben)).map(x => ({
      modell: t(x.modell), farben: x.farben.map(t).filter(Boolean), name: t(x.name), motiv: t(x.motiv) })) : [];
  } catch { return []; }
}

/**
 * Auswahl fuer die Bestellseite pruefen (MC). Je Eintrag Modell (CatalogNr) + Farben (L-Shop-Schreibweise) + Bezeichnung (Pflicht, fuer
 * den Kunden - nie L-Shop-Name/Marke) + Motiv (optional). Farben muessen im Modell waehlbar sein (ohne ausgelaufen/3/6).
 * @param {Map<string, Set<string>>} farbenJe  CatalogNr -> waehlbare Farben
 * @returns {string} JSON fuer die Zelle ('' = keine Auswahl)
 */
export function auswahlAus(roh, farbenJe) {
  const liste = Array.isArray(roh) ? roh : [];
  if (liste.length > AUSWAHL_MAX.eintraege) throw fehler(`Auswahl: höchstens ${AUSWAHL_MAX.eintraege} Artikel.`);
  const gesehen = new Set();
  const aus = liste.map((x, i) => {
    const nr = i + 1;
    const modell = t(x?.modell);
    const farbenOk = farbenJe?.get(modell);
    if (!modell || !farbenOk) throw fehler(`Auswahl ${nr}: Modell gibt es nicht (mehr) in den L-Shop-Stammdaten.`);
    const farben = [...new Set((Array.isArray(x?.farben) ? x.farben : []).map(t).filter(Boolean))];
    if (!farben.length) throw fehler(`Auswahl ${nr}: mindestens eine Farbe wählen.`);
    if (farben.length > AUSWAHL_MAX.farben) throw fehler(`Auswahl ${nr}: höchstens ${AUSWAHL_MAX.farben} Farben.`);
    const fremd = farben.filter(f => !farbenOk.has(f));
    if (fremd.length) throw fehler(`Auswahl ${nr}: Farbe ${fremd.join(', ')} ist für dieses Modell nicht (mehr) wählbar.`);
    const name = t(x?.name).replace(/\s+/g, ' ');
    if (!name) throw fehler(`Auswahl ${nr}: Bezeichnung für den Kunden fehlt (z. B. T-Shirt).`);
    if (name.length > AUSWAHL_MAX.name) throw fehler(`Auswahl ${nr}: Bezeichnung höchstens ${AUSWAHL_MAX.name} Zeichen.`);
    const motiv = t(x?.motiv).replace(/\s+/g, ' ');
    if (motiv.length > AUSWAHL_MAX.motiv) throw fehler(`Auswahl ${nr}: Motiv höchstens ${AUSWAHL_MAX.motiv} Zeichen.`);
    const k = `${modell}|${name}|${motiv}`;
    if (gesehen.has(k)) throw fehler(`Auswahl ${nr}: gibt es schon – Farben dort ergänzen.`);
    gesehen.add(k);
    return { modell, farben, name, ...(motiv ? { motiv } : {}) };
  });
  return aus.length ? JSON.stringify(aus) : '';
}

// ── Nummern ──────────────────────────────────────────────────────────────────

const naechste = (liste, feld, praefix, stellen) => {
  const max = (liste ?? []).reduce((m, x) => { const r = new RegExp(`^${praefix}-(\\d+)$`).exec(t(x[feld])); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  return `${praefix}-${String(max + 1).padStart(stellen, '0')}`;
};
export const naechsteZugangId = zugaenge => naechste(zugaenge, 'Zugang_ID', 'BS', 3);
export const naechsteTerminId = termine => naechste(termine, 'Termin_ID', 'BT', 4);

// ── Pruefen der Eingaben aus MC ──────────────────────────────────────────────

/** Sortiment: Kategorie-Nummern, Komma-getrennt, jede muss in Struktur_Kategorien stehen. */
export function sortimentAus(v, kategorien) {
  const liste = [...new Set(t(v).split(/[\s,;]+/).map(t).filter(Boolean))];
  if (!liste.length) throw fehler('Sortiment: mindestens eine Kategorie-Nummer.');
  const bekannt = new Set((kategorien ?? []).map(k => t(k.nr)));
  const fremd = liste.filter(n => !/^\d+$/.test(n) || !bekannt.has(n));
  if (fremd.length) throw fehler(`Sortiment: Kategorie ${fremd.join(', ')} unbekannt.`);
  return liste.join(',');
}
const hinweisAus = v => {
  const h = t(v).replace(/\s+/g, ' ');
  if (h.length > HINWEIS_MAX) throw fehler(`Hinweis: höchstens ${HINWEIS_MAX} Zeichen.`);
  return h;
};
const ablaufAus = (v, jetzt) => {
  const a = t(v);
  if (!DATUM.test(a)) throw fehler('Ablauf als Datum (JJJJ-MM-TT).');
  if (a < heuteBerlin(jetzt)) throw fehler('Ablauf liegt in der Vergangenheit.');
  return a;
};

/**
 * Neuer Zugang. auftrag: Auftrag muss existieren und offen sein; Kunde = der des Auftrags.
 * Je Auftrag bzw. Kunde (dauer) hoechstens ein nicht gesperrter Zugang.
 * -> { zugang, termin | null }  (Token_Hash setzt der Aufrufer)
 */
export function anlagePlan({ eingabe, zugaenge, termine, auftraege, kategorien, kundeDa, jetzt }) {
  const art = t(eingabe?.art);
  if (![ART.AUFTRAG, ART.DAUER].includes(art)) throw fehler('Art: auftrag oder dauer.');
  const heute = heuteBerlin(jetzt);
  const tage = {
    bestellschlussTage: tageWert(eingabe?.bestellschlussTage, STANDARD.bestellschlussTage, 'Bestellschluss'),
    empfohlenTage: tageWert(eingabe?.empfohlenTage, STANDARD.empfohlenTage, 'Empfohlen'),
  };
  const partner = t(eingabe?.partnerId);
  if (partner && !PARTNER_MUSTER.test(partner)) throw fehler('Partner-ID ungültig (z. B. FP-001).');
  let kundenNr = t(eingabe?.kundenNr), auftragNr = '', auftrag = null, sortiment = '';
  if (art === ART.AUFTRAG) {
    auftragNr = t(eingabe?.auftragNr);
    if (!AU_NR_MUSTER.test(auftragNr)) throw fehler('Auftrag-Nr. ungültig.');
    auftrag = (auftraege ?? []).find(a => a.Auftrag_Nr === auftragNr);
    if (!auftrag) throw fehler(`Auftrag ${auftragNr} gibt es nicht.`, 404);
    if (['storniert', 'bezahlt'].includes(auftrag.Status)) throw fehler(`Auftrag ${auftragNr} ist ${auftrag.Status}.`);
    kundenNr = auftrag.Kunden_Nr;
    if ((zugaenge ?? []).some(z => z.Auftrag_Nr === auftragNr && zugangStatus(z, jetzt) !== STATUS.GESPERRT)) {
      throw fehler(`Für ${auftragNr} gibt es schon eine Bestellseite – dort „neuer Link“ oder erst sperren.`, 409, 'schon_da');
    }
  } else {
    sortiment = sortimentAus(eingabe?.sortiment, kategorien);
    if ((zugaenge ?? []).some(z => z.Art === ART.DAUER && z.Kunden_Nr === kundenNr && zugangStatus(z, jetzt) !== STATUS.GESPERRT)) {
      throw fehler(`Für ${kundenNr} gibt es schon eine Dauer-Bestellseite – dort „neuer Link“ oder erst sperren.`, 409, 'schon_da');
    }
  }
  if (!KUNDEN_NR_MUSTER.test(kundenNr)) throw fehler('Kunden-Nr. ungültig.');
  if (kundeDa && !kundeDa(kundenNr)) throw fehler(`Kunde ${kundenNr} gibt es nicht oder ist gesperrt.`, 422, 'kunde');
  const ablauf = t(eingabe?.ablauf) ? ablaufAus(eingabe.ablauf, jetzt) : ablaufVorschlag(art, { jetzt, termin: auftrag?.Termin });
  const stand = new Date(jetzt).toISOString();
  const zugang = {
    Zugang_ID: naechsteZugangId(zugaenge), Art: art, Kunden_Nr: kundenNr, Auftrag_Nr: auftragNr, Partner_ID: partner,
    Token_Hash: '', Aktiv: 'ja', Ablauf: ablauf, Bestellschluss_Tage: tage.bestellschlussTage, Empfohlen_Tage: tage.empfohlenTage,
    Sortiment: sortiment, Hinweis: hinweisAus(eingabe?.hinweis), Angelegt: heute, Stand: stand,
    Design_Link_Zeigen: art === ART.AUFTRAG && eingabe?.designLinkZeigen === true ? 'ja' : '', Vorgang: t(eingabe?.vorgang),
  };
  if (art === ART.AUFTRAG) {   // KS6: Titel (leer = Kurztitel), "bestellen bis" (Vorbelegung Termin - 7), Schalter
    zugang.Titel = titelAus(eingabe?.titel) || t(auftrag.Kurztitel).replace(/\s+/g, ' ').slice(0, TITEL_MAX);
    zugang.Bestellschluss_Datum = eingabe?.bestellschluss !== undefined ? bestellschlussAus(eingabe.bestellschluss, jetzt) : bestellschlussVorschlag(auftrag.Termin, jetzt);
    zugang.Personalisierung = jaLeer(eingabe?.personalisierung);
    zugang.Abschliessen = jaLeer(eingabe?.abschliessen);
  }
  let termin = null;
  if (art === ART.AUFTRAG) {
    const datum = DATUM.test(t(auftrag.Termin)) ? t(auftrag.Termin) : '';
    termin = {
      Termin_ID: naechsteTerminId(termine), Zugang_ID: zugang.Zugang_ID, Datum: datum, Notiz: '',
      Bestellschluss: zugang.Bestellschluss_Datum || fristen(datum, tage).bestellschluss, Auftrag_Nr: auftragNr, Status: TERMIN_STATUS_OFFEN, Angelegt: heute, Stand: stand,
    };
  }
  return { zugang, termin };
}

/** Bearbeiten: Aktiv (sperren/entsperren), Ablauf (verlaengern), Hinweis, Fristen, Sortiment, Design-Link. Stand wie gesehen. */
export function bearbeitenPlan({ zugang, eingabe, kategorien, jetzt }) {
  if (!zugang) throw fehler('Zugang gibt es nicht.', 404);
  if (t(eingabe?.stand) !== t(zugang.Stand)) throw fehler('Zugang wurde inzwischen geändert – bitte neu laden.', 409, 'konflikt');
  const neu = { ...zugang };
  if (eingabe.aktiv !== undefined) neu.Aktiv = eingabe.aktiv === true ? 'ja' : 'nein';
  if (eingabe.ablauf !== undefined) neu.Ablauf = ablaufAus(eingabe.ablauf, jetzt);
  if (eingabe.hinweis !== undefined) neu.Hinweis = hinweisAus(eingabe.hinweis);
  if (eingabe.bestellschlussTage !== undefined) neu.Bestellschluss_Tage = tageWert(eingabe.bestellschlussTage, STANDARD.bestellschlussTage, 'Bestellschluss');
  if (eingabe.empfohlenTage !== undefined) neu.Empfohlen_Tage = tageWert(eingabe.empfohlenTage, STANDARD.empfohlenTage, 'Empfohlen');
  if (eingabe.sortiment !== undefined) {
    if (zugang.Art !== ART.DAUER) throw fehler('Sortiment gibt es nur bei der Dauer-Bestellseite.');
    neu.Sortiment = sortimentAus(eingabe.sortiment, kategorien);
  }
  if (eingabe.designLinkZeigen !== undefined) {
    if (zugang.Art !== ART.AUFTRAG) throw fehler('Design-Link gibt es nur bei der Bestellseite eines Auftrags.');
    neu.Design_Link_Zeigen = eingabe.designLinkZeigen === true ? 'ja' : '';
  }
  // KS6: nur Art auftrag (der Fanshop bleibt wie er ist)
  const nurAuftrag = was => { if (zugang.Art !== ART.AUFTRAG) throw fehler(`${was} gibt es nur bei der Bestellseite eines Auftrags.`); };
  if (eingabe.titel !== undefined) { nurAuftrag('Titel'); neu.Titel = titelAus(eingabe.titel); }
  if (eingabe.bestellschluss !== undefined) {
    nurAuftrag('„bestellen bis“');
    // unveraendert = erlaubt, auch wenn es inzwischen vorbei ist (es wurden nur andere Felder gespeichert)
    neu.Bestellschluss_Datum = t(eingabe.bestellschluss) === t(zugang.Bestellschluss_Datum) ? t(zugang.Bestellschluss_Datum) : bestellschlussAus(eingabe.bestellschluss, jetzt);
  }
  if (eingabe.auswahl !== undefined) { nurAuftrag('Die Auswahl'); neu.Auswahl = t(eingabe.auswahlJson); }
  if (eingabe.personalisierung !== undefined) { nurAuftrag('Name/Nummer auf dem Textil'); neu.Personalisierung = jaLeer(eingabe.personalisierung); }
  if (eingabe.abschliessen !== undefined) { nurAuftrag('„Bestellung abschließen“'); neu.Abschliessen = jaLeer(eingabe.abschliessen); }
  if (eingabe.wiederOeffnen === true) neu.Abgeschlossen = '';
  neu.Stand = new Date(jetzt).toISOString();
  return neu;
}

/** KS6: "Bestellung abschließen" von der Seite - nur wenn am Zugang erlaubt; zweiter Klick = schon abgeschlossen. */
export function abschlussPlan({ zugang, jetzt }) {
  if (zugang.Art !== ART.AUFTRAG || t(zugang.Abschliessen) !== 'ja') throw fehler('Abschließen ist für diese Bestellseite nicht vorgesehen.', 422);
  if (istAbgeschlossen(zugang)) return { schon: true, neu: zugang };
  const iso = new Date(jetzt).toISOString();
  return { schon: false, neu: { ...zugang, Abgeschlossen: iso, Stand: iso } };
}
/** KS6: Chat nach "Bestellung abschließen" - nur Zugang und Anzahl, nie Namen oder Texte. */
export const abschlussNachricht = ({ zugangId, anzahl }) =>
  `✅ Bestellseite ${t(zugangId)} abgeschlossen${Number(anzahl) > 0 ? ` (${Number(anzahl)} ${Number(anzahl) === 1 ? 'Eintrag' : 'Einträge'})` : ''} – bitte prüfen und übernehmen.`;

// ── KS2: kleine Bilder ───────────────────────────────────────────────────────
// Die Shop-Bilder kommen ueber das Jetpack-Bild-CDN (i0.wp.com … ?fit=800,1029, gemessen 07.11.). Dort laesst sich die Groesse
// sicher ueber die Abfrage setzen (fit=120,120: 1-3 KB statt 17-63 KB). Andere Hosts bleiben unveraendert (keine geratenen Dateinamen).
export const BILD_KLEIN = 120;
export const BILD_GROSS = 600;
export function bildGroesse(url, px) {
  const u = t(url);
  if (!/^https:\/\//.test(u)) return '';
  try {
    const x = new URL(u);
    if (!/^i[0-3]\.wp\.com$/.test(x.host)) return u;
    x.search = `?fit=${px}%2C${px}&quality=80&ssl=1`;
    return x.toString();
  } catch { return ''; }
}

/** Kategorie-Nummern des Sortiments inkl. aller Unterkategorien (ueber den Pfad in Struktur_Kategorien). */
export function sortimentNummern(sortiment, kategorien) {
  const ids = new Set(t(sortiment).split(',').map(t).filter(Boolean));
  const wurzeln = (kategorien ?? []).filter(k => ids.has(t(k.nr))).map(k => t(k.pfad));
  return new Set((kategorien ?? []).filter(k => wurzeln.some(w => t(k.pfad) === w || t(k.pfad).startsWith(`${w} > `))).map(k => t(k.nr)));
}

/**
 * Trikots einer Dauer-Bestellseite: aktive Zeilen aus Trikot_Artikel, deren Shop-Kategorien (Bestell_Bilder.Kategorien,
 * gefuellt mit "Artikelliste aktualisieren") im Sortiment liegen. Groessen wie TR6 (Kinder cm, dann Erwachsene).
 * @param {{produktId, name, aktiv}[]} o.trikotArtikel
 * @param {Map<string,{url,status,kategorien}>} o.bilder
 */
export function trikotsDauer({ sortiment, kategorien, trikotArtikel, bilder = new Map(), groessen }) {
  const nummern = sortimentNummern(sortiment, kategorien);
  return (trikotArtikel ?? [])
    .filter(x => t(x.produktId) && !['false', 'nein', '0'].includes(t(x.aktiv).toLowerCase()))
    .filter(x => { const b = bilder.get(t(x.produktId)); return b && (!b.status || b.status === 'publish') && t(b.kategorien).split(',').map(t).some(n => nummern.has(n)); })
    .map(x => ({ produktId: t(x.produktId), name: t(x.name) || 'Trikot', bild: bildGroesse(bilder.get(t(x.produktId))?.url, BILD_KLEIN), groessen: [...groessen] }));
}

// ── Katalog: Art dauer (SSOT: Kategorien, Maske, Varianten) ──────────────────

/**
 * Kategorie-Namen, die zu einem Sortiment gehoeren. Die Maske fuehrt Kategorien als NAMEN (Komma-getrennt);
 * ein Name, den es auch ausserhalb des Sortiments gibt (z. B. "Kinder"), zaehlt allein nicht.
 * @param {{nr, pfad, name}[]} kategorien  Struktur_Kategorien
 */
export function sortimentNamen(sortiment, kategorien) {
  const ids = new Set(t(sortiment).split(',').map(t).filter(Boolean));
  const wurzeln = (kategorien ?? []).filter(k => ids.has(t(k.nr))).map(k => t(k.pfad));
  const drin = k => wurzeln.some(w => t(k.pfad) === w || t(k.pfad).startsWith(`${w} > `));
  const zaehle = new Map();
  for (const k of kategorien ?? []) zaehle.set(t(k.name), (zaehle.get(t(k.name)) ?? 0) + 1);
  const namen = new Set();
  for (const k of (kategorien ?? []).filter(drin)) {
    const n = t(k.name);
    const ueberall = (kategorien ?? []).filter(x => t(x.name) === n);
    if (ueberall.every(drin) || zaehle.get(n) === 1) namen.add(n);
  }
  return namen;
}

const ACHSE_FARBE = /^farbe$/i;
const istGroesse = e => /^gr(ö|oe|o)(ß|ss)e$/i.test(t(e));

/** Varianten-Zeile -> { farbe, design, groesse } aus den Achsen E1..E3/V1..V3. */
function achsen(v) {
  const aus = { farbe: '', design: '', groesse: '' };
  for (const n of [1, 2, 3]) {
    const e = t(v[`E${n}`]), w = t(v[`V${n}`]);
    if (!e) continue;
    if (ACHSE_FARBE.test(e)) aus.farbe = w;
    else if (istGroesse(e)) aus.groesse = w;
    else aus.design = aus.design ? `${aus.design} · ${w}` : w;
  }
  return aus;
}

const groessenSort = (a, b) => {
  const ra = groessenRang(a.groesse), rb = groessenRang(b.groesse);
  const K = ['buchstabe', 'zahl', 'kinder'];
  if (ra && rb) return K.indexOf(ra.klasse) - K.indexOf(rb.klasse) || ra.rang - rb.rang;
  return ra ? -1 : rb ? 1 : 0;
};

/**
 * Artikel einer Dauer-Bestellseite: veroeffentlichte Artikel der Sortiment-Kategorien, je Artikel + Farbe (+ Design) eine Karte,
 * Groessen = aktive Varianten mit WC_Variation_ID. Ohne L-Shop-Nr. auswaehlbar mit "noch zu besorgen" (Inhaber 07.11.).
 * @param {object} o
 * @param {Map<string,{stufe:string}>} o.lieferbarkeit  ArticleNr -> Stufe (BO7)
 * @param {Map<string,{url:string,status:string}>} o.bilder  WC_ID -> Bild/Status (Zwischenspeicher)
 */
export function katalogDauer({ sortiment, kategorien, maske, varianten, lieferbarkeit = new Map(), bilder = new Map() }) {
  const namen = sortimentNamen(sortiment, kategorien);
  // KS2: Filter nach Unterkategorie = Sortiment-Namen ohne die Wurzel(n) selbst
  const ids = new Set(t(sortiment).split(',').map(t).filter(Boolean));
  const wurzelNamen = new Set((kategorien ?? []).filter(k => ids.has(t(k.nr))).map(k => t(k.name)));
  const artikel = (maske ?? []).filter(a => t(a.status) === 'Veröffentlicht' && t(a.produktId)
    && t(a.kategorien).split(',').map(t).some(n => namen.has(n))
    && (!bilder.get(t(a.produktId))?.status || bilder.get(t(a.produktId)).status === 'publish'));
  const karten = [];
  for (const a of artikel) {
    const vs = (varianten ?? []).filter(v => t(v.ssotId) === t(a.id) && istJa(v.aktiv) && /^\d+$/.test(t(v.wcId)));
    const gruppen = new Map();
    for (const v of vs) {
      const x = achsen(v);
      const k = `${x.farbe}|${x.design}`;
      if (!gruppen.has(k)) gruppen.set(k, { farbe: x.farbe, design: x.design, groessen: [] });
      const nr = /^\d{10}$/.test(t(v.articleNr)) ? t(v.articleNr) : '';
      gruppen.get(k).groessen.push({
        groesse: x.groesse, id: t(v.wcId), articleNr: nr,
        lieferbar: nr ? (lieferbarkeit.get(nr)?.stufe ?? '') : '', nochZuBesorgen: !nr,
      });
    }
    for (const [k, g] of gruppen) {
      g.groessen.sort(groessenSort);
      // KS2-1: je Karte das erste EIGENE Variationsbild (anders als das Hauptbild), sonst das Hauptbild. Vorher zaehlte schon
      // das Hauptbild an der ersten Groesse (Variation ohne eigenes Bild bekommt in WooCommerce das Hauptbild) - Befund Babybody 07.11.
      const haupt = bilder.get(t(a.produktId))?.url || '';
      const eigene = g.groessen.map(x => bilder.get(x.id)?.url).filter(Boolean);
      const bild = eigene.find(u => u !== haupt) || haupt || eigene[0] || '';
      const gruppen = t(a.kategorien).split(',').map(t).filter(n => namen.has(n) && !wurzelNamen.has(n));
      karten.push(artikelFuerSeite({
        key: `${t(a.produktId)}|${k}`, name: t(a.name), farbe: g.farbe, design: g.design, bild, groessen: g.groessen, gruppen,
      }));
    }
  }
  return karten.sort((x, y) => x.name.localeCompare(y.name, 'de') || x.farbe.localeCompare(y.farbe, 'de'));
}

// ── Katalog: Art auftrag (Gruppen Modell + Farbe des Auftrags) ───────────────

/**
 * @param {object} o
 * @param {object} o.auftrag     Auftragszeile
 * @param {object[]} o.positionen aktive Positionen des Auftrags
 * @param {Map<string,{modell,farbe,groesse,bestellbar,lieferbar?}>} o.info  ArticleNr -> L-Shop-Info (lshopInfo)
 * @param {Map<string,{articleNr,groesse,lieferbar?}[]>} o.groessenJe  "modell|farbe" -> waehlbare Groessen des Modells in der Farbe
 */
export function katalogAuftrag({ auftrag, positionen, info = new Map(), groessenJe = new Map(), auswahl = [] }) {
  // KS6: Ist am Zugang eine Auswahl gesetzt, zeigt die Seite NUR diese (ohne Mengen, getrennt von den Positionen - sonst zaehlten
  // die "Angebots"-Positionen beim Uebernehmen doppelt). Ohne Auswahl wie KS1 aus den Positionen (Uebergang).
  if ((auswahl ?? []).length) {
    const karten = [];
    for (const a of auswahl) {
      for (const farbe of a.farben) {
        const gr = (groessenJe.get(`${a.modell}|${farbe}`) ?? []);
        if (!gr.length) continue;   // Farbe inzwischen nicht mehr waehlbar -> keine leere Karte
        karten.push({ name: a.name || a.motiv || t(auftrag?.Kurztitel) || 'Artikel', farbe, motiv: a.motiv, groessen: gr });
      }
    }
    return karten.map((k, i) => artikelFuerSeite({
      key: `g${i + 1}`, name: k.name, farbe: k.farbe, motiv: k.motiv, bild: '',
      groessen: k.groessen.map(x => ({ groesse: x.groesse, id: x.articleNr, articleNr: x.articleNr, lieferbar: x.lieferbar?.stufe ?? x.lieferbar ?? '', nochZuBesorgen: false })).sort(groessenSort),
    }));
  }
  const gruppen = new Map();
  for (const p of positionen ?? []) {
    if (t(p.Art) === 'lshop') {
      const i = info.get(t(p.LShop_ArticleNr));
      if (!i) continue;
      const k = `${i.modell}|${i.farbe}`;
      if (!gruppen.has(k)) gruppen.set(k, { key: k, modell: i.modell, farbe: i.farbe, motiv: '', frei: false });
      const g = gruppen.get(k);
      if (!g.motiv && t(p.Motiv)) g.motiv = t(p.Motiv);
    } else {
      const k = `frei|${t(p.Freitext)}`;
      if (!t(p.Freitext) || gruppen.has(k)) continue;
      gruppen.set(k, { key: k, name: t(p.Freitext), farbe: '', motiv: t(p.Motiv), frei: true });
    }
  }
  // Schluessel ohne Modellnummer (Lieferant): laufende Nummer der Gruppe im Auftrag.
  return [...gruppen.values()].map((g, i) => artikelFuerSeite({
    key: `g${i + 1}`,
    // Name: Motiv bzw. Kurztitel des Auftrags - nie die L-Shop-Bezeichnung oder Marke (Lieferant).
    name: g.frei ? g.name : (g.motiv || t(auftrag?.Kurztitel) || 'Artikel'),
    farbe: g.farbe, motiv: g.motiv, bild: '',
    groessen: g.frei ? [] : (groessenJe.get(g.key) ?? []).map(x => ({
      groesse: x.groesse, id: x.articleNr, articleNr: x.articleNr, lieferbar: x.lieferbar?.stufe ?? x.lieferbar ?? '', nochZuBesorgen: false,
    })).sort(groessenSort),
  }));
}

// ── Feste Feldauswahl fuer die Seite ─────────────────────────────────────────

const BILD_OK = /^https:\/\/[^\s"'<>]+$/;
/** Genau diese Felder gehen an die Seite - nie Preis, EK, L-Shop-Name, Marke, Lieferant. */
export function artikelFuerSeite(a) {
  const groessen = (a.groessen ?? []).map(g => ({
    groesse: t(g.groesse), id: t(g.id), articleNr: t(g.articleNr), lieferbar: t(g.lieferbar), nochZuBesorgen: g.nochZuBesorgen === true,
  }));
  const bild = BILD_OK.test(t(a.bild)) ? t(a.bild) : '';
  return {
    key: t(a.key), name: t(a.name), farbe: t(a.farbe), ...(t(a.design) ? { design: t(a.design) } : {}),
    ...(t(a.motiv) ? { motiv: t(a.motiv) } : {}),
    // KS2: kleines Vorschaubild (ca. 60 px angezeigt) und ein groesseres zum Antippen
    bild: bild ? bildGroesse(bild, BILD_KLEIN) : '', bildGross: bild ? bildGroesse(bild, BILD_GROSS) : '',
    gruppen: [...new Set((a.gruppen ?? []).map(t).filter(Boolean))],
    groessen, nochZuBesorgen: groessen.some(g => g.nochZuBesorgen),
  };
}

/** Antwort GET /api/bestellseite/zugang - feste Auswahl, ohne IDs von Kunde/Partner/Auftrag-Interna. */
export function seitenAntwort({ zugang, termine, artikel, trikots = [], designLink = '', katalogStand = '', anzahlJe = new Map(), jetzt }) {
  const tage = zugangTage(zugang);
  const auftragArt = zugang.Art === ART.AUFTRAG;
  const karten = (artikel ?? []).map(artikelFuerSeite);
  const zaehl = new Map();
  for (const a of karten) for (const g of a.gruppen) zaehl.set(g, (zaehl.get(g) ?? 0) + 1);
  const heute = jetzt ? heuteBerlin(jetzt) : '';
  return {
    art: zugang.Art, hinweis: t(zugang.Hinweis), ablauf: t(zugang.Ablauf), heute,
    regel: { bestellschlussTage: tage.bestellschlussTage, empfohlenTage: tage.empfohlenTage },
    // KS6: Art auftrag - Titel, festes "bestellen bis", Schalter; der Fanshop (dauer) bekommt diese Felder nicht
    ...(auftragArt ? {
      titel: t(zugang.Titel), bestellenBis: DATUM.test(t(zugang.Bestellschluss_Datum)) ? t(zugang.Bestellschluss_Datum) : '',
      personalisierung: t(zugang.Personalisierung) === 'ja', abschliessen: t(zugang.Abschliessen) === 'ja',
      abgeschlossen: istAbgeschlossen(zugang) ? t(zugang.Abgeschlossen) : '',
    } : {}),
    termine: (termine ?? []).map(x => {
      const f = terminFristen(x, zugang);
      return { id: t(x.Termin_ID), datum: t(x.Datum), notiz: t(x.Notiz), ...f, status: t(x.Status), eintraege: anzahlJe.get(t(x.Termin_ID)) ?? 0,
        vergangen: !!(heute && t(x.Datum) && t(x.Datum) < heute), nachSchluss: !!(heute && f.bestellschluss && heute > f.bestellschluss) };
    }).sort((a, b) => (a.datum || '9').localeCompare(b.datum || '9')),
    artikel: karten,
    // KS2: Filter nach Unterkategorie (Name, Anzahl Karten), meiste zuerst
    filter: [...zaehl].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([name, anzahl]) => ({ name, anzahl })),
    trikots: (trikots ?? []).map(x => ({ produktId: t(x.produktId), name: t(x.name), bild: BILD_OK.test(t(x.bild)) ? t(x.bild) : '', groessen: (x.groessen ?? []).map(t) })),
    ...(designLink && /^https:\/\//.test(designLink) ? { designLink } : {}),
    katalogStand: t(katalogStand),
    termineAnlegen: zugang.Art === ART.DAUER,
    ...(t(zugang.Entwurf_Ordner) ? { entwuerfe: true } : {}),   // KS7: nur ja/nein, nie die Ordner-ID
    eintragen: true,   // KS2
  };
}

/** Zugang fuer MC-Liste: ohne Token_Hash und ohne verschluesselten Wert (LK1: nur `kopierbar`), mit Status. */
export function zugangFuerMc(z, jetzt, termine = []) {
  const { Token_Hash: _h, Token_Verschluesselt: _tv, Vorgang: _v, _zeile, ...rest } = z;
  const hatLink = /^[0-9a-f]{64}$/.test(t(z.Token_Hash));
  return { ...rest, status: zugangStatus(z, jetzt), hatLink, kopierbar: hatLink && t(z.Token_Verschluesselt) !== '',
    ...(z.Art === ART.AUFTRAG ? { auswahl: auswahlLesen(z), abgeschlossen: istAbgeschlossen(z) } : {}),   // KS6
    termine: termine.filter(x => x.Zugang_ID === z.Zugang_ID).map(({ _zeile: _, ...x }) => x) };
}
