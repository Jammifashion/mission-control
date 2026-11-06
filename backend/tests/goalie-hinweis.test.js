// TR8: Goalie-Hinweis erkennen (nur lesen), "als Goalie markieren" / "kein Goalie" ueber den TR7-Weg, Formular-Sperre.
// Nur ERFUNDENE Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { goalieHinweise, hinweisText, stichworte, technischesFeld } from '../utils/goalie-hinweis.js';
import { TRIKOT_HEADER, SPALTE_GOALIE, goalieStatus } from '../utils/trikot-logic.js';
import { trikotZeilen, baueTrikotAnsicht } from '../utils/trikot-ansicht.js';
import { formularPositionen } from '../utils/trikot-formular.js';
import { aendereTrikot, _trikotInternCacheLeeren } from '../lib/trikotIntern.js';
import { alsBestelltEintragen } from '../lib/trikotFormular.js';

const KOPF = [...TRIKOT_HEADER, 'Ersetzt', SPALTE_GOALIE];
const zeile = (o, kopf = KOPF) => kopf.map(s => o[s] ?? '');
const SHOP = (id, extra = {}, kopf) => zeile({ 'Zeilen-ID': `${id}|1|1`, Bestelldatum: '2026-11-01T09:00:00', 'Order-ID': id, 'Order-Item-ID': '1',
  Produktname: 'Testverein Heimtrikot', Groesse: 'M', Name: 'MUSTER', Nummer: '1', Stueck: '1', Quelle: 'variante', Rohtext: 'Name: MUSTER', ...extra }, kopf);
const tabs = (kopf = KOPF) => ({ Trikots: [kopf,
  SHOP('60001', { Rohtext: 'Name: MUSTER\nKundennotiz: bitte als Torwarttrikot' }, kopf),   // offen
  SHOP('60002', { Notiz: 'GK lange Ärmel' }, kopf),                                          // offen (Notiz-Spalte)
  SHOP('60003', { Rohtext: 'Name: GKOENIG\nKundennotiz: Goalgetter' }, kopf),                // Wortteile: kein Hinweis
  SHOP('60004', { Rohtext: 'Name: MUSTER\nKundennotiz: Keeper', Goalie: 'nein' }, kopf),     // quittiert
  SHOP('60005', { Rohtext: 'Kundennotiz: Torwart', Goalie: 'ja' }, kopf),                    // markiert
  SHOP('60006', { Rohtext: 'Kundennotiz: Torwart', Charge: 2, Bestellt_Am: '20.10.2026' }, kopf),   // schon beim Hersteller
] });
const VORHER = { groesse: 'M', name: 'MUSTER', nummer: '1', notiz: '', goalie: '' };
const w = (t, z, s) => t.Trikots[z - 1][t.Trikots[0].indexOf(s)];
beforeEach(() => { process.env.BUSINESS_SHEET_ID = 'biz'; _trikotInternCacheLeeren(); });

