// AMQ1: Nachbesserungen Auftragsmanagement. Nur ERFUNDENE Daten und Betraege.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { nettoAusBrutto, bruttoAusNetto, auftragSummen, euroZahl, cent, UST_SAETZE } from '../utils/auftrag-preise.js';
import {
  TAB_AUFTRAEGE, TAB_POSITIONEN, AUFTRAG_SPALTEN, POSITION_SPALTEN, POSITION_OPTIONAL, AUFTRAG_OPTIONAL,
  anlagePlan, bearbeitenPlan, pruefeKopf, designLinkAus, preisFelder,
} from '../utils/auftraege.js';
import { TAB_AUFGABEN, AUFGABE_SPALTEN } from '../utils/aufgaben.js';
import { legeAuftragAn, bearbeiteAuftrag, wechsleStatus, _auftraegeCacheLeeren } from '../lib/auftraege.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { _lieferbarkeitCacheLeeren } from '../lib/lieferbarkeitLesen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const JETZT = '2026-11-06T10:00:00.000Z';
const jetzt = () => new Date(JETZT);
const kundeOk = async () => {};
const NR = '9000000120';

function tabs({ auftraege = [], positionen = [], mitSpalten = true } = {}) {
  const AS = mitSpalten ? [...AUFTRAG_SPALTEN, ...AUFTRAG_OPTIONAL] : [...AUFTRAG_SPALTEN, 'Design_Am'];
  const PS = [...POSITION_SPALTEN, ...POSITION_OPTIONAL];
  return {
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description', '10CartonsPrice', 'Quelle_Datum'],
      [NR, 'X3000', 'Black', '', 'M', '', '', 'Erfunden', '', '0', 'aktiv', 'Muster-Shirt', 4.1, '01.11.2026']],
    [TAB_AUFTRAEGE]: [AS, ...auftraege.map(o => AS.map(s => o[s] ?? ''))],
    [TAB_POSITIONEN]: [PS, ...positionen.map(o => PS.map(s => o[s] ?? ''))],
    [TAB_AUFGABEN]: [AUFGABE_SPALTEN],
  };
}
const spalte = (t, tab, s) => t[tab][0].indexOf(s);
const auftrag = (extra = {}) => ({ Auftrag_Nr: 'AU-2026-0001', Kunden_Nr: 'K-00001', Kurztitel: 'Test', Status: 'Anfrage', Anfrage_Am: '2026-11-01', Stand: 'S1', ...extra });

beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot-test'; _auftraegeCacheLeeren(); _resetLShopCache(); _lieferbarkeitCacheLeeren(); });

