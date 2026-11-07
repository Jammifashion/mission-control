// KS3: Bestellseite pruefen + uebernehmen (ein AU je Termin, TR6-Trikots, "schon bestellt – verknüpfen", Packliste).
// Nur erfundene Werte (Kürzel, Notizen, Rückennamen, Wünsche sind ausgedacht).
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { legeTerminAn, sendeAb, aendereEintragSeite, leseEintraege, leseEintraegeMc } from '../lib/bestellEintraege.js';
import { pruefeEintraege, aendereEintragMc, uebernahmeVorschau, uebernehmen, eintraegeZumAuftrag, leseUngepruefte } from '../lib/bestellUebernahme.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, EINTRAG_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL } from '../utils/bestellseite.js';
import { EINTRAG_OPTIONAL } from '../utils/bestell-eintraege.js';
import { AUFTRAG_SPALTEN, AUFTRAG_OPTIONAL, POSITION_SPALTEN, POSITION_OPTIONAL } from '../utils/auftraege.js';
import { KORB_SPALTEN } from '../utils/korb-logic.js';
import { BUCHUNG_SPALTEN, ARTIKEL_SPALTEN, ORTE_SPALTEN } from '../utils/lager.js';
import { uebernahmePlan, zielAuftrag, ungepruefteZahlen, eintraegeJePosition, verknuepfungAus } from '../utils/bestell-uebernahme.js';
import { _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const SPAETER = () => new Date('2026-11-07T11:00:00Z');   // MC-Schritte: anderer Stand als beim Absenden
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }, { Kunden_Nr: 'K-00001', Status: 'aktiv' }] });
let z = 0; const zufall = () => Buffer.alloc(32, ++z);
const V = n => `vorgang-ks3-${String(n).padStart(4, '0')}`;
const NR_M = '1000000001', NR_L = '1000000002';
const KUERZEL = 'Testi', NOTIZ = 'fuer Erfundene Person', NAME = 'ERFUNDEN';

function tabs() {
  const LS = (nr, size) => [nr, 'X3000', 'Black', '', size, '', '', 'Erfunden', '', '0', 'aktiv', 'Muster-Hoodie'];
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]],
    Bestell_Termine: [TERMIN_SPALTEN],
    Bestell_Eintraege: [[...EINTRAG_SPALTEN, ...EINTRAG_OPTIONAL]],
    Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL], ['901', 'produkt', 'https://i0.wp.com/shop.example/t.jpg?fit=800%2C800', 'publish', 's', '561']],
    Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club'], ['554', 'Club > Basics', 'Basics'], ['561', 'Club > Trikots', 'Trikots']],
    Erfassungsmaske: [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien'], ['A1', 'Veröffentlicht', '11', 'Hoodie Club', 'Club, Basics']],
    Varianten: [['SSOT-ID', 'Varianten-Nr', 'E1', 'V1', 'E2', 'V2', 'E3', 'V3', 'Preis', 'Aktiv', 'WC_Variation_ID', 'Google_Farbe', 'LShop_ArticleNr'],
      ['A1', '1', 'Farbe', 'Black', 'Größe', 'M', '', '', '49,95', 'TRUE', '101', '', NR_M],
      ['A1', '2', 'Farbe', 'Black', 'Größe', 'L', '', '', '49,95', 'TRUE', '102', '', NR_L],
      ['A1', '3', 'Farbe', 'Red', 'Größe', 'M', '', '', '49,95', 'TRUE', '103', '', '']],
    Trikot_Artikel: [['Artikelnummer', 'Produkt-ID', 'Produktname', 'Aktiv'], ['TR-H', '901', 'Heimtrikot Test', 'TRUE']],
    Auftraege: [[...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL]],
    Auftrag_Positionen: [[...POSITION_SPALTEN, ...POSITION_OPTIONAL]],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description'],
      LS(NR_M, 'M'), LS(NR_L, 'L')],
    Warenkorb_LShop: [KORB_SPALTEN],
    Lager_Buchungen: [BUCHUNG_SPALTEN], Lager_Artikel: [ARTIKEL_SPALTEN], Lager_Orte: [ORTE_SPALTEN, ['Wrist', 'aktiv', '']],
  };
}

