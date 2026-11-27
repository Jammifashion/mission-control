// KS8: Bestellseite -> Auftrag -> Korb mit weniger Klicks. Reine Logik + Oberflaeche, nur erfundene Daten.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const U = await import('../utils/bestell-uebernahme.js');
const B = await import('../utils/auftrag-bereitstellen.js');
const S = await import('../utils/bestellseite.js');
const { GRUND_IM_AUFTRAG_ENTFERNT, GRUENDE } = await import('../utils/korb-logic.js');

const NR = '1000000001';

describe('Herkunft-Vorschlag', () => {
  const bestand = new Map([[NR, { summe: 5, orte: [{ ort: 'Wrist', menge: 4 }, { ort: 'Itzehoe', menge: 1 }] }]]);
  const waehlbar = new Set([NR]);
  const e = o => ({ Art: 'artikel', LShop_ArticleNr: NR, Menge: '2', ...o });
  test('Lager deckt die Menge -> aus Lager (Ort mit genug), sonst neu bestellen, Extra -> bei uns, Trikot -> Trikot-Seite', () => {
    expect(U.herkunftVorschlag(e(), { waehlbar, bestand })).toMatchObject({ herkunft: 'lager', ort: 'Wrist' });
    expect(U.herkunftVorschlag(e({ Menge: '9' }), { waehlbar, bestand })).toMatchObject({ herkunft: 'bestellen' });
    expect(U.herkunftVorschlag(e({ LShop_ArticleNr: '' }), { waehlbar, bestand })).toMatchObject({ herkunft: 'vorhanden' });
    expect(U.herkunftVorschlag({ Art: 'extra', Menge: '1' }, { waehlbar, bestand })).toMatchObject({ herkunft: 'vorhanden' });
    expect(U.herkunftVorschlag({ Art: 'trikot' }, {})).toMatchObject({ herkunft: 'trikot' });
  });
});

describe('Festpreis (ohne Handling)', () => {
  const fpArtikel = [{ partnerId: 'FP-009', produktId: '500', artikelkategorie: 'Shirts' }, { partnerId: 'FP-009', produktId: '501', artikelkategorie: '' }];
  const fpKategorie = [{ partnerId: 'FP-009', kategorie: 'Shirts', festpreis: '12,34' }, { partnerId: 'FP-009', kategorie: 'Gratis', festpreis: '0' }];
  test('Preis aus Kategorie, fehlend -> Grund, nie still 0; 0 im Sheet ist bewusst', () => {
    expect(U.festpreisFuer({ produktId: '500', partnerId: 'FP-009', fpArtikel, fpKategorie })).toEqual({ netto: 12.34 });
    expect(U.festpreisFuer({ produktId: '501', partnerId: 'FP-009', fpArtikel, fpKategorie }).grund).toMatch(/keine Artikelkategorie/);
    expect(U.festpreisFuer({ produktId: '999', partnerId: 'FP-009', fpArtikel, fpKategorie }).grund).toMatch(/nicht in FP_Artikel/);
    expect(U.festpreisFuer({ produktId: '500', partnerId: 'FP-009', fpArtikel, fpKategorie: [] }).grund).toMatch(/Festpreis fehlt für Kategorie/);
    expect(U.festpreisFuer({ produktId: '502', partnerId: 'FP-009', fpArtikel: [{ partnerId: 'FP-009', produktId: '502', artikelkategorie: 'Gratis' }], fpKategorie })).toEqual({ netto: 0 });
  });
});

