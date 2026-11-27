// GT1: Geld-Technik - C4 (Berlin-Zeit), B2 (Pflichtspalten), B6 (Lesebereiche). Nur ERFUNDENE Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { wcTagDE, deHeuteBerlin, berlinJahr } from '../utils/berlin-tag.js';
import { pruefePflichtSpalten, PFLICHT_SPALTEN } from '../utils/pflicht-spalten.js';
import { toDE } from '../utils/sync-logic.js';

const hier = dirname(fileURLToPath(import.meta.url));
const quelle = p => readFileSync(resolve(hier, '..', p), 'utf8');

describe('C4: Berliner Kalendertag, egal welche Zeitzone der Server hat', () => {
  test('WooCommerce-Zeit ohne Zone (Shop-Ortszeit): der Tag steht im Text', () => {
    expect(wcTagDE('2026-12-31T23:30:00')).toBe('31.12.2026');
    expect(wcTagDE('2027-01-01T00:30:00')).toBe('01.01.2027');
    expect(wcTagDE('2026-03-29T02:30:00')).toBe('29.03.2026');   // Zeitumstellung Sommer
    expect(wcTagDE('2026-10-25T02:30:00')).toBe('25.10.2026');   // Zeitumstellung Winter
    expect(wcTagDE('2026-10-31T23:59:59')).toBe('31.10.2026');   // Monatsgrenze
    expect(wcTagDE('')).toBe('');
  });
  test('Zeit MIT Zone (z. B. *_gmt): nach Berlin umgerechnet', () => {
    expect(wcTagDE('2026-12-31T23:30:00Z')).toBe('01.01.2027');   // 00:30 Berlin (Winter)
    expect(wcTagDE('2026-06-30T22:30:00Z')).toBe('01.07.2026');   // 00:30 Berlin (Sommer)
    expect(wcTagDE('2026-12-31T22:59:00Z')).toBe('31.12.2026');
  });
  test('"heute" und Jahr in Berlin: 01.01. 00:30 Berlin = schon das neue Jahr (Server-UTC waere noch 31.12.)', () => {
    const silvesterNacht = new Date('2026-12-31T23:30:00Z');   // = 01.01.2027 00:30 Berlin
    expect(deHeuteBerlin(silvesterNacht)).toBe('01.01.2027');
    expect(berlinJahr(silvesterNacht)).toBe(2027);
    expect(deHeuteBerlin(new Date('2026-12-31T22:30:00Z'))).toBe('31.12.2026');   // 23:30 Berlin
    expect(berlinJahr(new Date('2026-07-01T10:00:00Z'))).toBe(2026);
  });
  test('Sheet-Daten (TT.MM.JJJJ als UTC-Mitternacht) formatiert toDE unveraendert', () => {
    expect(toDE(new Date('2026-05-01T00:00:00Z'))).toBe('01.05.2026');
  });
  test('Quelltext: Geld-Routen nutzen fuer Bestell-, Storno-, Erstattungs- und Heute-Daten die Berlin-Helfer', () => {
    for (const p of ['routes/festpreis-portal.js', 'routes/partnerPortal.js', 'utils/sync-logic.js']) {
      const q = quelle(p);
      expect(q).not.toMatch(/toDE\(new Date\(o(rder)?\.date_(created|modified)/);
      expect(q).not.toMatch(/toDE\(new Date\(\)\)/);
    }
    expect(quelle('routes/kalkulation.js')).not.toMatch(/toDE\(new Date\(\)\)|new Date\(\)\.getUTCFullYear\(\)/);
    expect(quelle('utils/teilerstattung.js')).toMatch(/const datumDE = iso => wcTagDE\(iso\)/);
    for (const p of ['utils/lager.js', 'utils/lager-korb.js', 'utils/lager-eingang.js', 'utils/auftrag-bereitstellen.js', 'lib/lshopKorb.js']) {
      expect(quelle(p)).not.toMatch(/getUTCFullYear\(\)/);
    }
  });
});

describe('B2: Pflichtspalten der Geld-Reiter', () => {
  test('fehlende Pflichtspalte -> Fehler mit Spaltenname und Reiter (500), nie still', () => {
    const kopf = PFLICHT_SPALTEN['FP_Verkäufe'].filter(s => s !== 'Gesamt-Partner-Brutto');
    let e = null;
    try { pruefePflichtSpalten('FP_Verkäufe', kopf); } catch (x) { e = x; }
    expect(e).toMatchObject({ status: 500, name: 'MissingHeaderError' });
    expect(e.message).toContain('Gesamt-Partner-Brutto');
    expect(e.message).toContain('FP_Verkäufe');
  });
  test('vollstaendige Kopfzeile (auch andere Schreibweise/Reihenfolge, Zusatzspalten) ok; leerer oder unbekannter Reiter wird nicht geprueft', () => {
    for (const [tab, pflicht] of Object.entries(PFLICHT_SPALTEN)) expect(() => pruefePflichtSpalten(tab, ['Neu_hinten', ...[...pflicht].reverse()])).not.toThrow();
    expect(() => pruefePflichtSpalten("'Partner_Abrechnungen'!A1:ZZ", ['abrechnungs id', 'Partner ID', 'Zeitraum-Von', 'Zeitraum-Bis', 'Saldo', 'Status'])).not.toThrow();
    expect(() => pruefePflichtSpalten('Partner_Verkäufe', [])).not.toThrow();
    expect(() => pruefePflichtSpalten('Irgendwas', ['x'])).not.toThrow();
  });
  test('Quelltext: jeder Reiter-Leser der Geld-Routen prueft; anfragen.js schreibt nie in Spalte -1', () => {
    for (const p of ['routes/kalkulation.js', 'routes/festpreis-portal.js', 'routes/partnerPortal.js', 'routes/festpreis-public.js', 'routes/partner-artikel.js']) {
      const q = quelle(p);
      const leser = q.slice(q.indexOf('async function readTab('), q.indexOf('async function readTab(') + 700);
      expect(leser).toContain('pruefePflichtSpalten(tabName, header)');
    }
    // KA1: Kundenanfragen lesen/schreiben in lib/anfragen.js - fehlende Pflichtspalte = Fehler, nie Spalte -1
    const a = quelle('lib/anfragen.js');
    expect(a).toContain('fehlendeSpalten(r.idx)');
    expect(quelle('routes/anfragen.js')).not.toContain('indexOf(');
  });
  test('Portal: oeffentliche Router geben bei 5xx nur den festen Text aus (Spaltenname bleibt intern)', () => {
    const idx = quelle('index.js');
    expect(idx).toMatch(/app\.use\('\/api\/festpreis-public',\s+oeffentlich/);
    expect(idx).toMatch(/app\.use\('\/api\/partner'[^\n]*oeffentlich|oeffentlich[^\n]*partnerPortal/);
  });
});

describe('B6: Lesebereiche', () => {
  test('Geld-Reiter ohne Zeilengrenze und breit genug', () => {
    expect(quelle('routes/partner-artikel.js')).toMatch(/range: `\$\{tabName\}!A1:ZZ`/);
  });
});
