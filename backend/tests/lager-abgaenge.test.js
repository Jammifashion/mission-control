// BO5-5: Abgaenge vor Ort/Events, eigene Auftraege, Partner/Muster - Bezug je Art, Events, Sammelausbuchen,
// Auswertung, Wrist vorgewaehlt. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  TAB_BUCHUNGEN, TAB_ARTIKEL, TAB_ORTE, TAB_EVENTS, BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN, EVENT_SPALTEN,
  warenartVon, planBuchung, planNeuesEvent, bezugRegel, eventVorschlag, abgaengeAuswertung,
} from '../utils/lager.js';
import { reiterPlan, orteFehlend } from '../utils/lager-setup.js';
import { bucheLager, neuesEvent, leseBestand, leseAbgaenge, sucheFertig, lagerCacheLeeren, _stammCacheLeeren, _partnerCacheLeeren } from '../lib/lager.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { machSheets, grundTabs, NR, NR2 } from './hilfen/korb-sheet.js';

const JETZT = new Date('2026-11-05T15:00:00Z');
const V = n => `vorgang-ab-${String(n).padStart(4, '0')}`;
const LS = `LS:${NR}`, LS2 = `LS:${NR2}`;
const b = (id, schluessel, menge, ort, extra = {}) => ({ id, datum: '2026-11-01T08:00:00Z', art: 'vorrat', warenart: warenartVon(schluessel),
  schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', vorgang: `v-${id}-xxxxxx`, ...extra });
const EVENTS = [{ id: 'EV-0001', name: 'Halloween Markt', datum: '2026-10-31', ort: 'Marktplatz', status: 'offen' },
  { id: 'EV-0002', name: 'Sommerfest', datum: '2026-07-01', ort: '', status: 'abgeschlossen' }];
const PARTNER = [{ id: 'P-001', name: 'Partner Eins' }];

describe('Bezug je Abgangsart', () => {
  const k = { events: EVENTS, partner: PARTNER };
  test.each([
    ['abgang_vorort', 'EV-0001', true], ['abgang_vorort', '', /Event wählen/], ['abgang_vorort', 'EV-0009', /gibt es nicht/],
    ['abgang_vorort', 'EV-0002', /abgeschlossen/],
    ['abgang_auftrag', 'Verein X Auftrag 12', true], ['abgang_auftrag', 'x', /Auftragsreferenz/],
    ['abgang_partner', 'P-001', true], ['abgang_partner', 'P-999', /nicht in der Partnerliste/], ['abgang_partner', '', /Partner wählen/],
    ['abgang_partner', 'Muster: Verein X', true], ['abgang_partner', 'Muster: ', /Muster bekommt/],
    ['abgang_shop', '', true], ['abgang_shop', '21593', true],
  ])('%s "%s"', (art, bezug, soll) => {
    const r = bezugRegel(art, bezug, k);
    if (soll === true) expect(r).toBe(true); else expect(r).toMatch(soll);
  });
});

describe('Events', () => {
  test('neues Event: EV-Nummer hoechste + 1, offen; gleicher Name + Datum = das vorhandene', () => {
    const p = planNeuesEvent({ name: '  Weihnachts  Markt ', datum: '2026-12-05', ort: 'Wrist' }, EVENTS);
    expect(p).toMatchObject({ id: 'EV-0003', zeile: { Event_ID: 'EV-0003', Name: 'Weihnachts Markt', Datum: '2026-12-05', Ort: 'Wrist', Status: 'offen' } });
    expect(planNeuesEvent({ name: 'halloween markt', datum: '2026-10-31' }, EVENTS)).toMatchObject({ vorhanden: 'EV-0001' });
    expect(planNeuesEvent({ name: 'X', datum: '31.10.2026' }, EVENTS).probleme.map(p => p.code)).toEqual(['name', 'datum']);
  });
  test('Vorschlag: Event der juengsten Vor-Ort-Buchung, wenn offen; sonst neuestes offenes', () => {
    const ev3 = { id: 'EV-0003', name: 'Neu', datum: '2026-11-20', status: 'offen' };
    expect(eventVorschlag([b('LB-2026-00002', LS, -1, 'Wrist', { art: 'abgang_vorort', bezug: 'EV-0001', datum: '2026-11-01T10:00:00Z' })], [...EVENTS, ev3])).toBe('EV-0001');
    expect(eventVorschlag([b('LB-2026-00002', LS, -1, 'Wrist', { art: 'abgang_vorort', bezug: 'EV-0002' })], [...EVENTS, ev3])).toBe('EV-0003');
    expect(eventVorschlag([], [])).toBe('');
  });
});

describe('Sammelausbuchen (planBuchung)', () => {
  const lager = [b('LB-2026-00001', LS, 5, 'Wrist'), b('LB-2026-00002', LS, 2, 'Itzehoe'), b('LB-2026-00003', LS2, 1, 'Wrist')];
  const k = { buchungen: lager, orte: ['Wrist', 'Itzehoe'], bezugPruefen: (art, bz) => bezugRegel(art, bz, { events: EVENTS, partner: PARTNER }), jetzt: JETZT };
  const e = o => ({ aktion: 'ausbuchen', art: 'abgang_vorort', bezug: 'EV-0001', ort: 'Wrist', vorgang: V(1), ...o });

  test('mehrere Artikel, je Zeile ein Ort, ein Vorgang, Bezug an jeder Zeile', () => {
    const p = planBuchung(e({ posten: [{ schluessel: LS, menge: 3, ort: 'Wrist' }, { schluessel: LS, menge: 2, ort: 'Itzehoe' }, { schluessel: LS2, menge: 1 }] }), k);
    expect(p.probleme).toEqual([]);
    expect(p.zeilen.map(z => [z.Schluessel, z.Ort, z.Menge, z.Art, z.Bezug, z.Vorgang])).toEqual([
      [LS, 'Wrist', -3, 'abgang_vorort', 'EV-0001', V(1)], [LS, 'Itzehoe', -2, 'abgang_vorort', 'EV-0001', V(1)], [LS2, 'Wrist', -1, 'abgang_vorort', 'EV-0001', V(1)]]);
  });
  test('alles oder nichts: eine Zeile ueber den Bestand ihres Orts -> nichts', () => {
    const p = planBuchung(e({ posten: [{ schluessel: LS, menge: 3, ort: 'Wrist' }, { schluessel: LS, menge: 3, ort: 'Itzehoe' }] }), k);
    expect(p.zeilen).toEqual([]);
    expect(p.probleme[0]).toMatchObject({ code: 'bestand', da: 2 });
  });
  test('gleicher Artikel am selben Ort zweimal in der Liste = doppelt; anderer Ort ist erlaubt', () => {
    expect(planBuchung(e({ posten: [{ schluessel: LS, menge: 1, ort: 'Wrist' }, { schluessel: LS, menge: 1, ort: 'Wrist' }] }), k).probleme[0].code).toBe('doppelt');
  });
  test('unbekannter Ort in einer Zeile, fehlender Bezug, Partner/Muster/Auftrag', () => {
    expect(planBuchung(e({ posten: [{ schluessel: LS, menge: 1, ort: 'Regal A' }] }), k).probleme[0].code).toBe('ort');
    expect(planBuchung(e({ bezug: '', posten: [{ schluessel: LS, menge: 1 }] }), k).probleme[0].code).toBe('bezug');
    expect(planBuchung(e({ art: 'abgang_partner', bezug: 'Muster: Verein X', posten: [{ schluessel: LS, menge: 1 }] }), k).zeilen[0].Bezug).toBe('Muster: Verein X');
    expect(planBuchung(e({ art: 'abgang_auftrag', bezug: 'Auftrag 12', posten: [{ schluessel: LS, menge: 1 }] }), k).zeilen[0].Art).toBe('abgang_auftrag');
  });
  test('Einbuchen kennt keinen eigenen Ort je Zeile (nur Ausbuchen)', () => {
    const p = planBuchung({ aktion: 'einbuchen', art: 'vorrat', ort: 'Wrist', vorgang: V(2), posten: [{ schluessel: LS, menge: 1, ort: 'Itzehoe' }] }, k);
    expect(p.zeilen[0].Ort).toBe('Wrist');
  });
});

describe('Auswertung Abgaenge', () => {
  const bs = [
    b('LB-2026-00001', LS, 10, 'Wrist'),
    b('LB-2026-00002', LS, -3, 'Wrist', { art: 'abgang_vorort', bezug: 'EV-0001', datum: '2026-10-31T12:00:00Z' }),
    b('LB-2026-00003', LS2, -1, 'Wrist', { art: 'abgang_vorort', bezug: 'EV-0001', datum: '2026-10-31T13:00:00Z' }),
    b('LB-2026-00004', LS, 1, 'Wrist', { art: 'korrektur', stornoVon: 'LB-2026-00003' }),   // falsch gebucht, zurueckgenommen
    b('LB-2026-00005', LS, -2, 'Wrist', { art: 'abgang_partner', bezug: 'P-001', datum: '2026-11-02T09:00:00Z' }),
    b('LB-2026-00006', LS, -1, 'Wrist', { art: 'umlagerung', bezug: 'LB-2026-00007' }),
    b('LB-2026-00007', LS, 1, 'Itzehoe', { art: 'umlagerung', bezug: 'LB-2026-00006' }),
  ];
  test('nur Abgaenge, Gegenbuchungen abgezogen, Umlagerung und Zugang zaehlen nicht', () => {
    const a = abgaengeAuswertung(bs);
    expect(a.posten).toEqual([{ schluessel: LS, warenart: 'rohling', menge: 5 }]);
    expect(a.stueck).toBe(5);
    expect(a.bezuege).toEqual([{ art: 'abgang_vorort', bezug: 'EV-0001', stueck: 3 }, { art: 'abgang_partner', bezug: 'P-001', stueck: 2 }]);
  });
  test('Filter Art, Bezug, Zeitraum (Berliner Tag)', () => {
    expect(abgaengeAuswertung(bs, { art: 'abgang_partner' }).stueck).toBe(2);
    expect(abgaengeAuswertung(bs, { bezug: 'EV-0001' }).stueck).toBe(3);
    expect(abgaengeAuswertung(bs, { von: '2026-11-01' }).stueck).toBe(2);
    expect(abgaengeAuswertung(bs, { bis: '2026-10-31' }).stueck).toBe(3);
  });
});

describe('Setup', () => {
  test('Lager_Events kommt dazu; fehlende Orte nur, wenn es sie (ohne Gross/Klein) nicht gibt', () => {
    expect(reiterPlan(['Lager_Buchungen', 'Lager_Artikel', 'Lager_Orte'], {}).neu.map(r => r.tab)).toEqual([TAB_EVENTS]);
    expect(orteFehlend(['Regal A', 'wrist'], ['Wrist', 'Itzehoe', ' Itzehoe '])).toEqual(['Itzehoe']);
    expect(orteFehlend([], ['Wrist', 'Itzehoe'])).toEqual(['Wrist', 'Itzehoe']);
  });
  test('Skript: --orte nur mit --write schreibend, ohne append', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/setup-lager-reiter.js'), 'utf8');
    expect(src).toMatch(/--orte=/);
    expect(src).toMatch(/if \(!WRITE\) \{ console\.log\('Trockenlauf - keine Orte angelegt\.'\); return; \}/);
    expect(src).not.toMatch(/values\.append/);
  });
});

// ── Schreibweg gegen das In-Memory-Sheet ─────────────────────────────────────
function tabsMit({ buchungen = [], events = [], mitEvents = true } = {}) {
  const tabs = grundTabs({ mitKorb: false });
  tabs.Trikots = [['Produktname', 'Groesse']];
  tabs.Partner = [['Partner-ID', 'Name', 'Aktiv'], ['P-001', 'Partner Eins', 'ja'], ['P-002', 'Partner Zwei', 'nein']];
  tabs[TAB_BUCHUNGEN] = [BUCHUNG_SPALTEN, ...buchungen.map(o => BUCHUNG_SPALTEN.map(n => o[n] ?? ''))];
  tabs[TAB_ORTE] = [ORTE_SPALTEN, ['Wrist', 'aktiv', ''], ['Itzehoe', 'aktiv', '']];
  tabs[TAB_ARTIKEL] = [ARTIKEL_SPALTEN];
  if (mitEvents) tabs[TAB_EVENTS] = [EVENT_SPALTEN, ...events];
  return tabs;
}
const zugang = (id, schluessel, menge, ort) => ({ Buchung_ID: id, Datum: '2026-11-01T08:00:00Z', Art: 'vorrat', Warenart: 'rohling', Schluessel: schluessel, Menge: menge, Ort: ort, Quelle: 'knopf', Vorgang: `v-${id}-xxxxxx` });

describe('lib/lager.js BO5-5', () => {
  beforeEach(() => {
    process.env.GOOGLE_SHEET_ID = 'ssot'; process.env.BUSINESS_SHEET_ID = 'ssot';
    _resetLShopCache(); _stammCacheLeeren(); lagerCacheLeeren(); _partnerCacheLeeren();
  });

  test('Event anlegen, dann Sammelausbuchen am Event: ein Schreibaufruf, kein append; Doppelklick schreibt nichts', async () => {
    const tabs = tabsMit({ buchungen: [zugang('LB-2026-00001', LS, 5, 'Wrist'), zugang('LB-2026-00002', LS2, 2, 'Itzehoe')] });
    const { sheets, aufrufe } = machSheets(tabs);
    const ev = await neuesEvent({ eingabe: { name: 'Halloween Markt', datum: '2026-10-31', ort: 'Marktplatz' }, sheets });
    expect(ev).toMatchObject({ ok: true, id: 'EV-0001' });
    expect(tabs[TAB_EVENTS][1]).toEqual(['EV-0001', 'Halloween Markt', '2026-10-31', 'Marktplatz', 'offen', '']);
    const eingabe = { aktion: 'ausbuchen', art: 'abgang_vorort', bezug: 'EV-0001', ort: 'Wrist', vorgang: V(10),
      posten: [{ schluessel: LS, menge: 2, ort: 'Wrist' }, { schluessel: LS2, menge: 1, ort: 'Itzehoe' }] };
    const vorher = aufrufe.update.length;
    const r = await bucheLager({ eingabe, sheets, jetzt: () => JETZT });
    expect(r).toMatchObject({ ok: true, zeilen: 2, stueck: 3 });
    expect(aufrufe.update.length - vorher).toBe(1);
    expect(aufrufe.append).toBe(0);
    const zwei = await bucheLager({ eingabe, sheets, jetzt: () => JETZT });
    expect(zwei).toMatchObject({ schonGebucht: true });
    expect(aufrufe.update.length - vorher).toBe(1);
    const a = await leseAbgaenge({ filter: { bezug: 'EV-0001' }, sheets });
    expect(a.stueck).toBe(3);
    expect(a.posten.map(p => [p.schluessel, p.menge, p.modell])).toEqual(expect.arrayContaining([[LS, 2, 'JH030F'], [LS2, 1, 'JH030F']]));
  });

  test('alles oder nichts: eine Zeile zu viel -> 422, nichts geschrieben', async () => {
    const tabs = tabsMit({ buchungen: [zugang('LB-2026-00001', LS, 5, 'Wrist')], events: [['EV-0001', 'Markt', '2026-10-31', '', 'offen', '']] });
    const { sheets, aufrufe } = machSheets(tabs);
    await expect(bucheLager({ eingabe: { aktion: 'ausbuchen', art: 'abgang_vorort', bezug: 'EV-0001', ort: 'Wrist', vorgang: V(11),
      posten: [{ schluessel: LS, menge: 2, ort: 'Wrist' }, { schluessel: LS, menge: 1, ort: 'Itzehoe' }] }, sheets })).rejects.toMatchObject({ status: 422 });
    expect(aufrufe.update).toEqual([]);
  });

  test('Partnerliste nur gelesen (aktive), Partner-Abgang mit P-ID; inaktiver Partner abgelehnt', async () => {
    const tabs = tabsMit({ buchungen: [zugang('LB-2026-00001', LS, 5, 'Wrist')] });
    const { sheets, aufrufe } = machSheets(tabs);
    const d = await leseBestand({ sheets });
    expect(d.partner).toEqual([{ id: 'P-001', name: 'Partner Eins' }]);
    await bucheLager({ eingabe: { aktion: 'ausbuchen', art: 'abgang_partner', bezug: 'P-001', ort: 'Wrist', vorgang: V(12), posten: [{ schluessel: LS, menge: 1 }] }, sheets, jetzt: () => JETZT });
    await expect(bucheLager({ eingabe: { aktion: 'ausbuchen', art: 'abgang_partner', bezug: 'P-002', ort: 'Wrist', vorgang: V(13), posten: [{ schluessel: LS, menge: 1 }] }, sheets }))
      .rejects.toMatchObject({ status: 422 });
    expect(aufrufe.update.every(r => r.startsWith(`'${TAB_BUCHUNGEN}'`))).toBe(true);   // nichts in Partner geschrieben
    expect(JSON.stringify(tabs.Partner)).toBe(JSON.stringify([['Partner-ID', 'Name', 'Aktiv'], ['P-001', 'Partner Eins', 'ja'], ['P-002', 'Partner Zwei', 'nein']]));
  });

  test('ohne Lager_Events: Lager laeuft, Hinweis; Vor-Ort-Abgang abgelehnt', async () => {
    const tabs = tabsMit({ buchungen: [zugang('LB-2026-00001', LS, 5, 'Wrist')], mitEvents: false });
    const { sheets } = machSheets(tabs);
    const d = await leseBestand({ sheets });
    expect(d.einrichtung).toEqual([]);
    expect(d.hinweise.join(' ')).toMatch(/Lager_Events fehlt/);
    await expect(bucheLager({ eingabe: { aktion: 'ausbuchen', art: 'abgang_vorort', bezug: 'EV-0001', ort: 'Wrist', vorgang: V(14), posten: [{ schluessel: LS, menge: 1 }] }, sheets }))
      .rejects.toMatchObject({ status: 422 });
  });

  test('Fertigware-Suche: jedes Wort muss passen, auch Variantenwerte (Farbe/Motiv)', async () => {
    const { sheets } = machSheets(tabsMit());
    expect((await sucheFertig({ q: 'sweater navy', sheets })).artikel.map(a => a.ssotId)).toEqual(['0001']);
    expect((await sucheFertig({ q: 'sweater rot', sheets })).artikel).toEqual([]);
  });
});

describe('Frontend BO5-5', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const gr = html.slice(html.indexOf('// ── Groessen: Anfang'), html.indexOf('// ── Groessen: Ende ──'));
  const block = html.slice(html.indexOf('// ── Lager-Anzeige: Anfang'), html.indexOf('// ── Lager-Anzeige: Ende ──'));
  const F = new Function(`${gr}\n${block}\nreturn { lagerListeHinzu, lagerListeAuswahl, lagerAnfrage, lagerBezugText, LAGER_HAUPTORT };`)();
  const korb = html.slice(html.indexOf('// ── Korb-Lager: Anfang'), html.indexOf('// ── Korb-Lager: Ende ──'));
  const K = new Function(`${korb}\nreturn { korbLagerVorbelegung };`)();

  test('Liste: gleicher Artikel + Ort wird zusammengezaehlt, anderer Ort eigene Zeile; Anfrage traegt Ort je Zeile und Bezug', () => {
    let l = F.lagerListeHinzu([], { posten: [{ schluessel: 'LS:1', label: 'M', menge: 2 }] }, { ort: 'Wrist', titel: 'X3000 · Black' });
    l = F.lagerListeHinzu(l, { posten: [{ schluessel: 'LS:1', label: 'M', menge: 1 }] }, { ort: 'Wrist' });
    l = F.lagerListeHinzu(l, { posten: [{ schluessel: 'LS:1', label: 'M', menge: 1 }] }, { ort: 'Itzehoe', titel: 'X3000 · Black' });
    expect(l).toEqual([{ schluessel: 'LS:1', label: 'X3000 · Black · M', ort: 'Wrist', menge: 3 }, { schluessel: 'LS:1', label: 'X3000 · Black · M', ort: 'Itzehoe', menge: 1 }]);
    const a = F.lagerListeAuswahl(l, { posten: [{ schluessel: 'LS:2', label: 'L', menge: 2 }], fehler: [] }, 'Wrist');
    const r = F.lagerAnfrage({ modus: 'ausbuchen', art: 'abgang_vorort', ort: 'Wrist', bezug: 'EV-0001', vorgang: 'v-12345678' }, a);
    expect(r).toMatchObject({ aktion: 'ausbuchen', art: 'abgang_vorort', bezug: 'EV-0001' });
    expect(r.posten).toEqual([{ schluessel: 'LS:1', menge: 3, ort: 'Wrist' }, { schluessel: 'LS:1', menge: 1, ort: 'Itzehoe' }, { schluessel: 'LS:2', menge: 2, ort: 'Wrist' }]);
  });
  test('Bezug lesbar: Event mit Datum, Partner mit Name', () => {
    expect(F.lagerBezugText('abgang_vorort', 'EV-0001', { events: EVENTS })).toBe('Halloween Markt (31.10.2026)');
    expect(F.lagerBezugText('abgang_partner', 'P-001', { partner: PARTNER })).toBe('P-001 · Partner Eins');
    expect(F.lagerBezugText('abgang_partner', 'Muster: Verein X', {})).toBe('Muster: Verein X');
  });
  test('Wrist ist vorgewaehlt: im Lager-Dialog und im Korb-Dialog zuerst', () => {
    expect(F.LAGER_HAUPTORT).toBe('Wrist');
    expect(html).toMatch(/orte\.includes\(LAGER_HAUPTORT\) \? LAGER_HAUPTORT/);
    expect(K.korbLagerVorbelegung([{ ort: 'Itzehoe', menge: 5 }, { ort: 'Wrist', menge: 2 }], 3).map(o => [o.ort, o.menge])).toEqual([['Wrist', 2], ['Itzehoe', 1]]);
  });
  test('Unterpunkt Abgaenge, Event-Modus bleibt offen, Druck im Zaehlliste-Stil', () => {
    expect(html).toMatch(/\{ id: 'abgaenge',\s+label: 'Abgänge',\s+panel: 'lager' \}/);
    expect(html).toMatch(/if \(sammel && z\.art === 'abgang_vorort'\) \{ lagerBezugZeichnen\(\); lagerRasterZeichnen\(\); return; \}/);
    expect(html).toMatch(/class="zaehlliste lager-a-druck"/);
    expect(html).toMatch(/Nach dem Event nur ausbuchen, was verkauft ist/);
  });
});
