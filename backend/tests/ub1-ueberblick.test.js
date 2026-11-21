// UB1: Dashboard "Überblick" - offene Bestellungen nach Alter, eigene Auftraege nach Status. Nur erfundene Daten, feste Uhr.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { baueDashboard, alterKlassen, statusZahlen, ALTER_KLASSEN, UEBERBLICK_STATUS, LANGE_AB_TAGE, ROT_AB_TAGE } from '../utils/dashboard.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = f => readFileSync(resolve(hier, `../../frontend/${f}`), 'utf8');
const html = lies('index.html');
const block = (h, anfang, ende) => {
  const a = h.indexOf(anfang), e = h.indexOf(ende);
  expect(a).toBeGreaterThan(-1); expect(e).toBeGreaterThan(a);
  return h.slice(a, e);
};
const norm = b => b.split('\n').map(l => l.trim()).join('\n');
const DG = ['// ── Diagramme: Anfang', '// ── Diagramme: Ende'];
const F = new Function(`${block(html, ...DG)}\n${block(html, '// ── Dashboard-Anzeige: Anfang', '// ── Dashboard-Anzeige: Ende')}\n`
  + `${block(html, '// ── Dashboard-Vorlesen: Anfang', '// ── Dashboard-Vorlesen: Ende')}\n`
  + 'return { dgStapel, dbUeberblickHtml, ubSatzAlter, ubSatzStatus, dbVorleseSaetze, UB_ALTER, UB_STATUS, UB_ALTER_FARBE, UB_STATUS_FARBE };')();

// 20.11. 23:30 UTC = 21.11. 00:30 in Berlin: "heute" ist der 21.11. (UTC waere noch der 20.11.)
const JETZT = new Date('2026-11-20T23:30:00Z');
const best = (datum, extra = {}) => ({ art: 'shop', shop: 'jfn', shopKurz: 'JFN', id: 1, nr: '1', status: 'processing', datum, betrag: 0, trikot: false, ...extra });
const au = (Status, extra = {}) => ({ Auftrag_Nr: `AU-2026-${String(Math.random()).slice(2, 6)}`, Status, Kunden_Nr: 'K-00001', Angelegt: '2026-11-01T10:00:00Z', ...extra });

describe('Altersklassen (Kalendertage Europe/Berlin)', () => {
  test('Grenzen 3/4, 7/8, 14/15', () => {
    expect(alterKlassen([0, 3, 4, 7, 8, 14, 15, 99, null, 'x'])).toEqual({ k0_3: 2, k4_7: 2, k8_14: 2, k15: 2, gesamt: 8 });
    expect(alterKlassen([])).toEqual({ k0_3: 0, k4_7: 0, k8_14: 0, k15: 0, gesamt: 0 });
    // dieselben Grenzen wie die Kachel "Wartet lange" (> 7) und ihr Rot (> 14)
    expect(ALTER_KLASSEN.map(k => k.bis)).toEqual([3, LANGE_AB_TAGE, ROT_AB_TAGE, Infinity]);
  });
  test('baueDashboard: Tage nach Berliner Kalendertag, mit fester Uhr', () => {
    const offen = ['2026-11-18T23:50:00', '2026-11-17T08:00:00', '2026-11-14T12:00:00', '2026-11-13T12:00:00', '2026-11-07T00:10:00', '2026-11-06T23:59:00']
      .map((d, i) => best(d, { id: i, nr: String(i) }));
    const d = baueDashboard({ shops: { jfn: { offen, neu: [], woche: [] } }, shop: 'jfn', jetzt: JETZT });
    // 18.11. = 3 Tage, 17.11. = 4, 14.11. = 7, 13.11. = 8, 07.11. = 14, 06.11. = 15
    expect(d.ueberblick.alter).toEqual([{ shop: 'jfn', shopKurz: 'JFN', k0_3: 1, k4_7: 2, k8_14: 2, k15: 1, gesamt: 6 }]);
  });
  test('wie "wartend": nur offene Shop-Bestellungen ohne Trikots; fehlt der Shop, steht "fehlt"', () => {
    const offen = [best('2026-11-20T10:00:00'), best('2026-11-20T10:00:00', { trikot: true }), best('2026-11-01T10:00:00', { status: 'completed' })];
    const d = baueDashboard({ shops: { jfn: { offen, neu: [], woche: [] } }, shop: 'jfn', jetzt: JETZT });
    expect(d.ueberblick.alter[0].gesamt).toBe(1);
    const ohne = baueDashboard({ shops: {}, shop: 'honk', jetzt: JETZT, fehler: { shop_honk: 'x' } });
    expect(ohne.ueberblick.alter).toEqual([{ shop: 'honk', shopKurz: 'HONK', fehlt: ['shop_honk'] }]);
  });
});

