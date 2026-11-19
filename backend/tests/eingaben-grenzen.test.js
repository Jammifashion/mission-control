// Eingaben von aussen (Kundenchat, Partner-Eigenauftrag): feste Felder, Laengen,
// Text bleibt Text im Sheet; Anzeige in MC escaped.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  bereinigeSessionData, kanalAusListe, preisZelle, KANAL_VALUES, SESSION_LAENGEN,
} from '../utils/anfrage-felder.js';
import { eigenauftragZuLang, EIGENAUFTRAG_LAENGEN } from '../utils/eigenauftrag.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = rel => readFileSync(resolve(hier, '..', rel), 'utf8');

describe('Formularstand des Kundenchats', () => {
  test('nur bekannte Felder, nur Text, kanal fest', () => {
    const aus = bereinigeSessionData({
      kundeName: 'Max', unbekannt: 'x', kanal: 'Irgendwas', step: 3,
      menge: { a: 1 }, varianten: ['S'], preisvorschlag: '58O,5x', partnerId: 'P-01; x',
    });
    expect(aus).toEqual({ kanal: 'Homepage', kundeName: 'Max', step: 3, preisvorschlag: '58,5', partnerId: 'P-01x' });
  });

  test('Laengen werden gekappt, Umbrueche entfernt', () => {
    const aus = bereinigeSessionData({ produktBeschreibung: 'a\nb'.repeat(1000), kundeName: 'n'.repeat(500) });
    expect(aus.produktBeschreibung.length).toBe(SESSION_LAENGEN.produktBeschreibung);
    expect(aus.produktBeschreibung).not.toMatch(/[\r\n]/);
    expect(aus.kundeName.length).toBe(SESSION_LAENGEN.kundeName);
  });

  test('kein Objekt -> nur kanal; step nur ganzzahlig im Rahmen', () => {
    expect(bereinigeSessionData(null)).toEqual({ kanal: 'Homepage' });
    expect(bereinigeSessionData('x')).toEqual({ kanal: 'Homepage' });
    expect(bereinigeSessionData([1])).toEqual({ kanal: 'Homepage' });
    expect(bereinigeSessionData({ step: 999 }).step).toBeUndefined();
    expect(bereinigeSessionData({ step: 2.5 }).step).toBeUndefined();
  });

  test('kanal nur aus der Liste, Preis als Zahl wenn eindeutig', () => {
    expect(KANAL_VALUES).toEqual(['Homepage', 'E-Mail', 'Manuell']);
    expect(kanalAusListe('E-Mail', 'Homepage')).toBe('E-Mail');
    expect(kanalAusListe('=x', 'Homepage')).toBe('Homepage');
    expect(preisZelle('580')).toBe(580);
    expect(preisZelle('580,50')).toBe(580.5);
    expect(preisZelle('1.2.3')).toBe('1.2.3');
    expect(preisZelle('')).toBe('');
  });
});

