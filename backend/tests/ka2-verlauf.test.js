// KA2: langer Chat bricht nicht ab (A), Gespraechsverlauf speichern/ansehen/loeschen (B). Nur erfundene Texte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';
import {
  nachrichtenAus, fuerModell, verlaufFuerSpeicher, verlaufLesen, verlaufFuerAnfrage, MAX_VERLAUF, MAX_MODELL, VERLAUF_SPALTEN, TAB_VERLAUF,
} from '../utils/anfrage-verlauf.js';
import { verlaufPlan } from '../utils/loeschlauf.js';
import { fundstellenPlan, BEREICHE } from '../utils/kunde-fundstellen.js';
import { speichereVerlauf, leseVerlauf } from '../lib/anfrageVerlauf.js';

const lies = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const gespraech = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i === 0 ? '__init__' : `Nachricht ${i}` }));

describe('Teil A: lange Gespraeche', () => {
  test('25 und 61 Nachrichten: kein Abbruch, hoechstens 60 behalten, Modell bekommt die letzten 20 ab einer Kunden-Nachricht', () => {
    for (const n of [25, 61]) {
      const v = nachrichtenAus(gespraech(n));
      expect(v).not.toBeNull();
      expect(v.length).toBe(Math.min(n, MAX_VERLAUF));
      const m = fuerModell(v);
      expect(m.length).toBeLessThanOrEqual(MAX_MODELL);
      expect(m[0].role).toBe('user');
      expect(m[m.length - 1]).toEqual(v[v.length - 1]);
    }
  });
  test('nur kaputter Body/Missbrauch -> null (400)', () => {
    expect(nachrichtenAus('x')).toBeNull();
    expect(nachrichtenAus(gespraech(1001))).toBeNull();
    expect(nachrichtenAus([{ role: 'system', content: 'x' }, { role: 'user', content: 7 }])).toEqual([]);
    expect(nachrichtenAus([{ role: 'user', content: 'a'.repeat(900) }])[0].content).toHaveLength(500);
  });
  test('Route: kein festes Limit 20 mehr, Seite deckelt auf 60', () => {
    const r = lies('../routes/anfragen-chat.js');
    expect(r).not.toMatch(/messages\.length > 20/);
    expect(r).toMatch(/const validMsgs = fuerModell\(verlauf\)/);
    const seite = lies('../../frontend/anfrage.html');
    expect(seite).toMatch(/const MAX_NACHRICHTEN = 60;/);
    expect(seite).toMatch(/messages: messages\.slice\(-MAX_NACHRICHTEN\)/);
    expect(seite).toMatch(/Bitte sende deine Anfrage jetzt ab/);
  });
});

