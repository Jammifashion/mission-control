// SA5 (FB-0002): Schnellannahme verliert Menge/Groesse/Modell nicht mehr - was nicht als Position ankommt, steht als Stichpunkt
// in der Notiz; eine genannte, fehlende Modellnummer wird genannt (Hinweis "aufnehmen?"). Dazu: Kurztitel "Auftraggeber – Inhalt",
// nie ein Personenname. NUR erfundene Texte, Kunden und Modelle; KI = Attrappe.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { schnellVorschlag } from '../lib/auftragSchnell.js';
import {
  modellZuordnen, gruppeVorschlag, notizStichpunkte, notizMitStichpunkten, kurztitelOhneNamen, systemPrompt, NOTIZ_KOPF, NOTIZ_GESAMT_MAX,
} from '../utils/auftrag-schnell.js';
import { MAX } from '../utils/auftraege.js';

const zeile = (catalogNr, bezeichnung, farbe, groesse, n) => ({
  catalogNr, bezeichnung, marke: 'Testmarke', herstellerNr: '', farbe, groesse, articleNr: String(n).padStart(10, '0'), status: '', discontinued: '0',
});
const GR = ['S', 'M', 'L', 'XL'];
const LSHOP = [
  ...['Black', 'White'].flatMap((f, i) => GR.map((g, j) => zeile('TM900', 'Test Organic T-Shirt', f, g, 9000 + i * 10 + j))),
  ...['Black'].flatMap(f => GR.map((g, j) => zeile('HD200', 'Test Heavy Hoodie', f, g, 2000 + j))),
  ...['Navy'].flatMap(f => GR.map((g, j) => zeile('HD300', 'Test Zip Hoodie', f, g, 3000 + j))),
];
const varianten = c => LSHOP.filter(z => z.catalogNr === c).map(z => ({ farbe: z.farbe, groesse: z.groesse, articleNr: z.articleNr }));
const gr = (x = {}) => ({ artikel: '', modellNr: '', farbe: '', farbeEn: '', motiv: '', druck: '', groessen: [], menge: 0, druckname: '', ...x });
const ki = (x = {}) => JSON.stringify({ kunde: [], kurztitel: '', termin: '', kanal: '', wieLetztesMal: false, gruppen: [], frei: [], todos: [], hinweise: [],
  kundeNeu: {}, notiz: '', ...x });
const KUNDEN = [{ Kunden_Nr: 'K-00009', Name: 'Erika Beispiel', Art: 'Person', Status: 'aktiv' }];
const lauf = (text, antwort) => schnellVorschlag({
  eingabe: { text }, jetzt: () => new Date('2026-11-25T10:00:00Z'), sheets: {},
  aufruf: jest.fn(async () => ({ text: antwort })), modellLesen: async () => 'claude-haiku-5-5',
  kundenLesen: async () => ({ kunden: KUNDEN }), historieLesen: async () => ({ gruppen: [] }),
  modelleLesen: async () => LSHOP, variantenLesen: async ({ catalogNr }) => ({ varianten: varianten(catalogNr) }),
});

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-anthropic'; });

