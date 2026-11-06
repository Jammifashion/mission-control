// TR6: interne Trikotbestellung in MC (utils/trikot-intern.js, lib/trikotIntern.js). Nur ERFUNDENE Daten.

import { jest } from '@jest/globals';
import { machSheets } from './hilfen/korb-sheet.js';
import { TRIKOT_HEADER, shopBestelldaten, startOhneAfter } from '../utils/trikot-logic.js';
import { naechsteIntNummern, rohtextLesen, anlagePlan, aenderungPlan, schonAngelegt, bearbeitbar } from '../utils/trikot-intern.js';
import { trikotZeilen, baueTrikotAnsicht } from '../utils/trikot-ansicht.js';
import { legeInterneTrikotsAn, aendereInternesTrikot, internAuswahl, _trikotInternCacheLeeren } from '../lib/trikotIntern.js';

const KOPF = [...TRIKOT_HEADER, 'Ersetzt'];
const zeile = o => KOPF.map(s => o[s] ?? '');
const SHOP = (id, datum, extra = {}) => zeile({ 'Zeilen-ID': `${id}|1|1`, Bestelldatum: datum, 'Order-ID': id, 'Order-Item-ID': '1', Produktname: 'Testverein Heimtrikot', Groesse: 'M', Name: 'MUSTER', Nummer: '7', Stueck: '1', Quelle: 'variante', ...extra });
const HAND = (id, extra = {}) => zeile({ 'Zeilen-ID': id, Produktname: 'Testverein Heimtrikot', Groesse: 'L', Quelle: 'intern', Stueck: '1', ...extra });
const PRODUKTE = new Map([['111', { produktId: '111', name: 'Testverein Heimtrikot', sku: 'HEIM-T', kurz: 'Heim' }], ['222', { produktId: '222', name: 'Testverein Auswärtstrikot', sku: 'AUS-T', kurz: 'Auswärts' }]]);
const wc = { get: jest.fn(async pfad => ({ data: { id: pfad.split('/')[1], name: pfad.endsWith('111') ? 'Testverein Heimtrikot' : 'Testverein Auswärtstrikot', sku: pfad.endsWith('111') ? 'HEIM-T' : 'AUS-T' } })) };
const JETZT = new Date('2026-11-06T10:00:00Z');
const V = n => `vorgang-tr-${String(n).padStart(4, '0')}`;

function tabs() {
  return {
    Trikots: [KOPF, SHOP('50001', '2026-10-20T09:00:00'), SHOP('50002', '2026-11-01T09:00:00'), HAND('INT-2026-0002', { Charge: 3 }), HAND('INT-2025-0009')],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['', '111', '', 'TRUE'], ['', '222', '', 'TRUE']],
  };
}
beforeEach(() => { process.env.BUSINESS_SHEET_ID = 'biz'; _trikotInternCacheLeeren(); wc.get.mockClear(); });

describe('INT-Nummer und Zeilen', () => {
  test('fortlaufend je Jahr, eindeutig auch gegen Handzeilen (Luecken bleiben)', () => {
    expect(naechsteIntNummern(['INT-2026-0002', 'INT-2025-0009', '50001|1|1', ''], '2026', 3)).toEqual(['INT-2026-0003', 'INT-2026-0004', 'INT-2026-0005']);
    expect(naechsteIntNummern([], '2027')).toEqual(['INT-2027-0001']);
  });
  test('Spalten wie TK1: Quelle intern, ohne Order-ID/Kunde, Bestelldatum Text, Stueck 1, P-T und Zahlart leer', () => {
    const t = tabs();
    const p = anlagePlan({ werte: t.Trikots, produkte: PRODUKTE, heute: '2026-11-06', erfasstAm: '2026-11-06T11:00:00', vorgang: V(1), referenz: 'AU-2026-0003',
      trikots: [{ produktId: '111', groesse: 'm', name: ' Muster ', nummer: '7', notiz: 'Kapitän' }, { produktId: '222', groesse: '120', name: '', nummer: '' }] });
    expect(p.ids).toEqual(['INT-2026-0003', 'INT-2026-0004']);
    const o = p.zeilen.map(z => Object.fromEntries(KOPF.map((k, i) => [k, z[i]])));
    expect(o[0]).toMatchObject({ 'Zeilen-ID': 'INT-2026-0003', Bestelldatum: '2026-11-06', 'Order-ID': '', 'Order-Item-ID': '', Kunde: '', Artikelnummer: 'HEIM-T',
      Produktname: 'Testverein Heimtrikot', Groesse: 'M', Name: 'Muster', Nummer: '7', Stueck: 1, Quelle: 'intern', Charge: '', Bestellt_Am: '', Geliefert_Am: '', Status: '', Notiz: '', Zahlart: '' });
    expect(rohtextLesen(o[0].Rohtext)).toEqual({ referenz: 'AU-2026-0003', notiz: 'Kapitän', vorgang: `${V(1)}-1` });
    expect(o[1]).toMatchObject({ Groesse: '120', Produktname: 'Testverein Auswärtstrikot' });
    expect(() => anlagePlan({ werte: t.Trikots, produkte: PRODUKTE, heute: '2026-11-06', erfasstAm: '', vorgang: V(1), trikots: [{ produktId: '999', groesse: 'M' }] })).toThrow(/Heim oder Auswärts/);
    expect(() => anlagePlan({ werte: t.Trikots, produkte: PRODUKTE, heute: '2026-11-06', erfasstAm: '', vorgang: V(1), trikots: [{ produktId: '111', groesse: 'M', nummer: '7a' }] })).toThrow(/Nummer/);
  });
});

