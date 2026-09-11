// Zustandslose Chat-Sitzungs-Token (backend/lib/chatSession.js).
// Reine Unit-Tests ohne Express - die Route-Seite prueft routes.test.js.

import { jest } from '@jest/globals';

let issueSessionToken, verifySessionToken, SESSION_TTL_MS;

beforeAll(async () => {
  process.env.CHAT_SESSION_SECRET = 'test-hmac-key';
  ({ issueSessionToken, verifySessionToken, SESSION_TTL_MS } =
    await import('../lib/chatSession.js'));
});

describe('issueSessionToken', () => {
  test('Format exp.nonce.sig', () => {
    const t = issueSessionToken();
    expect(t).toMatch(/^\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  });

  test('zwei Token derselben Millisekunde unterscheiden sich (Nonce)', () => {
    const now = Date.now();
    expect(issueSessionToken(now)).not.toBe(issueSessionToken(now));
  });

  test('TTL betraegt 30 Minuten', () => {
    const now = 1_700_000_000_000;
    const exp = Number(issueSessionToken(now).split('.')[0]);
    expect(exp - now).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe('verifySessionToken', () => {
  test('frischer Token ist gueltig', () => {
    expect(verifySessionToken(issueSessionToken())).toBe(true);
  });

  test('abgelaufener Token ist ungueltig', () => {
    const now = Date.now();
    const t   = issueSessionToken(now - SESSION_TTL_MS - 1000);
    expect(verifySessionToken(t, now)).toBe(false);
  });

  test('genau an der Ablaufgrenze ungueltig', () => {
    const now = 1_700_000_000_000;
    const t   = issueSessionToken(now);            // exp = now + TTL
    expect(verifySessionToken(t, now + SESSION_TTL_MS - 1)).toBe(true);
    expect(verifySessionToken(t, now + SESSION_TTL_MS)).toBe(false);
  });

  test('manipulierte Ablaufzeit wird erkannt', () => {
    const [, nonce, sig] = issueSessionToken().split('.');
    const weitInDerZukunft = `${Date.now() + 10 * 365 * 24 * 3600 * 1000}.${nonce}.${sig}`;
    expect(verifySessionToken(weitInDerZukunft)).toBe(false);
  });

  test('manipulierte Signatur wird erkannt', () => {
    const [exp, nonce, sig] = issueSessionToken().split('.');
    // letztes Hex-Zeichen kippen, Laenge bleibt gleich
    const kaputt = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a');
    expect(verifySessionToken(`${exp}.${nonce}.${kaputt}`)).toBe(false);
  });

  test('Token mit fremdem Schluessel wird abgelehnt', () => {
    const fremd = issueSessionToken();
    const alt   = process.env.CHAT_SESSION_SECRET;
    process.env.CHAT_SESSION_SECRET = 'anderer-schluessel';
    try {
      expect(verifySessionToken(fremd)).toBe(false);
    } finally {
      process.env.CHAT_SESSION_SECRET = alt;
    }
  });

  test('Unfug jeder Art ist ungueltig, ohne zu werfen', () => {
    for (const wert of [
      undefined, null, '', 0, {}, [], true,
      'abc', 'a.b.c', '1.2.3.4',
      `${Date.now() + 1000}.zz.${'a'.repeat(64)}`,        // Nonce kein Hex
      `${Date.now() + 1000}.${'a'.repeat(32)}.short`,      // Signatur zu kurz
      `-1.${'a'.repeat(32)}.${'b'.repeat(64)}`,            // negative Zeit
    ]) {
      expect(() => verifySessionToken(wert)).not.toThrow();
      expect(verifySessionToken(wert)).toBe(false);
    }
  });
});

describe('fehlendes CHAT_SESSION_SECRET', () => {
  test('faellt geschlossen aus: wirft mit status 503', async () => {
    const alt = process.env.CHAT_SESSION_SECRET;
    process.env.CHAT_SESSION_SECRET = '';
    try {
      expect(() => issueSessionToken()).toThrow(/CHAT_SESSION_SECRET/);
      // verify wirft ebenfalls - der Aufrufer darf keinen Token durchwinken,
      // nur weil der Schluessel fehlt.
      expect(() => verifySessionToken(`${Date.now() + 1000}.${'a'.repeat(32)}.${'b'.repeat(64)}`))
        .toThrow(/CHAT_SESSION_SECRET/);
      try { issueSessionToken(); } catch (e) { expect(e.status).toBe(503); }
    } finally {
      process.env.CHAT_SESSION_SECRET = alt;
    }
  });
});
