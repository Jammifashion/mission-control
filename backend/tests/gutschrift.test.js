// GS1: Gutschrift an Festpreis-Partner als Lexware-Entwurf. Nur ERFUNDENE Partner, Artikel und Betraege; Lexware nur als Attrappe.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { KUNDEN_SPALTEN, TAB_KUNDEN } from '../utils/kunden.js';
import {
  gutschriftPlan, lineItem, abrechnungAus, abrechnungGrund, deDatum, inCent, belegartAus, kennzeichenPlan, chatText, einleitung, GUTSCHRIFT_SPALTEN,
} from '../utils/gutschrift.js';
import { legeGutschriftsentwurfAn, gutschriftSchluessel } from '../lib/lexwareGutschrift.js';
import { sucheEntwuerfe } from '../lib/lexwareRechnung.js';
import { gutschriftAnlegen, gutschriftVorschau, gutschriftKennzeichen, gutschriftNachsehen, gutschriftListe } from '../lib/gutschrift.js';
import { _kundenCacheLeeren } from '../lib/kunden.js';
import { SECRET_KEYS } from '../utils/secrets.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const KONTAKT = '11111111-2222-4333-8444-555555555555';
const jetzt = () => new Date('2026-11-22T10:00:00.000Z');
const KOPF = ['Abrechnungs-ID', 'Partner-ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Gesamt-Netto', 'Gesamt-Brutto', 'Status', 'Erstellt-Am', 'Positionen', ...GUTSCHRIFT_SPALTEN];

// Dieselbe Rechnung wie fpAbrechnungErstellen (routes/festpreis-portal.js) - so entsteht Gesamt-Brutto.
function bruttoWieAbrechnung(pos, m = 19) {
  const porto = pos.porto && pos.porto.status !== 'keine' ? pos.porto.saldo : 0;
  const verp = pos.verpackung?.status === 'ok' ? pos.verpackung.summe : 0;
  const auszahlungBrutto = Math.round((pos.summen.auszahlung + porto) * (1 + m / 100) * 100) / 100;
  return Math.round((auszahlungBrutto - pos.interneSumme - verp) * 100) / 100;
}
function positionen({ gruppen = [['Muster-Shirt - L', 3, 20.17], ['Muster-Mütze', 2, 7.33], ['Muster-Puck', 5, 3.41]], porto = -4.2, intern = [['15.03.2026', 'Muster intern', -10]], verpackung = 1.5 } = {}) {
  // erfundene Gruppen: auszahlung = vkNetto - Festpreis - Handling - Mehrkosten + Porto-Einnahmen - Porto-Kosten - PayPal (wie aggregateFpVerkaeufe)
  const produkteGruppen = gruppen.map(([artikelkategorie, stueckzahl, auszahlung]) => {
    const festpreisGesamt = Math.round(stueckzahl * 4.37 * 100) / 100, paypalGesamt = 0.51, handlingGesamt = 0.3, portoEinnahmen = 1.2, portoKosten = 2.05;
    const vkNetto = Math.round((auszahlung + festpreisGesamt + paypalGesamt + handlingGesamt - portoEinnahmen + portoKosten) * 100) / 100;
    return { produktId: '1', artikelname: `${artikelkategorie} Modell`, artikelkategorie, stueckzahl, vkNetto, festpreisGesamt, handlingGesamt, mehrkosten: 0,
      portoEinnahmen, portoKosten, paypalGesamt, auszahlung };
  });
  const auszahlung = Math.round(gruppen.reduce((s, g) => s + g[2], 0) * 100) / 100;
  return {
    produkteGruppen, summen: { stueckzahl: 10, auszahlung },
    intern: intern.map(([datum, bezeichnung, summe]) => ({ datum, bezeichnung, anzahl: 1, einzelpreis: summe, summe })),
    interneSumme: Math.round(intern.reduce((s, x) => s + x[2], 0) * 100) / 100,
    ...(verpackung ? { verpackung: { status: 'ok', anzahl: 3, betrag: verpackung / 3, summe: verpackung } } : {}),
    ...(porto ? { porto: { status: 'ok', saldo: porto } } : {}),
  };
}
function abrechnung(extra = {}, pos = positionen()) {
  const brutto = bruttoWieAbrechnung(pos);
  return { id: 'FPA-0009', partnerId: 'FP-009', von: '01.04.2026', bis: '30.06.2026', brutto, status: 'freigegeben', positionen: JSON.stringify(pos), ...extra };
}

