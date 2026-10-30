// TR2: Trikot-Ansicht (utils/trikot-ansicht.js, lib/trikotAnsicht.js). Nur erfundene Daten.

import { jest } from '@jest/globals';
import {
  trikotZeilen, baueTrikotAnsicht, kundenangabe, lieferTag, produktKurz, HINWEISE,
} from '../utils/trikot-ansicht.js';
import { leseTrikotAnsicht } from '../lib/trikotAnsicht.js';

const KOPF = ['Zeilen-ID', 'Erfasst_Am', 'Bestelldatum', 'Order-ID', 'Order-Item-ID', 'Kunde', 'Artikelnummer', 'Produktname',
  'Farbe', 'Groesse', 'Name', 'Nummer', 'Stueck', 'Quelle', 'Rohtext', 'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz', 'Zahlart'];
const HEIM = 'Testverein Heimtrikot 26/27', AUS = 'Testverein Auswärtstrikot 26/27';
// id, order, produkt, groesse, name, nummer, quelle, rohtext, charge, bestelltAm, status, notiz
function zeile(id, order, produkt, groesse, name, nummer, quelle, rohtext, charge, bestelltAm = '', status = '', notiz = '') {
  return [id, '', '2026-01-01T10:00:00', order, '1', 'Erika Muster', 'SKU', produkt, '', groesse, name, nummer, '1', quelle, rohtext,
    charge, bestelltAm, '', status, notiz, 'PayPal'];
}
const WERTE = [
  KOPF,
  zeile('100|1|1', '100', HEIM, 'L', 'ALPHA', '7', 'variante', 'Name - Nummer: ALPHA - 7\nGröße: L', '2', '14.09.2026', 'ok'),
  zeile('101|1|1', '101', HEIM, 'XL', 'BETA', '10', 'notiz', 'Name - Nummer: BETA 10\nGröße: XL', '2', '14.09.2026', 'ersetzt', 'Änderung'),
  zeile('102|1|1', '102', AUS, '2XL', 'GAMMA', '3', 'addon', 'Wunschname: GAMMA\nWunschnummer: 3', '3', '28.09.2026'),
  zeile('103|1|1', '103', HEIM, '120', '', '', 'notiz', 'Name - Nummer: DELTA 22\nGröße: 120', ''),
  zeile('104|1|1', '104', HEIM, 'M', 'EPS', '5', 'addon', 'Wunschname: EPS', '4'),
  [],
  zeile('105|1|1', '105', HEIM, 'S', 'ZETA', '', 'addon', 'Wunschname: ZETA', '10', '01.11.2026'),
];

describe('Hilfsfunktionen', () => {
  test('Produkt kurz, Lieferung +30 Tage, Kundenangabe', () => {
    expect(produktKurz(HEIM)).toBe('Heim');
    expect(produktKurz(AUS)).toBe('Auswärts');
    expect(produktKurz('Schal')).toBe('Schal');
    expect(lieferTag('14.09.2026')).toBe('14.10.2026');
    expect(lieferTag('2026-12-15')).toBe('14.01.2027');
    expect(lieferTag('')).toBe('');
    expect(kundenangabe('Name - Nummer: X 1\nGröße: L\n\nKundennotiz: bitte groß')).toEqual([
      { feld: 'Name - Nummer', wert: 'X 1' }, { feld: 'Größe', wert: 'L' }, { feld: 'Kundennotiz', wert: 'bitte groß' }]);
    expect(kundenangabe('(keine Meta-Daten, keine Kundennotiz)')).toEqual([]);
    for (const k of Object.keys(HINWEISE)) expect(HINWEISE[k]).toMatch(/\S/);
  });
});

describe('Zeilen lesen', () => {
  test('nur ueber die Spaltennamen, Kunde nie, leere Zeilen weg', () => {
    const { zeilen, spalteErsetzt } = trikotZeilen(WERTE);
    expect(spalteErsetzt).toBe(false);
    expect(zeilen).toHaveLength(6);
    expect(zeilen[5]).toMatchObject({ zeile: 8, id: '105|1|1', charge: '10' });
    expect(JSON.stringify(zeilen)).not.toContain('Erika');
    // Spalten vertauscht -> gleiches Ergebnis
    const tausch = WERTE.map(r => r.length ? [r[10], ...r.slice(0, 10), ...r.slice(11)] : r);
    expect(trikotZeilen(tausch).zeilen.map(z => z.name)).toEqual(zeilen.map(z => z.name));
  });
  test('fehlende Pflichtspalte wirft mit dem Namen', () => {
    expect(() => trikotZeilen([KOPF.filter(k => k !== 'Charge')])).toThrow(/Charge/);
  });
});

