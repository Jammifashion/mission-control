// Auftrag FM2: Kollektion "Fanmeet" (BoysLove) im Anlage-Skript (lib/anlageHalloween.js).
// Zwei Kollektionen (Tay New, Force of Love) x 6 Produkte, neue Unterkategorie unter 320
// plus feste 320, Vorblendung der einzigen Farbe, Struktur Z60 umschreiben, SEO_Hinweis 320,
// Bild-ALT mit Farbe, Sheets ohne values.append (erste freie Zeile, pruefen, zuruecklesen).

import { jest } from '@jest/globals';
import {
  KOLLEKTIONEN, FANMEET_TAYNEW, FANMEET_FORCELOVE, FANMEET_SEO_HINWEIS, BOYSLOVE_SEO_HINWEIS,
  planeArtikel, planeSheets, produktPayload, produktKategorien, pruefeVorblendung, bildListe,
  kategorieZeile, karteZeile, motivZeile, maskeBody, zellText, zeilenAbweichungen, spalteBuchstabe,
  schreibeNeueZeilen, ersetzeZeile, haengeZeileAn,
} from '../lib/anlageHalloween.js';
import { SKU_MAX } from '../lib/sku.js';
import { readFileSync } from 'fs';

const TERME = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
const ATTR_IDS = { farbe: 3, groesse: 2 };
let nr = 1000000000;
const zeilen = (catalogNr, farbe, groessen) => groessen.map(size => ({
  articleNr: String(++nr), catalogNr, color1: farbe, color2: '', size, discontinued: '0', status: 'aktiv',
}));
const BIS_5XL = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const LSHOP = [
  ...zeilen('E3000', 'Black', [...BIS_5XL, '6XL', '7XL', '8XL']),
  ...zeilen('E3005', 'Black', BIS_5XL.slice(0, 7)),
  ...zeilen('BCWU02K', 'Black Pure', BIS_5XL.slice(0, 8)),
  ...zeilen('BCWW02Q', 'Black Pure', BIS_5XL.slice(0, 7)),
  ...zeilen('BY284', 'Black', BIS_5XL),
  ...zeilen('BY289', 'Black', BIS_5XL),
  ...zeilen('BY289', 'Pale Olive', ['M']).map(z => ({ ...z, discontinued: '1' })),
];
const plaene = k => k.artikel.map(artikel => planeArtikel({ artikel, lshopZeilen: LSHOP, groessenTerme: TERME, preise: null, k }));
const p = (k, modell) => plaene(k).find(x => x.artikel.modell === modell);

