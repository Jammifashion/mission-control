// Befehl M: Label in der Meta-Beschreibung.
//
// Anlass: Meta-Beschreibung des Oldschool T-Shirt Herren lautete
//   "... in Rot und Schwarz, Materialzusammensetzung<TAB>100% Baumwolle. Größen XS bis 5XL, ..."
// Eingabe im Feld Eigenschaften (Tab-getrennt, L-Shop-Datenblatt):
//   Materialzusammensetzung<TAB>100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)
//   Grammatur in g/m²<TAB>180 g/m²
// Ursachen: materialAusEigenschaften schnitt nur "Material:" ab; die Grammatur
// wurde gar nicht erkannt (Label nur als "Grammatur:" mit Doppelpunkt) - nicht
// gekuerzt.

import express from 'express';
import request from 'supertest';
import { labelUndWert } from '../lib/seo-prompt.js';
import {
  metaEingaben, grammaturAusEigenschaften, faserOhneLabel, baueMetaBeschreibung,
} from '../lib/seo-meta.js';
import seoMetaRouter from '../routes/seo-meta.js';

const TAB = '\t';
const OLDSCHOOL = [
  `Materialzusammensetzung${TAB}100% Baumwolle (Sports Grey: 85% Baumwolle / 15% Viskose)`,
  `Grammatur in g/m²${TAB}180 g/m²`,
].join('\n');
const FARBEN = ['Rot', 'Schwarz'];

describe('labelUndWert', () => {
  test.each([
    [`Materialzusammensetzung${TAB}100% Baumwolle`, 'Materialzusammensetzung', '100% Baumwolle'],
    ['Materialzusammensetzung: 100% Baumwolle',     'Materialzusammensetzung', '100% Baumwolle'],
    [`Grammatur in g/m²${TAB}180 g/m²`,             'Grammatur in g/m²',       '180 g/m²'],
    ['Grammatur in g/m²: 180 g/m²',                 'Grammatur in g/m²',       '180 g/m²'],
    ['Grammatur in g/m2: 180 g/m2',                 'Grammatur in g/m2',       '180 g/m2'],
    ['  Pflege :  30 °C  ',                         'Pflege',                  '30 °C'],
  ])('%j -> Label %j, Wert %j', (zeile, label, wert) => {
    expect(labelUndWert(zeile)).toEqual({ label, wert });
  });

  test('erster Trenner zaehlt: Doppelpunkt im Wert bleibt im Wert', () => {
    expect(labelUndWert(`Materialzusammensetzung${TAB}100% Baumwolle (Sports Grey: 85% Baumwolle)`))
      .toEqual({ label: 'Materialzusammensetzung', wert: '100% Baumwolle (Sports Grey: 85% Baumwolle)' });
  });

  test('kein Label: Faserangabe mit Doppelpunkt in der Klammer', () => {
    expect(labelUndWert('100% Baumwolle (Grau meliert: 60% Baumwolle)')).toBeNull();
    expect(labelUndWert('85 % Polyester')).toBeNull();
    expect(labelUndWert('Grammatur:')).toBeNull();
    expect(labelUndWert('')).toBeNull();
  });
});

describe('Meta-Eingaben ohne Label', () => {
  test('Oldschool-Eingabe (Tab): Faser ohne Label, Grammatur mit ² erkannt', () => {
    expect(metaEingaben({ eigenschaften: OLDSCHOOL, farben: FARBEN })).toEqual({
      faserangabe: '100% Baumwolle', faserMeldung: null, grammatur: '180 g/m²',
    });
  });

  test('dieselbe Eingabe mit Doppelpunkt-Labels', () => {
    const eig = OLDSCHOOL.replace(/\t/g, ': ');
    expect(metaEingaben({ eigenschaften: eig, farben: FARBEN })).toEqual({
      faserangabe: '100% Baumwolle', faserMeldung: null, grammatur: '180 g/m²',
    });
  });

  test('exakte Schreibweise "Materialzusammensetzung" (Tab und Doppelpunkt)', () => {
    expect(faserOhneLabel(`Materialzusammensetzung${TAB}100% Baumwolle`)).toBe('100% Baumwolle');
    expect(faserOhneLabel('Materialzusammensetzung: 80 % Baumwolle / 20 % Polyester'))
      .toBe('80 % Baumwolle / 20 % Polyester');
  });

  test('exakte Schreibweise "Grammatur in g/m²" (mit ²), Tab und Doppelpunkt', () => {
    expect(grammaturAusEigenschaften(`Grammatur in g/m²${TAB}180 g/m²`)).toBe('180 g/m²');
    expect(grammaturAusEigenschaften('Grammatur in g/m²: 180 g/m²')).toBe('180 g/m²');
    expect(grammaturAusEigenschaften('Grammatur in g/m²: 180 g/m².')).toBe('180 g/m²');
  });

  test('bisherige Formen bleiben', () => {
    expect(grammaturAusEigenschaften('Grammatur: 280 g/m²')).toBe('280 g/m²');
    expect(grammaturAusEigenschaften('Stoffgewicht: 200 g/m²')).toBe('200 g/m²');
    expect(grammaturAusEigenschaften('Flächengewicht\t160 g/m²')).toBe('160 g/m²');
  });

  test('keine Grammatur ohne Label oder ohne Zahl', () => {
    expect(grammaturAusEigenschaften('180 g/m² schwerer Stoff')).toBeNull();
    expect(grammaturAusEigenschaften(`Grammatur${TAB}mittel`)).toBeNull();
    expect(grammaturAusEigenschaften('Gewichtsklasse: 180 g')).toBeNull();
  });

  test('Faser ohne Prozent am Wertanfang bleibt wie sie ist', () => {
    expect(faserOhneLabel('Baumwolle: gekämmt')).toBe('Baumwolle: gekämmt');
    expect(faserOhneLabel('100% Baumwolle')).toBe('100% Baumwolle');
  });

  test('Meta-Beschreibung des Oldschool-Shirts: ohne Label, mit Grammatur', () => {
    const e = metaEingaben({ eigenschaften: OLDSCHOOL, farben: FARBEN });
    const r = baueMetaBeschreibung({
      keyphrase: 'Crocodiles Hamburg Oldschool T-Shirt Herren', farben: FARBEN, ...e,
      groessen: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], lieferzeit: '21',
    });
    expect(r.text).toBe(
      'Crocodiles Hamburg Oldschool T-Shirt Herren in Rot und Schwarz, 100% Baumwolle, 180 g/m². '
      + 'Größen XS bis 5XL, gedruckt nach Bestellung in Wrist.');
    expect(r.text).not.toMatch(/\t|Materialzusammensetzung|Grammatur/);
    expect(r.weggelassen).toEqual([]);
  });

  test('Route POST /api/seo/meta-eingaben liefert dasselbe', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/seo', seoMetaRouter);
    const res = await request(app).post('/api/seo/meta-eingaben')
      .send({ eigenschaften: OLDSCHOOL, farben: FARBEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ faserangabe: '100% Baumwolle', grammatur: '180 g/m²' });
  });
});
