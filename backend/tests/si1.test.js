// SI1: Abmelden in MC, Anmeldemaske statt prompt, Hoechstdauer der Chat-Sitzung (S11). Nur erfundene Werte.
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ordner = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(resolve(ordner, '../../frontend/index.html'), 'utf8');
const widget = readFileSync(resolve(ordner, '../../frontend/anfrage.html'), 'utf8');
let S;
beforeAll(async () => {
  process.env.CHAT_SESSION_SECRET = 'test-hmac-key';
  S = await import('../lib/chatSession.js');
});

describe('Chat-Sitzung (S11)', () => {
  test('Leerlauf 30 min, Hoechstdauer 2 h ab der Bot-Pruefung', () => {
    const t0 = 1_800_000_000_000;
    const tok = S.issueSessionToken(t0);
    expect(S.pruefeSessionToken(tok, t0 + S.SESSION_TTL_MS - 1)).toMatchObject({ gueltig: true, start: t0 });
    expect(S.pruefeSessionToken(tok, t0 + S.SESSION_TTL_MS + 1)).toMatchObject({ gueltig: false, grund: 'abgelaufen' });
    // Verlaengern kurz vor 2 h: endet genau bei start + 2 h
    const spaet = S.issueSessionToken(t0 + S.SESSION_MAX_MS - 60_000, t0);
    expect(Number(spaet.split('.')[0])).toBe(t0 + S.SESSION_MAX_MS);
    expect(S.pruefeSessionToken(spaet, t0 + S.SESSION_MAX_MS)).toMatchObject({ gueltig: false, grund: 'abgelaufen' });
  });
  test('falsche Signatur oder Form = ungueltig (nicht "abgelaufen")', () => {
    const tok = S.issueSessionToken();
    const kaputt = tok.slice(0, -1) + (tok.endsWith('0') ? '1' : '0');
    expect(S.pruefeSessionToken(kaputt).grund).toBe('ungueltig');
    expect(S.pruefeSessionToken('a.b').grund).toBe('ungueltig');
    expect(S.pruefeSessionToken('').grund).toBe('fehlt');
  });
  test('alter Token (vor SI1, drei Teile) gilt im Uebergang, Start = letzte Ausstellung', () => {
    const exp = Date.now() + 10 * 60 * 1000;
    const nonce = 'a'.repeat(32);
    const sig = crypto.createHmac('sha256', 'test-hmac-key').update(`${exp}.${nonce}`).digest('hex');
    const r = S.pruefeSessionToken(`${exp}.${nonce}.${sig}`);
    expect(r).toMatchObject({ gueltig: true, start: exp - S.SESSION_TTL_MS });
    expect(S.verifySessionToken(`${exp}.${nonce}.${sig}`)).toBe(true);
  });
});

describe('Chat-Widget: freundlicher Hinweis statt Fehler', () => {
  test('401 sitzung_abgelaufen -> Hinweis, neue Pruefung, Nachricht danach automatisch', () => {
    expect(widget).toContain("if (err.code === 'sitzung_abgelaufen' && text !== '__init__') {");
    expect(widget).toContain("appendBubble('agent', 'Kurze Sicherheitsprüfung – danach geht es direkt weiter.');");
    expect(widget).toContain('window.turnstile?.reset();');
    expect(widget).toMatch(/if \(_ausstehend !== null\) \{\s*const text = _ausstehend;\s*_ausstehend = null;\s*callChat\(text, true\);/);
  });
});

describe('MC: Anmelden / Abmelden', () => {
  const block = index.slice(index.indexOf('// ── Anmelden / Abmelden: Anfang'), index.indexOf('// ── Anmelden / Abmelden: Ende ──'));
  test('kein prompt() mehr, apiFetch wartet auf den Schluessel, 401 zeigt die Maske', () => {
    expect(index).not.toMatch(/prompt\('Mission Control API Key/);
    expect(index).toContain("'X-API-Key': await schluesselHolen()");
    expect(index).toMatch(/if \(res\.status === 401 && url\.startsWith\(API_BASE\(\)\)\) \{/);
    expect(index).toContain('<div id="anmelde-maske" class="edi-dialog"');
  });
  test('Abmelden: Knopf im Kopf und in den Einstellungen, Mouse-over mit Hinweis auf den Schluesseltausch', () => {
    expect(index).toContain('<button id="abmelden-kopf" class="kopf-abmelden" type="button" data-hilfe="abmelden">Abmelden</button>');
    expect(index).toContain('id="abmelden" type="button" data-hilfe="abmelden"');
    expect(index).toContain("'abmelden':              { name: 'Abmelden', text: 'Auf diesem Gerät abmelden. Bei verlorenem Gerät: Schlüssel im Secret Manager tauschen.' }");
  });
  test('Abmelden loescht Schluessel und Daten-Zwischenspeicher (nicht Theme/Shop/Filter) und laedt ueber nvLaden neu', () => {
    const liste = JSON.parse(block.match(/const MC_DATEN_SCHLUESSEL = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
    expect(liste).toEqual(['mc_api_key', 'mc_api_url', 'mc_product_draft', 'mc_lsm_liste', 'mc_last_login', 'mc_zuletzt_genutzt']);   // SI2: + Nutzung
    for (const bleibt of ['mc_theme', 'mc_shop', 'mc_korb_filter']) expect(liste).not.toContain(bleibt);
    expect(block).toContain('sessionStorage.clear()');
    expect(block).toContain("nvLaden('abgemeldet (SI1)');");
    expect(block).toContain("showConfirm('Auf diesem Gerät abmelden?'");
  });
});
