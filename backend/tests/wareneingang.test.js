// BO4b-5 Schritt 1: "Ware angekommen" von Hand. Logik (utils/wareneingang.js), Schreibweg gegen ein
// In-Memory-Sheet (lib/wareneingang.js: nur bestellt -> geliefert, ein batchUpdate, Ruecklesen, Paket nur bei
// genau einem Paket, Rueckweg) und der Anzeige-Block in index.html. Alle Werte erfunden.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { KORB_SPALTEN, TAB_KORB } from '../utils/korb-logic.js';
import { SENDUNGEN_TAB, SENDUNGEN_SPALTEN } from '../utils/lshop-belege.js';
import { eingangPlan, paketeDerBestellung } from '../utils/wareneingang.js';
import { wareneingangBuchen, wareneingangZurueck } from '../lib/wareneingang.js';
import { machSheets, NR, NR2 } from './hilfen/korb-sheet.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ID = 'JFN-2026-0007';
const JETZT = () => new Date('2026-10-27T15:00:00Z');
const korbZeile = o => KORB_SPALTEN.map(s => ({ Shop: 'JFN', Herkunft: 'shop', Status: 'bestellt', Menge: '1', LShop_ArticleNr: NR, Bestell_ID: ID, ...o }[s] ?? ''));
const paket = o => SENDUNGEN_SPALTEN.map(s => ({ Paketnummer: '000000000001', VA: 'VA00000007', LA: 'LA00000007', order_id: ID, Frachtfuehrer: 'GLS', ...o }[s] ?? ''));

function aufbau({ pakete = [paket()], korb } = {}) {
  const tabs = {
    [TAB_KORB]: [KORB_SPALTEN, ...(korb ?? [
      korbZeile({ Schluessel: 'JFN:100:1', Bestellnummer: '100', Position: '1' }),
      korbZeile({ Schluessel: 'JFN:101:2', Bestellnummer: '101', Position: '2', LShop_ArticleNr: NR2, Menge: '3' }),
      korbZeile({ Schluessel: 'JFN:102:3', Bestellnummer: '102', Position: '3', Bestell_ID: 'JFN-2026-0008' }),
    ])],
    [SENDUNGEN_TAB]: [SENDUNGEN_SPALTEN, ...pakete],
  };
  const m = machSheets(tabs);
  const aufrufe = [];
  const bu = m.sheets.spreadsheets.values.batchUpdate;
  m.sheets.spreadsheets.values.batchUpdate = async a => { aufrufe.push(a.requestBody.data.map(d => d.range)); return bu(a); };
  return { tabs, sheets: m.sheets, aufrufe };
}
const sp = n => KORB_SPALTEN.indexOf(n);
const col = i => String.fromCharCode(65 + i);
const k = (tabs, z, n) => tabs[TAB_KORB][z][sp(n)] ?? '';
const eingang = (tabs, z = 1) => tabs[SENDUNGEN_TAB][z][SENDUNGEN_SPALTEN.indexOf('Wareneingang')] ?? '';
const wahl = (...s) => s.map(schluessel => ({ schluessel, status: 'bestellt' }));

beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot'; });

