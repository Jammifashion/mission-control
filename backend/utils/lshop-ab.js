// Auftragsbestaetigung (AB-XML) auswerten (BO4i) - reine Logik, keine Zugriffe. Ein-/Ausgabe in lib/lshopAb.js,
// Aufruf aus dem Beleg-Abruf (lib/lshopBelege.js) und scripts/ab-auswerten.js.
//
// Aufbau (gemessen 28.10. an den AB zu JFN-2026-0003/0004, UTF-8 ohne BOM; dekodiere kann auch UTF-16):
//   OrderConfirmation/Header: IhreBestellung (= unsere order_id), Vorgang (VA), Belegnummer (AB-Nr), Belegdatum,
//     Bestelldatum, Lieferdatum (TT.MM.JJJJ), Kommission, Versand ...
//   OrderConfirmation/Items/Item: Artikelnummer, Menge, Liefertermin (TT.MM.JJJJ), PositionFreiText (= unsere
//     reference), Artikelbezeichung. Versandkosten = Artikelnummer 9900000001 "Versandkosten Paketdienst", ohne
//     PositionFreiText -> wird erkannt und ignoriert.
// ⚠️ Adressen, Preise (EPreis/GPreis/PayTerms), Kundennummer stehen in der Datei: hier wird keins davon gelesen.
//
// Liefertermin: L-Shop schreibt bei "sofort" das Belegdatum (gemessen: einen Tag VOR dem Bestelldatum). Spaeter =
// Liefertermin NACH dem Bestelldatum der AB (Inhaber 28.10.).

export const AB_VERSAND_ARTIKEL = '9900000001';
// Spalten, die BO4i hinten anhaengt (scripts/setup-lshop-ab-spalten.js). Nur ueber den Namen gelesen.
export const AB_EDI_SPALTEN = ['AB_Nr', 'AB_VA', 'AB_Datum', 'AB_Eingang', 'AB_Hinweis'];
export const AB_KORB_SPALTEN = ['Liefertermin', 'AB_Hinweis'];
export const EDI_BESTAETIGT = 'bestätigt';

// Abweichungsarten. rot = Menge gekuerzt / fehlt / unbekannt, gelb = Menge mehr / Termin spaeter.
export const ABWEICHUNG = {
  GEKUERZT: { id: 'gekuerzt', stufe: 'rot', text: 'Menge gekürzt' },
  MEHR: { id: 'mehr', stufe: 'gelb', text: 'Menge mehr' },
  SPAETER: { id: 'spaeter', stufe: 'gelb', text: 'Termin später' },
  FEHLT: { id: 'fehlt', stufe: 'rot', text: 'fehlt in AB' },
  UNBEKANNT: { id: 'unbekannt', stufe: 'rot', text: 'unbekannte AB-Zeile' },
};

const t = v => String(v ?? '').trim();
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const entschluesseln = s => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENT[n])
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const feld = (xml, name) => t(entschluesseln((new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml) ?? [])[1]));

/** TT.MM.JJJJ -> JJJJ-MM-TT ('' bei leer/unbekannt). */
export function isoDatum(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t(s));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
/** JJJJ-MM-TT -> TT.MM.JJJJ */
export const deDatum = iso => (/^(\d{4})-(\d{2})-(\d{2})$/.test(t(iso)) ? iso.split('-').reverse().join('.') : t(iso));

export class AbFormatFehler extends Error {
  constructor(message) { super(message); this.name = 'AbFormatFehler'; }
}

/**
 * AB-XML lesen. -> { orderId, va, abNr, belegdatum, bestelldatum, items: [{ nr, artikel, menge, termin, reference }], versandZeilen }
 * Datum als JJJJ-MM-TT. Liest nie Adressen, Preise, Kundennummer.
 */
export function leseAb(text) {
  const x = String(text ?? '');
  if (!/<OrderConfirmation[\s>]/.test(x)) throw new AbFormatFehler('kein OrderConfirmation');
  const kopf = (/<Header>([\s\S]*?)<\/Header>/.exec(x) ?? [])[1];
  if (kopf === undefined) throw new AbFormatFehler('Header fehlt');
  const items = [];
  let versandZeilen = 0;
  for (const m of x.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const it = m[1];
    const artikel = feld(it, 'Artikelnummer');
    if (artikel === AB_VERSAND_ARTIKEL || /^Versandkosten/i.test(feld(it, 'Artikelbezeichung'))) { versandZeilen++; continue; }
    const mengeText = feld(it, 'Menge');
    const menge = /^\d+$/.test(mengeText) ? Number(mengeText) : NaN;
    if (!/^\d{10}$/.test(artikel) || !Number.isInteger(menge)) throw new AbFormatFehler(`Position ${items.length + 1} unlesbar (Artikelnummer/Menge)`);
    items.push({ nr: items.length + 1, artikel, menge, termin: isoDatum(feld(it, 'Liefertermin')), reference: feld(it, 'PositionFreiText') });
  }
  return {
    orderId: feld(kopf, 'IhreBestellung'), va: feld(kopf, 'Vorgang'), abNr: feld(kopf, 'Belegnummer'),
    belegdatum: isoDatum(feld(kopf, 'Belegdatum')), bestelldatum: isoDatum(feld(kopf, 'Bestelldatum')),
    items, versandZeilen,
  };
}