describe('Gruppen und Zaehlregel', () => {
  const a = baueTrikotAnsicht(trikotZeilen(WERTE));
  test('oben noch nicht beim Produzenten, dann Chargen absteigend (numerisch)', () => {
    expect(a.gruppen.map(g => g.offen ? 'offen' : g.charge)).toEqual(['offen', '10', '4', '3', '2']);
    expect(a.gruppen[0]).toMatchObject({ anzahl: 1, da: 0 });
  });
  test('ok und ersetzt zaehlen beim Produzenten als da; ersetzt ist beim Kunden nicht fertig', () => {
    const c2 = a.gruppen.find(g => g.charge === '2');
    expect(c2).toMatchObject({ anzahl: 2, da: 2, bestelltAm: ['14.09.2026'], lieferung: '14.10.2026', hinweise: [] });
    const [ok, ersetzt] = c2.zeilen;
    expect(ok).toMatchObject({ da: true, kundeFertig: true });
    expect(ersetzt).toMatchObject({ da: true, kundeFertig: false, ersetztStatus: true });
    expect(ersetzt.hinweise).toEqual([]);   // ohne Spalte "Ersetzt" kein Hinweis "Ersatz fehlt"
    expect(a.gruppen.find(g => g.charge === '3')).toMatchObject({ anzahl: 1, da: 0 });
  });
  test('Hinweise: Name/Nummer leer, Charge ohne Bestellt_Am', () => {
    expect(a.gruppen[0].zeilen[0].hinweise).toEqual(['name_leer', 'nummer_leer']);
    expect(a.gruppen[0].zeilen[0].kundenangabe[0]).toEqual({ feld: 'Name - Nummer', wert: 'DELTA 22' });
    expect(a.gruppen.find(g => g.charge === '10').zeilen[0].hinweise).toEqual(['nummer_leer']);
    expect(a.gruppen.find(g => g.charge === '4').hinweise).toEqual(['ohne_bestellt_am']);
    expect(a.summen).toEqual({ zeilen: 6, offen: 1, chargen: 4, da: 2, hinweise: 2 });
  });
});

describe('Ersatzzeilen (Spalte "Ersetzt")', () => {
  const mitSpalte = (status = '', ziel = '101|1|1') => {
    const w = WERTE.map((r, i) => (i === 0 ? [...r, 'Ersetzt'] : r.length ? [...r, ''] : r));
    w.push([...zeile('INT-2026-0001', '101', HEIM, 'XL', 'BETA NEU', '10', 'ersatz', '', '4', '', status), ziel]);
    return baueTrikotAnsicht(trikotZeilen(w));
  };
  const finde = (a, id) => a.gruppen.flatMap(g => g.zeilen).find(z => z.id === id);
  test('beide Zeilen verbunden; Kunde fertig erst mit "ok" an der Ersatzzeile', () => {
    let a = mitSpalte();
    expect(a.spalteErsetzt).toBe(true);
    expect(finde(a, '101|1|1')).toMatchObject({ ersetztDurch: [{ id: 'INT-2026-0001', charge: '4', status: '' }], kundeFertig: false });
    expect(finde(a, 'INT-2026-0001').ersatzFuer).toEqual({ id: '101|1|1', charge: '2', zeile: 3 });
    expect(a.gruppen.find(g => g.charge === '4')).toMatchObject({ anzahl: 2, da: 0 });
    a = mitSpalte('ok');
    expect(finde(a, '101|1|1').kundeFertig).toBe(true);
    expect(a.gruppen.find(g => g.charge === '4').da).toBe(1);
  });
  test('doppelte Zeilen-ID -> Hinweis an beiden, keine Verbindung geraten', () => {
    const w = WERTE.map((r, i) => (i === 0 ? [...r, 'Ersetzt'] : r.length ? [...r, ''] : r));
    w.push([...zeile('INT-2026-0001', '201', HEIM, '120', 'X', '1', 'intern', '', '6'), '']);
    w.push([...zeile('INT-2026-0001', '202', HEIM, 'XL', 'Y', '2', 'ersatz', '', ''), '101|1|1']);
    w.push([...zeile('INT-2026-0003', '203', HEIM, 'M', 'Z', '3', 'ersatz', '', ''), 'INT-2026-0001']);
    const a = baueTrikotAnsicht(trikotZeilen(w));
    const alle = a.gruppen.flatMap(g => g.zeilen);
    expect(alle.filter(x => x.hinweise.includes('id_doppelt')).map(x => x.zeile)).toEqual([10, 9]);   // offen-Gruppe zuerst
    expect(alle.find(x => x.id === 'INT-2026-0003').hinweise).toContain('ersetzt_unbekannt');
    expect(alle.find(x => x.id === '101|1|1').ersetztDurch).toHaveLength(1);   // nur ueber die eindeutige Original-ID
  });
  test('Ersetzt auf unbekannte Zeile -> Hinweis; ersetzt ohne Ersatzzeile -> Hinweis', () => {
    const a = mitSpalte('', '999|9|9');
    expect(finde(a, 'INT-2026-0001').hinweise).toContain('ersetzt_unbekannt');
    expect(finde(a, '101|1|1').hinweise).toContain('ersatz_fehlt');
  });
});

describe('lib/trikotAnsicht.js', () => {
  test('liest nur den Reiter Trikots aus dem Business-Sheet, schreibt nichts', async () => {
    process.env.BUSINESS_SHEET_ID = 'biz-test';
    const get = jest.fn(async () => ({ data: { values: WERTE } }));
    const verboten = jest.fn();
    const sheets = { spreadsheets: { values: { get, update: verboten, append: verboten, batchUpdate: verboten }, batchUpdate: verboten } };
    const a = await leseTrikotAnsicht({ sheets });
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: 'biz-test', range: "'Trikots'" }));
    expect(verboten).not.toHaveBeenCalled();
    expect(a.summen.zeilen).toBe(6);
    expect(JSON.stringify(a)).not.toContain('Erika');
  });
  test('ohne BUSINESS_SHEET_ID 503', async () => {
    const alt = process.env.BUSINESS_SHEET_ID;
    delete process.env.BUSINESS_SHEET_ID;
    await expect(leseTrikotAnsicht({ sheets: {} })).rejects.toMatchObject({ status: 503 });
    process.env.BUSINESS_SHEET_ID = alt;
  });
});
