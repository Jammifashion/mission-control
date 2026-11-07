// DB1: Dashboard-Oberflaeche (Block "Dashboard-Anzeige" in frontend/index.html). Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Dashboard-Anzeige: Anfang'), html.indexOf('// ── Dashboard-Anzeige: Ende ──'));
const F = new Function(`${block}\nreturn { dbKachelnHtml, dbNeuHtml, dbHinweiseHtml, dbListeHtml, dbAuHtml, dbGeldHtml, dbDetailHtml, DB_AU_KLASSE, DB_AU_ZIEL };`)();
const panel = html.slice(html.indexOf('<section id="panel-dashboard"'), html.indexOf('<!-- Auftragsmonitor -->'));

const kacheln = {
  hinweise: { zahl: 2, liste: [] }, lange: { zahl: 3, aeltester: 16, rot: true, liste: [] }, todos: { ueberfaellig: 0, heute: 2 },
  rueckstand: { positionen: 4, stueck: 9, kritisch: 0, veraltet: false, liste: true }, ware: { zahl: 0 }, abholung: { zahl: 1 },
  trikots: { nichtBeimProduzenten: 5, goalie: 1, ueber6Wochen: 0 },
};
const klasse = (h, ziel) => h.match(new RegExp(`class="dash-kachel([^"]*)" data-dash-ziel="${ziel}"`))?.[1].trim();

describe('Zu tun', () => {
  test('immer alle 8 Kacheln (KS3: Bestellseiten), 0 = ruhig, Farben nach Regel', () => {
    const h = F.dbKachelnHtml(kacheln);
    expect([...h.matchAll(/data-dash-ziel="([a-z]+)"/g)].map(m => m[1])).toEqual(['hinweise', 'lange', 'todos', 'rueckstand', 'ware', 'abholung', 'trikots', 'bestellseiten']);
    expect(klasse(h, 'hinweise')).toBe('dash-k-warning');
    expect(klasse(h, 'lange')).toBe('dash-k-danger');
    expect(klasse(h, 'todos')).toBe('dash-k-info');
    expect(klasse(h, 'rueckstand')).toBe('dash-k-warning');
    expect(klasse(h, 'ware')).toBe('dash-k-ruhig');
    expect(klasse(h, 'abholung')).toBe('dash-k-au');
    expect(klasse(h, 'trikots')).toBe('dash-k-warning');
    expect(h).toContain('ältester: 16 Tage');
    expect(h).toContain('1 Goalie offen · 0 über 6 Wochen');
    for (const ziel of ['hinweise', 'lange', 'todos', 'rueckstand', 'ware', 'abholung', 'trikots', 'bestellseiten']) expect(h).toContain(`data-dash-ziel="${ziel}" data-hilfe="dash-k-${ziel}"`);   // Hilfe je Kachel
  });
  test('ueberfaellig = rot, Rueckstand kritisch/veraltet = rot', () => {
    const h = F.dbKachelnHtml({ ...kacheln, todos: { ueberfaellig: 1, heute: 0 }, rueckstand: { ...kacheln.rueckstand, veraltet: true } });
    expect(klasse(h, 'todos')).toBe('dash-k-danger');
    expect(klasse(h, 'rueckstand')).toBe('dash-k-danger');
    expect(h).toContain('Liste veraltet');
  });
  test('Teilfehler: Kachel zeigt "–" und welche Quelle fehlt; alles leer = alle ruhig', () => {
    const h = F.dbKachelnHtml({ ...kacheln, rueckstand: { fehlt: ['rueckstand'] } });
    expect(h).toMatch(/data-dash-ziel="rueckstand"[^>]*><span class="dash-k-zahl">–<\/span>[\s\S]*?nicht geladen: Rückstandsliste/);
    const leer = F.dbKachelnHtml({ hinweise: { zahl: 0 }, lange: { zahl: 0 }, todos: { ueberfaellig: 0, heute: 0 }, rueckstand: { positionen: 0, liste: true, stueck: 0 }, ware: { zahl: 0 }, abholung: { zahl: 0 }, trikots: { nichtBeimProduzenten: 0, goalie: 0, ueber6Wochen: 0 }, bestellseiten: { zahl: 0 } });
    expect((leer.match(/dash-k-ruhig/g) ?? []).length).toBe(8);
  });
});