describe('Auftraege nach Status', () => {
  test('Reihenfolge wie im Auftragsreiter, abgeschlossene zaehlen nicht, 0 bleibt drin', () => {
    expect(UEBERBLICK_STATUS).toEqual(['Anfrage', 'Angebot', 'Design', 'bestellt', 'in Produktion', 'fertig', 'übergeben']);
    expect(statusZahlen([au('Design'), au('Design'), au('fertig'), au('bezahlt'), au('storniert')]))
      .toEqual({ Anfrage: 0, Angebot: 0, Design: 2, bestellt: 0, 'in Produktion': 0, fertig: 1, 'übergeben': 0 });
    expect(statusZahlen([])).toEqual(Object.fromEntries(UEBERBLICK_STATUS.map(s => [s, 0])));
  });
  test('baueDashboard: Zustaendig-Filter, Termin in 7 Tagen, Quelle fehlt', () => {
    const auftraege = [au('Design', { Zustaendig: 'Nicole', Termin: '2026-11-25' }), au('bestellt', { Zustaendig: 'Christian', Termin: '2026-12-31' }), au('Angebot', { Zustaendig: 'Nicole' })];
    const alle = baueDashboard({ au: { auftraege }, jetzt: JETZT }).ueberblick.status;
    expect([alle.Design, alle.bestellt, alle.Angebot, alle.terminBald]).toEqual([1, 1, 1, 1]);
    const nicole = baueDashboard({ au: { auftraege }, wer: 'Nicole', jetzt: JETZT }).ueberblick.status;
    expect([nicole.Design, nicole.bestellt, nicole.Angebot]).toEqual([1, 0, 1]);
    expect(baueDashboard({ jetzt: JETZT, fehler: { auftraege: 'x' } }).ueberblick.status).toEqual({ fehlt: ['auftraege'] });
  });
});