describe('Kundenchat: System-Block bekommt nur den bereinigten Stand', () => {
  const mockCreate = jest.fn();
  let callChatAgent;
  beforeAll(async () => {
    jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
      default: class { constructor() { this.messages = { create: mockCreate }; } },
    }));
    jest.unstable_mockModule('../lib/googleAuth.js', () => ({ getGoogleAuth: jest.fn().mockResolvedValue({}) }));
    jest.unstable_mockModule('../lib/modelConfig.js', () => ({ getModel: jest.fn().mockResolvedValue('claude-sonnet-5-5') }));
    ({ callChatAgent } = await import('../lib/chatCore.js'));
  });
  afterEach(() => jest.restoreAllMocks());

  test('unbekannte Felder und Ueberlaenge erreichen das Modell nicht', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({
      reply: 'Hallo', completed: false,
      sessionData: { step: 1, produktBeschreibung: '', menge: '', varianten: '', partnerId: '',
        kundeName: '', kundeEmail: '', preisvorschlag: '', anmerkungenKunde: '', kanal: 'Fremd' },
    }) }] });
    const r = await callChatAgent({
      messages: [{ role: 'user', content: 'hi' }],
      sessionData: { fremdesFeld: 'ZUSATZTEXT', kundeName: 'k'.repeat(5000) },
      kbBase: 'Wissen.', history: [],
    });
    const system = JSON.stringify(mockCreate.mock.calls[0][0].system);
    expect(system).not.toContain('ZUSATZTEXT');
    expect(system).not.toContain('k'.repeat(SESSION_LAENGEN.kundeName + 1));
    expect(r.sessionData.kanal).toBe('Homepage');
    expect(r.sessionData.fremdesFeld).toBeUndefined();
  });

  test('unlesbare Antwort: Text kommt nicht ins Log', async () => {
    const logs = [];
    jest.spyOn(console, 'error').mockImplementation((...a) => logs.push(a.join(' ')));
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"kaputt": "Erika Testperson erika@example.test"' }] });
    await expect(callChatAgent({ messages: [{ role: 'user', content: 'hi' }], sessionData: {}, kbBase: 'W', history: [] }))
      .rejects.toMatchObject({ status: 502 });
    expect(logs.join('\n')).not.toContain('Erika');
  });
});

describe('Partner-Eigenauftrag: Laengen', () => {
  test('innerhalb der Grenzen ok, darueber Feldname', () => {
    expect(eigenauftragZuLang({ artikel: 'a'.repeat(EIGENAUFTRAG_LAENGEN.artikel) })).toBe('');
    expect(eigenauftragZuLang({ artikel: 'a'.repeat(EIGENAUFTRAG_LAENGEN.artikel + 1) })).toMatch(/^Artikel/);
    expect(eigenauftragZuLang({ anmerkungen: 'x'.repeat(5000) })).toMatch(/^Anmerkungen/);
    expect(eigenauftragZuLang({})).toBe('');
    expect(eigenauftragZuLang(undefined)).toBe('');
  });

  test('Route prueft Laenge und schreibt RAW', () => {
    const src = lies('routes/partnerPortal.js');
    const route = src.slice(src.indexOf("router.post('/:id/eigenauftrag'"));
    const block = route.slice(0, route.indexOf('\n});'));
    expect(block).toMatch(/eigenauftragZuLang\(req\.body\)/);
    expect(block).toMatch(/valueInputOption: 'RAW'/);
    expect(block).not.toMatch(/USER_ENTERED/);
  });
});

test('Kundenanfragen werden nur als Text geschrieben', () => {
  for (const f of ['routes/anfragen-chat.js', 'routes/anfragen.js']) {
    expect(lies(f)).not.toMatch(/USER_ENTERED/);
  }
  expect(lies('routes/anfragen-chat.js')).toMatch(/kanalAusListe\(merged\.kanal/);
});

describe('MC-Oberflaeche: Werte von aussen escaped', () => {
  const html = lies('../frontend/index.html');
  const zweiterBlock = html.slice(html.lastIndexOf('<script>'));

  test('interne Bestellungen, Verkaeufe, Partnerdaten im zweiten Block', () => {
    const roh = zweiterBlock.match(/\$\{[a-zA-Z_]+\.(bezeichnung|artikelname|orderId|datum|anzahl|notiz|name)\}/g) || [];
    // Ausnahme: Texte fuer Toasts (textContent), dort waere Escape sichtbar.
    const erlaubt = roh.filter(t => !/^\$\{p\.(datum|orderId|artikelname|bezeichnung)\}$/.test(t));
    expect(erlaubt).toEqual([]);
  });

  test('Kundennamen aus dem Shop in DTF-/L-Shop-Karten', () => {
    expect(html).not.toMatch(/\$\{o\.kunde\}/);
    expect(html).not.toMatch(/\$\{r\.bestellId\}/);
  });
});
