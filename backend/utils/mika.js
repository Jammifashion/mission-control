// MI1: Assistent "Mika" Stufe 0 - drei feste Fragen OHNE KI. Reine Logik (kein Netz): Antworten aus festen Regeln,
// nur aus Daten, die MC ohnehin laedt (Dashboard, Auftraege/Aufgaben/To-dos, L-Shop-Bestellungen, Bestellansicht).
// Laden: lib/mika.js, Route: routes/mika.js. Tage = Kalendertage Europe/Berlin.
//
// Antwort { frage, titel, gruppen: [{ id, titel, eintraege: [{ text, zusatz, ziel }], mehr, mehrZiel }], leer, vorlesen, treffer }
//  - ziel: feste Auswahl (ZIEL_ARTEN) - der Browser ruft damit die vorhandenen Sprungfunktionen, nie einen Link/HTML.
//  - Bezeichnungen wie in den Listen: Nummer + Kurztitel. Nie Kundennamen (die Dashboard-Daten tragen `kunde` - hier nie benutzt).
//  - vorlesen: Saetze OHNE Nummern und Namen (wie DB2 - es kann jemand mithoeren).

import { alterTage, tagBerlin, ROT_AB_TAGE, WER } from './dashboard.js';
import { faelligStufe, aufgabeOffen } from './aufgaben.js';
import { istOffen } from './auftraege.js';

export const FRAGEN = ['heute', 'dringend', 'suche'];
export const JE_GRUPPE = 5;                 // hoechstens 5 je Gruppe, dann "… und n weitere"
export const TERMIN_DRINGEND_TAGE = 3;      // "dringend": Termin in <= 3 Kalendertagen (heute + ueberschritten eingeschlossen)
export const BESTELLUNG_DRINGEND_TAGE = ROT_AB_TAGE;   // > 14 Tage offen (Regel wie UB1 "über 14 Tage")
export const ZIEL_ARTEN = ['shop', 'au', 'ag', 'lshop', 'liste'];
// Listen, in die "… und n weitere" bzw. eine Zahl aus "Zu tun" springt (Browser: mikaSpringe)
export const LISTEN = ['hinweise', 'lange', 'todos-ueberfaellig', 'todos-heute', 'ware', 'abholung', 'bestellseiten', 'trikots', 'rueckstand',
  'au-termin', 'au-fertig', 'aufgaben', 'lshop-bestellungen'];
export const FEHLER_TEXT = 'Mika findet gerade nichts – bitte die Liste direkt öffnen.';
const TEXT_MAX = 70;

const t = v => String(v ?? '').trim();
const kurz = (s, max = TEXT_MAX) => { const x = t(s).replace(/\s+/g, ' '); return x.length > max ? `${x.slice(0, max - 1)}…` : x; };
const tagNr = tag => Date.UTC(+tag.slice(0, 4), +tag.slice(5, 7) - 1, +tag.slice(8, 10)) / 864e5;
/** Abstand in Kalendertagen von heute (Berlin) bis zum Tag JJJJ-MM-TT (negativ = vorbei); ungueltig -> null. */
export function tageBis(tag, jetzt) {
  const z = t(tag);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(z)) return null;
  return tagNr(z) - tagNr(tagBerlin(jetzt));
}
const zahlWort = (n, eins, mehr) => (n === 1 ? eins : `${n} ${mehr}`);
const gross = s => s.charAt(0).toUpperCase() + s.slice(1);
const zust = (x, wer) => !wer || t(x.Zustaendig) === wer;

/** "heute", "morgen", "in 3 Tagen", "seit 2 Tagen überschritten" */
export function terminText(tage) {
  if (tage === 0) return 'Termin heute';
  if (tage === 1) return 'Termin morgen';
  if (tage > 1) return `Termin in ${tage} Tagen`;
  return tage === -1 ? 'Termin seit gestern überschritten' : `Termin seit ${-tage} Tagen überschritten`;
}
function faelligText(tage) {
  if (tage === 0) return 'heute fällig';
  return tage === -1 ? 'seit gestern überfällig' : `seit ${-tage} Tagen überfällig`;
}

