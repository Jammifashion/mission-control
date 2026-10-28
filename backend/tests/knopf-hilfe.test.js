// UX1: Erklaerungen fuer Warenkorb, Aktionsleiste und Bestelluebersicht. Prueft den Block
// "Knopf-Hilfe" in index.html: jeder Knopf mit data-hilfe hat einen Text aus KNOPF_HILFE (kein leerer
// Tooltip), die ⓘ-Listen kennen alle Texte, und das Tooltip erscheint bei Tastatur-Fokus.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const von  = html.indexOf('// ── Knopf-Hilfe: Anfang');
const bis  = html.indexOf('// ── Knopf-Hilfe: Ende ──');
const { KNOPF_HILFE, HILFE_GRUPPEN, hilfeText, hilfeLegendeHtml, hilfeEinrichten } = new Function(
  `${html.slice(von, bis)}\nreturn { KNOPF_HILFE, HILFE_GRUPPEN, hilfeText, hilfeLegendeHtml, hilfeEinrichten };`)();

const benutzt = [...[...html.matchAll(/data-hilfe="([a-z0-9-]+)"/g)].map(m => m[1]),
  // BO4f: Hilfetexte, die erst im Code gesetzt werden (gesperrter Knopf im Dialog "L-Shop-Bestellung")
  ...[...html.slice(html.indexOf('function ediKnoepfe('), html.indexOf('function ediNachErzeugen(')).matchAll(/'(edi-[a-z-]+)'/g)].map(m => m[1]),
  // LS4-1: Grund am Knopf "Übernehmen" (L-Shop-Modelle)
  ...[...html.slice(html.indexOf('function lsmUebernehmenGrund('), html.indexOf('function lsmVorschauText(')).matchAll(/'(lsm-[a-z-]+)'/g)].map(m => m[1])];
// Oeffnendes Tag eines Elements mit dieser id (statisch im HTML).
const tag = id => html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

describe('Texte', () => {
  test('Block gefunden, Texte vorhanden', () => {
    expect(von).toBeGreaterThan(0);
    expect(Object.keys(KNOPF_HILFE).length).toBeGreaterThanOrEqual(15);
  });

  test.each(Object.entries(KNOPF_HILFE))('%s: Name und Text nicht leer, kurz', (_, h) => {
    expect(h.name.trim()).not.toBe('');
    expect(h.text.trim()).not.toBe('');
    expect(h.text.length).toBeLessThanOrEqual(130);
  });

  test('jedes data-hilfe im HTML hat einen Text (kein leerer Tooltip)', () => {
    expect(benutzt.length).toBeGreaterThanOrEqual(20);
    for (const k of benutzt) expect([k, hilfeText(k)]).toEqual([k, expect.stringMatching(/\S/)]);
  });

  test('jeder Text wird benutzt und steht in einer ⓘ-Liste', () => {
    const inGruppen = new Set(Object.values(HILFE_GRUPPEN).flat());
    for (const k of Object.keys(KNOPF_HILFE)) {
      expect([k, benutzt.includes(k)]).toEqual([k, true]);
      expect([k, inGruppen.has(k)]).toEqual([k, true]);
    }
    for (const k of inGruppen) expect([k, hilfeText(k)]).toEqual([k, expect.stringMatching(/\S/)]);
  });

  test('Du-Form, ohne Fachwoerter wie FTP oder SSOT', () => {
    const alle = Object.values(KNOPF_HILFE).map(h => h.text).join(' ');
    expect(alle).not.toMatch(/\b(Sie|Ihnen|Ihre?)\b/);
    expect(alle).not.toMatch(/FTP|SSOT|Reiter|Endpunkt|API/);
  });
});

