// AM-5: Preise je Position, Summen, EK/Rohertrag, Angebotsstand, Zustaendig. Nur ERFUNDENE Betraege.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import {
  euroZahl, cent, euroText, ustAus, rabattAus, rabattZelle, aufpreisGilt, positionWerte, auftragSummen, positionAusZeile, angebotAbweichung, ZUSTAENDIG,
} from '../utils/auftrag-preise.js';
import { TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL, preisFelder, bearbeitenPlan } from '../utils/auftraege.js';
import { TAB_AUFGABEN, AUFGABE_SPALTEN } from '../utils/aufgaben.js';
import { legeAuftragAn, bearbeiteAuftrag, wechsleStatus, aktualisiereAngebot, setzeZustaendig, leseAuftraege, _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const JETZT = '2026-11-04T10:00:00.000Z';
const jetzt = () => new Date(JETZT);
const kundeOk = async () => {};
const NR_M = '9000000120', NR_3XL = '9000000150';
const V = n => `vorgang-pr-${String(n).padStart(4, '0')}`;

describe('Eingabe und Rundung', () => {
  test('Dezimalkomma, Tausenderpunkt, Zahl, leer, Fehler', () => {
    expect(euroZahl('12,50')).toBe(12.5);
    expect(euroZahl('1.234,5')).toBe(1234.5);
    expect(euroZahl(' 7 € ')).toBe(7);
    expect(euroZahl(3.456)).toBe(3.46);
    expect(euroZahl('')).toBeNull();
    expect(() => euroZahl('12,505')).toThrow(/Betrag/);
    expect(() => euroZahl('-3')).toThrow();
    expect(cent(0.1 + 0.2)).toBe(30);
    expect(euroText(123456)).toBe('1.234,56 €');
  });
  test('USt 19/7/0, leer = 19; Rabatt % oder Betrag', () => {
    expect([ustAus(''), ustAus('7'), ustAus(0)]).toEqual([19, 7, 0]);
    expect(() => ustAus('16')).toThrow(/USt/);
    expect(rabattAus('10%')).toEqual({ art: '%', wert: 10 });
    expect(rabattAus({ art: '%', wert: '5,5' })).toEqual({ art: '%', wert: 5.5 });
    expect(rabattAus({ art: '€', wert: '25,00' })).toEqual({ art: '€', wert: 25 });
    expect(rabattAus(25)).toEqual({ art: '€', wert: 25 });
    expect(rabattAus('')).toBeNull();
    expect(() => rabattAus('120%')).toThrow();
    expect([rabattZelle(rabattAus('10%')), rabattZelle(rabattAus(25)), rabattZelle(null)]).toEqual(['10%', 25, '']);
  });
  test('Aufpreis ab Groesse (Vorbelegung 3XL), nur gleiche Groessen-Klasse', () => {
    expect(['XL', '2XL', 'XXL', '3XL', '4XL', '128'].map(g => aufpreisGilt(g))).toEqual([false, false, false, true, true, false]);
    expect(aufpreisGilt('XXL', '2XL')).toBe(true);
  });
});

describe('Summen, EK, Rohertrag (Cent)', () => {
  const pos = [
    { art: 'lshop', menge: 3, groesse: 'M', preis: 12.5, aufpreis: 2, aufpreisAb: '3XL', ust: 19, ekHand: null, ekAuto: 4.1 },
    { art: 'lshop', menge: 2, groesse: '3XL', preis: 12.5, aufpreis: 2, aufpreisAb: '3XL', ust: 19, ekHand: null, ekAuto: 5.2 },
    { art: 'frei', menge: 1, preis: 30, ust: 19, ekHand: null },                 // Design-Pauschale, EK unbekannt
    { art: 'frei', menge: 10, preis: 4.99, ust: 7, ekHand: 2 },                  // Tassen 7 %
    { art: 'frei', menge: 5, preis: null, ust: 19, ekHand: null },               // noch ohne Preis
  ];
  test('Positionen: Aufpreis nur ab 3XL, EK Hand vor automatisch', () => {
    const w = pos.map(p => positionWerte(p));
    expect(w.map(x => x.netto)).toEqual([3750, 2900, 3000, 4990, null]);
    expect(w.map(x => x.ek)).toEqual([1230, 1040, null, 2000, null]);
    expect(w.map(x => x.ekQuelle)).toEqual(['lshop', 'lshop', '', 'hand', '']);
    expect(positionWerte({ art: 'lshop', menge: 1, preis: 10, ekHand: 3, ekAuto: 4 }).ek).toBe(300);
  });
  test('ohne Rabatt: netto, MwSt je Satz, brutto; unvollstaendig zaehlt', () => {
    const s = auftragSummen(pos);
    expect(s).toMatchObject({ netto: 14640, ohnePreis: 1, rabatt: 0, nettoNach: 14640 });
    expect(s.mwst).toEqual([{ satz: 19, basis: 9650, betrag: 1834 }, { satz: 7, basis: 4990, betrag: 349 }]);
    expect(s.brutto).toBe(14640 + 1834 + 349);
    // Rohertrag nur ueber Positionen mit Preis UND EK (Design-Pauschale ohne EK zaehlt als ekFehlt)
    expect(s).toMatchObject({ ek: 4270, ekFehlt: 1, umsatzMitEk: 11640, rohertrag: 7370, rohertragProzent: 63.3 });
  });
  test('Rabatt % und Betrag vor MwSt, anteilig je Satz, Summe exakt', () => {
    const p = auftragSummen(pos, { art: '%', wert: 10 });
    expect(p.rabatt).toBe(1464);
    expect(p.mwst.reduce((x, m) => x + m.basis, 0)).toBe(p.nettoNach);
    expect(p.nettoNach).toBe(13176);
    const b = auftragSummen(pos, { art: '€', wert: 25 });
    expect(b).toMatchObject({ rabatt: 2500, nettoNach: 12140 });
    expect(b.mwst.reduce((x, m) => x + m.basis, 0)).toBe(12140);
    expect(auftragSummen(pos.slice(0, 1), { art: '€', wert: 1000 }).nettoNach).toBe(0);   // hoechstens netto
  });
  test('Rundung: 3 x 0,333 € -> Cent je Stueck', () => {
    expect(auftragSummen([{ art: 'frei', menge: 3, preis: 0.33, ust: 19 }])).toMatchObject({ netto: 99, brutto: 99 + 19 });
  });
  test('Sheet-Zeile -> Eingabe (Text oder Zahl, ungueltig = leer); Angebotsstand-Abweichung', () => {
    const e = positionAusZeile({ Art: 'lshop', Menge: '2', Preis_Netto: 12.5, Aufpreis_Netto: '2', Aufpreis_Ab: '', USt_Satz: '', EK_Hand: 'x' }, { groesse: '4XL', ekAuto: 5 });
    expect(e).toMatchObject({ menge: 2, preis: 12.5, aufpreis: 2, aufpreisAb: '3XL', ust: 19, ekHand: null, ekAuto: 5 });
    const s = auftragSummen([e]);
    expect(angebotAbweichung({ Angebot_Stand: '' }, s)).toBeNull();
    expect(angebotAbweichung({ Angebot_Stand: '2026-11-01', Angebot_Netto: 29, Angebot_Brutto: 34.51 }, s)).toBeNull();
    expect(angebotAbweichung({ Angebot_Stand: '2026-11-01', Angebot_Netto: 25, Angebot_Brutto: 29.75 }, s)).toEqual({ alt: { netto: 2500, brutto: 2975 }, neu: { netto: 2900, brutto: 3451 } });
  });
  test('Preisfelder einer Position: Zahl im Sheet, USt 19 = leer, Aufpreis nur L-Shop', () => {
    expect(preisFelder({ preis: '12,50', aufpreis: '2', ust: 7, ekHand: '' }, 'lshop', 1)).toEqual({ Preis_Netto: 12.5, Aufpreis_Netto: 2, Aufpreis_Ab: '3XL', USt_Satz: 7, EK_Hand: '' });
    expect(preisFelder({ preis: '', aufpreis: '2', ust: 19, ekHand: '1,5' }, 'frei', 1)).toEqual({ Preis_Netto: '', Aufpreis_Netto: '', Aufpreis_Ab: '', USt_Satz: '', EK_Hand: 1.5 });
    expect(() => preisFelder({ preis: 'zwölf' }, 'frei', 3)).toThrow(/Position 3/);
  });
});

// ── Schreibwege ──
function tabs({ auftraege = [], positionen = [], mitSpalten = true, aufgaben = [] } = {}) {
  const AS = mitSpalten ? [...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL] : [...AUFTRAG_SPALTEN, 'Design_Am'];
  const PS = mitSpalten ? [...POSITION_SPALTEN, ...POSITION_OPTIONAL] : [...POSITION_SPALTEN, 'Herkunft', 'Lager_Ort', 'Lager_Buchung'];
  const GS = mitSpalten ? [...AUFGABE_SPALTEN, 'Zustaendig'] : AUFGABE_SPALTEN;
  const LS = (nr, size, preis) => [nr, 'X3000', 'Black', '', size, '', '', 'Erfunden', '', '0', 'aktiv', 'Muster-Shirt', preis, '01.11.2026'];
  return {
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description', '10CartonsPrice', 'Quelle_Datum'],
      LS(NR_M, 'M', 4.1), LS(NR_3XL, '3XL', 5.2)],
    [TAB_AUFTRAEGE]: [AS, ...auftraege.map(o => AS.map(s => o[s] ?? ''))],
    [TAB_POSITIONEN]: [PS, ...positionen.map(o => PS.map(s => o[s] ?? ''))],
    [TAB_AUFGABEN]: [GS, ...aufgaben.map(o => GS.map(s => o[s] ?? ''))],
  };
}
const neu = (extra = {}) => ({
  Kunden_Nr: 'K-00001', Kurztitel: 'Polos', status: 'Anfrage', vorgang: V(1), Rabatt: { art: '%', wert: '10' },
  positionen: [
    { art: 'lshop', articleNr: NR_M, menge: 3, preis: '12,50', aufpreis: '2,00', aufpreisAb: '3XL' },
    { art: 'lshop', articleNr: NR_3XL, menge: 2, preis: '12,50', aufpreis: '2,00', aufpreisAb: '3XL' },
    { art: 'frei', freitext: 'Tassen', menge: 10, preis: '4,99', ust: 7, ekHand: '2' },
  ],
  ...extra,
});
const spalte = (t, tab, s) => t[tab][0].indexOf(s);

