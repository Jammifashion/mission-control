// AM-8: neue Auftraege starten mit "Design"; Anfrage/Angebot nur noch fuer Altdaten sichtbar (Leiste, Filter, Dashboard).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { START_STATUS, ALT_START, ohneAngebotsweg } from '../utils/auftraege.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('/** Positionen gruppieren'));
const F = new Function(`const kuEsc = x => String(x ?? '');\n${block}\nreturn { AU_START, AU_ALT_START, auOhneAngebotsweg, auAltStatusDa, auLeisteHtml };`)();

test('Spiegel: Start und alte Startstatus wie im Backend', () => {
  expect(F.AU_START).toBe(START_STATUS[0]);
  expect(F.AU_ALT_START).toEqual(ALT_START);
  for (const a of [{ Status: 'Design' }, { Status: 'bestellt', Angebot_Am: '2026-10-01' }, { Status: 'Anfrage' }, { Status: 'bestellt' }])
    expect(F.auOhneAngebotsweg(a)).toBe(ohneAngebotsweg(a));
});
test('Leiste: neuer Ablauf ohne Anfrage/Angebot, Altdaten mit', () => {
  const neu = F.auLeisteHtml({ Status: 'Design', Anfrage_Am: '2026-11-17', Design_Am: '2026-11-17' });
  expect(neu).not.toMatch(/>Anfrage|>Angebot/);
  expect(neu).toMatch(/au-aktuell">Design/);
  const alt = F.auLeisteHtml({ Status: 'Design', Anfrage_Am: '2026-10-01', Angebot_Am: '2026-10-05', Design_Am: '2026-10-09' });
  expect(alt).toMatch(/>Anfrage/);
  expect(F.auLeisteHtml({ Status: 'Anfrage', Anfrage_Am: '2026-10-01' })).toMatch(/au-aktuell">Anfrage/);
});
test('Filter/Kachel nur bei Bestand; kein "Start als" mehr im Dialog', () => {
  expect(F.auAltStatusDa([{ Status: 'Design' }], 'Anfrage')).toBe(false);
  expect(F.auAltStatusDa([{ Status: 'Anfrage' }], 'Anfrage')).toBe(true);
  expect(html).not.toMatch(/id="au-start"|data-hilfe="au-start"|'au-start'/);
  expect(html).toContain("DB_AU_NUR_MIT_BESTAND.includes(k) && !Number(a[k]) ? ''");
});
