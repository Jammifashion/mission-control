// GS1: Gutschrift-Spalte der FP-Abrechnungen - Block `FP-Gutschrift: Anfang/Ende` in index.html. Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── FP-Gutschrift: Anfang'), html.indexOf('// ── FP-Gutschrift: Ende'));
const teil = html.slice(html.indexOf('// ── FP-Gutschrift: Anfang'), html.indexOf('// ── Festpreise Tab (Partner + Kategorie'));
const _escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const f = new Function('_escHtml', `${block}; return { gsAnlegenGrund, gsZelleHtml, gsVorschauHtml, gsNachsehenHtml };`)(_escHtml);

const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const liste = { bereit: true, spalten: true, linkBasis: 'https://app.lexware.de/permalink/credit-notes/edit/' };
const eintrag = (extra = {}) => ({ id: 'FPA-0009', partnerId: 'FP-009', status: 'freigegeben', grund: '', gutschrift: { id: '', am: '', status: '' }, ...extra });

test('Block vorhanden, Spalte in der Tabelle, kein title=, nur Farbvariablen', () => {
  expect(block.length).toBeGreaterThan(500);
  expect(html).toContain('<th>Gutschrift</th>');
  expect(teil).not.toMatch(/\stitle=/);
  expect(teil).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  for (const k of ['gs-anlegen', 'gs-status', 'gs-link', 'gs-nachsehen', 'gs-angelegt', 'gs-zuruecksetzen']) expect(html).toContain(`'${k}':`);
});

test('Knopf frei bei abgeschlossener Abrechnung, sonst gesperrt mit Grund', () => {
  expect(f.gsZelleHtml(eintrag(), liste)).toMatch(/data-gs-anlegen="FPA-0009" data-hilfe="gs-anlegen">Gutschrift in Lexware anlegen …/);
  expect(f.gsZelleHtml(eintrag(), { ...liste, bereit: false })).toMatch(/aria-disabled="true" data-hilfe-zusatz="Lexware-Gutschriften nicht eingerichtet/);
  expect(f.gsZelleHtml(eintrag(), { ...liste, spalten: false })).toMatch(/aria-disabled="true"[^>]*Spalten fehlen/);
  expect(f.gsZelleHtml(eintrag({ status: 'entwurf', grund: 'Abrechnung ist noch ein Entwurf' }), liste)).toMatch(/nach Freigabe/);
  expect(f.gsZelleHtml(eintrag({ grund: 'alter Stand' }), liste)).toMatch(/aria-disabled="true" data-hilfe-zusatz="alter Stand"/);
  expect(f.gsAnlegenGrund(eintrag(), null)).toMatch(/nicht geladen/);
});

test('Kennzeichen: Entwurf mit Link, unklar mit Nachsehen, nie ein Anlegen-Knopf', () => {
  const e = f.gsZelleHtml(eintrag({ gutschrift: { id: ID, am: '2026-11-22', status: 'entwurf' } }), liste);
  expect(e).toContain(`href="${liste.linkBasis}${ID}"`);
  expect(e).toContain('22.11.2026');
  expect(e).not.toContain('data-gs-anlegen');
  const u = f.gsZelleHtml(eintrag({ gutschrift: { id: '', am: '2026-11-22', status: 'unklar' } }), liste);
  expect(u).toMatch(/data-gs-nachsehen="FPA-0009"/);
  expect(u).toMatch(/data-gs-zurueck="FPA-0009"/);
  expect(u).not.toContain('data-gs-anlegen');
});

test('Vorschau: Summe = Auszahlung mit Haken, Probleme, Entwurf-Hinweis', () => {
  const v = { titel: 'Rechnungsgutschrift', einleitung: 'Folgende … zwischen 01.04.2026 und 30.06.2026', kundenNr: 'K-00900',
    abrechnung: { id: 'FPA-0009', partnerId: 'FP-009', bruttoCent: 12345 }, zeilen: [{ name: 'Muster <b>', cent: 12345 }],
    summen: { brutto: 12345, netto: 10374, mwst: 1971 }, ausgleich: -1, probleme: [] };
  const h = f.gsVorschauHtml(v);
  expect(h).toContain('Muster &#60;b&#62;');
  expect(h).toMatch(/brutto 123,45 €<\/strong> = Auszahlung der Abrechnung 123,45 € ✓/);
  expect(h).toMatch(/Rundung netto → brutto/);
  expect(h).toMatch(/genau einen <strong>Entwurf<\/strong>/);
  expect(f.gsVorschauHtml({ ...v, probleme: ['x'] })).toMatch(/Noch nicht möglich/);
});

test('Nachsehen: Funde mit "das ist sie", sonst Hinweis', () => {
  expect(f.gsNachsehenHtml('FPA-0009', { ok: true, entwuerfe: [{ id: ID, createdDate: '2026-11-22T10:00:00+01:00', totalAmount: 12.5 }] }, liste.linkBasis))
    .toMatch(new RegExp(`data-gs-angelegt="FPA-0009" data-gs-id="${ID}" data-hilfe="gs-angelegt"`));
  expect(f.gsNachsehenHtml('FPA-0009', { ok: true, entwuerfe: [] }, '')).toMatch(/nichts angelegt/);
  expect(f.gsNachsehenHtml('FPA-0009', { ok: false, grund: 'x' }, '')).toMatch(/nicht möglich: x/);
});