let t, s, token, termin, trikotAufrufe;
const trikotsAnlegen = async ({ trikots, referenz, vorgang }) => {
  trikotAufrufe.push({ trikots, referenz, vorgang });
  const schon = trikotAufrufe.filter(x => x.vorgang === vorgang).length > 1;
  return { ok: true, schon, ids: trikots.map((_, i) => `INT-2026-${String(i + 1).padStart(4, '0')}`) };
};
const melden = async () => {};
async function aufbau() {
  t = tabs();
  s = machSheets(t);
  const r = await legeZugangAn({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: V(1) }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null });
  token = r.token;
  termin = (await legeTerminAn({ token, eingabe: { datum: '2026-11-22', notiz: '' }, sheets: s.sheets, jetzt: JETZT })).termin;
}
const absenden = (positionen, n = 2) => sendeAb({ token, eingabe: { termin, kuerzel: KUERZEL, vorgang: V(n), positionen }, sheets: s.sheets, jetzt: JETZT, melden });
const mc = () => leseEintraegeMc({ zugangId: 'BS-001', sheets: s.sheets });
const wahl = async (filter = () => true) => (await mc()).eintraege.filter(filter).map(e => ({ id: e.id, stand: e.stand }));

beforeEach(async () => {
  _bestellseiteCacheLeeren(); _auftraegeCacheLeeren(); _resetLShopCache?.(); _lieferbarkeitCacheLeeren?.();
  trikotAufrufe = [];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await aufbau();
});
afterEach(() => jest.restoreAllMocks());

describe('A. Pruefen in MC', () => {
  test('geprüft ✓, Prüfung zurück, ablehnen (Grund Pflicht, auf der Seite sichtbar), veralteter Stand 409', async () => {
    await absenden([{ art: 'artikel', id: '101', menge: 1 }, { art: 'artikel', id: '102', menge: 2 }]);
    const [a, b] = await wahl();
    const r = await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: [a] }, sheets: s.sheets, jetzt: SPAETER });
    expect(r).toMatchObject({ geaendert: 1 });
    expect((await mc()).eintraege[0].status).toBe('geprüft');
    await expect(pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: [a] }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409, code: 'konflikt' });
    await expect(pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'ablehnen', auswahl: [b], grund: ' ' }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    await expect(pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'ablehnen', auswahl: [b], grund: 'x'.repeat(101) }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'ablehnen', auswahl: [b], grund: 'Größe gibt es nicht mehr' }, sheets: s.sheets, jetzt: JETZT });
    const seite = await leseEintraege({ token, termin, sheets: s.sheets, jetzt: JETZT });
    expect(seite.eintraege[1]).toMatchObject({ status: 'storniert', ablehnGrund: 'Größe gibt es nicht mehr', geaendertVon: 'MC' });
    const html = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
    expect(html).toMatch(/abgelehnt: \$\{bsEsc\(e\.ablehnGrund\)\}/);
    const [a2] = await wahl(e => e.status === 'geprüft');
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'zurueck', auswahl: [a2] }, sheets: s.sheets, jetzt: JETZT });
    expect((await mc()).eintraege[0].status).toBe('eingegangen');
  });
  test('ändert die Seite einen geprüften Eintrag, ist er wieder "eingegangen"; MC ändert ohne Statuswechsel ("geändert von MC")', async () => {
    await absenden([{ art: 'artikel', id: '101', menge: 1 }]);
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: await wahl() }, sheets: s.sheets, jetzt: JETZT });
    let e = (await mc()).eintraege[0];
    expect(e.alternativen.map(x => x.groesse)).toEqual(['M', 'L']);   // Groessen derselben Karte
    await aendereEintragMc({ eingabe: { zugangId: 'BS-001', eintrag: e.id, stand: e.stand, id: '102', menge: 3 }, sheets: s.sheets, jetzt: JETZT });
    e = (await mc()).eintraege[0];
    expect(e).toMatchObject({ status: 'geprüft', groesse: 'L', menge: 3, geaendertVon: 'MC', nachSchluss: false });
    await aendereEintragSeite({ token, eingabe: { eintrag: e.id, stand: e.stand, kuerzel: KUERZEL, menge: 4 }, sheets: s.sheets, jetzt: JETZT });
    expect((await mc()).eintraege[0]).toMatchObject({ status: 'eingegangen', menge: 4, geaendertVon: KUERZEL });
  });
});

