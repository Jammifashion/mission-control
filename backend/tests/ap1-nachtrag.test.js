// AP1 (FB-0007): Position nachtraeglich hinzufuegen - auch in laufenden Auftraegen. Bestehende Positionen bleiben unveraendert,
// die neue laeuft eigenstaendig (Nachtrag_Am): Bereitstellen und DTF nur fuer sie, Status nie automatisch zurueck. Nur erfundene Daten.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bearbeitenPlan, nachtragMoeglich, istNachtrag, POSITION_OPTIONAL, POSITION_TEXT } from '../utils/auftraege.js';
import { kannBereitstellen, bereitstellenPlan, zuruecknehmenPlan, nurNachtraege } from '../utils/auftrag-bereitstellen.js';
import { hinweisFuer, nachtragOffen, quellSchluessel } from '../utils/dtf-korb.js';
import { nachRechnungGeaendert, nachtragNachRechnung } from '../utils/rechnung.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const JETZT = '2026-11-25T10:00:00.000Z';
const AU = 'AU-2026-0077';
const NR = '1234567890', NR2 = '1234567891';
const pos = (n, o = {}) => ({ _zeile: n + 1, Position_ID: `${AU}-0${n}`, Auftrag_Nr: AU, Art: 'lshop', LShop_ArticleNr: NR, Freitext: '', Menge: '2',
  Motiv: 'M', Druck: 'DTF', Notiz: '', Herkunft: '', Entfernt: '', Stand: 's', ...o });
const auftrag = (o = {}) => ({ _zeile: 2, Auftrag_Nr: AU, Kunden_Nr: 'K-00001', Kurztitel: 'Test', Status: 'in Produktion', Stand: 'S1', ...o });
const alt = p => ({ positionId: p.Position_ID, art: p.Art, articleNr: p.LShop_ArticleNr, menge: Number(p.Menge), motiv: p.Motiv, druck: p.Druck, herkunft: 'bestellen' });

