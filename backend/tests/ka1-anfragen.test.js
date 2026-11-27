// KA1: Kundenanfragen - Detail, bearbeiten/abschliessen (nie loeschen), als Auftrag uebernehmen, kein values.append.
// Nur erfundene Daten.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { sheetsAttrappe } from './hilfen/sheets-attrappe.js';
import {
  SPALTEN, SPALTE_AUFTRAG, anfragenAus, bearbeitenPlan, neueAnfrage, verknuepfenPlan, naechsteAnfrageId, istOffen, STATUS,
} from '../utils/anfragen.js';
import { legeAnfrageAn, bearbeiteAnfrage, verknuepfeAuftrag, leseAnfragen } from '../lib/anfragen.js';
import { anlagePlan } from '../utils/auftraege.js';

const lies = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const NOTIZ = ['// Kanal: Homepage | E-Mail | Manuell'];
const zeile = (id, ueber = {}) => {
  const o = { 'Anfrage-ID': id, Datum: '26.11.2026', Kanal: 'Homepage', 'Kunde-Name': 'Erika Beispiel', 'Kunde-Email': 'erika@example.invalid',
    'Produkt-Beschreibung': 'Shirts mit Logo', Menge: '20', Varianten: 'M, L', 'Partner-ID': '', Preisvorschlag: 300,
    'Anmerkungen-Kunde': 'bis Mai', Status: 'Neu', 'Notiz-intern': '', 'WC-Order-ID': '', ...ueber };
  return SPALTEN.map(s => o[s]);
};

