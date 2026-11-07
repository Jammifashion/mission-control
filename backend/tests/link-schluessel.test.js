// LK1: Links wieder kopierbar - Token AES-256-GCM verschluesselt neben dem Hash. Nur erfundene Werte (Schluessel per Zufall
// im Test erzeugt, Tokens erfunden).
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, createHash } from 'crypto';
import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import {
  verschluessele, entschluessele, schluesselAus, tokenFuerMc, versionVon, LinkSchluesselFehler, LINK_HINWEIS, SPALTE_VERSCHLUESSELT,
} from '../utils/link-schluessel.js';
import { ladeLinkSchluessel } from '../lib/linkSchluessel.js';
import { erzeugeNeuenPartnerLink, zeigePartnerLink, partnerKopierbar } from '../lib/partnerLink.js';
import { findeZeileZumToken, tokenHash as partnerHash, SPALTE_TOKEN, SPALTE_HASH } from '../utils/partner-token.js';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, neuerLink, leseZugaenge, leseSeite, zeigeLink, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, BILD_SPALTEN, zugangKontext, findeZugang } from '../utils/bestellseite.js';
import { requireApiKey } from '../middleware/auth.js';
import bestellseitenRouter from '../routes/bestellseiten.js';
import { _secretCacheLeeren } from '../utils/secrets.js';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = p => readFileSync(resolve(hier, '..', p), 'utf8');
const liesFe = n => readFileSync(resolve(hier, '../../frontend', n), 'utf8');

const S1 = randomBytes(32);
const S2 = randomBytes(32);
const TOKEN = 'erfundenerTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA';   // 43 Zeichen, erfunden
const nurSchluessel = s => async () => s;

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('verschluesseln / entschluesseln', () => {
  test('rundum, Form v1.iv.tag.geheim, jedes Mal anderer IV', () => {
    const a = verschluessele(TOKEN, S1, 'bestellseite:BS-001');
    const b = verschluessele(TOKEN, S1, 'bestellseite:BS-001');
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(TOKEN);
    expect(versionVon(a)).toBe('v1');
    expect(entschluessele(a, S1, 'bestellseite:BS-001')).toBe(TOKEN);
    expect(entschluessele(b, S1, 'bestellseite:BS-001')).toBe(TOKEN);
  });
  test('falscher Schluessel, falscher Kontext, verfaelscht -> Fehler ohne Klartext', () => {
    const w = verschluessele(TOKEN, S1, 'lizenz:P-001');
    const teile = w.split('.');
    const kippe = x => (x[0] === 'A' ? 'B' : 'A') + x.slice(1);
    const faelle = [
      () => entschluessele(w, S2, 'lizenz:P-001'),
      () => entschluessele(w, S1, 'lizenz:P-002'),                                   // in andere Zeile kopiert
      () => entschluessele([teile[0], teile[1], teile[2], kippe(teile[3])].join('.'), S1, 'lizenz:P-001'),
      () => entschluessele([teile[0], teile[1], kippe(teile[2]), teile[3]].join('.'), S1, 'lizenz:P-001'),
      () => entschluessele(['v9', ...teile.slice(1)].join('.'), S1, 'lizenz:P-001'),
      () => entschluessele('kaputt', S1, 'lizenz:P-001'),
      () => entschluessele(w, Buffer.alloc(16), 'lizenz:P-001'),
    ];
    for (const f of faelle) {
      let err;
      try { f(); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(LinkSchluesselFehler);
      expect(err.message).not.toContain(TOKEN);
      expect(err.message).not.toContain(teile[3]);
    }
  });
  test('Schluessel aus dem Secret: 64 Hex oder base64 von 32 Byte, sonst null', () => {
    expect(schluesselAus(S1.toString('hex'))?.equals(S1)).toBe(true);
    expect(schluesselAus(S1.toString('base64'))?.equals(S1)).toBe(true);
    expect(schluesselAus(` ${S1.toString('base64url')}\n`)?.equals(S1)).toBe(true);
    for (const x of ['', 'kurz', randomBytes(16).toString('hex'), randomBytes(31).toString('base64'), undefined]) expect(schluesselAus(x)).toBeNull();
  });
  test('tokenFuerMc: ok nur, wenn der entschluesselte Token zum Hash passt', () => {
    const h = createHash('sha256').update(TOKEN).digest('hex');
    const w = verschluessele(TOKEN, S1, 'k');
    expect(tokenFuerMc({ wert: w, hash: h, schluessel: S1, kontext: 'k' })).toEqual({ status: 'ok', token: TOKEN });
    expect(tokenFuerMc({ wert: '', hash: h, schluessel: S1, kontext: 'k' })).toEqual({ status: 'alt' });
    expect(tokenFuerMc({ wert: w, hash: h, schluessel: null, kontext: 'k' })).toEqual({ status: 'kein_schluessel' });
    expect(tokenFuerMc({ wert: w, hash: h, schluessel: S2, kontext: 'k' })).toEqual({ status: 'fehler' });
    expect(tokenFuerMc({ wert: w, hash: 'f'.repeat(64), schluessel: S1, kontext: 'k' })).toEqual({ status: 'fehler' });   // veraltet
    expect(tokenFuerMc({ wert: w, hash: '', schluessel: S1, kontext: 'k' })).toEqual({ status: 'ohne_link' });
  });
});

describe('Secret fehlt', () => {
  test('ladeLinkSchluessel: Lesefehler/leer/ungueltig -> null, Meldung ohne Wert', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await ladeLinkSchluessel({ lies: async () => { throw new Error('NOT_FOUND'); } })).toBeNull();
    expect(await ladeLinkSchluessel({ lies: async () => '' })).toBeNull();
    expect(await ladeLinkSchluessel({ lies: async () => 'zu-kurz-und-geheim' })).toBeNull();
    expect((await ladeLinkSchluessel({ lies: async () => S1.toString('hex') })).equals(S1)).toBe(true);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/zu-kurz-und-geheim/);
  });
  test('LINK_SCHLUESSEL ist NICHT in SECRET_KEYS (Backend startet ohne ihn)', () => {
    expect(lies('utils/secrets.js')).not.toMatch(/'LINK_SCHLUESSEL'/);
  });
});

