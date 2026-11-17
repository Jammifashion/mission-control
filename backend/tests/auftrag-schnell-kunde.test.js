// SA2: Schnellannahme - neuen Kunden vorbelegt anlegen. NUR erfundene Texte und Daten, KI als Attrappe.
// Geprueft: nur woertlich Belegtes kommt durch, Form-Pruefung, Knopf nur ohne sicheren Treffer, Rohtext/Kundenfelder nie
// im Log, Oberflaeche (Knopf, vorbelegte Maske, Ruecksprung, Abbrechen laesst den Entwurf stehen).

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { schnellVorschlag } from '../lib/auftragSchnell.js';
import { KI_SCHEMA, kundeNeuForm, kundeNeuPruefen } from '../utils/auftrag-schnell.js';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const KUNDEN = [{ Kunden_Nr: 'K-00001', Name: 'TSV Musterdorf 1900 e.V.', Spitzname: '', Ort: 'Musterdorf', Status: 'aktiv' }];
const ki = (x = {}) => JSON.stringify({ kunde: [], kurztitel: 'Test', termin: '', kanal: '', wieLetztesMal: false, gruppen: [], frei: [], todos: [], hinweise: [], ...x });
const kn = (x = {}) => ({ art: '', name: '', ansprechpartner: '', strasse: '', plz: '', ort: '', email: '', telefon: '', ...x });
const lauf = (text, antwort) => schnellVorschlag({
  eingabe: { text }, jetzt: () => new Date('2026-11-17T10:00:00Z'), aufruf: async () => ({ text: antwort }), sheets: {},
  modellLesen: async () => 'claude-haiku-5-5', kundenLesen: async () => ({ kunden: KUNDEN }), historieLesen: async () => ({ gruppen: [] }),
  modelleLesen: async () => [], variantenLesen: async () => ({ varianten: [] }),
});
beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test-anthropic'; });

test('Schema: kundeNeu mit allen Feldern required, additionalProperties false', () => {
  const s = KI_SCHEMA.properties.kundeNeu;
  expect(KI_SCHEMA.required).toContain('kundeNeu');
  expect(s.additionalProperties).toBe(false);
  expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
});

describe('Faelle', () => {
  test('1 Firma mit voller Adresse (kein Treffer in MC) -> alles vorbelegt', async () => {
    const text = 'Neue Firma Beispiel Bau GmbH, Teststraße 12, 01234 Musterstadt, info@beispielbau.test, Tel 0123 456789, 20 Shirts';
    const v = await lauf(text, ki({ kunde: ['Beispiel Bau GmbH'], kundeNeu: kn({ art: 'firma', name: 'Beispiel Bau GmbH', strasse: 'Teststraße 12', plz: '01234', ort: 'Musterstadt', email: 'info@beispielbau.test', telefon: '0123 456789' }) }));
    expect(v.kunde.sicher).toBe(false);
    expect(v.kundeNeu).toEqual(kn({ art: 'Firma', name: 'Beispiel Bau GmbH', strasse: 'Teststraße 12', plz: '01234', ort: 'Musterstadt', email: 'info@beispielbau.test', telefon: '0123 456789' }));
  });
  test('2 Verein nur mit Ansprechpartner + Telefon; Telefon anders geschrieben zaehlt ueber die Ziffern', async () => {
    const text = 'SV Erfunden 09 meldet sich, Ansprechpartnerin Erika Beispiel, erreichbar 0171/2345678';
    const v = await lauf(text, ki({ kunde: ['SV Erfunden 09'], kundeNeu: kn({ art: 'verein', name: 'SV Erfunden 09', ansprechpartner: 'Erika Beispiel', telefon: '0171 2345678' }) }));
    expect(v.kundeNeu).toEqual(kn({ art: 'Verein', name: 'SV Erfunden 09', ansprechpartner: 'Erika Beispiel', telefon: '0171 2345678' }));
  });
  test('3 Person nur mit Vorname -> nur Name, kein erfundener Nachname', async () => {
    const v = await lauf('Paula will 2 Hoodies schwarz', ki({ kunde: ['Paula'], kundeNeu: kn({ art: 'person', name: 'Paula Mustermann' }) }));
    expect(v.kundeNeu).toBeUndefined();   // "Paula Mustermann" steht nicht im Text -> leer -> kein Knopf
    const w = await lauf('Paula will 2 Hoodies schwarz', ki({ kunde: ['Paula'], kundeNeu: kn({ art: 'person', name: 'Paula' }) }));
    expect(w.kundeNeu).toEqual(kn({ art: 'Person', name: 'Paula' }));
  });
  test('4 Text ohne Kundendaten -> kein kundeNeu (kein Knopf); KI ohne kundeNeu-Feld ebenso', async () => {
    expect((await lauf('20 Shirts schwarz M 10 L 10', ki({ kundeNeu: kn() }))).kundeNeu).toBeUndefined();
    expect((await lauf('20 Shirts schwarz M 10 L 10', ki())).kundeNeu).toBeUndefined();
  });
  test('5 kaputte E-Mail / PLZ / Telefon -> leer, Rest bleibt', async () => {
    const text = 'Firma Erfunden AG, Mail info(at)erfunden, PLZ 1234567, Telefon abc, Ort Musterstadt';
    const v = await lauf(text, ki({ kunde: ['Erfunden AG'], kundeNeu: kn({ art: 'firma', name: 'Erfunden AG', email: 'info(at)erfunden', plz: '1234567', telefon: 'abc', ort: 'Musterstadt' }) }));
    expect(v.kundeNeu).toEqual(kn({ art: 'Firma', name: 'Erfunden AG', ort: 'Musterstadt' }));
  });
  test('6 KI ergaenzt (PLZ aus dem Ort, Mail aus dem Namen) -> nur woertlich Belegtes bleibt', async () => {
    const text = 'Neuer Kunde Erfunden GmbH aus Musterstadt';
    const v = await lauf(text, ki({ kunde: ['Erfunden GmbH'], kundeNeu: kn({ art: 'firma', name: 'Erfunden GmbH', ort: 'Musterstadt', plz: '01234', email: 'info@erfunden.de' }) }));
    expect(v.kundeNeu).toEqual(kn({ art: 'Firma', name: 'Erfunden GmbH', ort: 'Musterstadt' }));
  });
  test('7 Kunde sicher gefunden -> kein Knopf zum Neuanlegen, auch wenn Daten im Text stehen', async () => {
    const v = await lauf('TSV Musterdorf, Musterdorf, 10 Shirts', ki({ kunde: ['TSV Musterdorf'], kundeNeu: kn({ art: 'verein', name: 'TSV Musterdorf', ort: 'Musterdorf' }) }));
    expect(v.kunde.sicher).toBe(true);
    expect(v.kundeNeu).toBeUndefined();
  });
  test('8 Rohtext und Kundenfelder nie im Log', async () => {
    const spione = ['log', 'warn', 'error', 'info', 'debug'].map(f => jest.spyOn(console, f).mockImplementation(() => {}));
    const text = 'Neu: Erfundene Erika Beispiel, Teststraße 9, 01234 Musterstadt, erika@beispiel.test';
    await lauf(text, ki({ kunde: ['Erika Beispiel'], kundeNeu: kn({ art: 'person', name: 'Erika Beispiel', strasse: 'Teststraße 9', plz: '01234', ort: 'Musterstadt', email: 'erika@beispiel.test' }) }));
    await lauf(text, 'kaputt').catch(() => {});
    const alles = spione.flatMap(s => s.mock.calls.flat()).map(String).join('\n');
    for (const w of ['Erika', 'Teststraße', 'Musterstadt', 'erika@']) expect(alles).not.toContain(w);
    spione.forEach(s => s.mockRestore());
  });
});

