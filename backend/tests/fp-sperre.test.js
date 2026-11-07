// PA8: FP-Sperre - kein stiller Festpreis 0 mehr. Nur erfundene Daten und Preise (12,34 / 0,66 / 7,77).
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';

jest.unstable_mockModule('googleapis', () => ({ google: { sheets: jest.fn() } }));
jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
jest.unstable_mockModule('../lib/shopConfig.js', () => ({ getWcClient: jest.fn() }));

const hier = dirname(fileURLToPath(import.meta.url));
let request, app, tabs, aufrufe, wcOrders, wcStorno;
let berechneFestpreisAnteil, fpSperre, fpArtikel, chat, fpAnlegen;

const V_KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling',
  'Porto-Einnahme', 'Porto-Kosten', 'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto',
  'Status Abrechnung', 'Produkt-ID', 'Storno-Status', 'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten', 'Versandmethode'];
const A_KOPF = ['Partner-ID', 'Produkt-ID', 'Artikelname', 'Festpreis-EK-Netto', 'Handling-Gebühr', 'Versandart', 'WC-Kategorie', 'Artikelkategorie'];
const ABGERECHNET = ['FP-001', '01.10.2026', '400', 'Puck alt', 0, 1, 0, 0, 0, 0, 0, 0, 9, 10.71, 'abgerechnet', '13', '', 'Puck', 0, 0, 9, 0, 'flat_rate'];
const TOKEN = 'erfundener-portal-token-pa8';

function grund() {
  return {
    FP_Partner: [['Partner-ID', 'Name', 'Shop', 'Aktiv', 'Notiz', 'Token', 'Kategorien'], ['FP-001', 'Testclub', 'jfn', 'Ja', '', TOKEN, '']],
    FP_Artikel: [A_KOPF,
      ['FP-001', '11', 'Shirt', '7.77', '0', 'P', 'Club', 'T-Shirt'],
      ['FP-001', '12', 'Schal', '', '', 'P', 'Club', 'Schal'],          // bewusst Festpreis 0
      ['FP-001', '13', 'Puck', '', '', 'P', 'Club', ''],                 // Kategorie leer
      ['FP-001', '14', 'Mütze', '', '', 'P', 'Club', 'Unbekannt']],      // Kategorie ohne Festpreis-Zeile
    FP_Artikel_Kategorie: [['Kategorie', 'Festpreispartner-ID', 'Festpreis', 'Handlingskosten'],
      ['T-Shirt', 'FP-001', 12.34, 0.66], ['Schal', 'FP-001', 0, 0]],
    Kalkulation_Fixkosten: [['Position', 'Wert', 'Gültig_ab', 'Gültig_bis'], ['MwSt', '19', '', '']],
    'FP_Verkäufe': [V_KOPF, [...ABGERECHNET]],
    FP_Abrechnungen: [['Abrechnungs-ID', 'Partner-ID']],
    Partner_Interne_Bestellungen: [['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status']],
  };
}
const ORDER = {
  id: 500, date_created: '2026-11-05T10:00:00', date_modified: '2026-11-06T10:00:00', shipping_total: '4', shipping_lines: [{ method_id: 'flat_rate' }],
  line_items: [
    { product_id: 11, variation_id: 0, name: 'Shirt', quantity: 1, total: '20' },
    { product_id: 12, variation_id: 0, name: 'Schal', quantity: 1, total: '10' },
    { product_id: 13, variation_id: 0, name: 'Puck', quantity: 2, total: '15' },
    { product_id: 14, variation_id: 0, name: 'Mütze', quantity: 1, total: '8' },
  ],
};

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  ({ default: request } = await import('supertest'));
  const { default: express } = await import('express');
  const { google } = await import('googleapis');
  google.sheets.mockImplementation(() => machSheets(tabs).sheets);
  const { getWcClient } = await import('../lib/shopConfig.js');
  getWcClient.mockImplementation(() => ({ get: async (pfad, q) => {
    if (pfad !== 'orders') return { data: [] };
    if (['refunded', 'cancelled'].includes(q.status)) return { data: q.page === 1 ? wcStorno : [] };
    return { data: q.page === 1 && q.status === 'completed' ? wcOrders : [] };
  } }));
  ({ berechneFestpreisAnteil } = await import('../utils/festpreis-kalkulation.js'));
  fpSperre = await import('../utils/fp-sperre.js');
  fpArtikel = await import('../utils/fp-artikel.js');
  chat = await import('../lib/chatNotify.js');
  fpAnlegen = await import('../lib/fpArtikelAnlegen.js');
  app = express();
  app.use(express.json());
  app.use('/api/festpreis', (await import('../routes/festpreis-portal.js')).default);
  app.use('/api/festpreis-public', (await import('../routes/festpreis-public.js')).default);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  tabs = grund();
  wcOrders = [ORDER];
  wcStorno = [];
  aufrufe = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const V = () => tabs['FP_Verkäufe'];
