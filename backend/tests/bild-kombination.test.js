// MK2: Bilder nach Kombination (Farbe × Schriftfarbe). Block "Bild-Kombination" in index.html, dazu Galerie (GAL)
// und der Upload mit Titel/ALT. Nur erfundene Werte.
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(hier, '../../frontend/index.html'), 'utf8');
const block = (anfang, ende) => html.slice(html.indexOf(anfang), html.indexOf(ende));
const bk = new Function(`${block('// ── Bild-Kombination: Anfang', '// ── Bild-Kombination: Ende')}
  return { bkSchluessel, bkKombinationen, bkAnwenden, bkBildText, bkIstGroesse };`)();
const gal = new Function(`${block('// ── Galerie: Anfang', '// ── Galerie: Ende')}
  return { galerieAenderung };`)();

const EIGENSCHAFTEN = [
  { name: 'Farbe', tags: ['Red', 'Green'] },
  { name: 'Schriftfarbe', tags: ['Weiß', 'Weißglitzer'] },
  { name: 'Größe', tags: ['S', 'M', 'L'] },
];
const varianten = () => {
  const out = [];
  for (const f of EIGENSCHAFTEN[0].tags) for (const s of EIGENSCHAFTEN[1].tags) for (const g of EIGENSCHAFTEN[2].tags)
    out.push({ attrs: [{ name: 'Farbe', value: f }, { name: 'Schriftfarbe', value: s }, { name: 'Größe', value: g }] });
  return out;
};

describe('eine Eigenschaft (wie vor MK2)', () => {
  test('Schluessel = Wert, Bild fuer alle Varianten mit dieser Farbe', () => {
    const v = varianten();
    bk.bkAnwenden(v, ['Farbe'], { Red: { imageId: 1, imageUrl: 'r.jpg' } });
    expect(v.filter(x => x.imageId === 1)).toHaveLength(6);   // Red × 2 Schriftfarben × 3 Groessen
    expect(v.filter(x => x.imageId === null)).toHaveLength(6);
    expect(bk.bkKombinationen(EIGENSCHAFTEN, ['Farbe']).map(k => k.schluessel)).toEqual(['Red', 'Green']);
  });
});

describe('zwei Eigenschaften', () => {
  test('4 Kombinationen, je ein Bild fuer alle 3 Groessen', () => {
    const kombis = bk.bkKombinationen(EIGENSCHAFTEN, ['Farbe', 'Schriftfarbe']);
    expect(kombis.map(k => k.schluessel)).toEqual(['Red · Weiß', 'Red · Weißglitzer', 'Green · Weiß', 'Green · Weißglitzer']);
    const map = Object.fromEntries(kombis.map((k, i) => [k.schluessel, { imageId: 10 + i, imageUrl: `${i}.jpg` }]));
    const v = varianten();
    bk.bkAnwenden(v, ['Farbe', 'Schriftfarbe'], map);
    expect(v.every(x => x.imageId)).toBe(true);
    for (let i = 0; i < 4; i++) expect(v.filter(x => x.imageId === 10 + i)).toHaveLength(3);
    const rotGlitzerM = v.find(x => x.attrs[0].value === 'Red' && x.attrs[1].value === 'Weißglitzer' && x.attrs[2].value === 'M');
    expect(rotGlitzerM.imageId).toBe(11);
  });

  test('Einzelzuordnung (manuell) ueberschreibt die Kombination fuer genau diese Variation', () => {
    const v = varianten();
    v[0]._imageManual = true; v[0].imageId = 99; v[0].imageUrl = 'eigen.jpg';
    bk.bkAnwenden(v, ['Farbe', 'Schriftfarbe'], { 'Red · Weiß': { imageId: 10, imageUrl: 'a.jpg' } });
    expect(v[0].imageId).toBe(99);
    expect(v[1].imageId).toBe(10);   // Red · Weiß · M
  });

  test('fehlt ein Wert in der Variante -> kein Schluessel, kein Bild', () => {
    expect(bk.bkSchluessel([{ name: 'Farbe', value: 'Red' }], ['Farbe', 'Schriftfarbe'])).toBeNull();
    expect(bk.bkSchluessel([], [])).toBeNull();
  });

  test('keine Dubletten: ein Bild je Kombination, die Galerie bekommt jedes Medium genau einmal (GAL)', () => {
    const kombis = bk.bkKombinationen(EIGENSCHAFTEN, ['Farbe', 'Schriftfarbe']);
    const map = Object.fromEntries(kombis.map((k, i) => [k.schluessel, { imageId: 10 + i, imageUrl: `${i}.jpg` }]));
    const v = varianten();
    bk.bkAnwenden(v, ['Farbe', 'Schriftfarbe'], map);
    const hochgeladen = [10, 11, 12, 13];   // vier Uploads fuer zwoelf Variationen
    const liste = gal.galerieAenderung({ vorhanden: [5], hauptbild: null, variantenBilder: v.map(x => x.imageId), hochgeladen });
    expect(liste).toEqual([5, 10, 11, 12, 13]);
    expect(new Set(liste).size).toBe(liste.length);
  });

  test('Galerie unveraendert, wenn nichts Neues hochgeladen wurde (nie verkleinern)', () => {
    expect(gal.galerieAenderung({ vorhanden: [5, 6, 7], hauptbild: 5, variantenBilder: [6, 6, 6], hochgeladen: [] })).toBeNull();
  });
});