describe('Uebernahme ohne "geprüft", mit Festpreis', () => {
  const zugang = { Zugang_ID: 'BS-009', Kunden_Nr: 'K-00009', Art: 'dauer' };
  const termin = { Termin_ID: 'BT-0009', Zugang_ID: 'BS-009', Datum: '2026-12-06', Auftrag_Nr: '' };
  const eintrag = (id, o = {}) => ({ Eintrag_ID: id, Zugang_ID: 'BS-009', Termin_ID: 'BT-0009', Art: 'artikel', LShop_ArticleNr: NR, WC_Variation_ID: '700', Menge: '1', Status: 'eingegangen', Stand: 's', ...o });
  const plan = (eintraege, preisJe) => U.uebernahmePlan({ zugang, termin, eintraege, auswahl: eintraege.map(e => ({ id: e.Eintrag_ID, stand: 's' })),
    auftraege: [], positionen: [], waehlbar: new Set([NR]), vorgang: 'vorgang-ks8-1', jetzt: '2026-11-28T10:00:00Z', preisJe });
  test('eingegangen und Altstand geprüft werden übernommen, übernommene nicht', () => {
    expect(plan([eintrag('BE-1'), eintrag('BE-2', { Status: 'geprüft' })]).anzahl).toBe(2);
    expect(() => plan([eintrag('BE-3', { Status: 'übernommen' })])).toThrow(/nicht mehr offen/);
  });
  test('Festpreis je Position; fehlt er, bleibt die Position ohne Preis mit Grund in der Notiz', () => {
    const mit = plan([eintrag('BE-1'), eintrag('BE-2')], new Map([['BE-1', { netto: 12.34 }], ['BE-2', { netto: 12.34 }]]));
    expect(mit.positionenNeu[0]).toMatchObject({ Preis_Netto: 12.34, Notiz: '', Menge: '2' });
    const ohne = plan([eintrag('BE-1')], new Map([['BE-1', { grund: 'Festpreis fehlt für Kategorie „X“' }]]));
    expect(ohne.positionenNeu[0].Preis_Netto ?? '').toBe('');
    expect(ohne.positionenNeu[0].Notiz).toMatch(/Festpreis fehlt/);
    expect(plan([eintrag('BE-1')]).positionenNeu[0].Preis_Netto ?? '').toBe('');   // ohne Festpreis-Partner: wie bisher
  });
});

describe('Trikots beim Festpreis-Kunden: extra Abrechnungsposition', () => {
  const zugang = { Zugang_ID: 'BS-009', Kunden_Nr: 'K-00009', Art: 'dauer' };
  const termin = { Termin_ID: 'BT-0009', Zugang_ID: 'BS-009', Datum: '2026-12-06', Auftrag_Nr: '' };
  const tr = (id, o = {}) => ({ Eintrag_ID: id, Zugang_ID: 'BS-009', Termin_ID: 'BT-0009', Art: 'trikot', Trikot_Produkt: '900', Bezeichnung: 'Heimtrikot',
    Groesse: 'L', Trikot_Name: 'GEHEIMNAME', Trikot_Nummer: '7', Menge: '1', Status: 'eingegangen', Stand: 's', ...o });
  const fpArtikel = [{ partnerId: 'FP-009', produktId: '900', artikelkategorie: 'Trikots' }];
  test('Festpreis + Handling_Fanshop; fehlt das Handling -> Grund', () => {
    expect(U.festpreisFuer({ produktId: '900', partnerId: 'FP-009', fpArtikel, fpKategorie: [{ partnerId: 'FP-009', kategorie: 'Trikots', festpreis: '20,00', handlingFanshop: '1,10' }], trikot: true })).toEqual({ netto: 21.1 });
    expect(U.festpreisFuer({ produktId: '900', partnerId: 'FP-009', fpArtikel, fpKategorie: [{ partnerId: 'FP-009', kategorie: 'Trikots', festpreis: '20,00' }], trikot: true }).grund).toMatch(/Handling_Fanshop/);
  });
  test('eine Position je Modell + Größe, ohne Name/Nummer, Druck nie DTF; Eintrag behält die Trikot-Zeile', async () => {
    const eintraege = [tr('BE-1'), tr('BE-2', { Trikot_Name: 'ANDERER' }), tr('BE-3', { Groesse: 'M' })];
    const preisJe = new Map(eintraege.map(e => [e.Eintrag_ID, { netto: 21.1 }]));
    const p = U.uebernahmePlan({ zugang, termin, eintraege, auswahl: eintraege.map(e => ({ id: e.Eintrag_ID, stand: 's' })), auftraege: [], positionen: [],
      vorgang: 'vorgang-ks8-3', jetzt: '2026-11-28T10:00:00Z', preisJe });
    expect(p.trikots).toHaveLength(3);
    expect(p.positionenNeu.map(x => [x.Freitext, x.Menge, x.Preis_Netto, x.Druck])).toEqual([['Trikot Heimtrikot · L', '2', 21.1, U.TRIKOT_DRUCK], ['Trikot Heimtrikot · M', '1', 21.1, U.TRIKOT_DRUCK]]);
    expect(JSON.stringify(p.positionenNeu)).not.toMatch(/GEHEIMNAME|ANDERER/);
    expect(p.eintragFelder.every(f => f.trikot !== undefined)).toBe(true);
    const { istDtf } = await import('../utils/druckkosten.js');
    expect(istDtf(U.TRIKOT_DRUCK)).toBe(false);
    // ohne Festpreis-Partner: wie bisher nur Trikot-Seite, keine Position
    expect(U.uebernahmePlan({ zugang, termin, eintraege, auswahl: eintraege.map(e => ({ id: e.Eintrag_ID, stand: 's' })), auftraege: [], positionen: [],
      vorgang: 'vorgang-ks8-4', jetzt: '2026-11-28T10:00:00Z' }).positionenNeu).toEqual([]);
  });
});

