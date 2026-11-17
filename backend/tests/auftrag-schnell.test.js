// SA1: KI-Schnellannahme. NUR erfundene Texte, Kunden und Modelle. Die KI ist eine Attrappe (kein Netz, kein Sheet).
// Geprueft: Schema der KI-Antwort, Zuordnung Kunde/Modell/Farbe/Groesse/Termin gegen MC-Daten, 10+ typische Faelle,
// Fehlerfaelle, Datenschutz (Rohtext nie im Log, Kundenliste nie im Prompt, nur Claude als Anbieter).

import { jest } from '@jest/globals';
import { schnellVorschlag, pruefeEingabe, ROLLE, ZEITLIMIT_MS } from '../lib/auftragSchnell.js';
import { KiZeitlimitError, ARTEN } from '../lib/modellAufruf.js';
import { DEFAULT_MODELS } from '../lib/modelConfig.js';
import {
  KI_SCHEMA, pruefeKiAntwort, kundenVorschlaege, terminPruefen, kanalPruefen, modellZuordnen, farbeZuordnen,
  groesseFinden, gruppeVorschlag, suchwoerter, TEXT_MAX,
} from '../utils/auftrag-schnell.js';

// ── erfundene Stammdaten ─────────────────────────────────────────────────────
const KUNDEN = [
  { Kunden_Nr: 'K-00001', Name: 'TSV Musterdorf 1900 e.V.', Spitzname: 'Muster-Kicker', Ort: 'Musterdorf', Status: 'aktiv' },
  { Kunden_Nr: 'K-00002', Name: 'Beispiel Bau GmbH', Spitzname: '', Ort: 'Testhausen', Status: 'aktiv' },
  { Kunden_Nr: 'K-00003', Name: 'SV Testhausen', Spitzname: '', Ort: 'Testhausen', Status: 'aktiv' },
  { Kunden_Nr: 'K-00004', Name: 'Alter Verein Musterdorf', Spitzname: '', Ort: 'Musterdorf', Status: 'archiviert' },
];
const zeile = (catalogNr, bezeichnung, farbe, groesse, n, extra = {}) => ({
  catalogNr, bezeichnung, marke: 'Testmarke', herstellerNr: extra.herstellerNr ?? '', farbe, groesse,
  articleNr: String(n).padStart(10, '0'), status: '', discontinued: '0', ...extra,
});
const GROESSEN = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const LSHOP = [
  ...['Black', 'White', 'Navy'].flatMap((f, i) => GROESSEN.map((g, j) => zeile('TS100', 'Test Classic T-Shirt', f, g, 1000 + i * 10 + j, { herstellerNr: '3000' }))),
  ...['Black', 'Heather Grey'].flatMap((f, i) => GROESSEN.map((g, j) => zeile('HD200', 'Test Heavy Hoodie', f, g, 2000 + i * 10 + j))),
  ...['Black', 'Red'].flatMap((f, i) => GROESSEN.map((g, j) => zeile('HD300', 'Test Zip Hoodie', f, g, 3000 + i * 10 + j))),
  ...['White'].flatMap(f => GROESSEN.map((g, j) => zeile('PO400', 'Test Polo Shirt', f, g, 4000 + j))),
];
const varianten = catalogNr => LSHOP.filter(z => z.catalogNr === catalogNr)
  .map(z => ({ farbe: z.farbe, groesse: z.groesse, articleNr: z.articleNr }));

// KI-Antwort-Baukasten (vollstaendig nach Schema)
const ki = (x = {}) => JSON.stringify({
  kunde: [], kurztitel: '', termin: '', kanal: '', wieLetztesMal: false, gruppen: [], frei: [], todos: [], hinweise: [], ...x,
});
const gr = (x = {}) => ({ artikel: '', modellNr: '', farbe: '', farbeEn: '', motiv: '', druck: '', groessen: [], menge: 0, ...x });