describe('Groesse', () => {
  test('wird erkannt (Hinweis "nicht empfohlen")', () => {
    expect(['Größe', 'Groesse', 'Grösse', 'size'].every(bk.bkIstGroesse)).toBe(true);
    expect(bk.bkIstGroesse('Farbe')).toBe(false);
  });
});

describe('sprechender Name', () => {
  test('Titel/ALT mit den Werten genau wie in der Variante, Dateiname nur ASCII', () => {
    const t = bk.bkBildText({ produktname: 'Ugly Christmas Sweater', werte: ['Red/White', 'Weißglitzer'], endung: 'JPG' });
    expect(t.titel).toBe('Ugly Christmas Sweater – Red/White · Weißglitzer');
    expect(t.alt).toBe(t.titel);
    expect(t.dateiname).toBe('Ugly-Christmas-Sweater-Red-White-Weissglitzer.jpg');
    expect(t.dateiname).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  test('ohne Produktname: nur Werte', () => {
    expect(bk.bkBildText({ produktname: '', werte: ['Green'], endung: 'png' })).toEqual({ titel: 'Green', alt: 'Green', dateiname: 'Green.png' });
  });
});

describe('Oberflaeche', () => {
  test('alter Einzelwert-Upload ist ersetzt, Upload laeuft ueber bkHochladen mit titel/alt', () => {
    expect(html).not.toMatch(/imgref-value-select|imgref-upload-btn|imageRefProperty/);
    expect(html).toContain("fd.append('titel', t.titel)");
    expect(html).toContain("fd.append('alt', t.alt)");
    expect(html).toContain('const data = await bkHochladen(file, v.attrs.map(a => a.value));');   // Einzelzuordnung
    expect(html).toContain('const data = await bkHochladen(f, k.werte.map(w => w.value));');   // je Kombination
  });
  test('neue Elemente mit Mouse-over, kein title', () => {
    for (const k of ['bildref-eigenschaft', 'bildref-plus', 'bildref-eigenschaft-weg']) expect(html).toContain(`'${k}':`);
    expect(html).toMatch(/id="imgref-plus-select"[^>]*data-hilfe="bildref-plus"/);
    expect(html).toMatch(/id="imgref-property-select"[^>]*data-hilfe="bildref-eigenschaft"/);
  });
});

// ── Route: titel/alt gehen an die Mediathek ──
const ladeMedienHoch = jest.fn(async () => ({ ok: true, status: 201, data: { id: 77, source_url: 'https://beispiel.invalid/a.jpg' } }));
jest.unstable_mockModule('../lib/wpMedien.js', () => ({ ladeMedienHoch, setzeMedienText: jest.fn() }));

describe('POST /api/artikel/media-upload', () => {
  test('uebernimmt titel und alt (gekuerzt, ohne Steuerzeichen), Dateiname aus dem Upload', async () => {
    const request = (await import('supertest')).default;
    const express = (await import('express')).default;
    const app = express();
    app.use('/api/artikel', (await import('../routes/artikel.js')).default);
    const res = await request(app).post('/api/artikel/media-upload')
      .field('titel', 'Sweater – Red · Weiß\n').field('alt', 'Sweater – Red · Weiß')
      .attach('file', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'Sweater-Red-Weiss.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(ladeMedienHoch).toHaveBeenCalledWith(expect.objectContaining({
      dateiname: 'Sweater-Red-Weiss.jpg', titel: 'Sweater – Red · Weiß', alt: 'Sweater – Red · Weiß',
    }));
  });
  test('ohne Felder wie bisher: kein titel/alt', async () => {
    ladeMedienHoch.mockClear();
    const request = (await import('supertest')).default;
    const express = (await import('express')).default;
    const app = express();
    app.use('/api/artikel', (await import('../routes/artikel.js')).default);
    await request(app).post('/api/artikel/media-upload').attach('file', Buffer.from([1]), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(ladeMedienHoch.mock.calls[0][0].titel).toBeUndefined();
    expect(ladeMedienHoch.mock.calls[0][0].alt).toBeUndefined();
  });
});
