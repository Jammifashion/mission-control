// PD2: Detailansicht im Portal - Kacheln Umsatz/Erloes, Umschalter Stueck/Umsatz/Erloes, Top 10, am Handy "Beträge zeigen".
// Bausteine bleiben wortgleich in beiden Portalen (pd1-frontend.test.js). Nur ERFUNDENE Zahlen.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const LIZ = readFileSync(resolve(hier, '../../frontend/partner.html'), 'utf8');
const block = (a, e) => LIZ.slice(LIZ.indexOf(a), LIZ.indexOf(e));
const DG = block('// ── Diagramme: Anfang', '// ── Diagramme: Ende');
const PU = block('// ── Partner-Übersicht: Anfang', '// ── Partner-Übersicht: Ende');
const CSS = block('/* ── Partner-Übersicht CSS: Anfang', '/* ── Partner-Übersicht CSS: Ende');

// Klick-Haken mit kleinem Dokument-Ersatz pruefen
let klick = null;
const elemente = {};
const doc = { addEventListener: (_t, f) => { klick = f; }, getElementById: id => elemente[id] ?? null, querySelectorAll: () => [] };
const R = new Function('document', `${DG}\n${PU}\nreturn { puHtml, puKurveInhalt, dgSatzMonat, DG_EURO };`)(doc);
// Betraege kommen mit geschuetztem Leerzeichen vor dem Euro-Zeichen (toLocaleString) - fuer die Vergleiche normalisiert.
const nb = s => String(s).replace(/ /g, ' ');
const F = { ...R, puHtml: d => nb(R.puHtml(d)), puKurveInhalt: (d, a) => nb(R.puKurveInhalt(d, a)), dgSatzMonat: (d, f) => nb(R.dgSatzMonat(d, f)) };

const basis = (detail = true) => ({
  auszahlung: { saldo: 12.5, seit: '01.11.2026', saldoKachel: true, intern: 0, internOhneBetrag: 0, inPruefung: false },
  stand: { offen: 3, inPruefung: 0 }, jahr: 2026, monat: 10,
  reihe: { jahr: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 2, null], vorjahr: Array(12).fill(null) },
  vorjahrDaten: false, vorjahrAb: null, stueckJahr: 57, stueckVorjahr: null, top5: [{ name: 'Muster-Becher', stueck: 9 }], ohneVerkaeufe: false,
  ...(detail ? { detail: {
    reihe: { umsatz: { jahr: [10, 20, 30, 40, 50, 60, 70, 80, 90, 1234.5, 20, null], vorjahr: Array(12).fill(null) },
      erloes: { jahr: [5, 10, 15, 20, 25, 30, 35, 40, 45, 617.25, 10, null], vorjahr: Array(12).fill(null) } },
    umsatzJahr: 1724.5, erloesJahr: 862.25, umsatzVorjahr: null, erloesVorjahr: null,
    top10: [{ name: 'Muster-Becher', stueck: 9, umsatz: 107.1, erloes: 53.55 }, { name: 'Muster <Shirt>', stueck: 2, umsatz: 50, erloes: 10 }],
  } } : {}),
});