describe('B. Uebernehmen', () => {
  async function geprueft(positionen, n = 2) {
    await absenden(positionen, n);
    await pruefeEintraege({ eingabe: { zugangId: 'BS-001', aktion: 'geprueft', auswahl: await wahl(e => e.status === 'eingegangen') }, sheets: s.sheets, jetzt: JETZT });
    return wahl(e => e.status === 'geprüft');
  }
  test('ein AU je Termin: gleiche Variante zusammengefasst, ohne L-Shop-Nr. und Extra frei, Trikot über TR6; Einträge übernommen', async () => {
    const auswahl = await geprueft([
      { art: 'artikel', id: '101', menge: 1, notiz: NOTIZ }, { art: 'artikel', id: '101', menge: 2 }, { art: 'artikel', id: '103', menge: 1 },
      { art: 'extra', freitext: 'Schal ohne Druck', menge: 2 }, { art: 'trikot', produktId: '901', groesse: 'L', name: NAME, nummer: '7', wunsch: 'als Torwart' },
    ]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl, vorgang: V(10) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(r).toMatchObject({ ok: true, auftragNr: 'AU-2026-0001', neu: true, eintraege: 5, positionen: 3, lshop: 1, frei: 2, trikots: 1 });
    const au = t.Auftraege[1], ak = c => t.Auftraege[0].indexOf(c);
    expect([au[ak('Kunden_Nr')], au[ak('Kanal')], au[ak('Status')], au[ak('Termin')], au[ak('Zugang_ID')], au[ak('Termin_ID')]]).toEqual(['K-00063', 'Bestellseite', 'Anfrage', '2026-11-22', 'BS-001', termin]);
    expect(au[ak('Kurztitel')]).toBe('Bestellseite BS-001 · Termin 22.11.');
    const pk = c => t.Auftrag_Positionen[0].indexOf(c);
    const pos = t.Auftrag_Positionen.slice(1);
    expect(pos.map(p => [p[pk('Art')], p[pk('LShop_ArticleNr')], p[pk('Menge')], p[pk('Herkunft')]])).toEqual([
      ['lshop', NR_M, '3', 'bestellen'], ['frei', '', '1', ''], ['frei', '', '2', '']]);
    expect(pos[0][pk('Motiv')]).toBe('Hoodie Club');
    expect(pos[1][pk('Freitext')]).toBe('Hoodie Club · Red · M');
    // Kürzel/Notiz/Rückenname nie im Auftrag
    expect(JSON.stringify([t.Auftraege, t.Auftrag_Positionen])).not.toMatch(new RegExp(`${KUERZEL}|${NOTIZ}|${NAME}`));
    // Trikot ueber TR6: Referenz = AU-Nr., Wunsch im Rohtext (notiz)
    expect(trikotAufrufe).toHaveLength(1);
    expect(trikotAufrufe[0]).toMatchObject({ referenz: 'AU-2026-0001', trikots: [{ produktId: '901', groesse: 'L', name: NAME, nummer: '7', notiz: 'als Torwart' }] });
    // Eintraege + Termin
    const e = (await mc()).eintraege;
    expect(e.every(x => x.status === 'übernommen' && x.auftragNr === 'AU-2026-0001')).toBe(true);
    expect(e.find(x => x.art === 'trikot').positionId).toBe('INT-2026-0001');
    expect(e.filter(x => x.positionId === 'AU-2026-0001-01')).toHaveLength(2);
    const tk = c => t.Bestell_Termine[0].indexOf(c);
    expect(t.Bestell_Termine[1][tk('Auftrag_Nr')]).toBe('AU-2026-0001');
    // nie Korb, nie Lager, nie Partner-Reiter, kein append
    expect(t.Warenkorb_LShop).toHaveLength(1);
    expect(t.Lager_Buchungen).toHaveLength(1);
    expect(s.aufrufe.append).toBe(0);
    expect([...s.aufrufe.update, ...s.aufrufe.batchUpdate].some(r => /Partner|FP_/.test(r))).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(new RegExp(`${KUERZEL}|${NOTIZ}|${NAME}|Torwart`));
    // Seite: nur noch lesen
    await expect(aendereEintragSeite({ token, eingabe: { eintrag: e[0].id, stand: e[0].stand, kuerzel: KUERZEL, menge: 9 }, sheets: s.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 422 });
    // Anzeige im Auftrag: Kürzel + Notiz nur angezeigt
    const anz = await eintraegeZumAuftrag({ auftragNr: 'AU-2026-0001', sheets: s.sheets });
    expect(anz.eintraege.find(x => x.positionId === 'AU-2026-0001-01' && x.notiz)).toMatchObject({ kuerzel: KUERZEL, notiz: NOTIZ });
  });

  test('zweiter Lauf ergänzt denselben AU ohne Doppel; Doppelklick (gleicher Vorgang) legt nichts doppelt an', async () => {
    const a1 = await geprueft([{ art: 'artikel', id: '101', menge: 1 }]);
    await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a1, vorgang: V(20) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a1, vorgang: V(20) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).toMatchObject({ schon: true, auftragNr: 'AU-2026-0001' });
    const a2 = await geprueft([{ art: 'artikel', id: '102', menge: 1 }], 3);
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a2, vorgang: V(21) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(r).toMatchObject({ auftragNr: 'AU-2026-0001', neu: false, positionen: 1 });
    expect(t.Auftraege).toHaveLength(2);
    expect(t.Auftrag_Positionen.slice(1).map(p => p[0])).toEqual(['AU-2026-0001-01', 'AU-2026-0001-02']);
    // schon uebernommene erneut -> 409 (nicht geprüft), nichts doppelt
    await expect(uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: await wahl(), vorgang: V(22) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).rejects.toMatchObject({ status: 409 });
    expect(t.Auftrag_Positionen).toHaveLength(3);
  });

  test('späte Einträge: bis "bestellt" an den Termin-Auftrag, danach Nachtrags-Auftrag zum selben Termin', async () => {
    const a1 = await geprueft([{ art: 'artikel', id: '101', menge: 1 }]);
    await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a1, vorgang: V(30) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    const ak = c => t.Auftraege[0].indexOf(c);
    t.Auftraege[1][ak('Status')] = 'bestellt';
    const a2 = await geprueft([{ art: 'artikel', id: '102', menge: 1 }], 3);
    expect((await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a2, vorgang: V(31) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).auftragNr).toBe('AU-2026-0001');
    t.Auftraege[1][ak('Status')] = 'in Produktion';
    const a3 = await geprueft([{ art: 'artikel', id: '101', menge: 2 }], 4);
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a3, vorgang: V(32) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(r).toMatchObject({ auftragNr: 'AU-2026-0002', neu: true, nachtrag: true });
    expect(t.Auftraege[2][ak('Kurztitel')]).toBe('Bestellseite BS-001 · Termin 22.11. · Nachtrag');
    const tk = c => t.Bestell_Termine[0].indexOf(c);
    expect(t.Bestell_Termine[1][tk('Auftrag_Nr')]).toBe('AU-2026-0001, AU-2026-0002');
    // die Positionen des Auftrags in Produktion bleiben unberuehrt
    expect(t.Auftrag_Positionen.slice(1).filter(p => p[1] === 'AU-2026-0001')).toHaveLength(2);
  });

  test('an vorhandenen Auftrag desselben Kunden zum Termin anhängen (z. B. schon angelegter Fanshop-Auftrag), fremder Kunde 422', async () => {
    const ak = c => t.Auftraege[0].indexOf(c);
    const zeile = o => t.Auftraege[0].map(c => o[c] ?? '');
    t.Auftraege.push(zeile({ Auftrag_Nr: 'AU-2026-0010', Kunden_Nr: 'K-00063', Kurztitel: 'Fanshop', Status: 'Angebot', Termin: '2026-11-22', Stand: 's' }));
    t.Auftraege.push(zeile({ Auftrag_Nr: 'AU-2026-0011', Kunden_Nr: 'K-00001', Kurztitel: 'Fremd', Status: 'Angebot', Termin: '2026-11-22', Stand: 's' }));
    const a = await geprueft([{ art: 'artikel', id: '101', menge: 1 }]);
    const v = await uebernahmeVorschau({ zugangId: 'BS-001', terminId: termin, sheets: s.sheets, jetzt: JETZT });
    expect(v.anhaengbar.map(x => x.auftragNr)).toEqual(['AU-2026-0010']);
    await expect(uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, ziel: 'AU-2026-0011', vorgang: V(40) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).rejects.toMatchObject({ status: 422, code: 'kunde' });
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, ziel: 'AU-2026-0010', vorgang: V(41) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(r).toMatchObject({ auftragNr: 'AU-2026-0010', neu: false });
    expect(t.Auftraege).toHaveLength(3);
    expect(t.Auftraege[1][ak('Status')]).toBe('Angebot');
  });

  test('"schon bestellt – verknüpfen": Korb-Zeile -> ✓ vorhanden + Verweis, kein Korb-Eintrag; Lager -> 📦 mit Ort (gebucht erst AM-3); ohne Verweis nur mit Notiz', async () => {
    const kz = o => KORB_SPALTEN.map(c => o[c] ?? '');
    t.Warenkorb_LShop.push(kz({ Schluessel: 'EIGEN:2026-0086', Shop: 'JFN', Herkunft: 'eigen', Referenz: 'AU-2026-0010', LShop_ArticleNr: NR_L, Menge: 5, Status: 'bestellt', Status_Datum: '2026-11-05', Bestell_ID: 'JFN-2026-0042' }));
    const bz = o => BUCHUNG_SPALTEN.map(c => o[c] ?? '');
    t.Lager_Buchungen.push(bz({ Buchung_ID: 'LB-2026-00001', Datum: '2026-11-01', Art: 'inventur', Warenart: 'rohling', Schluessel: `LS:${NR_M}`, Menge: 4, Ort: 'Wrist', Quelle: 'start' }));
    const a = await geprueft([{ art: 'artikel', id: '102', menge: 2 }, { art: 'artikel', id: '101', menge: 1 }, { art: 'extra', freitext: 'Fahne', menge: 1 }]);
    const v = await uebernahmeVorschau({ zugangId: 'BS-001', terminId: termin, sheets: s.sheets, jetzt: JETZT });
    const [eL, eM, eX] = (await mc()).eintraege.map(x => x.id);
    expect(v.kandidaten[eL].map(k => k.verweis)).toEqual(['EIGEN:2026-0086']);
    expect(v.kandidaten[eM].map(k => k.verweis)).toEqual(['LAGER:Wrist']);
    await expect(uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, vorgang: V(50), verknuepfen: { [eX]: { ohne: true, notiz: '' } } }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).rejects.toMatchObject({ status: 422 });
    await expect(uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, vorgang: V(50), verknuepfen: { [eL]: { verweis: 'EIGEN:2026-9999' } } }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).rejects.toMatchObject({ status: 409, code: 'kandidat' });
    const korbVorher = JSON.stringify(t.Warenkorb_LShop), lagerVorher = JSON.stringify(t.Lager_Buchungen);
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, vorgang: V(51), verknuepfen: {
      [eL]: { verweis: 'EIGEN:2026-0086' }, [eM]: { verweis: 'LAGER:Wrist' }, [eX]: { ohne: true, notiz: 'liegt im Laden' } } }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(r).toMatchObject({ vorhanden: 2, lager: 1 });
    const pk = c => t.Auftrag_Positionen[0].indexOf(c);
    const pos = t.Auftrag_Positionen.slice(1).map(p => [p[pk('LShop_ArticleNr')], p[pk('Herkunft')], p[pk('Lager_Ort')], p[pk('Verweis')]]);
    expect(pos).toEqual([[NR_L, 'vorhanden', '', 'EIGEN:2026-0086'], [NR_M, 'lager', 'Wrist', 'LAGER:Wrist'], ['', 'vorhanden', '', 'ohne Verweis: liegt im Laden']]);
    expect(JSON.stringify(t.Warenkorb_LShop)).toBe(korbVorher);   // kein neuer Korb-Eintrag
    expect(JSON.stringify(t.Lager_Buchungen)).toBe(lagerVorher);  // gebucht wird erst mit AM-3
  });

  test('Trockenlauf schreibt nichts; fehlende Spalten -> 409 einrichtung vor jedem Schreiben', async () => {
    const a = await geprueft([{ art: 'artikel', id: '101', menge: 1 }, { art: 'trikot', produktId: '901', groesse: 'L', name: NAME, nummer: '1' }]);
    const vorher = JSON.stringify(t);
    const r = await uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, dryRun: true }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen });
    expect(r).toMatchObject({ dryRun: true, positionen: 1, trikots: 1, neu: true });
    expect(JSON.stringify(t)).toBe(vorher);
    expect(trikotAufrufe).toHaveLength(0);
    t.Auftraege[0] = [...AUFTRAG_SPALTEN, 'Vorgang'].filter((x, i, l) => l.indexOf(x) === i);
    await expect(uebernehmen({ eingabe: { zugangId: 'BS-001', terminId: termin, auswahl: a, vorgang: V(60) }, sheets: s.sheets, jetzt: JETZT, trikotsAnlegen })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(trikotAufrufe).toHaveLength(0);
  });
});