describe('eingangPlan', () => {
  const zeilen = [
    { Schluessel: 'A', Status: 'bestellt', Bestell_ID: ID, _zeile: 2 },
    { Schluessel: 'B', Status: 'geliefert', Bestell_ID: ID, _zeile: 3 },
    { Schluessel: 'C', Status: 'bestellt', Bestell_ID: 'JFN-2026-0001', _zeile: 4 },
    { Schluessel: 'D', Status: 'offen', Bestell_ID: '', _zeile: 5 },
  ];
  const sw = (...p) => [SENDUNGEN_SPALTEN, ...p];
  test('nur bestellt -> geliefert, nur Positionen der Bestellung; sonst 422 mit Liste', () => {
    const p = eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(paket()), orderId: ID, auswahl: wahl('A'), jetzt: 'T' });
    expect(p.korb).toEqual([{ zeile: 2, schluessel: 'A', werte: { Status: 'geliefert', Status_Datum: 'T', Stand: 'T' } }]);
    expect(() => eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(), orderId: ID, auswahl: [...wahl('A', 'C', 'X'), { schluessel: 'D', status: 'offen' }], jetzt: 'T' }))
      .toThrow(expect.objectContaining({ status: 422, probleme: [
        { schluessel: 'C', text: `gehört nicht zu ${ID}` }, { schluessel: 'X', text: 'nicht mehr im Korb' }, { schluessel: 'D', text: `gehört nicht zu ${ID}` },
      ] }));
    expect(() => eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(), orderId: ID, auswahl: [{ schluessel: 'B', status: 'bestellt' }], jetzt: 'T' }))
      .toThrow(expect.objectContaining({ status: 409 }));   // Browser sah bestellt, ist schon geliefert
  });
  test('Paket: genau eins -> Wareneingang; zwei oder keins -> nichts, Hinweis', () => {
    expect(eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(paket()), orderId: ID, auswahl: wahl('A'), jetzt: 'T' }).paket).toEqual({ zeile: 2, spalte: 'Wareneingang', alt: '', neu: 'T' });
    const zwei = eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(paket(), paket({ Paketnummer: '2' })), orderId: ID, auswahl: wahl('A'), jetzt: 'T' });
    expect(zwei).toMatchObject({ paket: null, hinweis: '2 Pakete - Wareneingang am Paket nicht zugeordnet' });
    expect(eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(), orderId: ID, auswahl: wahl('A'), jetzt: 'T' }).hinweis).toBe('noch keine Lieferbestätigung - kein Paket');
    expect(eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(paket({ Wareneingang: 'ALT' })), orderId: ID, auswahl: wahl('A'), jetzt: 'T' }).paket).toBeNull();
  });
  test('Rueckweg: nur geliefert -> bestellt; Wareneingang leeren, wenn danach nichts mehr geliefert ist', () => {
    const p = eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(paket({ Wareneingang: 'ALT' })), orderId: ID, auswahl: [{ schluessel: 'B', status: 'geliefert' }], jetzt: 'T', zurueck: true });
    expect(p.korb[0].werte.Status).toBe('bestellt');
    expect(p.paket).toEqual({ zeile: 2, spalte: 'Wareneingang', alt: 'ALT', neu: '' });
    expect(() => eingangPlan({ korbZeilen: zeilen, sendungenWerte: sw(), orderId: ID, auswahl: [{ schluessel: 'A', status: 'bestellt' }], jetzt: 'T', zurueck: true }))
      .toThrow(expect.objectContaining({ status: 422 }));
  });
  test('Eingaben: order_id-Muster, leere Auswahl, doppelte Schluessel im Korb', () => {
    expect(() => eingangPlan({ korbZeilen: zeilen, orderId: 'x', auswahl: wahl('A') })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => eingangPlan({ korbZeilen: zeilen, orderId: ID, auswahl: [] })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => eingangPlan({ korbZeilen: [...zeilen, zeilen[0]], orderId: ID, auswahl: wahl('A') })).toThrow(expect.objectContaining({ status: 409 }));
    expect(paketeDerBestellung([], ID)).toEqual({ idx: null, pakete: [] });
  });
});