const JETZT = () => new Date('2026-11-17T10:00:00Z');   // Dienstag
function abhaengig(antwortText, { historie = [], modellId = 'claude-haiku-5-5' } = {}) {
  const aufruf = jest.fn(async () => ({ text: antwortText }));
  return {
    aufruf,
    deps: {
      jetzt: JETZT, aufruf, sheets: {},
      modellLesen: async () => modellId,
      kundenLesen: async () => ({ kunden: KUNDEN }),
      historieLesen: async () => ({ gruppen: historie.map(m => ({ modell: m, katalog: true })) }),
      modelleLesen: async () => LSHOP,
      variantenLesen: async ({ catalogNr }) => ({ varianten: varianten(catalogNr) }),
    },
  };
}
const lauf = (text, antwort, opt) => {
  const a = abhaengig(antwort, opt);
  return { aufruf: a.aufruf, p: schnellVorschlag({ eingabe: { text }, ...a.deps }) };
};

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-anthropic'; });

// ── Schema und Pruefung ──────────────────────────────────────────────────────
describe('Schema der KI-Antwort', () => {
  test('Structured-Outputs-tauglich: jedes Objekt additionalProperties false und alle Felder required', () => {
    const pruefe = s => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
        Object.values(s.properties).forEach(pruefe);
      }
      if (s.type === 'array') pruefe(s.items);
    };
    pruefe(KI_SCHEMA);
  });
  test('kein JSON / kein Objekt / falscher Typ -> ki_unsinn', () => {
    expect(() => pruefeKiAntwort('Hallo, ich bin eine Antwort ohne JSON')).toThrow(/nicht verwertbar/);
    expect(() => pruefeKiAntwort('[1,2]')).toThrow(/nicht verwertbar/);
    expect(() => pruefeKiAntwort(ki({ gruppen: 'viele' }))).toThrow(/gruppen ist keine Liste/);
  });
  test('normalisiert: Mengen ausserhalb 0-999 = 0, leere Groessen raus, unbekannte Felder weg', () => {
    const o = pruefeKiAntwort(ki({ geheim: 'x', gruppen: [gr({ groessen: [{ groesse: 'M', menge: 5000 }, { groesse: '', menge: 2 }, { groesse: 'L', menge: 2 }] })] }));
    expect(o.geheim).toBeUndefined();
    expect(o.gruppen[0].groessen).toEqual([{ groesse: 'L', menge: 2 }]);
  });
});