describe('6. Brutto-Eingabe -> Netto exakt', () => {
  test('jeder Bruttobetrag 0,01–300,00 € kommt bei 19/7/0 % genau zurueck (auch die, die mit Cent-Netto nicht gehen)', () => {
    for (const ust of UST_SAETZE) {
      for (let c = 1; c <= 30000; c++) {
        const b = c / 100;
        expect([ust, b, bruttoAusNetto(nettoAusBrutto(b, ust), ust)]).toEqual([ust, b, b]);
      }
    }
    expect(nettoAusBrutto(12, 7)).toBe(11.215);   // 12,00 € bei 7 % ging mit Cent-Netto nicht
    expect(nettoAusBrutto(29.9, 19)).toBe(25.1261);
  });
  test('Summe: eine Position 1 Stueck = genau der eingetippte Bruttopreis; mit Aufpreis und Rabatt netto-basiert', () => {
    for (const [b, ust] of [[29.9, 19], [1.1, 19], [12, 7], [5, 0], [7.3, 19]]) {
      const s = auftragSummen([{ art: 'frei', menge: 1, preis: nettoAusBrutto(b, ust), ust }]);
      expect([b, ust, s.brutto]).toEqual([b, ust, Math.round(b * 100)]);
    }
    const lshop = { art: 'lshop', menge: 1, groesse: '3XL', preis: nettoAusBrutto(24.9, 19), aufpreis: nettoAusBrutto(3, 19), aufpreisAb: '3XL', ust: 19 };
    expect(auftragSummen([lshop]).brutto).toBe(2790);   // 24,90 + 3,00
    const r = auftragSummen([{ art: 'frei', menge: 2, preis: nettoAusBrutto(29.9, 19), ust: 19 }], { art: '%', wert: 10 });
    expect(r.rabatt).toBe(Math.round(r.netto * 0.1));
    expect(r.brutto).toBe(r.nettoNach + r.mwst[0].betrag);
  });
  test('Speichern: Netto mit bis zu 4 Stellen als Zahl; unberuehrter Wert (Umschalten) = unveraendert', () => {
    expect(preisFelder({ preis: nettoAusBrutto(29.9, 19), ust: 19 }, 'frei', 1).Preis_Netto).toBe(25.1261);
    expect(euroZahl('25.1261')).toBe(25.1261);
    expect(cent(25.1261)).toBe(2512.61);
    const a = auftrag();
    const pos = [{ Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'frei', Freitext: 'Tassen', Menge: '2', Preis_Netto: '25.1261', USt_Satz: '', Herkunft: '', _zeile: 2 }];
    const plan = bearbeitenPlan({ auftrag: a, positionen: pos, jetzt: JETZT, eingabe: { Kurztitel: 'Test', Kunden_Nr: 'K-00001', Preis_Eingabe: 'brutto',
      positionen: [{ positionId: 'AU-2026-0001-01', art: 'frei', freitext: 'Tassen', menge: 2, preis: 25.1261, ust: '19' }] } });
    expect(plan.aenderungPositionen).toEqual([]);
    expect(plan.aenderungAuftrag).toMatchObject({ Preis_Eingabe: 'brutto' });
  });
  test('Preis_Eingabe: brutto -> "brutto", netto -> leer, anderes -> 422; ohne Spalte nur netto (409)', async () => {
    expect(pruefeKopf({ Preis_Eingabe: 'brutto' })).toEqual({ Preis_Eingabe: 'brutto' });
    expect(pruefeKopf({ Preis_Eingabe: 'netto' })).toEqual({ Preis_Eingabe: '' });
    expect(() => pruefeKopf({ Preis_Eingabe: 'mix' })).toThrow(/netto oder brutto/);
    const t = tabs({ mitSpalten: false });
    const { sheets } = machSheets(t);
    await expect(legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kunden_Nr: 'K-00001', Kurztitel: 'X', vorgang: 'vorgang-amq1-0001', Preis_Eingabe: 'brutto', positionen: [] } }))
      .rejects.toMatchObject({ status: 409 });
    const r = await legeAuftragAn({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { Kunden_Nr: 'K-00001', Kurztitel: 'X', vorgang: 'vorgang-amq1-0002', Preis_Eingabe: 'netto', positionen: [] } });
    expect(r.auftragNr).toBe('AU-2026-0001');
  });
});

describe('3. Positionen erst ab "bestellt" Pflicht', () => {
  test('Anlegen ohne Position: Anfrage und Angebot; Bearbeiten: alle entfernen geht', () => {
    for (const status of ['Anfrage', 'Angebot']) {
      const p = anlagePlan({ auftraege: [], positionen: [], jetzt: JETZT, eingabe: { Kunden_Nr: 'K-00001', Kurztitel: 'X', status, positionen: [] } });
      expect([status, p.positionen]).toEqual([status, []]);
    }
    const pos = [{ Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'frei', Freitext: 'Tassen', Menge: '2', _zeile: 2 }];
    const plan = bearbeitenPlan({ auftrag: auftrag(), positionen: pos, jetzt: JETZT, eingabe: { Kurztitel: 'Test', Kunden_Nr: 'K-00001', positionen: [] } });
    expect(plan.aenderungPositionen[0].felder).toMatchObject({ Entfernt: '2026-11-06' });
  });
  test('Wechsel auf "bestellt" ohne Position -> 422 ohne_positionen, nichts geschrieben; mit Position geht es', async () => {
    const t = tabs({ auftraege: [auftrag({ Status: 'Angebot', Angebot_Am: '2026-11-02' })] });
    const { sheets } = machSheets(t);
    const vorher = JSON.stringify(t[TAB_AUFTRAEGE]);
    await expect(wechsleStatus({ sheets, jetzt, eingabe: { auftragNr: 'AU-2026-0001', stand: 'S1', aktion: 'weiter', ueberspringen: true } }))
      .rejects.toMatchObject({ status: 422, code: 'ohne_positionen' });
    expect(JSON.stringify(t[TAB_AUFTRAEGE])).toBe(vorher);
    // "Design" ist noch frei
    await wechsleStatus({ sheets, jetzt, eingabe: { auftragNr: 'AU-2026-0001', stand: 'S1', aktion: 'weiter' } });
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Status')]).toBe('Design');
  });
});