const h = c => V()[0].indexOf(c);
const zeileZu = (pid, storno = false) => V().find(r => String(r[h('Produkt-ID')]) === pid && String(r[h('Status Abrechnung')]) !== 'abgerechnet' && (!!String(r[h('Storno-Status')] ?? '') === storno));

describe('Sync: Sperre statt Festpreis 0', () => {
  test('fehlende/leere Kategorie -> gesperrt (Betraege leer, Grund in X), bewusst 0 -> offen; kein append; abgerechnet unveraendert', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const res = await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ synced: 4, gesperrt: 2, ohneFestpreisAnzahl: 2 });
    expect(V()[0][23]).toBe('Sperre');
    const s = zeileZu('11'), schal = zeileZu('12'), puck = zeileZu('13'), muetze = zeileZu('14');
    expect(s[h('Status Abrechnung')]).toBe('offen');
    expect(s[h('Festpreis')]).toBe(12.34);
    expect(schal[h('Status Abrechnung')]).toBe('offen');
    expect(schal[h('Festpreis')]).toBe(0);
    for (const g of [puck, muetze]) {
      expect(g[h('Status Abrechnung')]).toBe('gesperrt');
      expect(g[23]).toBe('Festpreis-Kategorie fehlt');
      for (const b of ['Festpreis', 'Handlingskosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto']) expect(g[h(b)]).toBe('');
      expect(Number(g[h('VK-Netto')])).toBeGreaterThan(0);   // Eingaben bleiben fuers Nachrechnen
    }
    expect(V()[1]).toEqual(ABGERECHNET);
    expect(JSON.stringify(res.body)).not.toMatch(/12\.34|0\.66|7\.77/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/12\.34|0\.66/);
  });

  test('gesperrt nicht abrechenbar und nicht im Portal-Saldo; Portal zeigt "in Prüfung" ohne Betraege/Grund', async () => {
    await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    const sum = await request(app).get('/api/festpreis/verkaeufe/summary').query({ partnerId: 'FP-001', vonDatum: '01.11.2026', bisDatum: '30.11.2026' });
    expect(sum.body.produkteGruppen.map(g => g.produktId).sort()).toEqual(['11', '12']);
    expect(sum.body.sperre).toMatchObject({ gesperrtImZeitraum: 2 });
    expect(sum.body.sperre.hinweise[0]).toMatch(/2 Zeile\(n\) im Zeitraum gesperrt – Festpreis-Kategorie fehlt/);
    const abr = await request(app).post('/api/festpreis/abrechnungen').send({ partnerId: 'FP-001', vonDatum: '01.11.2026', bisDatum: '30.11.2026' });
    expect(abr.status).toBe(201);
    expect(abr.body.positionen ?? abr.body.sperre).toBeTruthy();
    expect(zeileZu('13')[h('Status Abrechnung')]).toBe('gesperrt');          // nicht abgerechnet
    const saldo = await request(app).get('/api/festpreis-public/saldo').set('Authorization', `Bearer ${TOKEN}`);
    expect(saldo.status).toBe(200);
    const portal = await request(app).get('/api/festpreis-public/verkaeufe').set('Authorization', `Bearer ${TOKEN}`);
    const p13 = portal.body.find(r => String(r['Produkt-ID']) === '13');
    expect(p13['Status Abrechnung']).toBe('in Prüfung');
    expect(p13).not.toHaveProperty('Sperre');
    expect(p13).not.toHaveProperty('Gesamt-Partner-Netto');
    expect(p13).not.toHaveProperty('Festpreis');
  });

  test('Saldo ohne gesperrte Zeilen: identisch, ob die gesperrten da sind oder nicht', async () => {
    await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    const mit = (await request(app).get('/api/festpreis-public/saldo').set('Authorization', `Bearer ${TOKEN}`)).body.saldoBrutto;
    tabs['FP_Verkäufe'] = V().filter(r => String(r[h('Status Abrechnung')]) !== 'gesperrt');
    const ohne = (await request(app).get('/api/festpreis-public/saldo').set('Authorization', `Bearer ${TOKEN}`)).body.saldoBrutto;
    expect(mit).toBe(ohne);
  });

  test('Mehrkosten an gesperrter Zeile -> 409, nichts geschrieben', async () => {
    await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    const zeile = V().indexOf(zeileZu('13')) + 1;
    const vorher = JSON.stringify(V());
    const res = await request(app).patch(`/api/festpreis/verkaeufe-eintrag/${zeile}`).send({ mehrkosten: 1 });
    expect(res.status).toBe(409);
    expect(JSON.stringify(V())).toBe(vorher);
  });
});

