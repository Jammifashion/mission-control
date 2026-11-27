// ZW2 Teil D: Trefferliste am L-Shop-Feld (LShop_Modelle + SKU_Extern), "schon angelegt", "als Fremdware anlegen". Nur erfundene Daten.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const geschrieben = [];
jest.unstable_mockModule('../lib/sheet-zeilen.js', () => ({
  schreibeNeueZeilen: jest.fn(async (sheets, id, tab, zeilen, { alt }) => { geschrieben.push({ tab, zeilen, alt }); alt.push(...zeilen); return alt.length; }),
  pruefeZielStrecke: jest.fn(), ersetzeZeile: jest.fn(),
}));
jest.unstable_mockModule('../lib/lshop.js', () => ({
  ladeLShopZeilen: jest.fn(async () => [{ catalogNr: 'E3000' }]),
}));
jest.unstable_mockModule('../lib/lieferzeiten.js', () => ({ ladeLieferzeiten: jest.fn(async () => [{ id: '21' }, { id: '22' }]) }));

const X = await import('../utils/sku-extern.js');
const { legeExternAn } = await import('../lib/skuExtern.js');

const KOPF = ['ArticleNr', 'CatalogNr', 'Lieferant', 'Consistence', 'Description', 'Nur_intern', 'Lieferzeit_ID'];
function sheetsAttrappe(werte) {
  return { spreadsheets: { values: {
    get: jest.fn(async ({ range }) => {
      const m = range.match(/!A(\d+):ZZ(\d+)$/);
      return { data: { values: m ? werte.slice(Number(m[1]) - 1, Number(m[2])) : werte } };
    }),
  } } };
}

describe('sucheExtern', () => {
  const Z = [{ articleNr: 'TASSE-LENA', catalogNr: '', name: 'Tasse Lena weiß', lieferant: 'geheim' }, { articleNr: 'BEUTEL1', name: 'Jutebeutel' }];
  test('Nummer oder Name, ab 2 Zeichen, nie Lieferant', () => {
    expect(X.sucheExtern(Z, 'tasse').treffer).toEqual([{ nr: 'TASSE-LENA', catalogNr: '', name: 'Tasse Lena weiß' }]);
    expect(X.sucheExtern(Z, 'jute').treffer.map(t => t.nr)).toEqual(['BEUTEL1']);
    expect(X.sucheExtern(Z, 'x').treffer).toEqual([]);
    expect(JSON.stringify(X.sucheExtern(Z, 'tasse'))).not.toContain('geheim');
    expect(X.OPTIONAL_EXTERN).not.toHaveProperty('lieferant');
  });
});

describe('externNeuPruefen / legeExternAn', () => {
  test('Form: ohne Leerzeichen und ohne "/", Name Pflicht, Lieferzeit bekannt', () => {
    expect(X.externNeuPruefen({ articleNr: 'A B', name: 'Tasse' }).fehler).toMatch(/ohne Leerzeichen/);
    expect(X.externNeuPruefen({ articleNr: 'A/B', name: 'Tasse' }).fehler).toMatch(/„\/“/);
    expect(X.externNeuPruefen({ articleNr: 'AB', name: '' }).fehler).toMatch(/Name fehlt/);
    expect(X.externNeuPruefen({ articleNr: 'AB', name: 'Tasse', lieferzeitId: '99' }, { lieferzeiten: new Set(['21']) }).fehler).toMatch(/99/);
    expect(X.externNeuPruefen({ articleNr: 'AB', name: 'Tasse <b>', material: 'Keramik', lieferzeitId: '21' }).werte)
      .toEqual({ ArticleNr: 'AB', Description: 'Tasse b', Consistence: 'Keramik', Lieferzeit_ID: '21' });
  });

  test('legt EINE Zeile an (ueber den Spaltennamen, nicht append), Lieferant/Nur_intern bleiben leer', async () => {
    geschrieben.length = 0;
    const werte = [KOPF, ['ALT1', '', 'X', '', 'Alt', '', '']];
    const r = await legeExternAn({ eingabe: { articleNr: 'TASSE-LENA', name: 'Tasse Lena', material: 'Keramik', lieferzeitId: '21' },
      sheets: sheetsAttrappe(werte), spreadsheetId: 's' });
    expect(r).toEqual({ ok: true, nr: 'TASSE-LENA', zeile: 3 });
    expect(geschrieben).toHaveLength(1);
    expect(geschrieben[0].zeilen).toEqual([['TASSE-LENA', '', '', 'Keramik', 'Tasse Lena', '', '21']]);
  });

  test('schon in SKU_Extern oder L-Shop-Modell -> 409, nichts geschrieben', async () => {
    geschrieben.length = 0;
    await expect(legeExternAn({ eingabe: { articleNr: 'alt1', name: 'Doppelt' }, sheets: sheetsAttrappe([KOPF, ['ALT1']]), spreadsheetId: 's' }))
      .rejects.toMatchObject({ status: 409, code: 'schon_da' });
    await expect(legeExternAn({ eingabe: { articleNr: 'E3000', name: 'Shirt' }, sheets: sheetsAttrappe([KOPF]), spreadsheetId: 's' }))
      .rejects.toMatchObject({ status: 409, code: 'lshop' });
    expect(geschrieben).toEqual([]);
  });
});

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const FE = new Function(`${block('// ── Maske-Treffer: Anfang', '// ── Maske-Treffer: Ende ──')}\n return { maskeTreffer, schonAngelegtListe };`)();

describe('Maske: Trefferliste', () => {
  test('L-Shop und Fremdware mit Quelle; ausgelaufene nicht waehlbar', () => {
    const r = FE.maskeTreffer('tas', { modelle: [{ catalogNr: 'K100', bezeichnung: 'Tasse', marke: 'M', bestellbar: 1 }, { catalogNr: 'K9', bestellbar: 0 }] },
      { treffer: [{ nr: 'TASSE-LENA', name: 'Tasse Lena' }] });
    expect(r.map(e => [e.fett, e.rechts, !!e.aus])).toEqual([['K100', 'L-Shop', false], ['K9', 'L-Shop · nur ausgelaufene', true], ['TASSE-LENA', 'Fremdware', false]]);
  });
  test('kein Treffer: sichtbar "noch nicht bekannt" + zwei Aktionszeilen am Ende, nie stilles Nichts', () => {
    const r = FE.maskeTreffer('Zauberhut', { modelle: [] }, { treffer: [] });
    expect(r.map(e => e.haupt)).toEqual(['„Zauberhut“ noch nicht bekannt', 'L-Shop-Modell aufnehmen …', 'als Fremdware anlegen …']);
    expect(r.slice(1).map(e => e.aktion)).toEqual(['lsm', 'extern']);
  });
  test('schon angelegt nur mit Produkt-ID', () => {
    expect(FE.schonAngelegtListe([{ produktId: '123' }, { produktId: '' }, { produktId: 'x' }])).toEqual([{ produktId: '123' }]);
  });
  test('Verdrahtung: twBinden am Feld, Dialog mit ⓘ und Mouse-over, eigene Zeile ausgenommen', () => {
    expect(html).toContain("twBinden(pfLshopFeld, document.getElementById('pf-lshop-treffer')");
    expect(html).toMatch(/id="ex-dialog"[\s\S]{0,400}data-hilfe-gruppe="fremdware"/);
    for (const k of ['ex-anlegen', 'pf-lshop-suche', 'pf-schon-angelegt']) expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
    expect(html).toContain('.filter(t => t.ssotId !== eigene)');
    expect(html).not.toMatch(/<datalist[^>]*pf-lshop/);
  });
});