describe('bearbeitenPlan: Nachtrag ab "bestellt"', () => {
  const vorhanden = [pos(1)];
  test('alte bleiben, neue Position kommt mit Nachtrag_Am (bis "übergeben")', () => {
    for (const Status of ['bestellt', 'in Produktion', 'fertig', 'übergeben']) {
      const plan = bearbeitenPlan({ auftrag: auftrag({ Status }), positionen: vorhanden, waehlbar: new Set([NR2]), jetzt: JETZT,
        eingabe: { Termin: '', Notiz: '', positionen: [alt(vorhanden[0]), { art: 'lshop', articleNr: NR2, menge: 3, motiv: 'Neu', druck: 'DTF', herkunft: 'bestellen' }] } });
      expect(plan.aenderungPositionen).toEqual([]);
      expect(plan.neuePositionen).toHaveLength(1);
      expect(plan.neuePositionen[0]).toMatchObject({ Position_ID: `${AU}-02`, LShop_ArticleNr: NR2, Menge: '3', Nachtrag_Am: '2026-11-25', Herkunft: 'bestellen' });
      expect(plan.aenderungAuftrag.Status).toBeUndefined();   // Status nie automatisch zurueck
    }
  });
  test('freie Position als Nachtrag', () => {
    const plan = bearbeitenPlan({ auftrag: auftrag(), positionen: vorhanden, jetzt: JETZT,
      eingabe: { positionen: [alt(vorhanden[0]), { art: 'frei', freitext: 'Aufnäher', menge: 1 }] } });
    expect(plan.neuePositionen[0]).toMatchObject({ Art: 'frei', Freitext: 'Aufnäher', Nachtrag_Am: '2026-11-25' });
  });
  test('alte Position geaendert oder weggelassen -> 409 gesperrt; neue nicht waehlbar -> 422', () => {
    const neu = { art: 'lshop', articleNr: NR2, menge: 1 };
    expect(() => bearbeitenPlan({ auftrag: auftrag(), positionen: vorhanden, waehlbar: new Set([NR2]), jetzt: JETZT,
      eingabe: { positionen: [{ ...alt(vorhanden[0]), menge: 5 }, neu] } })).toThrow(expect.objectContaining({ code: 'gesperrt' }));
    expect(() => bearbeitenPlan({ auftrag: auftrag(), positionen: vorhanden, waehlbar: new Set([NR2]), jetzt: JETZT,
      eingabe: { positionen: [neu] } })).toThrow(expect.objectContaining({ code: 'gesperrt' }));
    expect(() => bearbeitenPlan({ auftrag: auftrag(), positionen: vorhanden, waehlbar: new Set(), jetzt: JETZT,
      eingabe: { positionen: [alt(vorhanden[0]), neu] } })).toThrow(expect.objectContaining({ code: 'nicht_waehlbar' }));
  });
  test('bezahlt -> 409 abgeschlossen; nur Preise wie bisher ohne Nachtrag', () => {
    expect(() => bearbeitenPlan({ auftrag: auftrag({ Status: 'bezahlt' }), positionen: vorhanden, jetzt: JETZT,
      eingabe: { positionen: [alt(vorhanden[0]), { art: 'frei', freitext: 'x', menge: 1 }] } })).toThrow(expect.objectContaining({ code: 'abgeschlossen' }));
    const plan = bearbeitenPlan({ auftrag: auftrag({ Status: 'bezahlt' }), positionen: vorhanden, jetzt: JETZT,
      eingabe: { positionen: [{ ...alt(vorhanden[0]), preis: '9,50' }] } });
    expect(plan.neuePositionen).toEqual([]);
    expect(plan.aenderungPositionen[0].felder.Preis_Netto).toBe(9.5);
  });
  test('Spalte optional und als Text gelesen; Helfer', () => {
    expect(POSITION_OPTIONAL).toContain('Nachtrag_Am');
    expect(POSITION_TEXT).toContain('Nachtrag_Am');
    expect(nachtragMoeglich({ Status: 'übergeben' })).toBe(true);
    expect(nachtragMoeglich({ Status: 'bezahlt' })).toBe(false);
    expect(nachtragMoeglich({ Status: 'Design' })).toBe(false);   // davor ist alles frei
    expect(istNachtrag({ Nachtrag_Am: '2026-11-25' })).toBe(true);
    expect(istNachtrag({})).toBe(false);
  });
});

