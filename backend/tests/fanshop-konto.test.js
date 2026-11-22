// GS2 Teil B: Fanshop-Konto (Saldo, Fanshop offen, Belege, offene Fanshop-Bestellungen). Nur ERFUNDENE Kunden, Namen und Betraege.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fanshopKonto, vorname, belegStatus } from '../utils/fanshop-konto.js';
import { nettoAusBrutto } from '../utils/auftrag-preise.js';

const hier = dirname(fileURLToPath(import.meta.url));
const RE1 = '0b1c2d3e-4f50-4617-8899-aabbccddee01', RE2 = '0b1c2d3e-4f50-4617-8899-aabbccddee02', RE3 = '0b1c2d3e-4f50-4617-8899-aabbccddee03';
const GS1 = '0b1c2d3e-4f50-4617-8899-aabbccddee11', GS2 = '0b1c2d3e-4f50-4617-8899-aabbccddee12';
const au = (nr, extra = {}) => ({ Auftrag_Nr: nr, Kunden_Nr: 'K-00900', Kurztitel: `Fanshop ${nr.slice(-2)}`, Status: 'übergeben', Termin: '2026-10-02', ...extra });
const pos = (id, nr, brutto, menge = 1, extra = {}) => ({ Position_ID: id, Auftrag_Nr: nr, Art: 'frei', Freitext: `Muster-Mütze ${id.slice(-2)}`, Menge: menge,
  Preis_Netto: brutto === null ? '' : nettoAusBrutto(brutto), ...extra });
const beleg = (id, voucherType, voucherStatus, totalAmount, openAmount, nr, datum) => [id, { id, voucherType, voucherStatus, totalAmount, openAmount, voucherNumber: nr, voucherDate: datum }];

const auftraege = [
  au('AU-2026-0101', { Rechnung_Lexware_ID: RE1, Rechnung_Status: 'entwurf', Rechnung_Am: '2026-10-05' }),   // bezahlt
  au('AU-2026-0102', { Rechnung_Lexware_ID: RE2, Rechnung_Status: 'entwurf', Rechnung_Am: '2026-11-01' }),   // offen
  au('AU-2026-0103', { Rechnung_Lexware_ID: RE3, Rechnung_Status: 'entwurf', Rechnung_Am: '2026-11-20' }),   // in Lexware noch Entwurf
  au('AU-2026-0104', { Termin: '2026-11-22' }),                                                              // noch nicht abgerechnet
  au('AU-2026-0105', { Status: 'storniert', Storniert_Am: '2026-10-01' }),                                   // zaehlt nie
  au('AU-2026-0106', { Kunden_Nr: 'K-00999' }),                                                              // anderer Kunde
];
const positionen = [
  pos('AU-2026-0101-01', 'AU-2026-0101', 10), pos('AU-2026-0102-01', 'AU-2026-0102', 20), pos('AU-2026-0103-01', 'AU-2026-0103', 30),
  pos('AU-2026-0104-01', 'AU-2026-0104', 10, 2), pos('AU-2026-0104-02', 'AU-2026-0104', null), pos('AU-2026-0105-01', 'AU-2026-0105', 99),
  pos('AU-2026-0106-01', 'AU-2026-0106', 99),
];
const belege = new Map([
  beleg(RE1, 'invoice', 'paid', 10, 0, 'RE-2026-0001', '2026-10-05'),
  beleg(RE2, 'invoice', 'open', 20, 20, 'RE-2026-0002', '2026-11-01'),
  beleg(RE3, 'invoice', 'draft', 30, null, '', '2026-11-20'),
  beleg(GS1, 'creditnote', 'open', 160.58, 160.58, 'GS-2026-0007', '2026-11-22'),
  beleg(GS2, 'creditnote', 'draft', 1840.28, null, '', '2026-11-22'),
]);
const fuerJe = new Map([['AU-2026-0104-01', ['Anna Musterfrau', 'Ben Beispiel-Mann']]]);
const basis = { kundenNr: 'K-00900', auftraege, positionen, fuerJe, belege,
  gutschriften: [{ abrechnung: 'FPA-0002', id: GS1 }, { abrechnung: 'FPA-0003', id: GS2 }],
  auszahlung: { saldo: 100, ausstehend: 100, laufend: 0, abgerechnetBis: '22.11.2026' } };