describe('FB-0002: nichts geht verloren', () => {
  test('Modell erkannt, Farbe fehlt: Gruppe offen, Menge/Groesse/Modell in der Notiz (orange mit Grund)', async () => {
    const v = await lauf('Anfrage Testverein: 40 Stk Größe S, Modell TM900, Logo Brust links',
      ki({ kurztitel: 'Testverein – Shirts', gruppen: [gr({ artikel: 'T-Shirt', modellNr: 'TM900', motiv: 'Logo', druck: 'Brust links', groessen: [{ groesse: 'S', menge: 40 }] })] }));
    expect(v.gruppen[0]).toMatchObject({ ok: false, modell: 'TM900', mengenText: 'S × 40' });
    expect(v.kopf.Notiz).toBe(`${NOTIZ_KOPF}\n- T-Shirt TM900 · S × 40 · Motiv: Logo · Druck: Brust links (Farbe fehlt/unklar)`);
    expect(v.unsicher.Notiz).toMatch(/1 nicht übernommene Angabe/);
    expect(v.fehlendeModelle).toEqual([]);
  });

  test('Modell nicht in LShop_Modelle: nie still ueber das Artikelwort zugeordnet, Hinweis + Notiz', async () => {
    const v = await lauf('20 Stk L Modell XY999 weiß Hoodie',
      ki({ gruppen: [gr({ artikel: 'Hoodie', modellNr: 'XY999', farbe: 'weiß', farbeEn: 'White', groessen: [{ groesse: 'L', menge: 20 }] })] }));
    expect(v.gruppen[0]).toMatchObject({ ok: false, modell: '', fehlendesModell: 'XY999' });
    expect(v.gruppen[0].grund[0]).toMatch(/^Modell „XY999“ nicht in L-Shop-Modellen\. Ähnliche Modelle/);
    expect(v.gruppen[0].vorschlaege).toEqual(expect.arrayContaining(['HD200', 'HD300']));
    expect(v.fehlendeModelle).toEqual(['XY999']);
    expect(v.kopf.Notiz).toContain('- Hoodie XY999 weiß · L × 20 (Modell XY999 nicht in L-Shop-Modellen)');
  });

  test('mehrere Groessen/Mengen in einem Satz: passende als Positionen, fehlende Groesse als Stichpunkt', async () => {
    const v = await lauf('Testfirma 10 Stk S 15 Stk M 5 Stk XL und 3 Stk 3XL Modell TM900 schwarz Logo Rücken',
      ki({ gruppen: [gr({ artikel: 'Shirt', modellNr: 'TM900', farbe: 'schwarz', farbeEn: 'Black', motiv: 'Logo', druck: 'Rücken',
        groessen: [{ groesse: 'S', menge: 10 }, { groesse: 'M', menge: 15 }, { groesse: 'XL', menge: 5 }, { groesse: '3XL', menge: 3 }] })] }));
    const g = v.gruppen[0];
    expect(g.ok).toBe(true);
    expect(g.positionen.map(p => `${p.groesse}:${p.menge}`)).toEqual(['S:10', 'M:15', 'XL:5']);
    expect(v.kopf.Notiz).toContain('- Shirt TM900 schwarz · 3XL × 3 · Motiv: Logo · Druck: Rücken (Größe nicht beim Modell)');
  });

  test('alles zugeordnet: Notiz der KI unveraendert, kein Stichpunkt', async () => {
    const v = await lauf('5 Stk M Modell TM900 weiß', ki({ notiz: '- Abholung', gruppen: [gr({ artikel: 'Shirt', modellNr: 'TM900', farbeEn: 'White', groessen: [{ groesse: 'M', menge: 5 }] })] }));
    expect(v.kopf.Notiz).toBe('- Abholung');
    expect(v.unsicher.Notiz).not.toMatch(/nicht übernommen/);
  });

  test('Stichpunkte stehen vor der KI-Notiz und werden nie abgeschnitten; Gesamtlaenge = MAX.Notiz', () => {
    expect(NOTIZ_GESAMT_MAX).toBe(MAX.Notiz);
    const g = { ok: false, modell: '', stichwort: 'Hoodie', mengenText: 'M × 2', grund: [], fehlendesModell: 'AB1' };
    const n = notizMitStichpunkten('x'.repeat(2000), [g]);
    expect(n.notiz.startsWith(`${NOTIZ_KOPF}\n- Hoodie · Modell AB1 · M × 2`)).toBe(true);
    expect(n.notiz.length).toBe(NOTIZ_GESAMT_MAX);
    expect(notizStichpunkte([{ ok: true, positionen: [{}] }])).toEqual([]);
  });

  test('modellZuordnen: vorhandene Nummer sicher, fehlende ohne Artikelwort nur Grund', () => {
    expect(modellZuordnen(gr({ modellNr: 'tm900' }), LSHOP)).toMatchObject({ catalogNr: 'TM900', sicher: true });
    expect(modellZuordnen(gr({ modellNr: 'ZZ1' }), LSHOP)).toEqual({ catalogNr: '', sicher: false, vorschlaege: [], fehlendesModell: 'ZZ1', grund: 'Modell „ZZ1“ nicht in L-Shop-Modellen.' });
    expect(gruppeVorschlag(gr({ modellNr: 'ZZ1' }), modellZuordnen(gr({ modellNr: 'ZZ1' }), LSHOP), []).fehlendesModell).toBe('ZZ1');
  });
});

describe('Kurztitel: Auftraggeber + grober Inhalt, nie ein Personenname', () => {
  test('Prompt verlangt den Aufbau und verbietet Personennamen', () => {
    const p = systemPrompt(['Mail']);
    expect(p).toMatch(/<Auftraggeber> – <grober Inhalt>/);
    expect(p).toMatch(/NIE ein\s+Personenname/);
    expect(p).toMatch(/Hoodies \+ Shirts/);
  });
  test('bekannter Personenname faellt aus dem Titel, Trenner aufgeraeumt', () => {
    expect(kurztitelOhneNamen('Erika Beispiel – Jacken', ['Erika Beispiel', 'Erika', 'Beispiel'])).toBe('Jacken');
    expect(kurztitelOhneNamen('Testverein – Shirts', ['Erika'])).toBe('Testverein – Shirts');
  });
  test('ueber den ganzen Weg: Name des gefundenen Personen-Kunden nicht im Titel', async () => {
    const v = await lauf('Erika Beispiel möchte 3 Jacken', ki({ kunde: ['Erika Beispiel'], kurztitel: 'Erika Beispiel – Jacken' }));
    expect(v.kopf.Kurztitel).toBe('Jacken');
  });
});

describe('Oberflaeche', () => {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  test('Hinweis fehlendes Modell mit Sprung in neuem Tab (Dialog bleibt offen), mit Mouse-over', () => {
    expect(html).toMatch(/v\.fehlendeModelle\?\.length/);
    expect(html).toMatch(/href="#artikel\/lshop-modelle" target="_blank" rel="noopener" data-hilfe="au-schnell-lsm"/);
    expect(html).toMatch(/'au-schnell-lsm':\s*\{ name:/);
  });
  test('FB-0003: Eigenschaften in Reiter 3 auf Kartenbreite, im Layout-Block', () => {
    const layout = html.match(/\/\* ── Layout: Anfang[\s\S]*?Layout: Ende ── \*\//)[0];
    expect(layout).toMatch(/#properties-container, #properties-rule-hint \{ max-width: calc\(var\(--karten-max-breite\) - 2\.5rem - 2px\); \}/);
  });
});