describe('Erkennung', () => {
  test('Treffer in Kundennotiz, Rohtext-Feld und Notiz-Spalte; nur Fundstelle + Stichwort', () => {
    expect(goalieHinweise({ rohtext: 'Größe: L\nKundennotiz: Bitte als Torwarttrikot' })).toEqual([{ quelle: 'Kundennotiz', stichwort: 'torwart' }]);
    expect(goalieHinweise({ rohtext: 'Name/Nummer: KEEPER 1' })).toEqual([{ quelle: 'Name/Nummer', stichwort: 'keeper' }]);
    expect(goalieHinweise({ notiz: 'gk, lange Ärmel' })).toEqual([{ quelle: 'Notiz (Spalte)', stichwort: 'gk' }]);
    expect(goalieHinweise({ rohtext: 'Kundennotiz: Zeile eins\nbitte GOALI\nDanke' })).toEqual([{ quelle: 'Kundennotiz', stichwort: 'goali' }]);
    expect(hinweisText(goalieHinweise({ rohtext: 'Kundennotiz: Torwart', notiz: 'Goal' }))).toBe('Kundennotiz: ‚torwart‘ · Notiz (Spalte): ‚goal‘');
  });
  test('"gk" und "goal" nur als eigenes Wort; torwart/goalie/goali/keeper auch als Wortteil', () => {
    expect(stichworte('Gkoenig, Goalgetter, BGK7')).toEqual([]);
    expect(stichworte('GK 1')).toEqual(['gk']);
    expect(stichworte('ein Goal!')).toEqual(['goal']);
    expect(stichworte('GoalKeeper')).toEqual(['keeper']);
    expect(stichworte('Torwarttrikot')).toEqual(['torwart']);
  });
  test('nie in technischen Feldern: reCAPTCHA (TR7-Fall), _-Meta, Zahlung, MC-Vorgang', () => {
    expect(goalieHinweise({ rohtext: 'ppcp_recaptcha_captcha_result: 03AGk-xyz GK goalie' })).toEqual([]);
    expect(goalieHinweise({ rohtext: '_reduced_stock: goalie\nMC-Vorgang: abc-gk-1\nTransaktions-ID: GK 7' })).toEqual([]);
    expect(technischesFeld('ppcp_paypal_order_id')).toBe(true);
    expect(technischesFeld('Kundennotiz')).toBe(false);
    expect(goalieHinweise({ rohtext: '(keine Meta-Daten, keine Kundennotiz)' })).toEqual([]);
  });
});

describe('Anzeige und Zaehler', () => {
  test('"GK? prüfen" nur bei Hinweis + Goalie leer + ohne Charge; Zaehler', () => {
    const a = baueTrikotAnsicht(trikotZeilen(tabs().Trikots));
    const z = id => a.gruppen.flatMap(g => g.zeilen).find(x => x.id === `${id}|1|1`);
    expect(z('60001')).toMatchObject({ goalieOffen: true, goalieHinweis: 'Kundennotiz: ‚torwart‘', goalieRoh: '' });
    expect(z('60002')).toMatchObject({ goalieOffen: true, goalieHinweis: 'Notiz (Spalte): ‚gk‘' });
    expect(z('60003')).toMatchObject({ goalieOffen: false, goalieHinweis: '' });
    expect(z('60004')).toMatchObject({ goalieOffen: false, goalieRoh: 'nein', goalie: false });
    expect(z('60005')).toMatchObject({ goalieOffen: false, goalieRoh: 'ja', goalie: true });
    expect(z('60006')).toMatchObject({ goalieOffen: false });
    expect(a.summen.goalieOffen).toBe(2);
  });
  test('ohne Spalte Goalie: kein offener Hinweis (niemand koennte markieren)', () => {
    const k = KOPF.slice(0, -1);
    expect(baueTrikotAnsicht(trikotZeilen(tabs(k).Trikots)).summen.goalieOffen).toBe(0);
  });
  test('"nein" ist fuer Formular/Kennzeichen kein Goalie', () => {
    expect(goalieStatus('nein')).toBe('nein');
    expect(goalieStatus('JA')).toBe('ja');
    expect(goalieStatus('')).toBe('');
  });
});

