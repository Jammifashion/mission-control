// KS7: Entwuerfe aus einem Google-Drive-Ordner auf der Bestellseite - Drive-Attrappe, nur erfundene Werte (IDs, Dateinamen).
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { machSheets } from './hilfen/korb-sheet.js';
import { legeZugangAn, leseSeite, _bestellseiteCacheLeeren } from '../lib/bestellseite.js';
import { entwuerfeSeite, entwurfBildSeite, entwuerfeMc, setzeEntwurfOrdner, _entwurfCacheLeeren } from '../lib/bestellEntwuerfe.js';
import { richteEntwurfOrdnerEin } from '../lib/belegArchiv.js';
import { bauRouter } from '../routes/bestellseite.js';
import {
  ordnerIdAus, titelAus, vorschauUrl, entwurfListe, fuerSeite, auslieferWeg, ENTWURF_MAX, BILD_MAX_BYTE,
} from '../utils/bestell-entwuerfe.js';
import { ZUGANG_SPALTEN, ZUGANG_OPTIONAL, TERMIN_SPALTEN, BILD_SPALTEN, BILD_OPTIONAL } from '../utils/bestellseite.js';
import { AUFTRAG_SPALTEN, POSITION_SPALTEN } from '../utils/auftraege.js';

const hier = dirname(fileURLToPath(import.meta.url));
process.env.GOOGLE_SHEET_ID = 'test-sheet';
process.env.BUSINESS_SHEET_ID = 'test-business';
const ABLAGE = 'ablage-erfunden-000001';
process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID = ABLAGE;
const JETZT = () => new Date('2026-11-08T10:00:00Z');
const kunden = async () => ({ kunden: [{ Kunden_Nr: 'K-00001', Status: 'aktiv' }, { Kunden_Nr: 'K-00002', Status: 'aktiv' }] });
let zz = 700; const zufall = () => Buffer.alloc(32, ++zz);
const zeile = (spalten, o) => spalten.map(s => o[s] ?? '');
const ORDNER = 'ordner-erfunden-0000001', FREMD = 'ordner-fremd-00000002';
const THUMB = id => `https://lh3.googleusercontent.com/erfunden-${id}=s220`;
const BILD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function tabs(ohneSpalte = false) {
  const opt = ohneSpalte ? ZUGANG_OPTIONAL.filter(x => x !== 'Entwurf_Ordner') : ZUGANG_OPTIONAL;
  return {
    Bestellseiten: [[...ZUGANG_SPALTEN, ...opt]], Bestell_Termine: [TERMIN_SPALTEN], Bestell_Bilder: [[...BILD_SPALTEN, ...BILD_OPTIONAL]],
    Auftraege: [AUFTRAG_SPALTEN, zeile(AUFTRAG_SPALTEN, { Auftrag_Nr: 'AU-2026-0101', Kunden_Nr: 'K-00001', Kurztitel: 'Test', Status: 'Angebot', Termin: '2026-12-04', Stand: 's' }),
      zeile(AUFTRAG_SPALTEN, { Auftrag_Nr: 'AU-2026-0102', Kunden_Nr: 'K-00002', Kurztitel: 'Test2', Status: 'Angebot', Termin: '2026-12-04', Stand: 's' })],
    Auftrag_Positionen: [POSITION_SPALTEN],
    LShop_Modelle: [['ArticleNr', 'CatalogNr', 'color1', 'color2', 'Size', 'Consistence', 'Grammage']],
  };
}

/** Drive-Attrappe (nur lesen): Ordner + Dateien; zaehlt Aufrufe. */
function driveAttrappe(dateien) {
  const aufrufe = { get: [], list: 0, media: 0 };
  const ordner = { [ORDNER]: { mimeType: 'application/vnd.google-apps.folder', driveId: ABLAGE }, [FREMD]: { mimeType: 'application/vnd.google-apps.folder', driveId: 'andere-ablage-0000' },
    'datei-statt-ordner-01': { mimeType: 'image/jpeg', driveId: ABLAGE } };
  return {
    aufrufe, dateien,
    drive: { files: {
      get: async ({ fileId, alt }) => {
        aufrufe.get.push(fileId);
        if (alt === 'media') { aufrufe.media++; return { status: 200, data: BILD.buffer.slice(BILD.byteOffset, BILD.byteOffset + BILD.length) }; }
        const o = ordner[fileId];
        if (!o) throw Object.assign(new Error('File not found'), { code: 404 });
        return { data: { id: fileId, trashed: false, ...o } };
      },
      list: async ({ q }) => { aufrufe.list++; return { data: { files: q.includes(ORDNER) ? dateien : [] } }; },
    } },
  };
}
const datei = (n, o = {}) => ({ id: `d-${n}-erfunden`, name: `${n}.jpg`, mimeType: 'image/jpeg', size: '1000', thumbnailLink: THUMB(n), imageMediaMetadata: { width: 800, height: 600 }, modifiedTime: '2026-11-08T09:00:00Z', ...o });
const holenAttrappe = (typ = 'image/jpeg', laenge = 5) => jest.fn(async () => ({ ok: true, status: 200, headers: { get: () => typ }, arrayBuffer: async () => new Uint8Array(laenge).buffer }));

