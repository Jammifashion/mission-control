// FIX3 G5: Position in einer anderen offenen EDI-Datei ist rot; "zurueck auf Entwurf" gesperrt, wenn AB oder
// Abgeholt vorliegt. Nur erfundene Werte.
import { ediPruefung, gebundenePositionen, zurueckPlan, EDI_SPALTEN, EDI_STATUS } from '../utils/edi-bestellung.js';
import { STATUS, HERKUNFT } from '../utils/korb-logic.js';

const KOPF = [...EDI_SPALTEN, 'AB_Nr'];
const edi = (orderId, status, schluessel, { ab = '', abgeholt = '', versuch = '' } = {}) => {
  const r = Array(KOPF.length).fill('');
  const s = (n, v) => { r[KOPF.indexOf(n)] = v; };
  s('order_id', orderId); s('Status', status); s('Korb_Schluessel', schluessel); s('AB_Nr', ab); s('Abgeholt', abgeholt);
  s('Sendeversuch', versuch); s('Erzeugt', '2026-11-19T08:00:00Z');
  return r;
};
const korb = s => ({ Schluessel: s, Status: STATUS.OFFEN, Shop: 'JFN', Hinweis: '', LShop_ArticleNr: '1234567890', Menge: '1',
  Herkunft: HERKUNFT.EIGEN, Referenz: 'AU-2026-0001' });
const modelle = new Map([['1234567890', { status: '', discontinued: '0', catalogNr: 'X1', color1: 'Black', size: 'M' }]]);
const pruefe = (gebunden) => ediPruefung({
  auswahl: [{ schluessel: 'EIGEN:2026-0001', status: STATUS.OFFEN }], zeilen: [korb('EIGEN:2026-0001')], modelle,
  customerId: '1', commission: 'C', orderId: 'JFN-2026-0009', versandart: 'Standard', jetzt: new Date('2026-11-19T09:00:00Z'), gebunden,
});

describe('gebundenePositionen', () => {
  test('wird gesendet, unklar, gesendet ohne AB binden; mit AB, Entwurf, versandt nicht', () => {
    const werte = [KOPF,
      edi('JFN-2026-0001', EDI_STATUS.UNKLAR, 'A B'),
      edi('JFN-2026-0002', EDI_STATUS.WIRD_GESENDET, 'C'),
      edi('JFN-2026-0003', EDI_STATUS.GESENDET, 'D'),
      edi('JFN-2026-0004', EDI_STATUS.GESENDET, 'E', { ab: 'AB-1' }),
      edi('JFN-2026-0005', EDI_STATUS.ENTWURF, 'F'),
      edi('JFN-2026-0006', 'versandt', 'G'),
    ];
    const g = gebundenePositionen(werte);
    expect([...g.keys()].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(g.get('A')).toBe('JFN-2026-0001 (unklar)');
    expect(gebundenePositionen(werte, { ausser: 'JFN-2026-0001' }).has('A')).toBe(false);
  });
  test('ohne Reiter-Inhalt leer', () => expect(gebundenePositionen([]).size).toBe(0));
});

describe('ediPruefung: Regel gebunden', () => {
  test('gebundene Position ist rot und sperrt', () => {
    const p = pruefe(new Map([['EIGEN:2026-0001', 'JFN-2026-0001 (unklar)']]));
    const punkt = p.punkte.find(x => x.regel === 'gebunden');
    expect(punkt).toMatchObject({ stufe: 'rot', ok: false });
    expect(punkt.treffer[0].text).toContain('JFN-2026-0001');
    expect(p.gruen).toBe(false);
  });
  test('nicht gebunden: Regel ok', () => {
    const p = pruefe(new Map());
    expect(p.punkte.find(x => x.regel === 'gebunden').ok).toBe(true);
    expect(p.gruen).toBe(true);
  });
});

describe('zurueckPlan', () => {
  const jetzt = new Date('2026-11-19T10:00:00Z');
  test('unklar ohne AB/Abgeholt: erlaubt', () => {
    expect(zurueckPlan({ ediWerte: [KOPF, edi('JFN-2026-0001', EDI_STATUS.UNKLAR, 'A')], orderId: 'JFN-2026-0001', jetzt }).edi.Status).toBe(EDI_STATUS.ENTWURF);
  });
  test('unklar mit AB: gesperrt', () => {
    expect(() => zurueckPlan({ ediWerte: [KOPF, edi('JFN-2026-0001', EDI_STATUS.UNKLAR, 'A', { ab: 'AB-7' })], orderId: 'JFN-2026-0001', jetzt }))
      .toThrow(/Auftragsbestätigung AB-7/);
  });
  test('haengend mit Abgeholt: gesperrt, Code schon_bei_lshop', () => {
    let fehler;
    try {
      zurueckPlan({ ediWerte: [KOPF, edi('JFN-2026-0001', EDI_STATUS.WIRD_GESENDET, 'A', { abgeholt: '2026-11-19T09:10:00Z', versuch: '2026-11-19T09:00:00Z' })], orderId: 'JFN-2026-0001', jetzt });
    } catch (e) { fehler = e; }
    expect(fehler).toMatchObject({ status: 409, code: 'schon_bei_lshop' });
  });
});
