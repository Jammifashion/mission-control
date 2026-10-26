// L-Shop-EDI-Bestelldatei (BO4a): reine Logik, keine Zugriffe. Ein-/Ausgabe in lib/lshopEdi.js.
//
// Aufbau nach L-SHOP-TEAM EDI-XML-Import-Guideline 1.4.1, wie die Testdatei JFN-2026-0001
// (von L-Shop am 23.09.2026 fehlerfrei verarbeitet): order -> orderheader -> orderitems -> item.
// Wir liefern an uns selbst; die Adresse hinterlegt L-Shop. Adressbloecke gibt es hier deshalb
// gar nicht - auch nicht leer (Vorgabe L-Shop 24.09.). BO4a ERZEUGT nur, verschickt nichts:
// kein FTP/SFTP, kein Netz. Eine Zeile je Korb-Position, gleiche itemnumber darf mehrfach stehen.

import { STATUS, HERKUNFT, HINWEIS, hinweisSperrt } from './korb-logic.js';
import { normHeader } from './sheet-headers.js';
import { shopWert } from './shop-spalte.js';

// Protokoll und Zaehler der erzeugten Dateien (SSOT). Kopf legt scripts/setup-lshop-edi-reiter.js an.
export const EDI_TAB = 'LShop_EDI_Dateien';
export const EDI_SPALTEN = [
  'order_id', 'Erzeugt', 'Status', 'Positionen', 'Stueck', 'Commission', 'Dateiname', 'Korb_Schluessel', 'Notiz',
  'Versandart', 'Gesendet',   // BO4e, hinten angehaengt (scripts/setup-lshop-edi-reiter.js)
];
export const EDI_STATUS = { ENTWURF: 'Entwurf', GESENDET: 'gesendet', TESTDATEI: 'Testdatei' };
// Business-Sheet, Reiter Config: Debitorennummer bei L-Shop. Nie im Code, nie im Log.
export const CONFIG_CUSTOMER_ID = 'lshop.customer_id';
// BO4e: Vorgabe der Versandart (Code aus VERSANDARTEN); leer -> Standard.
export const CONFIG_SHIPPING = 'lshop.shipping_method';

// Versandarten laut Guideline 1.4.1 (Feld shipping_method, Pflicht, max. 15 Zeichen). In die Datei kommt
// NUR der Code; alles andere ist rot. Reihenfolge = Auswahl im Dialog (Express nach Dringlichkeit).
export const VERSANDARTEN = [
  { code: 'Standard', name: 'Standard laut L-Shop-Konto (bei uns GLS)' },
  { code: 'Abholung', name: 'Abholung im L-Shop-Lager' },
  { code: 'DHL', name: 'DHL' },
  { code: 'GLS', name: 'GLS' },
  { code: 'DPD', name: 'DPD' },
  { code: 'UPS', name: 'UPS' },
  { code: 'EX007', name: 'UPS Express: morgen bis 10:30' },
  { code: 'EX011', name: 'UPS Express: morgen bis 14:00' },
  { code: 'EX008', name: 'UPS Express: morgen bis Tagesende' },
  { code: 'EX009', name: 'UPS Express: Samstag bis 14:00' },
  { code: 'EX010', name: 'UPS Express EU: meist nächster Werktag' },
];
export const VERSANDART_STANDARD = 'Standard';
export const istVersandart = code => VERSANDARTEN.some(v => v.code === t(code));
export const istExpress = code => /^EX\d{3}$/.test(t(code));
// Express nur bei fehlerfreier Uebermittlung bis 13:30 Uhr (Berlin).
export const EXPRESS_SCHLUSS = { stunde: 13, minute: 30 };

/** Vorgabe aus Config: leer -> Standard; unbekannt -> Standard + Hinweis (nicht rot, sonst blockiert ein Tippfehler alles). */
export function versandartVorgabe(configWert) {
  const w = t(configWert);
  if (!w) return { code: VERSANDART_STANDARD, hinweis: '' };
  if (istVersandart(w)) return { code: w, hinweis: '' };
  return { code: VERSANDART_STANDARD, hinweis: `Config ${CONFIG_SHIPPING} = "${w.slice(0, 20)}" ist unbekannt - Standard vorbelegt.` };
}