// ── Partner ──────────────────────────────────────────────────────────────────
function sheetAttrappe(tab, kopf, zeilen) {
  const werte = [kopf, ...zeilen.map(r => [...r])];
  const aufrufe = [];
  const zelle = range => {
    const m = /!([A-Z]+)(\d+)$/.exec(range);
    const c = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { r: Number(m[2]) - 1, c };
  };
  return {
    werte, aufrufe,
    spreadsheets: { values: {
      get: async () => ({ data: { values: werte.map(r => [...r]) } }),
      batchUpdate: async ({ requestBody }) => {
        aufrufe.push(requestBody);
        for (const d of requestBody.data) { const { r, c } = zelle(d.range); while (werte[r].length <= c) werte[r].push(''); werte[r][c] = d.values[0][0]; }
        return { data: {} };
      },
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map(x => { const { r, c } = zelle(x); return { values: [[werte[r]?.[c] ?? '']] }; }) } }),
    } },
  };
}
const KOPF = ['Partner-ID', 'Name', SPALTE_TOKEN, 'Aktiv', SPALTE_HASH, 'Shop', SPALTE_VERSCHLUESSELT];

describe('Partner: Link neu erzeugen und kopieren', () => {
  const env = process.env.BUSINESS_SHEET_ID;
  beforeAll(() => { process.env.BUSINESS_SHEET_ID = 'erfunden'; });
  afterAll(() => { process.env.BUSINESS_SHEET_ID = env; });

  test('Hash UND verschluesselter Wert, nie Klartext im Sheet; danach jederzeit kopierbar, nichts im Log', async () => {
    const s = sheetAttrappe('Partner', KOPF, [['P-001', 'A', '', 'Ja', 'a'.repeat(64), 'honk', '']]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await erzeugeNeuenPartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s, schluesselLaden: nurSchluessel(S1) });
    const neu = decodeURIComponent(/token=([^&]+)/.exec(r.link)[1]);
    expect(r.kopierbar).toBe(true);
    const zeile = s.werte[1];
    expect(zeile[4]).toBe(partnerHash(neu));
    expect(zeile[6]).toMatch(/^v1\./);
    expect(JSON.stringify(s.werte)).not.toContain(neu);
    expect(findeZeileZumToken(s.werte[0], [zeile], neu)?.zeile[0]).toBe('P-001');   // Pruefung weiter ueber den Hash
    expect(partnerKopierbar(s.werte[0], zeile)).toBe(true);
    const k = await zeigePartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s, schluesselLaden: nurSchluessel(S1) });
    expect(k.link).toBe(r.link);
    expect(JSON.stringify(log.mock.calls)).not.toContain(neu);
    expect(JSON.stringify(log.mock.calls)).not.toContain(zeile[6]);
  });
  test('Festpreis: Kontext gehoert zur Art - Wert aus P-001 in FP-001 kopiert taugt nicht', async () => {
    const s = sheetAttrappe('FP_Partner', KOPF, [['FP-001', 'A', '', 'ja', '', '', '']]);
    await erzeugeNeuenPartnerLink({ art: 'festpreis', partnerId: 'FP-001', sheets: s, schluesselLaden: nurSchluessel(S1) });
    const fremd = verschluessele('fremderTokenXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', S1, 'lizenz:FP-001');
    s.werte[1][6] = fremd;
    await expect(zeigePartnerLink({ art: 'festpreis', partnerId: 'FP-001', sheets: s, schluesselLaden: nurSchluessel(S1) })).rejects.toMatchObject({ status: 409, code: 'link_fehler' });
  });
  test('Altbestand (nur Hash): 409 link_alt mit Hinweis; Uebergang Klartext bleibt kopierbar', async () => {
    const s = sheetAttrappe('Partner', KOPF, [['P-001', 'A', '', 'Ja', 'b'.repeat(64), '', ''], ['P-002', 'B', 'alter-klartext-erfunden', 'Ja', '', '', '']]);
    const err = await zeigePartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s, schluesselLaden: nurSchluessel(S1) }).catch(e => e);
    expect(err).toMatchObject({ status: 409, code: 'link_alt' });
    expect(err.message).toBe(LINK_HINWEIS.alt);
    expect(err.message).toMatch(/vor LK1 erstellt – zum Kopieren einmal neu erzeugen \(alter wird ungültig\)/);
    expect(partnerKopierbar(s.werte[0], s.werte[1])).toBe(false);
    expect((await zeigePartnerLink({ art: 'lizenz', partnerId: 'P-002', sheets: s })).link).toMatch(/token=alter-klartext-erfunden$/);
  });
  test('Schluessel fehlt: neuer Link geht trotzdem (nur Hash), alter verschluesselter Wert wird GELEERT; Kopieren 409', async () => {
    const alt = verschluessele('alterTokenYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY', S1, 'lizenz:P-001');
    const s = sheetAttrappe('Partner', KOPF, [['P-001', 'A', '', 'Ja', 'c'.repeat(64), '', alt]]);
    const r = await erzeugeNeuenPartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s, schluesselLaden: nurSchluessel(null) });
    expect(r.kopierbar).toBe(false);
    expect(s.werte[1][6]).toBe('');
    const neu = decodeURIComponent(/token=([^&]+)/.exec(r.link)[1]);
    expect(findeZeileZumToken(s.werte[0], [s.werte[1]], neu)).not.toBeNull();   // Pruefung laeuft
    // Mit Wert, aber ohne Schluessel -> kein_schluessel
    s.werte[1][6] = verschluessele(neu, S1, 'lizenz:P-001');
    await expect(zeigePartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s, schluesselLaden: nurSchluessel(null) })).rejects.toMatchObject({ status: 409, code: 'link_kein_schluessel' });
  });
  test('ohne Spalte Token_Verschluesselt: wie PPS1 (nur Hash), Schluessel wird gar nicht geladen', async () => {
    const s = sheetAttrappe('Partner', KOPF.slice(0, 6), [['P-001', 'A', '', 'Ja', '', '']]);
    const laden = jest.fn(async () => S1);
    const r = await erzeugeNeuenPartnerLink({ art: 'lizenz', partnerId: 'P-001', sheets: s, schluesselLaden: laden });
    expect(r.kopierbar).toBe(false);
    expect(laden).not.toHaveBeenCalled();
    expect(s.aufrufe[0].data).toHaveLength(2);
  });
});