// ── Bausteine ────────────────────────────────────────────────────────────────
describe('Bausteine', () => {
  test('Kunde: Teilname, Spitzname, Ort; archivierte nie; mehrdeutig = Auswahl', () => {
    expect(kundenVorschlaege(KUNDEN, ['TSV Musterdorf'])).toMatchObject({ vorschlaege: ['K-00001'], sicher: true });
    expect(kundenVorschlaege(KUNDEN, ['Muster-Kicker'])).toMatchObject({ vorschlaege: ['K-00001'], sicher: true });
    const t = kundenVorschlaege(KUNDEN, ['Testhausen']);
    expect(t.sicher).toBe(false);
    expect(t.vorschlaege.sort()).toEqual(['K-00002', 'K-00003']);
    expect(kundenVorschlaege(KUNDEN, ['Alter Verein']).vorschlaege).not.toContain('K-00004');
    expect(kundenVorschlaege(KUNDEN, ['Beispiel Bau Gmbh Nord'])).toMatchObject({ vorschlaege: ['K-00002'], sicher: false });
    expect(kundenVorschlaege(KUNDEN, [])).toMatchObject({ vorschlaege: [], sicher: false });
  });
  test('Termin: gueltig = unsicher markiert; Vergangenheit/kaputt/zu weit = leer + Grund', () => {
    expect(terminPruefen('2026-11-27', '2026-11-17')).toMatchObject({ wert: '2026-11-27' });
    expect(terminPruefen('2026-11-27', '2026-11-17').grund).toMatch(/prüfen/);
    expect(terminPruefen('2026-11-01', '2026-11-17')).toMatchObject({ wert: '' });
    expect(terminPruefen('2026-02-30', '2026-11-17')).toMatchObject({ wert: '' });
    expect(terminPruefen('2028-12-24', '2026-11-17')).toMatchObject({ wert: '' });
    expect(terminPruefen('', '2026-11-17')).toEqual({ wert: '', grund: '' });
  });
  test('Kanal nur aus der Liste', () => {
    expect(kanalPruefen('whatsapp', ['Mail', 'WhatsApp'])).toEqual({ wert: 'WhatsApp', grund: '' });
    expect(kanalPruefen('Brieftaube', ['Mail']).wert).toBe('');
  });
  test('Suchwoerter: Kapuzenpulli -> hood, T-Shirt -> t-shirt', () => {
    expect(suchwoerter('Kapuzenpulli')).toContain('hood');
    expect(suchwoerter('T-Shirt')).toContain('t-shirt');
  });
  test('Modell: Nummer genau (auch Hersteller-Nr.), nie geraten', () => {
    expect(modellZuordnen(gr({ modellNr: 'ts100' }), LSHOP)).toMatchObject({ catalogNr: 'TS100', sicher: true });
    expect(modellZuordnen(gr({ modellNr: '3000' }), LSHOP)).toMatchObject({ catalogNr: 'TS100', sicher: true });
    expect(modellZuordnen(gr({ modellNr: 'XY999' }), LSHOP)).toMatchObject({ catalogNr: '', sicher: false });
  });
  test('Modell ueber Artikelwort: mehrdeutig -> Vorschlaege, Historie entscheidet (unsicher)', () => {
    const m = modellZuordnen(gr({ artikel: 'Hoodie' }), LSHOP);
    expect(m.catalogNr).toBe('');
    expect(m.vorschlaege.sort()).toEqual(['HD200', 'HD300']);
    expect(modellZuordnen(gr({ artikel: 'Kapuzenpulli' }), LSHOP, ['HD300'])).toMatchObject({ catalogNr: 'HD300', sicher: false });
    expect(modellZuordnen(gr({ artikel: 'Polo' }), LSHOP)).toMatchObject({ catalogNr: 'PO400', sicher: false });
  });
  test('Farbe: englisch genau, deutsch ueber Liste, Tippfehler ueber farbeEn, unbekannt = Auswahl', () => {
    const f = ['Black', 'Heather Grey'];
    expect(farbeZuordnen(gr({ farbe: 'schwarz', farbeEn: 'Black' }), f)).toMatchObject({ farbe: 'Black', sicher: true });
    expect(farbeZuordnen(gr({ farbe: 'schwarz' }), f)).toMatchObject({ farbe: 'Black', sicher: true });
    expect(farbeZuordnen(gr({ farbe: 'schwrz', farbeEn: 'Black' }), f)).toMatchObject({ farbe: 'Black' });
    expect(farbeZuordnen(gr({ farbe: 'grau', farbeEn: 'Grey' }), f)).toMatchObject({ farbe: 'Heather Grey', sicher: false });
    expect(farbeZuordnen(gr({ farbe: 'lila', farbeEn: 'Purple' }), f)).toMatchObject({ farbe: null, auswahl: f });
  });
  test('Groesse: XXL = 2XL, klein geschrieben, unbekannt = null', () => {
    const v = varianten('TS100').filter(x => x.farbe === 'Black');
    expect(groesseFinden('XXL', v).groesse).toBe('2XL');
    expect(groesseFinden('m', v).groesse).toBe('M');
    expect(groesseFinden('128', v)).toBeNull();
  });
});

