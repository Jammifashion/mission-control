// DB1: Dashboard "Was muss ich tun?" - reine Logik (Zaehlregeln), ohne Netz. Lesen/Schreiben: lib/dashboard.js.
// Tage = Kalendertage Europe/Berlin. WooCommerce date_created ist Ortszeit des Shops (Berlin) ohne Zone -> Tag = die
// ersten 10 Zeichen; Werte mit Zone (z. B. "Angelegt" der Auftraege, ISO mit Z) werden nach Berlin umgerechnet.

import { createHash } from 'crypto';
import { matchItem } from './trikot-logic.js';
import { faelligStufe, aufgabeOffen } from './aufgaben.js';
import { terminBald, istOffen } from './auftraege.js';

export const TAB_GELESEN = 'Hinweis_Gelesen';
export const KOPF_GELESEN = ['Shop', 'Bestellnummer', 'Pruefsumme', 'Gelesen_Von', 'Gelesen_Am'];
export const LANGE_AB_TAGE = 7;          // > 7 Kalendertage = "wartet lange" (7 = noch nicht)
export const ROT_AB_TAGE = 14;           // > 14 = rot
export const TRIKOT_LANGE_TAGE = 42;     // Trikot-Bestellung > 42 Tage offen = "über 6 Wochen"
export const NEU_STUNDEN = 24;
export const WARTEND_TOP = 5;
export const WER = ['Christian', 'Nicole'];
export const SHOPS = ['jfn', 'honk'];
const SHOP_KURZ = { jfn: 'JFN', honk: 'HONK' };
// Auftrag "wartet" (Kunde wartet auf Ware/Produktion) nur vor "fertig"; danach wartet MC auf Abholung/Zahlung.
export const AU_WARTET = ['Anfrage', 'Angebot', 'Design', 'bestellt', 'in Produktion'];
export const AU_STATUS_ZAHLEN = ['Anfrage', 'Angebot', 'Design', 'bestellt', 'in Produktion'];
const SHOP_OFFEN = ['processing', 'on-hold'];
const ZAEHLT_NICHT = new Set(['cancelled', 'refunded', 'failed', 'trash', 'checkout-draft']);

const t = v => String(v ?? '').trim();

/** Tag JJJJ-MM-TT in Europe/Berlin. */
export function tagBerlin(wert) {
  if (wert instanceof Date) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(wert);
  const s = t(wert);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) return s.slice(0, 10);   // Shop-Ortszeit
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : tagBerlin(d);
}
const tagNr = tag => Date.UTC(+tag.slice(0, 4), +tag.slice(5, 7) - 1, +tag.slice(8, 10)) / 864e5;
/** Kalendertage (Berlin) zwischen wert und jetzt; unbekannt -> null. */
export function alterTage(wert, jetzt) {
  const a = tagBerlin(wert), h = tagBerlin(jetzt);
  return a && h ? tagNr(h) - tagNr(a) : null;
}
/** Shop-Zeitpunkt ohne Zone (Berlin) -> ms (fuer "letzte 24 h"); mit Zone direkt. */
export function zeitMs(wert) {
  const s = t(wert);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const roh = Date.parse(`${s}Z`);   // als UTC lesen, dann um den Berliner Versatz dieses Moments verschieben
    return roh - berlinVersatzMin(new Date(roh)) * 60000;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}