export const EDI_KOPF_FEST = { partial_delivery: '-1', mail: 'info@jammifashion.de', printmode: '0' };
export const EDI_LAENGEN = { customer_id: 8, order_id: 30, commission: 30, reference: 65, quantity: 8, shipping_method: 15, mail: 65 };
export const BESTELLSCHLUSS_STUNDE = 14;   // Versand am selben Tag nur bis 14:00 (Berlin)
const ZONE = 'Europe/Berlin';
const PRAEFIX = 'JFN';

const t = v => String(v ?? '').trim();

// ── Datum (Europe/Berlin) ───────────────────────────────────────────────────

export function berlinTeile(jetzt = new Date()) {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(jetzt).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { jahr: teile.year, monat: teile.month, tag: teile.day, stunde: teile.hour, minute: teile.minute };
}

/**
 * TT.MM.JJJJ - order_date (= Tag des Erzeugens). delivery_date gibt es seit BO4e nicht mehr: laut
 * Guideline ist es das Warenausgangsdatum fuer eine VERSPAETETE Lieferung.
 */
export function ediDatum(jetzt = new Date()) {
  const b = berlinTeile(jetzt);
  return `${b.tag}.${b.monat}.${b.jahr}`;
}

/** ISO-Kalenderwoche des Berliner Kalendertags. */
export function kalenderwoche(jetzt = new Date()) {
  const b = berlinTeile(jetzt);
  const d = new Date(Date.UTC(+b.jahr, +b.monat - 1, +b.tag));
  const wt = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - wt);
  const jahrBeginn = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - jahrBeginn) / 864e5 + 1) / 7);
}

export const standardCommission = (jetzt = new Date()) => `${PRAEFIX} Sammelbestellung KW${kalenderwoche(jetzt)}`;

export const nachBestellschluss = (jetzt = new Date()) => Number(berlinTeile(jetzt).stunde) >= BESTELLSCHLUSS_STUNDE;

/** Ab 13:30 Uhr Berlin klappt Express nicht mehr zum zugesagten Termin. */
export function nachExpressSchluss(jetzt = new Date()) {
  const b = berlinTeile(jetzt);
  return Number(b.stunde) * 60 + Number(b.minute) >= EXPRESS_SCHLUSS.stunde * 60 + EXPRESS_SCHLUSS.minute;
}

/** <order_id>_<JJJJMMTT-HHMM>.xml, Zeit Europe/Berlin. */
export function ediDateiname(orderId, jetzt = new Date()) {
  const b = berlinTeile(jetzt);
  return `${orderId}_${b.jahr}${b.monat}${b.tag}-${b.stunde}${b.minute}.xml`;
}

// ── order_id ────────────────────────────────────────────────────────────────

export const platzhalterOrderId = jahr => `${PRAEFIX}-${jahr}-____`;

/**
 * Naechste freie order_id: hoechste vorhandene Nummer des Jahres + 1, vierstellig.
 * Nummern werden nie wiederverwendet, Luecken sind erlaubt; jedes Jahr beginnt bei 0001.
 */
