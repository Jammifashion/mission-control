// PD1: Diagramm- und Uebersichts-Baustein in beiden Partnerportalen (wortgleich), Startseite mit eingeklappten Details.
// Nur ERFUNDENE Zahlen und Artikel.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = f => readFileSync(resolve(hier, `../../frontend/${f}`), 'utf8');
const LIZ = lies('partner.html'), FP = lies('partner-festpreis.html');
const block = (h, anfang, ende) => {
  const a = h.indexOf(anfang), e = h.indexOf(ende);
  expect(a).toBeGreaterThan(-1); expect(e).toBeGreaterThan(a);
  return h.slice(a, e);
};
const norm = b => b.split('\n').map(l => l.trim()).join('\n');
const DG = ['// ── Diagramme: Anfang', '// ── Diagramme: Ende'];
const PU = ['// ── Partner-Übersicht: Anfang', '// ── Partner-Übersicht: Ende'];
const CSS = ['/* ── Partner-Übersicht CSS: Anfang', '/* ── Partner-Übersicht CSS: Ende'];

describe('wortgleich in beiden Portalen', () => {
  test.each([['Diagramme', DG], ['Partner-Übersicht', PU], ['CSS', CSS]])('%s', (_n, [a, e]) => {
    const l = block(LIZ, a, e);
    expect(l.length).toBeGreaterThan(500);
    expect(norm(block(FP, a, e))).toBe(norm(l));
  });
});

// Bausteine ohne DOM ausfuehren (document nur fuer den Klick-Haken).
const F = new Function('document', `${block(LIZ, ...DG)}\n${block(LIZ, ...PU)}\nreturn { dgLinie, dgBalken, dgSatzMonat, dgVergleich, dgObergrenze, puHtml, puSaldo, puLadeHtml };`)({ addEventListener() {} });

const basis = () => ({
  auszahlung: { saldo: 12.5, seit: '01.10.2026', saldoKachel: true, intern: 1, internOhneBetrag: 0, inPruefung: false },
  stand: { offen: 14, inPruefung: 2 }, jahr: 2026, monat: 10,
  reihe: { jahr: [3, 4, 2, 5, 6, 4, 3, 7, 9, 42, 12, null], vorjahr: [null, null, 2, 3, 4, 2, 2, 6, 8, 34, 20, 15] },
  vorjahrDaten: true, vorjahrAb: 2, stueckJahr: 97, stueckVorjahr: null,
  top5: [{ name: 'Muster-Hoodie', stueck: 61 }, { name: 'Muster-Shirt <b>', stueck: 40 }], ohneVerkaeufe: false,
});

