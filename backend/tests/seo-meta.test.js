// SEO-Titel und Meta-Beschreibung fuer Yoast - deterministisch, ohne Modell.
//
// Drei Ebenen, wie bei sku.test.js:
//  1. backend/lib/seo-meta.js - die Regeln selbst
//  2. der Block "SEO-Meta" in index.html - muss dieselben Ergebnisse liefern
//  3. die Seitenanbindung im SEO-Reiter - Schreibweg, Haekchen, Toast
//
// ⚠️ GEMESSEN (M1, 23.09.): "<Keyphrase> %%sep%% %%sitename%%" in
// _yoast_wpseo_title wird von Yoast zu "... | JammiFashion" aufgeloest. Die
// Platzhalter stehen darum WOERTLICH im Titel.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';

import {
  META_MAX, zeichenLaenge, baueSeoTitel, farbenText, groessenSpanne,
  lieferzeitAusMeta, baueMetaBeschreibung, yoastEntscheidung,
  grammaturAusEigenschaften, metaEingaben,
} from '../lib/seo-meta.js';
import seoMetaRouter from '../routes/seo-meta.js';

const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8',
);

// ── Frontend-Block herausschneiden und AUSFUEHREN ───────────────────────────
const START = '// ── SEO-Meta: Anfang';
const ENDE  = '// ── SEO-Meta: Ende ──';
const von   = html.indexOf(START);
const bis   = html.indexOf(ENDE);
const block = html.slice(von, bis);

const fe = new Function(`${block}
  return { seoMetaLaenge, seoMetaTitel, seoMetaFarbenText, seoMetaGroessenSpanne,
           seoMetaLieferzeit, seoMetaBeschreibung, seoMetaEntscheidung };`)();

// Beide Seiten muessen dasselbe liefern - jeder Fall laeuft durch beide.
function beide(e) {
  const b = baueMetaBeschreibung(e);
  expect(fe.seoMetaBeschreibung(e)).toEqual(b);
  return b;
}

const SKYLINE = {
  keyphrase:   'Crocodiles Hamburg Skyline Hoodie Herren',
  farben:      ['Schwarz'],
  faserangabe: '80 % Baumwolle / 20 % Polyester',
  grammatur:   '280 g/m²',
  groessen:    ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'],
  lieferzeit:  '21',
};
const SKYLINE_TEXT =
  'Crocodiles Hamburg Skyline Hoodie Herren in Schwarz, 80 % Baumwolle / 20 % Polyester, '
  + '280 g/m². Größen XS bis 4XL, gedruckt nach Bestellung in Wrist.';

test('der Block wurde gefunden und benutzt nichts aus dem Seitenkontext', () => {
  expect(von).toBeGreaterThan(-1);
  expect(bis).toBeGreaterThan(von);
  expect(block).not.toMatch(/document\.|apiFetch|showToast|seoCurrentItem|seoVarianten|seoWcProdukt/);
});

// ── Titel ───────────────────────────────────────────────────────────────────
describe('SEO-Titel', () => {
  test('enthaelt %%sep%% und %%sitename%% woertlich', () => {
    const t = baueSeoTitel('Crocodiles Hamburg Skyline Hoodie Herren');
    expect(t).toBe('Crocodiles Hamburg Skyline Hoodie Herren %%sep%% %%sitename%%');
    expect(t).toContain('%%sep%%');
    expect(t).toContain('%%sitename%%');
    expect(t).not.toContain('|');
    expect(t).not.toContain('JammiFashion');
    expect(fe.seoMetaTitel('Crocodiles Hamburg Skyline Hoodie Herren')).toBe(t);
  });

  test('leere Keyphrase -> kein Titel (Yoast-Vorlage greift)', () => {
    for (const leer of ['', '   ', null, undefined]) {
      expect(baueSeoTitel(leer)).toBeNull();
      expect(fe.seoMetaTitel(leer)).toBeNull();
    }
  });
});

