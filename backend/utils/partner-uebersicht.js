// Partner-Dashboard Stufe 1 (PD1): fertige Zahlen fuer die Startseite der Portale - nur STUECK, keine Betraege je Monat,
// keine Bestellnummern, keine Kundendaten. Reine Logik ohne Netz; Lizenz- und Festpreis-Portal nutzen dieselbe Funktion.
//
// Zaehlregeln (bericht-PD1 Messung 0):
// - Jede Verkaufszeile des Partners zaehlt mit ihrer Stueckzahl, egal ob offen, gesperrt ("in Prüfung") oder abgerechnet.
// - Storno-Gegenbuchungen und Teilerstattungen ("Erstattung #…") tragen eine NEGATIVE Stueckzahl und heben den Verkauf auf
//   bzw. mindern ihn; Versanderstattungen ("Versanderstattung #…") haben Stueckzahl 0. Porto (PO1) steht nicht in eigenen Zeilen.
// - Monat = Monat der BESTELLUNG: Gegenbuchungen tragen das Erstattungsdatum (sync-logic.js), sie werden dem fruehesten
//   Datum einer Verkaufszeile derselben Bestellung zugeordnet - sonst stuende ein Storno vom November als Minus im November.
// - Vorjahr nur ab dem ersten Monat mit Daten des Partners; davor "keine Daten" (null), nicht 0.

import { parseDeZahl } from './zahl-de.js';

export const UEBERSICHT_MS = 10 * 60 * 1000;   // Zwischenspeicher je Partner
export const TOP_ANZAHL = 5;
const t = v => String(v ?? '').trim();

/** TT.MM.JJJJ oder JJJJ-MM-TT -> { jahr, monat 0-11 } | null */
export function jahrMonat(s) {
  const x = t(s);
  let m = x.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return gueltig(+m[3], +m[2] - 1);
  m = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? gueltig(+m[1], +m[2] - 1) : null;
}
const gueltig = (jahr, monat) => (monat >= 0 && monat <= 11 && jahr > 2000 ? { jahr, monat } : null);
const vor = (a, b) => a.jahr < b.jahr || (a.jahr === b.jahr && a.monat < b.monat);
const zahl = v => { const n = parseDeZahl(t(v)); return Number.isFinite(n) ? n : 0; };
const rund = n => Math.round(n * 100) / 100;

/**
 * @param {object} e
 * @param {string[]} e.header  Kopfzeile des Verkaufsreiters
 * @param {any[][]} e.rows     Zeilen (alle Partner)
 * @param {string} e.partnerId
 * @param {{ order: string, artikel: string, status: string, storno: string }} e.spalten  Spaltennamen je Portal
 * @param {string} e.heute     JJJJ-MM-TT (Europe/Berlin)
 */
export function verkaufsUebersicht({ header, rows, partnerId, spalten, heute }) {
  const h = n => header.indexOf(n);
  const iP = h('Partner-ID'), iD = h('Datum'), iQ = h('Stückzahl');
  const iO = h(spalten.order), iA = h(spalten.artikel), iS = h(spalten.status), iSt = h(spalten.storno);
  const jetzt = jahrMonat(heute);
  const J = jetzt.jahr, M = jetzt.monat;
  const eigene = rows.filter(r => t(r[iP]) === partnerId);

  const monatVon = monatDerBestellung(eigene, { iO, iD, iSt });

  const jahr = Array(12).fill(0), vorjahr = Array(12).fill(0);
  const jeArtikel = new Map();
  let erstes = null;
  const stand = { offen: 0, inPruefung: 0 };
  for (const r of eigene) {
    const q = zahl(r[iQ]);
    const status = t(r[iS]);
    if (status === 'offen') stand.offen += q;
    else if (status === 'gesperrt') stand.inPruefung += q;
    const d = monatVon(r);
    if (!d) continue;
    if (!erstes || vor(d, erstes)) erstes = d;
    if (d.jahr === J && d.monat <= M) {
      jahr[d.monat] += q;
      const name = iA === -1 ? '' : t(r[iA]);
      if (name) jeArtikel.set(name, (jeArtikel.get(name) ?? 0) + q);
    } else if (d.jahr === J - 1) vorjahr[d.monat] += q;
  }

  // Zukunft und Monate vor dem ersten Datenmonat: null (keine Linie), nie 0.
  const reiheJahr = jahr.map((v, m) => (m <= M ? Math.max(0, rund(v)) : null));
  const reiheVorjahr = vorjahr.map((v, m) => (erstes && !vor({ jahr: J - 1, monat: m }, erstes) ? Math.max(0, rund(v)) : null));
  const vorjahrDaten = reiheVorjahr.some(v => v !== null);
  const stueckJahr = rund(reiheJahr.slice(0, M + 1).reduce((s, v) => s + (v ?? 0), 0));
  // Vergleich nur, wenn das Vorjahr den ganzen Zeitraum Januar..aktueller Monat abdeckt (sonst irrefuehrend).
  const vjBis = reiheVorjahr.slice(0, M + 1);
  const stueckVorjahr = vjBis.every(v => v !== null) ? rund(vjBis.reduce((s, v) => s + v, 0)) : null;
  const top = [...jeArtikel].map(([name, stueck]) => ({ name, stueck: rund(stueck) })).filter(x => x.stueck > 0)
    .sort((a, b) => b.stueck - a.stueck || a.name.localeCompare(b.name, 'de')).slice(0, TOP_ANZAHL);

  return {
    jahr: J, monat: M,
    reihe: { jahr: reiheJahr, vorjahr: reiheVorjahr },
    vorjahrDaten,
    vorjahrAb: vorjahrDaten ? reiheVorjahr.findIndex(v => v !== null) : null,   // erster Vorjahresmonat mit Daten (0-11)
    stueckJahr, stueckVorjahr,
    top5: top,
    stand: { offen: Math.max(0, rund(stand.offen)), inPruefung: Math.max(0, rund(stand.inPruefung)) },
    ohneVerkaeufe: eigene.length === 0,
  };
}