describe('Ein-Klick ueber den TR7-Weg', () => {
  test('als Goalie markieren -> ja; kein Goalie -> nein; nur die Zelle Goalie', async () => {
    const t = tabs();
    const { sheets, aufrufe } = machSheets(t);
    const vorher = JSON.stringify(t.Trikots[1].slice(0, -1));
    await aendereTrikot({ sheets, aktion: 'goalie', wert: 'ja', ziel: { id: '60001|1|1', zeile: 2 }, vorher: VORHER });
    expect(w(t, 2, SPALTE_GOALIE)).toBe('ja');
    expect(JSON.stringify(t.Trikots[1].slice(0, -1))).toBe(vorher);
    await aendereTrikot({ sheets, aktion: 'goalie', wert: 'nein', ziel: { id: '60002|1|1', zeile: 3 }, vorher: { ...VORHER, notiz: 'GK lange Ärmel' } });
    expect(w(t, 3, SPALTE_GOALIE)).toBe('nein');
    expect(aufrufe.append).toBe(0);
    expect(baueTrikotAnsicht(trikotZeilen(t.Trikots)).summen.goalieOffen).toBe(0);
  });
  test('gleiche Vorher-Pruefung: anderer Browser hat schon quittiert -> 409, nichts geschrieben', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await expect(aendereTrikot({ sheets, aktion: 'goalie', wert: 'ja', ziel: { id: '60004|1|1', zeile: 5 }, vorher: VORHER }))
      .rejects.toMatchObject({ status: 409, code: 'geaendert', felder: ['goalie'] });
    expect(w(t, 5, SPALTE_GOALIE)).toBe('nein');
  });
  test('mit Charge gesperrt, falscher Wert 400, ohne Spalte 409 einrichtung', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await expect(aendereTrikot({ sheets, aktion: 'goalie', wert: 'ja', ziel: { id: '60006|1|1', zeile: 7 }, vorher: VORHER })).rejects.toMatchObject({ code: 'gesperrt' });
    await expect(aendereTrikot({ sheets, aktion: 'goalie', wert: 'vielleicht', ziel: { id: '60001|1|1', zeile: 2 }, vorher: VORHER })).rejects.toMatchObject({ status: 400 });
    const ohne = tabs(KOPF.slice(0, -1));
    await expect(aendereTrikot({ sheets: machSheets(ohne).sheets, aktion: 'goalie', wert: 'ja', ziel: { id: '60001|1|1', zeile: 2 }, vorher: VORHER })).rejects.toMatchObject({ code: 'einrichtung' });
  });
  test('"ändern …" ohne Goalie-Haken behaelt ein quittiertes "nein"', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await aendereTrikot({ sheets, aktion: 'aendern', ziel: { id: '60004|1|1', zeile: 5 }, vorher: { ...VORHER, goalie: 'nein' }, trikot: { groesse: 'L', name: 'MUSTER', nummer: '1' } });
    expect([w(t, 5, 'Groesse'), w(t, 5, SPALTE_GOALIE)]).toEqual(['L', 'nein']);
  });
});

describe('Produzenten-Bestellung', () => {
  test('Position traegt goalieOffen; Eintragen mit ungeklaertem Hinweis -> 409 goalie_offen, nichts geschrieben', async () => {
    const t = tabs();
    const zs = trikotZeilen(t.Trikots).zeilen.filter(z => ['60001|1|1', '60003|1|1'].includes(z.id));
    expect(formularPositionen(zs, { jeName: new Map() }).map(p => p.goalieOffen)).toEqual([true, false]);
    const { sheets } = machSheets(t);
    const vorher = JSON.stringify(t.Trikots);
    await expect(alsBestelltEintragen({ sheets, auswahl: [{ id: '60001|1|1', zeile: 2 }], charge: 3 })).rejects.toMatchObject({ status: 409, code: 'goalie_offen' });
    expect(JSON.stringify(t.Trikots)).toBe(vorher);
  });
});

