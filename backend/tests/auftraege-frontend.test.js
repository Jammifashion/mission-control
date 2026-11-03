// AM-2: Frontend-Block "Auftraege-Anzeige" (reine Logik) und Verdrahtung. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { terminBald } from '../utils/auftraege.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const ku = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
const block = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('// ── Auftraege-Anzeige: Ende ──'));
const F = new Function(`${ku}\n${block}\nreturn { auFiltern, auTerminBald, auGruppen, auPositionenAnfrage, auLeisteHtml, auZeileHtml, auKundeText, auEntwurfAus, auFrei, auHerkunft, auHerkunftText, auLagerStand, auLagerJe, auLagerVorschlag, auBestandOhne, auTeilen, auKannBereitstellen, auKannZuruecknehmen, auKorbText };`)();
const sektion = html.slice(html.indexOf('// ── SECTION: Aufträge – Liste, Ansicht, Erfassen (AM-2) ──'), html.indexOf('// ── SECTION: Artikelerfassung ──'))
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const HEUTE = '2026-11-03';
const kunden = [{ Kunden_Nr: 'K-00001', Name: 'Testverein', Spitzname: 'Kicker; die Blauen' }, { Kunden_Nr: 'K-00002', Name: 'Beispiel GmbH' }];
const auftraege = [
  { Auftrag_Nr: 'AU-2026-0001', Kunden_Nr: 'K-00001', Kurztitel: 'Polos', Status: 'Anfrage', Termin: '2026-11-08', Angelegt: '2' },
  { Auftrag_Nr: 'AU-2026-0002', Kunden_Nr: 'K-00002', Kurztitel: 'Hoodies <b>', Status: 'fertig', Termin: '', Angelegt: '1' },
  { Auftrag_Nr: 'AU-2026-0003', Kunden_Nr: 'K-00002', Kurztitel: 'Tassen', Status: 'bezahlt', Termin: '2026-11-04', Angelegt: '3' },
  { Auftrag_Nr: 'AU-2026-0004', Kunden_Nr: 'K-00001', Kurztitel: 'Muetzen', Status: 'storniert', Termin: '2026-11-04', Angelegt: '4' },
];

