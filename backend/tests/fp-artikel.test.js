// PA7: Festpreis-Partner im taeglichen Artikel-Abgleich - nur melden. Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fpZielKategorien, fpPartnerBefund, fpOhneEintragInVerkaeufen } from '../utils/fp-artikel.js';
import { fpArtikelPruefung, fpUebersprungenePruefen } from '../lib/fpArtikel.js';
import { buildArtikelAbgleichNachricht, buildAbgleichLebenszeichen } from '../lib/chatNotify.js';

const hier = dirname(fileURLToPath(import.meta.url));
const KAT = [{ id: 100, parent: 0 }, { id: 101, parent: 100 }, { id: 102, parent: 101 }, { id: 200, parent: 0 }];

describe('Kategorien', () => {
  test('mit allen Unterkategorien (auch neue, tiefe); Nummer nicht im Shop gemeldet', () => {
    const r = fpZielKategorien('100, 999', KAT);
    expect([...r.ziel].sort()).toEqual([100, 101, 102]);
    expect(r.weg).toEqual(['999']);
  });
});

describe('Befund je Partner', () => {
  const produkte = [
    { id: 1, name: 'Shirt', status: 'publish', categories: [{ id: 100 }] },
    { id: 2, name: 'Neu in Unterkategorie', status: 'publish', categories: [{ id: 102 }] },
    { id: 3, name: 'Entwurf', status: 'draft', categories: [{ id: 101 }] },
    { id: 4, name: 'Privat', status: 'private', categories: [{ id: 101 }] },
    { id: 5, name: 'Fremd', status: 'publish', categories: [{ id: 200 }] },
  ];
  const artikel = [
    { produktId: '1', name: 'Shirt', artikelkategorie: 'T-Shirt' },
    { produktId: '9', name: 'Ohne Kat', artikelkategorie: '' },
    { produktId: '8', name: 'Unbekannte Kat', artikelkategorie: 'Gibt es nicht' },
    { produktId: '7', name: 'Schal', artikelkategorie: 'Schal' },   // Festpreis 0 bewusst -> Zeile vorhanden = gesetzt
  ];
  const b = fpPartnerBefund({ partner: { id: 'FP-009', kategorien: '100,999' }, kategorien: KAT, produkte, artikel, festpreisKategorien: new Set(['T-Shirt', 'Schal']) });
  test('fehlend = veroeffentlicht, in Kategorie inkl. Unterkategorie, ohne Zeile; vorhandene nicht doppelt; Entwurf/privat/fremd nicht', () => {
    expect(b.fehlend).toEqual([{ produktId: '2', name: 'Neu in Unterkategorie' }]);
  });
  test('ohne Festpreis = Artikelkategorie leer oder ohne Zeile in FP_Artikel_Kategorie', () => {
    expect(b.ohneFestpreis.map(x => [x.produktId, x.grund])).toEqual([['9', 'Artikelkategorie leer'], ['8', 'Artikelkategorie ohne Festpreis-Zeile']]);
    expect(b.kategorienWeg).toEqual(['999']);
  });
});

