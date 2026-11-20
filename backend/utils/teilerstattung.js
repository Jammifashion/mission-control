// Teilerstattungen (NB1 Teil A) – reine Logik, ohne WooCommerce- oder Sheets-Zugriff.
//
// Eingabe je Bestellung:
//   items:   Positionen der Bestellung { id, product_id, variation_id, quantity }
//   refunds: Erstattungen { id, lines: [{ product_id, variation_id, quantity, total, meta_data }], versand }
//            quantity/total wie von WooCommerce (negativ) oder positiv - es zaehlt der Betrag (abs).
//            lines leer = Erstattung nur mit Betrag (kein Positionsbezug).
//            versand = erstatteter Versand (Betrag, > 0 = Versand erstattet).
//   gebucht: Map positionId -> bereits gegengebuchte Menge (aus den Verkaufszeilen)
//   gebuchteRefunds: Set "refundId|positionId" fuer schon gebuchte Erstattungen (Dubletten-Schutz)
//
// Zuordnung: Erstattungs-Position -> Bestell-Position ueber product_id + variation_id.
// Nichts wird geraten - jeder Fall, der nicht eindeutig eine Menge einer Position erstattet,
// geht als Hinweis heraus und wird nicht gebucht:
//   ohne_position      Erstattung ohne Positionen (Kulanz, nur Betrag)
//   versand            Versand erstattet (wird im Lizenz-Sync als Porto-Minderung gebucht, buildErstattungRows)
//   betrag_ohne_menge  Position mit Betrag, aber Menge 0 (Teilbetrag einer Position)
//   unbekannt          Produkt/Variante nicht in der Bestellung
//   mehrdeutig         Produkt/Variante mehrfach in der Bestellung
//   mehr_als_rest      mehr Menge erstattet als noch offen (gebucht wird nur der Rest)

import { parseDeZahl } from './zahl-de.js';

export const refundSchluessel =(refundId, positionId) => `${refundId}|${positionId}`;

const zahl = v => { const n = Math.abs(parseDeZahl(v)); return Number.isFinite(n) ? n : 0; };
const kombi = (productId, variationId) => `${productId ?? ''}|${Number(variationId || 0)}`;
/** Original-Position einer Erstattungs-Zeile (meta _refunded_item_id), sonst ''. */
export function refundedItemId(line) {
  const m = (line?.meta_data ?? []).find(x => x?.key === '_refunded_item_id');
  return m && String(m.value ?? '').trim() !== '' ? String(m.value).trim() : '';
}

/**
 * @returns {{
 *   buchungen: Array<{ refundId: string, positionId: string, orderItem: object, menge: number, faktor: number }>,
 *   hinweise:  Array<{ refundId: string, grund: string, produktId?, variationId?, menge? }>
 * }}
 */