describe('Kollektionen (Entscheidungen Inhaber 28.10.)', () => {
  test('zwei Kollektionen, je 6 Artikel, Titel nach BL-Muster, Keyphrase = Titel, 3 Synonyme', () => {
    expect(KOLLEKTIONEN['fanmeet-taynew']).toBe(FANMEET_TAYNEW);
    expect(KOLLEKTIONEN['fanmeet-forcelove']).toBe(FANMEET_FORCELOVE);
    expect(FANMEET_TAYNEW.artikel.map(a => a.titel)).toEqual([
      'Tay New T-Shirt', 'Tay New T-Shirt tailliert', 'Tay New super weicher Hoodie',
      'Tay New super weicher Hoodie tailliert', 'Tay New Fluffy Hoodie', 'Tay New Fluffy Hoodie Damen',
    ]);
    for (const k of [FANMEET_TAYNEW, FANMEET_FORCELOVE]) for (const a of k.artikel) {
      expect(a.keyphrase).toBe(a.titel);
      expect(a.synonyme).toHaveLength(3);
      expect(a.bildTitel).toBe(`${a.titel} Schwarz`);
    }
    expect(FANMEET_FORCELOVE.artikel[0].synonyme[0]).toBe('ForceBook Shirt');
    expect(FANMEET_FORCELOVE.artikel.find(a => a.modell === 'BCWW02Q').bilddatei).toBe('BCWW02QForce of Love.jpg');
  });

  test('Versandklasse: Shirts und Fluffy grossbrief, BC-Hoodies paket', () => {
    const v = Object.fromEntries(FANMEET_TAYNEW.artikel.map(a => [a.modell, a.versand]));
    expect(v).toEqual({ E3000: 'grossbrief', E3005: 'grossbrief', BCWU02K: 'paket', BCWW02Q: 'paket', BY284: 'grossbrief', BY289: 'grossbrief' });
  });

  test('nur die erste Kollektion schreibt SEO_Hinweis 320 und Kategoriebild', () => {
    expect(FANMEET_TAYNEW.seoHinweiseNeu).toEqual([{ nummer: '320', hinweis: BOYSLOVE_SEO_HINWEIS }]);
    expect(FANMEET_FORCELOVE.seoHinweiseNeu).toEqual([]);
    expect(FANMEET_TAYNEW.kategorieBildModell).toBe('E3000');
    expect(FANMEET_FORCELOVE.kategorieBildModell).toBeNull();
    expect(FANMEET_TAYNEW.preise).toBe('fanmeet');
    expect(FANMEET_FORCELOVE.preise).toBe('fanmeet');
  });

  test('Prompt-Texte: kein "offiziell"/"exklusiv", kein Anlass/Datum; Personen nie beschreiben', () => {
    const prompt = [FANMEET_SEO_HINWEIS, BOYSLOVE_SEO_HINWEIS, FANMEET_TAYNEW.motivZeile.motiv, FANMEET_FORCELOVE.motivZeile.motiv,
      FANMEET_TAYNEW.motivZeile.serieKontext];
    for (const s of prompt) {
      expect(s).not.toMatch(/offiziell|exklusiv|nur bei uns/i);
      expect(s).not.toMatch(/Fantreffen|Berlin|\d{1,2}\.\d{1,2}\.\d{4}|Hotel/);
    }
    expect(BOYSLOVE_SEO_HINWEIS).toMatch(/Schauspieler-Namen nur als Motivtext oder im Titel, Personen nie beschreiben/);
    expect(BOYSLOVE_SEO_HINWEIS).not.toMatch(/Keine Schauspieler:innen/);
    expect(FANMEET_TAYNEW.motivZeile.nurIntern).toBe('Fantreffen; Fanmeet; Berlin; 05.12.2026');
    expect(FANMEET_SEO_HINWEIS).toMatch(/Kein Zeitdruck und keine Knappheit/);
    expect(FANMEET_SEO_HINWEIS).not.toMatch(/Fanmeet/);
  });
});

describe('Plan', () => {
  test('Groessen laut L-Shop bis 5XL, XXL -> 2XL, Farbe = L-Shop-Name', () => {
    expect(p(FANMEET_TAYNEW, 'E3000').groessen.map(g => g.shop)).toEqual(TERME);
    expect(p(FANMEET_TAYNEW, 'BCWU02K').farbe).toBe('Black Pure');
    expect(p(FANMEET_TAYNEW, 'BCWU02K').varianten).toHaveLength(8);
    expect(p(FANMEET_TAYNEW, 'BY289').varianten).toHaveLength(9);
    const summe = [...plaene(FANMEET_TAYNEW), ...plaene(FANMEET_FORCELOVE)].reduce((n, x) => n + x.varianten.length, 0);
    expect(summe).toBe(98);
  });

  test('SKUs <Modell>/<Kurz>-<farbe>-<groesse>, eindeutig ueber beide Kollektionen', () => {
    const alle = [...plaene(FANMEET_TAYNEW), ...plaene(FANMEET_FORCELOVE)];
    const skus = alle.flatMap(x => [x.artikelnummer, ...x.varianten.map(v => v.sku)]);
    expect(new Set(skus).size).toBe(skus.length);
    expect(Math.max(...skus.map(s => s.length))).toBeLessThanOrEqual(SKU_MAX);
    expect(p(FANMEET_FORCELOVE, 'BCWU02K').varianten.at(-1).sku).toBe('BCWU02K/BL-ForceLove-black-pure-4xl');
    expect(p(FANMEET_TAYNEW, 'E3000').artikelnummer).toBe('E3000/BL-TayNew');
  });
});

