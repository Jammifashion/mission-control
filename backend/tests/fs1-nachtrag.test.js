// FS1: Nachtrag Fanshop-Bestueckung in die Bestellseite - reine Logik. Nur erfundene Texte, Namen und Preise.
import { spieltagAusText, namenIn, bereinigterText, zuordnen, nachtragPlan, pruefsummen, schreibPlan, cent, preisPlan } from '../utils/fs1-nachtrag.js';
import { nettoAusBrutto, bruttoAusNetto } from '../utils/auftrag-preise.js';
import { auswahlIndex } from '../utils/bestell-eintraege.js';

const ARTIKEL = [
  { key: '1|Black|', name: 'Test Wintermütze', farbe: 'Black', groessen: [{ groesse: '', id: '11', articleNr: '1000000001' }] },
  { key: '1|Bottle Green|', name: 'Test Wintermütze', farbe: 'Bottle Green', groessen: [{ groesse: '', id: '12', articleNr: '1000000002' }] },
  { key: '1|Fuchsia|', name: 'Test Wintermütze', farbe: 'Fuchsia', groessen: [{ groesse: '', id: '13', articleNr: '1000000003' }] },
  { key: '2|Black/White|', name: 'Match Day Cap Test', farbe: 'Black/White', groessen: [{ groesse: '', id: '21', articleNr: '1000000011' }] },
  { key: '2|Black/Red|', name: 'Match Day Cap Test', farbe: 'Black/Red', groessen: [{ groesse: '', id: '22', articleNr: '1000000012' }] },
  { key: '2|Black/Kelly Green|', name: 'Match Day Cap Test', farbe: 'Black/Kelly Green', groessen: [{ groesse: '', id: '23', articleNr: '1000000013' }] },
];
const CATALOG = new Map([['1000000001', 'CB445'], ['1000000002', 'CB445'], ['1000000003', 'CB445']]);
const z = (zeile, datum, text, menge, preis, summe, status = 'offen') => ({ zeile, partnerId: 'FP-009', datum, text, menge: String(menge), einzelpreis: preis, summe, status });

describe('Spieltag aus dem Text', () => {
  test.each([
    ['Mütze Fanshop 02.10.26', '2026-10-02'], ['Mütze Fanshop 02.10.2026', '2026-10-02'], ['Hoodie Fanshop 16.10. (L/XL)', '2026-10-16'],
    ['Zipper Fanshop 6.11.', '2026-11-06'], ['Puck (Oktober/Nov)', ''], ['Sitzkissen', ''], ['Hoodie 4XL', ''],
  ])('%s', (text, soll) => expect(spieltagAusText(text, '2026-10-01')).toBe(soll));
});

describe('Namen und Freitext', () => {
  test('Name erkannt, Wortschatz nicht', () => {
    expect(namenIn('Winterjacke Testperson')).toEqual(['Testperson']);
    expect(namenIn('Bommemütze Grün Fanhsop 16.10.2026')).toEqual([]);
  });
  test('Freitext ohne Name, Datum, Fanshop', () => {
    expect(bereinigterText('Fluffy Hose Testperson 4XL Fansjop 06.11.', ['Testperson'])).toBe('Fluffy Hose 4XL');
    expect(bereinigterText('Puck Kind (Oktover/Nov)')).toBe('Puck Kind');
  });
});