export function berechneTeilerstattung({ items = [], refunds = [], gebucht = new Map(), gebuchteRefunds = new Set() }) {
  const buchungen = [];
  const hinweise = [];
  // Offene Menge je Bestell-Position: Original minus schon gegengebucht minus in diesem Lauf vergeben.
  const rest = new Map(items.map(i => [String(i.id), Math.max(0, Number(i.quantity) - Number(gebucht.get(String(i.id)) ?? 0))]));

  for (const r of refunds) {
    const refundId = String(r.id);
    if (zahl(r.versand) > 0) hinweise.push({ refundId, grund: 'versand' });
    if (!r.lines || r.lines.length === 0) {
      if (!(zahl(r.versand) > 0)) hinweise.push({ refundId, grund: 'ohne_position' });
      continue;
    }
    // Mehrere Zeilen derselben Position in EINER Erstattung zusammenfassen (eine Buchung je Schluessel).
    const jePosition = new Map();
    for (const line of r.lines) {
      // Gemessen 19.11. (NB1): WooCommerce liefert an jeder Erstattungs-Zeile meta _refunded_item_id = Original-Position.
      // Die gilt zuerst; nur ohne sie wird ueber Produkt + Variante gesucht (mehrfach = mehrdeutig).
      const bezug = refundedItemId(line);
      const k = kombi(line.product_id, line.variation_id);
      const treffer = bezug
        ? items.filter(i => String(i.id) === bezug)
        : items.filter(i => kombi(i.product_id, i.variation_id) === k);
      const info = { refundId, produktId: line.product_id, variationId: Number(line.variation_id || 0) };
      if (treffer.length === 0) { hinweise.push({ ...info, grund: 'unbekannt' }); continue; }
      if (treffer.length > 1)   { hinweise.push({ ...info, grund: 'mehrdeutig' }); continue; }
      const menge = zahl(line.quantity);
      if (menge === 0) {
        if (zahl(line.total) > 0) hinweise.push({ ...info, grund: 'betrag_ohne_menge' });
        continue;
      }
      const item = treffer[0];
      const pid = String(item.id);
      const vorher = jePosition.get(pid);
      jePosition.set(pid, { item, menge: (vorher?.menge ?? 0) + menge, info });
    }
    for (const [positionId, { item, menge: gewollt, info }] of jePosition) {
      if (gebuchteRefunds.has(refundSchluessel(refundId, positionId))) continue;   // Dubletten-Schutz
      const offen = rest.get(positionId) ?? 0;
      const menge = Math.min(gewollt, offen);
      if (gewollt > offen) hinweise.push({ ...info, grund: 'mehr_als_rest', menge: gewollt - offen });
      if (menge <= 0) continue;
      rest.set(positionId, offen - menge);
      const orig = Number(item.quantity) || 1;
      buchungen.push({ refundId, positionId, orderItem: item, menge, faktor: menge / orig });
    }
  }
  return { buchungen, hinweise };
}

// ── Gegenbuchungen im Lizenz-Verkaeufe-Reiter (Partner_Verkäufe / HK_Partner_Verkäufe) ─────────────
//
// Je Erstattung entstehen eigene Zeilen, erkennbar an Storno-Status:
//   "Erstattung #<Refund-ID>"        erstattete Menge einer Position: alle Betraege der Ursprungszeile
//                                    anteilig (Menge / Originalmenge) negiert, Stueckzahl = -Menge
//   "Versanderstattung #<Refund-ID>" erstatteter Versand: Porto-Einnahme der Bestellung gemindert
//                                    (Inhaber 19.11.: Porto-Saldo mindern). Je Zeile wie im Sync:
//                                    -Versand netto x Wertanteil x Porto-Modell (partner-traegt 1, sonst 1/2);
//                                    Lizenzgebuehr und Porto-Saldo um diesen Betrag, Anteil-Brutto mit MwSt.
// Die Marke mit Refund-ID ist der Dubletten-Schutz (je Ursprungszeile). Gesperrte Ursprungszeilen
// bekommen nichts (entsperren() rechnet gesperrte Zeilen neu) - Hinweis, der naechste Lauf nach dem
// Entsperren bucht. Ganz stornierte Positionen (Storniert/Rückerstattet) bekommen nichts.

export const MARKE_ERSTATTUNG = 'Erstattung #';
export const MARKE_VERSAND    = 'Versanderstattung #';
export const istErstattungsZeile = storno => {
  const s = String(storno ?? '');
  return s.startsWith(MARKE_ERSTATTUNG) || s.startsWith(MARKE_VERSAND);
};