describe('Gutschrift-Plan', () => {
  test('Summe = Gesamt-Brutto der Abrechnung auf den Cent, Brutto-Beleg mit Menge 1', () => {
    const a = abrechnung();
    const p = gutschriftPlan({ abrechnung: a, mwstProzent: 19, kontaktId: KONTAKT, voucherDate: 'D' });
    expect(p.probleme).toEqual([]);
    expect(p.summen.brutto).toBe(Math.round(a.brutto * 100));
    const items = p.payload.lineItems;
    expect(Math.round(items.reduce((s, x) => s + x.quantity * Math.round(x.unitPrice.grossAmount * 100), 0))).toBe(Math.round(a.brutto * 100));
    expect(items.every(x => x.type === 'custom' && x.unitPrice.taxRatePercentage === 19 && x.unitName === 'Stück')).toBe(true);
    expect(p.payload.taxConditions).toEqual({ taxType: 'gross' });
    expect(p.zeilen.map(z => z.art)).toEqual(['verkauf', 'verkauf', 'verkauf', 'festpreis', 'festpreis', 'festpreis', 'paypal', 'handling', 'porto', 'intern', 'verpackung']);
    expect(p.zeilen.map(z => z.name).slice(0, 4)).toEqual(['Muster-Puck', 'Muster-Shirt - L', 'Muster-Mütze', 'Muster-Puck interner Preis']);
    expect(p.zeilen.filter(z => ['festpreis', 'paypal', 'handling'].includes(z.art)).every(z => z.cent < 0)).toBe(true);
    expect(p.payload.remark).toBe('Mit freundlichen Grüßen.');
    expect(items.find(x => x.name === 'Porto Saldo').description).toBe('tatsächliche Versandkosten abzgl. Portoeinnahmen');
    expect(p.zeilen.find(z => z.art === 'intern').cent).toBe(1000);       // negative interne Bestellung = Gutschrift an den Partner
    expect(p.zeilen.find(z => z.art === 'verpackung').cent).toBe(-150);
  });
  test('viele erfundene Abrechnungen: Summe immer genau (Rundungsrest auf die groesste Zeile)', () => {
    let s = 7;
    const zufall = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 300; i++) {
      const gruppen = Array.from({ length: 1 + Math.floor(zufall() * 40) }, (_, j) => [`Artikel ${j}`, 1 + Math.floor(zufall() * 9), Math.round((zufall() * 80 - 5) * 100) / 100]);
      const pos = positionen({ gruppen, porto: Math.round((zufall() * 40 - 30) * 100) / 100, intern: zufall() > 0.5 ? [['01.05.2026', 'x', Math.round(zufall() * 30 * 100) / 100]] : [], verpackung: zufall() > 0.5 ? 2.5 : 0 });
      const a = abrechnung({}, pos);
      const p = gutschriftPlan({ abrechnung: a, mwstProzent: 19, kontaktId: KONTAKT, voucherDate: 'D' });
      if (a.brutto <= 0) { expect(p.probleme.join()).toMatch(/nicht positiv/); continue; }
      expect(p.summen.brutto).toBe(Math.round(a.brutto * 100));
      expect(Math.abs(p.ausgleich)).toBeLessThanOrEqual(p.zeilen.length);
      expect(p.payload.lineItems.reduce((s2, x) => s2 + x.quantity * Math.round(x.unitPrice.grossAmount * 100), 0)).toBe(Math.round(a.brutto * 100));
    }
  });
  test('Zeitraum im Einleitungstext, Titel Rechnungsgutschrift', () => {
    const p = gutschriftPlan({ abrechnung: abrechnung(), mwstProzent: 19, kontaktId: KONTAKT, voucherDate: 'D' });
    expect(p.payload.title).toBe('Rechnungsgutschrift');
    expect(p.payload.introduction).toBe('Folgende Lieferungen/Leistungen schreiben wir Ihnen gut. Für Shop Verkäufe zwischen 01.04.2026 und 30.06.2026');
    expect(einleitung('a', 'b')).toMatch(/zwischen a und b$/);
    expect(p.payload).not.toHaveProperty('precedingSalesVoucherId');
  });
  test('Entwurfs-Abrechnung, Kennzeichen, ohne JSON, ohne Kontakt, falsche Summe -> Probleme', () => {
    const plan = a => gutschriftPlan({ abrechnung: a, mwstProzent: 19, kontaktId: KONTAKT, voucherDate: 'D' }).probleme.join(' | ');
    expect(plan(abrechnung({ status: 'entwurf' }))).toMatch(/noch ein Entwurf/);
    expect(plan(abrechnung({ Gutschrift_Status: 'unklar' }))).toMatch(/schon angelegt/);
    expect(plan(abrechnung({ positionen: '' }))).toMatch(/alter Stand/);
    expect(plan(abrechnung({ brutto: 1 }))).toMatch(/weicht/);
    expect(gutschriftPlan({ abrechnung: abrechnung(), mwstProzent: 19, kontaktId: '', voucherDate: 'D' }).probleme.join()).toMatch(/nicht mit einem Lexoffice-Kunden/);
    expect(gutschriftPlan({ abrechnung: abrechnung(), mwstProzent: null, kontaktId: KONTAKT, voucherDate: 'D' }).probleme.join()).toMatch(/MwSt/);
    expect(abrechnungGrund(abrechnung({ status: 'freigegeben' }))).toBe('');
    expect(abrechnungGrund(abrechnung({ status: 'bezahlt' }))).toMatch(/schon bezahlt/);
  });
  test('Hilfen: Datum, Cent, Belegart, Kennzeichen, Chat ohne Betraege', () => {
    expect(deDatum(46020)).toBe('29.12.2025');
    expect(deDatum('31.03.2026')).toBe('31.03.2026');
    expect(inCent('1.234,50')).toBe(123450);
    expect(inCent(12.345)).toBe(1235);
    expect(belegartAus('')).toBe('creditnote');
    expect(() => belegartAus('invoice')).toThrow(/nicht unterstützt/);
    expect(() => kennzeichenPlan({ abrechnung: { id: 'FPA-1', Gutschrift_Status: '' }, aktion: 'zuruecksetzen' })).toThrow(/kein Gutschrift-Kennzeichen/);
    expect(kennzeichenPlan({ abrechnung: { Gutschrift_Status: 'unklar' }, aktion: 'angelegt', lexwareId: ID })).toEqual({ id: ID });
    expect(() => kennzeichenPlan({ abrechnung: { Gutschrift_Status: 'entwurf' }, aktion: 'angelegt', lexwareId: ID })).toThrow(/Nur ein unklares/);
    expect(chatText({ ergebnis: 'unklar', abrechnungId: 'FPA-0009', partnerId: 'FP-009' })).toMatch(/^⚠️ Lexware-Gutschrift UNKLAR.*FPA-0009 \(FP-009\)/);
    expect(abrechnungAus(KOPF, ['FPA-0001', 'FP-001', 46020, 46112, 1, 2, '', 46199, '{}', ID, '2026-11-22', 'entwurf']))
      .toMatchObject({ von: '29.12.2025', bis: '31.03.2026', status: 'entwurf', Gutschrift_Lexware_ID: ID, Gutschrift_Status: 'entwurf' });
  });
});