describe('Payload', () => {
  test('Kategorien 320 + neue, Vorblendung der Farbe, Entwurf', () => {
    const b = produktPayload(p(FANMEET_TAYNEW, 'BCWW02Q'), { kategorieId: 999, attrIds: ATTR_IDS, markeId: 698, lieferzeit: '21', bilder: { einzel: 5 } });
    expect(b.categories).toEqual([{ id: 320 }, { id: 999 }]);
    expect(b.default_attributes).toEqual([{ id: 3, option: 'Black Pure' }]);
    expect(b.status).toBe('draft');
    expect(b.images).toEqual([{ id: 5 }]);
    expect(b.attributes.map(a => a.options)).toEqual([['Black Pure'], ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']]);
  });

  test('produktKategorien: feste IDs bleiben (ch-halloween), Halloween nur die neue', () => {
    expect(produktKategorien(KOLLEKTIONEN['ch-halloween'], 1)).toEqual([549, 589, 686, 703, 776]);
    expect(produktKategorien(KOLLEKTIONEN.halloween, 776)).toEqual([776]);
    expect(produktKategorien(FANMEET_FORCELOVE, null)).toEqual([320]);
  });

  test('Ruecklesen der Vorblendung: Name oder Slug ok, sonst Meldung', () => {
    expect(pruefeVorblendung([{ id: 3, name: 'Farbe', option: 'Black Pure' }], 'Black Pure', 3)).toBeNull();
    expect(pruefeVorblendung([{ id: 3, option: 'black-pure' }], 'Black Pure', 3)).toBeNull();
    expect(pruefeVorblendung([], 'Black', 3)).toMatch(/statt Farbe "Black"/);
    expect(pruefeVorblendung([{ id: 2, option: 'Black' }], 'Black', 3)).toMatch(/default_attributes/);
    expect(pruefeVorblendung([{ id: 3, option: 'Black' }, { id: 2, option: 'M' }], 'Black', 3)).toMatch(/default_attributes/);
  });

  test('Bild: SEO-Dateiname aus dem Titel, Titel = ALT = Titel + Farbe', () => {
    const a = FANMEET_TAYNEW.artikel[0];
    expect(bildListe(a, null, FANMEET_TAYNEW)).toEqual([{ schluessel: 'einzel', quelle: 'E3000 black Tay New.jpg',
      dateiname: 'tay-new-t-shirt.jpg', titel: 'Tay New T-Shirt Schwarz' }]);
  });

  test('Maske: Kurzbezeichnung, Kategorienamen, Keyphrase', () => {
    expect(maskeBody(p(FANMEET_FORCELOVE, 'BY284'))).toMatchObject({
      'Artikelkurzbezeichnung': 'BL-ForceLove', 'Artikelnummer': 'BY284/BL-ForceLove',
      'Kategorien': 'BoysLove (BL), Fanmeet', 'Fokus_Keyphrase': 'Force of Love Fluffy Hoodie', 'Versandklasse': 'grossbrief',
    });
  });
});

describe('Sheet-Plan', () => {
  const KOPF = ['Kategorienummer', 'Kategorien', 'Kategoriename', 'Instagram URL', 'TikTok URL', 'SEO_Hinweis'];
  const reiter = () => ({
    Erfassungsmaske: [['ID', 'Artikelnummer'], ['JFN-2026-0586', 'X/Y']],
    Varianten: [['SSOT-ID'], ['JFN-2026-0586']],
    Motive: [['Artikelkurzbezeichnung', 'Motiv', 'Druckposition', 'Druckfarben', 'Druckfarbe_je_Textilfarbe', 'Serie_Kontext', 'Nur_intern', 'Offen', 'Stand']],
    Struktur_Kategorien: [KOPF,
      ['320', 'BoysLove (BL)', 'BoysLove (BL)', '', '', 'Fanart von Fans für Fans. Keine Schauspieler:innen.'],
      ['444', 'BoysLove (BL) > Fanmeet Berlin', 'Fanmeet Berlin', 'https://insta', '', '']],
    SEO_Karte: [['Typ', 'Name', 'Pfad', 'Artikel', 'WC_ID', 'Oberkategorie', 'Soll_Keyphrase', 'Soll_Synonyme', 'Status', 'Stand', 'Notiz'],
      ['Kategorie', 'Fanmeet Berlin', 'BoysLove (BL) > Fanmeet Berlin', '', '444', 'BoysLove (BL)', '', '', 'entfernt', '', '']],
  });

  test('Struktur: Zeile 444 wird umgeschrieben (Instagram bleibt), Pfad Eltern > Name', () => {
    const sp = planeSheets(reiter(), plaene(FANMEET_TAYNEW), { kategorieId: 801, heute: '2026-10-28', k: FANMEET_TAYNEW });
    expect(sp.kategorie.zeile).toBe(3);
    expect(sp.kategorie.ersetzt[0]).toBe('444');
    expect(sp.kategorie.werte).toEqual(['801', 'BoysLove (BL) > Fanmeet', 'Fanmeet', 'https://insta', '', FANMEET_SEO_HINWEIS]);
  });

  test('Struktur: ohne tote Zeile -> anhaengen; Name schon da -> vorhanden', () => {
    const r = reiter(); r.Struktur_Kategorien.pop();
    expect(planeSheets(r, [], { kategorieId: 801, k: FANMEET_TAYNEW }).kategorie).toMatchObject({ zeile: 3 });
    const r2 = reiter(); r2.Struktur_Kategorien[2] = ['801', 'BoysLove (BL) > Fanmeet', 'Fanmeet', '', '', 'x'];
    expect(planeSheets(r2, [], { k: FANMEET_FORCELOVE }).kategorie).toEqual({ vorhanden: true });
  });

  test('SEO_Hinweis 320: alt/neu, nur geaendert, fehlende Kategorie = Fehler', () => {
    const sp = planeSheets(reiter(), [], { k: FANMEET_TAYNEW });
    expect(sp.hinweiseNeu).toHaveLength(1);
    expect(sp.hinweiseNeu[0]).toMatchObject({ nummer: '320', zeile: 2, gleich: false, neuHinweis: BOYSLOVE_SEO_HINWEIS });
    expect(sp.hinweiseNeu[0].neu).toEqual(['320', 'BoysLove (BL)', 'BoysLove (BL)', '', '', BOYSLOVE_SEO_HINWEIS]);
    const r = reiter(); r.Struktur_Kategorien[1][5] = BOYSLOVE_SEO_HINWEIS;
    expect(planeSheets(r, [], { k: FANMEET_TAYNEW }).hinweiseNeu[0].gleich).toBe(true);
    const r3 = reiter(); r3.Struktur_Kategorien.splice(1, 1);
    expect(planeSheets(r3, [], { k: FANMEET_TAYNEW }).hinweiseNeu[0].fehler).toMatch(/320/);
    expect(planeSheets(reiter(), [], { k: FANMEET_FORCELOVE }).hinweiseNeu).toEqual([]);
  });

  test('SEO_Karte: neue Zeile (entfernte 444 zaehlt nicht), Pfad, Oberkategorie, FM2-Notiz', () => {
    const sp = planeSheets(reiter(), [], { kategorieId: 801, heute: '2026-10-28', k: FANMEET_TAYNEW });
    expect(sp.karte.zeile).toBe(3);
    expect(sp.karte.werte).toEqual(['Kategorie', 'Fanmeet', 'BoysLove (BL) > Fanmeet', '', '801', 'BoysLove (BL)',
      'Tay New Fanart', 'TayNew Fanart, BL Fanmeet Shirts, Fanmeet Hoodies', 'Vorschlag', '2026-10-28', FANMEET_TAYNEW.karteNotiz]);
    expect(FANMEET_TAYNEW.karteNotiz).not.toMatch(/HW2/);
  });

  test('Halloween bleibt: Pfad = Name, alte Notiz', () => {
    const h = KOLLEKTIONEN.halloween;
    expect(karteZeile(['Pfad', 'Oberkategorie', 'Notiz'], 776, '', h)).toEqual(['Halloween', 'Halloween', 'HW2: vorbereitet, Yoast-Werte folgen']);
    expect(kategorieZeile(['Kategorien'], 776, h)).toEqual(['Halloween']);
  });

  test('Motive-Zeilen Z149/Z150 wie freigegeben, Nur_intern gesetzt', () => {
    const sp = planeSheets(reiter(), [], { heute: '2026-10-28', k: FANMEET_TAYNEW });
    expect(sp.motive.werte).toEqual(['BL-TayNew', FANMEET_TAYNEW.motivZeile.motiv, 'Front, Brust', 'vollfarbig', 'nein, fest',
      'BoysLove-Fanart', 'Fantreffen; Fanmeet; Berlin; 05.12.2026', '', '2026-10-28']);
    expect(motivZeile(reiter().Motive[0], '', FANMEET_FORCELOVE)[0]).toBe('BL-ForceLove');
  });
});

// ── Sheets ohne append ──────────────────────────────────────────────────────

/** Schein-Sheets: ein Reiter als Zeilen-Array, values.get/update/batchUpdate auf A1-Bereiche. */
function scheinSheets(tabs, { rowCount = 1000, nachUpdate } = {}) {
  const aufrufe = [];
  const parse = range => {
    const m = range.match(/^'([^']+)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/);
    const col = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
    return { tab: m[1], r0: m[3] ? +m[3] - 1 : 0, c0: m[2] ? col(m[2]) : 0, r1: m[5] ? +m[5] - 1 : null, c1: m[4] ? col(m[4]) : null };
  };
  const lesen = range => {
    const { tab, r0, c0, r1, c1 } = parse(range);
    const z = tabs[tab] ?? [];
    const bis = r1 ?? z.length - 1;
    const out = [];
    for (let r = r0; r <= bis; r++) out.push((z[r] ?? []).slice(c0, c1 == null ? undefined : c1 + 1));
    while (out.length && !out.at(-1).length) out.pop();
    return out;
  };
  const schreiben = (range, values) => {
    const { tab, r0, c0 } = parse(range);
    tabs[tab] ??= [];
    values.forEach((row, i) => {
      const z = (tabs[tab][r0 + i] ??= []);
      row.forEach((w, j) => { while (z.length < c0 + j) z.push(''); z[c0 + j] = w; });
    });
  };
  return {
    aufrufe,
    spreadsheets: {
      get: async () => ({ data: { sheets: Object.keys(tabs).map((t, i) => ({ properties: { title: t, sheetId: i, gridProperties: { rowCount } } })) } }),
      batchUpdate: async ({ requestBody }) => { aufrufe.push(['batchUpdate', requestBody.requests]); return {}; },
      values: {
        get: async ({ range }) => { aufrufe.push(['get', range]); return { data: { values: lesen(range) } }; },
        update: async ({ range, valueInputOption, requestBody }) => {
          aufrufe.push(['update', range, valueInputOption]); schreiben(range, requestBody.values); nachUpdate?.(tabs); return {};
        },
        batchUpdate: async ({ requestBody }) => {
          aufrufe.push(['vbatch', requestBody.data.map(d => d.range), requestBody.valueInputOption]);
          for (const d of requestBody.data) schreiben(d.range, d.values);
          nachUpdate?.(tabs);
          return {};
        },
        append: async () => { throw new Error('values.append ist verboten'); },
      },
    },
  };
}