describe('8. Design-Link', () => {
  test('nur https://, ohne Leerzeichen, hoechstens 500 Zeichen; leer = keiner', () => {
    expect(designLinkAus('https://www.canva.com/design/ABC/edit')).toBe('https://www.canva.com/design/ABC/edit');
    expect(designLinkAus('  ')).toBe('');
    for (const x of ['http://canva.com/x', 'javascript:alert(1)', 'www.canva.com/x', 'https://a b.de', `https://x.de/${'a'.repeat(500)}`]) expect(() => designLinkAus(x)).toThrow();
    expect(pruefeKopf({ Design_Link: 'https://x.de/d' }, { nurNotizTermin: true })).toEqual({ Design_Link: 'https://x.de/d' });   // auch ab "bestellt"
  });
  test('wird gespeichert; ohne Spalte 409', async () => {
    const t = tabs({ auftraege: [auftrag()] });
    const { sheets } = machSheets(t);
    await bearbeiteAuftrag({ sheets, jetzt, kundePruefen: kundeOk, eingabe: { auftragNr: 'AU-2026-0001', stand: 'S1', Design_Link: 'https://www.canva.com/design/X' } });
    expect(t[TAB_AUFTRAEGE][1][spalte(t, TAB_AUFTRAEGE, 'Design_Link')]).toBe('https://www.canva.com/design/X');
    const o = tabs({ auftraege: [auftrag()], mitSpalten: false });
    await expect(bearbeiteAuftrag({ sheets: machSheets(o).sheets, jetzt, kundePruefen: kundeOk, eingabe: { auftragNr: 'AU-2026-0001', stand: 'S1', Design_Link: 'https://x.de/d' } }))
      .rejects.toMatchObject({ status: 409 });
  });
  test('bestehende Auftraege ohne neue Felder bleiben unveraendert', () => {
    const plan = bearbeitenPlan({ auftrag: auftrag(), positionen: [], jetzt: JETZT, eingabe: { Kurztitel: 'Test', Kunden_Nr: 'K-00001', Preis_Eingabe: 'netto', Design_Link: '' } });
    expect(plan.unveraendert).toBe(true);
  });
});

