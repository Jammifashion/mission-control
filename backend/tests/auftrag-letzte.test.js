// AM-6-1: Dialog "Neuer Auftrag" - letzte 3 Auftraege zum Nachsehen, "Als Vorlage übernehmen", EK von Hand mitkopieren.
// Nur erfundene Werte.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const ab = (a, b) => html.slice(html.indexOf(a), html.indexOf(b));
const block = ab('// ── Auftrag-Historie: Anfang', '// ── Auftrag-Historie: Ende ──');
const anzeige = ab('// ── Auftraege-Anzeige: Anfang', '// ── Auftraege-Anzeige: Ende ──');
const preise = ab('// ── Auftrag-Preise: Anfang', '// ── Auftrag-Preise: Ende ──');
const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const F = new Function('kuEsc', 'lfbText', 'grSortiere', `${preise}\n${anzeige}\n${block}\nreturn { auLetzteAuftraege, auLetzteHtml, auNachsehenHtml, auHatEingaben, auVorlageAus };`)(kuEsc, () => '', undefined);

const A = (n, x = {}) => ({ Auftrag_Nr: `AU-2026-000${n}`, Kunden_Nr: 'K-00001', Kurztitel: `Titel ${n}`, Status: 'bestellt', Anfrage_Am: `2026-0${n}-01`,
  Angelegt: `2026-0${n}-01T10:00:00Z`, stueck: n, positionen: [], ...x });

describe('Letzte Aufträge', () => {
  const liste = [A(1), A(2, { Status: 'storniert' }), A(3), A(4), A(5, { Kunden_Nr: 'K-00002' }), A(6), { Aufgabe_Nr: 'AG-2026-0001', Auftrag_Nr: 'AG-2026-0001', Kunden_Nr: 'K-00001', Angelegt: '2026-09-01' }];
  test('hoechstens 3, neueste zuerst, ohne stornierte, ohne Aufgaben, nur dieser Kunde; mehr -> Link', () => {
    const r = F.auLetzteAuftraege(liste, 'K-00001');
    expect(r.liste.map(a => a.Auftrag_Nr)).toEqual(['AU-2026-0006', 'AU-2026-0004', 'AU-2026-0003']);
    expect(r.mehr).toBe(true);
    expect(F.auLetzteHtml(liste, 'K-00001')).toContain('data-au-letzte-alle data-hilfe="au-letzte-alle">alle in der Kundenkarte');
  });
  test('genau 3 oder weniger: kein Link', () => {
    expect(F.auLetzteAuftraege([A(1), A(3)], 'K-00001')).toEqual({ liste: [expect.objectContaining({ Auftrag_Nr: 'AU-2026-0003' }), expect.objectContaining({ Auftrag_Nr: 'AU-2026-0001' })], mehr: false });
    expect(F.auLetzteHtml([A(1), A(3), A(4)], 'K-00001')).not.toContain('alle in der Kundenkarte');
  });
  test('Kunde ohne Auftraege (oder nur stornierte): leer -> Liste unsichtbar', () => {
    expect(F.auLetzteHtml(liste, 'K-09999')).toBe('');
    expect(F.auLetzteHtml([A(2, { Status: 'storniert' })], 'K-00001')).toBe('');
  });
  test('Zeile: AU-Nr. · Datum · Kurztitel · Status-Chip · Stueck · Summe netto (falls Preise)', () => {
    const h = F.auLetzteHtml([A(4, { preise: { netto: 100, nettoNach: 12345 } })], 'K-00001');
    expect(h).toContain('data-au-letzte="AU-2026-0004" data-hilfe="au-letzte"');
    expect(h).toContain('01.04.2026');
    expect(h).toContain('Titel 4');
    expect(h).toContain('au-st-bestellt');
    expect(h).toContain('4 Stück');
    expect(h).toContain('123,45 € netto');
    expect(F.auLetzteHtml([A(4)], 'K-00001')).not.toContain('netto');
  });
});