describe('Logik', () => {
  test('Ziel-Auftrag und Grenzen', () => {
    const zg = { Zugang_ID: 'BS-001', Kunden_Nr: 'K-00063' };
    expect(zielAuftrag({ zugang: zg, termin: { Auftrag_Nr: '' }, auftraege: [] })).toEqual({ auftrag: null, neu: true, nachtrag: false });
    expect(zielAuftrag({ zugang: zg, termin: { Auftrag_Nr: 'AU-2026-0001' }, auftraege: [{ Auftrag_Nr: 'AU-2026-0001', Kunden_Nr: 'K-00063', Status: 'fertig' }] })).toMatchObject({ neu: true, nachtrag: true });
    expect(() => verknuepfungAus({ ohne: true, notiz: 'x'.repeat(101) }, [], 'BE-1')).toThrow(/100/);
    expect(() => uebernahmePlan({ zugang: zg, termin: { Termin_ID: 'BT-1', Zugang_ID: 'BS-001' }, eintraege: [], auswahl: [], auftraege: [], positionen: [], jetzt: '2026-11-07T10:00:00Z' })).toThrow(/Keine geprüften/);
  });
  test('Dashboard-Zahl und Anzeige je Position', async () => {
    expect(ungepruefteZahlen([{ Zugang_ID: 'BS-001', Status: 'eingegangen' }, { Zugang_ID: 'BS-001', Status: '' }, { Zugang_ID: 'BS-002', Status: 'geprüft' }]))
      .toEqual({ zahl: 2, jeZugang: [{ zugangId: 'BS-001', anzahl: 2 }] });
    await absenden([{ art: 'artikel', id: '101', menge: 1 }]);
    expect(await leseUngepruefte({ sheets: s.sheets })).toEqual({ zahl: 1, jeZugang: [{ zugangId: 'BS-001', anzahl: 1 }] });
    expect(eintraegeJePosition([{ Eintrag_ID: 'BE-1', Status: 'übernommen', Auftrag_Nr: 'AU-2026-0001', Position_ID: 'AU-2026-0001-01', Kuerzel: 'X', Notiz: 'n', Menge: '2' }], 'AU-2026-0001'))
      .toEqual([expect.objectContaining({ positionId: 'AU-2026-0001-01', kuerzel: 'X', notiz: 'n', menge: 2 })]);
  });
});