describe('Zuordnung', () => {
  test('Modellnummer + sichere Farbe = Artikel', () => {
    const r = zuordnen('CB445 Schwarze Mützen Fanshop 02.10.26', ARTIKEL, CATALOG);
    expect(r.sicher).toBe(true);
    expect(r.auswahl.id).toBe('11');
  });
  test('ähnliche Farbe = frei mit Vorschlag', () => {
    const r = zuordnen('CB445 Pinke Mützen', ARTIKEL, CATALOG);
    expect(r.sicher).toBe(false);
    expect(r.vorschlag).toMatch(/Fuchsia/);
  });
  test('weiß mit ß und grün mit Umlaut', () => {
    expect(zuordnen('Matchday Cap weiß', ARTIKEL).auswahl.id).toBe('21');
    expect(zuordnen('Matchday Cap grün', ARTIKEL).auswahl.id).toBe('23');
  });
  test('vom Inhaber bestaetigter Vorschlag wird Artikel', () => {
    const plan = nachtragPlan({ zeilen: [z(2, '30.09.2026', 'CB445 Pinke Mützen Fanshop 02.10.26', 5, '10', '50')], partnerId: 'FP-009',
      von: '2026-09-30', bis: '2026-11-22', schonAb: '2026-11-18', artikel: ARTIKEL, catalogJe: CATALOG, bestaetigt: new Set([2]) });
    expect(plan.eintragen[0]).toMatchObject({ art: 'artikel', zuordnung: { auswahl: { id: '13' } } });
  });
  test('ohne Farbe bzw. mehrdeutig = frei', () => {
    expect(zuordnen('Matchday Cap', ARTIKEL).sicher).toBe(false);
    expect(zuordnen('Matchday Cap schwarz', ARTIKEL).sicher).toBe(false);
    expect(zuordnen('Sitzkissen', ARTIKEL).sicher).toBe(false);
  });
});

describe('Plan', () => {
  const zeilen = [
    z(2, '30.09.2026', 'CB445 Schwarze Mützen Fanshop 02.10.26', 5, '10', '50'),
    z(3, '10.10.2026', 'Trikost Testa und Testb Fanshop 10.10.2026', 4, '33', '132'),
    z(4, '18.11.2026', 'Trikost Testa und Testb Fanshop 10.10.2026 Handling ohne Versand', 4, '1,5', '6'),
    z(5, '10.10.2026', 'Porto Testfirma Trikots', 1, '9,99', '9,99'),
    z(6, '20.10.2026', 'Sitzkissen', 6, '5', '30'),
    z(7, '06.11.2026', 'Match Day Cap rot Fanshop 22.11.', 3, '10', '30'),
    z(8, '22.11.2026', 'Porto Testfirma', 2, '5,9', '11,8'),
    z(9, '31.03.2026', 'Trikots selber bezahlt', 3, '-33', '-99', 'abgerechnet'),
    z(10, '01.12.2026', 'außerhalb', 1, '1', '1'),
  ];
  const plan = nachtragPlan({ zeilen, partnerId: 'FP-009', von: '2026-09-30', bis: '2026-11-22', terminDaten: ['2026-11-22', '2026-11-27'],
    schonAb: '2026-11-18', artikel: ARTIKEL, catalogJe: CATALOG });

  test('Trikot + Handling = eine Position zu 34,50', () => {
    const tr = plan.eintragen.find(x => x.zeile === 3);
    expect(tr.preisCent).toBe(3450);
    expect(tr.freitext).toBe('Trikots (inkl. Handling)');
    expect(plan.eintragen.find(x => x.zeile === 4).art).toBe('zusammengefasst');
  });
  test('Porto frei, Spieltag abgeleitet; ohne Spieltag = naechster Spieltag', () => {
    const p = plan.eintragen.find(x => x.zeile === 5);
    expect(p.freitext).toBe('Porto');
    expect(p.namen).toEqual([]);   // Porto: Wort dahinter nie in "für wen"
    expect(p.spieltag).toBe('2026-10-10');
    expect(plan.schon.find(x => x.zeile === 6).spieltag).toBe('2026-11-22');   // Sitzkissen: naechster Spieltag = schon in BS-001
  });
  test('22.11./27.11. und spaete Zeilen ohne Spieltag nur markieren', () => {
    expect(plan.schon.map(x => x.zeile).sort()).toEqual([6, 7, 8]);
    expect(plan.abgerechnet.map(x => x.zeile)).toEqual([9]);
    expect([...plan.eintragen, ...plan.schon].some(x => x.zeile === 10)).toBe(false);
  });
  test('Pruefsumme je Spieltag gleich', () => {
    for (const e of pruefsummen(plan.eintragen).values()) expect(e.neu).toBe(e.alt);
    expect(cent('1.234,50')).toBe(123450);
  });
  test('Schreibplan: Termin je Spieltag, Name nur in Fuer, Vorgang verhindert Doppel', () => {
    const zugang = { Zugang_ID: 'BS-009', Art: 'dauer' };
    const idx = auswahlIndex({ artikel: ARTIKEL, trikots: [], art: 'dauer' });
    const arg = { eintragen: plan.eintragen, zugang, termine: [{ Termin_ID: 'BT-0001', Zugang_ID: 'BS-009', Datum: '2026-11-22' }], idx,
      kuerzel: 'Nachtrag', terminNotiz: 'Nachtrag', jetzt: new Date('2026-11-22T12:00:00Z'), bestellschlussFuer: () => '2026-01-01' };
    const p = schreibPlan({ ...arg, eintraege: [] });
    expect(p.termineNeu.map(x => x.Datum)).toEqual(['2026-10-02', '2026-10-10']);
    const tr = p.eintraegeNeu.find(x => x.Vorgang === 'FS1-3');
    expect(tr.Fuer).toBe('Testa, Testb');
    expect(tr.Freitext).not.toMatch(/Testa|Testb/);
    expect(p.eintraegeNeu.find(x => x.Vorgang === 'FS1-2')).toMatchObject({ Art: 'artikel', WC_Variation_ID: '11' });
    const nochmal = schreibPlan({ ...arg, eintraege: p.eintraegeNeu });
    expect(nochmal.eintraegeNeu).toHaveLength(0);
  });
});