describe('Nachsehen (nur lesen)', () => {
  const a = A(4, { Kanal: 'Mail', positionen: [
    { Position_ID: 'x1', Art: 'lshop', LShop_ArticleNr: '1000000001', Menge: '3', Motiv: 'Wappen', Druck: 'Brust', Preis_Netto: 12.5, lshop: { modell: 'M1', farbe: 'Navy', groesse: 'S' } },
    { Position_ID: 'x2', Art: 'frei', Freitext: 'Tasse', Menge: '2' },
  ] });
  test('zeigt Gruppen, Mengen, Motiv/Druck, Preis - ohne Eingabefelder und ohne Knoepfe', () => {
    const h = F.auNachsehenHtml(a);
    expect(h).toContain('<strong>M1</strong> · Navy · 3 Stück');
    expect(h).toContain('S × 3');
    expect(h).toContain('Motiv: Wappen');
    expect(h).toContain('12,50 €/Stück netto');
    expect(h).toContain('<strong>Tasse</strong> · frei');
    expect(h).not.toMatch(/<input|<select|<textarea|<button/);
  });
  test('Ansicht hat nur Schliessen/Zurueck und "Als Vorlage übernehmen" - kein Bearbeiten', () => {
    const dlg = ab('<div id="au-nachsehen"', '<!-- Dialog: Kunde neu / bearbeiten.');
    expect([...dlg.matchAll(/<button[^>]*id="([^"]+)"/g)].map(m => m[1])).toEqual(['au-ns-schliessen', 'au-ns-vorlage', 'au-ns-zurueck']);   // dazu nur das ⓘ (ohne id)
    expect(html.indexOf('<div id="au-nachsehen"')).toBeGreaterThan(html.indexOf('<div id="au-dialog"'));   // liegt ueber dem Dialog
  });
  test('Schliessen behaelt die Dialog-Eingaben: nur die Ansicht wird verborgen, der Dialog nicht neu geoeffnet', () => {
    const zu = ab('function auNachsehenZu()', 'const auDialogEingaben');
    expect(zu).toContain("auEl('au-nachsehen').hidden = true");
    expect(zu).not.toMatch(/auDialogOeffnen|au-dialog'\)\.hidden|entwurf\s*=/);
    const auf = ab('function auNachsehen(nr)', 'function auNachsehenZu()');
    expect(auf).not.toMatch(/auDialogOeffnen|auDlg\.entwurf\s*=|au-dialog/);
  });
});

describe('Als Vorlage übernehmen', () => {
  test('Eingaben erkannt: Positionen, Kopffelder, angefangene freie Position/Raster; Kunde allein nicht', () => {
    expect(F.auHatEingaben({ entwurf: [], felder: { Kurztitel: '', Notiz: ' ' }, offen: ['', ''] })).toBe(false);
    expect(F.auHatEingaben({ entwurf: [{ art: 'frei' }] })).toBe(true);
    expect(F.auHatEingaben({ felder: { Kurztitel: 'X' } })).toBe(true);
    expect(F.auHatEingaben({ offen: ['', '3'] })).toBe(true);
  });
  test('mit Eingaben Rueckfrage "Eingaben ersetzen?", sonst direkt; dann wie "Wie letztes Mal"', () => {
    const f = ab('async function auNachsehenVorlage()', "      auEl('au-letzte').addEventListener");
    expect(f).toContain("if (auDialogEingaben() && !await showConfirm('Eingaben ersetzen?'");
    expect(f).toContain('auDialogOeffnen(null, { vorlage: a });');
  });
});

describe('EK von Hand (Inhaber 07.11.)', () => {
  const a = A(4, { positionen: [
    { Position_ID: 'x1', Art: 'frei', Freitext: 'Tasse', Menge: '2', EK_Hand: 3.2, Preis_Netto: 8 },
    { Position_ID: 'x2', Art: 'frei', Freitext: 'Pauschale', Menge: '1', EK_Hand: '' },
    { Position_ID: 'x3', Art: 'lshop', LShop_ArticleNr: '1000000001', Menge: '1', EK_Hand: 9, lshop: { modell: 'M1', farbe: 'Navy', bestellbar: true } },
  ] });
  const v = F.auVorlageAus(a);
  test('freie Position: EK von Hand kommt mit, markiert "EK von AU-… vom …"', () => {
    expect(v.entwurf[0]).toMatchObject({ ekHand: '3,20', ekVon: 'AU-2026-0004 vom 01.04.2026' });
  });
  test('ohne EK keine Markierung; L-Shop-Positionen ohne EK von Hand', () => {
    expect(v.entwurf[1]).toMatchObject({ ekHand: '', ekVon: '' });
    expect(v.entwurf[2]).toMatchObject({ ekHand: '', ekVon: '' });
  });
  test('Markierung an der Gruppe, faellt beim Aendern weg', () => {
    expect(html).toContain('data-hilfe="au-ek-von" tabindex="0">EK von ${kuEsc(p0.ekVon)}</span>');
    expect(html).toContain("if (f.dataset.auFeld === 'ekHand') for (const p of g?.positionen ?? []) delete p.ekVon;");
  });
});

test('nichts ins Log: neue Teile ohne console', () => {
  expect(ab('function auLetzteZeichnen()', '      function auHistZeichnen()')).not.toContain('console');
  expect(block).not.toContain('console');
});