// ── 10+ typische Faelle durch den ganzen Ablauf (KI = Attrappe) ──────────────
describe('Faelle', () => {
  test('1 Verein mit Groessenliste: Kunde eindeutig, Modell per Nummer, XXL -> 2XL', async () => {
    const { p } = lauf('tsv musterdorf 10 shirts ts100 schwarz m 3 l 4 xxl 3 brust logo bis 27.11. per whatsapp',
      ki({ kunde: ['TSV Musterdorf'], kurztitel: 'Shirts Saison', termin: '2026-11-27', kanal: 'WhatsApp',
        gruppen: [gr({ artikel: 'T-Shirt', modellNr: 'TS100', farbe: 'schwarz', farbeEn: 'Black', motiv: 'Vereinslogo', druck: 'Brust links',
          groessen: [{ groesse: 'M', menge: 3 }, { groesse: 'L', menge: 4 }, { groesse: 'XXL', menge: 3 }] })] }));
    const v = await p;
    expect(v.kunde).toMatchObject({ vorschlaege: ['K-00001'], sicher: true });
    expect(v.kopf).toEqual({ Kurztitel: 'Shirts Saison', Kanal: 'WhatsApp', Termin: '2026-11-27' });
    const g = v.gruppen[0];
    expect(g).toMatchObject({ ok: true, modell: 'TS100', farbe: 'Black', motiv: 'Vereinslogo', druck: 'Brust links', grund: [] });
    expect(g.positionen.map(x => `${x.groesse}×${x.menge}`)).toEqual(['M×3', 'L×4', '2XL×3']);
  });
  test('2 Firma, Logo vorne + hinten, Hoodie ohne Nummer -> Modell aus der Historie, unsicher', async () => {
    const { p } = lauf('beispiel bau 20 hoodies schwarz logo vorne klein und hinten gross',
      ki({ kunde: ['Beispiel Bau'], gruppen: [gr({ artikel: 'Hoodie', farbe: 'schwarz', farbeEn: 'Black', motiv: 'Firmenlogo', druck: 'vorne klein, hinten groß', menge: 20 })] }),
      { historie: ['HD200'] });
    const v = await p;
    const g = v.gruppen[0];
    expect(g).toMatchObject({ modell: 'HD200', farbe: 'Black', druck: 'vorne klein, hinten groß', ok: false });
    expect(g.grund.join(' ')).toMatch(/früheren Aufträgen/);
    expect(g.grund.join(' ')).toMatch(/20 Stück ohne Größen/);
  });
  test('3 "wie letztes Mal + 5 mehr": Kennzeichen fuer den Dialog, keine erfundenen Positionen', async () => {
    const v = await lauf('muster-kicker wie letztes mal aber 5 mehr', ki({ kunde: ['Muster-Kicker'], wieLetztesMal: true, hinweise: ['5 Stück mehr als letztes Mal'] })).p;
    expect(v.wieLetztesMal).toBe(true);
    expect(v.gruppen).toEqual([]);
    expect(v.hinweise).toEqual(['5 Stück mehr als letztes Mal']);
  });
  test('4 freie Positionen (Sticker, Tasse)', async () => {
    const v = await lauf('sv testhausen 50 sticker und 10 tassen mit logo',
      ki({ kunde: ['SV Testhausen'], frei: [{ text: 'Sticker mit Logo', menge: 50 }, { text: 'Tasse mit Logo', menge: 10 }] })).p;
    expect(v.frei).toEqual([{ text: 'Sticker mit Logo', menge: 50 }, { text: 'Tasse mit Logo', menge: 10 }]);
    expect(v.kunde.sicher).toBe(true);
  });
  test('5 Termin relativ: Datum von Heute (im Prompt) aus, als unsicher markiert', async () => {
    const { p, aufruf } = lauf('beispiel bau polos weiss bis nächsten freitag', ki({ kunde: ['Beispiel Bau'], termin: '2026-11-27', gruppen: [gr({ artikel: 'Polo', farbe: 'weiß', farbeEn: 'White', menge: 5 })] }));
    const v = await p;
    expect(aufruf.mock.calls[0][0].prompt).toMatch(/Heute ist Dienstag, 2026-11-17/);
    expect(v.kopf.Termin).toBe('2026-11-27');
    expect(v.unsicher.Termin).toMatch(/prüfen/);
  });
  test('6 unbekanntes Modell: nichts erfunden, Gruppe nicht zugeordnet', async () => {
    const v = await lauf('sv testhausen 10x XY999 rot', ki({ kunde: ['SV Testhausen'], gruppen: [gr({ artikel: 'Shirt', modellNr: 'XY999', farbe: 'rot', farbeEn: 'Red', groessen: [{ groesse: 'M', menge: 10 }] })] })).p;
    expect(v.gruppen[0]).toMatchObject({ ok: false, modell: '', positionen: [] });
    expect(v.gruppen[0].grund[0]).toMatch(/XY999/);
  });
  test('7 zwei Farben = zwei Gruppen, je eigenes Raster', async () => {
    const v = await lauf('tsv musterdorf ts100 schwarz m 2 und weiss l 3', ki({ kunde: ['TSV Musterdorf'], gruppen: [
      gr({ artikel: 'T-Shirt', modellNr: 'TS100', farbe: 'schwarz', farbeEn: 'Black', groessen: [{ groesse: 'M', menge: 2 }] }),
      gr({ artikel: 'T-Shirt', modellNr: 'TS100', farbe: 'weiß', farbeEn: 'White', groessen: [{ groesse: 'L', menge: 3 }] }),
    ] })).p;
    expect(v.gruppen.map(g => `${g.farbe}:${g.positionen.map(x => x.articleNr).join(',')}`)).toEqual(['Black:0000001001', 'White:0000001012']);
  });
  test('8 Tippfehler (Kunde + Farbe): Kunde nur aehnlich, Farbe ueber farbeEn', async () => {
    const v = await lauf('tsv musterdrof ts100 schwrz m 1', ki({ kunde: ['TSV Musterdrof'], gruppen: [gr({ modellNr: 'TS100', farbe: 'schwrz', farbeEn: 'Black', groessen: [{ groesse: 'M', menge: 1 }] })] })).p;
    expect(v.kunde).toMatchObject({ vorschlaege: ['K-00001'], sicher: false });
    expect(v.gruppen[0]).toMatchObject({ farbe: 'Black', ok: true });
  });
  test('9 Diktat ohne Satzzeichen: Text geht unveraendert an die KI, Kundenliste nie', async () => {
    const text = 'hallo also der tsv musterdorf braucht zwanzig hoodies schwarz bis ende november logo hinten';
    const { p, aufruf } = lauf(text, ki({ kunde: ['TSV Musterdorf'], gruppen: [gr({ artikel: 'Hoodie', farbe: 'schwarz', farbeEn: 'Black', menge: 20 })] }));
    const v = await p;
    const arg = aufruf.mock.calls[0][0];
    expect(arg.prompt).toContain(text);
    for (const k of KUNDEN) {
      expect(arg.prompt + arg.system).not.toContain(k.Name);
      expect(arg.prompt + arg.system).not.toContain(k.Kunden_Nr);
    }
    expect(v.gruppen[0].vorschlaege.sort()).toEqual(['HD200', 'HD300']);
  });
  test('10 leerer / zu langer Text: 422, KI wird nie gerufen', async () => {
    const a = lauf('   ', ki());
    await expect(a.p).rejects.toMatchObject({ status: 422, code: 'text_kurz' });
    const b = lauf('x'.repeat(TEXT_MAX + 1), ki());
    await expect(b.p).rejects.toMatchObject({ status: 422, code: 'text_lang' });
    expect(a.aufruf).not.toHaveBeenCalled();
    expect(b.aufruf).not.toHaveBeenCalled();
  });
  test('11 Groesse gibt es beim Modell nicht -> Grund, Rest bleibt', async () => {
    const v = await lauf('sv testhausen ts100 schwarz m 2 128 4', ki({ kunde: ['SV Testhausen'], gruppen: [gr({ modellNr: 'TS100', farbeEn: 'Black', groessen: [{ groesse: 'M', menge: 2 }, { groesse: '128', menge: 4 }] })] })).p;
    expect(v.gruppen[0].positionen).toHaveLength(1);
    expect(v.gruppen[0].grund.join(' ')).toMatch(/128 × 4/);
  });
  test('12 Unsinn ("nichts erkannt") und kein JSON -> ki_unsinn', async () => {
    await expect(lauf('asdf qwer yxcv', ki()).p).rejects.toMatchObject({ code: 'ki_unsinn' });
    await expect(lauf('asdf qwer yxcv', 'Entschuldigung, das verstehe ich nicht.').p).rejects.toMatchObject({ code: 'ki_unsinn', status: 502 });
  });
});