describe('Auftraege-Anzeige', () => {
  test('Block gefunden', () => expect(block.length).toBeGreaterThan(1000));
  test('Filter offen/termin/Status/alle; Termin zuerst, sonst angelegt', () => {
    expect(F.auFiltern(auftraege, kunden, {}, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0001', 'AU-2026-0002']);
    expect(F.auFiltern(auftraege, kunden, { filter: 'termin' }, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0001']);
    expect(F.auFiltern(auftraege, kunden, { filter: 'storniert' }, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0004']);
    expect(F.auFiltern(auftraege, kunden, { filter: 'alle' }, HEUTE)).toHaveLength(4);
  });
  test('Termin bald gleich wie im Backend', () => {
    for (const a of auftraege) expect([a.Auftrag_Nr, F.auTerminBald(a, HEUTE)]).toEqual([a.Auftrag_Nr, terminBald(a, `${HEUTE}T10:00:00Z`)]);
  });
  test('Suche ueber Nr., Titel, Kunde, Spitzname', () => {
    expect(F.auFiltern(auftraege, kunden, { filter: 'alle', suche: 'blauen' }, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0004', 'AU-2026-0001']);   // frueherer Termin zuerst
    expect(F.auFiltern(auftraege, kunden, { filter: 'alle', suche: 'beispiel tassen' }, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0003']);
    expect(F.auFiltern(auftraege, kunden, { filter: 'alle', suche: 'au-2026-0002' }, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0002']);
  });
  test('Zeile maskiert, Kunde mit Spitzname, Mouse-over am Knopf', () => {
    const z = F.auZeileHtml({ ...auftraege[1], stueck: 7 }, kunden[1]);
    expect(z).toContain('Hoodies &lt;b&gt;');
    expect(z).toContain('data-hilfe="au-oeffnen"');
    expect(F.auKundeText(kunden[0], 'K-00001')).toBe('Testverein (Kicker)');
    expect(F.auKundeText(undefined, 'K-00009')).toBe('K-00009');
  });
  test('Status-Leiste: aktueller hervorgehoben, Datum je Schritt, storniert extra', () => {
    const h = F.auLeisteHtml({ Status: 'bestellt', Anfrage_Am: '2026-11-01', Angebot_Am: '2026-11-02', Bestellt_Am: '2026-11-03' });
    expect(h.match(/au-aktuell/g)).toHaveLength(1);
    expect(h).toContain('03.11.2026');
    expect(F.auLeisteHtml({ Status: 'storniert', Storniert_Am: '2026-11-03' })).toContain('storniert');
    // Inhaber 03.11.: erledigt gruen (au-erledigt), aktuell gelb (au-aktuell, nie zugleich erledigt), offen grau (ohne Klasse)
    const schritte = [...h.matchAll(/class="au-schritt([^"]*)"/g)].map(m => m[1].trim());
    expect(schritte).toEqual(['au-erledigt', 'au-erledigt', '', 'au-aktuell', '', '', '', '']);   // AM-3: Design uebersprungen = grau
    const vorkasse = F.auLeisteHtml({ Status: 'Angebot', Anfrage_Am: '1', Angebot_Am: '2', Bezahlt_Am: '2026-11-01' });
    expect([...vorkasse.matchAll(/class="au-schritt([^"]*)"/g)].map(m => m[1].trim()).at(-1)).toBe('au-erledigt');
    expect(html).toMatch(/\.au-schritt\.au-erledigt \{ color: var\(--success\)/);
  });
  test('Gruppen: L-Shop je Modell+Farbe, frei einzeln; Anfrage an den Server', () => {
    const entwurf = [
      { art: 'lshop', articleNr: '1', modell: 'X3000', farbe: 'Black', groesse: 'M', menge: 2, motiv: 'Wappen' },
      { art: 'lshop', articleNr: '2', modell: 'X3000', farbe: 'Black', groesse: 'S', menge: 1, motiv: 'Wappen' },
      { art: 'frei', freitext: 'Tassen', menge: 10 },
      { positionId: 'AU-2026-0001-04', art: 'lshop', articleNr: '3', modell: 'X3000', farbe: 'Navy', groesse: 'L', menge: 1 },
    ];
    const g = F.auGruppen(entwurf);
    expect(g.map(x => [x.art, x.farbe ?? x.freitext, x.stueck])).toEqual([['lshop', 'Black', 3], ['frei', 'Tassen', 10], ['lshop', 'Navy', 1]]);
    const body = F.auPositionenAnfrage(entwurf);
    expect(body[0]).toEqual({ art: 'lshop', articleNr: '1', menge: 2, motiv: 'Wappen', druck: '', notiz: '', herkunft: 'bestellen' });
    expect(body[2]).toEqual({ art: 'frei', freitext: 'Tassen', menge: 10, motiv: '', druck: '', notiz: '', herkunft: '' });
    expect(body[3].positionId).toBe('AU-2026-0001-04');
    expect(F.auEntwurfAus({ Position_ID: 'P', Art: 'lshop', LShop_ArticleNr: '1', Menge: '2', lshop: { modell: 'X', farbe: 'B', groesse: 'M' } })).toMatchObject({ positionId: 'P', menge: 2, modell: 'X' });
    expect(F.auFrei({ Status: 'Angebot' })).toBe(true);
    expect(F.auFrei({ Status: 'bestellt' })).toBe(false);
  });
});

describe('Verdrahtung', () => {
  test('Raster nur lesend: kein Korb-Schreibweg im Auftragsteil', () => {
    expect(sektion).toContain('/api/bestellen/lshop-korb/modelle');
    expect(sektion).not.toMatch(/lshop-korb\/eigen|lshop-korb\/status|lshop-korb\/aus-lager/);
  });
  test('kein Browser-Speicher, keine Adresse; Toasts nur mit Auftrags-Nr.', () => {
    expect(sektion).not.toMatch(/localStorage|sessionStorage|location\.hash|history\./);
    for (const z of sektion.split('\n').filter(l => l.includes('showToast('))) expect(z).not.toMatch(/Kurztitel|Name|Spitzname|Notiz/);
  });
  test('Doppelklick-Schutz und Vorgangs-Kennung beim Anlegen', () => {
    expect(sektion).toContain('if (auDlg.laeuft) return;');
    expect(sektion).toContain('vorgang: auDlg.vorgang');
  });
  test('Hinweis "keine Personennamen" an Notiz und Motiv', () => {
    expect(html).toContain('Notiz (keine Personennamen)');
    expect(sektion).toContain('Motiv (keine Personennamen)');
  });
});

// AM-2-2: Herkunft je Position, Lagerstand, Teilen; Modellsuche als Trefferliste
describe('Herkunft (AM-2-2)', () => {
  const lager = { '1|Wrist': 1, '2|Wrist': 5 };
  const bestand = (nr, ort) => lager[`${nr}|${ort}`] ?? 0;
  const entwurf = () => [
    { art: 'lshop', articleNr: '1', modell: 'X3000', farbe: 'Black', groesse: 'S', menge: 3, herkunft: 'lager', lagerOrt: 'Wrist', positionId: 'AU-1-01' },
    { art: 'lshop', articleNr: '2', modell: 'X3000', farbe: 'Black', groesse: 'M', menge: 2, herkunft: 'lager', lagerOrt: 'Wrist' },
    { art: 'lshop', articleNr: '3', modell: 'X3000', farbe: 'Black', groesse: 'L', menge: 4, herkunft: 'lager', lagerOrt: 'Wrist' },
    { art: 'frei', freitext: 'Tassen', menge: 10, herkunft: 'vorhanden' },
  ];
  test('Standard: L-Shop ohne Herkunft = bestellen, frei = leer; Kennzeichen', () => {
    expect(F.auHerkunft({ Art: 'lshop' })).toBe('bestellen');
    expect(F.auHerkunft({ Art: 'frei' })).toBe('');
    expect(F.auHerkunftText({ herkunft: 'lager', lagerOrt: 'Wrist' })).toBe('📦 Lager Wrist');
    expect(F.auHerkunftText({ herkunft: 'vorhanden' })).toBe('✓ vorhanden');
    expect(F.auHerkunftText({ herkunft: 'bestellen' })).toBe('🛒 bestellen');
  });
  test('Gruppen trennen nach Herkunft und Ort; Anfrage traegt Herkunft und Lagerort', () => {
    const e = [...entwurf(), { art: 'lshop', articleNr: '4', modell: 'X3000', farbe: 'Black', groesse: 'XL', menge: 1, herkunft: 'bestellen' }];
    expect(F.auGruppen(e).map(g => [g.herkunft, g.lagerOrt, g.positionen.length])).toEqual([['lager', 'Wrist', 3], ['vorhanden', '', 1], ['bestellen', '', 1]]);
    const body = F.auPositionenAnfrage(e);
    expect(body[0]).toMatchObject({ herkunft: 'lager', lagerOrt: 'Wrist' });
    expect(body[4]).not.toHaveProperty('lagerOrt');
  });
  test('Lagerstand am Ort und Teilen: aus Lager, was da ist, Rest wird "bestellen"', () => {
    const e = entwurf();
    const g = F.auGruppen(e)[0];
    expect(F.auLagerStand(g.positionen, 'Wrist', bestand)).toMatchObject({ reicht: false, ausLager: 3, rest: 6 });
    const neu = F.auTeilen(e, g, bestand);
    expect(neu.map(p => [p.articleNr ?? p.freitext, p.menge, p.herkunft, p.positionId ?? ''])).toEqual([
      ['1', 1, 'lager', 'AU-1-01'], ['1', 2, 'bestellen', ''],   // S: 1 da, 2 bestellen
      ['2', 2, 'lager', ''],                                      // M: reicht
      ['3', 4, 'bestellen', ''],                                  // L: nichts da -> ganz bestellen
      ['Tassen', 10, 'vorhanden', ''],
    ]);
    expect(neu.reduce((s, p) => s + p.menge, 0)).toBe(19);   // Stueck unveraendert
  });
  test('AM-3-1: Bestand je Nummer ueber alle Orte und Vorschlag fuer "bestellen"', () => {
    const b = (nr, ort) => ({ '1|Wrist': 1, '1|Itzehoe': 3, '2|Wrist': 2, '2|Itzehoe': 2 })[`${nr}|${ort}`] ?? 0;
    expect(F.auLagerJe('1', ['Wrist', 'Itzehoe'], b)).toEqual({ summe: 4, orte: [{ ort: 'Itzehoe', n: 3 }, { ort: 'Wrist', n: 1 }] });
    expect(F.auLagerJe('9', ['Wrist'], b)).toEqual({ summe: 0, orte: [] });
    const pos = [{ articleNr: '1', menge: 1 }, { articleNr: '2', menge: 2 }];
    expect(F.auLagerVorschlag(pos, ['Itzehoe', 'Wrist'], b, 'Wrist')).toMatchObject({ ort: 'Wrist', reicht: true, ausLager: 3 });   // Hauptort zuerst
    const mehr = [{ articleNr: '1', menge: 3 }, { articleNr: '2', menge: 2 }];
    expect(F.auLagerVorschlag(mehr, ['Wrist', 'Itzehoe'], b, 'Wrist')).toMatchObject({ ort: 'Itzehoe', reicht: true });               // deckt alles
    const zuviel = [{ articleNr: '1', menge: 5 }];
    expect(F.auLagerVorschlag(zuviel, ['Wrist', 'Itzehoe'], b, 'Wrist')).toMatchObject({ ort: 'Itzehoe', reicht: false, ausLager: 3, rest: 2 });
    expect(F.auLagerVorschlag([{ articleNr: '9', menge: 1 }], ['Wrist'], b, 'Wrist')).toBeNull();
    // Was andere Positionen schon aus dem Lager nehmen, steht nicht mehr zur Wahl
    const schon = { articleNr: '1', menge: 1, herkunft: 'lager', lagerOrt: 'Wrist' }, rest = { articleNr: '1', menge: 1, herkunft: 'bestellen' };
    const frei = F.auBestandOhne([schon, rest], { positionen: [rest] }, b);
    expect([frei('1', 'Wrist'), frei('1', 'Itzehoe')]).toEqual([0, 3]);
  });
  test('Modellsuche als Trefferliste (kein datalist), Lagerbestand nur gelesen', () => {
    expect(html).not.toMatch(/<datalist/);
    expect(sektion).toContain("const auModellTw = twBinden(auEl('au-modell-suche'), auEl('au-modell-treffer')");
    expect(html).toContain('<div id="au-modell-treffer" class="tw-box" hidden></div>');
    expect(sektion).toContain('/api/lager/bestand');
    expect(sektion).not.toMatch(/\/api\/lager\/(buchen|gegenbuchung)/);
  });
});

// AM-3: Bereitstellen, Korb-Rueckmeldung, Ware, Spruenge aus Korb und Lager
describe('AM-3 Anzeige', () => {
  const p = (extra) => ({ Position_ID: 'AU-2026-0003-01', Art: 'lshop', Herkunft: 'bestellen', ...extra });
  test('Bereitstellen nur bis bestellt und nur mit noch nicht uebergebenen 🛒/📦', () => {
    expect(F.auKannBereitstellen({ Status: 'Design', positionen: [p()] })).toBe(true);
    expect(F.auKannBereitstellen({ Status: 'in Produktion', positionen: [p()] })).toBe(false);
    expect(F.auKannBereitstellen({ Status: 'Angebot', positionen: [p({ Korb_Schluessel: 'EIGEN:2026-0001' }), p({ Herkunft: 'vorhanden' })] })).toBe(false);
    expect(F.auKannBereitstellen({ Status: 'Angebot', positionen: [{ Art: 'frei', Herkunft: '' }] })).toBe(false);
  });
  test('Zuruecknehmen nur bei offenem Korb oder Lager-Abgang', () => {
    const a = { Status: 'bestellt' };
    expect(F.auKannZuruecknehmen(a, p({ Korb_Schluessel: 'K', korb: { status: 'offen' } }))).toBe(true);
    expect(F.auKannZuruecknehmen(a, p({ Korb_Schluessel: 'K', korb: { status: 'bestellt' } }))).toBe(false);
    expect(F.auKannZuruecknehmen(a, p({ Lager_Buchung: 'LB-1' }))).toBe(true);
    expect(F.auKannZuruecknehmen({ Status: 'in Produktion' }, p({ Lager_Buchung: 'LB-1' }))).toBe(false);
  });
  test('Korb-Text je Stand, Liefertermin bei bestaetigt', () => {
    expect(F.auKorbText({ status: 'bestätigt', liefertermin: '2026-11-20' })).toBe('bestätigt · Liefertermin 20.11.2026');
    expect(F.auKorbText({ status: 'bestätigt', liefertermin: '' })).toBe('bestätigt · sofort');
    expect(F.auKorbText({ status: 'geliefert' })).toBe('geliefert');
  });
  test('Filter "wartet auf Ware": offene Auftraege mit Ware offen/bestellt; Kennzeichen in der Zeile', () => {
    const liste = [{ Auftrag_Nr: '1', Status: 'Angebot', ware: 'offen' }, { Auftrag_Nr: '2', Status: 'bestellt', ware: 'da' }, { Auftrag_Nr: '3', Status: 'storniert', ware: 'offen' }];
    expect(F.auFiltern(liste, [], { filter: 'ware' }, HEUTE).map(a => a.Auftrag_Nr)).toEqual(['1']);
    expect(F.auZeileHtml({ ...liste[0], Kurztitel: 'x', stueck: 1 }, null)).toContain('Ware offen');
  });
  test('Korb verlinkt den Auftrag (nie Name), Bearbeiten im Korb gesperrt, kein "bei Ankunft ins Lager"; Lager-Verlauf verlinkt den Auftrag', () => {
    expect(html).toContain('data-korb-au="${korbEsc(auNr)}" data-hilfe="korb-auftrag"');
    expect(html).toContain('data-eigen-gesperrt="eb-gesperrt-auftrag"');
    expect(html).toContain('// AM-3: Kundenrohlinge eines Auftrags gehen nicht ins Lager');
    expect(html).toContain('data-lager-au="${korbEsc(b.bezug)}" data-hilfe="lager-auftrag-link"');
    expect(sektion).toContain("auPost('bereitstellen', { auftragNr: abZ.auftragNr, stand: abZ.stand, vorgang: abZ.vorgang");
  });
});