beforeEach(() => {
  process.env.GOOGLE_SHEET_ID = 'ssot-test';
  _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren();
});

describe('Schreibwege mit Preisen', () => {
  test('Anlegen: Preise als Zahl, Rabatt "10%", Summen beim Lesen, EK aus LShop_Modelle', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: neu() });
    const z = t[TAB_POSITIONEN][1];
    expect(z[spalte(t, TAB_POSITIONEN, 'Preis_Netto')]).toBe(12.5);
    expect(z[spalte(t, TAB_POSITIONEN, 'USt_Satz')]).toBe('');
    expect(t[TAB_POSITIONEN][3][spalte(t, TAB_POSITIONEN, 'USt_Satz')]).toBe(7);
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Rabatt')]).toBe('10%');
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Angebot_Stand')]).toBe('');   // Start "Anfrage": nichts festgehalten
    const r = await leseAuftraege({ sheets, jetzt, autoBestellen: false });
    const p = r.auftraege[0].preise;
    expect(p).toMatchObject({ netto: 3750 + 2900 + 4990, rabatt: 1164, ek: 1230 + 1040 + 2000, ekFehlt: 0, angebotGeaendert: null });
    expect(r.auftraege[0].positionen[0]).toMatchObject({ ekAuto: 4.1, ekStand: '01.11.2026' });
    expect(r.spalten).toEqual({ preise: true, rabatt: true, angebot: true, zustaendig: true, zustaendigAufgaben: true });
    expect(r.zustaendigAuswahl).toEqual(ZUSTAENDIG);
  });
  test('Angebot festhalten beim Statuswechsel, "geändert seit Angebot", aktualisieren', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: neu() });
    let a = (await leseAuftraege({ sheets, jetzt, autoBestellen: false })).auftraege[0];
    await wechsleStatus({ sheets, jetzt, eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, aktion: 'weiter' } });
    const zA = t[TAB_AUFTRAEGE][1];
    expect([zA[spalte(t, TAB_AUFTRAEGE, 'Angebot_Netto')], zA[spalte(t, TAB_AUFTRAEGE, 'Angebot_Brutto')], zA[spalte(t, TAB_AUFTRAEGE, 'Angebot_Stand')]])
      .toEqual([104.76, expect.any(Number), '2026-11-04']);
    _auftraegeCacheLeeren();
    a = (await leseAuftraege({ sheets, jetzt, autoBestellen: false })).auftraege[0];
    expect(a.preise.angebotGeaendert).toBeNull();
    // Preis aendern -> Abweichung
    const pos = a.positionen.map(p => ({ positionId: p.Position_ID, art: p.Art, articleNr: p.LShop_ArticleNr, freitext: p.Freitext, menge: Number(p.Menge),
      preis: p.Art === 'frei' ? '5,99' : p.Preis_Netto, aufpreis: p.Aufpreis_Netto, aufpreisAb: p.Aufpreis_Ab, ust: p.USt_Satz, ekHand: p.EK_Hand, herkunft: p.Herkunft }));
    await bearbeiteAuftrag({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, positionen: pos } });
    _auftraegeCacheLeeren();
    a = (await leseAuftraege({ sheets, jetzt, autoBestellen: false })).auftraege[0];
    expect(a.preise.angebotGeaendert).toMatchObject({ alt: { netto: 10476 }, neu: { netto: 10476 + 900 } });
    await aktualisiereAngebot({ sheets, jetzt, eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand } });
    _auftraegeCacheLeeren();
    expect((await leseAuftraege({ sheets, jetzt, autoBestellen: false })).auftraege[0].preise.angebotGeaendert).toBeNull();
  });
  test('ab "bestellt": nur Preise aenderbar, Menge gesperrt (409)', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: neu({ positionen: [{ art: 'frei', freitext: 'Tassen', menge: 10 }], Rabatt: undefined }) });
    t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Status')] = 'bestellt';
    const a = (await leseAuftraege({ sheets, jetzt, autoBestellen: false })).auftraege[0];
    const p = a.positionen[0];
    const basis = { positionId: p.Position_ID, art: 'frei', freitext: 'Tassen', herkunft: '' };
    await expect(bearbeiteAuftrag({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, positionen: [{ ...basis, menge: 11, preis: '4' }] } }))
      .rejects.toMatchObject({ status: 409, code: 'gesperrt' });
    await bearbeiteAuftrag({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, positionen: [{ ...basis, menge: 10, preis: '4,20' }], Rabatt: '5' } });
    expect(t[TAB_POSITIONEN][1][spalte(t, TAB_POSITIONEN, 'Preis_Netto')]).toBe(4.2);
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Rabatt')]).toBe(5);
  });
  test('Spalten fehlen: Lesen wie bisher, Preise schreiben 409, Status ohne Preise geht weiter', async () => {
    const t = tabs({ mitSpalten: false });
    const { sheets } = machSheets(t);
    await expect(legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: neu() })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    const ohne = neu({ Rabatt: undefined, positionen: [{ art: 'frei', freitext: 'Tassen', menge: 10 }] });
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: ohne });
    const r = await leseAuftraege({ sheets, jetzt, autoBestellen: false });
    expect(r.auftraege[0].preise).toMatchObject({ netto: 0, ohnePreis: 1 });
    expect(r.spalten).toMatchObject({ preise: false, angebot: false, zustaendig: false });
    const a = r.auftraege[0];
    expect((await wechsleStatus({ sheets, jetzt, eingabe: { auftragNr: a.Auftrag_Nr, stand: a.Stand, aktion: 'weiter' } })).status).toBe('Angebot');
    await expect(setzeZustaendig({ sheets, eingabe: { nr: a.Auftrag_Nr, zustaendig: 'Nicole' } })).rejects.toMatchObject({ status: 409 });
  });
  test('Zuständig an Auftrag und Aufgabe: setzen, leeren, nur feste Auswahl; Stand bleibt', async () => {
    const t = tabs({ aufgaben: [{ Aufgabe_Nr: 'AG-2026-0001', Kurztitel: 'x', Status: 'offen', Stand: 's-ag' }] });
    const { sheets } = machSheets(t);
    await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: neu({ Rabatt: undefined }) });
    const stand = t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Stand')];
    await setzeZustaendig({ sheets, eingabe: { nr: 'AU-2026-0001', zustaendig: 'Christian' } });
    await setzeZustaendig({ sheets, eingabe: { nr: 'AG-2026-0001', zustaendig: 'Nicole' } });
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Zustaendig')]).toBe('Christian');
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Stand')]).toBe(stand);
    expect(t[TAB_AUFGABEN][1][spalte(t, TAB_AUFGABEN, 'Zustaendig')]).toBe('Nicole');
    await setzeZustaendig({ sheets, eingabe: { nr: 'AU-2026-0001', zustaendig: '' } });
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Zustaendig')]).toBe('');
    await expect(setzeZustaendig({ sheets, eingabe: { nr: 'AU-2026-0001', zustaendig: 'Jemand' } })).rejects.toMatchObject({ status: 422 });
    const r = await leseAuftraege({ sheets, jetzt, autoBestellen: false });
    expect(r.aufgaben[0].Zustaendig).toBe('Nicole');
  });
  test('bestehende Auftraege ohne Preise unveraendert (Bearbeiten ohne Preisfelder schreibt nichts)', () => {
    const auftrag = { Auftrag_Nr: 'AU-2026-0001', Status: 'Angebot', Kurztitel: 'x', Kunden_Nr: 'K-00001', Stand: 's' };
    const alt = [{ Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'frei', Freitext: 'Tassen', Menge: '10', Motiv: '', Druck: '', Notiz: '', Herkunft: '', Lager_Ort: '', _zeile: 2 }];
    const plan = bearbeitenPlan({ auftrag, positionen: alt, eingabe: { positionen: [{ positionId: 'AU-2026-0001-01', art: 'frei', freitext: 'Tassen', menge: 10 }] }, waehlbar: new Set(), jetzt: JETZT });
    expect(plan.unveraendert).toBe(true);
  });
  test('kein Preis/EK in Log, Korb, EDI', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const t = tabs();
      const { sheets } = machSheets(t);
      await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: neu() });
      expect(log.mock.calls.flat().join(' ')).not.toMatch(/12[,.]5|4[,.]99|4[,.]1\b/);
    } finally { log.mockRestore(); }
    const quelle = f => readFileSync(resolve(hier, f), 'utf8');
    for (const f of ['../utils/auftrag-bereitstellen.js', '../lib/auftragBereitstellen.js', '../utils/edi-bestellung.js', '../lib/lshopEdi.js']) {
      expect([f, /Preis_Netto|EK_Hand|Angebot_Netto|auftrag-preise/.test(quelle(f))]).toEqual([f, false]);
    }
    expect(quelle('../routes/auftraege.js')).not.toMatch(/console\.log\([^)]*(preise|netto|brutto|Rabatt)/i);
  });
});