/**
 * AB gegen die Korb-Positionen der Bestellung (Bestell_ID = order_id).
 * Zuordnung: reference + Artikelnummer; mehrere gleiche -> in Reihenfolge der Datei (= unsere item-Folge).
 * -> { positionen: [{ schluessel, zeile, liefertermin, hinweis, stufe, abweichungen: [id] }], unbekannt: [{ nr, artikel, reference, menge }],
 *      zaehler: { id: n }, abweichungen }
 */
export function abAbgleich({ ab, korbZeilen, referenz }) {
  const korb = (korbZeilen ?? []).filter(z => t(z.Bestell_ID) === t(ab.orderId));
  const frei = [...korb];
  const zaehler = {};
  const zaehle = a => { zaehler[a.id] = (zaehler[a.id] ?? 0) + 1; };
  const positionen = [];
  const unbekannt = [];
  for (const it of ab.items) {
    const i = frei.findIndex(z => t(referenz(z)) === it.reference && t(z.LShop_ArticleNr) === it.artikel);
    if (i < 0) { unbekannt.push({ nr: it.nr, artikel: it.artikel, reference: it.reference, menge: it.menge }); zaehle(ABWEICHUNG.UNBEKANNT); continue; }
    const [z] = frei.splice(i, 1);
    const korbMenge = Number(z.Menge) || 0;
    const abw = [];
    const texte = [];
    if (it.menge < korbMenge) { abw.push(ABWEICHUNG.GEKUERZT); texte.push(`Menge ${it.menge} statt ${korbMenge}`); }
    if (it.menge > korbMenge) { abw.push(ABWEICHUNG.MEHR); texte.push(`Menge ${it.menge} statt ${korbMenge}`); }
    const spaeter = it.termin && ab.bestelldatum && it.termin > ab.bestelldatum;
    if (spaeter) { abw.push(ABWEICHUNG.SPAETER); texte.push(`Termin ${deDatum(it.termin)}`); }
    abw.forEach(zaehle);
    positionen.push({
      schluessel: z.Schluessel, zeile: z._zeile, liefertermin: spaeter ? it.termin : '', hinweis: texte.join(' · '),
      stufe: abw.some(a => a.stufe === 'rot') ? 'rot' : abw.length ? 'gelb' : '', abweichungen: abw.map(a => a.id),
    });
  }
  for (const z of frei) {
    zaehle(ABWEICHUNG.FEHLT);
    positionen.push({ schluessel: z.Schluessel, zeile: z._zeile, liefertermin: '', hinweis: ABWEICHUNG.FEHLT.text, stufe: 'rot', abweichungen: [ABWEICHUNG.FEHLT.id] });
  }
  return { positionen, unbekannt, zaehler, abweichungen: Object.values(zaehler).reduce((n, k) => n + k, 0) };
}

/** Stufe eines gespeicherten Korb-Hinweises fuer die Anzeige: rot (gekuerzt, fehlt), gelb (mehr, Termin), '' */
export function abStufe(hinweis) {
  const h = t(hinweis);
  if (!h) return '';
  const m = /Menge (\d+) statt (\d+)/.exec(h);
  if (h.includes(ABWEICHUNG.FEHLT.text) || (m && Number(m[1]) < Number(m[2]))) return 'rot';
  return 'gelb';
}

/** Kurztext fuer EDI AB_Hinweis und Chat: "ok" oder "2 Abweichungen: 1× Menge gekürzt, 1× Termin später". */
export function abKurz(abgleich) {
  if (!abgleich.abweichungen) return 'ok';
  const teile = Object.values(ABWEICHUNG).filter(a => abgleich.zaehler[a.id]).map(a => `${abgleich.zaehler[a.id]}× ${a.text}`);
  return `${abgleich.abweichungen} Abweichung${abgleich.abweichungen === 1 ? '' : 'en'}: ${teile.join(', ')}`;
}

/** Status der EDI-Zeile nach der AB: nur gesendet -> bestaetigt; versandt/geliefert/bestaetigt bleiben. */
export const ediStatusNachAb = alt => (t(alt) === 'gesendet' ? EDI_BESTAETIGT : t(alt));

/**
 * Chat nur bei Abweichung, geaenderter oder zweiter AB. Ohne Preise.
 * @param {{ orderId, datei, abgleich, korbRef: Map<schluessel, reference>, anlass?: 'geaendert'|'zweite'|'' }} o
 */
export function buildAbNachricht({ orderId, abNr, abgleich, referenzen = new Map(), anlass = '' }) {
  const kopf = anlass === 'geaendert' ? `📄 L-Shop-AB ${orderId} geändert (${abNr})`
    : anlass === 'zweite' ? `📄 L-Shop: weitere AB zu ${orderId} (${abNr})`
      : `⚠️ L-Shop-AB ${orderId} (${abNr})`;
  const zeilen = [kopf, abKurz(abgleich)];
  for (const p of abgleich.positionen.filter(p => p.hinweis)) zeilen.push(`• ${referenzen.get(p.schluessel) || p.schluessel}: ${p.hinweis}`);
  for (const u of abgleich.unbekannt) zeilen.push(`• unbekannt: ${u.reference || '(ohne Referenz)'} · ${u.artikel} × ${u.menge}`);
  return zeilen.join('\n');
}
