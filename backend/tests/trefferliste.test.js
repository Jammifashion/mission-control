// AM-2-1: Trefferliste (Kundensuche im Auftrag, Lexoffice-Treffer), Hilfetexte nicht bei fokussierten Eingabefeldern,
// kein title= an Knoepfen. Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const ku = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
const tw = html.slice(html.indexOf('// ── Trefferliste: Anfang'), html.indexOf('// ── Trefferliste: Ende ──'));
const T = new Function(`${ku}\n${tw}\nreturn { twHtml, twTaste, twKunde, klEintraege };`)();
const hilfe = html.slice(html.indexOf('// ── Knopf-Hilfe: Anfang'), html.indexOf('// ── Knopf-Hilfe: Ende ──'));
const { hilfeEinrichten } = new Function(`${hilfe}\nreturn { hilfeEinrichten };`)();

describe('Trefferliste', () => {
  const e = [{ haupt: 'A' }, { haupt: 'B', aus: true }, { haupt: 'C' }, { haupt: 'In Lexoffice suchen …', aktion: 'lex' }];
  test('eine Zeile je Treffer, maskiert, markierte Zeile, Aktionszeile, gesperrt', () => {
    const h = T.twHtml('x', [{ haupt: 'Name <b>', neben: 'K-00001 · Ort', rechts: 'Firma' }, ...e], 1);
    expect(h.match(/role="option"/g)).toHaveLength(5);
    expect(h).toContain('Name &lt;b&gt;');
    expect(h).toContain('id="x-1" data-tw="1" aria-selected="true"');
    expect(h).toContain('tw-aktion');
    expect(h).toContain('aria-disabled="true"');
    expect(h).not.toContain('data-hilfe');   // kein Mouse-over in der Liste
    expect(T.twHtml('x', [])).toBe('');
  });
  test('↑/↓ ueberspringen gesperrte Zeilen und laufen im Kreis; Enter waehlt; Esc schliesst', () => {
    expect(T.twTaste('ArrowDown', -1, e).aktiv).toBe(0);
    expect(T.twTaste('ArrowDown', 0, e).aktiv).toBe(2);
    expect(T.twTaste('ArrowDown', 3, e).aktiv).toBe(0);
    expect(T.twTaste('ArrowUp', -1, e).aktiv).toBe(3);
    expect(T.twTaste('Enter', 2, e)).toEqual({ aktiv: 2, wahl: 2 });
    expect(T.twTaste('Enter', -1, e)).toEqual({ aktiv: -1 });   // ohne Markierung: das Feld macht weiter
    expect(T.twTaste('Enter', 1, e).wahl).toBeUndefined();
    expect(T.twTaste('Escape', 2, e)).toEqual({ aktiv: -1, zu: true });
  });
  test('Kunde als Zeile: Name (Spitzname) · Nr. · Ort, rechts Art/Quelle', () => {
    expect(T.twKunde({ Kunden_Nr: 'K-00224', Name: 'Testverein', Spitzname: 'Kicker; Blau', Ort: 'Musterstadt', Art: 'Verein', Quelle: 'mc' }))
      .toMatchObject({ haupt: 'Testverein (Kicker)', neben: 'K-00224 · Musterstadt', rechts: 'Verein · nur MC' });
  });
  test('Lexoffice-Treffer: schon in MC -> oeffnen, gesperrt nicht waehlbar, sonst uebernehmen', () => {
    const z = T.klEintraege([
      { lexofficeId: 'a', name: 'Paula Platzhalter', art: 'Person', ort: '01234 Musterstadt', lexofficeNr: '10101', inMc: null },
      { lexofficeId: 'b', name: 'Erfundene GmbH', art: 'Firma', inMc: 'K-00001' },
      { lexofficeId: 'c', name: 'gelöscht K-00002', art: 'Person', inMc: 'K-00002', gesperrt: true },
    ]);
    expect(z[0]).toMatchObject({ haupt: 'Paula Platzhalter', neben: '01234 Musterstadt · Lexoffice 10101', rechts: 'Person · übernehmen', aus: false });
    expect(z[1].rechts).toBe('Firma · schon in MC (K-00001) – öffnen');
    expect(z[2]).toMatchObject({ aus: true, rechts: 'Person · gesperrt (DSGVO)' });
  });
  test('Verdrahtung: Kundenwahl im Auftrag und Lexoffice-Dialog nutzen den Baustein; Aktionen als letzte Zeilen; gewaehlter Kunde mit "ändern"', () => {
    expect(html).toContain("const auTw = twBinden(auEl('au-kunde-suche'), auEl('au-kunde-treffer'), auKundeWahl);");
    expect(html).toContain("const klTw = twBinden(kuEl('kl-q'), kuEl('kl-liste'), klWahl);");
    expect(html).toMatch(/\{ haupt: 'In Lexoffice suchen …', rechts: `„\$\{q\}“`, aktion: 'lex' \},\s*\{ haupt: 'Neuer Kunde in MC', aktion: 'neu' \}/);
    expect(html).toContain('id="au-kunde-aendern" data-hilfe="au-kunde-aendern">ändern</button>');
    // Enter im Lexoffice-Feld sucht nur, wenn die Liste keine Zeile gewaehlt hat (Reihenfolge der Hoerer)
    expect(html.indexOf('const klTw = twBinden(')).toBeLessThan(html.indexOf("kuEl('kl-q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.defaultPrevented)"));
    // der Hilfetext zur Kundensuche haengt an der Ueberschrift "Kunde", nicht am Feld
    expect(html).toContain('<legend data-hilfe="au-kunde-suche" tabindex="0">Kunde</legend>');
    expect(html.match(/<input id="au-kunde-suche"[^>]*>/)[0]).not.toContain('data-hilfe');
  });
});