// ── Meta-Beschreibung ───────────────────────────────────────────────────────
describe('Meta-Beschreibung: Grundform', () => {
  test('Skyline Hoodie Herren - exakt, mit echtem Umlaut und ß', () => {
    const r = beide(SKYLINE);
    expect(r.text).toBe(SKYLINE_TEXT);
    expect(r.schreiben).toBe(true);
    expect(r.weggelassen).toEqual([]);
    expect(r.hinweise).toEqual([]);
    expect(r.laenge).toBe([...SKYLINE_TEXT].length);
  });

  test('Zeichen, nicht Bytes: ² und ö zaehlen je 1', () => {
    expect(zeichenLaenge('g/m²')).toBe(4);
    expect(zeichenLaenge('Größe')).toBe(5);
    expect(Buffer.byteLength('Größe')).toBe(7);
    expect(fe.seoMetaLaenge('Größe')).toBe(5);
  });

  test('leere Keyphrase -> keine Meta-Beschreibung', () => {
    const r = beide({ ...SKYLINE, keyphrase: '  ' });
    expect(r.text).toBeNull();
    expect(r.schreiben).toBe(false);
    expect(r.hinweise.join(' ')).toMatch(/Keine Fokus-Keyphrase/);
  });
});

describe('Farben in Shop-Schreibweise', () => {
  const mit = farben => beide({ ...SKYLINE, farben }).text;

  test('eine Farbe', () => {
    expect(farbenText(['Schwarz'])).toBe('in Schwarz');
    expect(mit(['Schwarz'])).toMatch(/^Crocodiles Hamburg Skyline Hoodie Herren in Schwarz, 80 %/);
  });
  test('zwei Farben', () => {
    expect(farbenText(['Pink', 'Schwarz'])).toBe('in Pink und Schwarz');
    expect(mit(['Pink', 'Schwarz'])).toMatch(/Herren in Pink und Schwarz, 80 %/);
  });
  test('drei Farben', () => {
    expect(farbenText(['Navy', 'Pink', 'Schwarz'])).toBe('in Navy, Pink und Schwarz');
    expect(mit(['Navy', 'Pink', 'Schwarz'])).toMatch(/Herren in Navy, Pink und Schwarz, 80 %/);
  });
  test('vier Farben -> Anzahl', () => {
    expect(farbenText(['Navy', 'Pink', 'Schwarz', 'Weiß'])).toBe('in 4 Farben');
    expect(mit(['Navy', 'Pink', 'Schwarz', 'Weiß'])).toMatch(/Herren in 4 Farben, 80 %/);
  });
  test('Dubletten zaehlen einmal, keine Farben -> Teil faellt ohne Restzeichen', () => {
    expect(farbenText(['Schwarz', 'schwarz', ' '])).toBe('in Schwarz');
    expect(mit([])).toBe(
      'Crocodiles Hamburg Skyline Hoodie Herren, 80 % Baumwolle / 20 % Polyester, 280 g/m². '
      + 'Größen XS bis 4XL, gedruckt nach Bestellung in Wrist.');
  });
  test('Frontend zaehlt gleich', () => {
    for (const f of [[], ['A'], ['A', 'B'], ['A', 'B', 'C'], ['A', 'B', 'C', 'D', 'E']]) {
      expect(fe.seoMetaFarbenText(f)).toBe(farbenText(f));
    }
  });
});