describe('Diagramme', () => {
  test('Linie: Farben nur ueber var(--…), Vorjahr gestrichelt, Luecken bei null, 12 Monatsbuchstaben', () => {
    const svg = F.dgLinie({ haupt: [1, 2, null, 4, 5, null, null, null, null, null, null, null], vergleich: [null, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3], beschreibung: 'Test "x"' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Test &#34;x&#34;"');
    expect(svg).toContain('style="stroke:var(--info)"');
    expect(svg).toMatch(/style="stroke:var\(--muted\)" stroke-width="2" stroke-dasharray="5 4"/);
    expect((svg.match(/<polyline[^>]*stroke:var\(--info\)/g) ?? [])).toHaveLength(2);   // [1,2] und [4,5]
    expect((svg.match(/<text[^>]*y="148"/g) ?? [])).toHaveLength(12);
    expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i);
  });
  test('laufender Monat: gepunktet mit hohlem Punkt, Strich bleibt duenn beim Vergroessern', () => {
    const svg = F.dgLinie({ haupt: [5, 6, 7, null, null, null, null, null, null, null, null, null], laufend: 2, beschreibung: 'x' });
    expect((svg.match(/<polyline[^>]*stroke:var\(--info\)/g) ?? [])).toHaveLength(1);   // Januar-Februar fest
    expect(svg).toMatch(/<line [^>]*style="stroke:var\(--info\)"[^>]*stroke-dasharray="2 4"/);
    expect(svg).toContain('style="fill:var(--surface);stroke:var(--info)"');
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
    expect(F.puHtml(basis())).toContain('November bisher</span>');
  });
  test('Achse: 1-2-5-Raster, mindestens 4', () => {
    expect(F.dgObergrenze(0)).toBe(4);
    expect(F.dgObergrenze(42)).toBe(50);
    expect(F.dgObergrenze(61)).toBe(100);
    expect(F.dgObergrenze(3)).toBe(4);
  });
  test('Balken: laengster 100 %, Namen escaped', () => {
    const h = F.dgBalken([{ name: 'A', wert: 50 }, { name: '<x>', wert: 25 }]);
    expect(h).toContain('style="width:100%"'); expect(h).toContain('style="width:50%"');
    expect(h).toContain('&#60;x&#62;'); expect(F.dgBalken([])).toBe('');
  });
  test('Satz unter der Kurve: letzter ganzer Monat mit Vergleich, laufender Monat bisher; Januar; ohne Vorjahr', () => {
    expect(F.dgSatzMonat(basis())).toBe('Oktober: 42 Stück, 8 mehr als im Vorjahr. November bisher: 12 Stück.');
    const ohne = { ...basis(), reihe: { jahr: basis().reihe.jahr, vorjahr: Array(12).fill(null) } };
    expect(F.dgSatzMonat(ohne)).toBe('Oktober: 42 Stück. November bisher: 12 Stück.');
    expect(F.dgSatzMonat({ jahr: 2026, monat: 0, reihe: { jahr: [3, ...Array(11).fill(null)], vorjahr: [...Array(11).fill(0), 20] } }))
      .toBe('Dezember 2025: 20 Stück. Januar bisher: 3 Stück.');
    expect(F.dgVergleich(3, 5)).toBe('2 weniger als im Vorjahr');
    expect(F.dgVergleich(5, 5)).toBe('genauso viele wie im Vorjahr');
  });
});

describe('Partner-Übersicht', () => {
  test('Kacheln, Kurve, Top 5, Sätze; kein title=, keine Farbwerte, Namen escaped', () => {
    const h = F.puHtml(basis());
    for (const s of ['Offene Auszahlung', '12,50', 'bekommst du noch · seit 01.10.2026', '1 direkte Bestellung abgezogen', 'Stück offen', '14',
      'Stück in Prüfung', 'wir prüfen noch', 'Stück 2026', 'Vorjahr erst ab März', 'Verkäufe 2026 (Stück)', 'Top 5 in diesem Jahr',
      'Am meisten verkauft: Muster-Hoodie (61 Stück).', 'Oktober: 42 Stück, 8 mehr als im Vorjahr.']) expect(h).toContain(s);
    expect(h).toContain('Muster-Shirt &#60;b&#62;');
    expect(h).not.toMatch(/title=/);
    expect(h).not.toMatch(/#[0-9a-f]{6}\b|rgb\(/i);
    expect(h).not.toContain('pu-ohne-saldo');
  });
  test('Mouse-over an jeder Kachel und jedem ⓘ (data-tipp), ⓘ mit aria-controls', () => {
    const h = F.puHtml(basis());
    const knoepfe = h.match(/<button[^>]*>/g) ?? [];
    expect(knoepfe.length).toBe(3);
    for (const k of knoepfe) { expect(k).toMatch(/data-tipp="[^"]+"/); expect(k).toMatch(/aria-controls="pu-i-[a-z]+"/); }
    expect((h.match(/class="pu-kachel pu-(off|pr|jahr)[^"]*pu-tipp[^"]*" tabindex="0" data-tipp="/g) ?? [])).toHaveLength(3);
  });
  test('Vorjahresvergleich: mehr = Chip, weniger neutral, keine Daten', () => {
    expect(F.puHtml({ ...basis(), stueckVorjahr: 90 })).toContain('+7 zum Vorjahr');
    expect(F.puHtml({ ...basis(), stueckVorjahr: 100 })).toContain('<span class="pu-klein">-3 zum Vorjahr</span>');
    const ohne = F.puHtml({ ...basis(), vorjahrDaten: false, vorjahrAb: null, reihe: { ...basis().reihe, vorjahr: Array(12).fill(null) } });
    expect(ohne).toContain('Vorjahr: keine Daten');
    expect(ohne).not.toContain('pu-strich pu-vj');
  });
  test('Saldo negativ = Warnfarbe (nie Rot), ohne Saldo-Kachel eigenes Raster, in Prüfung erklaert', () => {
    expect(F.puSaldo(-4).klasse).toBe('pu-minus');
    expect(F.puSaldo(-4).betrag).toContain('−');
    const ohne = F.puHtml({ ...basis(), auszahlung: { ...basis().auszahlung, saldoKachel: false } });
    expect(ohne).toContain('pu-raster pu-ohne-saldo'); expect(ohne).not.toContain('Offene Auszahlung');
    const pr = F.puHtml({ ...basis(), auszahlung: { ...basis().auszahlung, inPruefung: true, internOhneBetrag: 2 } });
    expect(pr).toContain('ein Teil noch in Prüfung');
    expect(pr).toContain('Direkte Bestellungen ohne Betrag zählen hier mit 0.');
  });
  test('leerer Zustand: freundlicher Satz statt leerer Achse', () => {
    const leer = F.puHtml({ ...basis(), ohneVerkaeufe: true, top5: [], stueckJahr: 0, stand: { offen: 0, inPruefung: 0 },
      reihe: { jahr: Array(11).fill(0).concat([null]), vorjahr: Array(12).fill(null) }, vorjahrDaten: false });
    expect(leer).toContain('Sobald die ersten Artikel verkauft sind');
    expect(leer).toContain('In diesem Jahr ist noch nichts verkauft.');
    expect(leer).not.toContain('<svg');
    expect(leer).toContain('nichts in Prüfung');
  });
  test('Ladezustand: Platzhalter je Bereich', () => {
    expect(F.puLadeHtml()).toContain('aria-busy="true"');
    expect((F.puLadeHtml().match(/class="skeleton/g) ?? [])).toHaveLength(6);
  });
});

describe('CSS und Startseite', () => {
  const css = block(LIZ, ...CSS);
  test('Farben nur var(--…), Saldo negativ = --warning, ⓘ 44 px, Raster fuer 375/768/1060', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|hsl\(/i);
    expect(css).toContain('.pu-minus .pu-zahl { color: var(--warning); }');
    expect(css).not.toContain('--danger');
    expect(css).toMatch(/\.pu-i \{[^}]*width: 44px; height: 44px;/);
    expect(css).toContain('@media (min-width: 700px)');
    expect(css).toContain('@media (min-width: 1000px)');
    expect(css).toMatch(/kurve kurve kurve kurve kurve kurve kurve kurve top top top top/);   // Kurve 2/3, Top 5 1/3
  });
  test.each([['partner.html', LIZ, "apiGet('/api/partner/uebersicht')"], ['partner-festpreis.html', FP, "apiFetch('/api/festpreis-public/uebersicht')"]])(
    '%s: Uebersicht zuerst, Details eingeklappt und erst beim Aufklappen geladen', (_n, h, aufruf) => {
      expect(h).toContain(aufruf);
      expect(h).toMatch(/id="pv-uebersicht"[\s\S]*<details class="pu-details" id="pv-details-box">\s*<summary>Details: Verkäufe, direkte Bestellungen, Abrechnungen<\/summary>[\s\S]*id="pv-verkaeufe"[\s\S]*id="pv-abrechnungen"/);
      expect(h).toContain("document.getElementById('pv-details-box').addEventListener('toggle', ev => { if (ev.target.open) detailsLaden(); });");
      expect(h).not.toMatch(/await Promise\.all\(\[loadVerkaeufe\(\), loadIntern\(\), loadSaldo\(\), loadAbrechnungen\(\)\]\)/);
      expect(h).not.toMatch(/<script[^>]+src="https?:/i.test(h) && !h.includes('challenges.cloudflare.com') ? /x/ : /chart\.js|uplot|cdn\./i);
    });
});