describe('Hilfetexte nicht bei fokussierten Eingabefeldern', () => {
  function umgebung(aktiv) {
    const hoerer = {};
    const doc = {
      body: { appendChild: () => {} },
      createElement: () => ({ hidden: true, style: {}, offsetWidth: 100, offsetHeight: 20, setAttribute() {}, removeAttribute() {}, appendChild() {} }),
      addEventListener: (t, fn) => { (hoerer[t] ??= []).push(fn); },
      get activeElement() { return aktiv.el; },
    };
    const win = { innerWidth: 1024, innerHeight: 768, matchMedia: () => ({ matches: true }) };
    const h = hilfeEinrichten(doc, win);
    return { ...h, feuern: (t, ev) => (hoerer[t] ?? []).forEach(fn => fn(ev)) };
  }
  const element = (attrs, { feld = false, kind = null } = {}) => {
    const e = {
      dataset: { hilfe: attrs.hilfe }, attrs: {}, parentNode: null,
      matches: sel => (sel === ':focus-visible' ? true : feld && sel.includes('input')),
      closest: sel => (sel === '[data-hilfe]' ? e : null),
      contains: x => x === e || x === kind,
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      getBoundingClientRect: () => ({ top: 10, bottom: 30, left: 10, right: 50 }),
    };
    return e;
  };
  test('Suchfeld mit Fokus: kein Tooltip (Tastatur und Maus), ohne Fokus schon', () => {
    const aktiv = { el: null };
    const u = umgebung(aktiv);
    const feld = element({ hilfe: 'lager-best-suche' }, { feld: true });
    aktiv.el = feld;
    expect(u.zeigen(feld)).toBe(false);
    u.feuern('focusin', { target: feld });
    expect(u.tip.hidden).toBe(true);
    aktiv.el = null;
    expect(u.zeigen(feld)).toBe(true);   // Maus ueber dem Feld, solange es keinen Fokus hat
  });
  test('Element, das ein fokussiertes Feld umschliesst (Label), zeigt nichts; Tippen blendet aus', () => {
    const aktiv = { el: null };
    const u = umgebung(aktiv);
    const innen = element({}, { feld: true });
    const label = element({ hilfe: 'ku-spitzname' }, { kind: innen });
    expect(u.zeigen(label)).toBe(true);
    aktiv.el = innen;
    u.feuern('input', { target: innen });
    expect(u.tip.hidden).toBe(true);
    expect(u.zeigen(label)).toBe(false);
  });
  test('Knopf mit Fokus zeigt seinen Text weiter (keine Aenderung fuer Knoepfe)', () => {
    const aktiv = { el: null };
    const u = umgebung(aktiv);
    const knopf = element({ hilfe: 'abgleich' });
    aktiv.el = knopf;
    expect(u.zeigen(knopf)).toBe(true);
  });
});

describe('kein title= an Knoepfen', () => {
  test('statisch kein <button … title=…>', () => {
    expect([...html.matchAll(/<button[^>]*\stitle="/g)].length).toBe(0);
  });
  test('kein title an Knoepfen im Code (erlaubt: Toast, Kategorie-Label, Haken "alle")', () => {
    const zuweisungen = [...html.matchAll(/(\w+)\.title = /g)].map(m => m[1]);
    expect(zuweisungen.sort()).toEqual(['el', 'label', 'masterCb']);
  });
});

describe('AM-2-2: Modell als Trefferzeile', () => {
  const M = new Function(`${ku}\n${tw}\nreturn { twModell, twHtml };`)();
  test('Modell fett · Name · Marke; nur ausgelaufene nicht waehlbar', () => {
    const z = M.twModell({ catalogNr: 'E3005', bezeichnung: 'Women´s Premium-T', marke: 'Promodoro', bestellbar: true });
    expect(M.twHtml('m', [z])).toContain('<strong>E3005</strong> · Women´s Premium-T · Promodoro');
    expect(M.twModell({ catalogNr: 'X1', bestellbar: false })).toMatchObject({ aus: true, rechts: 'nur ausgelaufene Varianten' });
  });
});