describe('Rohlinge bereitstellen hinter "bestellt" nur fuer Nachtraege', () => {
  const ohne = [pos(1)];                                        // Altbestand: nie uebergeben (wie gemessen)
  const mit = [pos(1), pos(2, { LShop_ArticleNr: NR2, Nachtrag_Am: '2026-11-25' })];
  test('kannBereitstellen', () => {
    expect(kannBereitstellen(auftrag({ Status: 'bestellt' }), ohne)).toBe(true);
    expect(kannBereitstellen(auftrag(), ohne)).toBe(false);
    expect(kannBereitstellen(auftrag(), mit)).toBe(true);
    expect(kannBereitstellen(auftrag({ Status: 'übergeben' }), mit)).toBe(true);
    expect(kannBereitstellen(auftrag({ Status: 'bezahlt' }), mit)).toBe(false);
    expect(nurNachtraege(auftrag({ Status: 'bestellt' }))).toBe(false);
    expect(nurNachtraege(auftrag())).toBe(true);
  });
  test('Plan nimmt nur die Nachtrags-Position, die alte bleibt unangetastet', () => {
    const plan = bereitstellenPlan({ auftrag: auftrag(), positionen: mit, korbZeilen: [], buchungen: [], orte: ['Wrist'],
      waehlbar: new Set([NR, NR2]), jetzt: JETZT });
    expect(plan.korbNeu).toHaveLength(1);
    expect(plan.korbNeu[0]).toMatchObject({ LShop_ArticleNr: NR2, Referenz: AU });
    expect(plan.posFelder.map(x => x.positionId)).toEqual([`${AU}-02`]);
    expect(() => bereitstellenPlan({ auftrag: auftrag(), positionen: ohne, korbZeilen: [], buchungen: [], orte: [], waehlbar: new Set([NR]), jetzt: JETZT }))
      .toThrow(expect.objectContaining({ code: 'status' }));
  });
  test('zuruecknehmen: alte Position hinter "bestellt" -> 409, Nachtrag geht', () => {
    const p = [pos(1, { Korb_Schluessel: 'EIGEN:2026-0001' }), pos(2, { LShop_ArticleNr: NR2, Nachtrag_Am: '2026-11-25', Korb_Schluessel: 'EIGEN:2026-0002' })];
    const korb = [{ Schluessel: 'EIGEN:2026-0001', Status: 'offen', _zeile: 2 }, { Schluessel: 'EIGEN:2026-0002', Status: 'offen', _zeile: 3 }];
    expect(() => zuruecknehmenPlan({ auftrag: auftrag(), positionen: p, positionId: `${AU}-01`, korbZeilen: korb, buchungen: [], jetzt: JETZT }))
      .toThrow(expect.objectContaining({ code: 'status' }));
    const r = zuruecknehmenPlan({ auftrag: auftrag(), positionen: p, positionId: `${AU}-02`, korbZeilen: korb, buchungen: [], jetzt: JETZT });
    expect(r.position.Position_ID).toBe(`${AU}-02`);
  });
});

describe('DTF: Nachtrag im fertigen Auftrag gilt fuer sich als offen', () => {
  test('nachtragOffen und Hinweis je Zeile', () => {
    expect(nachtragOffen({ Nachtrag_Am: '2026-11-25' })).toBe(true);
    expect(nachtragOffen({ Nachtrag_Am: '2026-11-25', Fertig: 'ja' })).toBe(false);
    expect(nachtragOffen({})).toBe(false);
    const quellen = new Map([[quellSchluessel('AU', AU), { zustand: 'au_fertig', positionen: new Map([
      [`${AU}-01`, { menge: 2, dtf: true }], [`${AU}-02`, { menge: 3, dtf: true, nachtragOffen: true }]]) }]]);
    expect(hinweisFuer({ Quelle: 'AU', Nummer: AU, Position: `${AU}-01`, Menge: 2 }, quellen)).toBe('Auftrag schon fertig');
    expect(hinweisFuer({ Quelle: 'AU', Nummer: AU, Position: `${AU}-02`, Menge: 3 }, quellen)).toBe('');
  });
});

describe('Rechnung: Nachtrag nach dem Kennzeichen', () => {
  test('ohne Pruefsumme (vor RE3): Nachtrag am/nach Rechnungstag -> geaendert', () => {
    const a = { Auftrag_Nr: AU, Rechnung_Am: '2026-11-20', Rechnung_Status: 'entwurf' };
    expect(nachRechnungGeaendert({ auftrag: a, positionen: [pos(1)] })).toBe(false);
    expect(nachRechnungGeaendert({ auftrag: a, positionen: [pos(1), pos(2, { Nachtrag_Am: '2026-11-25' })] })).toBe(true);
    expect(nachtragNachRechnung({ auftrag: a, positionen: [pos(2, { Nachtrag_Am: '2026-11-19' })] })).toBe(false);
    expect(nachtragNachRechnung({ auftrag: { ...a, Rechnung_Am: '' }, positionen: [pos(2, { Nachtrag_Am: '2026-11-25' })] })).toBe(false);
  });
});

