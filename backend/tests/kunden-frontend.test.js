// AM-1: Frontend-Block "Kunden-Liste" aus index.html (reine Logik) und Verdrahtung des Bereichs Aufträge.
// Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sucheKunden } from '../utils/kunden.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Kunden-Liste: Anfang'), html.indexOf('// ── Kunden-Liste: Ende ──'));
const F = new Function(`${block}\nreturn { kuSuche, kuFiltern, kuZaehler, kuZeileHtml, kuNutzdaten, kuSpitznamen };`)();
// ohne Kommentarzeilen (die nennen localStorage nur, um es auszuschliessen)
const sektion = html.slice(html.indexOf('// ── SECTION: Aufträge (AM-1) ──'), html.indexOf('// ── SECTION: Artikelerfassung ──'))
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const kunden = [
  { Kunden_Nr: 'K-00001', Lexoffice_Nr: '10001', Art: 'Verein', Name: 'Testverein', Spitzname: 'Kicker; die Blauen', Ort: 'Musterstadt', Status: 'aktiv', Quelle: 'lexoffice', Stand: 's1' },
  { Kunden_Nr: 'K-00002', Art: 'Firma', Name: 'Beispiel GmbH', Ort: 'Probehausen', Status: 'archiviert', Quelle: 'mc', Stand: 's2' },
  { Kunden_Nr: 'K-00003', Art: 'Person', Name: 'gelöscht K-00003', Status: 'gesperrt-DSGVO', Quelle: 'mc', Stand: 's3' },
  { Kunden_Nr: 'K-00004', Art: 'Firma', Name: 'Alpha <b>AG</b>', Ort: 'Musterstadt', Status: 'aktiv', Quelle: 'mc', Stand: 's4' },
];

describe('Kunden-Liste', () => {
  test('Block gefunden', () => expect(block.length).toBeGreaterThan(500));
  test('Suche gleich wie im Backend (Spitzname, Nummer, Ort, jedes Wort)', () => {
    for (const q of ['blauen', 'k-00002', '10001', 'musterstadt alpha', 'kicker probehausen', '']) {
      expect([q, F.kuSuche(kunden, q).map(k => k.Kunden_Nr)]).toEqual([q, sucheKunden(kunden, q).map(k => k.Kunden_Nr)]);
    }
  });
  test('Filter Art/Status, sortiert nach Name', () => {
    expect(F.kuFiltern(kunden, { status: 'aktiv' }).map(k => k.Kunden_Nr)).toEqual(['K-00004', 'K-00001']);
    expect(F.kuFiltern(kunden, { art: 'Firma', status: '' }).map(k => k.Kunden_Nr)).toEqual(['K-00004', 'K-00002']);
    expect(F.kuZaehler(kunden)).toEqual({ gesamt: 4, aktiv: 2, archiviert: 1, gesperrt: 1 });
  });
  test('Zeile: maskiert, Spitznamen als Kennzeichen, Knopf mit Mouse-over', () => {
    const z = F.kuZeileHtml(kunden[3]);
    expect(z).toContain('Alpha &lt;b&gt;AG&lt;/b&gt;');
    expect(z).toContain('data-hilfe="liste-bearbeiten"');
    expect(F.kuZeileHtml(kunden[0]).match(/ku-chip/g)).toHaveLength(2);
  });
  test('Nutzdaten: Lexoffice-Kunde schickt nur Spitzname/Notiz, MC-Kunde alles, neu ohne Nummer', () => {
    const werte = { Name: 'Neu', Spitzname: ' x ', Notiz: 'n', Ort: 'O', Art: 'Firma' };
    expect(Object.keys(F.kuNutzdaten(kunden[0], werte)).sort()).toEqual(['Notiz', 'Spitzname', 'kundenNr', 'stand']);
    expect(F.kuNutzdaten(kunden[1], werte)).toMatchObject({ kundenNr: 'K-00002', stand: 's2', Name: 'Neu', Ort: 'O' });
    expect(F.kuNutzdaten(null, werte)).not.toHaveProperty('kundenNr');
  });
});

describe('Verdrahtung und Datenschutz', () => {
  test('Bereich Aufträge in der Tabelle, Panel vorhanden', () => {
    expect(html).toContain("auftraege: { label: 'Aufträge', leiste: true, shop: false");
    expect(html).toContain('<section id="panel-auftraege" class="panel">');
  });
  test('Suchbegriff wird nicht gespeichert (kein localStorage, keine Adresse) und geht nicht an den Server', () => {
    expect(sektion).not.toMatch(/localStorage|sessionStorage|history\.|location\.hash/);
    expect(sektion).not.toMatch(/api\/kunden\?/);
  });
  test('Toasts nennen nur die Kunden-Nr.', () => {
    for (const z of sektion.split('\n').filter(l => l.includes('showToast('))) expect(z).not.toMatch(/\.Name|Spitzname|Ort\b/);
  });
  test('DSGVO braucht zwei Bestaetigungen (Fenster + eingetippte Nummer)', () => {
    expect(sektion).toContain("showConfirm('Kunde DSGVO sperren?'");
    expect(sektion).toContain("bestaetigung: kuEl('ku-dsgvo-nr').value.trim()");
  });
});