describe('Form und Pruefung einzeln', () => {
  test('Form: Laengen wie die Maske, Art nur verein/firma/person, kein Objekt -> leer', () => {
    expect(kundeNeuForm({ name: 'x'.repeat(121), art: 'Behörde' })).toEqual(kn());
    expect(kundeNeuForm('Text')).toEqual(kn());
    expect(kundeNeuForm({ plz: '1010', email: 'a@b.at' })).toMatchObject({ plz: '1010', email: 'a@b.at' });
  });
  test('Pruefung: Gross/Klein, Leerzeichen und ß/ss egal; leer -> Art leer', () => {
    expect(kundeNeuPruefen(kn({ strasse: 'Teststrasse  12' }), 'in der TESTSTRASSE 12 ').felder.strasse).toBe('Teststrasse 12');
    expect(kundeNeuPruefen(kn({ art: 'firma' }), 'irgendwas')).toEqual({ felder: kn(), leer: true });
  });
});

describe('Oberflaeche', () => {
  const block = html.slice(html.indexOf('// ── Schnellannahme: Anfang'), html.indexOf('// ── Schnellannahme: Ende'));
  test('Knopf im Kasten nur mit kundeNeu, mit Mouse-over, kein title; oeffnet die Kundenmaske vorbelegt mit Ruecksprung', () => {
    expect(block).toContain("v.kundeNeu ? '<button type=\"button\" class=\"korb-aktion korb-aktion-ruhig\" data-au-schnell-kunde-neu data-hilfe=\"au-schnell-kunde-neu\">Neuen Kunden anlegen (vorbelegt)</button>' : ''");
    expect(block).toContain('kuDialogOeffnen(null, { nachSpeichern: k => auKundeSetzen(k), vorbelegt: {');
    expect(block).not.toMatch(/\stitle=|localStorage|sessionStorage|console\./);
    expect(html).toMatch(/'au-schnell-kunde-neu':\s*\{ name:/);
    expect(html).toMatch(/'ku-vorbelegt':\s*\{ name:/);
  });
  test('Kundenmaske: vorbelegte Felder markiert, Hinweis, Markierung weg beim Bearbeiten; Abbrechen beruehrt den Auftragsentwurf nicht', () => {
    expect(html).toContain("el.classList.toggle('ku-vorbelegt', f in vor);");
    expect(html).toContain('id="ku-vorbelegt-hinweis"');
    expect(html).toContain("?.classList.remove('ku-vorbelegt')");
    const schliessen = html.slice(html.indexOf('function kuDialogSchliessen()'), html.indexOf('function kuDialogSchliessen()') + 200).split('\n')[0];
    expect(schliessen).not.toMatch(/auDlg|au-dialog/);
    expect(html).toMatch(/\.au-schnell-unsicher, \.ku-vorbelegt \{ border-color: var\(--warning\)/);
  });
});