describe('Lesen (Sheets + Shop), schreibt nie', () => {
  const tabs = {
    FP_Partner: [['Partner-ID', 'Name', 'Shop', 'Aktiv', 'Kategorien'], ['FP-009', 'Testclub', 'jfn', 'ja', '100'], ['FP-010', 'Inaktiv', 'jfn', 'nein', '100']],
    FP_Artikel: [['Partner-ID', 'Produkt-ID', 'Artikelname', 'Festpreis-EK-Netto', 'Handling-Gebühr', 'Versandart', 'WC-Kategorie', 'Artikelkategorie'],
      ['FP-009', '1', 'Shirt', '7.77', '0.55', 'P', 'Club', 'T-Shirt']],
    FP_Artikel_Kategorie: [['Kategorie', 'Festpreispartner-ID', 'Festpreis', 'Handlingskosten'], ['T-Shirt', 'FP-009', '12.34', '0.66']],
  };
  const machSheets = () => {
    const schreib = jest.fn();
    return { schreib, sheets: { spreadsheets: {
      values: {
        get: async ({ range }) => { const t = range.replace(/^'|'$/g, ''); if (!tabs[t]) { const e = new Error('Unable to parse range'); e.code = 400; throw e; } return { data: { values: tabs[t] } }; },
        update: schreib, append: schreib, batchUpdate: schreib,
      },
      batchUpdate: schreib,
    } } };
  };
  const wc = { get: jest.fn(async (pfad, q) => {
    if (pfad === 'products/categories') return { data: KAT };
    if (q.include) return { data: [{ id: 2, categories: [{ id: 102 }] }, { id: 5, categories: [{ id: 200 }] }] };
    return { data: [{ id: 1, name: 'Shirt', status: 'publish', categories: [{ id: 100 }] }, { id: 2, name: 'Neu', status: 'publish', categories: [{ id: 101 }] }] };
  }) };

  test('nur aktive Partner, nichts geschrieben, kein Festpreis/Preis in der Antwort', async () => {
    const { sheets, schreib } = machSheets();
    const r = await fpArtikelPruefung({ sheets, sheetId: 'x', wcFuer: () => wc, takt: 0 });
    expect(r.partner.map(p => p.id)).toEqual(['FP-009']);
    expect(r.partner[0].fehlend.map(f => f.produktId)).toEqual(['2']);
    expect(r.summen).toMatchObject({ partner: 1, fehlend: 1, ohneFestpreis: 0, kategorienWeg: 0, fehler: 0 });
    expect(schreib).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toMatch(/12\.34|7\.77|0\.55|0\.66|Festpreis-EK/);
    expect(wc.get.mock.calls.every(([, q]) => q._fields)).toBe(true);
  });
  test('fehlende FP-Reiter = keine FP-Partner (kein Fehler)', async () => {
    const leer = { spreadsheets: { values: { get: async () => { const e = new Error('Unable to parse range'); e.code = 400; throw e; } } } };
    const r = await fpArtikelPruefung({ sheets: leer, sheetId: 'x', wcFuer: () => wc, takt: 0 });
    expect(r.summen.partner).toBe(0);
  });
  test('FP-Sync: uebersprungene Position in Partner-Kategorie wird gemeldet (mit fruehestem Datum), fremde nicht', async () => {
    const r = await fpUebersprungenePruefen({ wc, takt: 0, partner: [{ id: 'FP-009', kategorien: '100' }], uebersprungen: [
      { produktId: '2', bestellung: 5001, datum: '2026-11-05' }, { produktId: '2', bestellung: 5000, datum: '2026-11-03' }, { produktId: '5', bestellung: 5002, datum: '2026-11-04' }] });
    expect(r).toEqual([{ partnerId: 'FP-009', produktId: '2', bestellungen: ['5001', '5000'], ab: '2026-11-03' }]);
    expect(fpOhneEintragInVerkaeufen({ uebersprungen: [], produkte: [], kategorien: KAT, partner: [] })).toEqual([]);
  });
});