let t, s, d, token, token2;
beforeEach(async () => {
  _bestellseiteCacheLeeren(); _entwurfCacheLeeren();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  t = tabs(); s = machSheets(t);
  d = driveAttrappe([datei('02 Jacke Rücken'), datei('10 Hoodie_vorn', { mimeType: 'image/png', name: '10 Hoodie_vorn.png' }), datei('Text', { mimeType: 'text/plain', name: 'Text.txt' }),
    datei('Entwurf PDF', { mimeType: 'application/pdf', name: 'Entwurf PDF.pdf' })]);
  token = (await legeZugangAn({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0101', vorgang: 'vorgang-ks7-0001' }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null })).token;
  token2 = (await legeZugangAn({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0102', vorgang: 'vorgang-ks7-0002' }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null })).token;
});
afterEach(() => jest.restoreAllMocks());
const stand = id => { const k = t.Bestellseiten[0]; return t.Bestellseiten.find(z => z[0] === id)[k.indexOf('Stand')]; };
const setze = (eingabe, o = {}) => setzeEntwurfOrdner({ eingabe: { zugangId: 'BS-001', stand: stand('BS-001'), ...eingabe }, sheets: s.sheets, drive: d.drive, jetzt: JETZT, ...o });

describe('Logik', () => {
  test('Ordner-ID aus Link, Titel aus Dateiname, Vorschau nur Google-Bildhost', () => {
    expect(ordnerIdAus(`https://drive.google.com/drive/folders/${ORDNER}?usp=sharing`)).toBe(ORDNER);
    expect(ordnerIdAus(`https://drive.google.com/open?id=${ORDNER}`)).toBe(ORDNER);
    expect(ordnerIdAus(ORDNER)).toBe(ORDNER);
    expect(ordnerIdAus('kein link')).toBe('');
    expect(titelAus('10_Jacke_Rücken.final.png')).toBe('10 Jacke Rücken.final');
    expect(vorschauUrl(THUMB('a'), 400)).toBe('https://lh3.googleusercontent.com/erfunden-a=s400');
    expect(vorschauUrl('https://boese.example/x=s220', 400)).toBe('');
  });
  test('Liste: nur Bild- und PDF-Typen, sortiert, hoechstens 30; nach aussen nur nr/titel/breite/hoehe', () => {
    const viele = Array.from({ length: 35 }, (_, i) => datei(`E${i + 1}`));
    const r = entwurfListe([...viele, datei('x', { mimeType: 'text/plain' }), datei('y', { mimeType: 'application/pdf', thumbnailLink: '' })]);
    expect(r.liste).toHaveLength(ENTWURF_MAX);
    expect(r.mehr).toBe(true);
    expect(r.liste.slice(0, 3).map(x => x.titel)).toEqual(['E1', 'E2', 'E3']);
    expect(r.liste[9].titel).toBe('E10');   // numerisch sortiert
    expect(Object.keys(fuerSeite(r.liste[0]))).toEqual(['nr', 'titel', 'breite', 'hoehe']);
  });
  test('Auslieferweg: klein = Vorschaubild, gross = Datei bis 8 MB, sonst/PDF Vorschaubild 1600', () => {
    const b = { _mime: 'image/jpeg', _size: 1000, _thumb: THUMB('a') };
    expect(auslieferWeg(b, 'klein')).toEqual({ weg: 'vorschau', px: 400 });
    expect(auslieferWeg(b, 'gross')).toEqual({ weg: 'datei' });
    expect(auslieferWeg({ ...b, _size: BILD_MAX_BYTE + 1 }, 'gross')).toEqual({ weg: 'vorschau', px: 1600 });
    expect(auslieferWeg({ ...b, _mime: 'application/pdf' }, 'gross')).toEqual({ weg: 'vorschau', px: 1600 });
  });
});

describe('Ordner am Zugang (MC)', () => {
  test('nur Ordner in der Ablage "Mission Control"; fremde Ablage, Datei, unbekannt -> 422, nichts geschrieben', async () => {
    const idx = t.Bestellseiten[0].indexOf('Entwurf_Ordner');
    await expect(setze({ link: `https://drive.google.com/drive/folders/${FREMD}` })).rejects.toMatchObject({ status: 422, code: 'ordner' });
    await expect(setze({ link: 'datei-statt-ordner-01' })).rejects.toThrow(/nicht auf einen Ordner/);
    await expect(setze({ link: 'unbekannt-ordner-0000' })).rejects.toMatchObject({ status: 422 });
    await expect(setze({ link: 'kein link' })).rejects.toMatchObject({ status: 422 });
    expect(t.Bestellseiten[1][idx] ?? '').toBe('');
    const r = await setze({ link: `https://drive.google.com/drive/folders/${ORDNER}` });
    expect(r).toMatchObject({ ok: true, anzahl: 3, ordnerId: ORDNER });   // jpg, png, pdf - kein txt
    expect(t.Bestellseiten[1][idx]).toBe(ORDNER);
    const fehlerText = await setze({ link: FREMD }).catch(e => e.message);
    expect(fehlerText).not.toContain(FREMD);
    expect(JSON.stringify(console.log.mock.calls)).not.toMatch(/ordner-erfunden|ordner-fremd/);
  });
  test('"Ordner anlegen": Entwürfe/<AU-Nr.> ueber das Archiv; entfernen; veralteter Stand 409; ohne Spalte 409', async () => {
    const anleger = jest.fn(async ({ name }) => ({ id: ORDNER, neu: true, name }));
    await setze({ anlegen: true }, { anleger });
    expect(anleger).toHaveBeenCalledWith({ name: 'AU-2026-0101', write: true });
    await expect(setze({ entfernen: true, stand: 'alt' })).rejects.toMatchObject({ status: 409, code: 'konflikt' });
    await setze({ entfernen: true });
    expect(t.Bestellseiten[1][t.Bestellseiten[0].indexOf('Entwurf_Ordner')]).toBe('');
    t = tabs(true); s = machSheets(t);
    await legeZugangAn({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0101', vorgang: 'vorgang-ks7-0003' }, sheets: s.sheets, jetzt: JETZT, kundenLesen: kunden, zufall, schluesselLaden: async () => null }).catch(() => {});
    if (t.Bestellseiten.length > 1) await expect(setze({ link: ORDNER })).rejects.toMatchObject({ status: 409, code: 'einrichtung' });
  });
  test('Archiv: Ordner Entwürfe/<Nr> anlegen bzw. vorhandenen nehmen, Name nur AU-/BS-Nr.', async () => {
    const angelegt = [];
    const archivDrive = { files: {
      list: async ({ q }) => ({ data: { files: angelegt.filter(x => q.includes(`'${x.parent}' in parents`) && q.includes(`name = '${x.name}'`)) } }),
      create: async ({ requestBody }) => { const x = { id: `neu-${angelegt.length}`, name: requestBody.name, parent: requestBody.parents[0] }; angelegt.push(x); return { data: { id: x.id } }; },
    } };
    expect(await richteEntwurfOrdnerEin({ name: 'AU-2026-0101', drive: archivDrive, driveId: ABLAGE })).toMatchObject({ id: '', wuerde: true });
    expect(angelegt).toEqual([]);
    const r = await richteEntwurfOrdnerEin({ name: 'AU-2026-0101', write: true, drive: archivDrive, driveId: ABLAGE });
    expect(angelegt.map(x => x.name)).toEqual(['Entwürfe', 'AU-2026-0101']);
    expect(await richteEntwurfOrdnerEin({ name: 'AU-2026-0101', write: true, drive: archivDrive, driveId: ABLAGE })).toEqual({ id: r.id, neu: false });
    await expect(richteEntwurfOrdnerEin({ name: '../x', write: true, drive: archivDrive, driveId: ABLAGE })).rejects.toThrow(/nur AU/);
  });
});

describe('Seite (Token)', () => {
  test('ohne Ordner: Seite unveraendert (kein Feld), leere Liste; mit Ordner nur `entwuerfe: true`', async () => {
    expect(await leseSeite({ token, sheets: s.sheets, jetzt: JETZT })).not.toHaveProperty('entwuerfe');
    expect(await entwuerfeSeite({ token, sheets: s.sheets, drive: d.drive, jetzt: JETZT })).toEqual({ entwuerfe: [], mehr: false });
    await setze({ link: ORDNER });
    _bestellseiteCacheLeeren();
    const seite = await leseSeite({ token, sheets: s.sheets, jetzt: JETZT });
    expect(seite.entwuerfe).toBe(true);
    const r = await entwuerfeSeite({ token, sheets: s.sheets, drive: d.drive, jetzt: JETZT });
    expect(r.entwuerfe).toEqual([
      { nr: 1, titel: '02 Jacke Rücken', breite: 800, hoehe: 600 }, { nr: 2, titel: '10 Hoodie vorn', breite: 800, hoehe: 600 }, { nr: 3, titel: 'Entwurf PDF', breite: 800, hoehe: 600 }]);
    const text = JSON.stringify([seite, r]);
    for (const x of [ORDNER, 'd-02', 'googleusercontent', 'drive.google', ABLAGE]) expect(text).not.toContain(x);
  });
  test('Bilder: klein = Vorschaubild 400, gross = Datei; fremder Zugang und unbekannter Token bekommen nichts', async () => {
    await setze({ link: ORDNER });
    const holen = holenAttrappe();
    const k = await entwurfBildSeite({ token, nr: '1', groesse: 'klein', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT });
    expect(k.typ).toBe('image/jpeg');
    expect(holen.mock.calls[0][0]).toBe('https://lh3.googleusercontent.com/erfunden-02 Jacke Rücken=s400');
    expect(holen.mock.calls[0][1].headers).toBeUndefined();   // kein Token an den Bildhost
    const g = await entwurfBildSeite({ token, nr: '1', groesse: 'gross', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT });
    expect(Buffer.compare(g.buf, BILD)).toBe(0);
    expect(d.aufrufe.media).toBe(1);
    await expect(entwurfBildSeite({ token: token2, nr: '1', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT })).rejects.toMatchObject({ status: 404 });   // anderer Zugang, ohne Ordner
    await expect(entwurfBildSeite({ token: 'A'.repeat(43), nr: '1', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT })).rejects.toMatchObject({ status: 401 });
    await expect(entwurfBildSeite({ token, nr: '9', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT })).rejects.toMatchObject({ status: 404 });
    await expect(entwurfBildSeite({ token, nr: '../1', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT })).rejects.toMatchObject({ status: 404 });
  });
  test('nur Bildtypen, Groessengrenze; Zwischenspeicher neu bei geaenderter Datei', async () => {
    await setze({ link: ORDNER });
    await expect(entwurfBildSeite({ token, nr: '1', sheets: s.sheets, drive: d.drive, holen: holenAttrappe('text/html'), jetzt: JETZT })).rejects.toMatchObject({ status: 502 });
    _entwurfCacheLeeren();
    await expect(entwurfBildSeite({ token, nr: '1', sheets: s.sheets, drive: d.drive, holen: holenAttrappe('image/jpeg', 11 * 1024 * 1024), jetzt: JETZT })).rejects.toMatchObject({ status: 413 });
    _entwurfCacheLeeren();
    const holen = holenAttrappe();
    await entwurfBildSeite({ token, nr: '1', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT });
    await entwurfBildSeite({ token, nr: '1', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT });
    expect(holen).toHaveBeenCalledTimes(1);   // aus dem Zwischenspeicher
    const listen = d.aufrufe.list;
    d.dateien[0].modifiedTime = '2026-11-08T09:30:00Z';   // Datei im Ordner ersetzt
    _entwurfCacheLeeren();   // = Liste abgelaufen (60 s)
    await entwurfBildSeite({ token, nr: '1', sheets: s.sheets, drive: d.drive, holen, jetzt: JETZT });
    expect(holen).toHaveBeenCalledTimes(2);
    expect(d.aufrufe.list).toBeGreaterThan(listen);
  });
  test('Router: ohne Token 401, Bild mit Cache-Control private + Bildtyp, Liste ohne Drive-Adressen', async () => {
    const app = express();
    app.use('/b', bauRouter({ entwuerfe: async () => ({ entwuerfe: [{ nr: 1, titel: 'A', breite: 1, hoehe: 1 }], mehr: false }), entwurf: async ({ token: tk }) => {
      if (tk !== token) throw Object.assign(new Error('Bestellseite nicht gefunden.'), { status: 401 });
      return { buf: BILD, typ: 'image/png' };
    } }));
    expect((await request(app).get('/b/entwurf/1')).status).toBe(401);
    const r = await request(app).get('/b/entwurf/1').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^image\/png/);
    expect(r.headers['cache-control']).toBe('private, max-age=300');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect((await request(app).get('/b/entwurf/1').set('Authorization', `Bearer ${'B'.repeat(43)}`)).status).toBe(401);
    const l = await request(app).get('/b/entwuerfe').set('Authorization', `Bearer ${token}`);
    expect(l.body.entwuerfe[0]).toEqual({ nr: 1, titel: 'A', breite: 1, hoehe: 1 });
  });
  test('MC-Liste zaehlt ausgelassene Dateien (anderer Typ)', async () => {
    await setze({ link: ORDNER });
    expect(await entwuerfeMc({ zugangId: 'BS-001', sheets: s.sheets, drive: d.drive })).toMatchObject({ ordner: true, ausgelassen: 1, mehr: false });
    expect(await entwuerfeMc({ zugangId: 'BS-002', sheets: s.sheets, drive: d.drive })).toMatchObject({ ordner: false, entwuerfe: [] });
  });
});

describe('Oberflaeche', () => {
  const seite = readFileSync(resolve(hier, '../../frontend/bestellen.html'), 'utf8');
  const mc = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
  const ab = (txt, von, bis) => txt.slice(txt.indexOf(von), txt.indexOf(bis));
  test('Seite: Galerie nur mit Entwuerfen, escaped, lazy ohne src waehrend des Ladens; Blaettern im Kreis; nie eine Drive-Adresse', () => {
    const block = ab(seite, '// ── Bestellseite-Anzeige: Anfang', '// ── Bestellseite-Anzeige: Ende ──');
    const F = new Function(`${block}\nreturn { bsEntwuerfeHtml, bsEwSchritt };`)();
    expect(F.bsEntwuerfeHtml(null)).toBe('');
    expect(F.bsEntwuerfeHtml({ liste: [] })).toBe('');
    const urls = new Map([['1|klein', 'blob:x-1'], ['2|klein', Promise.resolve('blob:x-2')]]);
    const h = F.bsEntwuerfeHtml({ liste: [{ nr: 1, titel: 'Jacke <b>' }, { nr: 2, titel: 'Hoodie' }], mehr: true }, urls);
    expect(h).toContain('Entwürfe (2)');
    expect(h).toContain('Jacke &lt;b&gt;');
    expect(h).toContain('src="blob:x-1"');
    expect(h).not.toContain('[object Promise]');
    expect(h).toContain('weitere Entwürfe');
    expect([F.bsEwSchritt(3, 1, 3), F.bsEwSchritt(1, -1, 3), F.bsEwSchritt(2, 1, 3)]).toEqual([1, 3, 3]);
    expect(seite).not.toMatch(/googleusercontent|drive\.google/);
    expect(seite).toContain("apiBild(`entwurf/${nr}?groesse=${groesse}`)");
    expect(seite).toMatch(/Authorization: `Bearer \$\{BS_TOKEN\}`/);
  });
  test('MC: Abschnitt mit Hinweis zu Dateinamen, Knoepfe mit Mouse-over', () => {
    const block = ab(mc, '// ── Bestellseiten-MC: Anfang', '// ── Bestellseiten-MC: Ende ──');
    const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const M = new Function('kuEsc', `${block}\nreturn { bsmEntwurfHtml };`)(kuEsc);
    const ohne = M.bsmEntwurfHtml({ Zugang_ID: 'BS-001' });
    expect(ohne).toContain('Dateinamen werden als Titel gezeigt – sprechend benennen (z. B. „Jacke Rücken“), keine Personennamen.');
    expect(ohne).toContain('Ordner anlegen');
    const mit = M.bsmEntwurfHtml({ Zugang_ID: 'BS-001', Entwurf_Ordner: ORDNER }, { liste: [{ nr: 1, titel: 'A' }], urls: new Map(), mehr: false, ausgelassen: 1 });
    expect(mit).toContain(`https://drive.google.com/drive/folders/${ORDNER}`);
    expect(mit).toContain('1 andere Datei ausgelassen');
    for (const html of [ohne, mit]) for (const m of html.matchAll(/<button[^>]*>/g)) expect(m[0]).toMatch(/data-hilfe="/);
  });
});
