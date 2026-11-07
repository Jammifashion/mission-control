// KS1: Kundenseite frontend/bestellen.html, MC-Block Bestellseiten, Abgrenzung (Quelltext). Nur erfundene Werte.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = p => readFileSync(resolve(hier, '..', p), 'utf8');
const seite = lies('../frontend/bestellen.html');
const mc = lies('../frontend/index.html');
const ab = (txt, a, b) => txt.slice(txt.indexOf(a), txt.indexOf(b));
const TOKEN = 'A'.repeat(20) + 'b_-'.repeat(7) + 'Zz';   // 43 Zeichen, erfunden

describe('bestellen.html: Token aus der Adresse', () => {
  const block = ab(seite, '// ── Bestellseite-Token: Anfang', '// ── Bestellseite-Token: Ende ──');
  const F = new Function(`${block}\nreturn { bsTokenAusAdresse, bsTokenUebernehmen };`)();
  const win = (hash, search = '') => {
    const w = { location: { hash, search, pathname: '/mission-control/bestellen.html' }, ersetzt: [] };
    w.history = { replaceState: (_a, _b, url) => { w.ersetzt.push(url); w.location.hash = ''; w.location.search = ''; } };
    return w;
  };
  const speicher = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m }; };
  test('#t= (bevorzugt) und ?t=, nur gueltige Form', () => {
    expect(TOKEN).toHaveLength(43);
    expect(F.bsTokenAusAdresse(`#t=${TOKEN}`, '')).toBe(TOKEN);
    expect(F.bsTokenAusAdresse('', `?t=${TOKEN}`)).toBe(TOKEN);
    expect(F.bsTokenAusAdresse('#t=kurz', '')).toBe('');
  });
  test('entfernt den Token sofort aus der Adresse und legt ihn nur in den sessionStorage', () => {
    const w = win(`#t=${TOKEN}`), s = speicher();
    expect(F.bsTokenUebernehmen(w, s)).toBe(TOKEN);
    expect(w.ersetzt).toEqual(['/mission-control/bestellen.html']);
    expect(s.m.get('bs_token')).toBe(TOKEN);
    // Neu laden ohne Token in der Adresse: aus dem Speicher, keine Adress-Aenderung
    const w2 = win('');
    expect(F.bsTokenUebernehmen(w2, s)).toBe(TOKEN);
    expect(w2.ersetzt).toEqual([]);
  });
  test('ungueltiger Token in der Adresse wird trotzdem entfernt', () => {
    const w = win('#t=kaputt');
    expect(F.bsTokenUebernehmen(w, speicher())).toBe('');
    expect(w.ersetzt).toHaveLength(1);
  });
  test('Token-Block steht vor allem anderen im <head>; kein localStorage fuer den Token', () => {
    expect(seite.indexOf('bsTokenUebernehmen(window')).toBeLessThan(seite.indexOf('<link rel="stylesheet"'));
    expect(seite).not.toMatch(/localStorage\.setItem\(['"]bs_token/);
    expect(seite).toContain("sessionStorage");
  });
});

describe('bestellen.html: Sicherheit und Farben', () => {
  test('no-referrer, noindex, Token nur als Bearer-Header (nie in der API-Adresse)', () => {
    expect(seite).toContain('<meta name="referrer" content="no-referrer">');
    expect(seite).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(seite).toContain('Authorization: `Bearer ${BS_TOKEN}`');
    expect(seite).toContain('fetch(`${API_BASE}/api/bestellseite/${pfad}`');   // KS2: ein Weg fuer Lesen und Schreiben
    expect(seite).toContain("api('zugang')");
    expect(seite).not.toMatch(/zugang\?|token=\$\{/);
    expect(seite).not.toMatch(/console\.(log|info|warn|error)/);
  });
  test('liest keine Preisfelder', () => {
    const skript = seite.slice(seite.indexOf('<script>', seite.indexOf('</head>')));
    expect(skript).not.toMatch(/\.(price|preis|Preis|ek|EK|Einzelpreis|Summe|netto|brutto)\b/);
  });
  test('Farben nur ueber farben.css, Hell/Dunkel-Umschalter, Datenschutzhinweis', () => {
    const rest = seite.replace(/&#\d+;/g, '');
    const treffer = [...rest.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map(m => m[0]).filter(x => [4, 5, 7, 9].includes(x.length));
    expect(treffer).toEqual([]);
    expect(seite).toContain('<link rel="stylesheet" href="farben.css">');
    expect(seite).toContain('data-theme-knopf="light"');
    expect(seite).toContain('Rückennamen werden nur für den Druck genutzt und nach 12 Monaten gelöscht');
  });
  test('Anzeige (KS2): Termine, kompakte Artikelzeile, "noch zu besorgen", kein "Eintragen kommt bald" mehr', () => {
    const block = ab(seite, '// ── Bestellseite-Anzeige: Anfang', '// ── Bestellseite-Anzeige: Ende ──');
    const F = new Function(`${block}\nreturn { bsTermineHtml, bsArtikelZeileHtml, bsFehlerText };`)();
    const h = F.bsTermineHtml({ termineAnlegen: true, termine: [{ id: 'BT-0001', datum: '2026-11-21', notiz: 'Gegner <b>', bestellschluss: '2026-11-17', empfohlen: '2026-11-14', eintraege: 3 }] }, 'BT-0001');
    expect(h).toContain('Gegner &lt;b&gt;');
    expect(h).toContain('Sa 21.11.2026');
    expect(h).toContain('Bestellschluss 17.11.2026 · am besten bis 14.11.2026');
    expect(h).toContain('3 Einträge');
    const z = F.bsArtikelZeileHtml({ name: 'Hoodie', farbe: 'Black', bild: 'https://x.example/a.jpg', groessen: [{ id: '1', groesse: 'M', lieferbar: 'lieferbar' }, { id: '2', groesse: 'L', nochZuBesorgen: true }] }, 0, false, true);
    expect(z).toContain('noch zu besorgen');
    expect(z).toContain('referrerpolicy="no-referrer"');
    expect(seite).not.toContain('Eintragen kommt bald');
    expect(F.bsFehlerText(403, { error: 'Dieser Link ist abgelaufen.' })).toBe('Dieser Link ist abgelaufen.');
  });
});

describe('MC: Bestellseiten', () => {
  const block = ab(mc, '// ── Bestellseiten-MC: Anfang', '// ── Bestellseiten-MC: Ende ──');
  const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const F = new Function('kuEsc', `${block}\nreturn { bsmLink, bsmZugaengeFuer, bsmHatOffenen, bsmZeileHtml };`)(kuEsc);
  test('Link mit Token im #-Teil', () => {
    expect(F.bsmLink(TOKEN)).toBe(`https://jammifashion.github.io/mission-control/bestellen.html#t=${TOKEN}`);
  });
  test('Zugaenge je Auftrag bzw. Kunde (dauer); gesperrte erlauben einen neuen', () => {
    const z = [{ Zugang_ID: 'BS-001', Art: 'auftrag', Auftrag_Nr: 'AU-2026-0001', Kunden_Nr: 'K-00001', status: 'gesperrt' },
      { Zugang_ID: 'BS-002', Art: 'dauer', Kunden_Nr: 'K-00001', status: 'aktiv' }];
    expect(F.bsmZugaengeFuer(z, { auftragNr: 'AU-2026-0001' }).map(x => x.Zugang_ID)).toEqual(['BS-001']);
    expect(F.bsmZugaengeFuer(z, { kundenNr: 'K-00001' }).map(x => x.Zugang_ID)).toEqual(['BS-002']);
    expect(F.bsmHatOffenen(F.bsmZugaengeFuer(z, { auftragNr: 'AU-2026-0001' }))).toBe(false);
    expect(F.bsmZeileHtml(z[1], 'Verein X')).toContain('data-hilfe="bsm-oeffnen"');
  });
  test('Link nie im Browser-Speicher, nie in der Adresse, nie im Toast; kein title', () => {
    const teil = ab(mc, '// ── SECTION: Bestellseiten (KS1) ──', '// ── SECTION: Artikelerfassung ──');
    expect(teil).not.toMatch(/localStorage|sessionStorage|location\.hash|history\./);
    expect(teil).not.toMatch(/showToast\([^)]*(bsmZ\.link|\.token\b)/);   // Text "Link kopiert" ja, der Wert nie
    expect(teil).not.toMatch(/\btitle=/);
    expect(teil).not.toMatch(/console\./);
  });
  test('Einstiege: Auftragsansicht und Kundenkarte, Unterpunkt Bestellseiten', () => {
    expect(mc).toContain('id="au-bestellseite" data-hilfe="au-bestellseite">Bestellseite für Kunden …</button>');
    expect(mc).toContain('id="ku-dauer-bestellseite" data-hilfe="ku-dauer-bestellseite" hidden>Dauer-Bestellseite …</button>');
    expect(mc).toContain("{ id: 'bestellseiten', label: 'Bestellseiten', panel: 'auftraege' }");
  });
});

describe('Abgrenzung (Quelltext)', () => {
  const KS = ['utils/bestellseite.js', 'lib/bestellseite.js', 'routes/bestellseite.js', 'routes/bestellseiten.js', 'scripts/setup-bestellseiten-reiter.js'];
  const texte = [...KS.map(lies), seite, ab(mc, '// ── SECTION: Bestellseiten (KS1) ──', '// ── SECTION: Artikelerfassung ──')];
  test('KS-Dateien nennen keine Reiter der Partner-Abrechnung', () => {
    for (const x of texte) expect(x).not.toMatch(/Partner_Interne_Bestellungen|FP_Verk(ä|ae)ufe|Partner_Verk(ä|ae)ufe|FP_Artikel|Partner_Artikel/);
  });
  test('Token nie im Log: kein console mit token', () => {
    for (const x of KS.map(lies)) expect(x).not.toMatch(/console\.\w+\([^)]*token/i);
  });
  test('kein values.append, Shop nur ueber getWcClient', () => {
    for (const x of KS.map(lies)) {
      expect(x).not.toMatch(/values\.append\(/);
      expect(x).not.toMatch(/WooCommerceRestApi|fetch\([^)]*wp-json/);
    }
  });
  test('Router oeffentlich vor requireApiKey, Verwaltung dahinter', () => {
    const idx = lies('index.js');
    const pos = s => idx.indexOf(s);
    expect(pos("app.use('/api/bestellseite',")).toBeGreaterThan(pos("app.use('/api/', apiRateLimiter)"));
    expect(pos("app.use('/api/bestellseite',")).toBeLessThan(pos('app.use(requireApiKey)'));
    expect(pos("app.use('/api/bestellseiten',")).toBeGreaterThan(pos('app.use(requireApiKey)'));
  });
});
