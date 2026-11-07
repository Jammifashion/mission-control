// PPS1: Partnerportale - Hash statt Klartext, Link bleibt derselbe. Nur erfundene Tokens.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import {
  tokenHash, hashGleich, findeZeileZumToken, zugangArt, klartextFuerMc, neuerToken, portalLink, umstellungsPlan,
  SPALTE_TOKEN, SPALTE_HASH,
} from '../utils/partner-token.js';
import { erzeugeNeuenPartnerLink } from '../lib/partnerLink.js';
import { baueTokenBremse } from '../middleware/tokenBremse.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = p => readFileSync(resolve(hier, '..', p), 'utf8');
const liesFe = n => readFileSync(resolve(hier, '../../frontend', n), 'utf8');

// Erfundene Werte (UUID v4 wie die bestehenden Links).
const ALT_A = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ALT_B = '11111111-2222-4333-8444-555555555555';
const KOPF = ['Partner-ID', 'Name', SPALTE_TOKEN, 'Aktiv', SPALTE_HASH];

describe('Hash und Vergleich', () => {
  test('tokenHash = SHA-256 hex, hashGleich mit fester Laenge', () => {
    expect(tokenHash(ALT_A)).toBe(createHash('sha256').update(ALT_A).digest('hex'));
    expect(hashGleich(tokenHash(ALT_A), tokenHash(ALT_A).toUpperCase())).toBe(true);
    expect(hashGleich(tokenHash(ALT_A), tokenHash(ALT_B))).toBe(false);
    expect(hashGleich('', tokenHash(ALT_A))).toBe(false);
    expect(hashGleich('abc', 'abc')).toBe(false);                 // kein gueltiger Hash
  });
  test('Vergleich laeuft ueber timingSafeEqual, nie mit === auf dem Token', () => {
    const q = lies('utils/partner-token.js');
    expect(q).toMatch(/timingSafeEqual\(/);
    for (const datei of ['routes/partnerPortal.js', 'routes/festpreis-public.js']) {
      const s = lies(datei);
      expect(s).toMatch(/findeZeileZumToken\(/);
      expect(s).not.toMatch(/\[tokenIdx\][^\n]*===\s*token/);
      expect(s).not.toMatch(/indexOf\('Token'\)/);
    }
  });
  test('neuer Token: 32 Byte base64url, jedes Mal anders', () => {
    const a = neuerToken(), b = neuerToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  test('Portal-Link: gleiche Form wie bisher (?token=, HONK mit &shop=honk)', () => {
    expect(portalLink('lizenz', 'abc', { shop: 'honk' })).toBe('https://jammifashion.github.io/mission-control/partner.html?token=abc&shop=honk');
    expect(portalLink('festpreis', 'abc')).toBe('https://jammifashion.github.io/mission-control/partner-festpreis.html?token=abc');
  });
});

describe('Pruefung im Uebergang und danach', () => {
  const vorher = [['P-001', 'A', ALT_A, 'Ja', ''], ['P-002', 'B', ALT_B, 'Ja', '']];
  test('vor der Umstellung: alter UUID-Link gilt ueber den Klartext', () => {
    expect(findeZeileZumToken(KOPF, vorher, ALT_A)).toMatchObject({ zeile: vorher[0], art: 'klartext' });
    expect(findeZeileZumToken(KOPF.slice(0, 4), vorher.map(r => r.slice(0, 4)), ALT_B)?.zeile[0]).toBe('P-002');  // ohne Spalte Token_Hash
  });
  test('nach Hash + geleertem Klartext: derselbe alte Link gilt weiter, nur ueber den Hash', () => {
    const nachher = [['P-001', 'A', '', 'Ja', tokenHash(ALT_A)], ['P-002', 'B', '', 'Ja', tokenHash(ALT_B)]];
    expect(findeZeileZumToken(KOPF, nachher, ALT_A)).toMatchObject({ zeile: nachher[0], art: 'hash' });
    expect(findeZeileZumToken(KOPF, nachher, ALT_B)?.zeile[0]).toBe('P-002');
    expect(findeZeileZumToken(KOPF, nachher, 'falsch')).toBeNull();
    expect(findeZeileZumToken(KOPF, nachher, tokenHash(ALT_A))).toBeNull();     // der Hash selbst ist kein Zugang
    expect(findeZeileZumToken(KOPF, nachher, '')).toBeNull();
  });
  test('Zeile mit Hash: ein alter Klartext daneben zaehlt nicht mehr', () => {
    const neu = neuerToken();
    const z = [['P-001', 'A', ALT_A, 'Ja', tokenHash(neu)]];
    expect(findeZeileZumToken(KOPF, z, ALT_A)).toBeNull();
    expect(findeZeileZumToken(KOPF, z, neu)?.art).toBe('hash');
  });
  test('zugangArt / klartextFuerMc: Hash geht nie an MC, Klartext nur ohne Hash', () => {
    expect(zugangArt(KOPF, ['P-1', 'A', ALT_A, 'Ja', ''])).toBe('klartext');
    expect(klartextFuerMc(KOPF, ['P-1', 'A', ALT_A, 'Ja', ''])).toBe(ALT_A);
    expect(zugangArt(KOPF, ['P-1', 'A', ALT_A, 'Ja', tokenHash(ALT_A)])).toBe('hash');
    expect(klartextFuerMc(KOPF, ['P-1', 'A', ALT_A, 'Ja', tokenHash(ALT_A)])).toBe('');
    expect(zugangArt(KOPF, ['P-1', 'A', '', 'Ja', ''])).toBe('');
  });
});

describe('Umstellungsplan', () => {
  test('Schritt 1: Hash neu / schon / Konflikt, ohne Token gezaehlt', () => {
    const z = [['P-1', 'A', ALT_A, 'Ja', ''], ['P-2', 'B', ALT_B, 'Ja', tokenHash(ALT_B)], ['P-3', 'C', ALT_A, 'Ja', tokenHash(ALT_B)], ['P-4', 'D', '', 'Ja', '']];
    const p = umstellungsPlan(KOPF, z);
    expect(p.neu).toEqual([{ index: 0, hash: tokenHash(ALT_A) }]);
    expect(p.schon).toEqual([{ index: 1 }]);
    expect(p.konflikt).toEqual([{ index: 2 }]);
    expect(p.ohneToken).toBe(1);
    expect(p.leeren).toEqual([]);
  });
  test('Schritt 2 leert nur, wo der passende Hash SCHON steht', () => {
    const z = [['P-1', 'A', ALT_A, 'Ja', ''], ['P-2', 'B', ALT_B, 'Ja', tokenHash(ALT_B)], ['P-3', 'C', ALT_A, 'Ja', tokenHash(ALT_B)]];
    expect(umstellungsPlan(KOPF, z, { leeren: true }).leeren).toEqual([{ index: 1 }]);
  });
});

// Attrappe des Sheets-Clients: haelt die Zellen, wie Sheets sie zurueckgibt.
function sheetAttrappe(tab, kopf, zeilen) {
  const werte = [kopf, ...zeilen].map(r => [...r]);
  const spalte = b => b.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const zelle = range => { const m = /!([A-Z]+)(\d+)$/.exec(range); return { c: spalte(m[1]), r: Number(m[2]) - 1 }; };
  const aufrufe = [];
  return {
    werte, aufrufe,
    spreadsheets: { values: {
      get: async () => ({ data: { values: werte.map(r => [...r]) } }),
      batchUpdate: async ({ requestBody }) => {
        aufrufe.push(requestBody);
        for (const d of requestBody.data) { const { r, c } = zelle(d.range); werte[r][c] = d.values[0][0]; }
        return { data: {} };
      },
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(x => { const { r, c } = zelle(x); return { values: [[werte[r]?.[c] ?? '']] }; }) } }),
    } },
  };
}

describe('Link neu erzeugen', () => {
  const env = process.env.BUSINESS_SHEET_ID;
  beforeAll(() => { process.env.BUSINESS_SHEET_ID = 'erfunden'; });
  afterAll(() => { process.env.BUSINESS_SHEET_ID = env; });

  test('neuer Link gilt, der alte nicht mehr; Klartext geleert, nur der Hash steht im Sheet', async () => {
    const s = sheetAttrappe('Partner', [...KOPF, 'Shop'], [['P-001', 'A', ALT_A, 'Ja', '', 'honk'], ['P-002', 'B', ALT_B, 'Ja', '', '']]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { link, partnerId } = await erzeugeNeuenPartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s });
    const ausgabe = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(partnerId).toBe('P-001');
    const neu = decodeURIComponent(/token=([^&]+)/.exec(link)[1]);
    expect(link).toMatch(/partner\.html\?token=.+&shop=honk$/);
    const [kopf, ...zeilen] = s.werte;
    expect(zeilen[0][2]).toBe('');
    expect(zeilen[0][4]).toBe(tokenHash(neu));
    expect(JSON.stringify(s.werte)).not.toContain(neu);              // Klartext nie im Sheet
    expect(findeZeileZumToken(kopf, zeilen, neu)?.zeile[0]).toBe('P-001');
    expect(findeZeileZumToken(kopf, zeilen, ALT_A)).toBeNull();        // alter Link sofort ungueltig
    expect(findeZeileZumToken(kopf, zeilen, ALT_B)?.zeile[0]).toBe('P-002');   // andere Partner unberuehrt
    expect(s.aufrufe[0].valueInputOption).toBe('RAW');
    expect(s.aufrufe[0].data).toHaveLength(2);
    expect(ausgabe).not.toContain(neu);
    expect(ausgabe).not.toContain(tokenHash(neu));
  });
  test('ohne Spalte Token_Hash: 409 einrichtung, nichts geschrieben', async () => {
    const s = sheetAttrappe('FP_Partner', ['Partner-ID', 'Token', 'Aktiv'], [['FP-001', ALT_A, 'ja']]);
    await expect(erzeugeNeuenPartnerLink({ art: 'festpreis', partnerId: 'FP-001', sheets: s })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
    expect(s.aufrufe).toHaveLength(0);
  });
  test('unbekannt 404, doppelt 409', async () => {
    const s = sheetAttrappe('Partner', KOPF, [['P-001', 'A', '', 'Ja', ''], ['P-001', 'A2', '', 'Ja', '']]);
    await expect(erzeugeNeuenPartnerLink({ art: 'lizenz', partnerId: 'P-009', sheets: s })).rejects.toMatchObject({ status: 404 });
    await expect(erzeugeNeuenPartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s })).rejects.toMatchObject({ status: 409, code: 'mehrdeutig' });
    expect(s.aufrufe).toHaveLength(0);
  });
  test('Admin-Routen: Token kommt nie mehr aus dem Browser', () => {
    for (const datei of ['routes/kalkulation.js', 'routes/festpreis-portal.js']) {
      const s = lies(datei);
      expect(s).toMatch(/link-neu/);
      expect(s).toMatch(/token_vom_browser/);
      expect(s).not.toMatch(/'Token':\s*token/);
    }
    const mc = liesFe('index.html');
    expect(mc).not.toMatch(/const token = crypto\.randomUUID\(\)/);
    expect(mc).toMatch(/\/link-neu`/);
  });
});

describe('Fehlversuchs-Bremse je IP', () => {
  const app = () => {
    const a = express();
    a.use('/p', baueTokenBremse({ max: 3, fensterMs: 60_000 }), (req, res) => {
      res.status(req.headers.authorization === 'Bearer gut' ? 200 : 401).json({});
    });
    return a;
  };
  test('gueltige Links zaehlen nie, nach 3 Fehlversuchen 429', async () => {
    const a = app();
    for (let i = 0; i < 10; i++) expect((await request(a).get('/p').set('Authorization', 'Bearer gut')).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await request(a).get('/p').set('Authorization', 'Bearer falsch')).status).toBe(401);
    const r = await request(a).get('/p').set('Authorization', 'Bearer falsch');
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('token_bremse');
  });
  test('vor beiden Portal-Routern eingehaengt', () => {
    const s = lies('index.js');
    expect(s).toMatch(/app\.use\('\/api\/partner',\s*tokenBremse, partnerPortalRouter\)/);
    expect(s).toMatch(/app\.use\('\/api\/festpreis-public',\s*tokenBremse, festpreisPublicRouter\)/);
  });
});

describe('Token nie im Log', () => {
  test('keine console-Ausgabe mit token/hash in den Zugangsstellen', () => {
    for (const datei of ['utils/partner-token.js', 'lib/partnerLink.js', 'middleware/tokenBremse.js', 'routes/partnerPortal.js',
      'routes/festpreis-public.js', 'scripts/setup-partner-token-hash.js']) {
      const zeilen = lies(datei).split('\n').filter(z => /console\.(log|error|warn|info)\(/.test(z));
      for (const z of zeilen) expect(z).not.toMatch(/\$\{\s*(token|hash|neu|t|k|z\.token|link|d\.link)\s*\}/);
    }
  });
});

describe('Portalseiten: Token aus der Adresse', () => {
  const block = h => h.slice(h.indexOf('// ── Portal-Token: Anfang'), h.indexOf('// ── Portal-Token: Ende ──'));
  const lizenz = liesFe('partner.html'), festpreis = liesFe('partner-festpreis.html');
  const lauf = (adresse, speicherStart = {}, kaputt = false) => {
    const u = new URL(adresse);
    const location = { search: u.search, pathname: u.pathname, hash: u.hash };
    const ersetzt = [];
    const d = { ...speicherStart };
    const sessionStorage = kaputt
      ? { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } }
      : { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } };
    const history = { state: null, replaceState: (_s, _t, url) => ersetzt.push(url) };
    const window = {};
    new Function('window', 'location', 'history', 'sessionStorage', 'URLSearchParams', block(lizenz))(window, location, history, sessionStorage, URLSearchParams);
    return { token: window.PORTAL_TOKEN, ersetzt, d };
  };
  test('wortgleich in beiden Portalen, vor allen anderen Skripten, mit no-referrer', () => {
    expect(block(lizenz).length).toBeGreaterThan(400);
    expect(block(festpreis)).toBe(block(lizenz));
    for (const h of [lizenz, festpreis]) {
      expect(h).toMatch(/<meta name="referrer" content="no-referrer">/);
      expect(h.indexOf('Portal-Token: Anfang')).toBeLessThan(h.indexOf('Theme: Anfang'));
      expect(h).toMatch(/const TOKEN\s+= window\.PORTAL_TOKEN \|\| ''/);
      expect(h).not.toMatch(/params\.get\('token'\)/);
    }
  });
  test('Token gelesen, Adresse ohne Token, andere Parameter bleiben', () => {
    const r = lauf(`https://x.test/mission-control/partner.html?token=${ALT_A}&shop=honk#k`);
    expect(r.token).toBe(ALT_A);
    expect(r.ersetzt).toEqual(['/mission-control/partner.html?shop=honk#k']);
    expect(r.d['portal_token:/mission-control/partner.html']).toBe(ALT_A);
  });
  test('neu laden ohne Token in der Adresse: aus sessionStorage', () => {
    const r = lauf('https://x.test/mission-control/partner.html', { 'portal_token:/mission-control/partner.html': ALT_B });
    expect(r.token).toBe(ALT_B);
    expect(r.ersetzt).toEqual([]);
  });
  test('Speicher gesperrt: Token gilt fuer diesen Aufruf, Adresse trotzdem bereinigt', () => {
    const r = lauf(`https://x.test/mission-control/partner-festpreis.html?token=${ALT_A}`, {}, true);
    expect(r.token).toBe(ALT_A);
    expect(r.ersetzt).toEqual(['/mission-control/partner-festpreis.html']);
  });
});