describe('Logik', () => {
  test('anfragenAus: Notizzeile und Leerzeilen fallen weg, Zeile + Stand je Anfrage', () => {
    const { anfragen } = anfragenAus([SPALTEN, NOTIZ, zeile('KA-2026-0001'), [], zeile('KA-2026-0002')]);
    expect(anfragen.map(a => [a.anfrageId, a.zeile])).toEqual([['KA-2026-0001', 3], ['KA-2026-0002', 5]]);
    expect(anfragen[0].stand).toMatch(/^[0-9a-f]{16}$/);
    expect(anfragen[0].stand).not.toBe(anfragen[1].stand);
    expect(anfragen[0].kundeEmail).toBe('erika@example.invalid');
    expect(anfragen[0].preisvorschlag).toBe('300');
  });
  test('Status: neue Liste mit "Abgelehnt", offen = alles ausser Abgeschlossen/Abgelehnt', () => {
    expect(STATUS).toEqual(['Neu', 'Geprüft', 'Angebot-gesendet', 'Bestätigt', 'Abgeschlossen', 'Abgelehnt']);
    expect(istOffen('Bestätigt')).toBe(true);
    expect(istOffen('Abgelehnt')).toBe(false);
    expect(istOffen('In-Produktion')).toBe(true);
  });
  test('bearbeitenPlan: nur Geaendertes, Pruefungen ohne Kundendaten im Text', () => {
    const a = anfragenAus([SPALTEN, zeile('KA-2026-0001')]).anfragen[0];
    expect(bearbeitenPlan({ anfrage: a, felder: { status: 'Geprüft', menge: '20', kundeEmail: ' neu@example.invalid ' } }).aenderung)
      .toEqual({ Status: 'Geprüft', 'Kunde-Email': 'neu@example.invalid' });
    expect(() => bearbeitenPlan({ anfrage: a, felder: { kundeEmail: 'kaputt' } })).toThrow(/keine gültige E-Mail/);
    expect(() => bearbeitenPlan({ anfrage: a, felder: { kundeName: '' } })).toThrow(/darf nicht leer/);
    expect(() => bearbeitenPlan({ anfrage: a, felder: { status: 'In-Produktion' } })).toThrow(/Status muss/);
    expect(() => bearbeitenPlan({ anfrage: a, felder: { Status: 'Neu' } })).toThrow(/nicht änderbar/);
    expect(() => bearbeitenPlan({ anfrage: a, felder: { preisvorschlag: 'viel' } })).toThrow(/als Zahl/);
    expect(bearbeitenPlan({ anfrage: a, felder: { preisvorschlag: '350,50' } }).aenderung).toEqual({ Preisvorschlag: 350.5 });
    // Altwert bleibt erlaubt, solange er gesetzt ist
    const alt = { ...a, status: 'In-Produktion' };
    expect(bearbeitenPlan({ anfrage: alt, felder: { status: 'In-Produktion' } }).aenderung).toEqual({});
  });
  test('neueAnfrage: streng (MC) vs. locker (Kundenchat - nie verloren)', () => {
    expect(() => neueAnfrage({ eingabe: { kundeName: 'X', kundeEmail: 'kaputt', produktBeschreibung: 'Y' }, anfrageId: 'KA-2026-0001', datum: 'd' })).toThrow(/E-Mail/);
    const z = neueAnfrage({ eingabe: { kundeName: 'X', kundeEmail: 'kaputt', kanal: 'Homepage', preisvorschlag: 'ca 300 €' },
      anfrageId: 'KA-2026-0001', datum: '27.11.2026', kanalErsatz: 'Homepage', locker: true });
    expect(z).toMatchObject({ 'Anfrage-ID': 'KA-2026-0001', 'Kunde-Email': 'kaputt', Preisvorschlag: 300, Status: 'Neu', Datum: '27.11.2026' });
    expect(() => neueAnfrage({ eingabe: { kundeName: 'X', kundeEmail: 'x@example.invalid', produktBeschreibung: 'Y', kanal: 'Fax' }, anfrageId: 'KA-2026-0001', datum: 'd' })).toThrow(/Kanal/);
  });
  test('verknuepfenPlan: Bestaetigt + Auftrag_Nr, nie eine fremde AU ueberschreiben', () => {
    const a = { anfrageId: 'KA-2026-0002', status: 'Geprüft', auftragNr: '' };
    expect(verknuepfenPlan({ anfrage: a, auftragNr: 'AU-2026-0010' }).aenderung).toEqual({ [SPALTE_AUFTRAG]: 'AU-2026-0010', Status: 'Bestätigt' });
    expect(verknuepfenPlan({ anfrage: { ...a, status: 'Abgeschlossen' }, auftragNr: 'AU-2026-0010' }).aenderung).toEqual({ [SPALTE_AUFTRAG]: 'AU-2026-0010' });
    expect(verknuepfenPlan({ anfrage: { ...a, status: 'Bestätigt', auftragNr: 'AU-2026-0010' }, auftragNr: 'AU-2026-0010' }).aenderung).toEqual({});
    expect(() => verknuepfenPlan({ anfrage: { ...a, auftragNr: 'AU-2026-0009' }, auftragNr: 'AU-2026-0010' })).toThrow(expect.objectContaining({ status: 409 }));
  });
  test('naechsteAnfrageId je Jahr', () => {
    expect(naechsteAnfrageId(['KA-2026-0001', 'KA-2026-0007', 'KA-2025-0042'], 2026)).toBe('KA-2026-0008');
    expect(naechsteAnfrageId([], 2027)).toBe('KA-2027-0001');
  });
});

