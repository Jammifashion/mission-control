// Tier-2 – Google-Chat-Benachrichtigung. Kein HTTP-Server, kein Sheets-Mock:
// notify() wird direkt gegen ein gemocktes globales fetch geprüft.

import { jest } from '@jest/globals';

// getSecret cacht 12 h lang. Fuer die Tests zaehlt nur, wie notify() auf einen
// gegebenen Wert reagiert - deshalb hier direkt aus process.env, ohne Cache.
jest.unstable_mockModule('../utils/secrets.js', () => ({
  SECRET_KEYS: [],
  getSecret:   jest.fn(async key => process.env[key] ?? ''),
  loadAllSecrets: jest.fn(),
}));

const {
  notify, redact, kuerze, buildAnfrageNachricht, buildPartnerNachricht, _resetWarnung,
} = await import('../lib/chatNotify.js');

const ECHTE_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';

let fetchMock;
let warnSpy;
let errorSpy;

beforeEach(() => {
  _resetWarnung();
  process.env.GCHAT_WEBHOOK_URL = ECHTE_URL;
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock;
  warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GCHAT_WEBHOOK_URL;
});

// ── Webhook-URL: Form, nicht Inhalt ─────────────────────────────────────────
//
// Anlass: Google antwortete mit 400 "Missing or malformed token", waehrend
// dieselbe URL per PowerShell 200 lieferte. chatNotify veraendert die URL
// nicht - der gespeicherte Wert muss sich also vom erwarteten unterscheiden.
// Die Pruefung sagt, WAS fehlt, ohne den Wert preiszugeben.

describe('Webhook-URL wird nicht veraendert', () => {
  test('geht unveraendert an fetch - keine Parameter, keine Verkettung', async () => {
    await notify('x');
    expect(fetchMock.mock.calls[0][0]).toBe(ECHTE_URL);
  });

  test('fuehrende und nachgestellte Leerzeichen werden entfernt', async () => {
    process.env.GCHAT_WEBHOOK_URL = `  ${ECHTE_URL}\n`;
    await notify('x');
    expect(fetchMock.mock.calls[0][0]).toBe(ECHTE_URL);
  });

  test('eingebettete Steuerzeichen werden ausgeraeumt', async () => {
    // new URL() entfernt CR/LF/TAB; roh an fetch gereicht wuerden sie die
    // Anfrage zerlegen.
    const mitBruch = ECHTE_URL.replace('?key=', '?key\n=');
    process.env.GCHAT_WEBHOOK_URL = mitBruch;
    await notify('x');
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/[\r\n\t]/);
  });
});

