// Festpreis-Abrechnung: eine Auswahl/Rechnung fuer Vorschau, Abrechnung, Portal-Saldo; Storno hebt den Verkauf auf;
// Loeschen setzt nur die eigenen Zeilen zurueck; Status nur vorwaerts. Erfundene Betraege.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  aggregateFpVerkaeufe, fpAbrechnungsZeilen, fpZeilenSchluessel, fpLoeschPlan, internSchluessel,
  fpStatusWechselErlaubt, lizenzStatusWechselErlaubt, zeilenZuSchluesseln,
} from '../utils/fp-abrechnung.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = rel => readFileSync(resolve(hier, '..', rel), 'utf8');

const KOPF = ['Partner-ID', 'Datum', 'WC-Bestellnummer', 'Artikelname', 'Variante', 'Stückzahl', 'Festpreis-EK', 'Handling',
  'Porto-Einnahme', 'Porto-Kosten', 'Versandnebenkosten', 'PayPal-Kosten', 'Gesamt-Partner-Netto', 'Gesamt-Partner-Brutto',
  'Status Abrechnung', 'Produkt-ID', 'Storno-Status', 'Artikelkategorie', 'Festpreis', 'Mehrkosten', 'VK-Netto', 'Handlingskosten'];
const vh = c => KOPF.indexOf(c);
const parseDate = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s)); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : null; };

function zeile({ datum = '02.04.2026', oid = '100', stk = 2, vk = 40, festpreis = 8, handling = 1, storno = false, status = 'offen', pid = 'FP-001', row = 2 } = {}) {
  const r = Array(KOPF.length).fill('');
  Object.assign(r, {
    [vh('Partner-ID')]: pid, [vh('Datum')]: datum, [vh('WC-Bestellnummer')]: oid, [vh('Artikelname')]: 'Shirt', [vh('Variante')]: '0',
    [vh('Stückzahl')]: String(stk), [vh('VK-Netto')]: String(vk), [vh('Festpreis')]: String(festpreis), [vh('Handlingskosten')]: String(handling),
    [vh('Status Abrechnung')]: status, [vh('Produkt-ID')]: '7', [vh('Storno-Status')]: storno ? 'Storniert/Rückerstattet' : '', [vh('Mehrkosten')]: '0',
  });
  r._sheetRow = row;
  return r;
}
// Storno-Gegenbuchung so, wie der Sync sie schreibt: Stueckzahl, VK und Stueckpreise negiert.
const stornoVon = (extra = {}) => zeile({ stk: -2, vk: -40, festpreis: -8, handling: -1, storno: true, ...extra });

describe('Storno hebt den Verkauf genau auf', () => {
  test('Verkauf + Storno = 0', () => {
    const { summen } = aggregateFpVerkaeufe([zeile(), stornoVon()], vh);
    expect(summen.auszahlung).toBe(0);
    expect(summen.festpreisGesamt).toBe(0);
    expect(summen.stueckzahl).toBe(0);
  });
  test('Storno allein (Verkauf schon abgerechnet) zieht genau die alte Auszahlung ab', () => {
    const verkauf = aggregateFpVerkaeufe([zeile()], vh).summen.auszahlung;   // 40 - 9*2 = 22
    expect(verkauf).toBe(22);
    expect(aggregateFpVerkaeufe([stornoVon()], vh).summen.auszahlung).toBe(-22);
  });
  test('auch mit positiv gespeicherten Stueckpreisen in der Gegenbuchung', () => {
    const s = stornoVon({ festpreis: 8, handling: 1 });
    expect(aggregateFpVerkaeufe([zeile(), s], vh).summen.auszahlung).toBe(0);
  });
});