describe('Listen', () => {
  test('Neu: gestapelt, Kennzeichen Shop/AU, 💬/📍, maskiert; leer = "Seit gestern nichts Neues."', () => {
    const h = F.dbNeuHtml([
      { art: 'shop', shop: 'honk', shopKurz: 'HONK', nr: '901', id: 901, kunde: '<b>Erika</b>', betrag: 1234.5, status: 'processing', hinweis: true, abholung: true },
      { art: 'au', nr: 'AU-2026-0007', titel: 'Polos', kunde: 'Testverein', betrag: 0, status: 'Angebot' },
    ]);
    expect(h).toContain('dash-shop-honk');
    expect(h).toContain('#901 💬 📍');
    expect(h).toContain('&lt;b&gt;Erika&lt;/b&gt;');
    expect(h).toContain('<span class="kz kz-au">AU-2026-0007</span>');
    expect(h).toContain('au-st-angebot');
    expect(h).toContain('data-dash-shop="honk" data-dash-id="901"');
    expect(F.dbNeuHtml([])).toContain('Seit gestern nichts Neues.');
    expect(F.dbNeuHtml({ fehlt: ['shop_jfn'] })).toContain('nicht geladen: Shop JFN');
  });
  test('Hinweise: Text maskiert, Knopf gelesen mit Pruefsumme', () => {
    const h = F.dbHinweiseHtml([{ shop: 'jfn', shopKurz: 'JFN', nr: '55', id: 55, kunde: 'Max', text: 'Bitte <script>', pruef: 'abcdef0123456789' }]);
    expect(h).toContain('Bitte &lt;script&gt;');
    expect(h).toContain('data-dash-gelesen data-shop="jfn" data-nr="55" data-pruef="abcdef0123456789" data-hilfe="dash-gelesen">gelesen ✓</button>');
    expect(F.dbHinweiseHtml([])).toContain('Keine ungelesenen Kundenhinweise.');
  });
  test('Wartend: seit n Tagen (Farbe > 7 / > 14), Gruende', () => {
    const h = F.dbListeHtml([{ art: 'au', nr: 'AU-2026-0001', titel: 'X', kunde: 'K', tage: 15, grund: ['wartet auf Ware'] }, { art: 'shop', shop: 'jfn', shopKurz: 'JFN', nr: '1', id: 1, kunde: 'Y', tage: 8, grund: [] }], 'leer');
    expect(h).toContain('dash-tage-danger">seit 15 Tagen');
    expect(h).toContain('dash-tage-warning">seit 8 Tagen');
    expect(h).toContain('· wartet auf Ware');
    expect(F.dbListeHtml([], 'Nichts wartet.')).toContain('Nichts wartet.');
  });
  test('Geld: drei Zahlen, Balken <= 80 px, am Handy zugeklappt', () => {
    const tage = Array.from({ length: 7 }, (_, i) => ({ tag: `2026-11-0${i + 1}`, betrag: i * 10 }));
    const h = F.dbGeldHtml({ heute: 60, sieben: 210, offen: 19.9, tage }, { offenBalken: false });
    expect(h).toContain('Umsatz heute');
    expect(h).toContain('<details><summary');
    expect(Math.max(...[...h.matchAll(/height:(\d+)px/g)].map(m => +m[1]))).toBeLessThanOrEqual(80);
    expect(F.dbGeldHtml({ heute: 0, sieben: 0, offen: 0, tage }, { offenBalken: true })).toContain('<details open>');
  });
  test('Status-Klassen gleich wie in Aufträge (auStatusKlasse)', () => {
    const au = html.slice(html.indexOf('const AU_STATUS_KLASSE = {'), html.indexOf('};', html.indexOf('const AU_STATUS_KLASSE = {')) + 2);
    const A = new Function(`${au}\nreturn AU_STATUS_KLASSE;`)();
    expect(F.DB_AU_KLASSE).toEqual(A);
  });
});

describe('Aufbau und Verdrahtung', () => {
  test('Reihenfolge: Zu tun, Neu, Am laengsten wartend, Eigene Auftraege, Geld; meine/alle oben; kein Trikot-Sync mehr', () => {
    const pos = ['id="dash-wer"', 'id="dash-zutun"', 'Neu in den letzten 24 h', 'Am längsten wartend', 'Eigene Aufträge', '<h2>Geld</h2>'].map(x => panel.indexOf(x));
    expect(pos.every(p => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(panel).not.toContain('trikot-sync-btn');
    expect(panel).not.toContain('Letzte Bestellungen');
    expect(panel).not.toMatch(/title=/);
  });
  test('Trikot-Sync-Knopf jetzt auf der Trikot-Seite, mit Mouse-over', () => {
    const tr = html.slice(html.indexOf('<div id="tab-trikots"'), html.indexOf('<span id="tr-summe">'));
    expect(tr).toContain('<button class="btn" id="trikot-sync-btn" data-hilfe="trikot-sync">Trikot-Sync jetzt</button>');
  });
  test('eine Route, wer je Geraet (localStorage mit try/catch), gelesen per POST', () => {
    expect(html).toContain("`${API_BASE()}/api/dashboard${dbZ.wer ? `?wer=${encodeURIComponent(dbZ.wer)}` : ''}`");
    expect(html).toContain("const DB_WER_KEY = 'mc_dash_wer';");
    expect(html).toContain('/api/dashboard/hinweis-gelesen');
    expect(html).not.toContain('/api/woocommerce/stats');   // alter Einzelaufruf weg
  });
  test('Farben nur ueber Rollen', () => {
    const css = html.slice(html.indexOf('/* DB1: Dashboard'), html.indexOf('.dash-balken .rev-col'));
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
    for (const r of ['--warning', '--danger', '--info', '--au', '--shop-jfn', '--shop-honk']) expect(css).toContain(`var(${r})`);
  });
});

describe('Shop aus dem Kennzeichen', () => {
  test('HONK: Rueckstand und Trikots als "nur JFN"; Ueberschrift zeigt den Shop', () => {
    const h = F.dbKachelnHtml({ ...kacheln, rueckstand: { nurJfn: true }, trikots: { nurJfn: true } });
    expect(h).toMatch(/data-dash-ziel="rueckstand"[^>]*><span class="dash-k-zahl">–<\/span>[\s\S]*?nur JFN/);
    expect(klasse(h, 'trikots')).toBe('dash-k-ruhig');
    expect(html).toContain("dbEl('dash-zutun-titel').textContent = d.shop ? `Zu tun · ${d.shop === 'honk' ? 'HONK' : 'JFN'}` : 'Zu tun';");
    expect(html).toMatch(/dashboard: \{ label: 'Dashboard', shop: true,/);   // Kennzeichen wirkt, Wechsel laedt neu
  });
});