describe('Formpruefung meldet, was fehlt', () => {
  const letzterFehler = () => errorSpy.mock.calls.at(-1).join(' ');
  const hatGemeldet = () =>
    errorSpy.mock.calls.some(c => c.join(' ').includes('Webhook-URL unvollständig'));

  test('vollstaendige URL meldet nichts', async () => {
    await notify('x');
    expect(hatGemeldet()).toBe(false);
  });

  test('fehlender token-Parameter', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k';
    await notify('x');
    expect(letzterFehler()).toContain('Parameter token fehlt');
  });

  test('fehlender key-Parameter', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?token=t';
    await notify('x');
    expect(letzterFehler()).toContain('Parameter key fehlt');
  });

  test('falscher Host', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'https://example.com/v1/spaces/AAA/messages?key=k&token=t';
    await notify('x');
    expect(letzterFehler()).toContain('chat.googleapis.com');
  });

  // Der wahrscheinlichste Fall: aus einer gerenderten Seite kopiert.
  test('&amp; statt & wird benannt', async () => {
    process.env.GCHAT_WEBHOOK_URL =
      'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&amp;token=t';
    await notify('x');
    const log = letzterFehler();
    expect(log).toContain('&amp;');
    // Folgefehler: der zweite Parameter heisst dann "amp;token".
    expect(log).toContain('Parameter token fehlt');
  });

  test('kein gueltiges URL-Format wird gemeldet, ohne zu werfen', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'https://';
    await expect(notify('x')).resolves.toBe(false);
    expect(errorSpy.mock.calls.some(c => c.join(' ').includes('kein gültiges URL-Format')))
      .toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('der Wert selbst taucht nirgends im Log auf', async () => {
    const GEHEIM = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=SUPERGEHEIM';
    process.env.GCHAT_WEBHOOK_URL = GEHEIM;
    await notify('x');
    const alles = [...errorSpy.mock.calls, ...warnSpy.mock.calls].map(c => c.join(' ')).join('\n');
    expect(alles).not.toContain('SUPERGEHEIM');
    expect(alles).not.toContain(GEHEIM);
  });

  test('nur beim ersten Senden, danach still', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k';
    await notify('x');
    const nachErstem = errorSpy.mock.calls.length;
    await notify('y');
    await notify('z');
    expect(errorSpy.mock.calls.length).toBe(nachErstem);
  });

  test('eine unvollstaendige URL wird trotzdem gesendet', async () => {
    // Die Pruefung diagnostiziert, sie blockiert nicht - vielleicht kennt
    // Google ein Format, das wir hier nicht abbilden.
    process.env.GCHAT_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k';
    await notify('x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Zustellung ───────────────────────────────────────────────────────────────

describe('notify – Zustellung', () => {
  test('postet {"text": ...} als JSON an die Webhook-URL', async () => {
    const ok = await notify('Hallo');
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(ECHTE_URL);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ text: 'Hallo' });
    expect(opts.headers['Content-Type']).toMatch(/application\/json/);
  });

  test('setzt ein Abbruchsignal, damit ein haengender Endpunkt nichts blockiert', async () => {
    await notify('x');
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });
});

// ── Fehler werden geschluckt ────────────────────────────────────────────────

describe('notify – wirft nie', () => {
  test('fehlgeschlagener POST wird geschluckt, Aufrufer laeuft weiter', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    let danach = false;
    await expect(notify('x')).resolves.toBe(false);
    danach = true;                       // wird nur erreicht, wenn nichts wirft
    expect(danach).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('HTTP-Fehlerstatus wird geschluckt', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(notify('x')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Ohne den Antworttext steht im Log nur eine Zahl. Die Unterscheidung
  // 404 (Webhook weg) / 403 (Space-Rechte) / 400 (Payload) steckt im Text.
  describe('Antworttext von Google landet im Log', () => {
    const letzterFehler = () => errorSpy.mock.calls.at(-1).join(' ');

    test('Status UND Begruendung, mit Praefix', async () => {
      fetchMock.mockResolvedValue({
        ok: false, status: 404,
        text: async () => '{"error":{"code":404,"message":"Requested entity was not found."}}',
      });
      await expect(notify('x')).resolves.toBe(false);
      const log = letzterFehler();
      expect(log).toContain('[chatNotify]');
      expect(log).toContain('HTTP 404');
      expect(log).toContain('Requested entity was not found.');
    });

    test('auf 300 Zeichen gekuerzt', async () => {
      fetchMock.mockResolvedValue({
        ok: false, status: 400, text: async () => 'y'.repeat(900),
      });
      await notify('x');
      const teil = letzterFehler().split('HTTP 400: ')[1];
      expect(teil.length).toBeLessThanOrEqual(300);
      expect(teil.endsWith('…')).toBe(true);
    });

    test('Personendaten in der Antwort werden entfernt', async () => {
      fetchMock.mockResolvedValue({
        ok: false, status: 400,
        text: async () => 'Invalid argument bei max@example.de / 0179 903 73 61',
      });
      await notify('x');
      const log = letzterFehler();
      expect(log).not.toContain('max@example.de');
      expect(log).not.toContain('0179 903 73 61');
      expect(log).toContain('[E-Mail entfernt]');
      expect(log).toContain('[Telefon entfernt]');
    });

    test('unlesbarer Antworttext wirft nicht', async () => {
      fetchMock.mockResolvedValue({
        ok: false, status: 500, text: async () => { throw new Error('stream weg'); },
      });
      await expect(notify('x')).resolves.toBe(false);
      expect(letzterFehler()).toContain('nicht lesbar');
    });

    test('fehlende text()-Funktion wirft nicht', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502 });
      await expect(notify('x')).resolves.toBe(false);
      expect(letzterFehler()).toContain('HTTP 502');
    });

    test('leere Antwort wird als solche benannt', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => '' });
      await notify('x');
      expect(letzterFehler()).toContain('(leere Antwort)');
    });

    test('bei 2xx wird der Text nicht gelesen', async () => {
      const text = jest.fn();
      fetchMock.mockResolvedValue({ ok: true, status: 200, text });
      await expect(notify('x')).resolves.toBe(true);
      expect(text).not.toHaveBeenCalled();
    });
  });

  test('Timeout wird geschluckt', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
    await expect(notify('x')).resolves.toBe(false);
  });

  test('ein aufrufender Vorgang laeuft trotz Fehler zu Ende', async () => {
    fetchMock.mockRejectedValue(new Error('kaputt'));
    const schritte = [];
    async function vorgang() {
      schritte.push('zeile-geschrieben');
      await notify('x');
      schritte.push('antwort-gesendet');
    }
    await expect(vorgang()).resolves.toBeUndefined();
    expect(schritte).toEqual(['zeile-geschrieben', 'antwort-gesendet']);
  });
});

// ── Fehlendes Secret ────────────────────────────────────────────────────────