/** Monat der Bestellung = fruehestes Datum einer Verkaufszeile (ohne Storno-Marke) derselben Bestellung; sonst eigenes Datum. */
function monatDerBestellung(eigene, { iO, iD, iSt }) {
  const bestellMonat = new Map();
  for (const r of eigene) {
    if (iSt !== -1 && t(r[iSt])) continue;
    const o = iO === -1 ? '' : t(r[iO]);
    const d = jahrMonat(r[iD]);
    if (!o || !d) continue;
    const alt = bestellMonat.get(o);
    if (!alt || vor(d, alt)) bestellMonat.set(o, d);
  }
  return r => (iO !== -1 && bestellMonat.get(t(r[iO]))) || jahrMonat(r[iD]);
}

// ── PD2: Detailansicht (Schalter je Partner, Spalte hinten im Partner-Reiter) ──
export const DETAIL_SPALTE = 'Detailansicht';
export const TOP_DETAIL = 10;
/** Schalter an? Nur "ja" (Gross/Klein egal); leer/fehlt = aus. */
export function detailAn(header, zeile) {
  const i = (header ?? []).indexOf(DETAIL_SPALTE);
  return i !== -1 && t(zeile?.[i]).toLowerCase() === 'ja';
}

/**
 * Festpreis-Partner: Umsatz und Erloes je Monat (laufendes Jahr + Vorjahr), Summen, Top 10 - in BRUTTO (x MwSt wie die Auszahlung).
 * Umsatz = VK-Netto (WooCommerce line_item.total: nach Rabatt/Gutschein, ohne Steuer, ohne Porto).
 * Erloes (Inhaber 21.11., Variante A) = was dem Partner je Artikel bleibt: VK-Netto − (Festpreis + Handlingskosten) × Stueck − Mehrkosten;
 *   Porto, PayPal und Verpackung bleiben in der Abrechnung. Festpreis/Handling sind Stueckpreise (nur das Vorzeichen wechselt bei
 *   Gegenbuchungen) - deshalb Betrag × Stueckzahl wie utils/fp-abrechnung.js. Stornos/Teilerstattungen: negative Zeilen mindern.
 * Monat und "keine Daten" wie verkaufsUebersicht (dieselbe Zuordnung). Gesperrte Zeilen (Festpreis leer) zaehlen nur im Umsatz.
 */
