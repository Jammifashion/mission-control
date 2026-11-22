// RE1: Oberflaeche "Abrechnen" - Block `Abrechnen: Anfang/Ende` in index.html. Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Abrechnen: Anfang'), html.indexOf('// ── Abrechnen: Ende'));
const sektion = html.slice(html.indexOf('// ── SECTION: Abrechnen (RE1) ──'), html.indexOf('// ── SECTION: Artikelerfassung ──'));
const kuEsc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const apEuroText = c => (c === null || c === undefined ? '–' : `${(c / 100).toFixed(2).replace('.', ',')} €`);
const f = new Function('kuEsc', 'apEuroText', `${block}; return { reKundenOptionen, reOffenHtml, reVorschauHtml, reAbgerechnetHtml, reNachsehenHtml, reAnlegenGrund };`)(kuEsc, apEuroText);

const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';

test('Block und Unterpunkt vorhanden, Karte inhalt-liste, Knopf mit Mouse-over', () => {
  expect(block.length).toBeGreaterThan(500);
  expect(html).toContain("{ id: 'abrechnen', label: 'Abrechnen', panel: 'auftraege' }");
  expect(html).toContain('class="card inhalt-liste" id="re-ansicht"');
  expect(html).toMatch(/id="re-anlegen" data-hilfe="re-anlegen"/);
  expect(sektion).not.toMatch(/\stitle=/);
});

test('Kunden: Bestellseite markiert, Auswahl vorbelegt', () => {
  const h = f.reKundenOptionen([{ kundenNr: 'K-00900', offen: 5, bestellseite: true }, { kundenNr: 'K-00901', offen: 1 }], nr => `Name ${nr}`, 'K-00900');
  expect(h).toMatch(/<option value="K-00900" selected>Name K-00900 · 5 offen<\/option>/);
});

test('Liste: abrechenbar mit Haken, sonst gesperrt mit Grund', () => {
  const h = f.reOffenHtml([
    { auftragNr: 'AU-2026-0001', kurztitel: 'A', liefertag: '2026-10-02', status: 'bezahlt', positionen: 3, eingabe: 'brutto', grund: '' },
    { auftragNr: 'AU-2026-0002', kurztitel: 'B', liefertag: '2026-10-10', status: 'übergeben', positionen: 2, eingabe: 'netto', grund: '2 Positionen ohne Preis' },
  ], new Set(['AU-2026-0001']));
  expect(h).toMatch(/data-re-au="AU-2026-0001"[^>]*checked/);
  expect(h).toMatch(/data-hilfe="re-gesperrt" data-hilfe-zusatz="2 Positionen ohne Preis"><input type="checkbox" data-re-au="AU-2026-0002"[^>]*disabled/);
});

test('Vorschau: Zwischenzeile, "für …" nur als Kennzeichen, Summen, Probleme sperren', () => {
  const v = { taxType: 'gross', auftraege: ['AU-2026-0001'], probleme: [], hinweis: '',
    positionen: [{ art: 'text', text: 'Lieferung 02.10.2026 · AU-2026-0001' }, { art: 'position', name: 'Muster', fuer: true, menge: 2, satz: 19, stueck: 3450, summe: 6900 }],
    summen: { netto: 5798, brutto: 6900, mwst: [{ satz: 19, betrag: 1102 }] } };
  const h = f.reVorschauHtml(v);
  expect(h).toContain('re-zwischen');
  expect(h).toContain('data-hilfe="re-fuer"');
  expect(h).toContain('69,00 €');
  expect(f.reAnlegenGrund({ bereit: true, spalten: true, gewaehlt: 1, vorschau: v })).toBe('');
  expect(f.reAnlegenGrund({ bereit: true, spalten: true, gewaehlt: 1, vorschau: { probleme: ['x'] } })).toMatch(/Noch nicht möglich/);
  expect(f.reAnlegenGrund({ bereit: false, spalten: true, gewaehlt: 1 })).toMatch(/nicht eingerichtet/);
  expect(f.reAnlegenGrund({ bereit: true, spalten: true, gewaehlt: 0 })).toMatch(/mindestens einen/);
});

test('Schon abgerechnet: Link bei ID, nachsehen nur bei unklar, entfernen nur bei MC-Kennzeichen', () => {
  const h = f.reAbgerechnetHtml([
    { auftragNr: 'AU-1', kurztitel: 'A', stand: 's', rechnung: { id: ID, am: '2026-11-22', status: 'entwurf' } },
    { auftragNr: 'AU-2', kurztitel: 'B', stand: 's', rechnung: { id: '', am: '2026-11-22', status: 'unklar' } },
    { auftragNr: 'AU-3', kurztitel: 'C', stand: 's', rechnung: { id: '', am: '', status: '', hand: 'RE-1' } },
  ], 'https://app.lexware.de/permalink/invoices/edit/');
  expect(h).toContain(`href="https://app.lexware.de/permalink/invoices/edit/${ID}" target="_blank" rel="noopener noreferrer"`);
  expect((h.match(/data-re-nachsehen=/g) || []).length).toBe(1);
  expect((h.match(/data-re-zurueck=/g) || []).length).toBe(2);
  expect(h).toContain('Rechnung (von Hand)');
});

test('Nachsehen: Fund mit Knopf, keine Funde = Hinweis, Fehler = fester Text', () => {
  expect(f.reNachsehenHtml('AU-1', { ok: true, entwuerfe: [{ id: ID, createdDate: '2026-11-22T10:00:00.000+01:00', totalAmount: 69 }] }, 'x/'))
    .toMatch(/data-re-angelegt="AU-1" data-re-id="0b1c2d3e/);
  expect(f.reNachsehenHtml('AU-1', { ok: true, entwuerfe: [] }, 'x/')).toMatch(/nichts angelegt/);
  expect(f.reNachsehenHtml('AU-1', { ok: false, grund: 'Zeitlimit' }, 'x/')).toMatch(/Nachsehen nicht möglich: Zeitlimit/);
});