// ── Fehler, Anbieter, Datenschutz ────────────────────────────────────────────
describe('Fehler und Datenschutz', () => {
  test('Zeitlimit und Netzfehler: feste Meldung, ohne Text', async () => {
    const a = abhaengig('');
    a.aufruf.mockRejectedValueOnce(new KiZeitlimitError({ modellId: 'claude-haiku-5-5', ms: ZEITLIMIT_MS }));
    await expect(schnellVorschlag({ eingabe: { text: 'geheimer Kundentext 123' }, ...a.deps })).rejects.toMatchObject({ status: 504, code: 'ki_zeitlimit' });
    a.aufruf.mockRejectedValueOnce(Object.assign(new Error('Fehler mit geheimer Kundentext 123'), { status: 529 }));
    const e = await schnellVorschlag({ eingabe: { text: 'geheimer Kundentext 123' }, ...a.deps }).catch(x => x);
    expect(e).toMatchObject({ status: 502, code: 'ki_fehler' });
    expect(e.message).not.toMatch(/geheim/);
  });
  test('nur Claude: Rolle auf Gemini -> 503, KI nie gerufen; fehlender Schluessel -> 503', async () => {
    const g = lauf('tsv musterdorf 5 shirts', ki(), { modellId: 'gemini-3.5-flash-lite' });
    await expect(g.p).rejects.toMatchObject({ status: 503, code: 'ki_anbieter' });
    expect(g.aufruf).not.toHaveBeenCalled();
    delete process.env.ANTHROPIC_API_KEY;
    await expect(lauf('tsv musterdorf 5 shirts', ki()).p).rejects.toMatchObject({ status: 503 });
  });
  test('Aufruf: Rolle auftrag-schnell (Standard Haiku), Art schnell mit Schema und Zeitlimit', async () => {
    const { p, aufruf } = lauf('tsv musterdorf 5 shirts', ki({ kunde: ['TSV Musterdorf'] }));
    await p;
    expect(ROLLE).toBe('auftrag-schnell');
    expect(DEFAULT_MODELS[ROLLE]).toMatch(/^claude-haiku/);
    expect(ARTEN.schnell.anthropic.thinking).toBeUndefined();   // Opus 5.5 lehnt "disabled" ab
    expect(aufruf.mock.calls[0][0]).toMatchObject({ art: 'schnell', jsonSchema: KI_SCHEMA, zeitlimitMs: ZEITLIMIT_MS });
  });
  test('Rohtext nie im Log (Erfolg und Fehler)', async () => {
    const TEXT = 'Erfundener Max Mustermann vom TSV Musterdorf will 3 Shirts';
    const spione = ['log', 'warn', 'error', 'info', 'debug'].map(f => jest.spyOn(console, f).mockImplementation(() => {}));
    await lauf(TEXT, ki({ kunde: ['TSV Musterdorf'], gruppen: [gr({ modellNr: 'TS100', farbeEn: 'Black', groessen: [{ groesse: 'M', menge: 3 }] })] })).p;
    await lauf(TEXT, 'kaputt').p.catch(() => {});
    const alles = spione.flatMap(s => s.mock.calls.flat()).map(String).join('\n');
    expect(alles).not.toContain('Mustermann');
    spione.forEach(s => s.mockRestore());
  });
  test('pruefeEingabe: nur String', () => {
    expect(() => pruefeEingabe({ text: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(/mindestens/);
  });
  test('gruppeVorschlag ohne Modell traegt Vorschlaege und Mengentext', () => {
    const g = gruppeVorschlag(gr({ artikel: 'Hoodie', groessen: [{ groesse: 'M', menge: 2 }] }), { catalogNr: '', grund: 'x', vorschlaege: ['HD200'] }, []);
    expect(g).toMatchObject({ ok: false, vorschlaege: ['HD200'], mengenText: 'M × 2' });
  });
});

// SA1-1: Nachbesserung nach der Messung am echten Reiter (17.11.).
describe('SA1-1 Farben und Artikelwort', () => {
  test('Kapuzenpulli sucht nur hood, nicht zusaetzlich sweat', () => {
    expect(suchwoerter('Kapuzenpulli')).toContain('hood');
    expect(suchwoerter('Kapuzenpulli')).not.toContain('sweat');
    expect(suchwoerter('Pulli')).toContain('sweat');
  });
  test('"Royal Blue" -> "Royal" (allgemeiner) statt "Alaskan Blue"; orange', () => {
    const f = ['Alaskan Blue', 'Black', 'Royal', 'Sports Grey (Heather)', 'Fire Red'];
    expect(farbeZuordnen(gr({ farbe: 'blau', farbeEn: 'Royal Blue' }), f)).toMatchObject({ farbe: 'Royal', sicher: false });
    expect(farbeZuordnen(gr({ farbe: 'rot', farbeEn: 'Red' }), f)).toMatchObject({ farbe: 'Fire Red', sicher: false });
    expect(farbeZuordnen(gr({ farbe: 'grau', farbeEn: 'Grey' }), f)).toMatchObject({ farbe: 'Sports Grey (Heather)', sicher: false });
  });
  test('mehrere Schwarztoene -> waehlen, nie raten', () => {
    const r = farbeZuordnen(gr({ farbe: 'schwarz', farbeEn: 'Black' }), ['Deep Black', 'Jet Black', 'Black Smoke', 'Arctic White']);
    expect(r.farbe).toBeNull();
    expect(r.auswahl).toHaveLength(3);
  });
});
