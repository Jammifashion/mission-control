// TR5: Trikot-Stand an der Shop-Bestellung (utils/trikot-ansicht.js bestellungStand, Kennzeichen in index.html).
// Nur erfundene Daten, nur lesen.

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { trikotZeilen, baueTrikotAnsicht } from '../utils/trikot-ansicht.js';
import { leseTrikotAnsicht, trikotAnsichtCacheLeeren, CACHE_MS } from '../lib/trikotAnsicht.js';

const KOPF = ['Zeilen-ID', 'Order-ID', 'Kunde', 'Produktname', 'Groesse', 'Name', 'Nummer', 'Quelle', 'Rohtext',
  'Charge', 'Bestellt_Am', 'Geliefert_Am', 'Status', 'Notiz', 'Ersetzt'];
const z = (id, order, charge, bam = '', status = '', ersetzt = '') => [id, order, 'Erika', 'Verein Heimtrikot', 'L', 'X', '1', 'addon', '', charge, bam, '', status, '', ersetzt];
const WERTE = [KOPF,
  z('1|1|1', '501', ''),                                        // 501: ohne Charge -> nicht_bestellt
  z('2|1|1', '502', '3', '28.09.2026'), z('2|2|1', '502', '4', '07.10.2026'),   // 502: bestellt, 2 Chargen
  z('3|1|1', '503', '2', '14.09.2026', 'ok'),                  // 503: da
  z('4|1|1', '504', '2', '14.09.2026', 'ok'), z('4|2|1', '504', '3', '28.09.2026'),   // 504: teil 1/2
  z('5|1|1', '505', '2', '14.09.2026', 'ersetzt'), z('INT-2026-0002', '505', '4', '07.10.2026', '', '5|1|1'),   // 505: Ersatz offen
  z('6|1|1', '506', '2', '14.09.2026', 'ersetzt'), z('INT-2026-0003', '506', '4', '07.10.2026', 'ok', '6|1|1'),  // 506: Ersatz da
  z('7|1|1', '507', '5', ''),                                  // 507: bestellt ohne Bestellt_Am
  z('INT-2026-0009', '', '6', '30.10.2026'),                   // Handzeile ohne Order-ID
  z('8|1|1', '508', '2', '14.09.2026', 'ersetzt'), z('INT-2026-0004', '508', '', '', '', '8|1|1'),   // 508: Ersatz ohne Charge
];
const stand = () => baueTrikotAnsicht(trikotZeilen(WERTE)).bestellungen;

describe('bestellungStand (Backend, gleiche Regeln wie die Ansicht)', () => {
  test('jede Stufe der Tabelle', () => {
    const s = stand();
    expect(s['501']).toMatchObject({ stufe: 'nicht_bestellt', trikots: 1, da: 0 });
    expect(s['502']).toMatchObject({ stufe: 'bestellt', trikots: 2, da: 0, chargen: ['3', '4'], bestelltAm: '28.09.2026' });
    expect(s['503']).toMatchObject({ stufe: 'da', trikots: 1, da: 1 });
    expect(s['504']).toMatchObject({ stufe: 'teil', trikots: 2, da: 1 });
    expect(s['505']).toMatchObject({ stufe: 'ersatz', trikots: 1, da: 0, ersatzCharge: '4', chargen: ['4'], bestelltAm: '07.10.2026' });
    expect(s['506']).toMatchObject({ stufe: 'da', trikots: 1, da: 1 });
    expect(s['507']).toMatchObject({ stufe: 'bestellt', bestelltAm: '', chargen: ['5'] });
    expect(s['508']).toMatchObject({ stufe: 'nicht_bestellt' });   // Ersatz noch ohne Charge
  });
  test('Handzeile ohne Order-ID gehoert zu keiner Bestellung; Bestellung ohne Trikots fehlt', () => {
    const s = stand();
    expect(Object.keys(s).sort()).toEqual(['501', '502', '503', '504', '505', '506', '507', '508']);
    expect(s['999']).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('Erika');
  });
});