/** Gruppe mit hoechstens JE_GRUPPE Eintraegen; leere Gruppen fallen weg. */
function gruppe(id, titel, alle, mehrZiel) {
  if (!alle.length) return null;
  return { id, titel, eintraege: alle.slice(0, JE_GRUPPE), mehr: Math.max(0, alle.length - JE_GRUPPE), anzahl: alle.length, ...(mehrZiel ? { mehrZiel } : {}) };
}
const liste = name => ({ art: 'liste', liste: name });
const zielAu = nr => ({ art: 'au', nr: t(nr) });
const zielBezug = nr => (/^AG-/.test(t(nr)) ? { art: 'ag', nr: t(nr) } : zielAu(nr));

/** Kurztitel je AU-/AG-Nummer (fuer To-dos: "AU-… · Kurztitel"). */
const titelJe = au => new Map([...(au?.auftraege ?? []).map(a => [a.Auftrag_Nr, t(a.Kurztitel)]), ...(au?.aufgaben ?? []).map(g => [g.Aufgabe_Nr, t(g.Kurztitel)])]);
const bezeichnung = (nr, titel) => [t(nr), kurz(titel, 40)].filter(Boolean).join(' · ');

/** Offene Bezuege (To-dos zaehlen nur, solange ihr Auftrag/ihre Aufgabe offen ist - wie die Kachel "überfällig"). */
function offeneBezuege(au) {
  return new Map([...(au?.auftraege ?? []).map(a => [a.Auftrag_Nr, istOffen(a)]), ...(au?.aufgaben ?? []).map(g => [g.Aufgabe_Nr, aufgabeOffen(g)])]);
}

/** To-dos + Aufgaben, die heute faellig oder ueberfaellig sind (aelteste zuerst). */
export function faelligHeute({ au, wer = '', jetzt }) {
  const iso = jetzt.toISOString();
  const titel = titelJe(au), offen = offeneBezuege(au);
  const zustJe = new Map([...(au?.auftraege ?? []).map(a => [a.Auftrag_Nr, t(a.Zustaendig)]), ...(au?.aufgaben ?? []).map(g => [g.Aufgabe_Nr, t(g.Zustaendig)])]);
  const todos = (au?.todos ?? [])
    .filter(d => t(d.Erledigt) !== 'ja' && !t(d.Archiviert) && offen.get(t(d.Bezug)) && (!wer || zustJe.get(t(d.Bezug)) === wer))
    .map(d => ({ d, stufe: faelligStufe(d.Faellig, iso) })).filter(x => ['ueberfaellig', 'heute'].includes(x.stufe))
    .map(({ d, stufe }) => ({ stufe, tage: tageBis(d.Faellig, jetzt), sort: t(d.Faellig),
      text: `${bezeichnung(d.Bezug, titel.get(t(d.Bezug)))}: ${kurz(d.Text, 60)}`, zusatz: faelligText(tageBis(d.Faellig, jetzt)), ziel: zielBezug(d.Bezug) }));
  const aufgaben = (au?.aufgaben ?? []).filter(g => aufgabeOffen(g) && zust(g, wer))
    .map(g => ({ g, stufe: faelligStufe(g.Faellig, iso) })).filter(x => ['ueberfaellig', 'heute'].includes(x.stufe))
    .map(({ g, stufe }) => ({ stufe, tage: tageBis(g.Faellig, jetzt), sort: t(g.Faellig),
      text: `Aufgabe ${bezeichnung(g.Aufgabe_Nr, g.Kurztitel)}`, zusatz: faelligText(tageBis(g.Faellig, jetzt)), ziel: { art: 'ag', nr: t(g.Aufgabe_Nr) } }));
  return [...todos, ...aufgaben].sort((a, b) => a.sort.localeCompare(b.sort) || a.text.localeCompare(b.text, 'de'));
}