describe('Frontend-Spiegel (Block Auftrag-Preise)', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const gr = html.slice(html.indexOf('// ── Groessen: Anfang'), html.indexOf('// ── Groessen: Ende'));
  const block = html.slice(html.indexOf('// ── Auftrag-Preise: Anfang'), html.indexOf('// ── Auftrag-Preise: Ende'));
  test('Block da', () => expect(block.length).toBeGreaterThan(1500));
  const F = new Function(`${gr}\n${block}\nreturn { apEuro, apSummen, apAufpreisGilt, AP_ZUSTAENDIG, apRabatt, apEuroText };`)();
  test('gleiche Ergebnisse wie das Backend', () => {
    const pos = [
      { art: 'lshop', menge: 3, groesse: 'M', preis: 12.5, aufpreis: 2, aufpreisAb: '3XL', ust: 19, ekHand: null, ekAuto: 4.1 },
      { art: 'lshop', menge: 2, groesse: '3XL', preis: 12.5, aufpreis: 2, aufpreisAb: '3XL', ust: 19, ekHand: null, ekAuto: 5.2 },
      { art: 'frei', menge: 1, preis: 30, ust: 19, ekHand: null },
      { art: 'frei', menge: 10, preis: 4.99, ust: 7, ekHand: 2 },
      { art: 'frei', menge: 5, preis: null, ust: 19, ekHand: null },
    ];
    for (const r of [null, { art: '%', wert: 10 }, { art: '€', wert: 25 }]) expect(F.apSummen(pos, r)).toEqual(auftragSummen(pos, r));
    for (const e of ['12,50', '1.234,5', '', ' 7 € ']) expect(F.apEuro(e)).toEqual(euroZahl(e));
    expect(F.apRabatt({ art: '%', wert: '10' })).toEqual(rabattAus({ art: '%', wert: '10' }));
    for (const g of ['XL', '3XL', '4XL', '128']) expect(F.apAufpreisGilt(g, '3XL')).toBe(aufpreisGilt(g, '3XL'));
    expect(F.AP_ZUSTAENDIG).toEqual(ZUSTAENDIG);
    expect(F.apEuroText(123456)).toBe(euroText(123456));
  });
});
