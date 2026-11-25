// Attrappen-Antworten fuer die Layout-Sichtpruefung "Bestellen & Produktion" (Mission Control).
// Alle Daten erfunden (Namen, Adressen, Nummern). Formen nach frontend/index.html + backend/lib|utils (Stand UI1).
// export function antwort(method, pfad, params, body) -> Objekt/Array (JSON 200) oder undefined.

const ADMIN = id => `https://shop.example.test/wp-admin/post.php?post=${id}&action=edit`;
const BILD = name => `https://i0.wp.com/shop.example.test/wp-content/uploads/2026/10/${name}.jpg`;
const jetztIso = (minVorher = 0) => new Date(Date.now() - minVorher * 60000).toISOString();

// ── L-Shop-Modelle (erfunden) ───────────────────────────────────────────────
const MODELLE = [
  { catalogNr: 'HZ480', marke: 'Nordwerk Textil', bezeichnung: 'Unisex Premium Kapuzenpullover mit Kängurutasche und doppellagiger Kapuze, Bio-Baumwolle',
    farben: ['Black', 'Bottle Green', 'Heather Grey/Navy'], groessen: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'], ek: 18.45 },
  { catalogNr: 'TX210', marke: 'Basicraft', bezeichnung: 'Herren Heavyweight T-Shirt Rundhals 190 g/m², ringgesponnene Baumwolle, Schlauchware',
    farben: ['White', 'Black', 'Deep Navy'], groessen: ['S', 'M', 'L', 'XL', 'XXL'], ek: 4.12 },
  { catalogNr: 'KB150', marke: 'Nordwerk Textil', bezeichnung: 'Kinder Kapuzenjacke mit Reißverschluss und Kordelzug, Bündchen aus Rippstrick',
    farben: ['Red', 'Royal Blue'], groessen: ['3/4 (XS)', '5/6 (S)', '7/8 (M)', '9/11 (L)', '12/13 (XL)'], ek: 11.9 },
  { catalogNr: 'CP045', marke: 'Capline', bezeichnung: 'Baseball-Cap 6-Panel mit Metallschnalle, vorgeformter Schirm',
    farben: ['Black', 'Stone'], groessen: ['One Size'], ek: 3.35 },
  { catalogNr: 'SW330', marke: 'Textilia', bezeichnung: 'Damen Raglan-Sweatshirt leicht tailliert',
    farben: ['Pink', 'Light Oxford'], groessen: ['XS', 'S', 'M', 'L', 'XL'], ek: null },
];
function nr(catalogNr, farbe, groesse) {
  const mi = MODELLE.findIndex(m => m.catalogNr === catalogNr) + 1;
  const m = MODELLE[mi - 1];
  const ci = m.farben.indexOf(farbe) + 1, si = m.groessen.indexOf(groesse) + 1;
  return String(1090000000 + mi * 1000000 + ci * 10000 + si * 100 + ((mi * 37 + ci * 11 + si * 3) % 100));
}
const modellVon = c => MODELLE.find(m => m.catalogNr === c);
const LIEFERBAR = {
  ok: { stufe: 'lieferbar', stock: 1240, nullSeit: '', auslaufdatum: '' },
  null: { stufe: 'null', stock: 0, nullSeit: '2026-11-04', auslaufdatum: '' },
  auslauf: { stufe: 'auslauf', stock: 85, nullSeit: '', auslaufdatum: '2026-12-31' },
  auslaufNull: { stufe: 'auslauf_null', stock: 0, nullSeit: '2026-11-10', auslaufdatum: '2027-01-31' },
  weg: { stufe: 'nicht_gefuehrt', stock: null, nullSeit: '2026-10-28', auslaufdatum: '' },
};
function lieferbarFuer(articleNr) {
  const h = Number(articleNr.slice(-2));
  if (articleNr === nr('HZ480', 'Heather Grey/Navy', 'XL')) return LIEFERBAR.auslaufNull;
  if (articleNr === nr('KB150', 'Royal Blue', '5/6 (S)')) return LIEFERBAR.null;
  if (articleNr === nr('TX210', 'Deep Navy', 'XXL')) return LIEFERBAR.weg;
  if (articleNr === nr('HZ480', 'Bottle Green', 'M')) return LIEFERBAR.auslauf;
  return { ...LIEFERBAR.ok, stock: 200 + h * 13 };
}

// ── WooCommerce-Bestellungen (erfunden) ─────────────────────────────────────
const meta = (key, wert) => ({ id: Math.floor(Math.random() * 1e6), key, value: wert, display_key: key === 'pa_farbe' ? 'Farbe' : key === 'pa_groesse' ? 'Größe' : key, display_value: wert });
function li(id, o) {
  return {
    id, name: o.name, product_id: o.pid ?? 5000 + id % 300, variation_id: o.vid ?? 7000 + id % 900, quantity: o.menge ?? 1,
    tax_class: '', subtotal: String(o.preis ?? 29.9), subtotal_tax: '0.00', total: String(o.preis ?? 29.9), total_tax: '0.00', taxes: [],
    meta_data: o.meta ?? [], sku: o.sku ?? '', price: Number(o.preis ?? 29.9) / (o.menge ?? 1),
    image: { id: 900000 + id, src: o.bild === '' ? '' : BILD(o.bild ?? 'artikel') }, parent_name: o.parent ?? null,
  };
}
const ship = (method_id, instance_id, method_title, total = '0.00') => [{ id: 100 + Number(instance_id || 0), method_title, method_id, instance_id: String(instance_id), total, total_tax: '0.00', taxes: [], meta_data: [] }];
function order(id, o) {
  return {
    id, parent_id: 0, number: String(id), order_key: `wc_order_test${id}`, created_via: 'checkout', version: '9.3.3',
    status: o.status, currency: 'EUR', date_created: o.datum, date_created_gmt: o.datum, date_modified: o.datum,
    discount_total: '0.00', shipping_total: o.versandKosten ?? '0.00', total: o.total, total_tax: '0.00', prices_include_tax: true,
    customer_id: 0, customer_note: o.notiz ?? '',
    billing: { first_name: o.vor, last_name: o.nach, company: '', address_1: 'Musterweg 1', address_2: '', city: o.ort, state: '', postcode: '00000', country: 'DE', email: `kunde${id}@example.test`, phone: '' },
    shipping: { first_name: o.vor, last_name: o.nach, company: '', address_1: 'Musterweg 1', address_2: '', city: o.ort, state: '', postcode: '00000', country: 'DE', phone: '' },
    payment_method: o.zahlart ?? 'ppcp-gateway', payment_method_title: o.zahlartTitel ?? 'PayPal', transaction_id: '',
    date_paid: o.bezahlt === false ? null : o.datum, date_completed: null,
    line_items: o.items, shipping_lines: o.versand, fee_lines: [], coupon_lines: [], refunds: [], meta_data: [],
    mc_admin_url: ADMIN(id),
  };
}
const TRIKOT_HEIM = 'Heimtrikot Saison 2026/27 – Erwachsene, mit Wunschname und Rückennummer';
const ORDERS = [
  order(48219, { status: 'processing', datum: '2026-11-18T19:42:10', total: '119.80', vor: 'Henrike', nach: 'Beispiel-Musterfrau', ort: 'Neustadt am Testbach',
    versand: ship('local_pickup', 6, 'Abholung im Stadion (Heimspiel)'), items: [
      li(9101, { name: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint - Black, M', parent: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint', sku: 'HZ480/NL-Nordlicht-BLK-M', preis: 54.9, bild: 'hoodie-nordlicht-black', meta: [meta('pa_farbe', 'Black'), meta('pa_groesse', 'M')] }),
      li(9102, { name: `${TRIKOT_HEIM} - L`, parent: TRIKOT_HEIM, sku: 'TR-HEIM-2627', preis: 64.9, bild: 'trikot-heim', meta: [meta('pa_groesse', 'L'), meta('Name - Nummer', 'MUSTERMANN - 7')] }),
    ] }),
  order(48218, { status: 'on-hold', bezahlt: false, datum: '2026-11-18T08:05:33', total: '34.80', zahlart: 'bacs', zahlartTitel: 'Vorkasse (Überweisung)', vor: 'Jo', nach: 'Test', ort: 'Beispielhausen',
    versandKosten: '4.90', versand: ship('flat_rate', 1, 'Versand innerhalb Deutschlands', '4.90'), items: [
      li(9111, { name: 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“ - White, L', parent: 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“', sku: 'TX210/VD-1921-WHT-L', preis: 29.9, bild: 'shirt-verein-weiss', meta: [meta('pa_farbe', 'White'), meta('pa_groesse', 'L')] }),
    ] }),
  order(48217, { status: 'processing', datum: '2026-11-02T11:17:48', total: '182.60', vor: 'Kai-Uwe', nach: 'Platzhalter', ort: 'Graz-Probe',
    versandKosten: '12.90', versand: ship('flat_rate', 4, 'Versand nach Österreich', '12.90'), items: [
      li(9121, { name: 'Kinder Kapuzenjacke „Kleiner Kicker“ - Red, 7/8 (M)', parent: 'Kinder Kapuzenjacke „Kleiner Kicker“', sku: 'KB150/KK-Kicker-RED-78', preis: 39.9, bild: 'kinderjacke-rot', meta: [meta('pa_farbe', 'Red'), meta('pa_groesse', '7/8 (M)')] }),
      li(9122, { name: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint - Bottle Green, M', parent: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint', sku: 'HZ480/NL-Nordlicht-BGR-M', preis: 54.9, bild: 'hoodie-nordlicht-gruen', meta: [meta('pa_farbe', 'Bottle Green'), meta('pa_groesse', 'M')] }),
      li(9123, { name: 'Cap „Deichkind-Logo“ gestickt - Black', parent: 'Cap „Deichkind-Logo“ gestickt', sku: 'CP045/DK-Logo-BLK', preis: 24.9, menge: 2, bild: 'cap-black', meta: [meta('pa_farbe', 'Black')] }),
    ] }),
  order(48216, { status: 'processing', datum: '2026-11-16T16:30:02', total: '139.80', vor: 'Merle', nach: 'Erfunden', ort: 'Wrist-Test',
    versand: ship('local_pickup', 3, 'Abholung vor Ort'), items: [
      li(9131, { name: `${TRIKOT_HEIM} - M`, parent: TRIKOT_HEIM, sku: 'TR-HEIM-2627', preis: 69.9, bild: 'trikot-heim', meta: [meta('pa_groesse', 'M'), meta('Name - Nummer', 'TORWAND - 1'), meta('Anmerkung', 'Bitte als Torwart-Version (Goalie), langärmlig wenn möglich')] }),
      li(9132, { name: 'Auswärtstrikot Saison 2026/27 – Kinder, mit Wunschname und Rückennummer - 152', parent: 'Auswärtstrikot Saison 2026/27 – Kinder, mit Wunschname und Rückennummer', sku: 'TR-AUS-2627-K', preis: 69.9, bild: 'trikot-auswaerts', meta: [meta('pa_groesse', '152'), meta('Name - Nummer', 'KLEINE-BEISPIELSTOCHTER - 23')] }),
    ] }),
  order(48215, { status: 'pending', bezahlt: false, datum: '2026-11-19T07:12:40', total: '49.90', vor: 'Pat', nach: 'Ohnename', ort: 'Teststadt',
    versand: ship('free_shipping', 2, 'Kostenloser Versand ab 50 €'), items: [
      li(9141, { name: 'Damen Sweatshirt „Leuchtturm“ - Pink, S', parent: 'Damen Sweatshirt „Leuchtturm“', sku: 'SW330-LT-PNK-S', preis: 49.9, bild: 'sweat-pink', meta: [meta('pa_farbe', 'Pink'), meta('pa_groesse', 'S')] }),
    ] }),
  order(48214, { status: 'processing', datum: '2026-11-11T09:58:21', total: '54.90', vor: 'Fiete', nach: 'Mustermann-Langnamenträger', ort: 'Hohenlockstedt-Probe',
    versand: ship('local_pickup', 5, 'Sammelbestellung Verein (Abholung beim Training)'), items: [
      li(9151, { name: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint - Black, L', parent: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint', sku: 'HZ480/NL-Nordlicht-BLK-L', preis: 54.9, bild: 'hoodie-nordlicht-black', meta: [meta('pa_farbe', 'Black'), meta('pa_groesse', 'L')] }),
    ] }),
  order(48213, { status: 'processing', datum: '2026-11-15T21:03:59', total: '89.70', vor: 'Ronja', nach: 'Testerin', ort: 'Musterdorf',
    versandKosten: '14.90', versand: ship('dhl_wunschtermin', 9, 'DHL Express mit Wunschtermin und Ablageort (Zustellung bis 12 Uhr)', '14.90'), items: [
      li(9161, { name: 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“ - Deep Navy, XXL', parent: 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“', sku: 'TX210/VD-1921-NVY-XXL', preis: 29.9, menge: 3, bild: 'shirt-verein-navy', meta: [meta('pa_farbe', 'Deep Navy'), meta('pa_groesse', 'XXL')] }),
    ] }),
  order(48212, { status: 'processing', datum: '2026-10-29T13:44:12', total: '214.50', vor: 'Ole', nach: 'Fiktiv', ort: 'Beispielfelde',
    versandKosten: '5.90', versand: ship('flat_rate', 1, 'Versand innerhalb Deutschlands', '5.90'), items: [
      li(9171, { name: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint - Black, S', parent: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint', sku: 'HZ480/NL-Nordlicht-BLK-S', preis: 54.9, bild: 'hoodie-nordlicht-black', meta: [meta('pa_farbe', 'Black'), meta('pa_groesse', 'S')] }),
      li(9172, { name: 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“ - Black, M', parent: 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“', sku: 'TX210/VD-1921-BLK-M', preis: 29.9, bild: 'shirt-verein-black', meta: [meta('pa_farbe', 'Black'), meta('pa_groesse', 'M')] }),
      li(9173, { name: 'Kinder Kapuzenjacke „Kleiner Kicker“ - Royal Blue, 5/6 (S)', parent: 'Kinder Kapuzenjacke „Kleiner Kicker“', sku: 'KB150/KK-Kicker-RBL-56', preis: 39.9, bild: 'kinderjacke-blau', meta: [meta('pa_farbe', 'Royal Blue'), meta('pa_groesse', '5/6 (S)')] }),
      li(9174, { name: 'Aufkleber-Set „Vereinswappen“ (10 Stück, wetterfest)', sku: 'AUF-WAPPEN-10', preis: 8.9, menge: 4, bild: '', vid: 0 }),
    ] }),
  order(48211, { status: 'on-hold', datum: '2026-11-09T10:21:30', total: '89.80', zahlart: 'bacs', zahlartTitel: 'Vorkasse (Überweisung)', vor: 'Lene', nach: 'Ausgedacht', ort: 'Fantasiestadt',
    versandKosten: '4.90', versand: ship('flat_rate', 1, 'Versand innerhalb Deutschlands', '4.90'), items: [
      li(9181, { name: `${TRIKOT_HEIM} - XL`, parent: TRIKOT_HEIM, sku: 'TR-HEIM-2627', preis: 64.9, bild: 'trikot-heim', meta: [meta('pa_groesse', 'XL'), meta('Name - Nummer', 'WUNSCHNAME')] }),
      li(9182, { name: 'Strickmütze „Fanblock“ mit Bommel (Fremdware)', sku: 'EXT-MUETZE-FB', preis: 19.9, bild: 'muetze', vid: 0 }),
    ] }),
  order(48210, { status: 'processing', datum: '2026-11-13T17:09:44', total: '164.70', vor: 'Testperson', nach: 'Nummer Zehn', ort: 'Probehagen',
    versand: ship('pickup_location', 0, 'Abholstation Vereinsheim'), items: [
      li(9191, { name: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint - Heather Grey/Navy, XL', parent: 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint', sku: 'HZ480/NL-Nordlicht-HGN-XL', preis: 54.9, menge: 3, bild: 'hoodie-nordlicht-grau', meta: [meta('pa_farbe', 'Heather Grey/Navy'), meta('pa_groesse', 'XL')] }),
    ] }),
];

// ── Stand je Position (PS1, BO5-8) ──────────────────────────────────────────
const L = {
  offen: { art: 'offen', text: 'im Korb offen', kurz: 'L-Shop: im Korb', ziel: 'lshop-korb' },
  raus: g => ({ art: 'raus', text: `herausgenommen: ${g}`, kurz: 'L-Shop: herausgenommen', ziel: 'lshop-korb' }),
  bestellt: (id, zusatz) => ({ art: 'bestellt', text: [`bestellt ${id}`, zusatz].filter(Boolean).join(' · '), kurz: `L-Shop: bestellt${zusatz ? ` · ${zusatz.split(' · ')[0]}` : ''}`, ziel: 'lshop-bestellungen', bestellId: id }),
  geliefert: id => ({ art: 'geliefert', text: 'geliefert', kurz: 'L-Shop: geliefert', ziel: 'lshop-bestellungen', bestellId: id }),
  nichtImKorb: { art: 'nicht-im-korb', text: 'nicht im Korb', kurz: 'L-Shop: nicht im Korb', ziel: 'lshop-korb' },
  kein: grund => ({ art: 'kein', text: 'kein L-Shop-Artikel', grund, kurz: '', ziel: '' }),
  pruefen: grund => ({ art: 'pruefen', text: 'L-Shop-Nummer fehlt', grund, kurz: 'L-Shop-Nummer fehlt', ziel: '' }),
};
// BO5-9 Teil B: DTF-Stand je Position aus dem DTF-Korb
const D = {
  keine: { stand: 'keine', zeilen: [] },
  bestellen: k => ({ stand: 'bestellen', geliefert: false, bestellung: '', grund: '', zeilen: [{ schluessel: `${k}:Brust`, status: 'offen', stand: '2026-11-25T08:00:00.000Z' }] }),
  bestellt: (k, id) => ({ stand: 'bestellt', geliefert: false, bestellung: id, grund: '', zeilen: [{ schluessel: `${k}:Brust`, status: 'bestellt', stand: '2026-11-24T08:00:00.000Z' }] }),
  lager: k => ({ stand: 'lager', geliefert: false, bestellung: '', grund: '', zeilen: [{ schluessel: `${k}:Brust`, status: 'abgewählt', stand: '2026-11-25T09:00:00.000Z' }] }),
};
const STAND = {
  '48219|9101': { imSheet: true, lshop: L.offen, lager: { art: 'offen', schluessel: 'JFN:48219:9101', status: 'offen', menge: 1, n: 3, genug: true, articleNr: nr('HZ480', 'Black', 'M'), orte: [{ ort: 'Wrist', menge: 2 }, { ort: 'Itzehoe Lagerraum Keller', menge: 1 }] } },
  '48219|9102': { imSheet: true, fertig: true, fertigAm: '2026-11-19T09:12:00.000Z', lshop: L.kein('Trikot') },
  '48218|9111': { imSheet: false, lshop: L.offen, dtf: D.bestellen('JFN:48218:9111'), einbuchen: { schluessel: `LS:${nr('HZ480', 'Black', 'L')}`, menge: 1, bezug: 'JFN:48218:9111' } },   // BO5-9
  '48217|9121': { imSheet: true, fertig: true, fertigAm: '2026-11-08T15:30:00.000Z', dtfBestellt: true, lshop: L.geliefert('JFN-2026-0039'), notiz: 'Druck links etwas schief – nachgemessen, passt noch' },
  '48217|9122': { imSheet: true, dtfBestellt: true, dtf: D.bestellt('JFN:48217:9122', 'DTF-2026-0007'), lshop: L.bestellt('JFN-2026-0044', 'versandt · GLS · Paket 1') },
  '48217|9123': { imSheet: true, lshop: L.bestellt('JFN-2026-0046', 'bestätigt (AB) · Liefertermin 03.12.2026') },
  '48216|9131': { imSheet: true, lshop: L.kein('Trikot') },
  '48216|9132': { imSheet: true, lshop: L.kein('Trikot') },
  '48215|9141': { imSheet: false, lshop: L.pruefen('Nummer nicht in den L-Shop-Daten') },
  '48214|9151': { imSheet: true, lshop: L.raus('Ware da / Lager'), lager: { art: 'bestellt', n: 2, articleNr: nr('HZ480', 'Black', 'L'), orte: [{ ort: 'Wrist', menge: 2 }] } },
  '48213|9161': { imSheet: true, lshop: L.nichtImKorb, dtf: D.keine, lagerFrei: { schluessel: `LS:${nr('HZ480', 'Black', 'S')}`, n: 1, orte: [{ ort: 'Wrist', menge: 1 }], genommen: 0, menge: 1, erledigt: false, korbFehlt: true, bezug: 'JFN:48213:9161' } },   // BO5-9
  '48212|9171': { imSheet: true, fertig: true, fertigAm: '2026-11-03T10:00:00.000Z', versendet: true, lshop: L.geliefert('JFN-2026-0039') },
  '48212|9172': { imSheet: true, fertig: true, fertigAm: '2026-11-05T12:20:00.000Z', lshop: L.geliefert('JFN-2026-0039') },
  '48212|9173': { imSheet: true, dtf: D.lager('JFN:48212:9173'), lshop: L.bestellt('JFN-2026-0044', 'versandt · GLS · Paket 2') },
  '48212|9174': { imSheet: true, versendet: true, lshop: L.kein('Artikel ohne Variation') },
  '48211|9181': { imSheet: true, lshop: L.kein('Trikot'), notiz: 'Kunde meldet sich noch wegen Name/Nummer' },
  '48211|9182': { imSheet: true, lshop: L.kein('Fremdware'), einbuchen: { schluessel: '', menge: 1, bezug: 'JFN:48211:9182', grund: 'Kein Lager-Artikel zu dieser Position bekannt – im Dialog suchen oder als Sonstiges anlegen.' } },   // BO5-9
  '48210|9191': { imSheet: true, lshop: L.offen, lager: { art: 'offen', schluessel: 'JFN:48210:9191', status: 'offen', menge: 3, n: 1, genug: false, articleNr: nr('HZ480', 'Heather Grey/Navy', 'XL'), orte: [{ ort: 'Wrist', menge: 1 }] } },
};
const berlinTag = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function tageSeit(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return null;
  return Math.round((Date.parse(berlinTag(new Date())) - Date.parse(berlinTag(d))) / 864e5);
}
const kurzName = (name, menge) => { const n = String(name ?? '').trim(); const k = n.length > 30 ? `${n.slice(0, 29).trimEnd()}…` : n; return Number(menge) > 1 ? `${menge}× ${k}` : k; };
function zusammenfassung(artikel, bestelldatum) {
  const n = artikel.length;
  const fertigListe = artikel.filter(a => a.fertig || a.versendet);
  const fertig = fertigListe.length, versendet = artikel.filter(a => a.versendet).length;
  const wartetAufTeile = fertig > 0 && fertig < n;
  const wartetAuf = artikel.filter(a => !a.fertig && !a.versendet).map(a => `${kurzName(a.name, a.menge)}${a.lshop?.kurz ? ` (${a.lshop.kurz})` : ''}`);
  const text = !n ? '–' : versendet === n ? `${n}/${n} versendet ✓`
    : [`${fertig}/${n} fertig`, versendet ? `${versendet}/${n} versendet` : '', wartetAufTeile ? `wartet auf: ${wartetAuf.join(', ')}` : ''].filter(Boolean).join(' · ');
  const zeiten = fertigListe.map(a => Date.parse(a.fertigAm)).filter(Number.isFinite);
  const seit = zeiten.length ? new Date(Math.min(...zeiten)).toISOString() : String(bestelldatum ?? '');
  return { text, artikel: n, fertig, versendet, wartetAufTeile, allesVersendet: n > 0 && versendet === n,
    wartetSeit: wartetAufTeile ? seit : '', wartetTage: wartetAufTeile ? tageSeit(seit) : null };
}
function produktionStand(body) {
  const bestellungen = (body?.bestellungen ?? []).map(o => {
    const artikel = (o.line_items ?? []).map(l => {
      const s = STAND[`${o.id}|${l.id}`] ?? { imSheet: false, lshop: L.nichtImKorb };
      return {
        wcItemId: String(l.id), name: String(l.name ?? ''), menge: Number(l.quantity) || 1, imSheet: !!s.imSheet,
        fertig: !!s.fertig, fertigAm: s.fertigAm ?? '', versendet: !!s.versendet, dtfBestellt: !!s.dtfBestellt, notiz: s.notiz ?? '',
        lshop: s.lshop, ...(s.lager ? { lager: s.lager } : {}),
        ...(s.einbuchen ? { einbuchen: s.einbuchen } : {}), ...(s.lagerFrei ? { lagerFrei: s.lagerFrei } : {}),   // BO5-9
        ...(s.dtf !== undefined ? { dtf: s.dtf } : {}),   // BO5-9 Teil B
      };
    });
    return { id: String(o.id), artikel, zusammenfassung: zusammenfassung(artikel, o.date_created) };
  });
  const wartet = bestellungen.filter(b => b.zusammenfassung.wartetAufTeile)
    .sort((a, b) => (Date.parse(a.zusammenfassung.wartetSeit) || Infinity) - (Date.parse(b.zusammenfassung.wartetSeit) || Infinity))
    .map(b => b.id);
  return { shop: 'jfn', fertigSpalte: true, bestellungen, wartetAufTeile: wartet };
}

// ── L-Shop-Warenkorb (BO2/BO3/BO5-3/BO5-8/BO7-2) ───────────────────────────
function pos(o) {
  const shop = o.herkunft !== 'eigen';
  const status = o.status ?? 'offen';
  const hinweis = o.hinweis ?? '';
  const sperrt = /storniert|erstattet|abgeschlossen|nicht mehr im Shop|nicht mehr in der Bestellung/.test(hinweis);
  const vorschlag = status === 'offen' && !sperrt;
  return {
    schluessel: o.schluessel, shop: 'JFN', herkunft: shop ? 'shop' : 'eigen', bestellnummer: shop ? o.bestellnummer : '', position: shop ? String(o.position) : '',
    referenz: shop ? '' : o.referenz, ssotId: o.ssotId ?? (shop ? 'SSOT-0412' : ''), produktname: o.produktname ?? '',
    menge: o.menge ?? 1, status, grund: o.grund ?? '', notiz: o.notiz ?? '', hinweis, vorschlag,
    angelegt: o.angelegt ?? '2026-11-12T10:00:00.000Z', statusDatum: o.statusDatum ?? '2026-11-12T10:00:00.000Z', bestellId: '',
    rausAktuell: status === 'abgewählt' ? (o.rausAktuell ?? true) : false,
    bearbeitbar: status === 'offen' || status === 'abgewählt',
    lagerZiel: o.lagerZiel ?? '', grundVorschlag: /storniert|erstattet|nicht mehr/.test(hinweis) ? 'Bestellung storniert' : /abgeschlossen/.test(hinweis) ? 'Bestellung abgeschlossen' : '',
    stand: o.stand ?? '2026-11-12T10:00:00.000Z', aenderung: o.aenderung ?? '',
    ...(shop ? { adminUrl: ADMIN(o.bestellnummer) } : {}),
    _datum: o.datum,
  };
}
const NAME_HOODIE = 'Hoodie „Nordlicht über dem Deich“ – Unisex Premium mit Rückendruck und Ärmelprint';
const NAME_SHIRT = 'T-Shirt „Mein Verein, mein Dorf, meine Leute – seit 1921 gemeinsam auf dem Platz“';
const KORB_ROH = [
  { c: 'HZ480', f: 'Black', g: 'M', lager: { summe: 3, orte: [{ ort: 'Wrist', menge: 2 }, { ort: 'Itzehoe Lagerraum Keller', menge: 1 }] }, pos: [
    { schluessel: 'JFN:48219:9101', bestellnummer: '48219', position: 1, produktname: NAME_HOODIE, datum: '2026-11-18', lager: { n: 3, genug: true } },
    { schluessel: 'JFN:48190:9022', bestellnummer: '48190', position: 2, produktname: NAME_HOODIE, menge: 2, datum: '2026-10-14', hinweis: 'noch nicht bezahlt', lager: { n: 2, genug: true } },
    { schluessel: 'JFN:48120:8811', bestellnummer: '48120', position: 1, produktname: NAME_HOODIE, datum: '2026-10-05', hinweis: 'abgeschlossen', abgeschlossen: true, lagerErledigt: { n: 0, genug: false } },
  ] },
  { c: 'HZ480', f: 'Black', g: 'S', pos: [
    { schluessel: 'EIGEN:2026-0017', herkunft: 'eigen', referenz: 'Vereinsbestellung Jugendabteilung Herbstcamp 2026 – Trainerjacken Nachlieferung', menge: 4, datum: '2026-11-06', angelegt: '2026-11-06T09:15:00.000Z', lagerZiel: 'Wrist', notiz: 'Nur bestellen, wenn das Camp-Budget bestätigt ist (Rückmeldung Kassenwart bis Freitag)', aenderung: 'geändert 07.11.: Menge 2 → 4' },
  ] },
  { c: 'HZ480', f: 'Black', g: '3XL', pos: [
    { schluessel: 'EIGEN:2026-0019', herkunft: 'eigen', referenz: 'AU-2026-0031', menge: 2, datum: '2026-11-14', angelegt: '2026-11-14T13:00:00.000Z' },
  ] },
  { c: 'HZ480', f: 'Bottle Green', g: 'M', pos: [
    { schluessel: 'JFN:48177:8990', bestellnummer: '48177', position: 1, produktname: NAME_HOODIE, datum: '2026-11-07' },
  ] },
  { c: 'HZ480', f: 'Heather Grey/Navy', g: 'XL', lager: { summe: 1, orte: [{ ort: 'Wrist', menge: 1 }] }, pos: [
    { schluessel: 'JFN:48210:9191', bestellnummer: '48210', position: 1, produktname: NAME_HOODIE, menge: 3, datum: '2026-11-13', lager: { n: 1, genug: false } },
  ] },
  { c: 'HZ480', f: 'Black', g: 'L', lager: { summe: 2, orte: [{ ort: 'Wrist', menge: 2 }] }, pos: [
    { schluessel: 'JFN:48214:9151', bestellnummer: '48214', position: 1, produktname: NAME_HOODIE, status: 'abgewählt', grund: 'Ware da / Lager', statusDatum: '2026-11-12T08:30:00.000Z', notiz: 'liegt im Regal B3' },
    { schluessel: 'JFN:48101:8702', bestellnummer: '48101', position: 3, produktname: NAME_HOODIE, status: 'abgewählt', grund: 'schon bestellt', statusDatum: '2026-09-20T08:30:00.000Z', rausAktuell: false },
  ] },
  { c: 'TX210', f: 'White', g: 'L', pos: [
    { schluessel: 'JFN:48218:9111', bestellnummer: '48218', position: 1, produktname: NAME_SHIRT, datum: '2026-11-18', hinweis: 'noch nicht bezahlt' },
    { schluessel: 'JFN:48160:8931', bestellnummer: '48160', position: 2, produktname: NAME_SHIRT, menge: 5, datum: '2026-11-15', hinweis: 'Menge im Shop geändert' },
  ] },
  { c: 'TX210', f: 'Black', g: 'M', pos: [
    { schluessel: 'JFN:48155:8920', bestellnummer: '48155', position: 1, produktname: NAME_SHIRT, datum: '2026-11-17' },
    { schluessel: 'JFN:48150:8901', bestellnummer: '48150', position: 4, produktname: NAME_SHIRT, datum: '2026-11-01', hinweis: 'Bestellung storniert' },
  ] },
  { c: 'TX210', f: 'Deep Navy', g: 'XXL', pos: [
    { schluessel: 'EIGEN:2026-0012', herkunft: 'eigen', referenz: 'Muster Messe', menge: 1, datum: '2026-10-20', angelegt: '2026-10-20T11:00:00.000Z' },
  ] },
  { c: 'KB150', f: 'Red', g: '7/8 (M)', pos: [
    { schluessel: 'JFN:48140:8870', bestellnummer: '48140', position: 1, produktname: 'Kinder Kapuzenjacke „Kleiner Kicker“', menge: 2, datum: '2026-11-16' },
  ] },
  { c: 'KB150', f: 'Royal Blue', g: '5/6 (S)', pos: [
    { schluessel: 'JFN:48141:8873', bestellnummer: '48141', position: 2, produktname: 'Kinder Kapuzenjacke „Kleiner Kicker“', datum: '2026-11-10' },
    { schluessel: 'JFN:48099:8690', bestellnummer: '48099', position: 1, produktname: 'Kinder Kapuzenjacke „Kleiner Kicker“', status: 'Lager', statusDatum: '2026-11-14T15:00:00.000Z', lagerAbgang: [{ ort: 'Wrist', menge: 1 }] },
  ] },
  { c: 'CP045', f: 'Stone', g: 'One Size', pos: [
    { schluessel: 'JFN:48133:8851', bestellnummer: '48133', position: 1, produktname: 'Cap „Deichkind-Logo“ gestickt', menge: 6, datum: '2026-11-12' },
  ] },
  { c: 'SW330', f: 'Pink', g: 'S', pos: [
    { schluessel: 'JFN:48088:8650', bestellnummer: '48088', position: 1, produktname: 'Damen Sweatshirt „Leuchtturm“', status: 'Lager', statusDatum: '2026-11-02T10:00:00.000Z', hinweis: 'Bestellung storniert', lagerAbgang: [{ ort: 'Itzehoe Lagerraum Keller', menge: 1 }] },
    { schluessel: 'JFN:48230:9201', bestellnummer: '48230', position: 1, produktname: 'Damen Sweatshirt „Leuchtturm“', datum: '2026-11-19' },
  ] },
];
function korbBuendel(mitDatum) {
  const buendel = KORB_ROH.map(k => {
    const m = modellVon(k.c);
    const articleNr = nr(k.c, k.f, k.g);
    const positionen = k.pos.map(o => {
      const p = pos(o);
      if (o.lager && p.status === 'offen' && p.vorschlag) p.lager = o.lager;
      if (p.status === 'Lager') p.lagerAbgang = o.lagerAbgang ?? [];
      if (o.abgeschlossen) { p.abgeschlossen = true; p.lagerErledigt = o.lagerErledigt; }
      if (mitDatum) p.bestelldatum = o.datum ?? null;
      delete p._datum;
      return p;
    });
    const zuBestellen = positionen.filter(p => p.vorschlag).reduce((n, p) => n + p.menge, 0);
    const unbezahlt = positionen.filter(p => p.vorschlag && p.hinweis.split(' · ').includes('noch nicht bezahlt')).reduce((n, p) => n + p.menge, 0);
    return {
      articleNr, catalogNr: k.c, bezeichnung: m.bezeichnung, marke: m.marke, farbe: k.f, groesse: k.g,
      lshopText: [articleNr, k.c, m.bezeichnung, k.f, k.g].join(' · '), zuBestellen, unbezahlt, positionen,
      ek: m.ek, lager: k.lager ?? null, lieferbar: lieferbarFuer(articleNr),
    };
  });
  return buendel.sort((a, b) => b.zuBestellen - a.zuBestellen || a.articleNr.localeCompare(b.articleNr));
}
const STAFFEL = { stufen: [{ nr: 1, ab: 150, kosten: 9.9 }, { nr: 2, ab: 400, kosten: 4.9 }, { nr: 3, ab: 800, kosten: 0 }], fehler: '' };
const lieferbarkeitStand = () => ({ datei: jetztIso(40), veraltet: false, liste: 'Auslaufartikel - Stand 12.11.2026.xlsx', listeTage: 7, listeAlt: false });
function lshopKorb(params) {
  const mitDatum = String(params?.get('mit') ?? '').split(',').map(x => x.trim()).includes('bestelldatum');
  const buendel = korbBuendel(mitDatum);
  const alle = buendel.flatMap(b => b.positionen);
  const offen = alle.filter(p => p.status === 'offen'), raus = alle.filter(p => p.status === 'abgewählt');
  return {
    reiterFehlt: false, buendel, staffel: STAFFEL,
    gruende: ['Ware da / Lager', 'schon bestellt', 'Bestellung storniert', 'Bestellung abgeschlossen', 'Sonstiges'],
    lagerHinweis: '', lieferbarkeitStand: lieferbarkeitStand(),
    summen: {
      positionen: offen.length + raus.length,
      zuBestellen: buendel.reduce((n, b) => n + b.zuBestellen, 0),
      artikelnummern: buendel.filter(b => b.zuBestellen > 0).length,
      nichtLieferbar: buendel.filter(b => b.zuBestellen > 0 && b.lieferbar && b.lieferbar.stufe !== 'lieferbar').length,
      offen: offen.length, herausgenommen: raus.length, herausgenommenAktuell: raus.filter(p => p.rausAktuell).length,
      mitHinweis: offen.filter(p => p.hinweis).length, lager: alle.filter(p => p.status === 'Lager').length,
    },
  };
}

// ── Modellsuche / Raster ────────────────────────────────────────────────────
function modelleSuche(q) {
  const s = String(q ?? '').trim().toLowerCase();
  if (s.length < 2) return { modelle: [], mehr: false, hinweis: '' };
  const zehn = /^\d{10}$/.test(s) ? s : '';
  const treffer = [];
  for (const m of MODELLE) {
    let passt;
    if (zehn) passt = m.farben.some(f => m.groessen.some(g => nr(m.catalogNr, f, g) === zehn));
    else passt = [m.catalogNr, m.bezeichnung, m.marke].some(x => x.toLowerCase().includes(s));
    if (passt) treffer.push({ catalogNr: m.catalogNr, bezeichnung: m.bezeichnung, marke: m.marke, bestellbar: m.farben.length * m.groessen.length, ...(zehn ? { articleNr: zehn } : {}) });
  }
  if (!zehn && 'ausgelaufen'.includes(s)) treffer.push({ catalogNr: 'ZZ999', bezeichnung: 'Ausgelaufenes Polo Piqué (nur zur Ansicht)', marke: 'Basicraft', bestellbar: 0 });
  return { modelle: treffer, mehr: false, hinweis: treffer.length ? '' : 'Modell nicht im Bestand (LShop_Modelle) – bitte zuerst als L-Shop-Modell aufnehmen.' };
}
function modellVarianten(catalogNr) {
  const m = modellVon(catalogNr);
  if (!m) return undefined;
  const varianten = [];
  for (const f of m.farben) for (const g of m.groessen) {
    const a = nr(m.catalogNr, f, g);
    varianten.push({ farbe: f, groesse: g, articleNr: a, lieferbar: lieferbarFuer(a) });
  }
  return { catalogNr: m.catalogNr, bezeichnung: m.bezeichnung, marke: m.marke, varianten, lieferbarkeitStand: lieferbarkeitStand() };
}

// ── EDI-Vorschau (BO4a/BO4c/BO4e) ───────────────────────────────────────────
const VERSANDARTEN = [
  { code: 'Standard', name: 'Standard laut L-Shop-Konto (bei uns GLS)' }, { code: 'Abholung', name: 'Abholung im L-Shop-Lager' },
  { code: 'DHL', name: 'DHL' }, { code: 'GLS', name: 'GLS' }, { code: 'DPD', name: 'DPD' }, { code: 'UPS', name: 'UPS' },
  { code: 'EX007', name: 'UPS Express: morgen bis 10:30' }, { code: 'EX011', name: 'UPS Express: morgen bis 14:00' },
  { code: 'EX008', name: 'UPS Express: morgen bis Tagesende' }, { code: 'EX009', name: 'UPS Express: Samstag bis 14:00' },
  { code: 'EX010', name: 'UPS Express EU: meist nächster Werktag' },
];
const cdata = s => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
function ediVorschau(body) {
  const buendel = korbBuendel(false);
  const jeS = new Map(buendel.flatMap(b => b.positionen.map(p => [p.schluessel, { p, b }])));
  let auswahl = (body?.auswahl ?? []).map(a => jeS.get(String(a?.schluessel ?? ''))).filter(Boolean);
  if (!auswahl.length) auswahl = buendel.flatMap(b => b.positionen.filter(p => p.vorschlag).map(p => ({ p, b }))).slice(0, 4);
  const items = auswahl.map(({ p, b }) => ({
    schluessel: p.schluessel, itemnumber: b.articleNr, reference: p.herkunft === 'eigen' ? p.referenz : `JFN-${p.bestellnummer}-${p.position}`,
    quantity: p.menge, modell: b.catalogNr, farbe: b.farbe, groesse: b.groesse,
  }));
  const versandart = VERSANDARTEN.some(v => v.code === body?.versandart) ? body.versandart : 'Standard';
  const commission = typeof body?.commission === 'string' ? body.commission : 'JFN Sammelbestellung KW47';
  const orderId = 'JFN-2026-____';
  const unbezahlt = auswahl.filter(({ p }) => p.hinweis.includes('noch nicht bezahlt'));
  const regeln = [
    ['customer_id', 'rot', 'L-Shop-Kundennummer hinterlegt, höchstens 10 Zeichen'],
    ['auswahl', 'rot', 'mindestens eine Position gewählt, keine doppelt'],
    ['vorhanden', 'rot', 'Position im Korb vorhanden, unverändert und offen'],
    ['shop', 'rot', 'nur Shop JFN'],
    ['hinweis', 'rot', 'kein sperrender Hinweis (storniert, erstattet, abgeschlossen, nicht mehr im Shop, Position weg)'],
    ['artikel', 'rot', 'L-Shop-Artikelnummer 10-stellig, in LShop_Modelle, nicht ausgelaufen, Discontinued nicht 3/6'],
    ['menge', 'rot', 'Menge ganzzahlig größer 0, höchstens 8 Stellen'],
    ['reference', 'rot', 'Referenz vorhanden, höchstens 100 Zeichen'],
    ['commission', 'rot', 'Commission höchstens 30 Zeichen, ohne @ und Zeilenumbruch'],
    ['order_id', 'rot', 'order_id höchstens 30 Zeichen, nur ASCII'],
    ['versandart', 'rot', 'Versandart aus der Liste der Guideline'],
    ['unbezahlt', 'gelb', 'Position noch nicht bezahlt'],
    ['versandart_config', 'gelb', 'Voreingestellte Versandart ist gültig'],
    ['express_spaet', 'gelb', 'Express: nach 13:30 Uhr klappt der Termin nicht mehr, Zusatzkosten fallen trotzdem an'],
    ['abholung', 'gelb', 'Abholung im L-Shop-Lager: die Ware wird nicht verschickt'],
    ['express', 'info', 'Express: Datei muss bis 13:30 Uhr bei L-Shop sein, Zusatzkosten'],
    ['bestellschluss', 'info', 'nach 14:00 Uhr geht die Ware erst am nächsten Werktag raus'],
  ];
  const treffer = {
    unbezahlt: unbezahlt.length ? unbezahlt.map(({ p }) => ({ schluessel: p.schluessel, text: 'noch nicht bezahlt – Bestellung steht auf Vorkasse, Zahlungseingang abwarten oder bewusst mitbestellen' }))
      : [{ schluessel: 'JFN:48218:9111', text: 'noch nicht bezahlt' }],
    versandart_config: [{ schluessel: '', text: 'Voreingestellte Versandart "Hermes" ist unbekannt - Standard vorbelegt (Inhaber: Einstellung lshop.shipping_method).' }],
    abholung: versandart === 'Abholung' ? [{ schluessel: '', text: 'Versandart Abholung gewählt' }] : [],
    bestellschluss: [{ schluessel: '', text: 'jetzt nach 14:00 Uhr (Berlin)' }],
    express: /^EX/.test(versandart) ? [{ schluessel: '', text: 'Express gewählt' }] : [],
  };
  const punkte = regeln.map(([regel, stufe, titel]) => ({ regel, stufe, titel, ok: !(treffer[regel]?.length), treffer: treffer[regel] ?? [] }));
  const z = ['<?xml version="1.0" encoding="UTF-8"?>', '<order>', '  <orderheader>', '    <customer_id>999999</customer_id>',
    `    <order_date>19.11.2026</order_date>`, `    <order_id>${cdata(orderId)}</order_id>`,
    ...(commission.trim() ? [`    <commission>${cdata(commission)}</commission>`] : []),
    `    <shipping_method>${versandart}</shipping_method>`, '    <partial_delivery>-1</partial_delivery>',
    `    <mail>${cdata('info@shop.example.test')}</mail>`, '    <printmode>0</printmode>', '  </orderheader>', '  <orderitems>'];
  for (const i of items) z.push('    <item>', `      <itemnumber>${i.itemnumber}</itemnumber>`, `      <reference>${cdata(i.reference)}</reference>`, `      <quantity>${i.quantity}</quantity>`, '    </item>');
  z.push('  </orderitems>', '</order>');
  const npos = items.map(i => { const ek = modellVon(i.modell).ek; return { schluessel: i.schluessel, itemnumber: i.itemnumber, menge: i.quantity, ek, zeile: ek === null ? null : Math.round(ek * i.quantity * 100) / 100 }; });
  const summe = Math.round(npos.reduce((n, p) => n + (p.zeile ?? 0), 0) * 100) / 100;
  const aktuell = [...STAFFEL.stufen].reverse().find(s => summe >= s.ab) ?? null;
  const naechste = STAFFEL.stufen.find(s => s.ab > summe) ?? null;
  return {
    gruen: true, punkte, items, stueck: items.reduce((n, i) => n + i.quantity, 0),
    xml: `${z.join('\n')}\n`, orderId, commission, standardCommission: 'JFN Sammelbestellung KW47', dateiname: null,
    versandart, versandartVorgabe: 'Standard', versandarten: VERSANDARTEN,
    netto: { positionen: npos, summe, ekFehlt: npos.filter(p => p.ek === null).length,
      staffel: { stufen: STAFFEL.stufen, fehler: '', stand: { stufe: aktuell, unterErster: !aktuell, hoechste: !naechste, naechste, fehlt: naechste ? Math.round((naechste.ab - summe) * 100) / 100 : 0 } } },
  };
}

// ── L-Shop-Bestellungen (BO4d, BO4i, WE2) ───────────────────────────────────
function lbPos(o) {
  const m = modellVon(o.c);
  const ab = o.abHinweis ?? '';
  return {
    schluessel: o.schluessel, articleNr: nr(o.c, o.f, o.g), catalogNr: o.c, bezeichnung: m.bezeichnung, farbe: o.f, groesse: o.g,
    menge: o.menge ?? 1, reference: o.reference, status: o.status ?? 'bestellt', statusDatum: o.statusDatum ?? '2026-11-17T09:00:00.000Z',
    liefertermin: o.liefertermin ?? '', abHinweis: ab, abStufe: !ab || ab === 'ok' ? '' : /Menge gekürzt|fehlt|unbekannt/.test(ab) ? 'rot' : 'gelb',
    herkunft: o.herkunft ?? 'shop', lagerZiel: o.herkunft === 'eigen' ? (o.lagerZiel ?? '') : '', gesperrt: false,
  };
}
const TRACK = (n) => `https://textilelogistics.eu/tracking/?paket=${n}`;
function lshopBestellungen() {
  const b47 = [
    lbPos({ schluessel: 'JFN:48201:9050', c: 'HZ480', f: 'Black', g: 'XL', menge: 2, reference: 'JFN-48201-1' }),
    lbPos({ schluessel: 'EIGEN:2026-0018', c: 'TX210', f: 'White', g: 'M', menge: 12, reference: 'Vereinsbestellung Jugendabteilung Herbstcamp 2026 – Shirts', herkunft: 'eigen', lagerZiel: 'Wrist' }),
  ];
  const b46 = [
    lbPos({ schluessel: 'JFN:48217:9123', c: 'CP045', f: 'Black', g: 'One Size', menge: 2, reference: 'JFN-48217-3', liefertermin: '2026-12-03', abHinweis: 'Termin später: 03.12.2026' }),
    lbPos({ schluessel: 'JFN:48180:9001', c: 'SW330', f: 'Light Oxford', g: 'M', reference: 'JFN-48180-1', abHinweis: 'ok' }),
    lbPos({ schluessel: 'JFN:48181:9004', c: 'KB150', f: 'Red', g: '9/11 (L)', menge: 3, reference: 'JFN-48181-2', abHinweis: 'Menge gekürzt: 3 → 1' }),
  ];
  const b44 = [
    lbPos({ schluessel: 'JFN:48217:9122', c: 'HZ480', f: 'Bottle Green', g: 'M', reference: 'JFN-48217-2' }),
    lbPos({ schluessel: 'JFN:48212:9173', c: 'KB150', f: 'Royal Blue', g: '5/6 (S)', reference: 'JFN-48212-3' }),
    lbPos({ schluessel: 'EIGEN:2026-0015', c: 'HZ480', f: 'Black', g: 'M', menge: 6, reference: 'AU-2026-0028', herkunft: 'eigen' }),
    lbPos({ schluessel: 'EIGEN:2026-0016', c: 'HZ480', f: 'Black', g: 'M', menge: 4, reference: 'AU-2026-0029', herkunft: 'eigen' }),
  ];
  const b42 = [
    lbPos({ schluessel: 'JFN:48170:8960', c: 'TX210', f: 'Black', g: 'L', menge: 2, reference: 'JFN-48170-1', status: 'geliefert', statusDatum: '2026-11-12T10:00:00.000Z' }),
    lbPos({ schluessel: 'JFN:48171:8962', c: 'TX210', f: 'Deep Navy', g: 'XL', reference: 'JFN-48171-1' }),
  ];
  const b39 = [
    lbPos({ schluessel: 'JFN:48217:9121', c: 'KB150', f: 'Red', g: '7/8 (M)', reference: 'JFN-48217-1', status: 'geliefert', statusDatum: '2026-11-08T10:00:00.000Z' }),
    lbPos({ schluessel: 'JFN:48212:9171', c: 'HZ480', f: 'Black', g: 'S', reference: 'JFN-48212-1', status: 'geliefert', statusDatum: '2026-11-08T10:00:00.000Z' }),
    lbPos({ schluessel: 'JFN:48212:9172', c: 'TX210', f: 'Black', g: 'M', reference: 'JFN-48212-2', status: 'geliefert', statusDatum: '2026-11-08T10:00:00.000Z' }),
  ];
  const ls44 = [
    { la: 'LA-5512093', va: 'VA-3381120', datum: '2026-11-14', pakete: [{ paketnummer: '00340434161094042557', frachtfuehrer: 'GLS', url: TRACK('00340434161094042557'), wareneingang: '' }, { paketnummer: '00340434161094042564', frachtfuehrer: 'GLS', url: TRACK('00340434161094042564'), wareneingang: '' }] },
  ];
  const ls42 = [
    { la: 'LA-5509870', va: 'VA-3379902', datum: '2026-11-10', pakete: [{ paketnummer: '00340434161093999001', frachtfuehrer: 'GLS', url: TRACK('00340434161093999001'), wareneingang: '2026-11-12' }] },
    { la: 'LA-5511004', va: 'VA-3379902', datum: '2026-11-13', pakete: [{ paketnummer: '00340434161094011010', frachtfuehrer: 'DHL', url: '', wareneingang: '' }] },
  ];
  const ls39 = [
    { la: 'LA-5507711', va: 'VA-3377001', datum: '2026-11-06', pakete: [{ paketnummer: '00340434161093870011', frachtfuehrer: 'GLS', url: TRACK('00340434161093870011'), wareneingang: '2026-11-08' }] },
  ];
  const karte = (o) => ({
    filter: { unterwegs: o.status !== 'geliefert', geliefert: o.status === 'geliefert' },
    orderId: o.orderId, erzeugt: o.erzeugt, gesendet: o.gesendet ?? '', versandart: o.versandart ?? 'Standard', ab: o.ab ?? null,
    va: [...new Set((o.ls ?? []).map(l => l.va))], commission: o.commission,
    positionenZahl: o.pos.length, stueck: o.pos.reduce((n, p) => n + p.menge, 0),
    status: o.status, pakete: (o.ls ?? []).reduce((n, l) => n + l.pakete.length, 0), positionen: o.pos, lieferscheine: o.ls ?? [],
    geliefertSeit: o.geliefertSeit ?? '',
    paketZaehler: o.paketZaehler ?? null, wahrscheinlichDa: o.wd ?? null,
  });
  return {
    nurJfn: false,
    bestellungen: [
      karte({ orderId: 'JFN-2026-0047', erzeugt: '2026-11-19T08:10:00.000Z', gesendet: '2026-11-19T08:12:30.000Z', commission: 'JFN Sammelbestellung KW47', status: 'gesendet', pos: b47 }),
      karte({ orderId: 'JFN-2026-0046', erzeugt: '2026-11-16T07:55:00.000Z', gesendet: '2026-11-16T07:58:00.000Z', commission: 'JFN Sammelbestellung KW46 Nachtrag', versandart: 'DHL', status: 'bestätigt', pos: b46,
        ab: { nr: 'AB-7781234', datum: '2026-11-17', hinweis: '1× Menge gekürzt · 1× Termin später', stufe: 'rot' } }),
      karte({ orderId: 'JFN-2026-0044', erzeugt: '2026-11-11T09:00:00.000Z', gesendet: '2026-11-11T09:03:00.000Z', commission: 'JFN Sammelbestellung KW46', status: 'versandt', pos: b44, ls: ls44,
        ab: { nr: 'AB-7779001', datum: '2026-11-12', hinweis: 'ok', stufe: '' },
        paketZaehler: { pakete: 2, gescannt: 1, fehlt: true },
        wd: { liste: '2026-11-18', positionen: [
          { schluessel: 'JFN:48217:9122', menge: 1, rest: 1, zaehlen: false, text: 'wahrscheinlich da' },
          { schluessel: 'EIGEN:2026-0015', menge: 6, rest: null, zaehlen: true, text: '2 Positionen mit derselben Nummer – 8 von 10 wahrscheinlich da, bitte zählen' },
          { schluessel: 'EIGEN:2026-0016', menge: 4, rest: null, zaehlen: true, text: '2 Positionen mit derselben Nummer – 8 von 10 wahrscheinlich da, bitte zählen' },
        ] } }),
      karte({ orderId: 'JFN-2026-0042', erzeugt: '2026-11-06T10:00:00.000Z', gesendet: '2026-11-06T10:01:00.000Z', commission: 'JFN Sammelbestellung KW45', status: 'teilweise geliefert', pos: b42, ls: ls42,
        ab: { nr: 'AB-7775120', datum: '2026-11-07', hinweis: 'ok', stufe: '' }, paketZaehler: { pakete: 2, gescannt: 1, fehlt: true } }),
      karte({ orderId: 'JFN-2026-0039', erzeugt: '2026-11-02T08:00:00.000Z', gesendet: '', commission: 'JFN Sammelbestellung KW45', status: 'geliefert', pos: b39, ls: ls39,
        ab: { nr: 'AB-7770333', datum: '2026-11-03', hinweis: 'ok', stufe: '' }, geliefertSeit: '2026-11-08T10:00:00.000Z', paketZaehler: { pakete: 1, gescannt: 1, fehlt: false } }),
    ],
    portal: [
      { va: 'VA-3380455', datum: '2026-11-13', lieferscheine: [{ la: 'LA-5510777', va: 'VA-3380455', datum: '2026-11-13', pakete: [{ paketnummer: '00340434161094001234', frachtfuehrer: 'GLS', url: TRACK('00340434161094001234'), wareneingang: '' }] }], pakete: 1, aelter: false },
      { va: 'VA-3361200', datum: '2026-09-30', lieferscheine: [{ la: 'LA-5480001', va: 'VA-3361200', datum: '2026-09-30', pakete: [{ paketnummer: '00340434161090000001', frachtfuehrer: 'GLS', url: TRACK('00340434161090000001'), wareneingang: '' }, { paketnummer: '00340434161090000002', frachtfuehrer: 'GLS', url: '', wareneingang: '' }] }], pakete: 2, aelter: true },
    ],
    entwuerfe: [
      { orderId: 'JFN-2026-0049', erzeugt: '2026-11-19T10:40:00.000Z', positionen: 5, stueck: 14, commission: 'JFN Sammelbestellung KW47', versandart: 'Standard', dateiname: '', offen: 5, ueberholt: false, ganzUeberholt: false, status: 'Entwurf', sendbar: true, grund: '', unklar: false, wirdGesendet: false, sendeHinweis: '' },
      { orderId: 'JFN-2026-0048', erzeugt: '2026-11-18T15:20:00.000Z', positionen: 3, stueck: 4, commission: 'JFN Express Vereinsfeier', versandart: 'EX007', dateiname: 'JFN-2026-0048_20261118-1522.xml', offen: 0, ueberholt: true, ganzUeberholt: false, status: 'unklar', sendbar: false, grund: '', unklar: true, wirdGesendet: false, sendeHinweis: 'Verbindung beim Hochladen abgebrochen (18.11. 15:22) – Datei evtl. angekommen' },
      { orderId: 'JFN-2026-0045', erzeugt: '2026-11-12T09:00:00.000Z', positionen: 4, stueck: 9, commission: 'JFN Sammelbestellung KW46', versandart: 'Standard', dateiname: '', offen: 2, ueberholt: true, ganzUeberholt: false, status: 'Entwurf', sendbar: false, grund: 'älter als 24 Stunden – neu erzeugen', unklar: false, wirdGesendet: false, sendeHinweis: '' },
    ],
    rueckstandHinweis: '',
  };
}

// ── Rueckstand (RS1) - laedt die Bestellansicht und L-Shop-Bestellungen still mit ──
function rueckstand() {
  const positionen = [
    { articleNr: nr('KB150', 'Royal Blue', '5/6 (S)'), katalogNr: 'KB150', farbe: 'Royal Blue', groesse: '5/6 (S)', rueckstand: 1, bestellt: 1, status: 'ca. KW 49', stufe: 'kw', zuordnung: 'shop', korbSchluessel: ['JFN:48212:9173'], auftraege: [], shops: [{ shop: 'JFN', bestellnummer: '48212' }], orderId: 'JFN-2026-0044', auftrag: '' },
    { articleNr: nr('HZ480', 'Black', 'M'), katalogNr: 'HZ480', farbe: 'Black', groesse: 'M', rueckstand: 2, bestellt: 10, status: 'in Klärung', stufe: 'klaerung', zuordnung: 'auftrag', korbSchluessel: ['EIGEN:2026-0015', 'EIGEN:2026-0016'], auftraege: ['AU-2026-0028', 'AU-2026-0029'], shops: [], orderId: 'JFN-2026-0044', auftrag: '' },
    { articleNr: '1099887766', katalogNr: '', farbe: '', groesse: '', rueckstand: 4, bestellt: null, status: '', stufe: 'unbekannt', zuordnung: 'ohne', korbSchluessel: [], auftraege: [], shops: [], orderId: '', auftrag: 'VA-3361200' },
  ];
  return {
    liste: { name: 'Rueckstandsliste_2026-11-18.xlsx', datum: '2026-11-18', alterTage: 1, veraltet: false }, hinweis: '', positionen,
    je: {
      korb: { 'JFN:48212:9173': { stufe: 'kw', status: 'ca. KW 49', stueck: 1, positionen: 1 }, 'EIGEN:2026-0015': { stufe: 'klaerung', status: 'in Klärung', stueck: 2, positionen: 1 }, 'EIGEN:2026-0016': { stufe: 'klaerung', status: 'in Klärung', stueck: 2, positionen: 1 } },
      auftrag: { 'AU-2026-0028': { stufe: 'klaerung', status: 'in Klärung', stueck: 2, positionen: 1 } },
      shop: { 'JFN:48212': { stufe: 'kw', status: 'ca. KW 49', stueck: 1, positionen: 1 } },
    },
    zahlen: { positionen: 3, stueck: 7, kritisch: 2, ohneBezug: 1 },
  };
}

// ── Trikots (TR2-TR10) ──────────────────────────────────────────────────────
function tz(o) {
  const status = o.status ?? '';
  const st = status.toLowerCase();
  const geliefert = st === 'ok', ersetztStatus = st === 'ersetzt', storniert = st === 'storniert';
  const charge = o.charge ?? '';
  const intern = /^INT-\d{4}-\d{4}$/.test(o.id) && (o.quelle ?? 'shop') === 'intern';
  const hinweise = [...(o.hinweise ?? [])];
  if (!o.name) hinweise.push('name_leer');
  if (!o.nummer) hinweise.push('nummer_leer');
  return {
    zeile: o.zeile, id: o.id, orderId: o.orderId ?? '', produkt: o.produkt, produktKurz: /auswärts/i.test(o.produkt) ? 'Auswärts' : /heim/i.test(o.produkt) ? 'Heim' : o.produkt,
    groesse: o.groesse, name: o.name ?? '', nummer: o.nummer ?? '', quelle: o.quelle ?? 'shop', kundenangabe: o.kundenangabe ?? [],
    charge, bestelltAm: o.bestelltAm ?? '', geliefertAm: o.geliefertAm ?? '', status, notiz: o.notiz ?? '', ersetzt: o.ersetzt ?? '',
    goalie: !!o.goalie, goalieRoh: o.goalie ? 'ja' : (o.goalieRoh ?? ''), referenz: o.referenz ?? '',
    goalieHinweis: o.goalieHinweis ?? '', goalieOffen: !!o.goalieOffen,
    ersetztDurch: o.ersetztDurch ?? [], ersatzFuer: o.ersatzFuer ?? null, hinweise,
    geliefert, ersetztStatus, da: geliefert || ersetztStatus, kundeFertig: geliefert || (ersetztStatus && !!o.ersatzDa),
    abhaken: !charge ? '' : (!status && !o.geliefertAm) ? 'setzen' : (geliefert && o.geliefertAm) ? 'zurueck' : '',
    bestellung: o.bestellung ?? { trikots: 1, fertig: geliefert ? 1 : 0 }, bestellungKomplett: !!o.komplett,
    storniert, intern, bearbeitbar: intern && !charge && !storniert, aenderbar: !charge && !storniert, aendernGesperrt: !!charge && !storniert,
    notizMc: o.notiz ?? '',
    ...(o.zahlung ? { zahlung: o.zahlung } : {}),
  };
}
const HEIM = 'Heimtrikot Saison 2026/27 – Erwachsene, mit Wunschname und Rückennummer';
const AUS_K = 'Auswärtstrikot Saison 2026/27 – Kinder, mit Wunschname und Rückennummer';
const UNBEZ = id => ({ stufe: 'unbezahlt', text: 'nicht bezahlt', link: ADMIN(id) });
function trikots(mitZahlung) {
  const offen = [
    tz({ zeile: 212, id: '48219|9102|1', orderId: '48219', produkt: HEIM, groesse: 'L', name: 'MUSTERMANN', nummer: '7', kundenangabe: [{ feld: 'Name - Nummer', wert: 'MUSTERMANN - 7' }] }),
    tz({ zeile: 213, id: '48216|9131|1', orderId: '48216', produkt: HEIM, groesse: 'M', name: 'TORWAND', nummer: '1', goalieOffen: true, goalieHinweis: 'Fundstelle: Anmerkung · Stichwort: goalie',
      kundenangabe: [{ feld: 'Name - Nummer', wert: 'TORWAND - 1' }, { feld: 'Anmerkung', wert: 'Bitte als Torwart-Version (Goalie), langärmlig wenn möglich' }], bestellung: { trikots: 2, fertig: 0 } }),
    tz({ zeile: 214, id: '48216|9132|1', orderId: '48216', produkt: AUS_K, groesse: '152', name: 'KLEINE-BEISPIELSTOCHTER', nummer: '23', bestellung: { trikots: 2, fertig: 0 } }),
    tz({ zeile: 215, id: '48211|9181|1', orderId: '48211', produkt: HEIM, groesse: 'XL', name: '', nummer: '', notiz: 'Kunde meldet sich noch wegen Name/Nummer – Platzhalter WUNSCHNAME im Shop',
      kundenangabe: [{ feld: 'Name - Nummer', wert: 'WUNSCHNAME' }, { feld: 'Hinweis an uns', wert: 'Name kommt per Mail nach, sobald die Mannschaftsliste für die Rückrunde feststeht' }],
      zahlung: mitZahlung ? UNBEZ(48211) : null }),
    tz({ zeile: 216, id: 'INT-2026-0007', quelle: 'intern', produkt: HEIM, groesse: 'XXL', name: 'TRAINERTEAM', nummer: '00', referenz: 'AU-2026-0031', goalie: true,
      kundenangabe: [{ feld: 'Referenz', wert: 'AU-2026-0031' }, { feld: 'Notiz', wert: 'Trainertrikot, Ärmelsponsor weglassen' }] }),
  ];
  const c14 = [
    tz({ zeile: 190, id: '48160|8932|1', orderId: '48160', produkt: HEIM, groesse: 'S', name: 'BEISPIEL', nummer: '10', charge: '14', bestelltAm: '29.10.2026', status: 'ok', geliefertAm: '18.11.2026', komplett: true, bestellung: { trikots: 1, fertig: 1 } }),
    tz({ zeile: 191, id: '48161|8935|1', orderId: '48161', produkt: HEIM, groesse: 'M', name: 'PROBE', nummer: '4', charge: '14', bestelltAm: '29.10.2026', bestellung: { trikots: 2, fertig: 1 } }),
    tz({ zeile: 192, id: '48161|8936|1', orderId: '48161', produkt: AUS_K, groesse: '140', name: 'PROBE JUNIOR', nummer: '44', charge: '14', bestelltAm: '29.10.2026', status: 'ok', geliefertAm: '18.11.2026', bestellung: { trikots: 2, fertig: 1 } }),
    tz({ zeile: 193, id: '48162|8940|1', orderId: '48162', produkt: HEIM, groesse: 'L', name: 'FALSCHGEDRUCKT', nummer: '9', charge: '14', bestelltAm: '29.10.2026', status: 'ersetzt',
      ersetztDurch: [{ id: 'INT-2026-0009', charge: '', status: '' }] }),
    tz({ zeile: 194, id: '48163|8944|1', orderId: '48163', produkt: HEIM, groesse: '3XL', name: 'GANZLANGERNACHNAMEMITBINDESTRICH-ZWEI', nummer: '99', charge: '14', bestelltAm: '29.10.2026', goalie: true,
      zahlung: mitZahlung ? { stufe: 'erstattet', text: 'erstattet', link: ADMIN(48163) } : null }),
  ];
  const c13 = [
    tz({ zeile: 170, id: '48120|8812|1', orderId: '48120', produkt: HEIM, groesse: 'M', name: 'ALT', nummer: '3', charge: '13', bestelltAm: '08.10.2026', status: 'ok', geliefertAm: '05.11.2026', komplett: true }),
    tz({ zeile: 171, id: 'INT-2026-0004', quelle: 'intern', produkt: AUS_K, groesse: '128', name: 'GAST', nummer: '12', charge: '13', bestelltAm: '', status: 'ok', referenz: 'Sommerfest Verein' }),
  ];
  const entfernt = [
    tz({ zeile: 205, id: 'INT-2026-0006', quelle: 'intern', produkt: HEIM, groesse: 'S', name: 'DOPPELT', nummer: '5', status: 'storniert', referenz: 'versehentlich doppelt angelegt' }),
  ];
  if (!mitZahlung) for (const z of [...offen, ...c14]) delete z.zahlung;
  else for (const z of [...offen, ...c14]) if (!z.zahlung) delete z.zahlung;
  const gruppen = [
    { charge: '', offen: true, anzahl: offen.length, da: 0, bestelltAm: [], hinweise: [], zeilen: offen },
    { charge: '14', offen: false, anzahl: c14.length, da: c14.filter(z => z.da).length, bestelltAm: ['29.10.2026'], hinweise: [], zeilen: c14 },
    { charge: '13', offen: false, anzahl: c13.length, da: c13.filter(z => z.da).length, bestelltAm: ['08.10.2026'], hinweise: ['ohne_bestellt_am'], zeilen: c13 },
    { charge: '', offen: false, storniert: true, anzahl: entfernt.length, da: 0, bestelltAm: [], hinweise: [], zeilen: entfernt },
  ];
  const aktiv = [...offen, ...c14, ...c13];
  return {
    spalteErsetzt: true, spalteGoalie: true, gruppen,
    bestellungen: {
      48219: { stufe: 'nicht_bestellt', trikots: 1, da: 0, chargen: [], bestelltAm: '', ersatzCharge: '', goalie: 0 },
      48216: { stufe: 'nicht_bestellt', trikots: 2, da: 0, chargen: [], bestelltAm: '', ersatzCharge: '', goalie: 0 },
      48211: { stufe: 'nicht_bestellt', trikots: 1, da: 0, chargen: [], bestelltAm: '', ersatzCharge: '', goalie: 0 },
      48160: { stufe: 'da', trikots: 1, da: 1, chargen: ['14'], bestelltAm: '29.10.2026', ersatzCharge: '', goalie: 0 },
      48161: { stufe: 'teil', trikots: 2, da: 1, chargen: ['14'], bestelltAm: '29.10.2026', ersatzCharge: '', goalie: 0 },
      48163: { stufe: 'bestellt', trikots: 1, da: 0, chargen: ['14'], bestelltAm: '29.10.2026', ersatzCharge: '', goalie: 1 },
    },
    summen: { zeilen: aktiv.length, offen: offen.length, chargen: 2, entfernt: entfernt.length, goalieOffen: aktiv.filter(z => z.goalieOffen).length,
      da: aktiv.filter(z => z.da).length, hinweise: aktiv.filter(z => z.hinweise.length).length },
    ...(mitZahlung ? { zahlung: { unbezahlt: 1, erstattet: 1 } } : {}),
  };
}

// ── DTF-Korb (DT1) ─────────────────────────────────────────────────────────
const DTF_Z = (x) => ({ quelle: 'JFN', nummer: '48219', position: '9101', referenz: 'JFN-48219', druckposition: 'Brust', kuerzel: 'NL-Nordlicht',
  modell: 'HZ480', farbe: 'Black', groesse: 'M', menge: 1, express: false, status: 'offen', grund: '', notiz: '', hinweis: '', bestellung: '', druckId: '',
  angelegt: '2026-11-25', stand: '2026-11-25T08:00:00.000Z', mass: { breite: 22, hoehe: 11, fuehrend: 'breite', quelle: 'tabelle' }, massAmpel: 'ok',
  datei: { id: 'f-nl', name: 'Nordlicht_SW_White.png', pfad: 'Motive/NL-Nordlicht/Nordlicht_SW_White.png' }, dateiAmpel: 'ok', bereit: true, grundNicht: '', platzhalter: false, ...x,
  schluessel: `${x?.quelle ?? 'JFN'}:${x?.nummer ?? '48219'}:${x?.position ?? '9101'}:${x?.druckposition ?? 'Brust'}` });
const DTF_KORB = {
  einrichtung: { korb: true, dateien: true, protokoll: true }, ablage: true,
  einstellungen: { breiteCm: 57, verschnitt: 15, mindestCm: 200, start: '2026-11-25', scanBasis: true, tarif: { normal: { qmBruttoCent: 2100 }, express: { qmBruttoCent: 2900 } } },
  positionen: ['Brust', 'Brust links', 'Brust rechts', 'Rücken', 'Nacken', 'Ärmel links', 'Ärmel rechts', 'Vorderseite', 'Kapuze', 'Bein', 'Bein links', 'Bein rechts'],
  gruende: ['schon gedruckt', 'anderer Drucker', 'Kunde hat storniert', 'wird nicht gedruckt', 'Sonstiges'],
  lieferarten: { abholung: 'Abholung', versand_dhl: 'Versand DHL' },
  zeilen: [
    DTF_Z({}),
    DTF_Z({ nummer: '48190', position: '9022', referenz: 'JFN-48190', groesse: 'XXL', menge: 2 }),
    DTF_Z({ nummer: '48213', position: '9161', referenz: 'JFN-48213', kuerzel: 'VD-1921-Mein-Verein-mein-Dorf', modell: 'TX210', farbe: 'Deep Navy', groesse: 'XXL', druckposition: 'Rücken',
      menge: 3, mass: { breite: 28, hoehe: null, fuehrend: 'breite', quelle: 'tabelle' }, massAmpel: 'halb', datei: null, dateiAmpel: 'fehlt', bereit: false, grundNicht: 'mass', hinweis: 'Menge jetzt 4 · Namensdruck separat' }),
    DTF_Z({ nummer: '48212', position: '9173', referenz: 'JFN-48212', kuerzel: 'KK-Kicker', modell: 'KB150', farbe: 'Red', groesse: '5/6 (S)', druckposition: '', platzhalter: true,
      mass: null, massAmpel: 'fehlt', datei: null, dateiAmpel: 'fehlt', bereit: false, grundNicht: 'druckposition' }),
    DTF_Z({ quelle: 'AU', nummer: 'AU-2026-0041', position: 'AU-2026-0041-03', referenz: 'AU-2026-0041', kuerzel: 'Vereinswappen Blau-Weiß', modell: 'TX210', farbe: 'White', groesse: 'L',
      druckposition: 'Brust links', menge: 14, express: true, mass: { breite: 9, hoehe: 10.5, fuehrend: 'hoehe', quelle: 'hand' }, datei: { id: 'ent-7', name: 'wappen_final_v3.png', pfad: 'wappen_final_v3.png' } }),
    DTF_Z({ nummer: '48177', position: '8990', referenz: 'JFN-48177', status: 'abgewählt', grund: 'schon gedruckt', bereit: false, grundNicht: 'status' }),
    DTF_Z({ nummer: '48160', position: '8901', referenz: 'JFN-48160', status: 'bestellt', bestellung: 'DTF-2026-0002', druckId: 'DTF-2026-0002-01', bereit: false, grundNicht: 'status', hinweis: 'Bestellung storniert' }),
  ],
  bestellungen: [
    { id: 'DTF-2026-0003', erstellt: '2026-11-26T09:00:00.000Z', status: 'unklar', lieferart: 'abholung', express: false, positionen: 4, stueck: 9, laengeCm: 80, abgelegt: '', geliefert: '', hinweis: 'unklar: keine Antwort', haengt: false, nachricht: '' },
    { id: 'DTF-2026-0002', erstellt: '2026-11-25T14:00:00.000Z', status: 'abgelegt', lieferart: 'versand_dhl', express: false, positionen: 12, stueck: 31, laengeCm: 140, abgelegt: '2026-11-25T14:00:05.000Z', geliefert: '', hinweis: '', haengt: false,
      nachricht: 'Hallo Nico, neue DTF-Bestellung DTF-2026-0002 liegt im Ordner „Bestellungen“ (12 Motive, ≈ 1,4 m, Versand DHL). Danke!' },
    { id: 'DTF-2026-0001', erstellt: '2026-11-20T10:00:00.000Z', status: 'geliefert', lieferart: 'abholung', express: true, positionen: 2, stueck: 20, laengeCm: 60, abgelegt: '2026-11-20T10:00:04.000Z', geliefert: '2026-11-22', hinweis: '', haengt: false,
      nachricht: 'Hallo Nico, neue DTF-Bestellung DTF-2026-0001 liegt im Ordner „Bestellungen“ (2 Motive, ≈ 0,6 m, Abholung, Express). Danke!' },
  ],
  aelter: [{ quelle: 'JFN', nummer: '48101', datum: '2026-11-18', positionen: 2 }, { quelle: 'AU', nummer: 'AU-2026-0038', datum: '2026-11-12', positionen: 5 }],
  abgleich: { zeit: '2026-11-26T08:27:00.000Z', shopPositionen: 6, auPositionen: 1, neu: 2, hinweise: 1, aelter: 2 },
};
const DTF_ZUORDNEN = {
  schluessel: 'JFN:48213:9161:Rücken', quelle: 'JFN', referenz: 'JFN-48213', bezug: 'VD-1921-Mein-Verein-mein-Dorf', position: 'Rücken', modell: 'TX210', farbe: 'Deep Navy', groesse: 'XXL',
  geschwister: [
    { modell: 'TX210', farbe: 'Deep Navy', groesse: 'XXL', eigen: true, mass: { breite: 28, hoehe: null, fuehrend: 'breite' }, datei: null },
    ...['S', 'M', 'L', 'XL'].map(g => ({ modell: 'TX210', farbe: 'Deep Navy', groesse: g, eigen: false, mass: null, datei: null })),
    ...['S', 'M', 'L'].map(g => ({ modell: 'TX210', farbe: 'White', groesse: g, eigen: false, mass: null, datei: null })),
  ],
  verwendet: [{ id: 'f-vd1', name: 'Verein_1921_Ruecken_White.png', pfad: 'Motive/VD-1921/Verein_1921_Ruecken_White.png', breitePx: 2400, hoehePx: 2700, ablage: 'dtf', da: true }],
  entwuerfe: [], positionen: DTF_KORB.positionen, ablage: true,
};
const DTF_FEHLT = { liste: [
  { kuerzel: 'VD-1921-Mein-Verein-mein-Dorf', druckposition: 'Rücken', modell: 'TX210', farbe: 'Deep Navy', groesse: 'XXL', schluessel: 'JFN:48213:9161:Rücken', massFehlt: true, dateiFehlt: true, offen: 3, verkauft90: 17 },
  { kuerzel: 'KK-Kicker', druckposition: '', modell: 'KB150', farbe: 'Red', groesse: '5/6 (S)', schluessel: 'JFN:48212:9173:-', massFehlt: true, dateiFehlt: true, offen: 1, verkauft90: 4 },
], verkaufHinweis: '' };
const DTF_VORSCHAU = { ok: true, probleme: [], warnungen: [], express: false, anzahl: 2, stueck: 3,
  meter: { flaecheCm2: 726, laengeCm: 20, kostenBruttoCent: 239, kostenNettoCent: 201, mindestCm: 200, lohnt: false, fehltCm: 180, ohneMass: 0 }, kundenmotive: 0,
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<dtfBestellung id="DTF-2026-____" datum="2026-11-26" lieferart="abholung" express="nein">\n  <notiz><![CDATA[]]></notiz>\n  <position druckId="DTF-2026-____-01" datei="Motive/NL-Nordlicht/Nordlicht_SW_White.png" breite_mm="220" hoehe_mm="110" fuehrend="breite" anzahl="1" referenz="JFN-48219" kuerzel="NL-Nordlicht" druckposition="Brust"/>\n  <summe geschaetzteLaengeCm="20" breiteCm="57"/>\n</dtfBestellung>\n' };

// ── Anfragen & Eigenauftraege ───────────────────────────────────────────────
const ANFRAGEN = [
  { anfrageId: 'ANF-2026-0143', datum: '18.11.2026', kanal: 'Homepage', kundeName: 'Testverein Blau-Weiß Beispielstadt e. V. (Jugendabteilung)', kundeEmail: 'jugend@verein.example.test',
    produktBeschreibung: 'Trainingsanzüge mit Vereinswappen auf der Brust und Spielernummer hinten, Jacke + Hose, Größen 128 bis XXL, Lieferung vor der Winterpause gewünscht', menge: '38', varianten: '128–164 und S–XXL, Farbe Navy/Weiß', preisvorschlag: '', status: 'Neu', partnerId: '', wcOrderId: '',
    anmerkungenKunde: 'Wir bräuchten bis Mitte Dezember ein Angebot, der Vorstand tagt am 10.12.', notizIntern: '' },
  { anfrageId: 'ANF-2026-0142', datum: '15.11.2026', kanal: 'E-Mail', kundeName: 'Firma Musterbau GmbH', kundeEmail: 'einkauf@musterbau.example.test',
    produktBeschreibung: 'Arbeits-T-Shirts mit Logo', menge: '60', varianten: 'S–3XL', preisvorschlag: '12,50', status: 'Angebot-gesendet', partnerId: '', wcOrderId: '', anmerkungenKunde: '', notizIntern: 'Angebot AN-2026-0088 am 16.11. raus' },
  { anfrageId: 'ANF-2026-0139', datum: '04.11.2026', kanal: 'Manuell', kundeName: 'Kita Sonnenschein (Test)', kundeEmail: '',
    produktBeschreibung: 'Kinder-Hoodies mit Handabdrücken', menge: '22', varianten: '', preisvorschlag: '24', status: 'In-Produktion', partnerId: 'P-007', wcOrderId: '', anmerkungenKunde: '', notizIntern: '' },
  { anfrageId: 'ANF-2026-0120', datum: '12.10.2026', kanal: 'Homepage', kundeName: 'Erfundene Person', kundeEmail: 'x@example.test',
    produktBeschreibung: 'Einzelnes Shirt', menge: '1', varianten: '', preisvorschlag: '', status: 'Abgeschlossen', partnerId: '', wcOrderId: '47990', anmerkungenKunde: '', notizIntern: '' },
];
const INTERNE = [
  { rowId: 41, partnerId: 'P-003', partnerName: 'Fanclub Beispielkurve (Test)', datum: '17.11.2026', bezeichnung: 'Schals „Beispielkurve seit 1998“ Jacquard gewebt, beidseitig, 140 × 18 cm, mit Fransen', anzahl: 50, einzelpreis: 9.5, summe: 475, status: 'offen', kanal: 'Portal', fulfillment: 'Beauftragt' },
  { rowId: 40, partnerId: 'P-090', partnerName: null, datum: '10.11.2026', bezeichnung: 'Hoodies Teamausstattung', anzahl: 12, einzelpreis: 28, summe: 336, status: 'abgerechnet', kanal: 'Portal', fulfillment: 'Erledigt' },
  { rowId: 39, partnerId: 'P-003', partnerName: 'Fanclub Beispielkurve (Test)', datum: '02.11.2026', bezeichnung: 'Aufkleber', anzahl: 200, einzelpreis: 0.4, summe: 80, status: 'offen', kanal: 'Manuell', fulfillment: 'Beauftragt' },
];

// ── Einstieg ────────────────────────────────────────────────────────────────
export function antwort(method, pfad, params, body) {
  const m = String(method ?? 'GET').toUpperCase();
  const p = String(pfad ?? '').split('?')[0].replace(/\/+$/, '');
  const q = params instanceof URLSearchParams ? params : new URLSearchParams(params ?? '');

  if (m === 'GET' && p === '/api/woocommerce/orders') {
    const page = Number(q.get('page') ?? 1) || 1;
    if (page > 1) return [];
    const status = String(q.get('status') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    return status.length ? ORDERS.filter(o => status.includes(o.status)) : ORDERS;
  }
  if (m === 'POST' && p === '/api/bestellen/produktion/stand') return produktionStand(body);
  if (m === 'GET' && p === '/api/dtf/korb') return DTF_KORB;
  if (m === 'GET' && p === '/api/dtf/zuordnen') return DTF_ZUORDNEN;
  if (m === 'GET' && p === '/api/dtf/was-fehlt') return DTF_FEHLT;
  if (m === 'GET' && p === '/api/dtf/datei/suche') return { dateien: DTF_ZUORDNEN.verwendet };
  if (m === 'POST' && p === '/api/dtf/bestellung/vorschau') return DTF_VORSCHAU;
  if (m === 'GET' && /^\/api\/dtf\/scan\//.test(p)) return { id: 'DTF-2026-0002-01', art: 'motiv', bestellung: 'DTF-2026-0002', motive: [{ druckId: 'DTF-2026-0002-01', quelle: 'JFN', nummer: '48160',
    referenz: 'JFN-48160', kuerzel: 'NL-Nordlicht', druckposition: 'Brust', modell: 'HZ480', farbe: 'Black', groesse: 'M', menge: 1, status: 'bestellt', fuer: 'Erika' }] };
  if (m === 'GET' && p === '/api/bestellen/lshop-korb') return lshopKorb(q);
  if (m === 'GET' && p === '/api/bestellen/lshop-korb/modelle') return modelleSuche(q.get('q'));
  if (m === 'GET') {
    const v = /^\/api\/bestellen\/lshop-korb\/modelle\/([^/]+)\/varianten$/.exec(p);
    if (v) return modellVarianten(decodeURIComponent(v[1]));
  }
  if (m === 'POST' && p === '/api/bestellen/lshop-korb/edi/vorschau') return ediVorschau(body);
  if (m === 'GET' && p === '/api/bestellen/lshop-bestellungen') return lshopBestellungen();
  if (m === 'GET' && p === '/api/bestellen/rueckstand') return rueckstand();
  if (m === 'GET' && p === '/api/bestellen/trikots') return trikots(String(q.get('mit') ?? '').split(',').includes('zahlung'));
  if (m === 'GET' && p === '/api/anfragen') return ANFRAGEN;
  if (m === 'GET' && p === '/api/partner/interne-bestellungen') return INTERNE;
  return undefined;
}