describe('Oberflaeche', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const a = html.indexOf('// ── Bestellseiten-Pruefen: Anfang'), b = html.indexOf('// ── Bestellseiten-Pruefen: Ende ──');
  const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  const F = new Function('kuEsc', 'bsmDatum', 'bsmEintragWas', 'BSM_ART', 'bsmNotiz',
    `${html.slice(a, b)}\nreturn { bsmPacklisteHtml, bsmPruefHtml, bsmUebernahmeHtml, bsmUebernahmeText, bsmGk };`)(
    kuEsc, ymd => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}` : '–'),
    e => `${e.menge} × ${e.bezeichnung}`, { artikel: 'Artikel', extra: 'Extra', trikot: 'Trikot' }, e => `· ${e.notiz}`);
  const E = (o) => ({ id: 'BE-1', termin: 'BT-0001', art: 'artikel', bezeichnung: 'Hoodie · Black', groesse: 'M', menge: 1, kuerzel: 'Ki', notiz: '', status: 'übernommen', zeit: '2026-11-07T09:00:00Z', ...o });
  test('Packliste: nur übernommene des Termins, gruppiert, Kürzel + Notiz, Abhakkästchen, escaped, keine Preise', () => {
    const p = F.bsmPacklisteHtml('BS-001', { Termin_ID: 'BT-0001', Datum: '2026-11-22' }, [
      E({ id: 'BE-1', notiz: '<b>x</b>' }), E({ id: 'BE-2', groesse: 'L', menge: 2 }), E({ id: 'BE-3', status: 'geprüft' }), E({ id: 'BE-4', status: 'storniert' }),
      E({ id: 'BE-5', termin: 'BT-0002' }), E({ id: 'BE-6', art: 'trikot', bezeichnung: 'Heim', groesse: 'L', trikotName: 'ERF', trikotNummer: '7' }), E({ id: 'BE-7', art: 'extra', freitext: 'Fahne', menge: 1 })]);
    expect(p).toContain('Lieferung BS-001 · Termin 22.11.2026');
    expect(p).toContain('Hoodie · Black – 3');
    expect((p.match(/bsm-pl-kasten/g) ?? []).length).toBe(4);
    expect(p).toContain('&#60;b&#62;x&#60;/b&#62;');
    expect(p).toContain('Heim · L · ERF · 7');
    expect(p).not.toMatch(/€|Preis/);
  });
  test('Prüf-Ansicht: Torwart-Kennzeichen, abgelehnt mit Grund, Aktionen nur bei offenen, Übernehmen nur mit Termin', () => {
    const z = { Zugang_ID: 'BS-001', termine: [{ Termin_ID: 'BT-0001', Datum: '2026-11-22' }] };
    const h = F.bsmPruefHtml(z, [E({ id: 'BE-1', status: 'eingegangen', art: 'trikot', wunsch: 'Goalie bitte' }), E({ id: 'BE-2', status: 'storniert', ablehnGrund: 'gibt es nicht' }), E({ id: 'BE-3', status: 'geprüft' })], 'BT-0001', { wahl: new Set(['BE-1']) }, Date.parse('2026-11-07T10:00:00Z'));
    expect(h).toContain('data-hilfe="bsm-gk"');
    expect(h).toContain('abgelehnt: gibt es nicht');
    expect((h.match(/data-bsm-e-aendern=/g) ?? []).length).toBe(2);
    expect(h).toContain('data-bsm-uebernehmen');
    expect(h).toContain('data-bsm-packliste');
    expect(h).not.toMatch(/ title=/);
    expect(F.bsmPruefHtml(z, [], '', {})).toContain('einen Termin wählen');
    expect(F.bsmGk({ art: 'trikot', wunsch: 'Torwarttrikot' })).toBe(true);
    expect(F.bsmGk({ art: 'trikot', wunsch: 'GK' })).toBe(true);
    expect(F.bsmGk({ art: 'trikot', wunsch: 'Goalgetter' })).toBe(false);   // "goal" nur als eigenes Wort (wie TR8)
  });
  test('Mouse-over für alle neuen Knöpfe, Kanal Bestellseite in der Auswahl, Dashboard-Kachel', () => {
    for (const k of ['bsm-e-pruefen', 'bsm-e-aendern', 'bsm-e-ablehnen', 'bsm-s-ablehnen', 'bsm-uebernehmen', 'bsm-packliste', 'bsm-u-los', 'bsm-u-quelle', 'au-verweis', 'au-bs-eintrag', 'dash-k-bestellseiten'])
      expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
    expect(html).toContain('<option>Bestellseite</option>');
    expect(html).toMatch(/fehlt\(bs, 'bestellseiten'/);
  });
});
