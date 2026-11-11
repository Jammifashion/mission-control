// BS4: Link "Im Shop öffnen" (Teil A) und Auftragspositionen entfernen/wiederherstellen (Teil B). Nur erfundene Daten.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { adminBestellLink, mitAdminLink } from '../utils/shop-admin.js';
import { entfernenPlan, entfernenLage, auftraegeAntwort, aktivePositionen, wareStand, auftragZahlen } from '../utils/auftraege.js';
import { standFuer, standSumme } from '../utils/bestell-stand.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const JETZT = '2026-11-11T10:00:00.000Z';
const AU = 'AU-2026-0042';
const pos = (n, o = {}) => ({ _zeile: n + 1, Position_ID: `${AU}-0${n}`, Auftrag_Nr: AU, Art: 'frei', Freitext: `Teil ${n}`, Menge: '2', Herkunft: '', Entfernt: '', Stand: 's', ...o });
const auftrag = (o = {}) => ({ Auftrag_Nr: AU, Status: 'bestellt', ...o });

describe('Teil A: Im Shop öffnen', () => {
  test('Link aus WC_URL (origin), klassische Bestellansicht, ohne Token', () => {
    expect(adminBestellLink('https://shop.example/', 123)).toBe('https://shop.example/wp-admin/post.php?post=123&action=edit');
    expect(adminBestellLink('https://shop.example/unterordner/', '77')).toBe('https://shop.example/wp-admin/post.php?post=77&action=edit');
    expect(adminBestellLink('http://shop.example', 1)).toBe('');
    expect(adminBestellLink('', 1)).toBe('');
    expect(adminBestellLink('https://shop.example', 'x')).toBe('');
    expect(mitAdminLink([{ id: 5, total: '1' }], 'https://shop.example')[0]).toEqual({ id: 5, total: '1', mc_admin_url: 'https://shop.example/wp-admin/post.php?post=5&action=edit' });
  });
  test('Karte: Link neuer Tab, noopener, Mouse-over, nur gueltige Adresse; Klick klappt die Karte nicht', () => {
    const blk = html.slice(html.indexOf('// ── Produktion-Stand: Anfang'), html.indexOf('// ── Produktion-Stand: Ende ──'));
    const F = new Function(`${blk}\nreturn { psShopLinkHtml };`)();
    const h = F.psShopLinkHtml({ mc_admin_url: 'https://shop.example/wp-admin/post.php?post=9&action=edit' });
    expect(h).toContain('target="_blank" rel="noopener" data-hilfe="ps-shop-link"');
    expect(h).toContain('href="https://shop.example/wp-admin/post.php?post=9&#38;action=edit"');
    expect(h).not.toContain('title=');
    expect(F.psShopLinkHtml({ mc_admin_url: 'javascript:alert(1)' })).toBe('');
    expect(F.psShopLinkHtml({})).toBe('');
    expect(html).toContain("if (ev.target.closest('a.ps-shop-link')) return;");
    expect(html).toContain('${psShopLinkHtml(o)}');
  });
});