describe('Preise nach dem Übernehmen', () => {
  const quelle = [
    { zeile: 3, status: 'Bestellseite', verweis: 'BS-009 · BT-0002 · BE-00010', einzelpreis: '33' },
    { zeile: 4, status: 'Bestellseite', verweis: 'BS-009 · BT-0002 · BE-00010 (mit Zeile 3)', einzelpreis: '1,5' },
    { zeile: 5, status: 'Bestellseite', verweis: 'BS-009 · BT-0002 · BE-00011', einzelpreis: '2,25' },
    { zeile: 6, status: 'Bestellseite', verweis: 'BS-009 · BT-0002 · BE-00012', einzelpreis: '10' },
    { zeile: 7, status: 'Bestellseite', verweis: 'steht in BS-009 · BT-0001', einzelpreis: '10' },
    { zeile: 8, status: 'offen', verweis: '', einzelpreis: '10' },
  ];
  const eintraege = [
    { Eintrag_ID: 'BE-00010', Status: 'übernommen', Position_ID: 'AU-2026-0099-01', Auftrag_Nr: 'AU-2026-0099' },
    { Eintrag_ID: 'BE-00011', Status: 'übernommen', Position_ID: 'AU-2026-0099-02', Auftrag_Nr: 'AU-2026-0099' },
    { Eintrag_ID: 'BE-00012', Status: 'geprüft', Position_ID: '', Auftrag_Nr: '' },
  ];
  const positionen = [
    { Position_ID: 'AU-2026-0099-01', Auftrag_Nr: 'AU-2026-0099', Preis_Netto: '', USt_Satz: '', _zeile: 5 },
    { Position_ID: 'AU-2026-0099-02', Auftrag_Nr: 'AU-2026-0099', Preis_Netto: 1.5, USt_Satz: '', _zeile: 6 },
  ];
  const plan = preisPlan({ quelle, statusWert: 'Bestellseite', eintraege, positionen,
    auftraege: [{ Auftrag_Nr: 'AU-2026-0099', Preis_Eingabe: '', _zeile: 3 }], nettoAusBrutto });
  test('Trikot + Handling = 34,50 brutto, exakt zurueck', () => {
    expect(plan.setzen).toHaveLength(1);
    expect(bruttoAusNetto(plan.setzen[0].netto)).toBe(34.5);
  });
  test('vorhandener Preis bleibt, nicht uebernommen = offen, Auftrag auf brutto', () => {
    expect(plan.schon).toEqual(['AU-2026-0099-02']);
    expect(plan.offen).toEqual(['BE-00012']);
    expect(plan.auftraege).toEqual([{ auftragNr: 'AU-2026-0099', zeile: 3, setzeEingabe: true }]);
  });
});