describe('Oberflaeche', () => {
  const block = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
  test('Spiegel: Brutto-Rueckrechnung wie im Backend', () => {
    const gr = block('// ── Groessen: Anfang', '// ── Groessen: Ende');
    const F = new Function(`${gr}\n${block('// ── Auftrag-Preise: Anfang', '// ── Auftrag-Preise: Ende')}\nreturn { apNettoAusBrutto, apBruttoAusNetto, apEuro, apSummen };`)();
    for (const [b, u] of [[29.9, 19], [12, 7], [1.1, 19], [5, 0]]) {
      expect(F.apNettoAusBrutto(b, u)).toBe(nettoAusBrutto(b, u));
      expect(F.apBruttoAusNetto(F.apNettoAusBrutto(b, u), u)).toBe(b);
    }
    const pos = [{ art: 'frei', menge: 3, preis: 25.1261, ust: 19, ekHand: null }];
    expect(F.apSummen(pos, { art: '€', wert: 5 })).toEqual(auftragSummen(pos, { art: '€', wert: 5 }));
  });
  test('1. Dashboard-Kachel -> Auftraege (nicht Kunden), Teilzahlen mit Filter', () => {
    const k = block('// ── Auftraege-Kachel: Anfang', '// ── Auftraege-Kachel: Ende');
    const F = new Function(`${k}\nreturn { auKachelHtml, AU_KACHEL_ZIEL, AU_KACHEL_START };`)();
    expect(F.AU_KACHEL_START).toEqual({ unterpunkt: 'liste', filter: { 'au-f': 'offen', 'au-art': 'alle' } });
    expect(F.AU_KACHEL_ZIEL.wartetAufWare.filter).toEqual({ 'au-f': 'ware', 'au-art': 'auftraege' });
    expect(F.AU_KACHEL_ZIEL.todosUeberfaellig).toEqual({ unterpunkt: 'todos', filter: { 'td-f': 'ueberfaellig' } });
    const h = F.auKachelHtml({ aktiv: 3, auftraege: { offen: 2, terminBald: 1, wartetAufWare: 1, fertigNichtBezahlt: 0, todosUeberfaellig: 2, aufgabenOffen: 1 } });
    expect(h).toContain('<button type="button" class="au-kachel-zeile au-kachel-link" data-au-ziel="wartetAufWare" data-hilfe="dash-au-zeile">1 wartet auf Ware</button>');
    expect(h).toContain('<div class="au-kachel-zeile">0 fertig, nicht bezahlt</div>');
    expect(html).not.toContain("oeffneAnsicht('auftraege', 'kunden')");
  });
  test('2. API-Schluessel: eigenes Formular, Feld nie vorbelegt, Speichern ueber submit', () => {
    expect(html).toContain('<form id="api-key-form" autocomplete="on"');
    expect(html).toMatch(/<input id="api-key" name="password" type="password" autocomplete="current-password"/);
    expect(html).not.toMatch(/keyInput\.value = localStorage/);
    expect(html).toContain("document.getElementById('api-key-form').addEventListener('submit'");
    const form = block('<form id="api-key-form"', '</form>');
    expect((form.match(/<input/g) ?? []).length).toBe(2);   // nur Name + Schluessel - keine anderen MC-Felder
  });
  test('4. Termin und Faelligkeit als Kalenderfeld (type=date)', () => {
    expect(html).toContain('<input id="au-Termin" type="date"');
    expect(html).toContain('<input id="ag-Faellig" type="date"');
  });
  test('5. Reihenfolge im Dialog: Kopf -> Positionen -> Summe/Rabatt', () => {
    const i = id => html.indexOf(id);
    expect(i('id="au-Notiz"')).toBeLessThan(i('id="au-pos-block"'));
    expect(i('id="au-pos-block"')).toBeLessThan(i('id="au-preis-block"'));
    expect(i('id="au-preis-block"')).toBeLessThan(i('id="au-speichern"'));
  });
  test('7. Angefangene freie Position / Raster wird beim Speichern uebernommen, Enter uebernimmt', () => {
    expect(html).toContain('if (frei && !auOffeneEingaben()) return;');
    expect(html).toContain("if (e.key === 'Enter') { e.preventDefault(); auFreiUebernehmen(); }");
    expect(html).toContain('Nicht übernommene Eingabe im Größenraster');
    expect(html).not.toContain("auFehler('Mindestens eine Position.')");
  });
  test('8. Design-Link in der Ansicht nur https, neuer Tab', () => {
    const f = new Function('kuEsc', `${html.slice(html.indexOf('const auDesignLinkHtml'), html.indexOf(";", html.indexOf("'' );", html.indexOf('const auDesignLinkHtml'))) + 1)}\nreturn auDesignLinkHtml;`);
    expect(typeof f).toBe('function');
    expect(html).toContain('target="_blank" rel="noopener noreferrer" class="korb-link" data-hilfe="au-design-link">Design öffnen ↗</a>');
    expect(html).toMatch(/const auDesignLinkHtml = url => \(\/\^https:\\\/\\\/\\S\+\$\/i\.test/);
  });
});