describe('Nachrechnen', () => {
  test('Kategorie gesetzt -> offen mit dem dann gueltigen Festpreis (Rechnung wie der Mehrkosten-Weg); andere bleiben gesperrt', async () => {
    await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    tabs.FP_Artikel[3][7] = 'T-Shirt';   // Puck bekommt eine Kategorie
    const res = await request(app).post('/api/festpreis/verkaeufe/nachrechnen').send({});
    expect(res.body).toMatchObject({ nachgerechnet: 1, nochGesperrt: 1, produktIds: ['13'] });
    const p = zeileZu('13');
    expect(p[h('Status Abrechnung')]).toBe('offen');
    expect(p[h('Artikelkategorie')]).toBe('T-Shirt');
    expect(p[h('Festpreis')]).toBe(12.34);
    expect(p[23]).toBe('');
    const soll = berechneFestpreisAnteil({
      vkNetto: Number(p[h('VK-Netto')]), festpreisEK: 12.34, handlingskosten: 0.66, stueckzahl: 2, mehrkosten: 0,
      portoEinnahmeAnteil: Number(p[h('Porto-Einnahme')]), portoKostenAnteil: Number(p[h('Porto-Kosten')]),
      versandnkAnteil: Number(p[h('Versandnebenkosten')]), paypalKosten: Number(p[h('PayPal-Kosten')]), mwstProzent: 19,
    });
    expect(p[h('Gesamt-Partner-Netto')]).toBe(soll.netto);
    expect(p[h('Gesamt-Partner-Brutto')]).toBe(soll.brutto);
    expect(zeileZu('14')[h('Status Abrechnung')]).toBe('gesperrt');
    expect(V()[1]).toEqual(ABGERECHNET);
    expect(JSON.stringify(res.body)).not.toMatch(/12\.34/);
  });

  test('der naechste Sync rechnet zuerst nach; Trockenlauf schreibt nichts', async () => {
    await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    tabs.FP_Artikel[4][7] = 'Schal';
    const vorher = JSON.stringify(V());
    const tl = await request(app).post('/api/festpreis/verkaeufe/nachrechnen').send({ dryRun: true });
    expect(tl.body).toMatchObject({ dryRun: true, nachgerechnet: 1 });
    expect(JSON.stringify(V())).toBe(vorher);
    const res = await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    expect(res.body).toMatchObject({ nachgerechnet: 1, synced: 0 });
    expect(zeileZu('14')[h('Status Abrechnung')]).toBe('offen');
    expect(zeileZu('14')[h('Festpreis')]).toBe(0);   // bewusst 0 ueber die Kategorie Schal
  });

  test('Storno einer gesperrten Zeile ist gesperrt; nachgerechnet mit negierten Betraegen', async () => {
    await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    wcOrders = []; wcStorno = [ORDER];
    await request(app).post('/api/festpreis/verkaeufe/sync').send({ after: '2026-11-01T00:00:00' });
    const st = zeileZu('13', true);
    expect(st[h('Status Abrechnung')]).toBe('gesperrt');
    expect(st[23]).toBe('Festpreis-Kategorie fehlt');
    expect(st[h('Gesamt-Partner-Netto')]).toBe('');
    expect(zeileZu('11', true)[h('Status Abrechnung')]).toBe('offen');
    tabs.FP_Artikel[3][7] = 'T-Shirt';
    await request(app).post('/api/festpreis/verkaeufe/nachrechnen').send({});
    const orig = zeileZu('13'), neu = zeileZu('13', true);
    expect(neu[h('Status Abrechnung')]).toBe('offen');
    expect(neu[h('Gesamt-Partner-Netto')]).toBe(-orig[h('Gesamt-Partner-Netto')]);
    expect(neu[h('Festpreis')]).toBe(-12.34);
  });

  test('abgerechnete und offene Zeilen fasst das Nachrechnen nie an', () => {
    const kopf = [...V_KOPF, 'Sperre'];
    const z = [[...ABGERECHNET, ''], ['FP-001', '01.11.2026', '1', 'X', 0, 1, 0, 0, 0, 0, 0, 0, 5, 6, 'offen', '13', '', '', 0, 0, 5, 0, 'flat_rate', '']];
    z.forEach((r, i) => { r._sheetRow = i + 2; });
    const { plan } = fpSperre.nachrechnenPlan({ kopf, zeilen: z, kategorieFuer: () => 'T-Shirt', zuordnungen: new Map([['FP-001|T-Shirt', { festpreis: 1, handlingskosten: 0 }]]), mwstProzent: 19 });
    expect(plan).toEqual([]);
  });
});