describe('eine Auswahl fuer Vorschau, Abrechnung, Portal', () => {
  const rows = [zeile({ row: 2 }), stornoVon({ row: 3 }), zeile({ row: 4, datum: '01.05.2026' }), zeile({ row: 5, status: 'abgerechnet' }), zeile({ row: 6, pid: 'FP-002' })];
  test('Storno-Gegenbuchungen gehoeren dazu, Zeitraum und Status gelten', () => {
    const z = fpAbrechnungsZeilen(rows, vh, { partnerId: 'FP-001', von: parseDate('01.04.2026'), bis: parseDate('30.04.2026'), parseDate });
    expect(z.map(r => r._sheetRow)).toEqual([2, 3]);
  });
  test('ohne Zeitraum (Portal-Saldo): alle offenen des Partners', () => {
    expect(fpAbrechnungsZeilen(rows, vh, { partnerId: 'FP-001', parseDate }).map(r => r._sheetRow)).toEqual([2, 3, 4]);
  });
  test('Routen nutzen dieselbe Auswahl und schliessen Stornos nicht mehr aus', () => {
    const portal = lies('routes/festpreis-portal.js'), pub = lies('routes/festpreis-public.js');
    expect(portal).not.toMatch(/Storno-Gegenbuchungen ausschließen/);
    expect(pub).not.toMatch(/Storno-Gegenbuchungen ausschließen/);
    expect((portal.match(/fpAbrechnungsZeilen\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(pub).toMatch(/fpAbrechnungsZeilen\(/);
  });
});

describe('Loeschen setzt nur die Zeilen dieser Abrechnung zurueck', () => {
  const IKOPF = ['Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Einzelpreis', 'Summe', 'Status'];
  const ih = c => IKOPF.indexOf(c);
  const a = zeile({ row: 2, oid: '100', status: 'abgerechnet' });
  const b = zeile({ row: 3, oid: '101', status: 'abgerechnet' });   // gehoert zu einer anderen Abrechnung
  const i1 = Object.assign(['FP-001', '02.04.2026', 'Muster', '1', '5', '5', 'abgerechnet'], { _sheetRow: 2 });
  const i2 = Object.assign(['FP-001', '03.04.2026', 'Andere', '1', '7', '7', 'abgerechnet'], { _sheetRow: 3 });
  const basis = { verkaufsZeilen: [a, b], internZeilen: [i1, i2], vh, ih, partnerId: 'FP-001', von: parseDate('01.04.2026'), bis: parseDate('30.04.2026'), parseDate };

  test('mit Zeilen-Schluesseln: genau diese', () => {
    const plan = fpLoeschPlan({ ...basis, positionen: { zeilen: [fpZeilenSchluessel(a, vh)], intern: [{ datum: '02.04.2026', bezeichnung: 'Muster', anzahl: 1, summe: 5 }] }, andere: [{ von: basis.von, bis: basis.bis }] });
    expect(plan.verkaeufe.map(r => r._sheetRow)).toEqual([2]);
    expect(plan.intern.map(r => r._sheetRow)).toEqual([2]);
  });
  test('Altbestand ohne Schluessel und Ueberschneidung mit anderer Abrechnung -> nichts, Fehler', () => {
    const plan = fpLoeschPlan({ ...basis, positionen: { produkteGruppen: [] }, andere: [{ von: parseDate('15.04.2026'), bis: parseDate('20.05.2026') }] });
    expect(plan.fehler).toMatch(/überschneidet/);
  });
  test('Altbestand ohne Ueberschneidung: Zeitraum wie bisher', () => {
    const plan = fpLoeschPlan({ ...basis, positionen: null, andere: [] });
    expect(plan.verkaeufe.map(r => r._sheetRow)).toEqual([2, 3]);
  });
  test('Schluessel kurz und gleich bei gleichem Inhalt', () => {
    expect(fpZeilenSchluessel(a, vh)).toMatch(/^[0-9a-f]{12}$/);
    expect(fpZeilenSchluessel(zeile({ oid: '100' }), vh)).not.toBe(fpZeilenSchluessel(stornoVon({ oid: '100' }), vh));
    expect(internSchluessel({ datum: '02.04.2026', bezeichnung: 'Muster', anzahl: '1', summe: '5,00' }))
      .toBe(internSchluessel({ datum: '02.04.2026', bezeichnung: 'Muster', anzahl: 1, summe: 5 }));
  });
  test('gleiche Schluessel zaehlen einzeln', () => {
    const r = zeilenZuSchluesseln([{ k: 'x' }, { k: 'x' }, { k: 'x' }], z => z.k, ['x', 'x']);
    expect(r.treffer).toHaveLength(2);
    expect(zeilenZuSchluesseln([{ k: 'x' }], z => z.k, ['x', 'x']).fehlend).toEqual(['x']);
  });
});

describe('Erstellen und Loeschen: Sperre, ein Schreibaufruf', () => {
  const src = lies('routes/festpreis-portal.js');
  const block = (start, ende) => src.slice(src.indexOf(start), src.indexOf(ende, src.indexOf(start)));
  test('Erstellen unter der FP-Sperre, ohne append, ein batchUpdate mit Zeilen-Schluesseln', () => {
    expect(src).toMatch(/mitFpSperre\(\(\) => fpAbrechnungErstellen/);
    const f = block('async function fpAbrechnungErstellen', '\n}\n');
    expect(f).not.toMatch(/values\.append/);
    expect((f.match(/values\.batchUpdate/g) ?? []).length).toBe(1);
    expect(f).toMatch(/zeilen: offene\.map\(r => fpZeilenSchluessel/);
  });
  test('Loeschen unter der Sperre, ein batchUpdate, keine Zeile geloescht', () => {
    expect(src).toMatch(/mitFpSperre\(\(\) => fpAbrechnungLoeschen/);
    const f = block('async function fpAbrechnungLoeschen', '\n}\n');
    expect((f.match(/values\.batchUpdate/g) ?? []).length).toBe(1);
    expect(f).not.toMatch(/deleteDimension/);
  });
});

describe('Status nur vorwaerts', () => {
  test('Festpreis', () => {
    expect(fpStatusWechselErlaubt('entwurf', 'freigegeben')).toBe(true);
    expect(fpStatusWechselErlaubt('freigegeben', 'bezahlt')).toBe(true);
    expect(fpStatusWechselErlaubt('bezahlt', 'freigegeben')).toBe(true);
    expect(fpStatusWechselErlaubt('freigegeben', 'entwurf')).toBe(false);
    expect(fpStatusWechselErlaubt('bezahlt', 'entwurf')).toBe(false);
    expect(fpStatusWechselErlaubt('entwurf', 'bezahlt')).toBe(false);
  });
  test('Lizenz: freigegeben nur ueber /freigeben, nie zurueck auf entwurf', () => {
    expect(lizenzStatusWechselErlaubt('entwurf', 'freigegeben')).toBe(false);
    expect(lizenzStatusWechselErlaubt('entwurf', 'bezahlt')).toBe(false);
    expect(lizenzStatusWechselErlaubt('freigegeben', 'bezahlt')).toBe(true);
    expect(lizenzStatusWechselErlaubt('bezahlt', 'freigegeben')).toBe(true);
    expect(lizenzStatusWechselErlaubt('freigegeben', 'entwurf')).toBe(false);
    expect(lizenzStatusWechselErlaubt('geprüft', 'bezahlt')).toBe(true);
    expect(lies('routes/kalkulation.js')).toMatch(/lizenzStatusWechselErlaubt\(bisher, status\)/);
  });
});