// ── Bestellseiten ────────────────────────────────────────────────────────────
process.env.GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || 'test-sheet';
const JETZT = () => new Date('2026-11-07T10:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00063', Status: 'aktiv' }] });
let zz = 0;
const zufall = () => Buffer.alloc(32, ++zz);
const tabs = (kopf = [...ZUGANG_SPALTEN, ...ZUGANG_OPTIONAL]) => ({
  Bestellseiten: [kopf], Bestell_Termine: [TERMIN_SPALTEN], Bestell_Bilder: [BILD_SPALTEN],
  Struktur_Kategorien: [['Kategorienummer', 'Kategorien', 'Kategoriename'], ['549', 'Club', 'Club']],
  Erfassungsmaske: [['ID', 'Status Shop', 'Produkt-ID', 'Produktname', 'Kategorien']],
  Varianten: [['SSOT-ID', 'E1', 'V1', 'Aktiv', 'WC_Variation_ID']],
  LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']],
});
const anlegen = (sheets, schluesselLaden, v = 'vorgang-lk1-001') => legeZugangAn({
  eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', vorgang: v }, sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden,
});

describe('Bestellseiten: anlegen, neuer Link, Link kopieren', () => {
  beforeEach(() => _bestellseiteCacheLeeren());

  test('anlegen: Hash + verschluesselt, Sheet ohne Klartext, Liste ohne Wert, Link kopieren liefert denselben Token', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const r = await anlegen(sheets, nurSchluessel(S1));
    expect(r.kopierbar).toBe(true);
    expect(JSON.stringify(t)).not.toContain(r.token);
    const i = t.Bestellseiten[0].indexOf(SPALTE_VERSCHLUESSELT);
    const wert = t.Bestellseiten[1][i];
    expect(entschluessele(wert, S1, zugangKontext('BS-001'))).toBe(r.token);
    const liste = await leseZugaenge({ sheets, jetzt: JETZT, schluesselLaden: nurSchluessel(S1) });
    expect(liste.linkSchluessel).toBe(true);
    expect(liste.zugaenge[0]).toMatchObject({ kopierbar: true, hatLink: true });
    expect(JSON.stringify(liste)).not.toContain(wert);
    expect(liste.zugaenge[0]).not.toHaveProperty(SPALTE_VERSCHLUESSELT);
    expect((await zeigeLink({ zugangId: 'BS-001', sheets, schluesselLaden: nurSchluessel(S1) })).token).toBe(r.token);
    expect((await leseSeite({ token: r.token, sheets, jetzt: JETZT })).art).toBe('dauer');
    const ausgabe = JSON.stringify(log.mock.calls);
    expect(ausgabe).not.toContain(r.token);
    expect(ausgabe).not.toContain(wert);
  });
  test('neuer Link ersetzt den verschluesselten Wert; der alte Token kommt nie mehr heraus', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const r = await anlegen(sheets, nurSchluessel(S1));
    const stand = (await leseZugaenge({ sheets, jetzt: JETZT, schluesselLaden: nurSchluessel(S1) })).zugaenge[0].Stand;
    const n = await neuerLink({ eingabe: { zugangId: 'BS-001', stand }, sheets, jetzt: () => new Date('2026-11-07T11:00:00Z'), zufall, schluesselLaden: nurSchluessel(S1) });
    expect(n.kopierbar).toBe(true);
    expect((await zeigeLink({ zugangId: 'BS-001', sheets, schluesselLaden: nurSchluessel(S1) })).token).toBe(n.token);
    expect(n.token).not.toBe(r.token);
    expect(JSON.stringify(t)).not.toContain(n.token);
  });
  test('Altbestand (nur Hash): Liste kopierbar false, Link kopieren 409 link_alt mit Hinweis', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    await anlegen(sheets, nurSchluessel(null));   // wie vor LK1: kein Wert
    const z = (await leseZugaenge({ sheets, jetzt: JETZT, schluesselLaden: nurSchluessel(S1) })).zugaenge[0];
    expect(z).toMatchObject({ hatLink: true, kopierbar: false });
    const err = await zeigeLink({ zugangId: 'BS-001', sheets, schluesselLaden: nurSchluessel(S1) }).catch(e => e);
    expect(err).toMatchObject({ status: 409, code: 'link_alt', message: LINK_HINWEIS.alt });
  });
  test('Secret fehlt: Anlegen geht, Pruefung des Links laeuft, Kopieren aus (Liste linkSchluessel false, 409)', async () => {
    const t = tabs();
    const { sheets } = machSheets(t);
    const r = await anlegen(sheets, nurSchluessel(null));
    expect(r.kopierbar).toBe(false);
    expect((await leseSeite({ token: r.token, sheets, jetzt: JETZT })).art).toBe('dauer');
    expect((await leseZugaenge({ sheets, jetzt: JETZT, schluesselLaden: nurSchluessel(null) })).linkSchluessel).toBe(false);
    // Wert vorhanden, Schluessel fehlt
    const i = t.Bestellseiten[0].indexOf(SPALTE_VERSCHLUESSELT);
    t.Bestellseiten[1][i] = verschluessele(r.token, S1, zugangKontext('BS-001'));
    await expect(zeigeLink({ zugangId: 'BS-001', sheets, schluesselLaden: nurSchluessel(null) })).rejects.toMatchObject({ status: 409, code: 'link_kein_schluessel' });
    expect(findeZugang([{ Token_Hash: t.Bestellseiten[1][t.Bestellseiten[0].indexOf('Token_Hash')] }], r.token)).not.toBeNull();
  });
  test('ohne Spalte (vor dem Setup): Anlegen wie KS1, Schluessel nicht geladen', async () => {
    const t = tabs([...ZUGANG_SPALTEN, 'Design_Link_Zeigen', 'Vorgang']);
    const { sheets } = machSheets(t);
    const laden = jest.fn(async () => S1);
    const r = await anlegen(sheets, laden);
    expect(r.kopierbar).toBe(false);
    expect(laden).not.toHaveBeenCalled();
    expect(t.Bestellseiten[0]).not.toContain(SPALTE_VERSCHLUESSELT);
  });
});