test('Menge = Stück nur, wenn der Betrag glatt aufgeht; sonst 1 + "n Stück"', () => {
  expect(lineItem({ name: 'Shirts', stueck: 4, cent: 9600 }, 19)).toMatchObject({ quantity: 4, unitPrice: { grossAmount: 24 } });
  expect(lineItem({ name: 'Shirts', stueck: 3, cent: 1000 }, 19)).toMatchObject({ quantity: 1, unitPrice: { grossAmount: 10 }, description: '3 Stück' });
  expect(lineItem({ name: 'Porto Saldo', beschreibung: 'x', cent: -500 }, 19)).toMatchObject({ quantity: 1, description: 'x' });
});

describe('Lexware-Schreibweg Gutschrift (Attrappe)', () => {
  const antwort = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  test('genau EIN POST auf /v1/credit-notes ohne finalize; 2xx mit id = angelegt', async () => {
    const aufrufe = [];
    const f = async (url, o) => { aufrufe.push([url, o.method]); return antwort(201, { id: ID }); };
    expect(await legeGutschriftsentwurfAn({ payload: {}, schluessel: 's', fetchFn: f, mitTakt: false })).toEqual({ ergebnis: 'angelegt', id: ID });
    expect(aufrufe).toEqual([['https://api.lexware.io/v1/credit-notes', 'POST']]);
  });
  test.each([
    ['5xx', 'unklar', async () => antwort(503, {})],
    ['2xx ohne id', 'unklar', async () => antwort(200, {})],
    ['Netzfehler', 'unklar', async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); }],
    ['400', 'nicht', async () => ({ ...antwort(400, {}), json: async () => ({ IssueList: [{ source: 'lineItems[0].unitPrice' }] }) })],
    ['429', 'nicht', async () => antwort(429, {})],
    ['403', 'nicht', async () => antwort(403, {})],
  ])('%s -> %s, kein zweiter Versuch', async (_, ergebnis, fn) => {
    let n = 0;
    const r = await legeGutschriftsentwurfAn({ payload: {}, schluessel: 'geheim-1', fetchFn: async (...a) => { n++; return fn(...a); }, mitTakt: false });
    expect(r.ergebnis).toBe(ergebnis);
    expect(n).toBe(1);
    expect(JSON.stringify(r)).not.toContain('geheim-1');
  });
  test('Schluessel fehlt -> 503, nicht in SECRET_KEYS', async () => {
    await expect(gutschriftSchluessel(async () => '')).rejects.toMatchObject({ status: 503, code: 'lexware_gutschriften' });
    expect(SECRET_KEYS).not.toContain('LEXWARE_API_KEY_RECHNUNGEN');
    const q = readFileSync(resolve(hier, '../lib/lexwareGutschrift.js'), 'utf8');
    expect(q).toContain('SCHLUESSEL_GUTSCHRIFTEN = SCHLUESSEL_RECHNUNGEN');
  });
  test('Quelltext: kein finalize, kein PUT/PATCH/DELETE, Host nur ueber BASIS', () => {
    const q = readFileSync(resolve(hier, '../lib/lexwareGutschrift.js'), 'utf8');
    expect(q).not.toMatch(/finalize=|'PUT'|'PATCH'|'DELETE'|precedingSalesVoucherId=/);
    expect(q).not.toContain('api.lexware.io');
    expect((q.match(/method: 'POST'/g) || []).length).toBe(1);
  });
  test('Nachsehen: Belegliste creditnote, nur GET', async () => {
    const aufrufe = [];
    await sucheEntwuerfe({ kontaktId: KONTAKT, seit: '2026-11-22', voucherType: 'creditnote', schluessel: 's', fetchFn: async (u, o) => { aufrufe.push([u, o.method]); return antwort(200, { content: [] }); } });
    expect(aufrufe[0][1]).toBe('GET');
    expect(aufrufe[0][0]).toMatch(/voucherlist\?voucherType=creditnote&voucherStatus=draft&contactId=/);
  });
});

