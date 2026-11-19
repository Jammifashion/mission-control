// Auftragspreise: aus dem Sheet gelesene Betraege bleiben Zahl (kein Umweg ueber Text).
// Dazu: Backend-Deploy mit genau einer Instanz (Sperren gelten je Prozess).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { zeilenAus, POSITION_SPALTEN, POSITION_OPTIONAL } from '../utils/auftraege.js';
import { positionAusZeile, nettoAusBrutto } from '../utils/auftrag-preise.js';

const hier = dirname(fileURLToPath(import.meta.url));

test('Netto mit genau drei Nachkommastellen bleibt der Betrag', () => {
  const netto = nettoAusBrutto(15, 19);          // 12.605 (erfundener Bruttopreis 15,00)
  expect(netto).toBe(12.605);
  const kopf = [...POSITION_SPALTEN, ...POSITION_OPTIONAL];
  const zeile = kopf.map(s => ({ Position_ID: 'AU-2026-0001-01', Auftrag_Nr: 'AU-2026-0001', Art: 'frei', Menge: 2,
    Preis_Netto: netto, Aufpreis_Netto: 1.005, EK_Hand: 4.125, USt_Satz: '' }[s] ?? ''));
  const { zeilen } = zeilenAus([kopf, zeile], POSITION_SPALTEN, 'Position_ID', POSITION_OPTIONAL);
  expect(zeilen[0].Preis_Netto).toBe(12.605);
  const p = positionAusZeile(zeilen[0]);
  expect(p.preis).toBe(12.605);
  expect(p.aufpreis).toBe(1.005);
  expect(p.ekHand).toBe(4.125);
});

test('Text in anderen Spalten bleibt Text, Text-Betraege wie bisher', () => {
  const kopf = ['Position_ID', 'Menge', 'Preis_Netto', 'Motiv'];
  const { zeilen } = zeilenAus([kopf, ['X-01', 3, '12,50', 1.5]], ['Position_ID'], 'Position_ID', ['Menge', 'Preis_Netto', 'Motiv']);
  expect(zeilen[0]).toMatchObject({ Menge: '3', Preis_Netto: '12,50', Motiv: '1.5' });
  expect(positionAusZeile(zeilen[0]).preis).toBe(12.5);
});

test('Backend-Deploy mit genau einer Instanz', () => {
  const yml = readFileSync(resolve(hier, '../../.github/workflows/deploy-backend.yml'), 'utf8');
  expect(yml).toMatch(/--max-instances 1\b/);
});