describe('Weglassen und Satzzeichen', () => {
  test('ohne Groessen', () => {
    const r = beide({ ...SKYLINE, groessen: [] });
    expect(r.text).toBe(
      'Crocodiles Hamburg Skyline Hoodie Herren in Schwarz, 80 % Baumwolle / 20 % Polyester, '
      + '280 g/m². Gedruckt nach Bestellung in Wrist.');
    expect(r.schreiben).toBe(true);
  });

  test('ohne Faserangabe', () => {
    const r = beide({ ...SKYLINE, faserangabe: '' });
    expect(r.text).toBe(
      'Crocodiles Hamburg Skyline Hoodie Herren in Schwarz, 280 g/m². '
      + 'Größen XS bis 4XL, gedruckt nach Bestellung in Wrist.');
    expect(r.hinweise.join(' ')).toMatch(/Keine Faserangabe/);
  });

  test('Nachbedingung schlaegt an -> Faserangabe weg, Meldung im Hinweis', () => {
    const r = beide({ ...SKYLINE, faserMeldung: 'keine vollständige Faserangabe' });
    expect(r.text).not.toMatch(/Baumwolle/);
    expect(r.text).toMatch(/^Crocodiles Hamburg Skyline Hoodie Herren in Schwarz, 280 g\/m²\. /);
    expect(r.hinweise.join(' ')).toMatch(/Faserangabe weggelassen/);
  });

  test('_lieferzeit 22 -> ohne Wrist-Satz, mit Hinweis', () => {
    const r = beide({ ...SKYLINE, lieferzeit: '22' });
    expect(r.text).toBe(
      'Crocodiles Hamburg Skyline Hoodie Herren in Schwarz, 80 % Baumwolle / 20 % Polyester, '
      + '280 g/m². Größen XS bis 4XL.');
    expect(r.text).not.toMatch(/Wrist/);
    expect(r.hinweise.join(' ')).toMatch(/_lieferzeit ist "22"/);
  });

  test('_lieferzeit 20, 666, unlesbar -> ohne Wrist-Satz', () => {
    for (const lz of ['20', '666', null, undefined, '']) {
      const r = beide({ ...SKYLINE, lieferzeit: lz });
      expect(r.text).not.toMatch(/Wrist/);
      expect(r.hinweise.some(h => /_lieferzeit/.test(h))).toBe(true);
    }
  });

  test('alles weg bis auf Keyphrase: ein sauberer Satz, kein ", ."', () => {
    const r = beide({ keyphrase: 'crocodiles Mütze', lieferzeit: '22' });
    expect(r.text).toBe('Crocodiles Mütze.');
  });

  test('nichts ausser Wrist im zweiten Satz: grosser Satzanfang', () => {
    const r = beide({ keyphrase: 'Crocodiles Schal', faserangabe: '100 % Acryl', lieferzeit: '21' });
    expect(r.text).toBe('Crocodiles Schal, 100 % Acryl. Gedruckt nach Bestellung in Wrist.');
  });

  test('nirgends ", ." oder ",," oder doppelte Leerzeichen', () => {
    const faelle = [
      SKYLINE, { ...SKYLINE, farben: [] }, { ...SKYLINE, faserangabe: '' },
      { ...SKYLINE, grammatur: '' }, { ...SKYLINE, groessen: [] }, { ...SKYLINE, lieferzeit: '20' },
      { keyphrase: 'X', grammatur: '200 g/m².', faserangabe: '100 % Baumwolle.' },
    ];
    for (const f of faelle) {
      const t = beide(f).text;
      expect(t).not.toMatch(/,\s*\.|,,|\.\.|\s{2,}|\s[,.]/);
      expect(t).toMatch(/\.$/);
    }
  });
});

describe('Groessenspanne', () => {
  test('kleinste und groesste, unabhaengig von der Reihenfolge', () => {
    expect(groessenSpanne(['XL', 'S', '4XL', 'XS', 'M']).text).toBe('Größen XS bis 4XL');
    expect(groessenSpanne(['XXL', 'L', 'S']).text).toBe('Größen S bis XXL');
    expect(groessenSpanne(['3XL', 'XXL']).text).toBe('Größen XXL bis 3XL');
    expect(groessenSpanne(['128', '104', '116']).text).toBe('Größen 104 bis 128');
  });
  test('Kindergroessen mit Schraegstrich, auch ungeordnet', () => {
    const kinder = ['110/116', '122/128', '134/140', '146/152', '158/164'];
    expect(groessenSpanne(kinder)).toEqual({ text: 'Größen 110/116 bis 158/164', hinweis: null });
    expect(groessenSpanne(['146/152', '110/116', '158/164', '122/128', '134/140']).text)
      .toBe('Größen 110/116 bis 158/164');
    expect(fe.seoMetaGroessenSpanne(kinder)).toEqual(groessenSpanne(kinder));
  });
  test('XS bis 5XL, gemischt geordnet und XXL neben 3XL', () => {
    const g = ['XL', '5XL', 'S', 'XS', '3XL', 'M', 'XXL', 'L', '4XL'];
    expect(groessenSpanne(g)).toEqual({ text: 'Größen XS bis 5XL', hinweis: null });
    expect(fe.seoMetaGroessenSpanne(g)).toEqual(groessenSpanne(g));
  });
  test('eine Groesse', () => {
    expect(groessenSpanne(['M']).text).toBe('Größe M');
  });
  test('nicht sortierbar -> weggelassen mit Hinweis', () => {
    const r = groessenSpanne(['One Size']);
    expect(r.text).toBeNull();
    expect(r.hinweis).toMatch(/nicht sortierbar/);
    expect(groessenSpanne(['S', '116']).text).toBeNull();
  });
  test('Frontend sortiert gleich', () => {
    for (const g of [[], ['M'], ['XL', 'S', '4XL', 'XS'], ['128', '104'], ['One Size'], ['S', '116'], ['2XS', 'XXS', 'L']]) {
      expect(fe.seoMetaGroessenSpanne(g)).toEqual(groessenSpanne(g));
    }
  });
});