describe('notify – fehlendes Secret', () => {
  test('leeres Secret: kein Absturz, kein POST', async () => {
    process.env.GCHAT_WEBHOOK_URL = '';
    await expect(notify('x')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fehlendes Secret: kein Absturz, kein POST', async () => {
    delete process.env.GCHAT_WEBHOOK_URL;
    await expect(notify('x')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('lokaler Platzhalter "unused" zaehlt als nicht konfiguriert', async () => {
    process.env.GCHAT_WEBHOOK_URL = 'unused';
    await expect(notify('x')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('warnt genau einmal, danach still', async () => {
    process.env.GCHAT_WEBHOOK_URL = '';
    await notify('a');
    await notify('b');
    await notify('c');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Kuerzen und Schwaerzen ──────────────────────────────────────────────────

describe('Kundentext kuerzen', () => {
  test('kurzer Text bleibt unveraendert', () => {
    expect(kuerze('Abschluss-Shirts Klasse 4b', 120)).toBe('Abschluss-Shirts Klasse 4b');
  });

  test('langer Text wird auf 120 Zeichen gekuerzt', () => {
    const lang = 'A'.repeat(400);
    const out  = kuerze(lang, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('…')).toBe(true);
  });

  test('Zeilenumbrueche werden zu Leerzeichen', () => {
    expect(kuerze('Zeile 1\nZeile 2\r\nZeile 3')).toBe('Zeile 1 Zeile 2 Zeile 3');
  });
});

describe('E-Mail und Telefon werden entfernt', () => {
  test('E-Mail-Adresse im Freitext', () => {
    const out = redact('Bitte melden an max.mustermann@schule-kellinghusen.de danke');
    expect(out).not.toMatch(/@/);
    expect(out).toContain('[E-Mail entfernt]');
  });

  test('Telefonnummer im Freitext', () => {
    const out = redact('Rueckruf unter 04822 1234567 erbeten');
    expect(out).toContain('[Telefon entfernt]');
    expect(out).not.toMatch(/1234567/);
  });

  test('internationale Schreibweise', () => {
    expect(redact('Handy +49 170 1234567')).toContain('[Telefon entfernt]');
    expect(redact('Tel 0049-170-1234567')).toContain('[Telefon entfernt]');
  });

  test('Datum und Menge bleiben erhalten', () => {
    const out = redact('45 Stück, Wunschtermin 20.10., Budget 128,40 EUR');
    expect(out).toContain('45 Stück');
    expect(out).toContain('20.10.');
    expect(out).toContain('128,40');
    expect(out).not.toContain('[Telefon entfernt]');
  });

  test('geschwaerzt wird vor dem Kuerzen', () => {
    // Die Adresse steht jenseits von 120 Zeichen und darf trotzdem nicht
    // als Bruchstueck ueberleben.
    const text = 'x'.repeat(110) + ' schreib an kontakt@example.com bitte';
    const out  = buildAnfrageNachricht({
      anfrageId: 'KA-1', kundeName: 'Test', menge: 1, beschreibung: text,
    });
    expect(out).not.toMatch(/@example/);
  });
});

// ── Nachrichtenformat ───────────────────────────────────────────────────────

describe('Nachrichtenformat', () => {
  test('Kundenanfrage wie spezifiziert', () => {
    const msg = buildAnfrageNachricht({
      anfrageId:    'KA-2026-0042',
      kundeName:    'Grundschule Kellinghusen',
      menge:        45,
      beschreibung: 'Abschluss-Shirts Klasse 4b, Wunschtermin 20.10.',
    });
    const zeilen = msg.split('\n');
    expect(zeilen[0]).toBe('🟢 Neue Anfrage · KA-2026-0042');
    expect(zeilen[1]).toBe('Grundschule Kellinghusen · 45 Stück');
    expect(zeilen[2]).toBe('"Abschluss-Shirts Klasse 4b, Wunschtermin 20.10."');
    expect(zeilen[3]).toContain('Mission Control öffnen');
  });

  test('Partnerbestellung ohne Summe (Portal-Eigenauftrag)', () => {
    const msg = buildPartnerNachricht({ partnerName: 'Hamburg Crocodiles', anzahl: 3 });
    const zeilen = msg.split('\n');
    expect(zeilen[0]).toBe('📦 Partnerbestellung · Hamburg Crocodiles');
    expect(zeilen[1]).toBe('3 Artikel');
    expect(zeilen[2]).toContain('Mission Control öffnen');
  });

  test('Partnerbestellung mit Summe, falls spaeter vorhanden', () => {
    const msg = buildPartnerNachricht({ partnerName: 'Hamburg Crocodiles', anzahl: 3, summe: 128.4 });
    expect(msg.split('\n')[1]).toBe('3 Artikel · 128,40 € netto');
  });

  test('keine E-Mail aus dem Kundennamen', () => {
    const msg = buildAnfrageNachricht({
      anfrageId: 'KA-1', kundeName: 'max@example.com', menge: '', beschreibung: '',
    });
    expect(msg).not.toMatch(/@example/);
  });
});