describe('Routen: nur mit API-Key, no-store', () => {
  const alt = process.env.MC_API_KEY;
  beforeAll(() => { process.env.MC_API_KEY = 'erfundener-test-schluessel'; _secretCacheLeeren(); });
  afterAll(() => { process.env.MC_API_KEY = alt; _secretCacheLeeren(); });

  test('GET /api/bestellseiten/:id/link ohne Schluessel 401', async () => {
    const app = express();
    app.use(requireApiKey);
    app.use('/api/bestellseiten', bestellseitenRouter);
    const res = await request(app).get('/api/bestellseiten/BS-001/link');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
  test('Link-Routen stehen hinter requireApiKey und setzen no-store', () => {
    const idx = lies('index.js');
    const auth = idx.indexOf('app.use(requireApiKey)');
    for (const pfad of ["'/api/bestellseiten'", "'/api/kalkulation'", "'/api/festpreis',"]) {
      const i = idx.indexOf(`app.use(${pfad}`);
      expect(i).toBeGreaterThan(auth);
    }
    expect(lies('routes/bestellseiten.js')).toMatch(/'\/:zugangId\/link', \(req, res, next\) => \{ res\.set\('Cache-Control', 'no-store'\)/);
    for (const d of ['routes/kalkulation.js', 'routes/festpreis-portal.js']) {
      const s = lies(d);
      expect(s).toMatch(/router\.get\('\/partner\/:\w+\/link'/);
      expect(s).toMatch(/Cache-Control', 'no-store'/);
    }
  });
  test('verschluesselter Wert geht nie an Browser oder Portal', () => {
    expect(lies('routes/festpreis-portal.js')).toMatch(/delete o\[SPALTE_VERSCHLUESSELT\]/);
    expect(lies('routes/festpreis-public.js')).toMatch(/delete partner\[SPALTE_VERSCHLUESSELT\]/);
    expect(lies('utils/bestellseite.js')).toMatch(/Token_Verschluesselt: _tv/);
  });
});

describe('nichts im Log, Oberflaeche', () => {
  test('keine console-Ausgabe mit token/wert/schluessel in den LK1-Stellen', () => {
    for (const datei of ['utils/link-schluessel.js', 'lib/linkSchluessel.js', 'lib/partnerLink.js', 'lib/bestellseite.js']) {
      const zeilen = lies(datei).split('\n').filter(z => /console\.(log|error|warn|info)\(/.test(z));
      for (const z of zeilen) expect(z).not.toMatch(/\$\{[^}]*(token|wert|schluessel|text)\b[^}]*\}/i);
    }
  });
  test('MC: Link kopieren holt den Link vom Backend, Hinweis Altbestand, Mouse-over ohne title', () => {
    const mc = liesFe('index.html');
    expect(mc).toMatch(/bsmApi\(`\/\$\{encodeURIComponent\(z\.Zugang_ID\)\}\/link`\)/);
    expect(mc).toMatch(/\/api\/kalkulation\/partner\/\$\{encodeURIComponent\(partnerId\)\}\/link`/);
    expect(mc).toMatch(/\/api\/festpreis\/partner\/\$\{encodeURIComponent\(partnerId\)\}\/link`/);
    expect(mc).toMatch(/Dieser Link wurde vor LK1 erstellt – zum Kopieren einmal neu erzeugen \(alter wird ungültig\)\./);
    for (const k of ['bsm-link-holen', 'bsm-link-alt', 'link-vor-lk1']) {
      expect(mc).toMatch(new RegExp(`'${k}':\\s*\\{ name:`));
      expect(mc).toMatch(new RegExp(`data-hilfe="${k}"`));
    }
    // kein Link aus der Partnerliste mehr gebaut, kein Browser-Speicher
    expect(mc).not.toMatch(/partner\.html\?token=\$\{encodeURIComponent\(p\.token\)\}/);
    expect(mc).not.toMatch(/partner-festpreis\.html\?token=\$\{encodeURIComponent\(p\['Token'\]\)\}/);
    const block = mc.slice(mc.indexOf('function bsmLinkZeileHtml'), mc.indexOf('function bsmLinkZeileHtml') + 2000);
    expect(block).not.toMatch(/localStorage|sessionStorage|location\.hash\s*=/);
  });
});