// ── Laenge und Kuerzen ──────────────────────────────────────────────────────
describe('hoechstens 160 Zeichen, Kuerzen in fester Reihenfolge', () => {
  // Keyphrase so auffuellen, dass die volle Form genau `ziel` Zeichen hat.
  function mitLaenge(ziel, basis = SKYLINE) {
    const ohne = zeichenLaenge(baueMetaBeschreibung({ ...basis, keyphrase: 'K' }).text) - 1;
    const k = 'K' + 'x'.repeat(ziel - ohne - 1);
    const e = { ...basis, keyphrase: k };
    expect(zeichenLaenge(baueMetaBeschreibung({ ...e, grammatur: e.grammatur }).text)).toBeGreaterThan(0);
    return e;
  }

  test('genau 160 -> nichts faellt', () => {
    const r = beide(mitLaenge(160));
    expect(r.laenge).toBe(160);
    expect(r.weggelassen).toEqual([]);
    expect(r.schreiben).toBe(true);
  });

  test('161 -> Grammatur faellt, Groessen und Wrist bleiben', () => {
    const e = mitLaenge(161);
    // Gegenprobe: ungekuerzt waeren es wirklich 161
    const voll = [...`${e.keyphrase} in Schwarz, 80 % Baumwolle / 20 % Polyester, 280 g/m². Größen XS bis 4XL, gedruckt nach Bestellung in Wrist.`].length;
    expect(voll).toBe(161);
    const r = beide(e);
    expect(r.weggelassen).toEqual(['Grammatur']);
    expect(r.text).not.toMatch(/g\/m²/);
    expect(r.text).toMatch(/Größen XS bis 4XL, gedruckt nach Bestellung in Wrist\.$/);
    expect(r.laenge).toBeLessThanOrEqual(META_MAX);
    expect(r.schreiben).toBe(true);
  });

  test('ohne Grammatur noch zu lang -> Groessen fallen, Wrist bleibt', () => {
    // ", 280 g/m²" sind 10 Zeichen: bei 171 reicht das Weglassen nicht.
    const r = beide(mitLaenge(171));
    expect(r.weggelassen).toEqual(['Grammatur', 'Größenspanne']);
    expect(r.text).not.toMatch(/Größen/);
    expect(r.text).toMatch(/\. Gedruckt nach Bestellung in Wrist\.$/);
    expect(r.laenge).toBeLessThanOrEqual(META_MAX);
    expect(r.schreiben).toBe(true);
  });

  test('immer noch zu lang -> NICHT schreiben, Hinweis mit Laenge, nie abgeschnitten', () => {
    const e = mitLaenge(220);
    const r = beide(e);
    expect(r.schreiben).toBe(false);
    expect(r.weggelassen).toEqual(['Grammatur', 'Größenspanne']);
    expect(r.hinweise.join(' ')).toMatch(new RegExp(`${r.laenge} Zeichen`));
    expect(r.laenge).toBeGreaterThan(META_MAX);
    // nie mitten im Wort: die ganze Keyphrase steht drin, der Satz ist vollstaendig
    expect(r.text.startsWith(e.keyphrase)).toBe(true);
    expect(r.text).toMatch(/gedruckt nach Bestellung in Wrist\.$/i);
  });

  test('Kuerzen nur, was da ist: ohne Grammatur faellt direkt die Groessenspanne', () => {
    const e = { ...mitLaenge(171), grammatur: '' };
    const r = beide(e);
    expect(r.weggelassen).toEqual(['Größenspanne']);
  });
});