describe('Schreibwege (In-Memory-Sheet, ohne append)', () => {
  let tabs, sheets;
  beforeEach(() => {
    process.env.BUSINESS_SHEET_ID = 'test-business';
    tabs = { Kundenanfragen: [SPALTEN, NOTIZ, zeile('KA-2026-0001'), zeile('KA-2026-0002', { Status: 'Geprüft' })] };
    sheets = sheetsAttrappe(() => tabs);
  });

  test('legeAnfrageAn: naechste Nummer in die erste freie Zeile, kein append', async () => {
    const r = await legeAnfrageAn({ eingabe: { kundeName: 'Max Muster', kundeEmail: 'max@example.invalid', produktBeschreibung: 'Hoodies' },
      sheets, jetzt: () => new Date('2026-11-27T10:00:00Z') });
    expect(r.anfrageId).toBe('KA-2026-0003');
    expect(tabs.Kundenanfragen[4].slice(0, 3)).toEqual(['KA-2026-0003', '27.11.2026', 'Manuell']);
    expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
  });

  test('bearbeiteAnfrage: Stand wie gesehen, sonst 409; nur geaenderte Zellen', async () => {
    const { anfragen } = await leseAnfragen({ sheets });
    const a = anfragen.find(x => x.anfrageId === 'KA-2026-0002');
    const r = await bearbeiteAnfrage({ sheets, eingabe: { anfrageId: a.anfrageId, stand: a.stand, felder: { status: 'Abgelehnt', notizIntern: 'kein Budget' } } });
    expect(r.anfrage).toMatchObject({ status: 'Abgelehnt', notizIntern: 'kein Budget' });
    expect(tabs.Kundenanfragen[3][11]).toBe('Abgelehnt');
    const daten = sheets.spreadsheets.values.batchUpdate.mock.calls.flatMap(([x]) => x.requestBody.data.map(d => d.range));
    expect(daten.sort()).toEqual(["'Kundenanfragen'!L4", "'Kundenanfragen'!M4"]);
    // alter Stand -> 409, nichts geschrieben
    await expect(bearbeiteAnfrage({ sheets, eingabe: { anfrageId: a.anfrageId, stand: a.stand, felder: { status: 'Neu' } } }))
      .rejects.toMatchObject({ status: 409, code: 'konflikt' });
    expect(tabs.Kundenanfragen[3][11]).toBe('Abgelehnt');
    // Zeilen werden nie geloescht
    expect(tabs.Kundenanfragen).toHaveLength(4);
  });

  test('verknuepfeAuftrag: ohne Spalte Auftrag_Nr 409 einrichtung, mit Spalte Bestaetigt + AU-Nr.', async () => {
    await expect(verknuepfeAuftrag({ sheets, anfrageId: 'KA-2026-0001', auftragNr: 'AU-2026-0005' })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    tabs.Kundenanfragen[0] = [...SPALTEN, SPALTE_AUFTRAG];
    await verknuepfeAuftrag({ sheets, anfrageId: 'KA-2026-0001', auftragNr: 'AU-2026-0005' });
    expect(tabs.Kundenanfragen[2][11]).toBe('Bestätigt');
    expect(tabs.Kundenanfragen[2][14]).toBe('AU-2026-0005');
    await expect(verknuepfeAuftrag({ sheets, anfrageId: 'KA-2026-0001', auftragNr: 'AU-2026-0006' })).rejects.toMatchObject({ status: 409, code: 'schon_verknuepft' });
    await expect(verknuepfeAuftrag({ sheets, anfrageId: 'KA-2026-0099', auftragNr: 'AU-2026-0006' })).rejects.toMatchObject({ status: 404 });
  });

  test('fehlende Pflichtspalte -> Fehler, nie Spalte -1', async () => {
    tabs.Kundenanfragen[0] = SPALTEN.filter(s => s !== 'Status');
    await expect(leseAnfragen({ sheets })).rejects.toThrow(/Spalte Status fehlt/);
  });
});

describe('Auftrag aus Anfrage (Anfrage_ID)', () => {
  const eingabe = { Kunden_Nr: 'K-00001', Kurztitel: 'Shirts', vorgang: 'vorgang-12345678' };
  const jetzt = '2026-11-27T10:00:00.000Z';
  test('Anfrage_ID wird vermerkt, nur KA-Nummer, je Anfrage ein Auftrag', () => {
    expect(anlagePlan({ auftraege: [], positionen: [], eingabe: { ...eingabe, Anfrage_ID: 'KA-2026-0002' }, waehlbar: new Set(), orte: [], jetzt }).auftrag.Anfrage_ID).toBe('KA-2026-0002');
    expect(() => anlagePlan({ auftraege: [], positionen: [], eingabe: { ...eingabe, Anfrage_ID: 'egal' }, waehlbar: new Set(), orte: [], jetzt })).toThrow(/Anfrage-Nummer/);
    const schon = [{ Auftrag_Nr: 'AU-2026-0001', Anfrage_ID: 'KA-2026-0002', Status: 'Design' }];
    expect(() => anlagePlan({ auftraege: schon, positionen: [], eingabe: { ...eingabe, Anfrage_ID: 'KA-2026-0002' }, waehlbar: new Set(), orte: [], jetzt }))
      .toThrow(expect.objectContaining({ status: 409, code: 'anfrage_schon' }));
    expect(anlagePlan({ auftraege: [{ ...schon[0], Status: 'storniert' }], positionen: [], eingabe: { ...eingabe, Anfrage_ID: 'KA-2026-0002' }, waehlbar: new Set(), orte: [], jetzt }).auftrag.Anfrage_ID).toBe('KA-2026-0002');
  });
  test('Route /neu verknuepft nach dem Anlegen; Fehler dort stoppt den Auftrag nicht', () => {
    const r = lies('../routes/auftraege.js');
    const neu = r.slice(r.indexOf("router.post('/neu'"), r.indexOf("router.post('/bearbeiten'"));
    expect(neu.indexOf('pruefeAnfrageDa')).toBeLessThan(neu.indexOf('legeAuftragAn'));
    expect(neu.indexOf('legeAuftragAn')).toBeLessThan(neu.indexOf('verknuepfeAuftrag'));
    expect(neu).toMatch(/catch \(e\) \{ r\.anfrage = \{ anfrageId, verknuepft: false/);
  });
});

describe('Quelltext', () => {
  test('kein values.append fuer Kundenanfragen mehr, kein Loeschweg', () => {
    for (const f of ['../routes/anfragen.js', '../routes/anfragen-chat.js', '../lib/anfragen.js']) {
      expect(lies(f)).not.toMatch(/\.append\(\{/);
      expect(lies(f)).not.toMatch(/router\.delete|deleteDimension/);
    }
    expect(lies('../routes/anfragen-chat.js')).toMatch(/legeAnfrageAn\(/);
  });
  test('keine Kundendaten ins Log', () => {
    const l = lies('../lib/anfragen.js') + lies('../routes/anfragen.js');
    expect(l).not.toMatch(/console\.(log|warn|error)\([^)]*(kunde|Kunde-|Email|Name)/);
  });
});

describe('Oberflaeche (index.html)', () => {
  const html = lies('../../frontend/index.html');
  const sek = html.slice(html.indexOf('// ── SECTION: Kundenanfragen Extern ──'), html.indexOf('// ── SECTION: Settings ──'));
  test('Monitor-Karte oeffnet den Dialog, mit E-Mail', () => {
    const mon = html.slice(html.indexOf('function monRenderAnfragen'), html.indexOf('function monToggleFulfillment'));
    expect(mon).toMatch(/data-anf-oeffnen=/);
    expect(mon).toMatch(/window\.anfOeffnen/);
    expect(mon).toMatch(/kundeEmail/);
  });
  test('Dialog: mailto mit Betreff, Standard-Filter offen, NAV6-Dialog, kein title', () => {
    expect(sek).toMatch(/subject=\$\{encodeURIComponent\(`Ihre Anfrage \$\{r\.anfrageId\}`\)\}/);
    expect(html).toMatch(/<option value="offen">Offene<\/option>/);
    const filter = html.slice(html.indexOf('id="anf-filter-status"'), html.indexOf('id="anf-filter-kanal"'));
    expect(filter.indexOf('<option value="offen">')).toBeLessThan(filter.indexOf('<option value="">Alle Status</option>'));
    expect(html).toMatch(/const NV_DIALOG = [^\n]*\.anf-side-panel\.is-open/);
    expect(sek).not.toMatch(/\stitle=/);
    expect(sek).toMatch(/\/api\/anfragen\/bearbeiten/);
    expect(sek).not.toMatch(/method: 'DELETE'/);
    expect(sek).not.toMatch(/localStorage\.setItem\([^)]*search/i);
  });
  test('Als Auftrag uebernehmen: Schnellannahme mit KA-Nr., Anfrage_ID im Body', () => {
    expect(html).toMatch(/window\.auAusAnfrage = async \(\{ anfrageId, text \}\)/);
    expect(html).toMatch(/\.\.\.\(auDlg\.anfrage \? \{ Anfrage_ID: auDlg\.anfrage \} : \{\}\)/);
    expect(html).toMatch(/data-au-anfrage=/);
  });
});