describe('Logik', () => {
  test('Zuordnung: leer oder ohne Zeile = null, bewusst 0 = gueltig', () => {
    const m = fpSperre.festpreisZuordnungen(['Kategorie', 'Festpreispartner-ID', 'Festpreis', 'Handlingskosten'], [['Schal', 'FP-001', '0', '0'], ['T-Shirt', 'FP-001', '12,34', '0,66']]);
    expect(fpSperre.zuordnungFuer(m, 'FP-001', 'Schal')).toEqual({ festpreis: 0, handlingskosten: 0 });
    expect(fpSperre.zuordnungFuer(m, 'FP-001', 'T-Shirt')).toEqual({ festpreis: 12.34, handlingskosten: 0.66 });
    expect(fpSperre.zuordnungFuer(m, 'FP-001', '')).toBeNull();
    expect(fpSperre.zuordnungFuer(m, 'FP-001', 'Puck')).toBeNull();
    expect(fpSperre.zuordnungFuer(m, 'FP-002', 'Schal')).toBeNull();
  });
  test('Zaehler fuer MC/Chat: nur Anzahl + Produkt-IDs', () => {
    const kopf = [...V_KOPF, 'Sperre'];
    const g = (pid) => ['FP-001', '01.11.2026', '1', 'X', 0, 1, 0, 0, 0, 0, 0, 0, '', '', 'gesperrt', pid, '', '', '', 0, 5, '', 'flat_rate', 'Festpreis-Kategorie fehlt'];
    expect(fpSperre.gesperrtZaehlen(kopf, [g('13'), g('13'), g('14'), ABGERECHNET])).toEqual({ anzahl: 3, jePartner: [{ partnerId: 'FP-001', anzahl: 3, produktIds: ['13', '14'] }] });
  });
});