describe('Schreiben (In-Memory-Sheet)', () => {
  test('mehrere Trikots in einem Schritt, kein append; Sync-Startpunkt unveraendert; Doppelklick', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    const vorher = { s: shopBestelldaten(t.Trikots, '2026-11-06'), start: startOhneAfter(t.Trikots, '2026-11-06') };
    const r = await legeInterneTrikotsAn({ sheets, wc, jetzt: JETZT, vorgang: V(2), referenz: 'Vereinsfeier', trikots: [{ produktId: '111', groesse: 'L', name: 'Erika', nummer: '9' }, { produktId: '111', groesse: 'XL' }] });
    expect(r).toEqual({ ok: true, schon: false, ids: ['INT-2026-0003', 'INT-2026-0004'] });
    expect(t.Trikots).toHaveLength(7);
    expect(aufrufe.append).toBe(0);
    expect(shopBestelldaten(t.Trikots, '2026-11-06')).toEqual(vorher.s);           // TK1: Handzeilen zaehlen nie
    expect(startOhneAfter(t.Trikots, '2026-11-06')).toBe(vorher.start);
    expect(await legeInterneTrikotsAn({ sheets, wc, jetzt: JETZT, vorgang: V(2), trikots: [{ produktId: '111', groesse: 'L' }] })).toEqual({ ok: true, schon: true, ids: ['INT-2026-0003', 'INT-2026-0004'] });
    expect(t.Trikots).toHaveLength(7);
    expect(schonAngelegt(t.Trikots, V(9))).toEqual([]);
  });
  test('gleichzeitig: zweiter Aufruf waehrend der Sperre -> 409, keine doppelte Nummer', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const [a, b] = await Promise.allSettled([
      legeInterneTrikotsAn({ sheets, wc, jetzt: JETZT, vorgang: V(3), trikots: [{ produktId: '111', groesse: 'L' }] }),
      legeInterneTrikotsAn({ sheets, wc, jetzt: JETZT, vorgang: V(4), trikots: [{ produktId: '111', groesse: 'M' }] }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.reason).toMatchObject({ status: 409, code: 'laeuft_gerade' });
  });
  test('neue Zeilen stehen unter "noch nicht beim Produzenten", Referenz AU-… lesbar, kein MC-Vorgang in der Anzeige', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeInterneTrikotsAn({ sheets, wc, jetzt: JETZT, vorgang: V(5), referenz: 'AU-2026-0003', trikots: [{ produktId: '222', groesse: '130', name: 'Muster', nummer: '4' }] });
    const a = baueTrikotAnsicht(trikotZeilen(t.Trikots));
    const neu = a.gruppen[0].zeilen.find(x => x.id === 'INT-2026-0003');
    expect(neu).toMatchObject({ intern: true, bearbeitbar: true, referenz: 'AU-2026-0003', produktKurz: 'Auswärts' });
    expect(JSON.stringify(neu.kundenangabe)).not.toMatch(/MC-Vorgang/);
  });
  test('Bearbeiten und Entfernen nur ohne Charge; Entfernen = Status storniert, Zeile bleibt; Ansicht/Formular lassen sie aus', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeInterneTrikotsAn({ sheets, wc, jetzt: JETZT, vorgang: V(6), referenz: 'AU-2026-0003', trikots: [{ produktId: '111', groesse: 'L', name: 'A', nummer: '1', notiz: 'alt' }] });
    const z = t.Trikots.findIndex(r => r[0] === 'INT-2026-0003') + 1;
    await aendereInternesTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: 'INT-2026-0003', zeile: z }, trikot: { produktId: '111', groesse: 'XL', name: 'B', nummer: '2', notiz: 'neu' } });
    const w = s => t.Trikots[z - 1][KOPF.indexOf(s)];
    expect([w('Groesse'), w('Name'), w('Nummer')]).toEqual(['XL', 'B', '2']);
    expect(rohtextLesen(w('Rohtext'))).toEqual({ referenz: 'AU-2026-0003', notiz: 'neu', vorgang: `${V(6)}-1` });   // Referenz/Vorgang bleiben
    await expect(aendereInternesTrikot({ sheets, wc, aktion: 'aendern', ziel: { id: 'INT-2026-0002', zeile: 4 }, trikot: { produktId: '111', groesse: 'M' } })).rejects.toMatchObject({ status: 409, code: 'gesperrt' });   // Charge gesetzt
    await expect(aendereInternesTrikot({ sheets, wc, aktion: 'entfernen', ziel: { id: '50001|1|1', zeile: 2 } })).rejects.toMatchObject({ code: 'gesperrt' });   // Shop-Zeile
    await expect(aendereInternesTrikot({ sheets, wc, aktion: 'entfernen', ziel: { id: 'INT-2026-0003', zeile: z + 1 } })).rejects.toMatchObject({ code: 'konflikt' });
    await aendereInternesTrikot({ sheets, wc, aktion: 'entfernen', ziel: { id: 'INT-2026-0003', zeile: z } });
    expect(w('Status')).toBe('storniert');
    expect(t.Trikots).toHaveLength(6);   // nie geloescht
    const a = baueTrikotAnsicht(trikotZeilen(t.Trikots));
    expect(a.gruppen[0].zeilen.map(x => x.id)).not.toContain('INT-2026-0003');
    expect(a.gruppen.at(-1)).toMatchObject({ storniert: true, anzahl: 1 });
    expect(a.summen).toMatchObject({ entfernt: 1 });
    expect(bearbeitbar({ id: 'INT-2026-0003', quelle: 'intern', charge: '', status: 'storniert' })).toMatch(/entfernt/);
  });
  test('Auswahl: Heim/Auswaerts aus Trikot_Artikel + Shop, Groessen Kinder (cm) und Erwachsene', async () => {
    const { sheets } = machSheets(tabs());
    const r = await internAuswahl({ sheets, wc });
    expect(r.produkte.map(p => p.kurz)).toEqual(['Heim', 'Auswärts']);
    expect(r.groessen.kinder).toEqual(expect.arrayContaining(['90', '120', '150']));
    expect(r.groessen.erwachsene.slice(0, 4)).toEqual(['XS', 'S', 'M', 'L']);
  });
  test('Log: nur Zeilen-IDs, nie Name oder Referenz', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { default: router } = await import('../routes/bestellen.js');
      expect(router).toBeTruthy();
      const quelle = (await import('fs')).readFileSync(new URL('../routes/bestellen.js', import.meta.url), 'utf8');
      const teil = quelle.slice(quelle.indexOf('// ── TR6: interne Trikotbestellung'), quelle.indexOf("router.post('/trikots/wareneingang'"));
      expect(teil).not.toMatch(/console\.log\([^)]*\$\{[^}]*(referenz|name|nummer|trikot\b|body)/i);   // nur ${r.ids} / ${r.id}
      expect(teil.match(/console\.log\(/g)).toHaveLength(3);
    } finally { log.mockRestore(); }
  });
});

describe('Plan direkt', () => {
  test('aenderungPlan: unveraendert bei gleichen Werten', () => {
    const t = tabs();
    const p = anlagePlan({ werte: t.Trikots, produkte: PRODUKTE, heute: '2026-11-06', erfasstAm: '', vorgang: V(7), trikots: [{ produktId: '111', groesse: 'L', name: 'A', nummer: '1' }] });
    t.Trikots.push(p.zeilen[0]);
    const r = aenderungPlan({ werte: t.Trikots, ziel: { id: p.ids[0], zeile: t.Trikots.length }, aktion: 'aendern', trikot: { produktId: '111', groesse: 'l', name: 'A', nummer: '1' }, produkte: PRODUKTE });
    expect(r.unveraendert).toBe(true);
  });
});