// ── Vorhandene Werte ────────────────────────────────────────────────────────
describe('vorhandene Yoast-Werte', () => {
  const faelle = [
    [{ neu: 'Neu', vorhanden: '' },                              'schreiben'],
    [{ neu: 'Neu', vorhanden: '   ' },                           'schreiben'],
    [{ neu: 'Neu', vorhanden: 'Neu' },                           'unveraendert'],
    [{ neu: 'Neu', vorhanden: 'Alt, von Hand gepflegt' },        'behalten'],
    [{ neu: 'Neu', vorhanden: 'Alt', ueberschreiben: false },    'behalten'],
    [{ neu: 'Neu', vorhanden: 'Alt', ueberschreiben: true },     'schreiben'],
    [{ neu: null,  vorhanden: 'Alt', ueberschreiben: true },     'kein-wert'],
    [{ neu: '',    vorhanden: '' },                              'kein-wert'],
  ];
  test.each(faelle)('%j -> %s', (e, aktion) => {
    expect(yoastEntscheidung(e).aktion).toBe(aktion);
    expect(fe.seoMetaEntscheidung(e).aktion).toBe(aktion);
  });
  test('abweichender Wert wird ohne Haekchen nicht ueberschrieben', () => {
    expect(yoastEntscheidung({ neu: SKYLINE_TEXT, vorhanden: 'Alt' }).aktion).toBe('behalten');
  });
  test('Haekchen gesetzt -> ueberschrieben', () => {
    expect(yoastEntscheidung({ neu: SKYLINE_TEXT, vorhanden: 'Alt', ueberschreiben: true }).aktion)
      .toBe('schreiben');
  });
});

// ── _lieferzeit ─────────────────────────────────────────────────────────────
describe('_lieferzeit aus meta_data', () => {
  test('Rohwert, getrimmt; Zahl wird Zeichenkette', () => {
    expect(lieferzeitAusMeta([{ key: '_lieferzeit', value: '21' }])).toBe('21');
    expect(lieferzeitAusMeta([{ key: '_lieferzeit', value: 21 }])).toBe('21');
    expect(lieferzeitAusMeta([{ key: '_lieferzeit', value: ' 22 ' }])).toBe('22');
  });
  test('fehlt, leer oder unerwartete Form -> null (unlesbar)', () => {
    for (const m of [undefined, [], [{ key: 'x', value: '21' }], [{ key: '_lieferzeit', value: '' }],
                     [{ key: '_lieferzeit', value: ['21'] }], [{ key: '_lieferzeit', value: null }]]) {
      expect(lieferzeitAusMeta(m)).toBeNull();
      expect(fe.seoMetaLieferzeit(m)).toBeNull();
    }
  });
});