/** Offene Auftraege mit Termin in [von, bis] Kalendertagen ab heute (von = -Infinity: auch ueberschrittene). */
export function auftraegeMitTermin({ au, wer = '', jetzt, von, bis }) {
  return (au?.auftraege ?? []).filter(a => istOffen(a) && zust(a, wer))
    .map(a => ({ a, tage: tageBis(a.Termin, jetzt) })).filter(x => x.tage !== null && x.tage >= von && x.tage <= bis)
    .sort((x, y) => x.tage - y.tage || t(x.a.Auftrag_Nr).localeCompare(t(y.a.Auftrag_Nr), 'de', { numeric: true }))
    .map(({ a, tage }) => ({ tage, text: bezeichnung(a.Auftrag_Nr, a.Kurztitel), zusatz: `${terminText(tage)} · ${t(a.Status)}`, ziel: zielAu(a.Auftrag_Nr) }));
}

/** "Zu tun" des Dashboards als kurze Zeilen (nur was > 0 ist), je mit Sprung in die Liste. */
export function zuTunZeilen(kacheln = {}) {
  const da = x => x && !x.fehlt && !x.nurJfn;
  const z = [];
  const k = kacheln;
  if (da(k.hinweise) && k.hinweise.zahl) z.push({ text: `${gross(zahlWort(k.hinweise.zahl, 'ein Kundenhinweis', 'Kundenhinweise'))} ungelesen`, ziel: liste('hinweise') });
  if (da(k.lange) && k.lange.zahl) z.push({ text: `${k.lange.zahl} ${k.lange.zahl === 1 ? 'Bestellung/Auftrag wartet' : 'Bestellungen/Aufträge warten'} über 7 Tage`, ziel: liste('lange') });
  if (da(k.todos) && k.todos.ueberfaellig) z.push({ text: `${gross(zahlWort(k.todos.ueberfaellig, 'ein To-do', 'To-dos'))} überfällig`, ziel: liste('todos-ueberfaellig') });
  if (da(k.todos) && k.todos.heute) z.push({ text: `${gross(zahlWort(k.todos.heute, 'ein To-do', 'To-dos'))} heute fällig`, ziel: liste('todos-heute') });
  if (da(k.ware) && k.ware.zahl) z.push({ text: `${gross(zahlWort(k.ware.zahl, 'ein Auftrag wartet', 'Aufträge warten'))} auf Ware`, ziel: liste('ware') });
  if (da(k.abholung) && k.abholung.zahl) z.push({ text: `${gross(zahlWort(k.abholung.zahl, 'eine Abholung', 'Abholungen'))} offen`, ziel: liste('abholung') });
  if (da(k.bestellseiten) && k.bestellseiten.zahl) z.push({ text: `${gross(zahlWort(k.bestellseiten.zahl, 'ein Bestellseiten-Eintrag', 'Bestellseiten-Einträge'))} ungeprüft`, ziel: liste('bestellseiten') });
  if (da(k.rueckstand) && k.rueckstand.positionen) z.push({ text: `L-Shop-Rückstand: ${zahlWort(k.rueckstand.positionen, 'eine Position', 'Positionen')}${k.rueckstand.kritisch ? `, ${k.rueckstand.kritisch} kritisch` : ''}`, ziel: liste('rueckstand') });
  if (da(k.trikots) && (k.trikots.ueber6Wochen || k.trikots.goalie)) {
    z.push({ text: `Trikots: ${[k.trikots.ueber6Wochen ? `${zahlWort(k.trikots.ueber6Wochen, 'eine Bestellung', 'Bestellungen')} über 6 Wochen` : '', k.trikots.goalie ? `${k.trikots.goalie} Goalie offen` : ''].filter(Boolean).join(', ')}`, ziel: liste('trikots') });
  }
  return z;
}

const anzahlSatz = (n, eins, mehr) => (n === 1 ? eins : `${n} ${mehr}`);
const trefferVon = gruppen => gruppen.reduce((s, g) => s + g.anzahl, 0);

/**
 * "Was liegt heute an?"
 * @param {{ dash: object|null, au: object|null, wer: string, jetzt: Date }} p  dash = Antwort von leseDashboard, au = leseAuftraege
 */