const NEG_SPALTEN = ['Stückzahl', 'VK-Preis-Brutto', 'Lizenzgebühr', 'Gewinn-netto', 'Lizenz-Anteil', 'Porto-Saldo', 'Anteil-Brutto'];
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const leer = v => v === null || v === undefined || String(v).trim() === '';
// Sheets-Werte (deutsch "1.234,50") wie toFloat; WC-Werte ("12.50") gehen ebenso durch parseDeZahl.
const dezimal = v => { const n = parseDeZahl(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0; };
const ohneMinusNull = x => (x === 0 ? 0 : x);
const varKey = v => (v === '' || v === null || v === undefined) ? '0' : String(v);
const artikelName = item => item.name || item.sku || String(item.product_id);
const datumDE = iso => {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
};

/**
 * @param {object} o
 * @param {any[][]} o.vRows                     Verkaeufe-Zeilen (ohne Kopf)
 * @param {(c:string)=>number} o.vh             Spaltenindex ueber den Namen
 * @param {Array<{order:object, refunds:object[]}>} o.bestellungen  WC-Bestellung (Status Verkauf) + rohe /refunds-Antwort
 * @param {(partnerId:string)=>number} o.portoFaktor   Anteil des Partners am Porto-Saldo (1 oder 0,5)
 * @param {(order:object)=>number} o.mwstFuer   MwSt-Satz in Prozent zum Bestelldatum
 * @param {string} o.stornoMarker               Marke der Ganz-Storno-Zeilen
 * @param {Set<string>|null} [o.partnerFilter]
 * @returns {{ rows: any[][], hinweise: object[] }}
 */
export function buildErstattungRows({ vRows, vh, bestellungen, portoFaktor, mwstFuer, stornoMarker, partnerFilter = null }) {
  const pflicht = n => {
    const i = vh(n);
    if (i === -1) throw Object.assign(new Error(`Spalte "${n}" fehlt in der Kopfzeile der Verkaeufe - Erstattung abgebrochen.`), { status: 500 });
    return i;
  };
  const iOrd = pflicht('Order-ID'), iArt = pflicht('Artikelnummer'), iVar = pflicht('Variante'), iPid = pflicht('Partner-ID');
  const iDat = pflicht('Datum'), iSt = pflicht('Status'), iSto = pflicht('Storno-Status');
  const iPos = vh('Positions-ID');
  const neg = Object.fromEntries(NEG_SPALTEN.map(n => [n, pflicht(n)]));
  const breite = Math.max(0, ...vRows.map(r => r.length), iSto + 1, iPos + 1, ...Object.values(neg).map(i => i + 1));
  const posVon = r => (iPos === -1 ? '' : String(r[iPos] ?? '').trim());
  const keyOf = r => (posVon(r) ? `${r[iOrd]}|pos:${posVon(r)}|${r[iPid]}` : `${r[iOrd]}|${r[iArt]}|${varKey(r[iVar])}|${r[iPid]}`);
  const kopie = r => Array.from({ length: breite }, (_, i) => r[i] ?? '');

  const rows = [];
  const hinweise = [];
  const hinweis = h => {
    if (!hinweise.some(x => x.orderId === h.orderId && x.refundId === h.refundId && x.grund === h.grund && x.partnerId === h.partnerId)) hinweise.push(h);
  };

  for (const { order, refunds } of bestellungen ?? []) {
    if (!(refunds ?? []).length) continue;
    const oid = String(order.id);
    const zeilen = vRows.filter(r => String(r[iOrd] ?? '') === oid && (!partnerFilter || partnerFilter.has(r[iPid])));
    if (!zeilen.length) continue;
    const ganzStorniert = new Set(zeilen.filter(r => String(r[iSto] ?? '') === stornoMarker).map(keyOf));
    const items = order.line_items ?? [];
    const orderNetto = items.reduce((s, i) => s + dezimal(i.total), 0);
    const roh = refunds.map(rf => ({
      id: rf.id,
      lines: (rf.line_items ?? []).map(l => ({ product_id: l.product_id, variation_id: l.variation_id, quantity: l.quantity, total: l.total, meta_data: l.meta_data })),
      versand: (rf.shipping_lines ?? []).reduce((s, x) => s + Math.abs(dezimal(x.total)), 0),
    }));
    const datumVon = new Map(refunds.map(rf => [String(rf.id), datumDE(rf.date_created)]));

    // Ursprungszeilen je Partner, jede einer Bestell-Position zugeordnet.
    const original = zeilen.filter(r => String(r[iSto] ?? '') === '' && !ganzStorniert.has(keyOf(r)));
    const jePartner = new Map();
    for (const r of original) {
      const item = posVon(r)
        ? items.find(i => String(i.id) === posVon(r))
        : items.find(i => artikelName(i) === String(r[iArt] ?? '') && varKey(i.variation_id || 0) === varKey(r[iVar]));
      if (!item) { hinweis({ orderId: oid, partnerId: r[iPid], grund: 'zeile_ohne_position' }); continue; }
      const p = r[iPid];
      if (!jePartner.has(p)) jePartner.set(p, []);
      jePartner.get(p).push({ r, item, key: keyOf(r) });
    }

    for (const [partnerId, liste] of jePartner) {
      const zuPos = new Map(liste.map(x => [String(x.item.id), x]));
      const zuKey = new Map(liste.map(x => [x.key, x]));
      // Schon gebuchte Erstattungen dieser Ursprungszeilen.
      const gebucht = new Map(), gebuchteRefunds = new Set(), versandGebucht = new Set();
      for (const r of zeilen) {
        const s = String(r[iSto] ?? '');
        const x = zuKey.get(keyOf(r));
        if (!x) continue;
        if (s.startsWith(MARKE_ERSTATTUNG)) {
          const pid = String(x.item.id);
          gebucht.set(pid, (gebucht.get(pid) ?? 0) + Math.abs(dezimal(r[neg['Stückzahl']])));
          gebuchteRefunds.add(refundSchluessel(s.slice(MARKE_ERSTATTUNG.length), pid));
        } else if (s.startsWith(MARKE_VERSAND)) {
          versandGebucht.add(`${s.slice(MARKE_VERSAND.length)}|${x.key}`);
        }
      }

      const erg = berechneTeilerstattung({ items, refunds: roh, gebucht, gebuchteRefunds });
      for (const h of erg.hinweise) {
        if (h.grund === 'versand') continue;   // wird unten gebucht
        hinweis({ orderId: oid, partnerId, refundId: h.refundId, grund: h.grund });
      }
      for (const b of erg.buchungen) {
        const x = zuPos.get(b.positionId);
        if (!x) continue;                       // Position gehoert nicht diesem Partner
        if (String(x.r[iSt] ?? '') === 'gesperrt') { hinweis({ orderId: oid, partnerId, refundId: b.refundId, grund: 'gesperrt' }); continue; }
        const z = kopie(x.r);
        for (const [name, i] of Object.entries(neg)) {
          if (name === 'Stückzahl') { z[i] = -b.menge; continue; }
          if (leer(x.r[i])) continue;
          z[i] = ohneMinusNull(-round2(dezimal(x.r[i]) * b.faktor));
        }
        z[iDat] = datumVon.get(b.refundId) || z[iDat];
        z[iSt]  = 'offen';
        z[iSto] = MARKE_ERSTATTUNG + b.refundId;
        if (String(x.r[iSt] ?? '') === 'abgerechnet') hinweis({ orderId: oid, partnerId, refundId: b.refundId, grund: 'nachzuegler' });
        rows.push(z);
      }

      // Versand: Porto-Einnahme mindern (je Ursprungszeile, Wertanteil wie im Sync).
      for (const rf of roh) {
        if (!(rf.versand > 0)) continue;
        const refundId = String(rf.id);
        for (const x of liste) {
          if (versandGebucht.has(`${refundId}|${x.key}`)) continue;
          if (String(x.r[iSt] ?? '') === 'gesperrt') { hinweis({ orderId: oid, partnerId, refundId, grund: 'gesperrt' }); continue; }
          if (leer(x.r[neg['Porto-Saldo']])) continue;
          const anteil = orderNetto > 0 ? dezimal(x.item.total) / orderNetto : 0;
          const delta = ohneMinusNull(round2(-rf.versand * anteil * portoFaktor(partnerId)));
          if (delta === 0) continue;
          const mwst = mwstFuer(order);
          if (!Number.isFinite(mwst)) { hinweis({ orderId: oid, partnerId, refundId, grund: 'mwst_fehlt' }); continue; }
          const z = kopie(x.r);
          for (const i of Object.values(neg)) z[i] = 0;
          z[neg['Porto-Saldo']]   = delta;
          z[neg['Lizenzgebühr']]  = delta;
          z[neg['Anteil-Brutto']] = ohneMinusNull(round2(delta * (1 + mwst / 100)));
          z[iDat] = datumVon.get(refundId) || z[iDat];
          z[iSt]  = 'offen';
          z[iSto] = MARKE_VERSAND + refundId;
          if (String(x.r[iSt] ?? '') === 'abgerechnet') hinweis({ orderId: oid, partnerId, refundId, grund: 'nachzuegler' });
          rows.push(z);
        }
      }
    }
  }
  return { rows, hinweise };
}

// ── Gegenbuchungen im Festpreis-Reiter FP_Verkäufe (NB2) ──────────────────────────────────────────
//
// Dieselbe Zuordnung wie Lizenz (berechneTeilerstattung), dieselben Marken. Unterschiede durch den FP-Aufbau:
//   - Festpreis/Handling sind STUECKPREISE (die Abrechnung rechnet sie mal Stueckzahl, aggregateFpVerkaeufe) -
//     sie werden nur im Vorzeichen gedreht, nie anteilig gerechnet; die Stueckzahl (-Menge) traegt den Abzug.
//   - Betraege der Zeile (VK, Porto anteilig, PayPal, Mehrkosten, Gesamt netto/brutto) anteilig negiert.
//   - Versand erstattet:
//       altes Modell (Bestelldatum vor PO1, Porto anteilig in der Zeile): je Ursprungszeile
//         Porto-Einnahme = Gesamt-Partner-Netto = -Versand netto x Wertanteil, Brutto mit MwSt.
//       PO1 (Zeile traegt Porto_Bestellung): EINE Zeile je Erstattung und Partner, alle Betraege 0,
//         Porto_Bestellung = -Versand netto - berechnePorto (utils/festpreis-porto.js) mindert damit die
//         Porto-Einnahmen der Bestellung; Porto-Kosten bleiben (verschickt wurde trotzdem).
export const FP_STUECKPREIS_SPALTEN = ['Festpreis-EK', 'Handling', 'Festpreis', 'Handlingskosten'];
export const FP_BETRAG_SPALTEN = ['Porto-Einnahme', 'Porto-Kosten', 'Versandnebenkosten', 'PayPal-Kosten',
  'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto', 'Mehrkosten', 'VK-Netto'];

/**
 * @param {object} o  wie buildErstattungRows, ohne portoFaktor (FP: der Partner traegt das Porto voll)
 * @returns {{ rows: any[][], hinweise: object[] }}
 */
export function buildFpErstattungRows({ vRows, vh, bestellungen, mwstFuer, stornoMarker, partnerFilter = null }) {
  const pflicht = n => {
    const i = vh(n);
    if (i === -1) throw Object.assign(new Error(`Spalte "${n}" fehlt in der Kopfzeile von FP_Verkäufe - Erstattung abgebrochen.`), { status: 500 });
    return i;
  };
  const iOrd = pflicht('WC-Bestellnummer'), iArt = pflicht('Artikelname'), iVar = pflicht('Variante'), iPid = pflicht('Partner-ID');
  const iDat = pflicht('Datum'), iSt = pflicht('Status Abrechnung'), iSto = pflicht('Storno-Status'), iStk = pflicht('Stückzahl');
  const iPos = vh('Positions-ID'), iPb = vh('Porto_Bestellung');
  const betrag = Object.fromEntries(FP_BETRAG_SPALTEN.map(n => [n, pflicht(n)]));
  const stueck = FP_STUECKPREIS_SPALTEN.map(pflicht);
  const breite = Math.max(0, ...vRows.map(r => r.length), iSto + 1, iPos + 1, iPb + 1, ...Object.values(betrag).map(i => i + 1));
  const posVon = r => (iPos === -1 ? '' : String(r[iPos] ?? '').trim());
  const keyOf = r => (posVon(r) ? `${r[iOrd]}|pos:${posVon(r)}|${r[iPid]}` : `${r[iOrd]}|${r[iArt]}|${varKey(r[iVar])}|${r[iPid]}`);
  const kopie = r => Array.from({ length: breite }, (_, i) => r[i] ?? '');
  const poNeu = r => iPb !== -1 && !leer(r[iPb]);

  const rows = [];
  const hinweise = [];
  const hinweis = h => {
    if (!hinweise.some(x => x.orderId === h.orderId && x.refundId === h.refundId && x.grund === h.grund && x.partnerId === h.partnerId)) hinweise.push(h);
  };

  for (const { order, refunds } of bestellungen ?? []) {
    if (!(refunds ?? []).length) continue;
    const oid = String(order.id);
    const zeilen = vRows.filter(r => String(r[iOrd] ?? '') === oid && (!partnerFilter || partnerFilter.has(r[iPid])));
    if (!zeilen.length) continue;
    const ganzStorniert = new Set(zeilen.filter(r => String(r[iSto] ?? '') === stornoMarker).map(keyOf));
    const items = order.line_items ?? [];
    const orderNetto = items.reduce((s, i) => s + dezimal(i.total), 0);
    const roh = refunds.map(rf => ({
      id: rf.id,
      lines: (rf.line_items ?? []).map(l => ({ product_id: l.product_id, variation_id: l.variation_id, quantity: l.quantity, total: l.total, meta_data: l.meta_data })),
      versand: (rf.shipping_lines ?? []).reduce((s, x) => s + Math.abs(dezimal(x.total)), 0),
    }));
    const datumVon = new Map(refunds.map(rf => [String(rf.id), datumDE(rf.date_created)]));

    const original = zeilen.filter(r => String(r[iSto] ?? '') === '' && !ganzStorniert.has(keyOf(r)));
    const jePartner = new Map();
    for (const r of original) {
      const item = posVon(r)
        ? items.find(i => String(i.id) === posVon(r))
        : items.find(i => artikelName(i) === String(r[iArt] ?? '') && varKey(i.variation_id || 0) === varKey(r[iVar]));
      if (!item) { hinweis({ orderId: oid, partnerId: r[iPid], grund: 'zeile_ohne_position' }); continue; }
      const p = r[iPid];
      if (!jePartner.has(p)) jePartner.set(p, []);
      jePartner.get(p).push({ r, item, key: keyOf(r) });
    }

    for (const [partnerId, liste] of jePartner) {
      const zuPos = new Map(liste.map(x => [String(x.item.id), x]));
      const zuKey = new Map(liste.map(x => [x.key, x]));
      const gebucht = new Map(), gebuchteRefunds = new Set(), versandGebucht = new Set();
      for (const r of zeilen) {
        const s = String(r[iSto] ?? '');
        if (s.startsWith(MARKE_VERSAND) && String(r[iPid]) === String(partnerId)) {
          versandGebucht.add(`${s.slice(MARKE_VERSAND.length)}|${keyOf(r)}`);
          versandGebucht.add(`${s.slice(MARKE_VERSAND.length)}|partner:${partnerId}`);
          continue;
        }
        const x = zuKey.get(keyOf(r));
        if (!x || !s.startsWith(MARKE_ERSTATTUNG)) continue;
        const pid = String(x.item.id);
        gebucht.set(pid, (gebucht.get(pid) ?? 0) + Math.abs(dezimal(r[iStk])));
        gebuchteRefunds.add(refundSchluessel(s.slice(MARKE_ERSTATTUNG.length), pid));
      }

      const erg = berechneTeilerstattung({ items, refunds: roh, gebucht, gebuchteRefunds });
      for (const h of erg.hinweise) {
        if (h.grund === 'versand') continue;   // wird unten gebucht
        hinweis({ orderId: oid, partnerId, refundId: h.refundId, grund: h.grund });
      }
      for (const b of erg.buchungen) {
        const x = zuPos.get(b.positionId);
        if (!x) continue;
        if (String(x.r[iSt] ?? '') === 'gesperrt') { hinweis({ orderId: oid, partnerId, refundId: b.refundId, grund: 'gesperrt' }); continue; }
        const z = kopie(x.r);
        z[iStk] = -b.menge;
        for (const i of stueck) if (!leer(x.r[i])) z[i] = ohneMinusNull(-Math.abs(dezimal(x.r[i])));
        for (const i of Object.values(betrag)) if (!leer(x.r[i])) z[i] = ohneMinusNull(-round2(dezimal(x.r[i]) * b.faktor));
        z[iDat] = datumVon.get(b.refundId) || z[iDat];
        z[iSt]  = 'offen';
        z[iSto] = MARKE_ERSTATTUNG + b.refundId;
        if (String(x.r[iSt] ?? '') === 'abgerechnet') hinweis({ orderId: oid, partnerId, refundId: b.refundId, grund: 'nachzuegler' });
        rows.push(z);
      }

      for (const rf of roh) {
        if (!(rf.versand > 0)) continue;
        const refundId = String(rf.id);
        const mwst = mwstFuer(order);
        const nullZeile = x => {
          const z = kopie(x.r);
          z[iStk] = 0;
          for (const i of Object.values(betrag)) z[i] = 0;
          z[iDat] = datumVon.get(refundId) || z[iDat];
          z[iSt]  = 'offen';
          z[iSto] = MARKE_VERSAND + refundId;
          if (String(x.r[iSt] ?? '') === 'abgerechnet') hinweis({ orderId: oid, partnerId, refundId, grund: 'nachzuegler' });
          return z;
        };
        if (liste.some(x => poNeu(x.r))) {
          // PO1: eine Zeile je Erstattung und Partner, Porto_Bestellung = -Versand netto
          if (versandGebucht.has(`${refundId}|partner:${partnerId}`)) continue;
          const x = liste.find(y => String(y.r[iSt] ?? '') !== 'gesperrt');
          if (!x) { hinweis({ orderId: oid, partnerId, refundId, grund: 'gesperrt' }); continue; }
          const z = nullZeile(x);
          z[iPb] = ohneMinusNull(-round2(rf.versand));
          rows.push(z);
          continue;
        }
        if (!Number.isFinite(mwst)) { hinweis({ orderId: oid, partnerId, refundId, grund: 'mwst_fehlt' }); continue; }
        for (const x of liste) {
          if (versandGebucht.has(`${refundId}|${x.key}`)) continue;
          if (String(x.r[iSt] ?? '') === 'gesperrt') { hinweis({ orderId: oid, partnerId, refundId, grund: 'gesperrt' }); continue; }
          const anteil = orderNetto > 0 ? dezimal(x.item.total) / orderNetto : 0;
          const delta = ohneMinusNull(round2(-rf.versand * anteil));
          if (delta === 0) continue;
          const z = nullZeile(x);
          z[betrag['Porto-Einnahme']] = delta;
          z[betrag['Gesamt-Partner-Netto']] = delta;
          z[betrag['Gesamt-Partner-Brutto']] = ohneMinusNull(round2(delta * (1 + mwst / 100)));
          rows.push(z);
        }
      }
    }
  }
  return { rows, hinweise };
}

// ── Hinweistexte (Sync-Antwort und Abrechnungsvorschau, Lizenz + FP) ──────────────────────────────
const GRUND_TEXT = {
  ohne_position: 'Erstattung nur mit Betrag, ohne Position – bitte prüfen',
  betrag_ohne_menge: 'Teilbetrag einer Position ohne Menge erstattet – bitte prüfen',
  unbekannt: 'erstattete Position steht nicht in der Bestellung – bitte prüfen',
  mehrdeutig: 'erstattete Position ist nicht eindeutig – bitte prüfen',
  mehr_als_rest: 'mehr erstattet als noch offen – nur der Rest ist gebucht',
  gesperrt: 'Zeile gesperrt – Erstattung wird nach dem Entsperren gebucht',
  zeile_ohne_position: 'Verkaufszeile passt zu keiner Position der Bestellung – bitte prüfen',
  nachzuegler: 'Erstattung zu einer schon abgerechneten Zeile – kommt in die nächste Abrechnung',
  mwst_fehlt: 'MwSt-Satz zum Bestelldatum fehlt – Versanderstattung nicht gebucht',
};
/** Ein Hinweis als Text (nur Bestellnummer und Erstattungs-Nummer, keine Betraege, keine Namen). */
export const erstattungHinweisText = h =>
  `Bestellung ${h.orderId}${h.refundId ? ` (Erstattung #${h.refundId})` : ''}: ${GRUND_TEXT[h.grund] ?? h.grund}.`;
