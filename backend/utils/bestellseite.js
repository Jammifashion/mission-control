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
export const ZUGANG_OPTIONAL = ['Design_Link_Zeigen', 'Vorgang'];
export const ZUGANG_ALLE = [...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL];
export const TERMIN_SPALTEN = ['Termin_ID', 'Zugang_ID', 'Datum', 'Notiz', 'Bestellschluss', 'Auftrag_Nr', 'Status', 'Angelegt', 'Stand'];
// Nur angelegt (KS1), beschrieben erst in KS2. Wie bericht-KS0 2, "Spieltag" -> Termin_ID.
export const EINTRAG_SPALTEN = [
  'Eintrag_ID', 'Zugang_ID', 'Termin_ID', 'Gegner_Notiz', 'Kuerzel', 'Art', 'WC_Variation_ID', 'LShop_ArticleNr', 'Freitext', 'Menge',
  'Fuer', 'Trikot_Name', 'Trikot_Nummer', 'Wunsch', 'Zeit', 'Nach_Schluss', 'Status', 'Auftrag_Nr', 'Position_ID', 'Stand',
];
// Zwischenspeicher Bilder (Knopf "Artikelliste aktualisieren"): je Produkt bzw. Variation eine Zeile.
export const BILD_SPALTEN = ['WC_ID', 'Art', 'Bild_URL', 'Status', 'Stand'];

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
  let termin = null;
  if (art === ART.AUFTRAG) {
    const datum = DATUM.test(t(auftrag.Termin)) ? t(auftrag.Termin) : '';
    termin = {
      Termin_ID: naechsteTerminId(termine), Zugang_ID: zugang.Zugang_ID, Datum: datum, Notiz: '',
      Bestellschluss: fristen(datum, tage).bestellschluss, Auftrag_Nr: auftragNr, Status: TERMIN_STATUS_OFFEN, Angelegt: heute, Stand: stand,
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
  neu.Stand = new Date(jetzt).toISOString();
  return neu;
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
      const bild = g.groessen.map(x => bilder.get(x.id)?.url).find(Boolean) || bilder.get(t(a.produktId))?.url || '';
      karten.push(artikelFuerSeite({
        key: `${t(a.produktId)}|${k}`, name: t(a.name), farbe: g.farbe, design: g.design, bild, groessen: g.groessen,
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
export function katalogAuftrag({ auftrag, positionen, info = new Map(), groessenJe = new Map() }) {
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
  return {
    key: t(a.key), name: t(a.name), farbe: t(a.farbe), ...(t(a.design) ? { design: t(a.design) } : {}),
    ...(t(a.motiv) ? { motiv: t(a.motiv) } : {}), bild: BILD_OK.test(t(a.bild)) ? t(a.bild) : '',
    groessen, nochZuBesorgen: groessen.some(g => g.nochZuBesorgen),
  };
}

/** Antwort GET /api/bestellseite/zugang - feste Auswahl, ohne IDs von Kunde/Partner/Auftrag-Interna. */
export function seitenAntwort({ zugang, termine, artikel, designLink = '', katalogStand = '' }) {
  const tage = zugangTage(zugang);
  return {
    art: zugang.Art, hinweis: t(zugang.Hinweis), ablauf: t(zugang.Ablauf),
    regel: { bestellschlussTage: tage.bestellschlussTage, empfohlenTage: tage.empfohlenTage },
    termine: (termine ?? []).map(x => ({ id: t(x.Termin_ID), datum: t(x.Datum), notiz: t(x.Notiz), ...fristen(x.Datum, tage), status: t(x.Status) }))
      .sort((a, b) => (a.datum || '9').localeCompare(b.datum || '9')),
    artikel: (artikel ?? []).map(artikelFuerSeite),
    ...(designLink && /^https:\/\//.test(designLink) ? { designLink } : {}),
    katalogStand: t(katalogStand),
    eintragen: false,   // KS2
  };
}

/** Zugang fuer MC-Liste: ohne Token_Hash, mit Status. */
export function zugangFuerMc(z, jetzt, termine = []) {
  const { Token_Hash: _h, Vorgang: _v, _zeile, ...rest } = z;
  return { ...rest, status: zugangStatus(z, jetzt), hatLink: /^[0-9a-f]{64}$/.test(t(z.Token_Hash)),
    termine: termine.filter(x => x.Zugang_ID === z.Zugang_ID).map(({ _zeile: _, ...x }) => x) };
}