describe('Detailansicht', () => {
  const h = F.puHtml(basis());
  test('Kacheln Umsatz und Erloes (deutsches Komma), Top 10 mit Stueck · Umsatz · Erloes', () => {
    expect(h).toContain('pu-raster pu-mit-detail pu-betraege-aus');
    expect(h).toContain('<span class="pu-zahl">1.724,50 €</span><span class="pu-label">Umsatz 2026</span>');
    expect(h).toContain('<span class="pu-zahl">862,25 €</span><span class="pu-label">Erlös 2026</span>');
    expect(h).toContain('Top 10 in diesem Jahr');
    expect(h).toContain('<strong>9 Stück</strong><span class="pu-betrag"> · Umsatz 107,10 € · Erlös 53,55 €</span>');
    expect(h).toContain('Muster &#60;Shirt&#62;');
    expect(h).not.toContain('Top 5 in diesem Jahr');
  });
  test('Umschalter Stueck/Umsatz/Erloes: Stueck vorgewaehlt, Betraege als pu-betrag (am Handy verborgen)', () => {
    expect(h).toMatch(/data-pu-reihe="stueck" aria-pressed="true"/);
    expect(h).toMatch(/class="pu-tipp pu-betrag" data-pu-reihe="umsatz" aria-pressed="false"/);
    expect(h).toMatch(/class="pu-tipp pu-betrag" data-pu-reihe="erloes" aria-pressed="false"/);
    expect(h).toContain('<button type="button" class="pu-betraege-knopf pu-tipp" data-pu-betraege aria-expanded="false"');
    for (const k of h.match(/<button[^>]*>/g)) expect(k).toMatch(/data-tipp="[^"]+"/);
    expect(h).not.toMatch(/title=/);
  });
  test('Kurve und Satz passend zur Auswahl, Betraege mit deutschem Komma', () => {
    const u = F.puKurveInhalt(basis(), 'umsatz');
    expect(u).toContain('aria-label="Umsatz in Euro je Monat 2026"');
    expect(u).toContain('Oktober: 1.234,50 €. November bisher: 20,00 €.');
    expect(F.puKurveInhalt(basis(), 'erloes')).toContain('Oktober: 617,25 €.');
    expect(F.puKurveInhalt(basis(), 'stueck')).toContain('Oktober: 10 Stück.');
    expect(F.dgSatzMonat({ jahr: 2026, monat: 10, reihe: { jahr: [...Array(9).fill(0), 100, 5, null], vorjahr: [...Array(9).fill(0), 80, 0, 0] } }, F.DG_EURO))
      .toBe('Oktober: 100,00 €, 20,00 € mehr als im Vorjahr. November bisher: 5,00 €.');
  });
  test('Klick auf Umsatz zeichnet die Kurve neu; "Beträge zeigen" schaltet um', () => {
    const ziel = { innerHTML: '' }; elemente['pu-kurve-inhalt'] = ziel;
    const knopfR = { dataset: { puReihe: 'umsatz' } };
    klick({ target: { closest: s => (s === '[data-pu-reihe]' ? knopfR : null) } });
    expect(nb(ziel.innerHTML)).toContain('Umsatz in Euro je Monat');
    const klassen = new Set(['pu-raster', 'pu-betraege-aus']);
    const raster = { classList: { toggle: c => (klassen.has(c) ? (klassen.delete(c), false) : (klassen.add(c), true)) } };
    const bt = { closest: () => raster, setAttribute() {}, textContent: '' };
    klick({ target: { closest: s => (s === '[data-pu-betraege]' ? bt : null) } });
    expect(bt.textContent).toBe('Beträge ausblenden');
    klick({ target: { closest: s => (s === '[data-pu-betraege]' ? bt : null) } });
    expect(bt.textContent).toBe('Beträge zeigen');
    expect(ziel.innerHTML).toContain('Verkaufte Stück je Monat');   // ausgeblendet -> zurueck auf Stueck
  });
  test('ohne detail: Ansicht wie PD1 (keine Betraege, kein Umschalter, Top 5)', () => {
    const o = F.puHtml(basis(false));
    expect(o).not.toMatch(/Umsatz|Erlös|pu-betrag|data-pu-reihe|pu-mit-detail/);
    expect(o).toContain('Top 5 in diesem Jahr');
    expect(o).toContain('Verkäufe 2026 (Stück)');
  });
  test('CSS: Betraege am Handy bis 699 px verborgen, Knopf ab 700 px weg, Tippflaechen, nur var(--…)', () => {
    expect(CSS).toMatch(/@media \(max-width: 699px\) \{ \.pu-betraege-aus \.pu-betrag \{ display: none; \}/);
    expect(CSS).toContain('@media (min-width: 700px) { .pu-betraege-knopf { display: none; } }');
    expect(CSS).toMatch(/\.pu-betraege-knopf \{ min-height: 44px;/);
    expect(CSS).toMatch(/\.pu-umschalter button \{ min-height: 44px; min-width: 44px;/);
    expect(CSS).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i);
    expect(CSS).toContain('"ums ums ums ums ums ums erl erl erl erl erl erl"');
  });
});