export function fpBetragsUebersicht({ header, rows, partnerId, heute, mwstProzent }) {
  const h = n => header.indexOf(n);
  const iP = h('Partner-ID'), iD = h('Datum'), iQ = h('Stückzahl'), iA = h('Artikelname'), iSt = h('Storno-Status'), iO = h('WC-Bestellnummer');
  const iVk = h('VK-Netto'), iF = h('Festpreis'), iH = h('Handlingskosten'), iM = h('Mehrkosten');
  const { jahr: J, monat: M } = jahrMonat(heute);
  const satz = 100 + (Number(mwstProzent) || 0);   // brutto in Cent: netto × (100 + MwSt) - vermeidet 16,065 -> 16,06
  const eigene = rows.filter(r => t(r[iP]) === partnerId);
  const monatVon = monatDerBestellung(eigene, { iO, iD, iSt });
  const reihe = () => ({ jahr: Array(12).fill(0), vorjahr: Array(12).fill(0) });
  const umsatz = reihe(), erloes = reihe();
  const jeArtikel = new Map();
  let erstes = null;
  for (const r of eigene) {
    const d = monatVon(r);
    if (!d) continue;
    if (!erstes || vor(d, erstes)) erstes = d;
    const q = zahl(r[iQ]);
    const vk = iVk === -1 ? 0 : zahl(r[iVk]);
    const ohnePreis = iF === -1 || t(r[iF]) === '';
    const er = ohnePreis ? 0 : vk - (Math.abs(zahl(r[iF])) + Math.abs(iH === -1 ? 0 : zahl(r[iH]))) * q - (iM === -1 ? 0 : zahl(r[iM]));
    const ziel = d.jahr === J && d.monat <= M ? 'jahr' : d.jahr === J - 1 ? 'vorjahr' : null;
    if (!ziel) continue;
    umsatz[ziel][d.monat] += vk;
    erloes[ziel][d.monat] += er;
    if (ziel === 'jahr') {
      const name = iA === -1 ? '' : t(r[iA]);
      if (!name) continue;
      const a = jeArtikel.get(name) ?? { stueck: 0, umsatz: 0, erloes: 0 };
      a.stueck += q; a.umsatz += vk; a.erloes += er;
      jeArtikel.set(name, a);
    }
  }
  const b = n => Math.round(n * satz + (n >= 0 ? 1e-9 : -1e-9)) / 100;   // brutto, kaufmaennisch auf Cent
  const ohneDaten = (m, jahr) => !erstes || vor({ jahr, monat: m }, erstes);   // vor dem ersten Datenmonat
  const fertig = x => ({
    jahr: x.jahr.map((v, m) => (m <= M ? b(v) : null)),
    vorjahr: x.vorjahr.map((v, m) => (ohneDaten(m, J - 1) ? null : b(v))),
  });
  const u = fertig(umsatz), e = fertig(erloes);
  const summe = (a, bis) => rund(a.slice(0, bis + 1).reduce((s, v) => s + (v ?? 0), 0));
  const vjGanz = arr => arr.slice(0, M + 1).every(v => v !== null);
  return {
    reihe: { umsatz: u, erloes: e },
    umsatzJahr: summe(u.jahr, M), erloesJahr: summe(e.jahr, M),
    umsatzVorjahr: vjGanz(u.vorjahr) ? summe(u.vorjahr, M) : null,
    erloesVorjahr: vjGanz(e.vorjahr) ? summe(e.vorjahr, M) : null,
    top10: [...jeArtikel].map(([name, a]) => ({ name, stueck: rund(a.stueck), umsatz: b(a.umsatz), erloes: b(a.erloes) }))
      .filter(x => x.stueck > 0).sort((x, y) => y.stueck - x.stueck || x.name.localeCompare(y.name, 'de')).slice(0, TOP_DETAIL),
  };
}

/**
 * Antwort der Route /uebersicht - FESTE Feldauswahl (FIX4): nur, was die Startseite zeigt.
 * auszahlung: { saldo, seit, saldoKachel, intern, internOhneBetrag }
 */
export function uebersichtAntwort({ auszahlung, statistik, detail = null }) {
  const a = auszahlung ?? {};
  const kopie = r => ({ jahr: [...r.jahr], vorjahr: [...r.vorjahr] });
  return {
    // PD2: Betragsfelder NUR bei eingeschalteter Detailansicht - sonst gibt es den Schluessel gar nicht.
    ...(detail ? { detail: {
      reihe: { umsatz: kopie(detail.reihe.umsatz), erloes: kopie(detail.reihe.erloes) },
      umsatzJahr: detail.umsatzJahr, erloesJahr: detail.erloesJahr, umsatzVorjahr: detail.umsatzVorjahr, erloesVorjahr: detail.erloesVorjahr,
      top10: detail.top10.map(x => ({ name: x.name, stueck: x.stueck, umsatz: x.umsatz, erloes: x.erloes })),
    } } : {}),
    auszahlung: {
      saldo: Number(a.saldo) || 0,
      seit: t(a.seit),
      saldoKachel: a.saldoKachel !== false,
      intern: Number(a.intern) || 0,
      internOhneBetrag: Number(a.internOhneBetrag) || 0,
      inPruefung: a.inPruefung === true,
    },
    stand: { ...statistik.stand },
    jahr: statistik.jahr, monat: statistik.monat,
    reihe: { jahr: [...statistik.reihe.jahr], vorjahr: [...statistik.reihe.vorjahr] },
    vorjahrDaten: statistik.vorjahrDaten, vorjahrAb: statistik.vorjahrAb,
    stueckJahr: statistik.stueckJahr, stueckVorjahr: statistik.stueckVorjahr,
    top5: statistik.top5.map(x => ({ name: x.name, stueck: x.stueck })),
    ohneVerkaeufe: statistik.ohneVerkaeufe,
  };
}

/** Zwischenspeicher je Schluessel (Portal + Shop + Partner), 10 min. */
export function bauZwischenspeicher(ms = UEBERSICHT_MS, uhr = () => Date.now()) {
  const m = new Map();
  return {
    async hole(schluessel, laden) {
      const e = m.get(schluessel);
      if (e && e.bis > uhr()) return e.wert;
      const wert = await laden();
      m.set(schluessel, { bis: uhr() + ms, wert });
      if (m.size > 500) m.delete(m.keys().next().value);
      return wert;
    },
    leeren() { m.clear(); },
  };
}