describe('Anlegen mit In-Memory-Sheet', () => {
  function tabs(zeile = {}) {
    const a = abrechnung(zeile);
    const z = KOPF.map(k => ({
      'Abrechnungs-ID': a.id, 'Partner-ID': a.partnerId, 'Zeitraum-Von': a.von, 'Zeitraum-Bis': a.bis, 'Gesamt-Netto': Math.round(a.brutto / 1.19 * 100) / 100,
      'Gesamt-Brutto': a.brutto, Status: a.status, 'Erstellt-Am': '01.07.2026', Positionen: a.positionen,
      Gutschrift_Lexware_ID: zeile.Gutschrift_Lexware_ID ?? '', Gutschrift_Am: zeile.Gutschrift_Am ?? '', Gutschrift_Status: zeile.Gutschrift_Status ?? '',
    })[k]);
    return {
      FP_Abrechnungen: [KOPF, z],
      FP_Partner: [['Partner-ID', 'Name', 'Kunden_Nr'], ['FP-009', 'Musterverein', 'K-00900']],
      Kalkulation_Fixkosten: [['Position', 'Wert', 'Gültig_ab'], ['MwSt', '19', '01.01.2024']],
      [TAB_KUNDEN]: [KUNDEN_SPALTEN, KUNDEN_SPALTEN.map(s => ({ Kunden_Nr: 'K-00900', Lexoffice_ID: KONTAKT, Name: 'Musterverein', Status: 'aktiv', Art: 'Verein' })[s] ?? '')],
    };
  }
  const kz = t => GUTSCHRIFT_SPALTEN.map(s => t.FP_Abrechnungen[1][KOPF.indexOf(s)]);
  const brutto = t => Math.round(t.FP_Abrechnungen[1][5] * 100);
  const opts = (senden, melden = async () => {}) => ({ jetzt, senden, melden, schluesselLesen: async () => 's' });
  beforeEach(() => { process.env.BUSINESS_SHEET_ID = 'business-test'; process.env.KUNDEN_SHEET_ID = 'kunden-test'; _kundenCacheLeeren(); });

  test('Vorschau: Summe = Auszahlung, Kontakt ueber Kunden_Nr, schreibt nichts', async () => {
    const t = tabs(); const { sheets, aufrufe } = machSheets(t);
    const v = await gutschriftVorschau({ id: 'FPA-0009', sheets, jetzt, bereit: async () => true });
    expect(v.probleme).toEqual([]);
    expect(v.summen.brutto).toBe(v.abrechnung.bruttoCent);
    expect(v.kundenNr).toBe('K-00900');
    expect(v.einleitung).toMatch(/zwischen 01\.04\.2026 und 30\.06\.2026$/);
    expect(aufrufe.batchUpdate).toEqual([]);
  });
  test('angelegt: Kennzeichen entwurf + ID, genau ein Aufruf; zweiter Versuch 409, kein Aufruf', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    let n = 0, payload = null;
    const r = await gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t) }, sheets, ...opts(async o => { n++; payload = o.payload; return { ergebnis: 'angelegt', id: ID }; }) });
    expect(r).toMatchObject({ ok: true, ergebnis: 'angelegt', id: ID, link: `https://app.lexware.de/permalink/credit-notes/edit/${ID}` });
    expect(n).toBe(1);
    expect(kz(t)).toEqual([ID, '2026-11-22', 'entwurf']);
    expect(payload.address).toEqual({ contactId: KONTAKT });
    expect(payload.lineItems.reduce((s, x) => s + x.quantity * Math.round(x.unitPrice.grossAmount * 100), 0)).toBe(brutto(t));
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t) }, sheets, ...opts(async () => { n++; return {}; }) }))
      .rejects.toMatchObject({ status: 409, code: 'schon' });
    expect(n).toBe(1);
  });
  test('unklar: Kennzeichen bleibt, Chat ohne Betraege/Namen, Knopf danach gesperrt', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    const chat = [];
    const r = await gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t) }, sheets, ...opts(async () => ({ ergebnis: 'unklar', grund: 'Zeitlimit 30 s' }), async x => chat.push(x)) });
    expect(r).toMatchObject({ ok: false, ergebnis: 'unklar' });
    expect(kz(t)).toEqual(['', '2026-11-22', 'unklar']);
    expect(chat[0]).toMatch(/UNKLAR/);
    expect(chat[0]).not.toMatch(/€|Muster|\d+,\d\d/);
    let n = 0;
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t) }, sheets, ...opts(async () => { n++; return {}; }) })).rejects.toMatchObject({ status: 409 });
    expect(n).toBe(0);
    const l = await gutschriftListe({ sheets, bereit: async () => true });
    expect(l.abrechnungen[0]).toMatchObject({ grund: 'Gutschrift schon angelegt', gutschrift: { status: 'unklar' } });
  });
  test('nicht angelegt (400): Kennzeichen wieder leer', async () => {
    const t = tabs(); const { sheets } = machSheets(t);
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t) }, sheets, ...opts(async () => ({ ergebnis: 'nicht', status: 400, grund: 'abgelehnt' })) }))
      .rejects.toMatchObject({ status: 422, code: 'lexware' });
    expect(kz(t)).toEqual(['', '', '']);
  });
  test('Entwurfs-Abrechnung gesperrt, Brutto geaendert 409 - nie gesendet, nichts geschrieben', async () => {
    let n = 0;
    const senden = async () => { n++; return { ergebnis: 'angelegt', id: ID }; };
    const t1 = tabs({ status: 'entwurf' }); const m1 = machSheets(t1);
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t1) }, sheets: m1.sheets, ...opts(senden) })).rejects.toMatchObject({ status: 422, code: 'probleme' });
    const t2 = tabs(); const m2 = machSheets(t2);
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: 1 }, sheets: m2.sheets, ...opts(senden) })).rejects.toMatchObject({ status: 409, code: 'konflikt' });
    expect(n).toBe(0);
    expect(m1.aufrufe.batchUpdate).toEqual([]); expect(m2.aufrufe.batchUpdate).toEqual([]);
  });
  test('Schluessel fehlt -> 503 vor jedem Schreiben', async () => {
    const t = tabs(); const { sheets, aufrufe } = machSheets(t);
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(t) }, sheets, jetzt, senden: async () => ({}), schluesselLesen: () => gutschriftSchluessel(async () => '') }))
      .rejects.toMatchObject({ status: 503 });
    expect(aufrufe.batchUpdate).toEqual([]);
  });
  test('ohne Kunden_Nr: Vorschau nennt den Grund, Anlegen 422', async () => {
    const t = tabs(); t.FP_Partner[1][2] = ''; const { sheets } = machSheets(t);
    const v = await gutschriftVorschau({ id: 'FPA-0009', sheets, jetzt, bereit: async () => true });
    expect(v.probleme[0]).toMatch(/keine Kunden_Nr/);
  });
  test('unklar -> von Hand angelegt bzw. zuruecksetzen; Nachsehen liest Gutschriften des Kontakts', async () => {
    const t = tabs({ Gutschrift_Status: 'unklar', Gutschrift_Am: '2026-11-22' }); const { sheets } = machSheets(t);
    const ns = await gutschriftNachsehen({ id: 'FPA-0009', sheets, suche: async o => ({ ok: true, entwuerfe: [{ id: ID, o }] }) });
    expect(ns.entwuerfe[0].o).toMatchObject({ kontaktId: KONTAKT, seit: '2026-11-22', voucherType: 'creditnote' });
    await gutschriftKennzeichen({ eingabe: { id: 'FPA-0009', aktion: 'angelegt', lexwareId: ID }, sheets });
    expect(kz(t)).toEqual([ID, '2026-11-22', 'entwurf']);
    await gutschriftKennzeichen({ eingabe: { id: 'FPA-0009', aktion: 'zuruecksetzen' }, sheets });
    expect(kz(t)).toEqual(['', '', '']);
  });
  test('Spalten fehlen -> 409 einrichtung', async () => {
    const t = tabs();
    t.FP_Abrechnungen = t.FP_Abrechnungen.map(z => z.slice(0, 9));
    const { sheets } = machSheets(t);
    await expect(gutschriftAnlegen({ eingabe: { id: 'FPA-0009', bruttoCent: brutto(tabs()) }, sheets, ...opts(async () => ({})) })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
});