describe('Fanshop-Konto (reine Logik)', () => {
  test('MC: Rechnungen offen = offen + Entwurf, noch nicht abgerechnet = Auftraege ohne Kennzeichen; Saldo = Auszahlung − Fanshop offen', () => {
    const k = fanshopKonto({ ...basis, mitEntwuerfen: true });
    expect(k.fanshopOffen).toMatchObject({ rechnungen: 50, auftraege: 20, gesamt: 70, ohnePreis: 1, auftraegeAnzahl: 1 });
    expect(k.saldo).toBe(30);
    expect(k.lexware).toBe('ok');
    expect(k.belege.map(b => `${b.art}:${b.status}`)).toEqual(['gutschrift:offen', 'gutschrift:entwurf', 'rechnung:entwurf', 'rechnung:offen', 'rechnung:bezahlt']);
    expect(k.belege.every(b => b.id)).toBe(true);
  });
  test('Portal: keine Entwuerfe, keine IDs; Entwurfs-Rechnung zaehlt bei "noch nicht abgerechnet"; gleicher Saldo', () => {
    const k = fanshopKonto({ ...basis, mitEntwuerfen: false });
    expect(k.fanshopOffen).toMatchObject({ rechnungen: 20, auftraege: 50, gesamt: 70 });
    expect(k.saldo).toBe(30);
    expect(k.belege.map(b => b.status)).toEqual(['offen', 'offen', 'bezahlt']);
    const json = JSON.stringify(k);
    for (const x of [RE1, RE2, RE3, GS1, GS2, 'Musterfrau', 'Beispiel', 'K-00999', 'AU-2026-0105']) expect(json).not.toContain(x);
    expect(k.offeneAuftraege[0].positionen[0]).toMatchObject({ menge: 2, summe: 20, fuer: ['Anna', 'Ben'] });
    expect(k.offeneAuftraege[0]).toMatchObject({ datum: '2026-11-22', stueck: 3, summe: 20, ohnePreis: 1 });
    expect(k.offeneAuftraege[0].positionen[1].summe).toBeNull();
  });
  test('Lexware-Ausfall: Rechnungsteil, Fanshop offen und Saldo unbekannt - nie geraten', () => {
    const k = fanshopKonto({ ...basis, belege: null, mitEntwuerfen: false });
    expect(k).toMatchObject({ lexware: 'unbekannt', saldo: null, fanshopOffen: { gesamt: null, rechnungen: null, auftraege: 20 } });
    expect(k.belege.every(b => b.status === 'unbekannt' && b.betrag === null)).toBe(true);
    expect(k.auszahlung.saldo).toBe(100);
  });
  test('unklares Rechnungskennzeichen zaehlt mit dem Auftragsbetrag als offen; negativer Saldo = zahlst du noch', () => {
    const k = fanshopKonto({ ...basis, auftraege: [...auftraege, au('AU-2026-0107', { Rechnung_Status: 'unklar', Rechnung_Am: '2026-11-22' })],
      positionen: [...positionen, pos('AU-2026-0107-01', 'AU-2026-0107', 200)], mitEntwuerfen: true });
    expect(k.fanshopOffen.rechnungen).toBe(250);
    expect(k.saldo).toBe(-170);
  });
  test('Vorname: nur erstes Wort, ohne Satzzeichen, hoechstens 20 Zeichen', () => {
    expect(vorname('Anna Musterfrau')).toBe('Anna');
    expect(vorname('  Jean-Luc, Picard')).toBe('Jean-Luc');
    expect(vorname('Maximilianusabcdefghijk')).toHaveLength(20);
    expect(vorname('')).toBe('');
    expect(belegStatus('paidoff')).toBe('bezahlt');
    expect(belegStatus('voided')).toBe('storniert');
  });
});

