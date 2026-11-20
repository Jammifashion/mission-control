// SA4: Schnellannahme fuellt die Notiz; Feld "Druckname" je Position (Spalte Auftrag_Positionen.Druckname), Datenschutz wie
// Rueckennamen, Loeschung 12 Monate nach Abschluss und bei DSGVO-Sperre. NUR erfundene Texte, Namen und Kunden.
import { jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { schnellVorschlag } from '../lib/auftragSchnell.js';
import { pruefeKiAntwort, drucknamePruefen, notizOhneNamen, KI_SCHEMA, NOTIZ_MAX, systemPrompt } from '../utils/auftrag-schnell.js';
import { pruefePositionen, bearbeitenPlan, drucknameAus, POSITION_OPTIONAL, brauchtDrucknameSpalte } from '../utils/auftraege.js';
import { drucknameLoeschPlan, abschlussVon, stichtag } from '../utils/druckname-loeschen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = p => readFileSync(resolve(hier, p), 'utf8');
const html = lies('../../frontend/index.html');

// ── Attrappen wie in auftrag-schnell.test.js ─────────────────────────────────
const KUNDEN = [
  { Kunden_Nr: 'K-00001', Art: 'Verein', Name: 'TSV Musterdorf 1900 e.V.', Ansprechpartner: 'Frieda Beispielfrau', Ort: 'Musterdorf', Status: 'aktiv' },
];
const zeile = (catalogNr, farbe, groesse, n) => ({ catalogNr, bezeichnung: 'Test Classic T-Shirt', marke: 'Testmarke', herstellerNr: '', farbe, groesse,
  articleNr: String(n).padStart(10, '0'), status: '', discontinued: '0' });
const LSHOP = ['S', 'M', 'L', 'XL'].map((g, j) => zeile('TS100', 'Black', g, 1000 + j));
const ki = (x = {}) => JSON.stringify({ kunde: [], kurztitel: '', termin: '', kanal: '', wieLetztesMal: false, gruppen: [], frei: [], todos: [], hinweise: [], notiz: '', ...x });
const gr = (x = {}) => ({ artikel: 'T-Shirt', modellNr: 'TS100', farbe: 'schwarz', farbeEn: 'Black', motiv: 'Vereinslogo', druck: 'Rücken', groessen: [], menge: 0, druckname: '', ...x });
const lauf = (text, antwort) => schnellVorschlag({
  eingabe: { text }, jetzt: () => new Date('2026-11-17T10:00:00Z'), sheets: {},
  aufruf: jest.fn(async () => ({ text: antwort })), modellLesen: async () => 'claude-haiku-5-5',
  kundenLesen: async () => ({ kunden: KUNDEN }), historieLesen: async () => ({ gruppen: [] }),
  modelleLesen: async () => LSHOP, variantenLesen: async () => ({ varianten: LSHOP.map(z => ({ farbe: z.farbe, groesse: z.groesse, articleNr: z.articleNr })) }),
});
beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-anthropic'; });

describe('1. Notiz aus der Schnellannahme', () => {
  test('Schema und Prompt: notiz Pflichtfeld, Regeln stehen im Prompt', () => {
    expect(KI_SCHEMA.required).toContain('notiz');
    const sp = systemPrompt(['Mail']);
    expect(sp).toContain('KEINE Personennamen');
    expect(sp).toContain('druckname: NUR Namen, die laut Notiz');
    expect(pruefeKiAntwort(ki({ notiz: 'x'.repeat(900) })).notiz).toHaveLength(NOTIZ_MAX);
  });
  test('Absprache landet in der Notiz (orange), Termin/Positionen nicht doppelt', async () => {
    const text = 'TSV Musterdorf 10 Shirts schwarz M, Logo Rücken, Abholung Samstag im Laden, zahlen bar bei Abholung';
    const v = await lauf(text, ki({ kunde: ['TSV Musterdorf'], kurztitel: 'Shirts', gruppen: [gr({ groessen: [{ groesse: 'M', menge: 10 }] })],
      notiz: '- Abholung Samstag im Laden\n- Zahlung bar bei Abholung' }));
    expect(v.kopf.Notiz).toBe('- Abholung Samstag im Laden\n- Zahlung bar bei Abholung');
    expect(v.unsicher.Notiz).toBe('Notiz von der KI – bitte prüfen.');
  });
  test('reiner Mengentext -> Notiz leer, kein orange', async () => {
    const v = await lauf('TSV Musterdorf 5 Shirts schwarz L', ki({ kunde: ['TSV Musterdorf'], gruppen: [gr({ groessen: [{ groesse: 'L', menge: 5 }] })] }));
    expect(v.kopf.Notiz).toBe('');
    expect(v.unsicher.Notiz).toBeUndefined();
  });
  test('keine Namen in der Notiz: Druck- und Kontaktnamen werden zu "(Name)"', async () => {
    const text = 'TSV Musterdorf 3 Shirts schwarz M mit Rückennamen Lotta, Mats, Ole. Frau Beispielfrau holt Freitag ab.';
    const v = await lauf(text, ki({ kunde: ['TSV Musterdorf'], gruppen: [gr({ groessen: [{ groesse: 'M', menge: 3 }], druckname: 'Lotta, Mats, Ole' })],
      notiz: '- Frau Beispielfrau holt Freitag ab\n- Lotta bekommt die Nummer 7' }));
    expect(v.kopf.Notiz).toBe('- Frau (Name) holt Freitag ab\n- (Name) bekommt die Nummer 7');
    expect(v.unsicher.Notiz).toContain('2 Name(n) durch „(Name)“ ersetzt');
    expect(v.kopf.Notiz).not.toMatch(/Lotta|Beispielfrau/);
  });
  test('notizOhneNamen: ganze Woerter, Gross/Klein egal, kein Teilwort', () => {
    expect(notizOhneNamen('anna kommt, Annabell nicht', ['Anna'])).toEqual({ notiz: '(Name) kommt, Annabell nicht', ersetzt: 1 });
  });
});

describe('2. Drucknamen landen im Feld der richtigen Position', () => {
  test('Groessen zugeordnet; erfundener Name faellt weg', async () => {
    const text = 'TSV Musterdorf Shirts schwarz: M 2x mit Rückennamen Lotta und Mats, L 1x mit Ole';
    const v = await lauf(text, ki({ kunde: ['TSV Musterdorf'], gruppen: [gr({ groessen: [{ groesse: 'M', menge: 2 }, { groesse: 'L', menge: 1 }],
      druckname: 'M: Lotta, Mats; L: Ole, Finn' })] }));
    expect(v.gruppen[0].druckname).toBe('M: Lotta, Mats; L: Ole');
    expect(v.gruppen[0].drucknameGrund).toBe('Drucknamen von der KI – bitte prüfen. 1 Name(n) nicht im Text – weggelassen.');
    expect(v.kopf.Notiz).toBe('');
  });
  test('drucknamePruefen: unbekannte Groesse faellt weg, Namen bleiben; nichts im Text = leer', () => {
    expect(drucknamePruefen('XXL: Lotta', 'Lotta', ['M'])).toEqual({ wert: 'Lotta', namen: ['Lotta'], weg: 0 });
    expect(drucknamePruefen('Kevin', 'ohne Namen', [])).toEqual({ wert: '', namen: [], weg: 1 });
  });
  test('Frontend verteilt "M: …; L: …" auf die Groessen und baut den Text zurueck', () => {
    const block = html.slice(html.indexOf('// ── Druckname: Anfang'), html.indexOf('// ── Druckname: Ende ──'));
    const F = new Function(`${block}\nreturn { auDrucknameVerteilen, auDrucknameText, auDrucknameGeaendert };`)();
    expect(F.auDrucknameVerteilen('M: Lotta, Mats; L: Ole', ['M', 'L', 'XL'])).toEqual(['Lotta, Mats', 'Ole', '']);
    expect(F.auDrucknameVerteilen('Lotta, Mats', ['M', 'L'])).toEqual(['Lotta, Mats', 'Lotta, Mats']);
    expect(F.auDrucknameVerteilen('M: Lotta; Ole', ['M', 'L'])).toEqual(['M: Lotta; Ole', 'M: Lotta; Ole']);
    expect(F.auDrucknameVerteilen('', ['M'])).toEqual(['']);
    expect(F.auDrucknameText([{ groesse: 'M', druckname: 'Lotta, Mats' }, { groesse: 'L', druckname: 'Ole' }, { groesse: 'XL', druckname: '' }])).toBe('M: Lotta, Mats; L: Ole');
    expect(F.auDrucknameText([{ groesse: 'M', druckname: 'Lotta' }, { groesse: 'L', druckname: 'Lotta' }])).toBe('Lotta');
    expect(F.auDrucknameGeaendert([{ druckname: 'x', drucknameAlt: '' }])).toBe(true);
    expect(F.auDrucknameGeaendert([{ druckname: '', drucknameAlt: '' }])).toBe(false);
  });
  test('Oberflaeche: Feld mit Mouse-over, Notiz orange, Vorlage uebernimmt keine Namen', () => {
    expect(html).toContain("const AU_SCHNELL_FELDER = ['Kurztitel', 'Kanal', 'Termin', 'Notiz'];");
    expect(html).toMatch(/'au-druckname':\s+\{ name: 'Druckname', text: 'Nur Namen, die gedruckt werden\. Wird 12 Monate nach Abschluss automatisch gelöscht\.' \}/);
    expect(html).toMatch(/<label class="au-druckname" data-hilfe="au-druckname">/);
    expect(html).toContain("e.druckname = ''; e.drucknameAlt = '';   // SA4");
    expect(html).toContain('druckname: p.druckname ?? \'\',   // SA4');
  });
});

describe('3. Spalte Druckname im Auftrag', () => {
  test('optionale Spalte, Pruefung Laenge/Steuerzeichen', () => {
    expect(POSITION_OPTIONAL).toContain('Druckname');
    expect(drucknameAus(' M: Lotta,\tMats ')).toBe('M: Lotta, Mats');
    expect(() => drucknameAus('x'.repeat(301))).toThrow();
    const [p] = pruefePositionen([{ art: 'frei', freitext: 'Tasse', menge: 1, druckname: 'Lotta' }], { leerErlaubt: true });
    expect(p.Druckname).toBe('Lotta');
    const [ohne] = pruefePositionen([{ art: 'frei', freitext: 'Tasse', menge: 1 }], { leerErlaubt: true });
    expect(ohne).not.toHaveProperty('Druckname');
    expect(brauchtDrucknameSpalte([{ Druckname: '' }])).toBe(false);
    expect(brauchtDrucknameSpalte([{ Druckname: 'Lotta' }])).toBe(true);
  });
  test('ab "bestellt": nur Preise und Druckname aenderbar', () => {
    const auftrag = { Auftrag_Nr: 'AU-2026-0001', Status: 'bestellt', Kunden_Nr: 'K-00001', Kurztitel: 'x', Stand: 's' };
    const positionen = [{ _zeile: 2, Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'frei', Freitext: 'Tasse', Menge: '1', Druckname: '' }];
    const eing = d => ({ positionen: [{ positionId: 'AU-2026-0001-01', art: 'frei', freitext: 'Tasse', menge: 1, druckname: d }] });
    const plan = bearbeitenPlan({ auftrag, positionen, eingabe: eing('Lotta'), jetzt: 'T' });
    expect(plan.aenderungPositionen).toEqual([{ zeile: 2, positionId: 'AU-2026-0001-01', felder: { Druckname: 'Lotta', Stand: 'T' } }]);
    expect(bearbeitenPlan({ auftrag, positionen, eingabe: eing(''), jetzt: 'T' }).unveraendert).toBe(true);
  });
});

describe('4. Datenschutz: Druckname nie in Korb/EDI/Log/Chat', () => {
  test('Quelltext: Korb, EDI, Bereitstellen, Chat, Log-Stellen nennen Druckname nicht', () => {
    for (const f of ['../lib/lshopEdi.js', '../utils/edi-bestellung.js', '../utils/auftrag-bereitstellen.js', '../lib/auftragBereitstellen.js',
      '../utils/korb-logic.js', '../lib/lshopKorb.js', '../lib/chatNotify.js', '../lib/bestellUebernahme.js']) {
      expect([f, /druckname/i.test(lies(f))]).toEqual([f, false]);
    }
  });
  test('kein console.* mit Druckname im Backend', () => {
    const dateien = d => readdirSync(resolve(hier, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? [] : [join(d, e.name)]));
    for (const f of [...dateien('../lib'), ...dateien('../utils'), ...dateien('../routes')].filter(x => x.endsWith('.js'))) {
      for (const z of lies(f).split('\n')) if (/console\.(log|warn|error|info)/.test(z)) expect([f, /druckname/i.test(z)]).toEqual([f, false]);
    }
  });
});

describe('5. Loeschen nach 12 Monaten und bei DSGVO-Sperre', () => {
  const auftraege = [
    { Auftrag_Nr: 'AU-2025-0001', Kunden_Nr: 'K-00001', Status: 'bezahlt', Bezahlt_Am: '2025-10-01' },     // 13+ Monate
    { Auftrag_Nr: 'AU-2025-0002', Kunden_Nr: 'K-00002', Status: 'bezahlt', Bezahlt_Am: '2026-01-15' },     // 10 Monate
    { Auftrag_Nr: 'AU-2025-0003', Kunden_Nr: 'K-00002', Status: 'storniert', Storniert_Am: '2025-11-19' },  // genau 12 Monate
    { Auftrag_Nr: 'AU-2026-0004', Kunden_Nr: 'K-00001', Status: 'in Produktion' },
    { Auftrag_Nr: 'AU-2025-0005', Kunden_Nr: 'K-00002', Status: 'bezahlt', Bezahlt_Am: '' },
  ];
  const pos = (nr, zeile, dn = 'Lotta') => ({ _zeile: zeile, Position_ID: `${nr}-01`, Auftrag_Nr: nr, Druckname: dn });
  const positionen = [pos('AU-2025-0001', 2), pos('AU-2025-0002', 3), pos('AU-2025-0003', 4), pos('AU-2026-0004', 5), pos('AU-2025-0005', 6), pos('AU-2025-0001', 7, '')];
  const JETZT = new Date('2026-11-19T08:00:00Z');
  test('Trockenlauf-Plan: nur abgeschlossen + 12 Monate vorbei', () => {
    const p = drucknameLoeschPlan({ auftraege, positionen, jetzt: JETZT });
    expect(p.leeren.map(x => x.auftragNr)).toEqual(['AU-2025-0001', 'AU-2025-0003']);
    expect(p.zaehler).toEqual({ abgeschlossenJung: 1, offen: 1, ohneDatum: 1 });
  });
  test('DSGVO: alle Drucknamen des Kunden, ohne Frist, auch offene', () => {
    const p = drucknameLoeschPlan({ auftraege, positionen, jetzt: JETZT, kundenNr: 'K-00001' });
    expect(p.leeren.map(x => x.zeile)).toEqual([2, 5]);
  });
  test('Hilfen', () => {
    expect(abschlussVon({ Status: 'fertig' })).toBeNull();
    expect(stichtag(JETZT).toISOString().slice(0, 10)).toBe('2025-11-19');
  });
  test('Verdrahtung: DSGVO-Route leert, Skript Trockenlauf Standard', () => {
    const route = lies('../routes/kunden.js');
    expect(route).toMatch(/leereDrucknamen\(\{ kundenNr: r\.kundenNr, write: true \}\)/);
    const skript = lies('../scripts/druckname-loeschen.js');
    expect(skript).toContain("const WRITE = process.argv.includes('--write');");
    expect(skript).toContain('leereDrucknamen({ write: WRITE })');
    const lib = lies('../lib/auftraege.js');
    expect(lib).toMatch(/zellenAus\(TAB_POSITIONEN, p\.idx, x\.zeile, \{ Druckname: '' \}\)/);
  });
});