describe('Zwischenspeicher', () => {
  test('60 s; die Schreibwege leeren ihn', async () => {
    process.env.BUSINESS_SHEET_ID = 'biz';
    trikotAnsichtCacheLeeren();
    const get = jest.fn(async () => ({ data: { values: WERTE } }));
    const api = { spreadsheets: { values: { get } } };
    // Mit Test-Client wird nie gespeichert (Tests bleiben unabhaengig); der Speicher selbst: Laufzeit-Test ueber CACHE_MS.
    await leseTrikotAnsicht({ sheets: api });
    await leseTrikotAnsicht({ sheets: api });
    expect(get).toHaveBeenCalledTimes(2);
    expect(CACHE_MS).toBe(60000);
    const quelle = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../lib/trikotFormular.js'), 'utf8')
      + readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../lib/trikotWareneingang.js'), 'utf8');
    expect((quelle.match(/trikotAnsichtCacheLeeren\(\);/g) ?? []).length).toBe(2);
  });
});

// ── Frontend ──
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Trikots: Anfang'), html.indexOf('// ── Trikots: Ende ──'));
const T = new Function(`${block}\nreturn { trSeit, trKarteText, trKarteHtml };`)();
const JETZT = new Date('2026-10-30T10:00:00Z');

describe('Kennzeichen auf der Karte', () => {
  test('seit X Wochen / Tagen / heute (Berlin)', () => {
    expect(T.trSeit('28.09.2026', JETZT)).toBe('seit 4 Wochen');
    expect(T.trSeit('23.10.2026', JETZT)).toBe('seit 1 Woche');
    expect(T.trSeit('29.10.2026', JETZT)).toBe('seit 1 Tag');
    expect(T.trSeit('26.10.2026', JETZT)).toBe('seit 4 Tagen');
    expect(T.trSeit('30.10.2026', new Date('2026-10-29T23:30:00Z'))).toBe('seit heute');   // 00:30 Berlin
    expect(T.trSeit('', JETZT)).toBe('');
  });
  test('Text je Stufe, ohne Lieferdatum, ohne Namen', () => {
    const s = stand();
    const t = id => T.trKarteText(s[id], JETZT).text;
    expect(t('501')).toBe('Trikot: noch nicht beim Produzenten');
    expect(t('502')).toBe('Trikots bestellt am 28.09. (Bestellung 3/4, seit 4 Wochen)');
    expect(t('503')).toBe('Trikot da ✓');
    expect(t('504')).toBe('Trikots: 1 von 2 da');
    expect(t('505')).toBe('Trikot: Ersatz bestellt (Bestellung 4)');
    expect(t('506')).toBe('Trikot da ✓');
    expect(t('507')).toBe('Trikot bestellt (Bestellung 5)');
    expect(T.trKarteText(undefined, JETZT)).toBeNull();
    expect(T.trKarteHtml('999', undefined, JETZT)).toBe('');   // Bestellung ohne Trikots: kein Kennzeichen
    expect(T.trKarteHtml('503', s['503'], JETZT)).toMatch(/<button type="button" class="tr-karte tr-k-da" data-tr-springe="503" data-hilfe="tr-karte">Trikot da ✓<\/button>/);
  });
});

describe('Einbindung', () => {
  test('Karte: nur JFN, Laden still neben dem Stand, Klick springt statt aufzuklappen', () => {
    expect(html).toMatch(/\$\{psZustand\.trikots \? trKarteHtml\(o\.id, psZustand\.trikots\[String\(o\.id\)\]\) : ''\}/);
    expect(html).toMatch(/if \(currentShop\(\) !== 'honk'\) \{\n\s*apiFetch\(`\$\{API_BASE\(\)\}\/api\/bestellen\/trikots`/);
    expect(html).toMatch(/const tr = ev\.target\.closest\('\[data-tr-springe\]'\);\n\s*if \(tr\) \{ ev\.preventDefault\(\); ev\.stopPropagation\(\); trSpringeZu\(tr\.dataset\.trSpringe\); oeffneAnsicht\('bestellen', 'trikots'\); return; \}/);
  });
  test('Trikot-Ansicht: Gruppenkopf ohne "Lieferung ca.", Sprung markiert die Zeilen', () => {
    expect(html).not.toMatch(/Lieferung ca\./);
    expect(html).toMatch(/function trSprungAusfuehren\(el\)/);
    expect(html).toMatch(/trSprungAusfuehren\(el\);/);
  });
  test('Produzenten-Formular bleibt: DELIVERY DATE = +30 Tage', () => {
    expect(html).toMatch(/\['DELIVERY DATE', v\.kopf\.lieferung\]/);
  });
});