export function mikaHeute({ dash = null, au = null, wer = '', jetzt = new Date() } = {}) {
  wer = WER.includes(wer) ? wer : '';
  const faellig = au ? faelligHeute({ au, wer, jetzt }) : [];
  const termin = au ? auftraegeMitTermin({ au, wer, jetzt, von: 0, bis: 1 }) : [];
  const zuTun = dash ? zuTunZeilen(dash.kacheln) : [];
  const gruppen = [
    gruppe('faellig', 'Fällig und überfällig', faellig, liste(faellig.some(x => x.stufe === 'ueberfaellig') ? 'todos-ueberfaellig' : 'todos-heute')),
    gruppe('termin', 'Aufträge mit Termin heute oder morgen', termin, liste('au-termin')),
    zuTun.length ? { id: 'zutun', titel: 'Zu tun', eintraege: zuTun, mehr: 0, anzahl: zuTun.length } : null,
  ].filter(Boolean);
  const ueber = faellig.filter(x => x.stufe === 'ueberfaellig').length, heute = faellig.length - ueber;
  const terminHeute = termin.filter(x => x.tage === 0).length, terminMorgen = termin.length - terminHeute;
  const vorlesen = [
    ueber || heute ? `Fällig: ${[ueber ? `${ueber} überfällig` : '', heute ? `${heute} heute` : ''].filter(Boolean).join(', ')}.` : '',
    terminHeute ? `${anzahlSatz(terminHeute, 'Ein Auftrag hat', 'Aufträge haben')} heute Termin.` : '',
    terminMorgen ? `${anzahlSatz(terminMorgen, 'Ein Auftrag hat', 'Aufträge haben')} morgen Termin.` : '',
    ...zuTun.map(z => `${z.text}.`),
  ].filter(Boolean);
  // "Zu tun" sind Zahlen, keine einzelnen Treffer: gezaehlt wird je Zeile
  return { frage: 'heute', titel: 'Was liegt heute an?', gruppen, leer: 'Heute liegt nichts an.', vorlesen: vorlesen.length ? vorlesen : ['Heute liegt nichts an.'],
    treffer: trefferVon(gruppen), ...(dash?.fehler?.length || !au ? { unvollstaendig: true } : {}) };
}

/** Shop-Bestellungen > 14 Tage offen (ohne Trikot-Bestellungen - wie "wartend"/UB1), aus der Dashboard-Liste "lange". */
export function alteBestellungen(dash) {
  return (dash?.kacheln?.lange?.liste ?? []).filter(x => x.art === 'shop' && Number(x.tage) > BESTELLUNG_DRINGEND_TAGE)
    .sort((a, b) => b.tage - a.tage)
    .map(x => ({ text: `${t(x.shopKurz)} #${t(x.nr)}`, zusatz: [`seit ${x.tage} Tagen offen`, ...(x.grund ?? [])].join(' · '),
      ziel: { art: 'shop', shop: x.shop === 'honk' ? 'honk' : 'jfn', id: t(x.id) } }));
}

/** fertig/uebergeben und nicht bezahlt (aelteste Fertigmeldung zuerst). */
export function fertigUnbezahlt({ au, wer = '' }) {
  return (au?.auftraege ?? []).filter(a => ['fertig', 'übergeben'].includes(a.Status) && !t(a.Bezahlt_Am) && zust(a, wer))
    .sort((a, b) => (t(a.Fertig_Am) || '9999').localeCompare(t(b.Fertig_Am) || '9999'))
    .map(a => ({ text: bezeichnung(a.Auftrag_Nr, a.Kurztitel), zusatz: `${a.Status}, nicht bezahlt`, ziel: zielAu(a.Auftrag_Nr) }));
}

/** L-Shop-Bestellungen mit Positionen "wahrscheinlich da" (WE2). */
export function wahrscheinlichDaListe(lshop) {
  return (lshop?.bestellungen ?? []).filter(b => b.wahrscheinlichDa?.positionen?.length)
    .map(b => { const n = b.wahrscheinlichDa.positionen.length;
      return { text: `L-Shop ${t(b.orderId)}`, zusatz: `${zahlWort(n, 'eine Position', 'Positionen')} wahrscheinlich da – bitte prüfen`, ziel: { art: 'lshop', orderId: t(b.orderId) } }; });
}

