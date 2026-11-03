// AM-2: Frontend-Block "Auftraege-Anzeige" (reine Logik) und Verdrahtung. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { terminBald } from '../utils/auftraege.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const ku = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
const block = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('// ── Auftraege-Anzeige: Ende ──'));
const F = new Function(`${ku}\n${block}\nreturn { auFiltern, auTerminBald, auGruppen, auPositionenAnfrage, auLeisteHtml, auZeileHtml, auKundeText, auEntwurfAus, auFrei };`)();
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
    expect(schritte).toEqual(['au-erledigt', 'au-erledigt', 'au-aktuell', '', '', '', '']);
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
    expect(body[0]).toEqual({ art: 'lshop', articleNr: '1', menge: 2, motiv: 'Wappen', druck: '', notiz: '' });
    expect(body[2]).toEqual({ art: 'frei', freitext: 'Tassen', menge: 10, motiv: '', druck: '', notiz: '' });
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