describe('Oberflaeche', () => {
  const ku = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
  const block = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('// ── Auftraege-Anzeige: Ende ──'));
  const preise = html.slice(html.indexOf('// ── Auftrag-Preise: Anfang'), html.indexOf('// ── Auftrag-Preise: Ende'));
  const F = new Function(`${ku}\n${preise}\n${block}\nreturn { auGruppen, auKannBereitstellen, auKannZuruecknehmen, auNachtragMoeglich, auNachtragHinweis, auNachtragFrageHtml };`)();
  const ap = o => ({ Art: 'lshop', Herkunft: 'bestellen', lshop: { modell: 'M100', farbe: 'Schwarz', groesse: 'L' }, Menge: '1', ...o });
  test('Bereitstellen-Knopf und Zuruecknehmen wie im Backend', () => {
    expect(F.auKannBereitstellen({ Auftrag_Nr: AU, Status: 'in Produktion', positionen: [ap()] })).toBe(false);
    expect(F.auKannBereitstellen({ Auftrag_Nr: AU, Status: 'in Produktion', positionen: [ap(), ap({ Nachtrag_Am: '2026-11-25' })] })).toBe(true);
    expect(F.auKannBereitstellen({ Auftrag_Nr: AU, Status: 'bezahlt', positionen: [ap({ Nachtrag_Am: '2026-11-25' })] })).toBe(false);
    expect(F.auKannBereitstellen({ Auftrag_Nr: AU, Status: 'bestellt', positionen: [ap()] })).toBe(true);
    const a = { Status: 'fertig' };
    expect(F.auKannZuruecknehmen(a, { Korb_Schluessel: 'E', korb: { status: 'offen' } })).toBe(false);
    expect(F.auKannZuruecknehmen(a, { Korb_Schluessel: 'E', korb: { status: 'offen' }, Nachtrag_Am: '2026-11-25' })).toBe(true);
  });
  test('Gruppen: Nachtrag nie mit gesperrten gemischt (Ansicht und Dialog)', () => {
    const g = F.auGruppen([ap(), ap({ Nachtrag_Am: '2026-11-25' })]);
    expect(g).toHaveLength(2);
    expect(g[1].nachtrag).toBe('2026-11-25');
    const d = F.auGruppen([{ art: 'lshop', modell: 'M100', farbe: 'Schwarz', positionId: 'x' }, { art: 'lshop', modell: 'M100', farbe: 'Schwarz', nachtrag: true }]);
    expect(d.map(x => x.nachtrag)).toEqual(['', 'neu']);
  });
  test('Hinweis und Rueckfrage', () => {
    expect(F.auNachtragMoeglich({ Status: 'fertig' })).toBe(true);
    expect(F.auNachtragMoeglich({ Status: 'bezahlt' })).toBe(false);
    expect(F.auNachtragHinweis({ Status: 'fertig', positionen: [ap({ Nachtrag_Am: '2026-11-25' })] })).toBe('neue Position offen – Auftrag ist schon „fertig“');
    expect(F.auNachtragHinweis({ Status: 'fertig', positionen: [ap({ Nachtrag_Am: '2026-11-25', Fertig: 'ja' })] })).toBe('');
    expect(F.auNachtragHinweis({ Status: 'in Produktion', positionen: [ap({ Nachtrag_Am: '2026-11-25' })] })).toBe('');
    const h = F.auNachtragFrageHtml({ Auftrag_Nr: AU, Status: 'in Produktion' }, 1, true);
    expect(h).toContain('der Auftragsstatus bleibt');
    expect(h).toContain('von Hand in Lexware');
    expect(F.auNachtragFrageHtml({ Auftrag_Nr: AU, Status: 'bestellt' }, 2, false)).not.toContain('Lexware');
  });
  test('Knopf "+ Position …" im Menue "mehr …" mit Mouse-over, Hinweis-Element, kein title', () => {
    expect(html).toMatch(/<button type="button" role="menuitem" class="au-menue-punkt" id="au-plus-position" data-hilfe="au-plus-position">\+ Position …<\/button>/);
    for (const k of ['au-plus-position', 'au-nachtrag', 'au-nachtrag-offen']) expect(html).toContain(`'${k}':`);
    expect(html).toContain('id="au-d-nachtrag"');
    expect(html).not.toMatch(/id="au-plus-position"[^>]*title=/);
  });
});