/** "Was ist dringend?" */
export function mikaDringend({ dash = null, au = null, lshop = null, wer = '', jetzt = new Date() } = {}) {
  wer = WER.includes(wer) ? wer : '';
  const alt = alteBestellungen(dash);
  const termin = au ? auftraegeMitTermin({ au, wer, jetzt, von: -Infinity, bis: TERMIN_DRINGEND_TAGE }) : [];
  const unbezahlt = au ? fertigUnbezahlt({ au, wer }) : [];
  const da = wahrscheinlichDaListe(lshop);
  const gruppen = [
    gruppe('alt', `Bestellungen über ${BESTELLUNG_DRINGEND_TAGE} Tage offen`, alt, liste('lange')),
    gruppe('termin', `Aufträge mit Termin in ≤ ${TERMIN_DRINGEND_TAGE} Tagen`, termin, liste('au-termin')),
    gruppe('unbezahlt', 'Fertig, aber nicht bezahlt', unbezahlt, liste('au-fertig')),
    gruppe('da', 'L-Shop: wahrscheinlich angekommen', da, liste('lshop-bestellungen')),
  ].filter(Boolean);
  const vorbei = termin.filter(x => x.tage < 0).length;
  const vorlesen = [
    alt.length ? `${anzahlSatz(alt.length, 'Eine Bestellung ist', 'Bestellungen sind')} länger als ${BESTELLUNG_DRINGEND_TAGE} Tage offen.` : '',
    termin.length ? `${anzahlSatz(termin.length, 'Ein Auftrag hat', 'Aufträge haben')} Termin in den nächsten ${TERMIN_DRINGEND_TAGE} Tagen${vorbei ? `, ${vorbei === 1 ? 'einer' : vorbei} schon überschritten` : ''}.` : '',
    unbezahlt.length ? `${anzahlSatz(unbezahlt.length, 'Ein Auftrag ist', 'Aufträge sind')} fertig und nicht bezahlt.` : '',
    da.length ? `${anzahlSatz(da.length, 'Eine L-Shop-Bestellung ist', 'L-Shop-Bestellungen sind')} wahrscheinlich angekommen.` : '',
  ].filter(Boolean);
  return { frage: 'dringend', titel: 'Was ist dringend?', gruppen, leer: 'Nichts Dringendes.', vorlesen: vorlesen.length ? vorlesen : ['Nichts Dringendes.'],
    treffer: trefferVon(gruppen), ...(dash?.fehler?.length || !au ? { unvollstaendig: true } : {}) };
}

// ── Suche ────────────────────────────────────────────────────────────────────

export const SHOPS = ['jfn', 'honk'];
/**
 * Eingabe pruefen: Bestellnummer (Ziffern, "#" erlaubt) oder AU-JJJJ-NNNN. Keine Namenssuche.
 * @returns {{ art: 'shop', shop, nr } | { art: 'au', nr } | { fehler: string }}
 */