describe('Knoepfe tragen data-hilfe', () => {
  test.each([
    'korb-eigen-btn', 'korb-abgleich-btn', 'korb-belege-btn', 'korb-alle-btn',
    'korb-grund', 'korb-notiz', 'korb-herausnehmen', 'korb-edi-btn', 'korb-auswahl-weg',
    'uebersicht-eigen-link', 'uebersicht-zaehlliste-btn', 'uebersicht-abgleich-btn',
  ])('#%s', id => {
    expect(tag(id)).toMatch(/data-hilfe="[^"]+"/);
    expect(tag(id)).not.toMatch(/\btitle=/);   // sonst doppelter Tooltip
  });

  test('jeder Filter- und Gruppieren-Knopf', () => {
    const filter = [...html.matchAll(/<button[^>]*data-(filter|gruppe|bfilter|pfilter)="[^"]+"[^>]*>/g)].map(m => m[0]);
    expect(filter.length).toBe(11);   // Korb 3, Uebersicht 3, BO4d L-Shop-Bestellungen 3, PS1 Bestellansicht 2
    for (const t of filter) expect(t).toMatch(/data-hilfe="[^"]+"/);
  });

  test('zurück auf offen und Zaehlliste-Knoepfe (dynamisch)', () => {
    expect(html).toMatch(/data-zurueck="\$\{korbEsc\(p\.schluessel\)\}" data-hilfe="zurueck"/);
    expect(html).toMatch(/id="zl-drucken" data-hilfe="zl-drucken"/);
    expect(html).toMatch(/id="zl-zurueck" data-hilfe="zl-zurueck"/);
  });

  test('jedes ⓘ hat eine Gruppe und eine Liste mit dieser id', () => {
    const knoepfe = [...html.matchAll(/data-hilfe-gruppe="([^"]+)" aria-controls="([^"]+)"/g)];
    expect(knoepfe.map(m => m[1]).sort()).toEqual(Object.keys(HILFE_GRUPPEN).sort());
    for (const [, , ziel] of knoepfe) expect(tag(ziel)).toMatch(/class="hilfe-legende"/);
  });

  test('Funktion unveraendert: alle Klick-Handler haengen noch an ihren ids', () => {
    for (const id of ['korb-eigen-btn', 'korb-abgleich-btn', 'korb-belege-btn', 'korb-alle-btn', 'korb-herausnehmen',
      'korb-edi-btn', 'korb-auswahl-weg', 'uebersicht-eigen-link', 'uebersicht-zaehlliste-btn', 'uebersicht-abgleich-btn',
      'korb-filter', 'uebersicht-gruppe']) {
      expect([id, html.includes(`getElementById('${id}')?.addEventListener('click'`)]).toEqual([id, true]);
    }
  });
});

describe('ⓘ-Liste', () => {
  test('enthaelt Name und Text der Gruppe, maskiert', () => {
    const l = hilfeLegendeHtml('korb');
    expect(l).toContain('<dt>Offen</dt>');
    expect(l).toContain(`<dd>${KNOPF_HILFE.abgleich.text}</dd>`);
    expect((l.match(/<dt>/g) ?? []).length).toBe(HILFE_GRUPPEN.korb.length);
    expect(hilfeLegendeHtml('gibtsnicht')).toBe('<dl></dl>');
  });
});

// ── Kleiner Ersatz fuer document/window (Jest laeuft ohne Browser) ──
function el(attrs = {}, { fokusSichtbar = true } = {}) {
  const a = { ...attrs };
  const e = {
    hidden: false, innerHTML: '', textContent: '', style: {}, offsetWidth: 200, offsetHeight: 40, parent: null,
    get dataset() {
      return Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('data-'))
        .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
    },
    getAttribute: k => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
    removeAttribute: k => { delete a[k]; },
    hasAttribute: k => k in a,
    matches: sel => (sel === ':focus-visible' ? fokusSichtbar : false),
    closest(sel) {
      const attr = sel.match(/^\[([a-z-]+)\]$/)?.[1];
      for (let x = e; x; x = x.parent) if (x.hasAttribute(attr)) return x;
      return null;
    },
    contains: x => { for (; x; x = x.parent) if (x === e) return true; return false; },
    getBoundingClientRect: () => ({ top: 100, bottom: 130, left: 900, right: 1000 }),
  };
  return e;
}
function umgebung({ hover = true } = {}) {
  const hoerer = {};
  const ids = {};
  const doc = {
    body: { appendChild: x => { ids[x.id] = x; } },
    createElement: () => el(),
    getElementById: id => ids[id] ?? null,
    addEventListener: (typ, fn) => { (hoerer[typ] ??= []).push(fn); },
  };
  const win = { innerWidth: 1024, innerHeight: 768, matchMedia: () => ({ matches: hover }) };
  const feuern = (typ, ev) => (hoerer[typ] ?? []).forEach(fn => fn(ev));
  const h = hilfeEinrichten(doc, win);
  return { doc, ids, feuern, ...h };
}