describe('Lesen', () => {
  test('Partner ohne Kunden_Nr: aktiv false, keine weitere Lesung', async () => {
    process.env.BUSINESS_SHEET_ID = 'biz'; process.env.GOOGLE_SHEET_ID = 'ssot';
    const { leseFanshopKonto, _fanshopKontoLeeren } = await import('../lib/fanshopKonto.js');
    _fanshopKontoLeeren();
    const gelesen = [];
    const sheets = { spreadsheets: { values: { get: async ({ range }) => { gelesen.push(range); return { data: { values: [['Partner-ID', 'Name', 'Kunden_Nr'], ['FP-909', 'X', '']] } }; } } } };
    expect(await leseFanshopKonto({ partnerId: 'FP-909', sheets })).toEqual({ aktiv: false });
    expect(gelesen).toEqual(["'FP_Partner'"]);
  });
  test('Quelltext: Lexware nur ueber den Belegleser (nur lesen), Fehler -> null statt Zahl', () => {
    const q = readFileSync(resolve(hier, '../lib/fanshopKonto.js'), 'utf8');
    expect(q).toContain("from './lexwareBelege.js'");
    expect(q).not.toMatch(/method: '(POST|PUT|PATCH|DELETE)'/);
    expect(q).toMatch(/let belege = null;[\s\S]*catch \(err\)/);
  });
});

describe('Anzeige (Baustein wortgleich in MC und Portal)', () => {
  const html = f => readFileSync(resolve(hier, `../../frontend/${f}`), 'utf8');
  const block = f => { const h = html(f); return h.slice(h.indexOf('// ── Fanshop-Konto: Anfang'), h.indexOf('// ── Fanshop-Konto: Ende')); };
  const css = f => { const h = html(f); return h.slice(h.indexOf('/* ── Fanshop-Konto CSS'), h.indexOf('/* ── Fanshop-Konto CSS: Ende')); };
  const norm = b => b.split('\n').map(l => l.trim()).join('\n');
  const F = new Function(`${block('index.html')}\nreturn { fkHtml };`)();
  test('identisch in index.html und partner-festpreis.html (Code und CSS), nur Farbvariablen, kein title=', () => {
    expect(block('index.html').length).toBeGreaterThan(1500);
    expect(norm(block('partner-festpreis.html'))).toBe(norm(block('index.html')));
    expect(norm(css('partner-festpreis.html'))).toBe(norm(css('index.html')));
    expect(css('index.html')).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/);
    expect(block('index.html')).not.toMatch(/\stitle=/);
    expect(css('index.html')).not.toContain('--danger');
  });
  test('Saldo positiv gruen, negativ orange "zahlst du noch", Lexware unbekannt ohne Zahl; Links nur mit linkBasis', () => {
    const k = fanshopKonto({ ...basis, mitEntwuerfen: false });
    const h = F.fkHtml(k);
    expect(h).toContain('fk-saldo fk-plus');
    expect(h).toContain('bekommst du noch');
    expect(h).toContain('abgerechnet bis 22.11.2026');
    expect(h).toMatch(/Rechnungen offen: 20,00\s€ · noch nicht abgerechnet: 50,00\s€/);
    expect(h).toContain('für Anna, Ben');
    expect(h).not.toContain('In Lexware öffnen');
    const minus = F.fkHtml({ ...k, saldo: -5 });
    expect(minus).toContain('fk-saldo fk-minus');
    expect(minus).toContain('zahlst du noch');
    const unb = F.fkHtml(fanshopKonto({ ...basis, belege: null, mitEntwuerfen: false }));
    expect(unb).toContain('Stand Lexware unbekannt');
    const mc = fanshopKonto({ ...basis, mitEntwuerfen: true });
    expect(F.fkHtml(mc, { rechnung: 'https://x/inv/', gutschrift: 'https://x/cn/' })).toContain(`href="https://x/cn/${GS1}"`);
    expect(F.fkHtml({ aktiv: false })).toBe('');
  });
  test('Mouse-over/ⓘ: Knopf mit data-hilfe (MC) und data-tipp (Portal), Hilfetexte in MC', () => {
    expect(block('index.html')).toContain('data-hilfe="fk-info" data-tipp=');
    for (const k of ['fk-info', 'fk-partner']) expect(html('index.html')).toContain(`'${k}':`);
  });
});
