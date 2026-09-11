// Stoerungsalarm fuer den Kundenchat.
//
// Der Chat ist der einzige Kanal, bei dem ein Ausfall niemandem auffaellt -
// der Kunde geht weg, es bleibt keine Zeile im Sheet. Der 502 durch die
// fehlende JSON-Huelle lief so drei Wochen unbemerkt.

import { jest } from '@jest/globals';

jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret:   jest.fn(async key => process.env[key] ?? ''),
  loadAllSecrets: jest.fn(),
}));

const {
  notifyFehler, buildFehlerNachricht, alarmWuerdig, _resetAlarme, _resetWarnung,
} = await import('../lib/chatNotify.js');

const ECHTE_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';

let fetchMock;

beforeEach(() => {
  _resetAlarme();
  _resetWarnung();
  process.env.GCHAT_WEBHOOK_URL = ECHTE_URL;
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GCHAT_WEBHOOK_URL;
});

const gesendeterText = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body).text;

// ── Welche Statuscodes ueberhaupt ───────────────────────────────────────────

describe('alarmWuerdig', () => {
  test('5xx immer', () => {
    for (const s of [500, 502, 503, 504]) expect(alarmWuerdig(s)).toBe(true);
  });

  test('4xx ja, ausser 403 und 429', () => {
    for (const s of [400, 401, 404, 422]) expect(alarmWuerdig(s)).toBe(true);
    // 403 ist der Normalfall bei Bots, 429 das Rate-Limit bei der Arbeit -
    // beides ist das System, das funktioniert, keine Stoerung.
    expect(alarmWuerdig(403)).toBe(false);
    expect(alarmWuerdig(429)).toBe(false);
  });

  test('2xx und 3xx nie', () => {
    for (const s of [200, 201, 204, 302]) expect(alarmWuerdig(s)).toBe(false);
  });
});

// ── Nachrichtenbau ──────────────────────────────────────────────────────────

describe('buildFehlerNachricht', () => {
  test('enthaelt Art, Statuscode und Link', () => {
    const t = buildFehlerNachricht({ art: 'HTTP 502', status: 502, text: 'Agent kaputt' });
    expect(t).toContain('HTTP 502');
    expect(t).toContain('Agent kaputt');
    expect(t).toContain('Mission Control');
  });

  test('ohne Status bleibt die HTTP-Zeile weg', () => {
    expect(buildFehlerNachricht({ art: 'Antwort ohne JSON-Huelle', text: 'x' }))
      .not.toMatch(/HTTP/);
  });

  test('E-Mail und Telefon werden entfernt', () => {
    const t = buildFehlerNachricht({
      art: 'HTTP 500', status: 500,
      text: 'Fehler bei max@example.de, Rueckruf 0179 903 73 61 erbeten',
    });
    expect(t).not.toContain('max@example.de');
    expect(t).not.toContain('0179 903 73 61');
    expect(t).toContain('[E-Mail entfernt]');
    expect(t).toContain('[Telefon entfernt]');
  });

  test('langer Fehlertext wird gekuerzt', () => {
    const t = buildFehlerNachricht({ art: 'HTTP 500', status: 500, text: 'x'.repeat(600) });
    const zeile = t.split('\n').find(z => z.startsWith('x'));
    expect(zeile.length).toBeLessThanOrEqual(200);
    expect(zeile.endsWith('…')).toBe(true);
  });
});

// ── Drosselung ──────────────────────────────────────────────────────────────

describe('Drosselung: eine Meldung je Art und Stunde', () => {
  test('zweiter Alarm derselben Art wird geschluckt', async () => {
    expect(await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' })).toBe(true);
    expect(await notifyFehler({ art: 'HTTP 502', status: 502, text: 'b' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('20 Requests in einer Stoerung ergeben eine Meldung', async () => {
    for (let i = 0; i < 20; i++) await notifyFehler({ art: 'HTTP 502', status: 502, text: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('verschiedene Arten drosseln sich nicht gegenseitig', async () => {
    await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' });
    await notifyFehler({ art: 'HTTP 500', status: 500, text: 'b' });
    await notifyFehler({ art: 'Antwort ohne JSON-Huelle', text: 'c' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('nach einer Stunde wieder', async () => {
    const echt = Date.now;
    let jetzt = 1_700_000_000_000;
    Date.now = () => jetzt;
    try {
      await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' });
      jetzt += 59 * 60 * 1000;
      expect(await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' })).toBe(false);
      jetzt += 2 * 60 * 1000;   // jetzt > 1 h
      expect(await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' })).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { Date.now = echt; }
  });

  test('gedrosselt wird auch, wenn der Webhook nicht erreichbar ist', async () => {
    // Sonst laufen bei haengendem Webhook alle Requests in denselben Alarm.
    fetchMock.mockRejectedValue(new Error('Netz weg'));
    expect(await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' })).toBe(false);
    expect(await notifyFehler({ art: 'HTTP 502', status: 502, text: 'a' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('wirft nie', async () => {
    fetchMock.mockRejectedValue(new Error('kaputt'));
    await expect(notifyFehler({ art: 'HTTP 500', status: 500, text: 'x' })).resolves.toBe(false);
  });

  test('ohne konfigurierten Webhook still', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'unused';
    expect(await notifyFehler({ art: 'HTTP 500', status: 500, text: 'x' })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Keine Kundendaten ───────────────────────────────────────────────────────

describe('Datensparsamkeit', () => {
  test('gesendete Nachricht traegt weder Mail noch Telefonnummer', async () => {
    await notifyFehler({
      art: 'HTTP 500', status: 500,
      text: 'Kunde nicole@example.org / 0179 903 73 61 meldete Fehler',
    });
    const t = gesendeterText();
    expect(t).not.toContain('nicole@example.org');
    expect(t).not.toContain('0179 903 73 61');
  });
});