describe('Ablauf mit Sheet-Attrappe (lib/auftraege.js)', () => {
  let M, A, U, lshop, lfb;
  beforeAll(async () => {
    M = await import('./hilfen/korb-sheet.js');
    A = await import('../lib/auftraege.js');
    U = await import('../utils/auftraege.js');
    lshop = await import('../lib/lshop.js');
    lfb = await import('../lib/lieferbarkeitLesen.js');
  });
  beforeEach(() => { process.env.GOOGLE_SHEET_ID = 'ssot-test'; A._auftraegeCacheLeeren(); lshop._resetLShopCache(); lfb._lieferbarkeitCacheLeeren(); });
  const NR_S = '9000000110', NR_M = '9000000120';
  const tabs = mitSpalte => {
    const LS = (nr, size) => [nr, 'X3000', 'Black', '', size, '', '', 'Erfunden', '', '0', 'aktiv', 'Muster-Shirt'];
    const pk = [...U.POSITION_SPALTEN, ...(mitSpalte ? ['Nachtrag_Am'] : [])];
    return {
      LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage', 'Brand', 'CatNrManufacturer', 'Discontinued', 'Status', 'Description'], LS(NR_S, 'S'), LS(NR_M, 'M')],
      [U.TAB_AUFTRAEGE]: [[...U.AUFTRAG_SPALTEN, 'Design_Am'], [...U.AUFTRAG_SPALTEN, 'Design_Am'].map(s => ({ Auftrag_Nr: AU, Kunden_Nr: 'K-00001', Kurztitel: 'Test', Status: 'in Produktion', Stand: 'S1' }[s] ?? ''))],
      [U.TAB_POSITIONEN]: [pk, pk.map(s => ({ Position_ID: `${AU}-01`, Auftrag_Nr: AU, Art: 'lshop', LShop_ArticleNr: NR_S, Menge: '2', Stand: 's' }[s] ?? ''))],
    };
  };
  const eingabe = { auftragNr: AU, stand: 'S1', Termin: '', Notiz: '',
    positionen: [{ positionId: `${AU}-01`, art: 'lshop', articleNr: NR_S, menge: 2 }, { art: 'lshop', articleNr: NR_M, menge: 4, motiv: 'Neu' }] };
  test('neue Zeile mit Nachtrag_Am, alte Zeile unveraendert, Status bleibt', async () => {
    const t = tabs(true);
    const { sheets } = M.machSheets(t);
    const vorher = JSON.stringify(t[U.TAB_POSITIONEN][1]);
    const r = await A.bearbeiteAuftrag({ eingabe, sheets, jetzt: () => new Date(JETZT), kundePruefen: async () => {} });
    expect(r).toMatchObject({ positionenNeu: 1, positionenGeaendert: 0 });
    expect(JSON.stringify(t[U.TAB_POSITIONEN][1])).toBe(vorher);
    const kopf = t[U.TAB_POSITIONEN][0];
    const neu = t[U.TAB_POSITIONEN][2];
    expect(neu[kopf.indexOf('Position_ID')]).toBe(`${AU}-02`);
    expect(neu[kopf.indexOf('Nachtrag_Am')]).toBe('2026-11-25');
    expect(t[U.TAB_AUFTRAEGE][1][U.AUFTRAG_SPALTEN.indexOf('Status')]).toBe('in Produktion');
  });
  test('ohne Spalte Nachtrag_Am -> 409 einrichtung, nichts geschrieben', async () => {
    const t = tabs(false);
    const { sheets } = M.machSheets(t);
    await expect(A.bearbeiteAuftrag({ eingabe, sheets, jetzt: () => new Date(JETZT), kundePruefen: async () => {} })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(t[U.TAB_POSITIONEN]).toHaveLength(2);
  });
});