describe('Bereitstellen nur für die neuen Positionen', () => {
  test('nurPositionen begrenzt die offenen Positionen', () => {
    const auftrag = { Auftrag_Nr: 'AU-2026-0900', Status: 'Design', Stand: 's' };
    const pos = id => ({ Position_ID: id, Auftrag_Nr: 'AU-2026-0900', Art: 'lshop', LShop_ArticleNr: NR, Menge: '1', Herkunft: 'bestellen' });
    const r = B.bereitstellenPlan({ auftrag, positionen: [pos('AU-2026-0900-01'), pos('AU-2026-0900-02')], korbZeilen: [], buchungen: [], orte: ['Wrist'],
      waehlbar: new Set([NR]), vorgang: 'vorgang-ks8-2', jetzt: '2026-11-28T10:00:00Z', nurPositionen: ['AU-2026-0900-02'] });
    expect(r.korbNeu).toHaveLength(1);
    expect(r.korbNeu[0].Referenz).toBe('AU-2026-0900');
  });
});

describe('Storno-Gegenrichtung im Korb', () => {
  const p = { Position_ID: 'AU-2026-0900-01', Korb_Schluessel: 'EIGEN:2026-0100' };
  const z = st => [{ _zeile: 7, Schluessel: 'EIGEN:2026-0100', Status: st, Grund: st === 'abgewählt' ? GRUND_IM_AUFTRAG_ENTFERNT : '' }];
  const jetzt = new Date('2026-11-28T10:00:00Z');
  test('entfernen: offen -> abgewählt "im Auftrag entfernt"; bestellt -> nur Hinweis; wiederherstellen kehrt um', () => {
    expect(GRUENDE).toContain(GRUND_IM_AUFTRAG_ENTFERNT);
    expect(B.entfernenKorbPlan({ position: p, korbZeilen: z('offen'), jetzt, grund: GRUND_IM_AUFTRAG_ENTFERNT }).korb)
      .toMatchObject({ zeile: 7, werte: { Status: 'abgewählt', Grund: GRUND_IM_AUFTRAG_ENTFERNT } });
    const b = B.entfernenKorbPlan({ position: p, korbZeilen: z('bestellt'), jetzt, grund: GRUND_IM_AUFTRAG_ENTFERNT });
    expect(b.korb).toBeNull();
    expect(b.hinweis).toMatch(/schon „bestellt“ – Rest ins Lager/);
    expect(B.entfernenKorbPlan({ position: p, korbZeilen: z('abgewählt'), wiederherstellen: true, jetzt, grund: GRUND_IM_AUFTRAG_ENTFERNT }).korb)
      .toMatchObject({ werte: { Status: 'offen', Grund: '' } });
    // von Hand mit anderem Grund abgewählt -> wiederherstellen fasst sie nicht an
    expect(B.entfernenKorbPlan({ position: p, korbZeilen: [{ _zeile: 7, Schluessel: 'EIGEN:2026-0100', Status: 'abgewählt', Grund: 'Sonstiges' }], wiederherstellen: true, jetzt, grund: GRUND_IM_AUFTRAG_ENTFERNT }).korb).toBeNull();
    expect(B.entfernenKorbPlan({ position: { Position_ID: 'x' }, korbZeilen: [], jetzt, grund: GRUND_IM_AUFTRAG_ENTFERNT })).toEqual({ korb: null, hinweis: '' });
  });
});