describe('Teil B: Position entfernen / wiederherstellen', () => {
  test('entfernen setzt nur Entfernt + Stand; Doppelklick unveraendert; wiederherstellen leert', () => {
    const p = [pos(1), pos(2)];
    const r = entfernenPlan({ auftrag: auftrag(), positionen: p, positionId: `${AU}-01`, jetzt: JETZT });
    expect(r.felder).toEqual({ Entfernt: '2026-11-11', Stand: JETZT });
    expect(r.lage).toBe('frei');
    const weg = [pos(1, { Entfernt: '2026-11-11' }), pos(2)];
    expect(entfernenPlan({ auftrag: auftrag(), positionen: weg, positionId: `${AU}-01`, jetzt: JETZT }).felder).toBeNull();
    expect(entfernenPlan({ auftrag: auftrag(), positionen: weg, positionId: `${AU}-01`, wiederherstellen: true, jetzt: JETZT }).felder).toEqual({ Entfernt: '', Stand: JETZT });
  });
  test('abgeschlossen (bezahlt/storniert) -> 409; verschobene nicht wiederherstellbar; unbekannt -> 409', () => {
    for (const Status of ['bezahlt', 'storniert']) {
      expect(() => entfernenPlan({ auftrag: auftrag({ Status }), positionen: [pos(1)], positionId: `${AU}-01`, jetzt: JETZT })).toThrow(expect.objectContaining({ code: 'abgeschlossen' }));
    }
    const v = [pos(1, { Entfernt: '2026-11-10', Verschoben_Nach: 'AU-2026-0050-01' })];
    expect(() => entfernenPlan({ auftrag: auftrag(), positionen: v, positionId: `${AU}-01`, wiederherstellen: true, jetzt: JETZT })).toThrow(expect.objectContaining({ code: 'verschoben' }));
    expect(() => entfernenPlan({ auftrag: auftrag(), positionen: [pos(1)], positionId: 'AU-2026-0099-01', jetzt: JETZT })).toThrow(expect.objectContaining({ code: 'konflikt' }));
  });
  test('Lage fuer die Rueckfrage: korb · lager · beiUns · frei', () => {
    expect(entfernenLage(pos(1, { Art: 'lshop', Herkunft: 'bestellen', Korb_Schluessel: 'EIGEN:2026-0001' }))).toBe('korb');
    expect(entfernenLage(pos(1, { Art: 'lshop', Herkunft: 'vorhanden', Verweis: 'JFN:100:1' }))).toBe('korb');
    expect(entfernenLage(pos(1, { Art: 'lshop', Herkunft: 'lager', Lager_Buchung: 'LB-2026-00001' }))).toBe('lager');
    expect(entfernenLage(pos(1, { Da_Am: '2026-11-10' }))).toBe('beiUns');
    expect(entfernenLage(pos(1))).toBe('frei');
  });
  test('entfernt zaehlt nicht: Stueck, Ware, Kachel; Liste "entfernt" ohne verschobene', () => {
    const p = [pos(1), pos(2, { Entfernt: '2026-11-11' }), pos(3, { Entfernt: '2026-11-09', Verschoben_Nach: 'AU-2026-0050-01' })];
    const [a] = auftraegeAntwort([auftrag()], p);
    expect(a.positionen.map(x => x.Position_ID)).toEqual([`${AU}-01`]);
    expect(a.stueck).toBe(2);
    expect(a.entfernt.map(x => x.Position_ID)).toEqual([`${AU}-02`]);
    expect(a.entfernt[0]).not.toHaveProperty('_zeile');
    expect(wareStand(aktivePositionen([pos(1, { Da_Am: '2026-11-11' }), pos(2, { Entfernt: '2026-11-11' })], AU), new Map())).toBe('da');
    expect(auftragZahlen([auftrag()], new Date(JETZT), new Map([[AU, 'da']])).wartetAufWare).toBe(0);
  });
  test('Bestellseite: Eintrag einer entfernten Position = storniert, zaehlt nicht in der Summe; verschoben bleibt wie bisher', () => {
    const e = { Eintrag_ID: 'E1', Status: 'übernommen', Art: 'extra', Position_ID: `${AU}-01` };
    const s1 = standFuer(e, { posJe: new Map([[`${AU}-01`, pos(1, { Entfernt: '2026-11-11', Da_Am: '2026-11-10' })]]) });
    expect([s1.schritt, s1.text, s1.schritte]).toEqual(['storniert', 'storniert', []]);
    expect(s1.intern.entfernt).toBe('2026-11-11');
    const s2 = standFuer(e, { posJe: new Map([[`${AU}-01`, pos(1, { Da_Am: '2026-11-10' })]]) });
    expect(s2.schritt).toBe('beiUns');
    expect(standSumme([s1, s2])).toMatchObject({ gesamt: 1, beiUns: 1 });
    const s3 = standFuer(e, { posJe: new Map([[`${AU}-01`, pos(1, { Entfernt: '2026-11-11', Verschoben_Nach: 'AU-2026-0050-01' })]]) });
    expect(s3.schritt).not.toBe('storniert');
  });
  test('Oberflaeche: Knopf je Position, Rueckfrage je Lage, Liste mit wiederherstellen, Packliste ohne entfernte', () => {
    const ku = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
    const preise = html.slice(html.indexOf('// ── Auftrag-Preise: Anfang'), html.indexOf('// ── Auftrag-Preise: Ende'));
    const block = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('// ── Auftraege-Anzeige: Ende ──'));
    const F = new Function(`${ku}\n${preise}\n${block}\nreturn { auEntfernenLage, auEntfernenText, auEntferntHtml };`)();
    expect(F.auEntfernenText({ Art: 'frei' })).not.toMatch(/Korb-Zeile|Lager-Abgang/);
    expect(F.auEntfernenText({ korb: { status: 'bestellt' } })).toMatch(/Korb-Zeile wird NICHT mitgeändert.*Bei L-Shop ist sie schon bestellt/);
    expect(F.auEntfernenText({ Lager_Buchung: 'LB-1' })).toMatch(/Lager-Abgang bleibt gebucht/);
    expect(F.auEntfernenText({ Da_Am: '2026-11-10' })).toMatch(/„bei uns“/);
    expect(F.auEntfernenText({ Art: 'frei' }, { bestellseite: true })).toMatch(/Bestellseite .* „storniert“/);
    const l = F.auEntferntHtml({ entfernt: [{ Position_ID: `${AU}-02`, Art: 'frei', Freitext: 'Fahne', Menge: '1', Entfernt: '2026-11-11' }] }, false);
    expect(l).toContain('<details class="au-entfernt"><summary data-hilfe="au-entfernt-liste">1 entfernte Position</summary>');
    expect(l).toContain(`data-au-wiederherstellen="${AU}-02" data-hilfe="au-wiederherstellen"`);
    expect(F.auEntferntHtml({ entfernt: [{ Position_ID: 'x', Entfernt: '2026-11-11' }] }, true)).not.toContain('wiederherstellen"');
    expect(F.auEntferntHtml({}, false)).toBe('');
    expect(html).toContain('data-au-entfernen="${kuEsc(p.Position_ID)}" data-hilfe="au-entfernen"');
    expect(html).toMatch(/e\.status === 'übernommen' && e\.fortschritt\?\.schritt !== 'storniert'/);
  });
});