describe('Sheets ohne values.append', () => {
  test('Quelltext: weder lib noch Skript rufen values.append', () => {
    for (const f of ['../lib/anlageHalloween.js', '../scripts/anlage-halloween.js']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/values\.append/);
    }
  });

  test('Hilfen: Spaltenbuchstaben, Wahrheitswerte, Abweichungen', () => {
    expect([0, 12, 25, 26, 79].map(spalteBuchstabe)).toEqual(['A', 'M', 'Z', 'AA', 'CB']);
    expect(zellText(true)).toBe('TRUE');
    expect(zellText(' x ')).toBe('x');
    expect(zeilenAbweichungen([['a', 1, true]], [['a', '1', 'TRUE']])).toEqual([]);
    expect(zeilenAbweichungen([['a', 'b']], [['a']])).toEqual([{ zeile: 0, spalte: 1, soll: 'b', ist: '' }]);
  });

  test('neue Zeilen unter die letzte belegte, RAW, zurueckgelesen', async () => {
    const tabs = { Varianten: [['SSOT-ID', 'Nr', 'Aktiv'], ['A', 1, true], [], ['B', 2, false]] };
    const s = scheinSheets(tabs);
    const start = await schreibeNeueZeilen(s, 'id', 'Varianten', [['C', 1, true], ['C', 2, true]]);
    expect(start).toBe(5);
    expect(tabs.Varianten.slice(4)).toEqual([['C', 1, true], ['C', 2, true]]);
    expect(s.aufrufe).toContainEqual(['update', "'Varianten'!A5:C6", 'RAW']);
    expect(s.aufrufe.some(a => a[0] === 'batchUpdate')).toBe(false);
  });

  test('zu kleines Raster -> Zeilen anhaengen per appendDimension (nicht values.append)', async () => {
    const tabs = { Motive: [['Kurz'], ['X']] };
    const s = scheinSheets(tabs, { rowCount: 2 });
    expect(await haengeZeileAn(s, 'id', 'Motive', ['BL-TayNew'])).toBe(3);
    expect(s.aufrufe.find(a => a[0] === 'batchUpdate')[1]).toEqual([{ appendDimension: { sheetId: 0, dimension: 'ROWS', length: 2 } }]);
  });

  test('Zielbereich nicht leer oder Nachbarzeile veraendert -> Fehler, nichts geschrieben', async () => {
    const tabs = { T: [['K'], ['X']] };
    const s = scheinSheets(tabs);
    const orig = s.spreadsheets.values.get;
    // Zwischen dem ersten Lesen und der Pruefung schreibt jemand in Zeile 3.
    let n = 0;
    s.spreadsheets.values.get = async a => { if (++n === 2) tabs.T[2] = ['fremd']; return orig(a); };
    await expect(schreibeNeueZeilen(s, 'id', 'T', [['neu']])).rejects.toThrow(/nicht leer/);
    expect(s.aufrufe.some(a => a[0] === 'update')).toBe(false);

    const tabs2 = { T: [['K'], ['X']] };
    const s2 = scheinSheets(tabs2);
    const orig2 = s2.spreadsheets.values.get;
    let m = 0;
    s2.spreadsheets.values.get = async a => { if (++m === 2) tabs2.T[1] = ['Y']; return orig2(a); };
    await expect(schreibeNeueZeilen(s2, 'id', 'T', [['neu']])).rejects.toThrow(/geändert/);
    expect(s2.aufrufe.some(a => a[0] === 'update')).toBe(false);
  });

  test('Ruecklesen weicht ab -> Fehler', async () => {
    const tabs = { T: [['K']] };
    const s = scheinSheets(tabs, { nachUpdate: t => { t.T[1][0] = 'anders'; } });
    await expect(schreibeNeueZeilen(s, 'id', 'T', [['neu']])).rejects.toThrow(/Rücklesen/);
  });

  test('Zeile ersetzen: nur geaenderte Zellen, alter Inhalt muss stimmen', async () => {
    const tabs = { S: [['Nr', 'Name', 'Insta', 'Hinweis'], ['444', 'Fanmeet Berlin', 'https://insta', '']] };
    const s = scheinSheets(tabs);
    const n = await ersetzeZeile(s, 'id', 'S', 2, ['444', 'Fanmeet Berlin', 'https://insta', ''], ['801', 'Fanmeet', 'https://insta', 'H']);
    expect(n).toBe(3);
    expect(tabs.S[1]).toEqual(['801', 'Fanmeet', 'https://insta', 'H']);
    expect(s.aufrufe.find(a => a[0] === 'vbatch')).toEqual(['vbatch', ["'S'!A2", "'S'!B2", "'S'!D2"], 'RAW']);
    expect(await ersetzeZeile(s, 'id', 'S', 2, tabs.S[1], tabs.S[1])).toBe(0);
    await expect(ersetzeZeile(s, 'id', 'S', 2, ['444', 'Fanmeet Berlin', '', ''], ['1', '', '', ''])).rejects.toThrow(/geändert/);
  });
});