describe('Taeglicher Abgleich (Variante A)', () => {
  test('legt fehlende Artikel OHNE Artikelkategorie und ohne Festpreis/EK an, keine Dubletten, kein append', async () => {
    const { sheets, aufrufe: a } = machSheets(tabs);
    const befund = [{ id: 'FP-001', fehlend: [{ produktId: '21', name: 'Neu', wcKategorie: 'Club' }, { produktId: '11', name: 'Shirt' }, { produktId: '21', name: 'Neu' }] }];
    const r = await fpAnlegen.fpFehlendeAnlegen({ sheets, sheetId: 'x', befund });
    expect(r.angelegt).toEqual([{ partnerId: 'FP-001', produktId: '21' }]);
    const neu = tabs.FP_Artikel.at(-1);
    expect(neu).toEqual(['FP-001', '21', 'Neu', '', '', 'P', 'Club', '']);
    expect(a.append).toBe(0);
    // ... und der Sync sperrt dessen Verkaeufe statt mit 0 zu rechnen
    wcOrders = [{ ...ORDER, id: 501, line_items: [{ product_id: 21, variation_id: 0, name: 'Neu', quantity: 1, total: '9' }] }];
    const res = await request(app).post('/api/festpreis/verkaeufe/sync').send({});
    expect(res.body.gesperrt).toBe(1);
    expect(zeileZu('21')[h('Status Abrechnung')]).toBe('gesperrt');
  });
  test('Chat: angelegt + gesperrt, nur Anzahl/IDs, keine Preise', () => {
    const t = chat.buildArtikelAbgleichNachricht({ partner: [], festpreis: { partner: [{
      id: 'FP-001', fehlend: [{ produktId: '21' }, { produktId: '22' }], angelegt: [{ produktId: '21' }], ohneFestpreis: [], kategorienWeg: [], gesperrt: 3, gesperrtIds: ['13', '14'],
    }] } });
    expect(t).toContain('1 neue Artikel angelegt (IDs 21) – bitte Artikelkategorie setzen, Verkäufe bis dahin gesperrt');
    expect(t).toContain('1 neue Artikel ohne Eintrag (IDs 22)');
    expect(t).toContain('3 Verkäufe gesperrt – Festpreis-Kategorie fehlt (IDs 13, 14)');
    expect(t).not.toMatch(/€|\d+,\d\d|\d+\.\d\d/);
  });
  test('Abgleich-Route ruft das Anlegen und den Sperren-Zaehler auf', () => {
    const r = readFileSync(resolve(hier, '../routes/partner-artikel.js'), 'utf8');
    expect(r).toMatch(/fpFehlendeAnlegen\(\{ sheets, sheetId, befund: fp\.partner \}\)/);
    expect(r).toMatch(/leseGesperrte\(/);
  });
});

describe('Quelltext und Oberflaeche', () => {
  test('Sync schreibt FP_Verkaeufe ohne append und ohne stillen Festpreis 0', () => {
    const r = readFileSync(resolve(hier, '../routes/festpreis-portal.js'), 'utf8');
    const sync = r.slice(r.indexOf('async function fpSyncInSperre'), r.indexOf("router.post('/verkaeufe/nachrechnen'"));
    expect(sync).not.toMatch(/values\.append\(/);
    expect(sync).not.toMatch(/\?\? \{ festpreis: 0, handlingskosten: 0 \}/);
    expect(sync).toMatch(/schreibeNeueZeilen\(/);
    expect(sync).toMatch(/nachrechnenInSperre\(/);
  });
  test('keine Betraege im Log der neuen Stellen', () => {
    for (const d of ['../lib/fpSperre.js', '../utils/fp-sperre.js', '../lib/fpArtikelAnlegen.js']) {
      const z = readFileSync(resolve(hier, d), 'utf8').split('\n').filter(x => /console\.\w+\(/.test(x));
      for (const x of z) expect(x).not.toMatch(/festpreis|netto|brutto|betrag/i);
    }
  });
  test('MC: Hinweis, zum Artikel, nachrechnen, Abrechnungshinweis (escaped, ohne title)', () => {
    const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
    const a = html.indexOf('// ── PA7 Festpreis-Hinweis: Anfang'), b = html.indexOf('// ── PA8 FP-Sperre: Ende ──');
    const F = new Function(`${html.slice(a, b)}\nreturn { fpSperreHinweisHtml, fpSperreAbrText, fpNachrechnenText };`)();
    expect(F.fpSperreHinweisHtml({ anzahl: 0, jePartner: [] })).toBe('');
    const x = F.fpSperreHinweisHtml({ anzahl: 2, jePartner: [{ partnerId: 'FP-001', anzahl: 2, produktIds: ['13', '<b>'] }] });
    expect(x).toContain('2 gesperrt – Festpreis-Kategorie fehlt');
    expect(x).toContain('data-fp-sperre-artikel="FP-001"');
    expect(x).toContain('data-fp-nachrechnen');
    expect(x).toContain('&lt;b&gt;');
    expect(x).not.toMatch(/ title=/);
    expect(F.fpSperreAbrText({ hinweise: ['2 Zeile(n) im Zeitraum gesperrt'] })).toBe('⚠ 2 Zeile(n) im Zeitraum gesperrt');
    expect(F.fpNachrechnenText({ nachgerechnet: 1, nochGesperrt: 1 })).toMatch(/1 gesperrte Verkäufe nachgerechnet, 1 weiter gesperrt/);
    for (const k of ['fp-sperre', 'fp-sperre-artikel', 'fp-nachrechnen']) expect(html).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
    expect(html).toContain('<option value="gesperrt">Gesperrt</option>');
    expect(html).not.toMatch(/mit Festpreis 0 übernommen/);
  });
});