// ── Eingaben aus dem Eigenschaften-Freitext (nur Backend) ───────────────────
describe('Faserangabe NACH filterMaterialFarben, Grammatur', () => {
  const EIG = 'Material: 80 % Baumwolle / 20 % Polyester\nGrammatur: 280 g/m²\nSchnitt: Regular Fit';

  test('Skyline: Faserangabe unveraendert, Grammatur ueber das Label', () => {
    expect(metaEingaben({ eigenschaften: EIG, farben: ['Schwarz'] })).toEqual({
      faserangabe: '80 % Baumwolle / 20 % Polyester', faserMeldung: null, grammatur: '280 g/m²',
    });
  });

  test('Ende zu Ende: Eigenschaften -> exakte Skyline-Beschreibung', () => {
    const ein = metaEingaben({ eigenschaften: EIG, farben: ['Schwarz'] });
    expect(beide({ ...SKYLINE, ...ein }).text).toBe(SKYLINE_TEXT);
  });

  test('der Materialfilter greift: Ausnahme einer nicht angebotenen Farbe faellt', () => {
    const ein = metaEingaben({
      eigenschaften: 'Material: 100 % Baumwolle (Grau meliert: 90 % Baumwolle, 10 % Viskose)',
      farben: ['Schwarz'],
    });
    expect(ein.faserangabe).toBe('100 % Baumwolle');
  });

  test('kein Material -> keine Faserangabe (kein Platzhalter in der Beschreibung)', () => {
    const ein = metaEingaben({ eigenschaften: 'Grammatur: 280 g/m²', farben: ['Schwarz'] });
    expect(ein.faserangabe).toBeNull();
    expect(beide({ ...SKYLINE, ...ein }).text).not.toMatch(/bitte ergänzen|\[/);
  });

  test('Grammatur nur ueber das Label', () => {
    expect(grammaturAusEigenschaften('Stoffgewicht: 180 g/m²')).toBe('180 g/m²');
    expect(grammaturAusEigenschaften('Schwerer Stoff mit 280 g')).toBeNull();
    expect(grammaturAusEigenschaften('')).toBeNull();
  });

  test('Route POST /api/seo/meta-eingaben liefert dasselbe', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/seo', seoMetaRouter);
    const res = await request(app).post('/api/seo/meta-eingaben')
      .send({ eigenschaften: EIG, farben: ['Schwarz'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(metaEingaben({ eigenschaften: EIG, farben: ['Schwarz'] }));
  });
});

// ── Seitenanbindung im SEO-Reiter ───────────────────────────────────────────
describe('Frontend: Vorschau und Schreibweg', () => {
  const saveStart = html.indexOf("document.getElementById('btn-seo-save').addEventListener");
  const saveBlock = html.slice(saveStart, html.indexOf('// ── Bestehende Varianten', saveStart));
  const glueStart = html.indexOf('// ── SEO-Meta: Seitenanbindung');
  const glue      = html.slice(glueStart, html.indexOf('const modeBtnNew', glueStart));

  test('Titel und Meta-Beschreibung gehen in denselben meta_data-Body', () => {
    expect(saveBlock).toMatch(/yoastMeta\.push\(\{ key: '_yoast_wpseo_title',\s*value: metaStand\.titel\.wert \}\)/);
    expect(saveBlock).toMatch(/yoastMeta\.push\(\{ key: '_yoast_wpseo_metadesc',\s*value: metaStand\.desc\.wert \}\)/);
    // Seit SE1 ueber den gemeinsamen Schreibweg yoastSchreiben().
    expect(saveBlock).toMatch(/await yoastSchreiben\(seoCurrentItem\.wcId, yoastMeta\)/);
    expect(html).toMatch(/async function yoastSchreiben\(wcId, yoastMeta\)[\s\S]*?body:\s*JSON\.stringify\(\{\s*meta_data:\s*yoastMeta\s*\}\)/);
  });

  test('geschrieben wird nur bei aktion === "schreiben"', () => {
    expect(saveBlock).toMatch(/if \(metaStand\.titel\.aktion === 'schreiben'\)/);
    expect(saveBlock).toMatch(/if \(metaStand\.desc\.aktion === 'schreiben'\)/);
  });

  test('Haekchen "ueberschreiben" ist standardmaessig aus und wird je Artikel zurueckgesetzt', () => {
    expect(html).toMatch(/<input type="checkbox" id="seo-meta-titel-ueber" \/>/);
    expect(html).toMatch(/<input type="checkbox" id="seo-meta-desc-ueber" \/>/);
    expect(html).toMatch(/getElementById\('seo-meta-titel-ueber'\)\.checked = false/);
    expect(html).toMatch(/getElementById\('seo-meta-desc-ueber'\)\.checked  = false/);
    expect(glue).toMatch(/ueberschreiben: document\.getElementById\('seo-meta-titel-ueber'\)\.checked/);
    expect(glue).toMatch(/ueberschreiben: document\.getElementById\('seo-meta-desc-ueber'\)\.checked/);
  });

  test('Vorschau zeigt Zeichenzahl, Gekuerztes und "vorhandener Wert bleibt"', () => {
    expect(glue).toMatch(/Zeichen/);
    expect(glue).toMatch(/gekürzt: .*weggelassen/);
    expect(glue).toMatch(/Vorhandener Wert bleibt/);
  });

  test('ohne lesbares Shop-Produkt wird nichts ueberschrieben', () => {
    expect(glue).toMatch(/Shop-Produkt nicht lesbar, vorhandener Wert unbekannt/);
  });

  test('Rueckmeldung geschrieben / unveraendert / nicht geschrieben geht in den Toast', () => {
    expect(saveBlock).toMatch(/: geschrieben/);
    expect(saveBlock).toMatch(/: unverändert/);
    expect(saveBlock).toMatch(/: nicht geschrieben – /);
    // metaMeldung haengt an yoastText, und yoastText geht in den Toast
    expect(saveBlock).toMatch(/metaMeldung\('SEO-Titel'/);
    expect(saveBlock).toMatch(/metaMeldung\('Meta-Beschreibung'/);
    expect(saveBlock).toMatch(/showToast\(\s*\[[^\]]*yoastText\s*\]/);
    expect(saveBlock.indexOf("metaMeldung('SEO-Titel'"))
      .toBeLessThan(saveBlock.indexOf('showToast('));
  });

  test('kein Sprachmodell: weder seo-text noch agent-intern noch generate-product', () => {
    for (const teil of [block, glue]) {
      expect(teil).not.toMatch(/generate-product|seo-text|agent-intern|\/api\/claude/);
    }
    const lib = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../lib/seo-meta.js'), 'utf8');
    expect(lib).not.toMatch(/getModel|anthropic|gemini|modelConfig/i);
  });
});