describe('Tooltip', () => {
  test('erscheint bei Tastatur-Fokus mit dem Text, aria-describedby gesetzt', () => {
    const u = umgebung();
    const knopf = el({ 'data-hilfe': 'abgleich' });
    expect(u.tip.hidden).toBe(true);
    expect(u.tip.getAttribute('role')).toBe('tooltip');
    u.feuern('focusin', { target: knopf });
    expect(u.tip.hidden).toBe(false);
    expect(u.tip.textContent).toBe(KNOPF_HILFE.abgleich.text);
    expect(knopf.getAttribute('aria-describedby')).toBe('mc-tip');
    // nie ueber den rechten Rand: 1024 - 200 - 8
    expect(u.tip.style.left).toBe('816px');
    u.feuern('focusout', {});
    expect(u.tip.hidden).toBe(true);
    expect(knopf.getAttribute('aria-describedby')).toBeNull();
  });

  test('Fokus-Tooltip bleibt, wenn darunter neu gezeichnet wird (mouseout, scroll)', () => {
    const u = umgebung();
    const knopf = el({ 'data-hilfe': 'filter-alle' });
    u.feuern('focusin', { target: knopf });
    u.feuern('mouseout', { relatedTarget: null });
    u.feuern('scroll', {});
    expect(u.tip.hidden).toBe(false);
    expect(u.tip.textContent).toBe(KNOPF_HILFE['filter-alle'].text);
  });

  test('Fokus durch Antippen (kein :focus-visible) zeigt nichts', () => {
    const u = umgebung();
    u.feuern('focusin', { target: el({ 'data-hilfe': 'abgleich' }, { fokusSichtbar: false }) });
    expect(u.tip.hidden).toBe(true);
  });

  test('Maus: nur auf Geraeten mit hover; Kind-Element zaehlt zum Knopf', () => {
    const u = umgebung();
    const knopf = el({ 'data-hilfe': 'filter-raus' });
    const zahl = el(); zahl.parent = knopf;   // <small> im Filterknopf
    u.feuern('mouseover', { target: zahl });
    expect(u.tip.textContent).toBe(KNOPF_HILFE['filter-raus'].text);
    u.feuern('mouseout', { relatedTarget: zahl });
    expect(u.tip.hidden).toBe(false);
    u.feuern('mouseout', { relatedTarget: null });
    expect(u.tip.hidden).toBe(true);

    const handy = umgebung({ hover: false });
    handy.feuern('mouseover', { target: el({ 'data-hilfe': 'filter-raus' }) });
    expect(handy.tip.hidden).toBe(true);
  });

  test('Escape schliesst, unbekannter Schluessel zeigt keinen leeren Tooltip', () => {
    const u = umgebung();
    u.feuern('focusin', { target: el({ 'data-hilfe': 'edi' }) });
    u.feuern('keydown', { key: 'Escape' });
    expect(u.tip.hidden).toBe(true);
    expect(u.zeigen(el({ 'data-hilfe': 'gibtsnicht' }))).toBe(false);
    expect(u.tip.hidden).toBe(true);
  });

  test('ⓘ klappt die Liste der Gruppe auf und zu', () => {
    const u = umgebung();
    const liste = el({ id: 'hilfe-korb' }); liste.hidden = true;
    u.ids['hilfe-korb'] = liste;
    const i = el({ 'data-hilfe-gruppe': 'korb', 'aria-controls': 'hilfe-korb', 'aria-expanded': 'false' });
    u.feuern('click', { target: i });
    expect(liste.hidden).toBe(false);
    expect(liste.innerHTML).toBe(hilfeLegendeHtml('korb'));
    expect(i.getAttribute('aria-expanded')).toBe('true');
    u.feuern('click', { target: i });
    expect(liste.hidden).toBe(true);
    expect(i.getAttribute('aria-expanded')).toBe('false');
  });
});