describe('Teil B: Verlauf', () => {
  test('Speicherform ohne Startsignal, mit Abschluss-Antwort, Rollen kunde/jey, passt in eine Zelle', () => {
    const json = verlaufFuerSpeicher([{ role: 'user', content: '__init__' }, { role: 'assistant', content: 'Hallo!' }, { role: 'user', content: '20 Shirts' }], 'Danke, abgeschickt.');
    expect(verlaufLesen(json)).toEqual([{ von: 'jey', text: 'Hallo!' }, { von: 'kunde', text: '20 Shirts' }, { von: 'jey', text: 'Danke, abgeschickt.' }]);
    const lang = Array.from({ length: 60 }, () => ({ role: 'assistant', content: 'x'.repeat(2000) }));
    expect(verlaufFuerSpeicher(lang).length).toBeLessThanOrEqual(45000);
    expect(verlaufLesen('kaputt')).toBeNull();
    expect(verlaufLesen('')).toBeNull();
  });
  test('Ansicht: da / geloescht / keiner', () => {
    const werte = [VERLAUF_SPALTEN, ['KA-2026-0003', '2026-11-27T10:00:00.000Z', '[{"r":"kunde","t":"Hi"}]'], ['KA-2026-0004', '2025-01-01T10:00:00.000Z', '']];
    expect(verlaufFuerAnfrage(werte, 'KA-2026-0003')).toMatchObject({ status: 'da', nachrichten: [{ von: 'kunde', text: 'Hi' }] });
    expect(verlaufFuerAnfrage(werte, 'KA-2026-0004').status).toBe('geloescht');
    expect(verlaufFuerAnfrage(werte, 'KA-2026-0009').status).toBe('keiner');
    expect(verlaufFuerAnfrage([], 'KA-2026-0003').status).toBe('keiner');
  });
  test('Loeschlauf: immer 12 Monate nach Zeitpunkt, auch mit Auftrag', () => {
    const werte = [VERLAUF_SPALTEN, ['KA-2025-0001', '2025-10-01T10:00:00.000Z', '[]x'], ['KA-2026-0001', '2026-11-01T10:00:00.000Z', '[]y']];
    const p = verlaufPlan({ verlauf: werte, jetzt: new Date('2026-11-27T12:00:00Z') });
    expect(p.leeren.map(x => x.id)).toEqual(['KA-2025-0001']);
    expect(p.leeren[0].zellen.map(c => c.feld)).toEqual(['Nachrichten']);
    expect(lies('../lib/loeschlauf.js')).toMatch(/bereich\('Gesprächsverlauf'/);
  });
  test('DSGVO-Pruefliste: Verlauf ueber die KA-Nr. der passenden Anfragen; Leeren der Anfragen nimmt ihn mit; Sperre auch', () => {
    expect(BEREICHE.verlauf.felder).toEqual(['Nachrichten']);
    const plan = fundstellenPlan({ kundenNr: 'K-00001', kunde: { Name: 'Erika Beispiel', 'E-Mail': 'erika@example.invalid' },
      anfragen: [['Anfrage-ID', 'Kunde-Name', 'Kunde-Email'], ['KA-2026-0001', 'erika beispiel', ''], ['KA-2026-0002', 'Max', 'max@example.invalid']],
      verlauf: [VERLAUF_SPALTEN, ['KA-2026-0001', 'z', '[1]'], ['KA-2026-0002', 'z', '[2]']] });
    expect(plan.verlauf.leeren.map(x => x.id)).toEqual(['KA-2026-0001']);
    expect(lies('../lib/kundeFundstellen.js')).toMatch(/if \(bereich === 'anfragen'\) \{/);
    const route = lies('../routes/kunden.js');
    expect(route.indexOf('kundeFuerSperre(')).toBeLessThan(route.indexOf('sperreKundeDsgvo('));
    expect(route).toMatch(/bereich: 'verlauf', kunde: vorher/);
  });

  describe('Schreiben/Lesen (In-Memory-Sheet)', () => {
    let tabs, sheets;
    beforeEach(() => {
      process.env.BUSINESS_SHEET_ID = 'test-business';
      tabs = { [TAB_VERLAUF]: [VERLAUF_SPALTEN] };
      sheets = sheetsAttrappe(() => tabs);
    });
    test('speichern ohne append, lesen', async () => {
      await speichereVerlauf({ sheets, anfrageId: 'KA-2026-0005', nachrichten: [{ role: 'user', content: 'Hoodies?' }], antwort: 'Gern!',
        jetzt: () => new Date('2026-11-27T10:00:00Z') });
      expect(tabs[TAB_VERLAUF][1].slice(0, 2)).toEqual(['KA-2026-0005', '2026-11-27T10:00:00.000Z']);
      expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
      const v = await leseVerlauf({ sheets, anfrageId: 'KA-2026-0005' });
      expect(v.nachrichten).toEqual([{ von: 'kunde', text: 'Hoodies?' }, { von: 'jey', text: 'Gern!' }]);
    });
    test('Reiter fehlt: Speichern wirft einrichtung, Lesen = keiner', async () => {
      delete tabs[TAB_VERLAUF];
      tabs.Andere = [['x']];
      await expect(speichereVerlauf({ sheets, anfrageId: 'KA-2026-0005', nachrichten: [] })).rejects.toMatchObject({ code: 'einrichtung' });
      expect((await leseVerlauf({ sheets, anfrageId: 'KA-2026-0005' })).status).toBe('keiner');
    });
  });

  test('Chat-Route: Verlauf nur beim Abschluss, Fehler nur als Code im Log', () => {
    const r = lies('../routes/anfragen-chat.js');
    const block = r.slice(r.indexOf('if (completed && merged.kundeName'), r.indexOf('res.json({'));
    expect(block.indexOf('legeAnfrageAn(')).toBeLessThan(block.indexOf('speichereVerlauf('));
    expect(block).toMatch(/console\.warn\(`Chat-Verlauf nicht gespeichert: \$\{anfrageId\} \(\$\{e\.code \|\| e\.status \|\| 'Fehler'\}\)`\)/);
    expect(lies('../lib/anfrageVerlauf.js')).not.toMatch(/console\./);
  });
  test('Chat-Seite: freigegebener Satz woertlich', () => {
    expect(lies('../../frontend/anfrage.html')).toContain('Wenn Sie Ihre Anfrage absenden, speichern wir den Gesprächsverlauf zusammen mit der Anfrage, damit wir sie bearbeiten und die Qualität unserer Beratung prüfen können. Er wird spätestens 12 Monate nach der Anfrage gelöscht.');
  });
  test('MC: Verlauf im Dialog erst beim Aufklappen, Hinweis ohne Verlauf', () => {
    const html = lies('../../frontend/index.html');
    expect(html).toMatch(/<details class="anf-side-section anf-verlauf" id="anf-side-verlauf">/);
    expect(html).toMatch(/addEventListener\('toggle', anfVerlaufLaden\)/);
    expect(html).toContain('Kein Verlauf gespeichert (Anfrage vor dem 27.11. oder von Hand angelegt).');
    expect(html).not.toMatch(/(localStorage|sessionStorage)\.setItem\([^)]*verlauf/i);
  });
});