describe('Chat', () => {
  test('Festpreis-Zeilen in derselben Meldung, nur IDs, keine Preise', () => {
    const t = buildArtikelAbgleichNachricht({ partner: [], festpreis: { partner: [{ id: 'FP-009', fehlend: [{ produktId: '21', name: 'Neu' }, { produktId: '22', name: 'Neu 2' }], ohneFestpreis: [{ produktId: '9' }], kategorienWeg: ['999'] }] } });
    expect(t).toContain('Festpreis FP-009: 2 neue Artikel ohne Eintrag (IDs 21, 22)');
    expect(t).toContain('1 Artikel ohne Festpreis-Kategorie (IDs 9)');
    expect(t).toContain('Kategorie 999 gibt es im Shop nicht mehr');
    expect(t).not.toMatch(/€|\d+,\d\d|\d+\.\d\d/);
  });
  test('nichts gefunden -> keine Meldung; Lizenz-Text unveraendert', () => {
    expect(buildArtikelAbgleichNachricht({ partner: [], festpreis: { partner: [{ id: 'FP-009', fehlend: [], ohneFestpreis: [], kategorienWeg: [] }] } })).toBeNull();
    const lizenz = { partner: [{ id: 'P-001', neu: [{ name: 'Shirt', produktId: '1' }], ekFehlt: 1 }] };
    expect(buildArtikelAbgleichNachricht(lizenz)).toBe(buildArtikelAbgleichNachricht({ ...lizenz, festpreis: { partner: [] } }));
  });
  test('Montags-Lebenszeichen zaehlt FP-Partner mit; ohne zweite Zahl wie bisher', () => {
    expect(buildAbgleichLebenszeichen(3, 1)).toBe('Partner-Abgleich: nichts Neues (3 Partner, 1 Festpreis-Partner geprüft)');
    expect(buildAbgleichLebenszeichen(3)).toBe('Partner-Abgleich: nichts Neues (3 Partner geprüft)');
  });
});

describe('Quelltext', () => {
  const lib = readFileSync(resolve(hier, '../lib/fpArtikel.js'), 'utf8');
  const utils = readFileSync(resolve(hier, '../utils/fp-artikel.js'), 'utf8');
  test('PA7 schreibt nie ins Sheet, kein Festpreis, kein append, Shop nur ueber getWcClient', () => {
    for (const x of [lib, utils]) {
      expect(x).not.toMatch(/\.(update|append|batchUpdate)\(/);
      expect(x).not.toMatch(/WooCommerceRestApi/);
      expect(x).not.toMatch(/console\.\w+\(/);
    }
  });
  test('FP-Sync meldet uebersprungene Positionen statt still weiterzumachen', () => {
    const r = readFileSync(resolve(hier, '../routes/festpreis-portal.js'), 'utf8');
    expect(r).toMatch(/if \(!entries\) \{\s*\(uebersprungen\[shop\] \?\?= \[\]\)\.push/);
    expect(r).toContain('ohneEintrag, ...(pruefungFehler ? { pruefungFehler } : {}),');
  });
  test('MC: Hinweis-Block und Sync-Warnungen', () => {
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const block = html.slice(html.indexOf('// ── PA7 Festpreis-Hinweis: Anfang'), html.indexOf('// ── PA7 Festpreis-Hinweis: Ende ──'));
    const F = new Function(`${block}\nreturn { fpOhneFestpreis, fpHinweisHtml, fpSyncWarnungen };`)();
    const art = [{ 'Produkt-ID': '1', Artikelkategorie: 'T-Shirt' }, { 'Produkt-ID': '2', Artikelkategorie: '' }];
    const ohne = F.fpOhneFestpreis(art, ['T-Shirt']);
    expect(ohne.map(a => a['Produkt-ID'])).toEqual(['2']);
    const h = F.fpHinweisHtml(ohne, { fehlend: [{ produktId: '21', name: 'Neu <b>' }], kategorienWeg: [] });
    expect(h).toContain('1 Artikel ohne Festpreis-Kategorie');
    expect(h).toContain('data-hilfe="fp-ohne-zeigen"');
    expect(h).toContain('21 · Neu &lt;b&gt;');
    expect(F.fpHinweisHtml([], null)).toBe('');
    const w = F.fpSyncWarnungen({ ohneEintrag: [{ produktId: '21', bestellungen: ['5000', '5001'], ab: '2026-11-03' }], ohneFestpreisAnzahl: 1 });
    expect(w[0]).toContain('2 Verkauf/Verkäufe zu Artikeln ohne Festpreis-Eintrag (IDs 21) – NICHT abgerechnet');
    expect(w[0]).toContain('mit Datum ab 03.11.2026');
    expect(w[1]).toContain('1 Position(en) ohne Festpreis-Kategorie');
    expect(html).toContain('id="btn-fp-artikel-pruefen" style="font-size:0.82rem;padding:0.42rem 0.85rem;" disabled data-hilfe="fp-artikel-pruefen"');
  });
});