function berlinVersatzMin(d) {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).map(p => [p.type, p.value]));
  const alsUtc = Date.UTC(+teile.year, +teile.month - 1, +teile.day, +teile.hour, +teile.minute);
  return Math.round((alsUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Pruefsumme der Kundennotiz (nur sie wird gespeichert, nie der Text). Leer -> ''. */
export function pruefsumme(text) {
  const s = t(text).replace(/\r\n/g, '\n');
  return s ? createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16) : '';
}

// ── Versandart: 1:1 wie psVersandArt in frontend/index.html (BS2); Test vergleicht beide ──
const PS_ABHOLUNG = { stadion: { icon: '🏟', text: 'Abholung Stadion' }, wrist: { icon: '📍', text: 'Abholung Wrist' }, sammel: { icon: '📍', text: 'Abholung Sammelbestellung' } };
const PS_JFN_INSTANZ = { 'local_pickup/6': 'stadion', 'local_pickup/3': 'wrist', 'local_pickup/5': 'sammel' };
export function versandArt(o, shop = 'jfn') {
  const lines = o?.shipping_lines ?? [];
  if (!lines.length) return { art: 'ohne', icon: '', text: 'ohne Versandart' };
  const abhol = lines.find(l => /^(local_pickup|pickup_location)/.test(String(l.method_id ?? ''))
    || (!/^(flat_rate|free_shipping)$/.test(String(l.method_id ?? '')) && /abhol/i.test(String(l.method_title ?? ''))));
  if (abhol) {
    const titel = String(abhol.method_title ?? '').trim();
    const key = shop === 'honk' ? '' : PS_JFN_INSTANZ[`${abhol.method_id}/${abhol.instance_id ?? ''}`];
    const nachTitel = /stadion/i.test(titel) ? 'stadion' : /wrist|vor ort/i.test(titel) ? 'wrist' : /sammel/i.test(titel) ? 'sammel' : '';
    const fest = PS_ABHOLUNG[key || nachTitel];
    return { art: 'abholung', ...(fest ?? { icon: '📍', text: titel || 'Abholung' }) };
  }
  return { art: 'versand', icon: '', text: 'Versand' };
}

/**
 * Trikot-Bestellung (Inhaber 06.11.): JEDE JFN-Bestellung mit mindestens einer Trikot-Position, auch wenn weitere Artikel
 * drin sind. Trikot-Position = Produkt-ID oder SKU in "Trikot_Artikel" (aktiv), dieselbe Regel wie der Trikot-Sync
 * (matchItem); zusaetzlich jede Order-ID, die im Reiter "Trikots" steht (auch wenn der Artikel inzwischen inaktiv ist).
 */
export function istTrikotBestellung(o, shop, artikel, trikotOrderIds = new Set()) {
  if (shop !== 'jfn') return false;
  if (trikotOrderIds.has(String(o?.id))) return true;
  return !!artikel && (o?.line_items ?? []).some(li => matchItem(li, artikel) !== null);
}

/** WooCommerce-Bestellung -> Anzeige (ohne Adresse, Mail, Telefon). */
export function shopBestellung(o, shop, { artikel, trikotOrderIds } = {}) {
  return {
    art: 'shop', shop, shopKurz: SHOP_KURZ[shop], id: o.id, nr: t(o.number) || String(o.id), status: t(o.status),
    datum: t(o.date_created), betrag: Number.parseFloat(o.total) || 0, waehrung: t(o.currency) || 'EUR',
    kunde: [o.billing?.first_name, o.billing?.last_name].map(t).filter(Boolean).join(' '),
    hinweis: t(o.customer_note), versand: versandArt(o, shop),
    trikot: istTrikotBestellung(o, shop, artikel, trikotOrderIds),
  };
}

const gelesenKey = (shop, nr) => `${shop}:${nr}`;
/** Zeilen aus Hinweis_Gelesen -> Map shop:nr -> Set(Pruefsummen). */
export function gelesenAus(werte) {
  const [kopf = [], ...zeilen] = werte ?? [];
  const i = Object.fromEntries(KOPF_GELESEN.map(k => [k, kopf.indexOf(k)]));
  const m = new Map();
  if (KOPF_GELESEN.some(k => i[k] < 0)) return m;
  for (const z of zeilen) {
    const key = gelesenKey(t(z[i.Shop]).toLowerCase(), t(z[i.Bestellnummer]));
    if (!m.has(key)) m.set(key, new Set());
    m.get(key).add(t(z[i.Pruefsumme]));
  }
  return m;
}
export const istGelesen = (gelesen, b) => !!gelesen?.get(gelesenKey(b.shop, b.nr))?.has(pruefsumme(b.hinweis));

/** Zeile fuer Hinweis_Gelesen (nur IDs + Pruefsumme, kein Text, keine Kundendaten). */
export function gelesenZeile({ shop, nr, pruef, wer, jetzt }) {
  return [SHOP_KURZ[shop] ?? t(shop).toUpperCase(), t(nr), t(pruef), WER.includes(wer) ? wer.slice(0, 1) : '', jetzt.toISOString()];
}

const zust = (x, wer) => !wer || t(x.Zustaendig) === wer;

/**
 * Alles fuer das Dashboard. Fehlt eine Quelle (fehler[quelle]), ist jede Kachel, die sie braucht, null + `fehlt`.
 * @param {object} p
 * @param {Object<string,{offen:object[],neu:object[],woche:object[]}>} p.shops  normalisierte Bestellungen je Shop
 * @param {{auftraege,aufgaben,todos}|null} p.au
 */
export function baueDashboard({ shops = {}, au = null, kunden = new Map(), rueckstand = null, trikots = null, gelesen = new Map(), wer = '', jetzt = new Date(), fehler = {} }) {
  wer = WER.includes(wer) ? wer : '';
  const fehlt = quellen => quellen.filter(q => fehler[q]);
  const kachel = (quellen, fn) => { const f = fehlt(quellen); return f.length ? { fehlt: f } : fn(); };
  const SHOPQ = SHOPS.map(s => `shop_${s}`);
  const offenShop = SHOPS.flatMap(s => shops[s]?.offen ?? []).filter(b => SHOP_OFFEN.includes(b.status));
  const auftraege = (au?.auftraege ?? []).filter(a => zust(a, wer));
  const aufgaben = (au?.aufgaben ?? []).filter(g => zust(g, wer));
  const zustJe = new Map([...(au?.auftraege ?? []).map(a => [a.Auftrag_Nr, t(a.Zustaendig)]), ...(au?.aufgaben ?? []).map(g => [g.Aufgabe_Nr, t(g.Zustaendig)])]);
  const todos = (au?.todos ?? []).filter(d => t(d.Erledigt) !== 'ja' && (!wer || zustJe.get(t(d.Bezug)) === wer));
  const rsShop = rueckstand?.je?.shop ?? {}, rsAu = rueckstand?.je?.auftrag ?? {};

  // Wartend: Shop offen (ohne Trikot-Bestellungen) + Auftraege vor "fertig", Alter in Kalendertagen
  const wartend = [
    ...offenShop.filter(b => !b.trikot).map(b => ({
      art: 'shop', shop: b.shop, shopKurz: b.shopKurz, nr: b.nr, id: b.id, kunde: b.kunde, tage: alterTage(b.datum, jetzt),
      grund: [b.status === 'on-hold' ? 'Zahlung offen' : '', rsShop[`${b.shopKurz}:${b.nr}`] ? `L-Shop-Rückstand: ${rsShop[`${b.shopKurz}:${b.nr}`].status}` : '',
        b.versand?.art === 'abholung' ? b.versand.text : ''].filter(Boolean),
    })),
    ...auftraege.filter(a => AU_WARTET.includes(a.Status)).map(a => ({
      art: 'au', nr: a.Auftrag_Nr, titel: t(a.Kurztitel), kunde: kunden.get(a.Kunden_Nr) ?? t(a.Kunden_Nr), tage: alterTage(a.Angelegt, jetzt), status: a.Status,
      grund: [a.ware === 'bestellt' ? 'wartet auf Ware' : a.ware === 'offen' ? 'Ware noch nicht bestellt' : '',
        rsAu[a.Auftrag_Nr] ? `L-Shop-Rückstand: ${rsAu[a.Auftrag_Nr].status}` : '', a.Status].filter(Boolean),
    })),
  ].filter(x => x.tage !== null).sort((x, y) => y.tage - x.tage || String(x.nr).localeCompare(String(y.nr), 'de', { numeric: true }));
  const lang = wartend.filter(x => x.tage > LANGE_AB_TAGE);

  const hinweisListe = offenShop.filter(b => b.hinweis && !istGelesen(gelesen, b))
    .map(b => ({ shop: b.shop, shopKurz: b.shopKurz, nr: b.nr, id: b.id, kunde: b.kunde, text: b.hinweis, pruef: pruefsumme(b.hinweis), datum: b.datum }))
    .sort((x, y) => String(x.datum).localeCompare(String(y.datum)));

  const jetztMs = jetzt.getTime();
  const neu = [
    ...SHOPS.flatMap(s => shops[s]?.neu ?? []).filter(b => !ZAEHLT_NICHT.has(b.status)).map(b => ({
      art: 'shop', shop: b.shop, shopKurz: b.shopKurz, nr: b.nr, id: b.id, kunde: b.kunde, betrag: b.betrag, status: b.status,
      hinweis: !!b.hinweis, abholung: b.versand?.art === 'abholung', zeit: zeitMs(b.datum),
    })),
    ...(au?.auftraege ?? []).map(a => ({ art: 'au', nr: a.Auftrag_Nr, titel: t(a.Kurztitel), kunde: kunden.get(a.Kunden_Nr) ?? t(a.Kunden_Nr),
      betrag: (a.preise?.brutto ?? 0) / 100, status: a.Status, zeit: zeitMs(a.Angelegt) })),
    ...(au?.aufgaben ?? []).map(g => ({ art: 'ag', nr: g.Aufgabe_Nr, titel: t(g.Kurztitel), status: g.Status, zeit: zeitMs(g.Angelegt) })),
  ].filter(x => x.zeit !== null && x.zeit <= jetztMs + 60000 && jetztMs - x.zeit <= NEU_STUNDEN * 3600000).sort((x, y) => y.zeit - x.zeit);

  const auStatus = Object.fromEntries(AU_STATUS_ZAHLEN.map(s => [s, auftraege.filter(a => a.Status === s).length]));
  const fertigNichtBezahlt = auftraege.filter(a => ['fertig', 'übergeben'].includes(a.Status) && !t(a.Bezahlt_Am));
  const heuteTag = tagBerlin(jetzt);
  const woche = SHOPS.flatMap(s => shops[s]?.woche ?? []).filter(b => !ZAEHLT_NICHT.has(b.status));
  const tage7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.UTC(+heuteTag.slice(0, 4), +heuteTag.slice(5, 7) - 1, +heuteTag.slice(8, 10) - 6 + i)); return d.toISOString().slice(0, 10); });
  const proTag = tage7.map(tag => ({ tag, betrag: Math.round(woche.filter(b => tagBerlin(b.datum) === tag).reduce((s, b) => s + b.betrag, 0) * 100) / 100 }));
  const runde = x => Math.round(x * 100) / 100;

  return {
    stand: jetzt.toISOString(), wer, fehler: Object.keys(fehler).filter(k => fehler[k]),
    kacheln: {
      hinweise: kachel(SHOPQ, () => ({ zahl: hinweisListe.length, liste: hinweisListe })),
      lange: kachel([...SHOPQ, 'auftraege', 'trikot_artikel'], () => ({ zahl: lang.length, aeltester: lang[0]?.tage ?? null, rot: lang.some(x => x.tage > ROT_AB_TAGE), liste: lang })),
      todos: kachel(['auftraege'], () => {
        const st = todos.map(d => faelligStufe(d.Faellig, jetzt.toISOString()));
        return { ueberfaellig: st.filter(s => s === 'ueberfaellig').length, heute: st.filter(s => s === 'heute').length };
      }),
      rueckstand: kachel(['rueckstand'], () => ({ ...(rueckstand?.zahlen ?? { positionen: 0, stueck: 0, kritisch: 0 }), veraltet: !!rueckstand?.liste?.veraltet, liste: !!rueckstand?.liste })),
      ware: kachel(['auftraege'], () => ({ zahl: auftraege.filter(a => a.Status !== 'storniert' && a.Status !== 'bezahlt' && ['offen', 'bestellt'].includes(a.ware)).length })),
      abholung: kachel(SHOPQ, () => ({ zahl: offenShop.filter(b => b.versand?.art === 'abholung').length })),
      trikots: kachel(['trikots', 'shop_jfn', 'trikot_artikel'], () => ({
        nichtBeimProduzenten: trikots?.summen?.offen ?? 0, goalie: trikots?.summen?.goalieOffen ?? 0,
        ueber6Wochen: offenShop.filter(b => b.trikot && (alterTage(b.datum, jetzt) ?? 0) > TRIKOT_LANGE_TAGE).length,
      })),
    },
    neu: fehlt([...SHOPQ, 'auftraege']).length ? { fehlt: fehlt([...SHOPQ, 'auftraege']) } : neu,
    wartend: kachel([...SHOPQ, 'auftraege', 'trikot_artikel'], () => ({ liste: wartend.slice(0, WARTEND_TOP) })),
    auftraege: kachel(['auftraege'], () => ({
      ...auStatus, fertigNichtBezahlt: fertigNichtBezahlt.length,
      // aus der alten Aufträge-Kachel (AMQ1), damit nichts verloren geht
      offen: auftraege.filter(istOffen).length, terminBald: auftraege.filter(a => terminBald(a, jetzt.toISOString())).length,
      aufgabenOffen: aufgaben.filter(aufgabeOffen).length,
    })),
    geld: kachel([...SHOPQ, 'auftraege'], () => ({
      heute: proTag[6].betrag, sieben: runde(proTag.reduce((s, d) => s + d.betrag, 0)),
      offen: runde(offenShop.filter(b => b.status === 'on-hold').reduce((s, b) => s + b.betrag, 0) + fertigNichtBezahlt.reduce((s, a) => s + (a.preise?.brutto ?? 0) / 100, 0)),
      tage: proTag,
    })),
  };
}