describe('wareneingangBuchen / wareneingangZurueck', () => {
  test('ein batchUpdate: genau die Korb-Zellen + Wareneingang am einzigen Paket, zurueckgelesen; andere Bestellung unberuehrt', async () => {
    const { tabs, sheets, aufrufe } = aufbau();
    const vorher = JSON.stringify(tabs[TAB_KORB][3]);
    const r = await wareneingangBuchen({ orderId: ID, auswahl: wahl('JFN:100:1', 'JFN:101:2'), sheets, jetzt: JETZT });
    const erwartet = [2, 3].flatMap(z => ['Status', 'Status_Datum', 'Stand'].map(n => `'${TAB_KORB}'!${col(sp(n))}${z}`));
    erwartet.push(`'${SENDUNGEN_TAB}'!${col(SENDUNGEN_SPALTEN.indexOf('Wareneingang'))}2`);
    expect(aufrufe).toEqual([erwartet]);
    expect(r).toMatchObject({ ok: true, positionen: 2, status: 'geliefert', paket: 'Wareneingang gesetzt', hinweis: '' });
    expect([k(tabs, 1, 'Status'), k(tabs, 2, 'Status'), k(tabs, 1, 'Status_Datum')]).toEqual(['geliefert', 'geliefert', '2026-10-27T15:00:00.000Z']);
    expect(eingang(tabs)).toBe('2026-10-27T15:00:00.000Z');
    expect(JSON.stringify(tabs[TAB_KORB][3])).toBe(vorher);
  });

  test('Teil-Eingang: nicht gewaehlte Position bleibt bestellt; zweimal -> 409, nichts geschrieben', async () => {
    const { tabs, sheets, aufrufe } = aufbau();
    await wareneingangBuchen({ orderId: ID, auswahl: wahl('JFN:100:1'), sheets, jetzt: JETZT });
    expect(k(tabs, 2, 'Status')).toBe('bestellt');
    aufrufe.length = 0;
    await expect(wareneingangBuchen({ orderId: ID, auswahl: wahl('JFN:100:1'), sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 409 });
    expect(aufrufe).toEqual([]);
  });

  test('zwei Pakete: kein Wareneingang am Paket, Hinweis', async () => {
    const { tabs, sheets, aufrufe } = aufbau({ pakete: [paket(), paket({ Paketnummer: '000000000002' })] });
    const r = await wareneingangBuchen({ orderId: ID, auswahl: wahl('JFN:100:1'), sheets, jetzt: JETZT });
    expect(r).toMatchObject({ paket: '', hinweis: '2 Pakete - Wareneingang am Paket nicht zugeordnet' });
    expect(aufrufe[0].every(x => x.startsWith(`'${TAB_KORB}'`))).toBe(true);
    expect([eingang(tabs, 1), eingang(tabs, 2)]).toEqual(['', '']);
  });

  test('Rueckweg: geliefert -> bestellt, Wareneingang geleert, wenn nichts mehr geliefert ist', async () => {
    const { tabs, sheets } = aufbau();
    await wareneingangBuchen({ orderId: ID, auswahl: wahl('JFN:100:1', 'JFN:101:2'), sheets, jetzt: JETZT });
    await wareneingangZurueck({ orderId: ID, auswahl: [{ schluessel: 'JFN:100:1', status: 'geliefert' }], sheets, jetzt: JETZT });
    expect([k(tabs, 1, 'Status'), eingang(tabs)]).toEqual(['bestellt', '2026-10-27T15:00:00.000Z']);   // 101:2 noch geliefert
    const r = await wareneingangZurueck({ orderId: ID, auswahl: [{ schluessel: 'JFN:101:2', status: 'geliefert' }], sheets, jetzt: JETZT });
    expect(r).toMatchObject({ status: 'bestellt', paket: 'Wareneingang geleert' });
    expect([k(tabs, 2, 'Status'), eingang(tabs)]).toEqual(['bestellt', '']);
  });

  test('Ruecklesen weicht ab -> 500', async () => {
    const a = aufbau();
    const bu = a.sheets.spreadsheets.values.batchUpdate;
    a.sheets.spreadsheets.values.batchUpdate = async x => { await bu({ requestBody: { ...x.requestBody, data: x.requestBody.data.slice(1) } }); };
    await expect(wareneingangBuchen({ orderId: ID, auswahl: wahl('JFN:100:1'), sheets: a.sheets, jetzt: JETZT })).rejects.toMatchObject({ status: 500 });
  });
});

describe('Anzeige (Block L-Shop-Bestellungen) und Einbindung', () => {
  const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const von = html.indexOf('// ── L-Shop-Bestellungen: Anfang');
  const bis = html.indexOf('// ── L-Shop-Bestellungen: Ende ──');
  const { lbEingangKnopfHtml, lbEingangListeHtml, lbKarteHtml } = new Function(`${html.slice(von, bis)}\nreturn { lbEingangKnopfHtml, lbEingangListeHtml, lbKarteHtml };`)();
  const pos = (status, o = {}) => ({ schluessel: `S-${status}`, status, menge: 2, reference: 'JFN-100-1', catalogNr: 'JH030F', farbe: 'Deep Black', groesse: 'XL', articleNr: NR, ...o });
  const b = (...positionen) => ({ orderId: ID, va: [], erzeugt: '', gesendet: '', positionenZahl: positionen.length, stueck: 2, commission: '', versandart: '', status: 'versandt', pakete: 1, positionen, lieferscheine: [] });

  test('Knopf: "Ware angekommen …" bei offenen Positionen, "Wareneingang …" wenn alles geliefert, sonst keiner', () => {
    expect(lbEingangKnopfHtml(b(pos('bestellt')))).toContain(`data-eingang="${ID}" data-hilfe="ware-angekommen">Ware angekommen …</button>`);
    expect(lbEingangKnopfHtml(b(pos('geliefert')))).toContain('>Wareneingang …</button>');
    expect(lbEingangKnopfHtml(b(pos('offen')))).toBe('');
    expect(lbKarteHtml(b(pos('bestellt'), pos('geliefert')), true)).toContain('<span class="lb-geliefert">geliefert</span>');
  });
  test('Liste: bestellt vorgewaehlt, geliefert mit Rueckweg, maskiert', () => {
    const h = lbEingangListeHtml(b(pos('bestellt', { reference: 'Lager <Croco>' }), pos('geliefert')));
    expect(h).toContain('data-we-pos="S-bestellt" checked>');
    expect(h).toContain('Lager &#60;Croco&#62;');
    expect(h).toContain('data-we-zurueck="S-geliefert" data-hilfe="we-zurueck">zurück auf bestellt</button>');
  });
  test('Einbindung: Dialog, Endpunkte, Bestaetigung beim Rueckweg', () => {
    expect(html).toMatch(/<div id="we-dialog"[^>]*hidden>/);
    expect(html).toContain("weSenden('wareneingang', auswahl,");
    expect(html).toMatch(/showConfirm\('Zurück auf bestellt\?'[\s\S]{0,200}weSenden\('wareneingang\/zurueck'/);
  });
});