describe('Oberflaeche', () => {
  test('Baustein "Diagramme" wortgleich in MC und beiden Portalen', () => {
    const mc = norm(block(html, ...DG));
    expect(mc).toContain('function dgStapel(');
    expect(norm(block(lies('partner.html'), ...DG))).toBe(mc);
    expect(norm(block(lies('partner-festpreis.html'), ...DG))).toBe(mc);
  });
  test('Spiegel: Klassen und Status wie im Backend', () => {
    expect(F.UB_ALTER.map(([k]) => k)).toEqual(ALTER_KLASSEN.map(k => k.id));
    expect(F.UB_STATUS).toEqual(UEBERBLICK_STATUS);
  });
  test('Farben: nur var(--…), kein Rot; ueber 14 Tage --warning', () => {
    const farben = [...Object.values(F.UB_ALTER_FARBE), ...Object.values(F.UB_STATUS_FARBE)].join(' ');
    expect(farben).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|--danger/i);
    expect(F.UB_ALTER_FARBE.k15).toBe('var(--warning)');
  });
  test('Abschnitt unter "Zu tun", vor "Neu in 24 h"; auf/zu wird gemerkt, Handy zu', () => {
    const a = html.indexOf('id="dash-zutun"'), u = html.indexOf('id="dash-ueberblick"'), n = html.indexOf('id="dash-neu"');
    expect(a).toBeLessThan(u); expect(u).toBeLessThan(n);
    expect(html).toContain("const DB_UB_KEY = 'mc_dash_ueberblick';");
    expect(html).toContain("d.open = wahl ? wahl === 'auf' : !window.matchMedia?.('(max-width: 600px)').matches;");
  });
  test('Alter: Leiste + Satz, keine Knoepfe (kein Altersfilter); Status: Knoepfe auf vorhandene Filter', () => {
    const u = { alter: [{ shop: 'jfn', shopKurz: 'JFN', k0_3: 18, k4_7: 9, k8_14: 5, k15: 2, gesamt: 34 }],
      status: { Anfrage: 0, Angebot: 0, Design: 6, bestellt: 4, 'in Produktion': 3, fertig: 2, 'übergeben': 1, terminBald: 2 } };
    const h = F.dbUeberblickHtml(u);
    expect(h).toContain('Offene Bestellungen nach Alter · JFN');
    expect(h).toContain('34 offene Bestellungen, davon 2 länger als 14 Tage.');
    expect(h).not.toMatch(/data-dash-ub-alter/);
    expect((h.match(/data-dash-ub-status="/g) ?? []).length).toBe(5);   // Anfrage/Angebot ohne Bestand fehlen
    expect(h).toContain('Offene eigene Aufträge: 6 in Design, 4 bestellt, 3 in Produktion, 2 fertig, 1 übergeben, nicht bezahlt.');
    expect(h).toContain('Termin in den nächsten 7 Tagen: <strong>2</strong>');
    const optionen = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
    for (const s of UEBERBLICK_STATUS) expect(optionen).toContain(s);   // jeder Status ist ein vorhandener Filter
    expect(optionen).toContain('termin');
    // Altstatus erscheint, sobald es Auftraege darin gibt
    expect(F.dbUeberblickHtml({ alter: [], status: { ...u.status, Angebot: 1 } })).toContain('data-dash-ub-status="Angebot"');
  });
  test('leer und fehlend', () => {
    const h = F.dbUeberblickHtml({ alter: [{ shop: 'jfn', shopKurz: 'JFN', k0_3: 0, k4_7: 0, k8_14: 0, k15: 0, gesamt: 0 }],
      status: Object.fromEntries([...UEBERBLICK_STATUS.map(s => [s, 0]), ['terminBald', 0]]) });
    expect(h).toContain('Keine offenen Bestellungen.');
    expect(h).toContain('Keine offenen eigenen Aufträge.');
    expect(h).toContain('dg-stapel-leer');
    expect(F.dbUeberblickHtml({ alter: [{ shop: 'honk', shopKurz: 'HONK', fehlt: ['shop_honk'] }], status: { fehlt: ['auftraege'] } }))
      .toContain('nicht geladen: Shop HONK');
    expect(F.dbUeberblickHtml(null)).toContain('–');
  });
  test('Saetze', () => {
    expect(F.ubSatzAlter({ gesamt: 1, k15: 1 })).toBe('Eine offene Bestellung – sie wartet länger als 14 Tage.');
    expect(F.ubSatzAlter({ gesamt: 5, k8_14: 2 })).toBe('5 offene Bestellungen, davon 2 länger als 7 Tage.');
    expect(F.ubSatzAlter({ gesamt: 3, k0_3: 3 })).toBe('3 offene Bestellungen, keine älter als 7 Tage.');
  });
  test('Vorlesen: nur Zahlen, nur was > 0', () => {
    const d = { shop: 'jfn', kacheln: {}, neu: [], fehler: [],
      ueberblick: { alter: [{ shop: 'jfn', k15: 3, gesamt: 9 }], status: { Design: 2, bestellt: 0, terminBald: 1 } } };
    const s = F.dbVorleseSaetze(d, new Date('2026-11-21T09:00:00Z')).join(' ');
    expect(s).toContain('3 Bestellungen im Jammifashion Shop warten länger als 14 Tage.');
    expect(s).toContain('Offene eigene Aufträge: 2 in Design.');
    expect(s).toContain('Ein Auftrag hat Termin in den nächsten 7 Tagen.');
    const leer = F.dbVorleseSaetze({ ...d, ueberblick: { alter: [{ shop: 'jfn', k15: 0, gesamt: 4 }], status: { Design: 0, terminBald: 0 } } }, new Date('2026-11-21T09:00:00Z')).join(' ');
    expect(leer).not.toMatch(/14 Tage|eigene Aufträge|Termin/);
  });
});