export function naechsteOrderId(vorhandene, jahr) {
  const muster = new RegExp(`^${PRAEFIX}-${jahr}-(\\d{4})$`);
  const max = (vorhandene ?? []).reduce((m, id) => { const r = muster.exec(t(id)); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  if (max >= 9999) { const e = new Error(`order_id: Zaehler fuer ${jahr} erschoepft.`); e.status = 409; throw e; }
  return `${PRAEFIX}-${jahr}-${String(max + 1).padStart(4, '0')}`;
}

// ── Protokoll-Reiter ────────────────────────────────────────────────────────

export function ediSpalten(header) {
  const norm = (header ?? []).map(normHeader);
  const idx = {};
  const fehlt = [];
  for (const name of EDI_SPALTEN) {
    const i = norm.indexOf(normHeader(name));
    if (i < 0) fehlt.push(name); else idx[name] = i;
  }
  if (fehlt.length) { const e = new Error(`Reiter "${EDI_TAB}": Spalte(n) fehlen: ${fehlt.join(', ')}`); e.status = 422; throw e; }
  return idx;
}

// ── Pruefung ────────────────────────────────────────────────────────────────

// Reihenfolge = Anzeige im Pruefbericht. rot sperrt das Erzeugen, gelb warnt, info nur Hinweis.
export const EDI_REGELN = [
  { id: 'customer_id', stufe: 'rot',  titel: `Kundennummer (Config ${CONFIG_CUSTOMER_ID}) vorhanden, höchstens ${EDI_LAENGEN.customer_id} Zeichen` },
  { id: 'auswahl',     stufe: 'rot',  titel: 'mindestens eine Position gewählt, keine doppelt' },
  { id: 'vorhanden',   stufe: 'rot',  titel: 'Position im Korb vorhanden, unverändert und offen' },
  { id: 'shop',        stufe: 'rot',  titel: 'nur Shop JFN' },
  { id: 'hinweis',     stufe: 'rot',  titel: 'kein sperrender Hinweis (storniert, erstattet, abgeschlossen, nicht mehr im Shop, Position weg)' },
  { id: 'artikel',     stufe: 'rot',  titel: 'L-Shop-Artikelnummer 10-stellig, in LShop_Modelle, nicht ausgelaufen, Discontinued nicht 3/6' },
  { id: 'menge',       stufe: 'rot',  titel: `Menge ganzzahlig größer 0, höchstens ${EDI_LAENGEN.quantity} Stellen` },
  { id: 'reference',   stufe: 'rot',  titel: `Referenz vorhanden, höchstens ${EDI_LAENGEN.reference} Zeichen` },
  { id: 'commission',  stufe: 'rot',  titel: `Commission höchstens ${EDI_LAENGEN.commission} Zeichen, ohne @ und Zeilenumbruch` },
  { id: 'order_id',    stufe: 'rot',  titel: `order_id höchstens ${EDI_LAENGEN.order_id} Zeichen, nur ASCII` },
  { id: 'versandart',  stufe: 'rot',  titel: 'Versandart aus der Liste der Guideline' },
  { id: 'unbezahlt',   stufe: 'gelb', titel: 'Position noch nicht bezahlt' },
  { id: 'versandart_config', stufe: 'gelb', titel: `Vorgabe der Versandart (Config ${CONFIG_SHIPPING}) bekannt` },
  { id: 'express_spaet', stufe: 'gelb', titel: 'Express: nach 13:30 Uhr klappt der Termin nicht mehr, Zusatzkosten fallen trotzdem an' },
  { id: 'abholung',    stufe: 'gelb', titel: 'Abholung im L-Shop-Lager: die Ware wird nicht verschickt' },
  { id: 'express',     stufe: 'info', titel: 'Express: Datei muss bis 13:30 Uhr bei L-Shop sein, Zusatzkosten' },
  { id: 'bestellschluss', stufe: 'info', titel: `nach ${BESTELLSCHLUSS_STUNDE}:00 Uhr geht die Ware erst am nächsten Werktag raus` },
];

const STEUERZEICHEN = /[\u0000-\u001f\u007f]/;
const gesperrtDisc = v => { const n = Number(t(v).replace(',', '.')); return n === 3 || n === 6; };

/** Referenz je Position: Shop-Positionen <Shop>-<Bestellnummer>-<Position>, eigene ihre Referenz. */
export function referenzFuer(z) {
  if (t(z.Herkunft) === HERKUNFT.EIGEN) return t(z.Referenz);
  return `${shopWert(t(z.Shop) || 'jfn')}-${t(z.Bestellnummer)}-${t(z.Position)}`;
}

/**
 * Pruefbericht und Positionen der Datei.
 * @param {object} o
 * @param {{schluessel:string,status:string}[]} o.auswahl   was der Browser gesehen hat
 * @param {object[]} o.zeilen      korbZeilen(...).zeilen, frisch gelesen
 * @param {Map} o.modelle          ArticleNr -> Zeile aus ladeLShopZeilen
 * @param {string} o.customerId    aus Config
 * @param {string} o.commission
 * @param {string} o.orderId       vergeben oder Platzhalter
 * @param {string} o.versandart    Code aus VERSANDARTEN (BO4e)
 * @param {string} [o.versandartHinweis]  Hinweis zur Vorgabe aus Config (unbekannter Wert)
 * @param {Date} o.jetzt
 */
export function ediPruefung({ auswahl, zeilen, modelle, customerId, commission, orderId, versandart, versandartHinweis = '', jetzt = new Date() }) {
  const treffer = [];
  const melde = (regel, text, schluessel) => treffer.push({ regel, text, schluessel });

  const cid = t(customerId);
  if (!cid) melde('customer_id', `Wert fehlt - im Business-Sheet, Reiter Config, Schlüssel ${CONFIG_CUSTOMER_ID} eintragen.`);
  else if (cid.length > EDI_LAENGEN.customer_id || STEUERZEICHEN.test(cid)) melde('customer_id', `Wert ist länger als ${EDI_LAENGEN.customer_id} Zeichen oder enthält Steuerzeichen.`);

  const liste = Array.isArray(auswahl) ? auswahl : [];
  if (!liste.length) melde('auswahl', 'keine Position gewählt');
  const gesehen = new Set();
  const jeSchluessel = new Map((zeilen ?? []).map(z => [z.Schluessel, z]));
  const items = [];
  for (const a of liste) {
    const s = t(a?.schluessel);
    if (gesehen.has(s)) { melde('auswahl', 'doppelt gewählt', s); continue; }
    gesehen.add(s);
    const z = jeSchluessel.get(s);
    if (!z) { melde('vorhanden', 'nicht mehr im Korb', s); continue; }
    if (t(a.status) !== z.Status) { melde('vorhanden', `Status hat sich geändert (jetzt "${z.Status}") - neu laden`, s); continue; }
    if (z.Status !== STATUS.OFFEN) { melde('vorhanden', `Status "${z.Status}", nur offen ist bestellbar`, s); continue; }
    // Streng: leere Zelle = JFN (wie im Korb), jeder andere Wert ausser JFN ist rot.
    if ((t(z.Shop) || 'JFN').toUpperCase() !== 'JFN') melde('shop', `Shop "${z.Shop}"`, s);
    if (hinweisSperrt(z.Hinweis)) melde('hinweis', z.Hinweis, s);
    if (t(z.Hinweis).split(' · ').includes(HINWEIS.UNBEZAHLT)) melde('unbezahlt', HINWEIS.UNBEZAHLT, s);

    const nr = t(z.LShop_ArticleNr);
    const m = modelle?.get(nr);
    if (!/^\d{10}$/.test(nr)) melde('artikel', `"${nr}" ist nicht 10-stellig`, s);
    else if (!m) melde('artikel', `${nr} nicht in LShop_Modelle`, s);
    else if (t(m.status) === 'ausgelaufen') melde('artikel', `${nr} ist ausgelaufen`, s);
    else if (gesperrtDisc(m.discontinued)) melde('artikel', `${nr} hat Discontinued ${t(m.discontinued)} - nie bestellen`, s);

    const menge = t(z.Menge);
    if (!/^[1-9]\d*$/.test(menge) || menge.length > EDI_LAENGEN.quantity) melde('menge', `Menge "${menge}"`, s);

    const reference = referenzFuer(z);
    if (!reference) melde('reference', 'Referenz leer', s);
    else if (reference.length > EDI_LAENGEN.reference || STEUERZEICHEN.test(reference)) melde('reference', `Referenz ${reference.length} Zeichen (höchstens ${EDI_LAENGEN.reference})`, s);

    items.push({
      schluessel: s, itemnumber: nr, reference, quantity: menge,
      modell: t(m?.catalogNr), farbe: [t(m?.color1), t(m?.color2)].filter(Boolean).join('/'), groesse: t(m?.size),
    });
  }

  const com = String(commission ?? '');
  if (com.length > EDI_LAENGEN.commission) melde('commission', `${com.length} Zeichen`);
  if (com.includes('@') || STEUERZEICHEN.test(com)) melde('commission', 'enthält @ oder einen Zeilenumbruch');

  const oid = t(orderId);
  if (!oid || oid.length > EDI_LAENGEN.order_id || !/^[\x20-\x7e]+$/.test(oid)) melde('order_id', `"${oid}"`);

  const va = t(versandart);
  if (!istVersandart(va)) melde('versandart', `"${va.slice(0, 20)}" ist keine erlaubte Versandart`);
  if (versandartHinweis) melde('versandart_config', versandartHinweis);
  const uhr = `${berlinTeile(jetzt).stunde}:${berlinTeile(jetzt).minute} Uhr`;
  if (istExpress(va) && istVersandart(va)) {
    if (nachExpressSchluss(jetzt)) melde('express_spaet', `jetzt ${uhr}`);
    else melde('express', 'bis 13:30 Uhr fehlerfrei übermitteln');
  }
  if (va === 'Abholung') melde('abholung', 'bitte selbst im L-Shop-Lager abholen');

  if (nachBestellschluss(jetzt)) melde('bestellschluss', `jetzt ${uhr}`);

  const punkte = EDI_REGELN.map(r => {
    const f = treffer.filter(x => x.regel === r.id);
    return { regel: r.id, stufe: r.stufe, titel: r.titel, ok: !f.length, treffer: f.map(({ text, schluessel }) => ({ text, schluessel })) };
  });
  const gruen = punkte.every(p => p.ok || p.stufe !== 'rot');
  return { gruen, punkte, items, stueck: items.reduce((n, i) => n + (Number(i.quantity) || 0), 0) };
}

// ── XML ─────────────────────────────────────────────────────────────────────

const EINFACH = /^[A-Za-z0-9 ._@+-]*$/;
/** Text ohne Sonderzeichen bleibt roh, sonst CDATA ("]]>" wird sicher geteilt). */
export function xmlText(v) {
  const s = String(v ?? '');
  if (STEUERZEICHEN.test(s)) { const e = new Error('XML: Steuerzeichen im Text.'); e.status = 422; throw e; }
  return EINFACH.test(s) ? s : cdata(s);
}

/**
 * Immer CDATA (BO4e) - fuer die Textfelder order_id, commission, reference, mail, wie im Beispiel der
 * Guideline ("Textfelder, die Sonderzeichen enthalten koennten, muessen zwingend in CDATA"). "]]>" wird geteilt.
 */
export function cdata(v) {
  const s = String(v ?? '');
  if (STEUERZEICHEN.test(s)) { const e = new Error('XML: Steuerzeichen im Text.'); e.status = 422; throw e; }
  return `<![CDATA[${s.split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

function zahl(feld, v, muster) {
  const s = t(v);
  if (!muster.test(s)) { const e = new Error(`XML: ${feld} "${s}" ungültig.`); e.status = 422; throw e; }
  return s;
}

/**
 * Bestell-XML als Zeichenkette (UTF-8, erste Zeile die XML-Deklaration).
 * kopf: { customer_id, order_date, order_id, commission, shipping_method }
 * items: [{ itemnumber, reference, quantity }]
 * BO4e: Textfelder order_id/commission/reference/mail immer in CDATA; kein delivery_date (siehe ediDatum);
 * shipping_method nur ein Code aus VERSANDARTEN, ohne CDATA wie im Beispiel der Guideline.
 */
export function baueBestellXml({ kopf, items }) {
  const z = [];
  const feld = (ebene, name, inhalt) => z.push(`${'  '.repeat(ebene)}<${name}>${inhalt}</${name}>`);
  if (!istVersandart(kopf.shipping_method)) { const e = new Error(`XML: shipping_method "${t(kopf.shipping_method)}" ungültig.`); e.status = 422; throw e; }
  z.push('<?xml version="1.0" encoding="UTF-8"?>');
  z.push('<order>');
  z.push('  <orderheader>');
  feld(2, 'customer_id', xmlText(kopf.customer_id));
  feld(2, 'order_date', zahl('order_date', kopf.order_date, /^\d{2}\.\d{2}\.\d{4}$/));
  feld(2, 'order_id', cdata(kopf.order_id));
  if (t(kopf.commission)) feld(2, 'commission', cdata(kopf.commission));
  // additional_information bleibt weg: Text darin prueft L-Shop von Hand (verzoegert den Versand).
  feld(2, 'shipping_method', t(kopf.shipping_method));
  feld(2, 'partial_delivery', EDI_KOPF_FEST.partial_delivery);
  feld(2, 'mail', cdata(EDI_KOPF_FEST.mail));
  feld(2, 'printmode', EDI_KOPF_FEST.printmode);
  z.push('  </orderheader>');
  z.push('  <orderitems>');
  for (const i of items ?? []) {
    z.push('    <item>');
    feld(3, 'itemnumber', zahl('itemnumber', i.itemnumber, /^\d{10}$/));
    if (t(i.reference)) feld(3, 'reference', cdata(i.reference));
    feld(3, 'quantity', zahl('quantity', i.quantity, /^[1-9]\d{0,7}$/));
    z.push('    </item>');
  }
  z.push('  </orderitems>');
  z.push('</order>');
  return `${z.join('\n')}\n`;
}

// ── Strenger Rueckleser (nur unser Aufbau) ─────────────────────────────────
// Kein allgemeiner XML-Parser (keine neue Abhaengigkeit, antwort-BO4a-2 Frage 5): liest genau
// Deklaration, Elemente ohne Attribute, Text und CDATA. Alles andere ist ein Fehler. Der Browser
// prueft vor dem Download zusaetzlich mit DOMParser.

export function leseBestellXml(xml) {
  const s = String(xml ?? '');
  const DEKL = '<?xml version="1.0" encoding="UTF-8"?>';
  if (!s.startsWith(`${DEKL}\n`)) throw new Error('XML: erste Zeile ist nicht die Deklaration.');
  let i = DEKL.length;
  const leer = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const fehlerBei = text => new Error(`XML: ${text} (Zeichen ${i}).`);
  function element() {
    const m = /^<([A-Za-z_][A-Za-z0-9_]*)>/.exec(s.slice(i));
    if (!m) throw fehlerBei('Start-Tag erwartet');
    const name = m[1];
    i += m[0].length;
    const kinder = [];
    let text = '';
    for (;;) {
      if (s.startsWith('</', i)) {
        const e = /^<\/([A-Za-z_][A-Za-z0-9_]*)>/.exec(s.slice(i));
        if (!e || e[1] !== name) throw fehlerBei(`End-Tag </${name}> erwartet`);
        i += e[0].length;
        if (kinder.length && text.trim()) throw fehlerBei(`gemischter Inhalt in <${name}>`);
        return { name, kinder, text: kinder.length ? '' : text };
      }
      if (s.startsWith('<![CDATA[', i)) {
        const ende = s.indexOf(']]>', i + 9);
        if (ende < 0) throw fehlerBei('CDATA nicht geschlossen');
        text += s.slice(i + 9, ende);
        i = ende + 3;
        continue;
      }
      if (s[i] === '<') { kinder.push(element()); continue; }
      if (i >= s.length) throw fehlerBei(`<${name}> nicht geschlossen`);
      if (s[i] === '&' || s[i] === '>') throw fehlerBei('unmaskiertes Zeichen');
      text += s[i++];
    }
  }
  leer();
  const wurzel = element();
  leer();
  if (i !== s.length) throw fehlerBei('Inhalt nach dem Wurzelelement');
  return wurzel;
}

/** Aufbau gegen die Vorgabe pruefen (fuer Server und Tests). Gibt Fehlertexte zurueck, leer = ok. */
export function pruefeBestellXml(xml) {
  let w;
  try { w = leseBestellXml(xml); } catch (e) { return [e.message]; }
  const f = [];
  const namen = el => el.kinder.map(k => k.name);
  if (w.name !== 'order') f.push('Wurzel ist nicht <order>');
  if (namen(w).join() !== 'orderheader,orderitems') f.push(`<order> enthält ${namen(w).join(', ')} statt orderheader, orderitems`);
  if (/shippingaddress|senderaddress/i.test(String(xml))) f.push('Adressblock enthalten');
  const kopf = w.kinder.find(k => k.name === 'orderheader');
  const pflicht = ['customer_id', 'order_id', 'shipping_method', 'partial_delivery', 'printmode'];
  for (const p of pflicht) if (!kopf?.kinder.some(k => k.name === p && t(k.text))) f.push(`Pflichtfeld ${p} fehlt`);
  if (kopf?.kinder.some(k => k.name === 'delivery_date')) f.push('delivery_date enthalten (seit BO4e weggelassen)');
  const sm = kopf?.kinder.find(k => k.name === 'shipping_method');
  if (sm && t(sm.text) && !istVersandart(sm.text)) f.push(`shipping_method "${t(sm.text)}" nicht erlaubt`);
  const items = w.kinder.find(k => k.name === 'orderitems')?.kinder ?? [];
  if (!items.length) f.push('keine Position');
  items.forEach((it, n) => {
    if (it.name !== 'item') f.push(`Position ${n + 1}: <${it.name}> statt <item>`);
    const wert = name => it.kinder.find(k => k.name === name)?.text ?? '';
    if (!/^\d{10}$/.test(wert('itemnumber'))) f.push(`Position ${n + 1}: itemnumber ungültig`);
    if (!/^[1-9]\d{0,7}$/.test(wert('quantity'))) f.push(`Position ${n + 1}: quantity ungültig`);
  });
  return f;
}

// ── "Als gesendet markieren" (BO4e, Bruecke bis BO4c) ───────────────────────

/**
 * Plan fuer EINEN Schreibaufruf: EDI-Zeile Entwurf -> gesendet (+ Gesendet), jede Korb-Position der Datei
 * offen -> bestellt mit Bestell_ID, Status_Datum, Stand. Wirft (nichts geschrieben), wenn die Datei kein
 * Entwurf ist oder eine Position fehlt bzw. nicht mehr offen ist (fehler.probleme = Liste).
 * @param {object} o
 * @param {string[][]} o.ediWerte   LShop_EDI_Dateien inkl. Kopf, frisch gelesen
 * @param {object} o.korbIdx        korbZeilen(...).idx
 * @param {object[]} o.korbZeilen   korbZeilen(...).zeilen (mit _zeile)
 * @param {string} o.orderId
 * @param {string} o.jetzt          ISO
 * -> { ediZeile, korb: [{ zeile, schluessel, werte }], edi: { Status, Gesendet } }
 */
export function gesendetPlan({ ediWerte, korbZeilen: zeilen, orderId, jetzt }) {
  const fehl = (msg, status, probleme) => { const e = new Error(msg); e.status = status; if (probleme) e.probleme = probleme; return e; };
  const [kopf = [], ...rest] = ediWerte ?? [];
  const idx = ediSpalten(kopf);
  const id = t(orderId);
  const treffer = rest.map((r, i) => ({ r, zeile: i + 2 })).filter(({ r }) => t(r[idx.order_id]) === id);
  if (!treffer.length) throw fehl(`${id || '(leer)'} steht nicht in ${EDI_TAB}.`, 404);
  if (treffer.length > 1) throw fehl(`${id} steht mehrfach in ${EDI_TAB} - bitte von Hand prüfen, nichts geändert.`, 409);
  const { r, zeile: ediZeile } = treffer[0];
  const status = t(r[idx.Status]);
  if (status !== EDI_STATUS.ENTWURF) throw fehl(`${id} ist "${status}", nur Entwürfe lassen sich als gesendet markieren - nichts geändert.`, 409);
  const schluessel = t(r[idx.Korb_Schluessel]).split(/\s+/).filter(Boolean);
  if (!schluessel.length) throw fehl(`${id} hat keine Korb-Positionen - nichts geändert.`, 422);

  const jeSchluessel = new Map((zeilen ?? []).map(z => [z.Schluessel, z]));
  const probleme = [];
  const korb = [];
  for (const s of new Set(schluessel)) {
    const z = jeSchluessel.get(s);
    if (!z) { probleme.push({ schluessel: s, text: 'nicht mehr im Korb' }); continue; }
    if (z.Status !== STATUS.OFFEN) { probleme.push({ schluessel: s, text: `Status "${z.Status}" statt offen` }); continue; }
    korb.push({ zeile: z._zeile, schluessel: s, werte: { Status: STATUS.BESTELLT, Bestell_ID: id, Status_Datum: jetzt, Stand: jetzt } });
  }
  if (probleme.length) throw fehl(`${probleme.length} Position(en) nicht offen oder nicht mehr im Korb - nichts geändert.`, 422, probleme);
  return { ediZeile, ediIdx: idx, edi: { Status: EDI_STATUS.GESENDET, Gesendet: jetzt }, korb };
}

/** Entwuerfe fuer die Anzeige: offen = mind. eine Position noch offen; sonst ueberholt (kein Knopf). */
export function entwuerfeAus(ediWerte, korbZeilen) {
  if (!ediWerte?.length) return [];
  const [kopf, ...rest] = ediWerte;
  const norm = kopf.map(normHeader);
  const sp = n => norm.indexOf(normHeader(n));
  const w = (r, n) => (sp(n) < 0 ? '' : t(r[sp(n)]));
  const jeSchluessel = new Map((korbZeilen ?? []).map(z => [z.Schluessel, z]));
  return rest.filter(r => w(r, 'Status') === EDI_STATUS.ENTWURF && w(r, 'order_id')).map(r => {
    const schluessel = w(r, 'Korb_Schluessel').split(/\s+/).filter(Boolean);
    const offen = schluessel.filter(s => jeSchluessel.get(s)?.Status === STATUS.OFFEN).length;
    return {
      orderId: w(r, 'order_id'), erzeugt: w(r, 'Erzeugt'), positionen: Number(w(r, 'Positionen')) || schluessel.length,
      stueck: Number(w(r, 'Stueck')) || 0, commission: w(r, 'Commission'), versandart: w(r, 'Versandart') || VERSANDART_STANDARD,
      dateiname: w(r, 'Dateiname'), offen, ueberholt: offen < schluessel.length, ganzUeberholt: offen === 0,
    };
  }).sort((a, b) => b.orderId.localeCompare(a.orderId));
}