describe('Sortiment: Shop-Status vor Sheet, Status Shop aufräumen', () => {
  test('Shop-Stand aus Bestell_Bilder geht vor, ohne Stand zählt die Sheet-Spalte', () => {
    const bilder = new Map([['1', { status: 'publish' }], ['2', { status: 'draft' }]]);
    expect(S.istVeroeffentlicht({ produktId: '1', status: 'Entwurf' }, bilder)).toBe(true);
    expect(S.istVeroeffentlicht({ produktId: '2', status: 'Veröffentlicht' }, bilder)).toBe(false);
    expect(S.istVeroeffentlicht({ produktId: '3', status: 'Veröffentlicht' }, bilder)).toBe(true);
  });
  test('Korrektur nur bei Abweichung und eindeutiger Zeile', () => {
    const plan = S.statusKorrekturPlan([{ zeile: 2, produktId: '1', status: 'Entwurf' }, { zeile: 3, produktId: '2', status: 'Veröffentlicht' },
      { zeile: 4, produktId: '5', status: 'Entwurf' }, { zeile: 5, produktId: '5', status: 'Entwurf' }], new Map([['1', 'publish'], ['2', 'publish'], ['5', 'publish']]));
    expect(plan).toEqual([{ zeile: 2, alt: 'Entwurf', neu: 'Veröffentlicht', produktId: '1' }]);
  });
});

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
describe('Oberfläche', () => {
  const kuEsc = v => String(v ?? '');
  const bsmDatum = v => v;
  const a = html.indexOf('// KS8: nur kommende Termine sichtbar'), b = html.indexOf('// KS2: Eintraege eines Zugangs nur ansehen');
  const F = new Function('kuEsc', 'bsmDatum', `${html.slice(a, b)}\n return { bsmTermineHtml, bsmStartTermin };`)(kuEsc, bsmDatum);
  const z = { termine: [{ Termin_ID: 'BT-1', Datum: '2026-11-01' }, { Termin_ID: 'BT-2', Datum: '2026-12-06' }, { Termin_ID: 'BT-3', Datum: '2026-12-20' }] };
  test('vergangene Termine eingeklappt, kommende sichtbar', () => {
    const h = F.bsmTermineHtml(z, '2026-11-28');
    expect(h.indexOf('2026-12-06')).toBeLessThan(h.indexOf('<details'));
    expect(h).toMatch(/<details[^>]*><summary[^>]*>vergangene \(1\) anzeigen<\/summary>[\s\S]*2026-11-01/);
  });
  test('Start-Termin: nächster mit offenen Einträgen', () => {
    expect(F.bsmStartTermin(z, [{ termin: 'BT-3', status: 'eingegangen' }, { termin: 'BT-2', status: 'übernommen' }], '2026-11-28')).toBe('BT-3');
    expect(F.bsmStartTermin(z, [], '2026-11-28')).toBe('BT-2');
  });
  test('Knöpfe mit Mouse-over: Einträge (n neu) als Hauptknopf, Seite öffnen, Sortiment ändern', () => {
    expect(html).toContain('data-bsm-eintraege data-hilfe="bsm-eintraege">Einträge (${Number(z.offenEintraege)} neu)</button>');
    expect(html).toMatch(/korb-aktion-haupt" data-bsm-eintraege/);
    expect(html).toContain('data-bsm-seite-oeffnen data-hilfe="bsm-seite-oeffnen">Seite öffnen ↗');
    for (const k of ['bsm-seite-oeffnen', 'bsm-termine-alt', 'bsm-alle-zeigen', 'bsm-sortiment-aendern', 'bsm-e-uebernehmen', 'bsm-e-herkunft'])
      expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
    expect(html).toContain("bereitstellen: true });");
    expect(html).not.toMatch(/data-bsm-s-pruefen/);
  });
});