export function sucheEingabe({ nummer, shop } = {}) {
  const roh = t(nummer).replace(/\s+/g, '').toUpperCase();
  const au = /^AU-?(\d{4})-?(\d{1,4})$/.exec(roh);
  if (au) return { art: 'au', nr: `AU-${au[1]}-${au[2].padStart(4, '0')}` };
  const nr = roh.replace(/^#/, '');
  if (/^\d{1,9}$/.test(nr) && Number(nr) > 0) return { art: 'shop', shop: SHOPS.includes(t(shop).toLowerCase()) ? t(shop).toLowerCase() : 'jfn', nr: String(Number(nr)) };
  return { fehler: 'Bitte eine Bestellnummer (nur Ziffern) oder eine Auftragsnummer AU-JJJJ-NNNN eingeben.' };
}

export const SHOP_STATUS = { processing: 'in Bearbeitung', 'on-hold': 'wartet (Zahlung offen)', pending: 'Zahlung ausstehend', completed: 'abgeschlossen',
  cancelled: 'storniert', refunded: 'erstattet', failed: 'fehlgeschlagen', 'checkout-draft': 'Entwurf' };
const SHOP_KURZ = { jfn: 'JFN', honk: 'HONK' };

/** Stand einer Shop-Position (Bestellansicht PS1/BO5-8) als kurzer Text - wichtigstes zuerst. */
export function shopPositionStand(a) {
  if (a.versendet) return 'versendet';
  if (a.fertig) return 'fertig';
  const teile = [];
  const ls = a.lshop ?? {};
  // ohne Korb-Zeile und ohne Einstufung (Mika ruft den Shop nur einmal): neutral "nicht im L-Shop-Korb"
  if (ls.art === 'kein' && !ls.grund) teile.push('nicht im L-Shop-Korb');
  else if (ls.text) teile.push(/^(bestellt|geliefert)/.test(ls.text) ? `L-Shop ${ls.text}` : ls.text === 'im Korb offen' ? 'im L-Shop-Korb' : ls.text);
  if (a.lager?.art === 'offen') teile.push(`im Lager ${a.lager.n}${a.lager.genug ? '' : ' (zu wenig)'}`);
  // BO5-9 Teil B: DTF-Stand aus dem DTF-Korb (nicht mehr aus dem Archiv-Haken DTF_bestellt)
  if (a.dtf?.stand === 'bestellt') teile.push(a.dtf.geliefert ? 'DTF geliefert' : 'DTF bestellt');
  else if (a.dtf?.stand === 'lager') teile.push('DTF schon da');
  return teile.join(' · ') || 'offen';
}

/**
 * Antwort fuer eine gefundene Shop-Bestellung. `order` = WooCommerce-Bestellung (nur id/number/status/date_created/line_items),
 * `stand` = eine Bestellung aus leseProduktionStand (oder null, wenn der Stand nicht lesbar war).
 * Positionsname = Elternname (parent_name): der Variantenname traegt bei Trikots den Rueckennamen - der kommt nie heraus.
 */
export function mikaSucheShop({ shop, order, stand = null, jetzt = new Date() }) {
  const kurzShop = SHOP_KURZ[shop] ?? 'JFN';
  const nr = t(order.number) || t(order.id);
  const status = SHOP_STATUS[t(order.status)] ?? t(order.status);
  const tage = alterTage(order.date_created, jetzt);
  const artikelJe = new Map((stand?.artikel ?? []).map(a => [t(a.wcItemId), a]));
  const eintraege = (order.line_items ?? []).map(li => {
    const a = artikelJe.get(t(li.id));
    const name = kurz(t(li.parent_name) || t(li.name), 50);
    return { text: `${Number(li.quantity) || 1} × ${name}`, zusatz: a ? shopPositionStand(a) : 'Stand nicht lesbar' };
  });
  const ziel = { art: 'shop', shop, id: t(order.id) };
  const kopf = { text: `${kurzShop} #${nr}`, zusatz: [status, tage !== null ? (tage === 0 ? 'von heute' : `seit ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}`) : ''].filter(Boolean).join(' · '), ziel };
  const fertig = eintraege.filter(e => /^(fertig|versendet)$/.test(e.zusatz)).length;
  return {
    frage: 'suche', titel: `Bestellung ${kurzShop} #${nr}`,
    gruppen: [{ id: 'bestellung', titel: 'Bestellung', eintraege: [kopf], mehr: 0, anzahl: 1 },
      ...(eintraege.length ? [{ id: 'positionen', titel: 'Positionen', eintraege, mehr: 0, anzahl: eintraege.length }] : [])],
    leer: '', treffer: 1, ziel,
    vorlesen: [`Bestellung gefunden, Status ${status}.`, eintraege.length ? `${zahlWort(eintraege.length, 'Eine Position', 'Positionen')}, ${fertig} davon fertig oder versendet.` : ''].filter(Boolean),
    ...(stand ? {} : { unvollstaendig: true }),
  };
}

/** Stand einer Auftragsposition (AM-2/AM-3/KS4-2) als kurzer Text. */
export function auPositionStand(p) {
  if (t(p.Versendet)) return 'versendet';
  if (t(p.Fertig) === 'ja') return 'fertig';
  const h = t(p.Herkunft);
  if (h === 'lager') return t(p.Lager_Buchung) ? 'aus dem Lager genommen' : `aus dem Lager${t(p.Lager_Ort) ? ` (${t(p.Lager_Ort)})` : ''} – noch nicht gebucht`;
  if (h === 'bestellen') {
    const st = p.korb?.status ?? (t(p.Korb_Schluessel) ? 'fehlt' : '');
    return { '': 'noch nicht im L-Shop-Korb', fehlt: 'L-Shop-Korb: Zeile fehlt', offen: 'im L-Shop-Korb', herausgenommen: 'aus dem L-Shop-Korb herausgenommen',
      bestellt: 'bei L-Shop bestellt', 'bestätigt': 'bei L-Shop bestellt (bestätigt)', geliefert: 'von L-Shop geliefert', Lager: 'aus dem Lager' }[st] ?? `L-Shop-Korb: ${st}`;
  }
  if (h === 'vorhanden') return t(p.Da_Am) || !p.verweisKorb ? 'schon vorhanden' : `schon bestellt (${p.verweisKorb.status})`;
  return t(p.Da_Am) ? 'bei uns' : 'noch zu besorgen';
}

/** Antwort fuer eine Auftragsnummer (aus leseAuftraege ohne Automatik). Nicht gefunden -> null. */
export function mikaSucheAuftrag({ au, nr }) {
  const a = (au?.auftraege ?? []).find(x => t(x.Auftrag_Nr) === nr);
  if (!a) return null;
  const pos = (a.positionen ?? []).map(p => {
    const name = p.lshop ? [p.lshop.modell, p.lshop.farbe, p.lshop.groesse].filter(Boolean).join(' ') : t(p.Freitext);
    return { text: `${Number(p.Menge) || 0} × ${kurz(name || t(p.LShop_ArticleNr) || 'Position', 50)}`, zusatz: auPositionStand(p) };
  });
  const ziel = zielAu(a.Auftrag_Nr);
  const termin = /^\d{4}-\d{2}-\d{2}$/.test(t(a.Termin)) ? `Termin ${t(a.Termin).split('-').reverse().join('.')}` : '';
  return {
    frage: 'suche', titel: `Auftrag ${t(a.Auftrag_Nr)}`,
    gruppen: [{ id: 'auftrag', titel: 'Auftrag', eintraege: [{ text: bezeichnung(a.Auftrag_Nr, a.Kurztitel), zusatz: [t(a.Status), termin].filter(Boolean).join(' · '), ziel }], mehr: 0, anzahl: 1 },
      ...(pos.length ? [{ id: 'positionen', titel: 'Positionen', eintraege: pos, mehr: 0, anzahl: pos.length }] : [])],
    leer: '', treffer: 1, ziel,
    vorlesen: [`Auftrag gefunden, Status ${t(a.Status)}.`, pos.length ? `${zahlWort(pos.length, 'Eine Position', 'Positionen')}, ${pos.filter(x => /^(fertig|versendet)$/.test(x.zusatz)).length} davon fertig oder versendet.` : ''].filter(Boolean),
  };
}

/** Nichts gefunden: fester Text je Art (mit Nummer im Fenster, nie im Log). */
export function mikaNichtGefunden(e) {
  const text = e.art === 'au' ? `Auftrag ${e.nr} gibt es nicht.`
    : `Im ${SHOP_KURZ[e.shop]}-Shop gibt es keine Bestellung #${e.nr}. Anderer Shop? Dann ${e.shop === 'jfn' ? 'HONK' : 'JFN'} wählen und noch einmal suchen.`;
  return { frage: 'suche', titel: 'Nicht gefunden', gruppen: [], leer: text, treffer: 0, vorlesen: [e.art === 'au' ? 'Diesen Auftrag gibt es nicht.' : 'Diese Bestellung gibt es in diesem Shop nicht.'] };
}

// ── Nutzung zaehlen ───────────────────────────────────────────────────────────
/**
 * Logzeile je Frage: NUR { event, frage, wer, treffer } - keine Nummern, kein Suchtext, keine Namen.
 * wer = Name des geprueften Schluessels ('inhaber' | 'nicole'); Cloud Logging liest die JSON-Zeile als jsonPayload.
 */
export function mikaLogZeile({ frage, wer, treffer }) {
  return JSON.stringify({ event: 'mika_frage', frage: FRAGEN.includes(frage) ? frage : 'unbekannt',
    wer: ['inhaber', 'nicole'].includes(wer) ? wer : 'unbekannt', treffer: Number.isInteger(treffer) && treffer >= 0 ? treffer : 0 });
}
