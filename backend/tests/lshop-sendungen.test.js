// BO4b-2: Anzeige der Sendungen - Frontend-Block "Sendung-Anzeige" (frontend/index.html) und die
// Korb-Antwort (GET .../lshop-korb liefert sendungen je order_id, Position traegt bestellId).
// Es gibt noch keine EDI-Bestellung: hier nur vorgesehen und getestet.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { leseKorb } from '../lib/lshopKorb.js';
import { _resetLShopCache } from '../lib/lshop.js';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { SENDUNGEN_TAB, SENDUNGEN_SPALTEN } from '../utils/lshop-belege.js';
import { machSheets, grundTabs, NR } from './hilfen/korb-sheet.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von = html.indexOf('// ── Sendung-Anzeige: Anfang');
const bis = html.indexOf('// ── Sendung-Anzeige: Ende ──');
const { sendungHtml, unterwegsHtml } = new Function(`${html.slice(von, bis)}\nreturn { sendungHtml, unterwegsHtml };`)();

const s2 = { frachtfuehrer: ['DHL'], offen: 2, pakete: [
  { paketnummer: '1', la: 'LA1', url: 'https://textilelogistics.eu/tracking/de/1/00000/VA1' },
  { paketnummer: '2', la: 'LA2', url: 'https://textilelogistics.eu/tracking/de/2/00000/VA1' },
] };

describe('Frontend-Block Sendung-Anzeige', () => {
  test('"versandt · DHL · 2 Pakete" mit Links in neuem Tab ohne Opener', () => {
    expect(von).toBeGreaterThan(-1);
    const h = sendungHtml(s2);
    expect(h).toContain('versandt · DHL · 2 Pakete');
    expect(h.match(/target="_blank" rel="noopener noreferrer" data-hilfe="tracking"/g)).toHaveLength(2);
    expect(h).toContain('>Paket 1</a> · <a');
    expect(sendungHtml({ frachtfuehrer: ['DHL'], pakete: [{ url: '' }] })).toBe('<span class="korb-sendung">versandt · DHL · 1 Paket</span>');
    expect(sendungHtml(null)).toBe('');
  });

  test('nur Links auf textilelogistics.eu; Text wird maskiert', () => {
    const h = sendungHtml({ frachtfuehrer: ['<b>X</b>'], pakete: [{ url: 'javascript:alert(1)' }, { url: 'https://textilelogistics.eu/a"onmouseover="x' }] });
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('<b>');
    expect(h).toContain('&#34;onmouseover');
  });

  test('"Unterwegs von L-Shop": nur order_ids mit offenen Paketen, sortiert', () => {
    expect(unterwegsHtml({})).toBe('');
    const h = unterwegsHtml({ 'JFN-2026-0005': s2, 'JFN-2026-0003': s2, 'JFN-2026-0004': { ...s2, offen: 0 } });
    expect(h).toContain('Unterwegs von L-Shop');
    expect(h.indexOf('JFN-2026-0003')).toBeLessThan(h.indexOf('JFN-2026-0005'));
    expect(h).not.toContain('JFN-2026-0004');
  });

  test('Korb zeigt die Sendung an bestellten Positionen; Filter "Bestellt" vorhanden; Uebersicht-Platz', () => {
    expect(html).toMatch(/const s = p\.bestellId \? korbZustand\.daten\?\.sendungen\?\.\[p\.bestellId\] : null;/);
    expect(html).toContain('id="uebersicht-unterwegs"');
    expect(html).toMatch(/unterwegs\.innerHTML = .*unterwegsHtml\(d\.sendungen\)/);
  });
});

describe('GET Korb: sendungen + bestellId', () => {
  beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; _resetLShopCache(); });
  const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'bestellt', Menge: '1', LShop_ArticleNr: NR, ...o }[s] ?? ''));

  test('liefert sendungen je order_id (ohne Portal) und bestellId an der Position', async () => {
    const tabs = grundTabs();
    tabs[TAB_KORB].push(korbZeile({ Schluessel: 'JFN:1:1', Bestellnummer: '1', Position: '1', Bestell_ID: 'JFN-2026-0003' }));
    tabs[SENDUNGEN_TAB] = [SENDUNGEN_SPALTEN,
      SENDUNGEN_SPALTEN.map(n => ({ Paketnummer: '1', order_id: 'JFN-2026-0003', Frachtfuehrer: 'DHL', Tracking_URL: 'https://textilelogistics.eu/x' }[n] ?? '')),
      SENDUNGEN_SPALTEN.map(n => ({ Paketnummer: '2', order_id: '', Frachtfuehrer: 'DHL' }[n] ?? '')),
    ];
    const r = await leseKorb({ shop: 'jfn', sheets: machSheets(tabs).sheets });
    expect(r.sendungen).toEqual({ 'JFN-2026-0003': { frachtfuehrer: ['DHL'], offen: 1, pakete: [{ paketnummer: '1', la: '', url: 'https://textilelogistics.eu/x' }] } });
    expect(r.buendel[0].positionen[0].bestellId).toBe('JFN-2026-0003');
  });

  test('ohne Reiter LShop_Sendungen: leere sendungen, kein Fehler', async () => {
    const r = await leseKorb({ shop: 'jfn', sheets: machSheets(grundTabs()).sheets });
    expect(r.sendungen).toEqual({});
  });
});