describe('Oberflaeche', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
  const block = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
  const T = new Function(`${block('// ── Trikots: Anfang', '// ── Trikots: Ende')}\nreturn { trGkPruefenHtml, trSummeText, trSummeHtml };`)();
  const F = new Function(`const TR_HINWEISE = {}; const trEsc = s => String(s ?? '');\n${block('// ── Trikot-Formular: Anfang', '// ── Trikot-Formular: Ende')}\nreturn { trVorwahl, trFormularGrund, trVorschauHtml };`)();
  test('Hinweis mit Mouse-over (Fundstelle + Stichwort) und zwei Knoepfen', () => {
    const h = T.trGkPruefenHtml({ goalieOffen: true, goalieHinweis: 'Kundennotiz: ‚torwart‘', zeile: 4, id: '60001|1|1' });
    expect(h).toContain('<span class="tr-gk-frage" tabindex="0" data-hilfe="tr-gk-pruefen" data-hilfe-zusatz="Kundennotiz: ‚torwart‘">GK? prüfen</span>');
    expect(h).toContain('data-tr-gk="ja" data-zeile="4" data-id="60001|1|1" data-hilfe="tr-gk-markieren">als Goalie markieren</button>');
    expect(h).toContain('data-tr-gk="nein" data-zeile="4" data-id="60001|1|1" data-hilfe="tr-gk-kein">kein Goalie</button>');
    expect(T.trGkPruefenHtml({ goalieOffen: false })).toBe('');
    expect(html).not.toMatch(/data-tr-gk[^>]*\stitle=/);
  });
  test('Zaehler "n Goalie-Hinweise offen"', () => {
    const d = n => ({ summen: { offen: 2, chargen: 1, da: 0, zeilen: 2, goalieOffen: n } });
    expect(T.trSummeText(d(2))).toMatch(/ · 2 Goalie-Hinweise offen$/);
    expect(T.trSummeText(d(1))).toMatch(/ · 1 Goalie-Hinweis offen$/);
    expect(T.trSummeText(d(0))).not.toMatch(/Goalie/);
    // antwort-TR8: Zaehler rot (eigene Klasse), nur solange > 0
    expect(T.trSummeHtml(d(2))).toMatch(/ · <span class="tr-gk-zaehler">2 Goalie-Hinweise offen<\/span>$/);
    expect(T.trSummeHtml(d(0))).not.toMatch(/tr-gk-zaehler|Goalie/);
  });
  test('antwort-TR8: Goalie-Warnungen rot (--danger), bestaetigtes GK ohne Warnfarbe', () => {
    const css = html.slice(html.indexOf('.tr-gk-frage {'), html.indexOf('\n', html.indexOf('.tr-gk-frage {')));
    expect(css).toContain('color: var(--danger)');
    expect(css).toContain('border: 1px solid var(--danger)');
    expect(html).toMatch(/\.tr-gk-zaehler, \.tr-gk-warnung \{ color: var\(--danger\)/);
    const gk = html.slice(html.indexOf('.tr-gk {'), html.indexOf('\n', html.indexOf('.tr-gk {')));
    expect(gk).toContain('var(--accent)');
    expect(gk).not.toContain('danger');
    expect(html).toContain("document.getElementById('tr-summe').innerHTML = trSummeHtml(trZustand.daten);");
  });
  test('Formular: nicht vorgewaehlt, Export gesperrt bis zur Klaerung, Warnung nennt die Zeile', () => {
    expect([...F.trVorwahl([{ zeile: 2, hinweise: [], goalieOffen: true }, { zeile: 3, hinweise: [] }])]).toEqual([3]);
    const v = { positionen: [{ zeile: 2 }], einrichtung: [], ohneZuordnung: [], probleme: [], goalieOffen: [2] };
    expect(F.trFormularGrund({ vorschau: v, auswahl: [{ id: 'x', zeile: 2 }], heruntergeladen: '', laeuft: false })).toBe('gesperrt');
    expect(F.trFormularGrund({ vorschau: { ...v, goalieOffen: [] }, auswahl: [{ id: 'x', zeile: 2 }], heruntergeladen: '', laeuft: false })).toBe('erst-download');
    const h = F.trVorschauHtml({ ...v, kopf: { bestelltAm: '', lieferung: '', team: '', nummer: '', wiederholung: '' }, positionen: [], zaehler: [], dateiname: 'x' });
    expect(h).toContain('<p class="tr-gk-warnung">GK? prüfen – erst klären (als Goalie markieren oder „kein Goalie“) oder abwählen: Zeile 2</p>');
    expect(h).not.toMatch(/class="tr-hinweis">[^<]*GK\? prüfen/);
  });
});
