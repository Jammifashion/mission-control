// Attrappen-Antworten (erfundene Testdaten) fuer die Layout-Sichtpruefung UI1.
// antwort(method, pfad, params, body, seite) -> Objekt/Array (JSON 200) oder undefined (= nicht zustaendig).
// Alle Namen, Nummern, Betraege sind erfunden. Bilder zeigen auf beispiel.invalid (blockiert -> Platzhalter).

// ── Umschalter Bestellseite: 'dauer' (Fanshop mit Terminen) | 'auftrag' (KS6) ──
// Vorrang: Abfrage ?art=… am API-Aufruf (gibt es im echten Frontend nicht) > setzeBestellseiteArt() > FX_BS_ART > 'dauer'
export let bestellseiteArt = (globalThis.process?.env?.FX_BS_ART === 'auftrag') ? 'auftrag' : 'dauer';
export function setzeBestellseiteArt(art) { bestellseiteArt = art === 'auftrag' ? 'auftrag' : 'dauer'; return bestellseiteArt; }

const BILD = (datei, fit) => `https://i0.wp.com/beispiel.invalid/wp-content/uploads/2026/10/${datei}?fit=${fit}`;
const r2 = n => Math.round(n * 100) / 100;
const komma = n => r2(n).toFixed(2).replace('.', ',');

// ════════════════════════════════════════════════════════════════════════════
// Artikel (Maske, SEO, Lieferbarkeit, LS4)
// ════════════════════════════════════════════════════════════════════════════
const KATEGORIEN = [
  ['121', 'Fanartikel', 'Fanartikel'],
  ['122', 'Hoodies & Sweater', 'Fanartikel > Hoodies & Sweater'],
  ['123', 'T-Shirts', 'Fanartikel > T-Shirts'],
  ['124', 'Mützen, Schals und Accessoires für kalte Wintertage im Stadion', 'Fanartikel > Mützen, Schals und Accessoires für kalte Wintertage im Stadion'],
  ['293', 'Weihnachten', 'Weihnachten'],
  ['294', 'Weihnachtspullover', 'Weihnachten > Weihnachtspullover'],
  ['295', 'Christbaumkugeln', 'Weihnachten > Christbaumkugeln'],
  ['320', 'BoysLove', 'BoysLove'],
  ['321', 'Fanmeet', 'BoysLove > Fanmeet'],
  ['410', 'Vereinsbedarf', 'Vereinsbedarf'],
  ['411', 'Trainingsanzüge', 'Vereinsbedarf > Trainingsanzüge'],
  ['412', 'Taschen', 'Vereinsbedarf > Taschen'],
  ['500', 'Kinder', 'Kinder'],
  ['501', 'Babybodys', 'Kinder > Babybodys'],
].map(([nr, name, pfad]) => ({ Kategorienummer: nr, Kategoriename: name, Kategorien: pfad, Slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }));

const VERSANDKLASSEN = [
  { id: 41, slug: 'grossbrief', name: 'Großbrief', count: 212 },
  { id: 42, slug: 'paket', name: 'Paket', count: 388 },
  { id: 43, slug: 'warenpost', name: 'Warenpost', count: 37 },
  { id: 44, slug: 'sperrgut-sonderversand', name: 'Sperrgut / Sonderversand (Fahnen, Banner über 2 m)', count: 3 },
];

const ATTRIBUTE = [
  { eigenschaft: 'Farbe', begriffe: ['Black', 'White', 'Navy', 'Heather Grey', 'Bottle Green', 'Burgundy', 'Fire Red', 'Sky Blue', 'Light Oxford', 'Sun Yellow', 'Deep Purple', 'Charcoal Melange'] },
  { eigenschaft: 'Größe', begriffe: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '98/104', '110/116', '122/128', '134/146', '152/164'] },
  { eigenschaft: 'Druckfarbe', begriffe: ['Weiß', 'Schwarz', 'Gold metallic', 'Silber metallic', 'Neon-Gelb'] },
  { eigenschaft: 'Motiv', begriffe: ['Leuchtturm', 'Wappen klein', 'Wappen groß Rücken', 'Schriftzug Saison 2026/27'] },
];

const LIEFERZEITEN = [
  { id: '1201', name: 'sofort lieferbar', slug: 'sofort', standard: false },
  { id: '1202', name: '3–5 Werktage', slug: '3-5-werktage', standard: true },
  { id: '1203', name: '7–10 Werktage', slug: '7-10-werktage', standard: false },
  { id: '1204', name: 'Lieferzeit 3–4 Wochen (Produktion auf Bestellung, Druck in eigener Werkstatt)', slug: '3-4-wochen', standard: false },
];

const ENTWUERFE = [
  { artikelnummer: 'JFN-HO-1088', produktname: 'Premium Bio-Hoodie mit Kängurutasche und Stickerei „Nordlicht über dem Wattenmeer“ – Unisex', ssotId: 'SSOT-01088', row: 1090,
    data: { Produktname: 'Premium Bio-Hoodie mit Kängurutasche und Stickerei „Nordlicht über dem Wattenmeer“ – Unisex', Artikelkurzbezeichnung: 'NL-Nordlicht', 'L-Shop-Artikelnummer': 'JH001', Status: 'Entwurf' } },
  { artikelnummer: 'JFN-TS-1091', produktname: 'Kinder-T-Shirt Leuchtturm', ssotId: 'SSOT-01091', row: 1093,
    data: { Produktname: 'Kinder-T-Shirt Leuchtturm', Artikelkurzbezeichnung: 'NL-Leuchtturm', 'L-Shop-Artikelnummer': 'B190B', Status: 'Entwurf' } },
];

const SEO_OFFEN = [
  { artikelnummer: 'JFN-SW-0977', produktname: 'Weihnachtspullover „Rentier war ausverkauft“ aus Bio-Baumwolle mit gesticktem Schriftzug, Unisex', wcId: 18342, ssotId: 'SSOT-00977', row: 979, lshopNr: 'SG29', keyphrase: '', synonyme: '' },
  { artikelnummer: 'JFN-TA-0981', produktname: 'Tasse Fanmeet 2026', wcId: 18350, ssotId: 'SSOT-00981', row: 983, lshopNr: '', keyphrase: 'Fanmeet Tasse', synonyme: '' },
  { artikelnummer: '', produktname: 'Turnbeutel mit Vereinswappen (ohne Artikelnummer)', wcId: 18361, ssotId: 'SSOT-00990', row: 992, lshopNr: 'BG10', keyphrase: '', synonyme: '' },
];

function lieferbarkeitShop() {
  const v = (variationId, merkmale, articleNr, catalogNr, stufe, extra = {}) => ({ variationId, merkmale, articleNr, catalogNr, stufe, stock: null, nullSeit: '', auslaufdatum: '', tage: 0, lager: 'instock', rueckstandErlaubt: false, gruppe: '', vorschlag: 'beobachten', ...extra });
  const artikel = [
    { produktId: '18342', name: 'Weihnachtspullover „Rentier war ausverkauft“ aus Bio-Baumwolle mit gesticktem Schriftzug, Unisex', permalink: 'https://beispiel.invalid/produkt/weihnachtspullover-rentier/',
      kategorien: ['Weihnachtspullover'], gesamt: 24, lieferzeit: { id: '1203', name: '7–10 Werktage' }, farbenKomplett: ['Bottle Green'],
      variationen: [
        v('18343', 'Bottle Green · S', '1234500011', 'SG29', 'nicht_gefuehrt', { vorschlag: 'nicht mehr geführt – Variation über die Löschliste auf privat setzen' }),
        v('18344', 'Bottle Green · M', '1234500012', 'SG29', 'nicht_gefuehrt', { vorschlag: 'nicht mehr geführt – Variation über die Löschliste auf privat setzen', gruppe: 'vorraetig_problem' }),
        v('18345', 'Burgundy · XL', '1234500027', 'SG29', 'auslauf_null', { auslaufdatum: '2026-12-31', nullSeit: '2026-11-02', vorschlag: 'jetzt handeln: Nachfolger SG29 in Deep Purple ist lieferbar' }),
        v('18346', 'Navy · 3XL', '1234500038', 'SG29', 'null', { nullSeit: '2026-10-21', tage: 29, stock: 0, vorschlag: 'ab 30 Tagen Lieferzeit prüfen' }),
      ] },
    { produktId: '17710', name: 'Kinder-Kapuzenpullover Leuchtturm', permalink: 'https://beispiel.invalid/produkt/kinder-kapuzenpullover-leuchtturm/',
      kategorien: ['Hoodies & Sweater', 'Kinder'], gesamt: 10, lieferzeit: null, farbenKomplett: [],
      variationen: [
        v('17711', 'Sky Blue · 122/128', '1234600122', 'JH01J', 'auslauf', { auslaufdatum: '2027-02-28', stock: 41, vorschlag: 'beobachten' }),
        v('17712', 'Sky Blue · 134/146', '1234600134', 'JH01J', 'lieferbar', { stock: 260, lager: 'onbackorder', gruppe: 'rueckstand_lieferbar', vorschlag: 'zurück auf vorrätig' }),
      ] },
    { produktId: '16021', name: 'Turnbeutel mit Vereinswappen', permalink: '', kategorien: ['Taschen'], gesamt: 3, lieferzeit: { id: '1202', name: '' }, farbenKomplett: [],
      variationen: [v('16022', '', '1234700001', 'BG10', 'null', { nullSeit: '2026-10-30', tage: 20, stock: 0, lager: 'instock', rueckstandErlaubt: true, gruppe: 'vorraetig_problem', vorschlag: 'Rückstand oder privat?' })] },
  ];
  for (const a of artikel) { a.betroffen = a.variationen.length; a.schonNull = a.variationen.filter(x => x.stufe === 'auslauf_null').length; }
  return {
    artikel,
    zaehler: { artikel: artikel.length, variationen: artikel.reduce((s, a) => s + a.variationen.length, 0), lagerGelesen: true, shopStatusGeprueft: false, ausgeblendet: { privat: 0 } },
    stand: { datei: '2026-11-19T07:47:00.000Z', liste: '2026-11-12', listeAlt: false, listeTage: 7 },
    lagerHinweis: '',
  };
}

const LSM_LISTE = {
  einrichtung: [],
  eintraege: [
    { catalogNr: 'JH001', status: 'aktiv', inBestand: true, eingetragen: '12.11.2026', notiz: 'für Hoodie-Serie Nordlicht' },
    { catalogNr: 'SG29', status: 'aktiv', inBestand: false, eingetragen: '18.11.2026', notiz: 'Weihnachtspullover – Übernehmen steht noch aus, bitte nach dem Stammdaten-Update erneut prüfen' },
    { catalogNr: 'B190B', status: 'zurückgezogen', inBestand: true, eingetragen: '02.11.2026', notiz: '' },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// Kunden & Jey
// ════════════════════════════════════════════════════════════════════════════
const ANFRAGEN = [
  { anfrageId: 'ANF-2026-0148', datum: '19.11.2026', kanal: 'Homepage', kundeName: 'Testkunde Beispielverein e. V. – Abteilung Jugendfußball', kundeEmail: 'jugend@beispielverein.invalid',
    produktBeschreibung: '45 Trainingsanzüge mit Vereinswappen auf der Brust und Rückennummern, dazu Taschen mit Namensdruck für die Saison 2026/27', menge: '45', preisvorschlag: '12345.50',
    status: 'Neu', varianten: '10× 128, 15× 140, 12× 152, 8× S', partnerId: '', wcOrderId: '', anmerkungenKunde: 'Wäre schön, wenn alles bis Mitte Januar da ist. Wir können das Logo als Vektordatei schicken.', notizIntern: '' },
  { anfrageId: 'ANF-2026-0147', datum: '18.11.2026', kanal: 'E-Mail', kundeName: 'A. Muster', kundeEmail: 'a.muster@beispiel.invalid', produktBeschreibung: 'Hoodie mit eigenem Motiv', menge: '3',
    preisvorschlag: '', status: 'Geprüft', varianten: 'M, L, XL', partnerId: 'P-002', wcOrderId: '', anmerkungenKunde: '', notizIntern: 'Motiv kommt per Mail nach' },
  { anfrageId: 'ANF-2026-0139', datum: '11.11.2026', kanal: 'Manuell', kundeName: 'Beispiel-Kita Regenbogen', kundeEmail: '', produktBeschreibung: 'Kinder-T-Shirts für das Sommerfest', menge: '60',
    preisvorschlag: '540', status: 'Angebot-gesendet', varianten: '', partnerId: '', wcOrderId: '', anmerkungenKunde: '', notizIntern: '' },
  { anfrageId: 'ANF-2026-0121', datum: '28.10.2026', kanal: 'Homepage', kundeName: 'B. Beispiel', kundeEmail: 'b.beispiel@beispiel.invalid', produktBeschreibung: 'Tasse mit Foto', menge: '1',
    preisvorschlag: '19.9', status: 'Abgeschlossen', varianten: '', partnerId: '', wcOrderId: '21877', anmerkungenKunde: 'Danke!', notizIntern: '' },
];

const AGENT_WISSEN = [
  { typ: 'produkt', schluessel: 'druckverfahren', wert: 'DTF-Transfer für Textilien, Sublimation für Tassen', notiz: '' },
  { typ: 'produkt', schluessel: 'mindestmenge_eigenes_motiv', wert: '1 Stück, ab 10 Stück Staffelpreis', notiz: 'Stand Herbst 2026' },
  { typ: 'produkt', schluessel: 'lieferzeit_auftragsproduktion_mit_eigenem_motiv_und_individueller_beratung', wert: 'in der Regel 10–14 Werktage nach Freigabe des Entwurfs, in der Vorweihnachtszeit eher 3 Wochen', notiz: 'bitte vor jeder Saison prüfen' },
  { typ: 'ton', schluessel: 'anrede', wert: 'du', notiz: '' },
  { typ: 'ton', schluessel: 'laenge', wert: 'kurz, höchstens drei Sätze', notiz: '' },
  { typ: 'info', schluessel: 'oeffnungszeiten', wert: 'Mo–Fr 9–17 Uhr', notiz: '' },
];
const AGENT_PROMPT = {
  geruest: 'Du bist Jey, der Assistent von JammiFashion.\n\nProduktwissen:\n{{produkt}}\n\nTon:\n{{ton}}\n\nInfos:\n{{info}}',
  aufgeloest: 'Du bist Jey, der Assistent von JammiFashion.\n\nProduktwissen:\n- druckverfahren: DTF-Transfer für Textilien, Sublimation für Tassen\n- mindestmenge_eigenes_motiv: 1 Stück, ab 10 Stück Staffelpreis\n\nTon:\n- anrede: du\n- laenge: kurz, höchstens drei Sätze\n\nInfos:\n- oeffnungszeiten: Mo–Fr 9–17 Uhr',
  istOverride: true,
};

// ════════════════════════════════════════════════════════════════════════════
// Lizenz-Partner (MC + Portal)
// ════════════════════════════════════════════════════════════════════════════
const PARTNER = [
  { id: 'P-001', name: 'Kreativwerkstatt Nordlicht Illustration & Design GbR', kategorie: 'Fanartikel', lizenzProzent: 30, portoModell: 'geteilt-50-50', shop: 'jfn', aktiv: true, zugang: 'hash', kopierbar: true, vertragAb: '01.03.2025' },
  { id: 'P-002', name: 'Tiefseetaucher Comics', kategorie: 'BoysLove', lizenzProzent: 22.5, portoModell: 'partner-trägt', shop: 'jfn', aktiv: true, zugang: 'klartext', kopierbar: false, vertragAb: '' },
  { id: 'P-003', name: 'Muster Musikverlag', kategorie: '', lizenzProzent: 15, portoModell: 'geteilt-50-50', shop: 'jfn', aktiv: false, zugang: '', kopierbar: false, vertragAb: '' },
  { id: 'P-090', name: 'Honk Beispielpartner', kategorie: 'Weihnachten', lizenzProzent: 40, portoModell: 'geteilt-50-50', shop: 'honk', aktiv: true, zugang: 'hash', kopierbar: true, vertragAb: '15.09.2026' },
];
const KACHELN = {
  'P-001': { bestellungen: 1284, intern: 7, internOhneBetrag: 2, saldo: 12345.67, saldoKachel: true, seit: '01.10.2026' },
  'P-002': { bestellungen: 23, intern: 3, internOhneBetrag: 0, saldo: -418.4, saldoKachel: true, seit: '' },
  'P-003': { bestellungen: 0, intern: 0, internOhneBetrag: 0, saldo: 0, saldoKachel: true, seit: '' },
  'P-090': { bestellungen: 56, intern: 1, internOhneBetrag: 0, saldo: 980.1, saldoKachel: false, seit: '01.11.2026' },
};

const LZ_ARTIKEL = [
  'Premium Bio-Hoodie mit Kängurutasche und Stickerei „Nordlicht über dem Wattenmeer“ – Unisex',
  'T-Shirt Leuchtturm', 'Tasse Nordlicht 330 ml', 'Kinder-Kapuzenpullover Leuchtturm', 'Turnbeutel Wattenmeer',
];
function kalkVerkaeufe(partnerId, status) {
  const zeilen = [];
  const ids = partnerId ? [partnerId] : ['P-001', 'P-002'];
  let n = 0;
  for (const pid of ids) {
    for (let i = 0; i < (pid === 'P-001' ? 14 : 4); i++) {
      n++;
      const storno = i === 3;
      const st = storno ? -1 : (i % 4) + 1;
      const vk = r2((i % 2 ? 24.9 : 59.9) * st);
      const liz = r2(vk * 0.18);
      zeilen.push({ partnerId: pid, datum: `${String(19 - (i % 18)).padStart(2, '0')}.11.2026`, orderId: String(21900 - n), artikelnummer: `JFN-${pid === 'P-001' ? 'NL' : 'TC'}-${1000 + i}`,
        artikelname: LZ_ARTIKEL[i % LZ_ARTIKEL.length], variante: i % 3 ? 'Navy / L' : 'Heather Grey / 3XL', stueckzahl: st, vkPreisBrutto: vk, lizenzgebuehr: liz,
        status: i > 9 ? 'abgerechnet' : 'offen', storno, gewinnNetto: r2(vk * 0.6), lizenzAnteil: liz, portoSaldo: -1.25, anteilBrutto: r2(liz * 1.19) });
    }
  }
  return status ? zeilen.filter(z => z.status === status) : zeilen;
}
function lzAbrechnung(id, pid, von, bis, status, saldo, erstellt) {
  return {
    abrechnungId: id, partnerId: pid, zeitraumVon: von, zeitraumBis: bis, status, saldo, erstelltAm: erstellt,
    positionen: {
      mwstProzent: 19,
      verkaeufe: [
        { datum: '03.10.2026', orderId: '21401', artikelname: LZ_ARTIKEL[0], stueckzahl: 2, vkBrutto: 119.8, lizenz: 21.45,
          detail: { ek: 18.4, druck: 6.5, versandnebenkosten: 0.85, paypalKosten: 2.63, versandart: 'P', portoSaldoPartner: -1.25, gewinnNetto: 71.5, lizenzProzent: 30 } },
        { datum: '17.10.2026', orderId: '21533', artikelname: 'Tasse Nordlicht 330 ml', stueckzahl: 1, vkBrutto: 19.9, lizenz: 3.12, detail: null },
      ],
      intern: [{ datum: '20.10.2026', bezeichnung: 'Messe-Ware: 20 T-Shirts Leuchtturm für den Stand auf dem Comic-Markt', anzahl: 20, einzelpreis: 9.5, summe: 190 }],
    },
  };
}
const LZ_ABRECHNUNGEN = [
  lzAbrechnung('ABR-2026-0031', 'P-001', '01.10.2026', '31.10.2026', 'entwurf', 10234.56, '05.11.2026'),
  lzAbrechnung('ABR-2026-0027', 'P-001', '01.09.2026', '30.09.2026', 'freigegeben', 8765.43, '04.10.2026'),
  lzAbrechnung('ABR-2026-0022', 'P-001', '01.08.2026', '31.08.2026', 'bezahlt', 11002.1, '03.09.2026'),
  lzAbrechnung('ABR-2026-0025', 'P-002', '01.07.2026', '30.09.2026', 'bezahlt', -84.2, '06.10.2026'),
];
const LZ_INTERN = [
  { rowId: 12, datum: '20.10.2026', bezeichnung: 'Messe-Ware: 20 T-Shirts Leuchtturm für den Stand auf dem Comic-Markt', anzahl: 20, einzelpreis: 9.5, summe: 190, status: 'abgerechnet' },
  { rowId: 15, datum: '12.11.2026', bezeichnung: 'Muster Hoodie Nordlicht (2×) und Tassen (6×)', anzahl: 8, einzelpreis: 14.25, summe: 114, status: 'offen' },
  { rowId: 16, datum: '18.11.2026', bezeichnung: 'Nachdruck Aufkleberbögen', anzahl: 250, einzelpreis: 0, summe: 0, status: 'offen' },
];
const PARTNER_ARTIKEL = [
  { artikelnummer: 'JFN-NL-1000', produktId: '17001', artikelname: LZ_ARTIKEL[0], ekPreis: 18.4, druckkosten: 6.5, versandart: 'P', lizenzProzent: 30 },
  { artikelnummer: 'JFN-NL-1001', produktId: '17002', artikelname: 'T-Shirt Leuchtturm', ekPreis: 3.95, druckkosten: 3.2, versandart: 'B', lizenzProzent: 30 },
  { artikelnummer: 'JFN-NL-1002', produktId: '17003', artikelname: 'Tasse Nordlicht 330 ml', ekPreis: null, druckkosten: null, versandart: 'P', lizenzProzent: 0 },
  { artikelnummer: 'JFN-NL-1003', produktId: '17004', artikelname: 'Kinder-Kapuzenpullover Leuchtturm', ekPreis: 0, druckkosten: 4.1, versandart: 'P', lizenzProzent: 30 },
];
const FIXKOSTEN = [
  { position: 'Versandnebenkosten B', betrag: 0.35, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'Versandnebenkosten P', betrag: 0.85, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'Herstellungsnebenkosten', betrag: 0.6, einheit: 'EUR/Artikel', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'Porto B', betrag: 1.8, einheit: 'EUR/Bestellung', gueltigAb: '01.07.2026', gueltigBis: '', bekannt: true },
  { position: 'Porto B', betrag: 1.6, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2026', gueltigBis: '30.06.2026', bekannt: true },
  { position: 'Porto P', betrag: 4.99, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'PayPal Prozent', betrag: 2.49, einheit: '%', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'PayPal Pauschale', betrag: 0.35, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'MwSt', betrag: 19, einheit: '%', gueltigAb: '01.01.2026', gueltigBis: '', bekannt: true },
  { position: 'Verpackungsmaterial Sondergrößen (alte Position, nicht mehr gerechnet)', betrag: 0.4, einheit: 'EUR/Bestellung', gueltigAb: '01.01.2025', gueltigBis: '', bekannt: false },
];
const DRUCKPREISE = [
  { druckposition: 'Brust links', groesse: 'A6', preisNetto: 2.4, gueltigAb: '01.01.2026' },
  { druckposition: 'Rücken', groesse: 'A3', preisNetto: 6.5, gueltigAb: '01.01.2026' },
  { druckposition: 'Ärmel', groesse: '8 × 8 cm', preisNetto: 1.9, gueltigAb: '01.07.2026' },
];
const VERKAUFSPREISE = [
  { produkttyp: 'T-Shirt', abMenge: 1, vkBrutto: 24.9, gueltigAb: '01.01.2026', notiz: '' },
  { produkttyp: 'T-Shirt', abMenge: 10, vkBrutto: 19.9, gueltigAb: '01.01.2026', notiz: 'Staffel' },
  { produkttyp: 'Hoodie', abMenge: 1, vkBrutto: 59.9, gueltigAb: '01.01.2026', notiz: 'Bio-Qualität, Stickerei gegen Aufpreis' },
];
const KALK_ARTIKEL = [
  { lshopNr: 'JH001', artikelname: 'College Hoodie', ekPreisNetto: 14.85, kategorie: 'Hoodie', gueltigAb: '01.01.2026', notiz: '' },
  { lshopNr: 'B190', artikelname: 'Exact 190 T-Shirt', ekPreisNetto: 2.95, kategorie: 'T-Shirt', gueltigAb: '01.01.2026', notiz: '' },
];

// Portal (partner.html) = Sicht von P-001
const PORTAL_LZ = 'P-001';

// ════════════════════════════════════════════════════════════════════════════
// Festpreis-Partner (MC + Portal)
// ════════════════════════════════════════════════════════════════════════════
const FP_PARTNER = [
  { 'Partner-ID': 'FP-001', Name: 'Illustrationsstudio Sternenstaub Kinderbuchkunst', Shop: 'jfn', Aktiv: 'ja', Notiz: 'Abrechnung monatlich, Porto ab 01.07. je Bestellung', Kategorien: '121,122,123', _zugang: 'hash', _kopierbar: true },
  { 'Partner-ID': 'FP-002', Name: 'Beispiel Merch', Shop: 'jfn', Aktiv: 'ja', Notiz: '', Kategorien: '320,321', _zugang: 'klartext', _kopierbar: false },
  { 'Partner-ID': 'FP-003', Name: 'Honk Festpreis Muster', Shop: 'honk', Aktiv: 'nein', Notiz: '', Kategorien: '', _zugang: '', _kopierbar: false },
];
const FP_KATEGORIEN = ['T-Shirt', 'Hoodie', 'Tasse', 'Kinder-T-Shirt', 'Babybody', 'Turnbeutel'];
const FP_ART = [
  ['18101', 'Kinder-T-Shirt Sternenstaub „Kleiner Drache sucht den Mond und findet dabei viele neue Freunde“', 'Kinder > T-Shirts', 'B', 'Kinder-T-Shirt'],
  ['18102', 'Hoodie Sternenstaub', 'Hoodies & Sweater', 'P', 'Hoodie'],
  ['18103', 'Tasse Sternenstaub', 'Fanartikel', 'P', 'Tasse'],
  ['18104', 'Babybody Mondschein', 'Kinder > Babybodys', 'B', ''],
  ['18105', 'Turnbeutel Sternenstaub', 'Vereinsbedarf > Taschen', 'B', 'Rucksack'],
];
const fpArtikel = pid => (pid === 'FP-001' ? FP_ART : FP_ART.slice(2, 4)).map(([id, name, wc, va, ak]) => ({ 'Produkt-ID': id, Artikelname: name, 'WC-Kategorie': wc, Versandart: va, Artikelkategorie: ak, 'Partner-ID': pid }));
function fpVerkaeufe(partnerId, status) {
  const zeilen = [];
  const ids = partnerId ? [partnerId] : ['FP-001', 'FP-002'];
  let rowId = 200;
  for (const pid of ids) {
    for (let i = 0; i < (pid === 'FP-001' ? 12 : 3); i++) {
      rowId++;
      const [prodId, name, , , ak] = FP_ART[i % FP_ART.length];
      const gesperrt = pid === 'FP-002' && i === 1;
      const storno = i === 5;
      const st = storno ? -1 : 1 + (i % 3);
      const vk = r2((i % 2 ? 16.72 : 41.93) * st);
      const fest = gesperrt ? '' : komma(8.5 * st), hand = gesperrt ? '' : komma(1.2 * st);
      zeilen.push({ _rowId: rowId, 'Partner-ID': pid, Datum: `${String(18 - (i % 17)).padStart(2, '0')}.11.2026`, 'WC-Bestellnummer': String(21950 - rowId), 'Produkt-ID': prodId,
        Artikelname: name, Variante: i % 2 ? '122/128' : 'Navy / M', 'Stückzahl': String(st), Artikelkategorie: gesperrt ? '' : ak, 'VK-Netto': komma(vk), Festpreis: fest, Handlingskosten: hand,
        Mehrkosten: i === 2 ? '2,50' : '0', 'Gesamt-Partner-Netto': gesperrt ? '' : komma(vk - 8.5 * st - 1.2 * st), 'Gesamt-Partner-Brutto': gesperrt ? '' : komma((vk - 9.7 * st) * 1.19),
        'Status Abrechnung': gesperrt ? 'gesperrt' : i > 8 ? 'abgerechnet' : 'offen', 'Storno-Status': storno ? 'storniert' : '', Sperre: gesperrt ? 'Festpreis-Kategorie fehlt' : '' });
    }
  }
  return status ? zeilen.filter(z => z['Status Abrechnung'] === status) : zeilen;
}
function fpSummary(partnerId) {
  const gruppen = FP_ART.slice(0, 4).map(([produktId, artikelname, , , artikelkategorie], i) => {
    const stueck = [380, 120, 640, 5][i];
    const vkNetto = r2(stueck * [16.72, 41.93, 12.6, 11.76][i]);
    const festpreisGesamt = artikelkategorie ? r2(stueck * 8.5) : 0;
    const handlingGesamt = r2(stueck * 1.2), paypalGesamt = r2(vkNetto * 0.029), mehrkosten = i === 1 ? 7.5 : 0;
    const portoEinnahmen = 0, portoKosten = 0;
    return { produktId, artikelname, artikelkategorie, stueckzahl: stueck, vkNetto, festpreisGesamt, handlingGesamt, mehrkosten, portoEinnahmen, portoKosten, paypalGesamt,
      auszahlung: r2(vkNetto - festpreisGesamt - handlingGesamt - mehrkosten - paypalGesamt) };
  });
  const summen = {};
  for (const k of ['stueckzahl', 'vkNetto', 'festpreisGesamt', 'handlingGesamt', 'mehrkosten', 'portoEinnahmen', 'portoKosten', 'paypalGesamt', 'auszahlung']) summen[k] = r2(gruppen.reduce((s, g) => s + g[k], 0));
  const porto = { status: 'ok', einnahmen: { anzahl: 131, summe: 512.48 }, kosten: { anzahl: 131, paket: 18, summe: 341.22 }, saldo: 171.26, abholung: 4, ohneVersand: 1, hinweise: [] };
  const intern = [{ datum: '07.11.2026', bezeichnung: 'Direktbestellung Lesung Stadtbücherei: 30 Kinder-T-Shirts', anzahl: 30, einzelpreis: 11.9, summe: 357 }];
  const auszahlungNetto = r2(summen.auszahlung + porto.saldo), auszahlungBrutto = r2(auszahlungNetto * 1.19);
  const verpackung = { status: 'ok', anzahl: 127, betrag: 0.5, summe: 63.5, abholung: 4, vorAb: 0, ab: '01.07.2026', hinweise: [] };
  const interneSumme = 357;
  const gesamtBrutto = r2(auszahlungBrutto - interneSumme - verpackung.summe);
  return { partnerId: partnerId || '', positionen: 1145, produkteGruppen: gruppen, summen, porto, intern, interneSumme, mwstProzent: 19, verpackung,
    auszahlungNetto, auszahlungBrutto, gesamtBrutto, gesamtNetto: r2(gesamtBrutto / 1.19), sperre: { hinweise: [] }, klaeren: [] };
}
function fpAbrechnungen(partnerId) {
  const s = fpSummary('FP-001');
  const pos = JSON.stringify({ produkteGruppen: s.produkteGruppen, summen: s.summen, porto: s.porto, verpackung: s.verpackung, intern: s.intern, interneSumme: s.interneSumme });
  const alle = [
    { 'Abrechnungs-ID': 'FPA-2026-0019', 'Partner-ID': 'FP-001', 'Zeitraum-Von': '01.10.2026', 'Zeitraum-Bis': '31.10.2026', 'Gesamt-Netto': 10512.34, 'Gesamt-Brutto': 12509.68, Status: 'entwurf', 'Erstellt-Am': '04.11.2026', Positionen: pos },
    { 'Abrechnungs-ID': 'FPA-2026-0015', 'Partner-ID': 'FP-001', 'Zeitraum-Von': '01.09.2026', 'Zeitraum-Bis': '30.09.2026', 'Gesamt-Netto': 9876.5, 'Gesamt-Brutto': 11753.04, Status: 'freigegeben', 'Erstellt-Am': '03.10.2026', Positionen: pos },
    { 'Abrechnungs-ID': 'FPA-2026-0009', 'Partner-ID': 'FP-001', 'Zeitraum-Von': '01.06.2026', 'Zeitraum-Bis': '31.08.2026', 'Gesamt-Netto': 412.7, 'Gesamt-Brutto': 491.11, Status: 'bezahlt', 'Erstellt-Am': '02.09.2026', Positionen: '' },
    { 'Abrechnungs-ID': 'FPA-2026-0011', 'Partner-ID': 'FP-002', 'Zeitraum-Von': '01.07.2026', 'Zeitraum-Bis': '30.09.2026', 'Gesamt-Netto': 88.4, 'Gesamt-Brutto': 105.2, Status: 'bezahlt', 'Erstellt-Am': '05.10.2026', Positionen: '' },
  ];
  return partnerId ? alle.filter(a => a['Partner-ID'] === partnerId) : alle;
}
const FP_PREISE = [
  { _rowId: 2, Kategorie: 'T-Shirt', 'Festpreispartner-ID': 'FP-001', Festpreis: '8,50', Handlingskosten: '1,20' },
  { _rowId: 3, Kategorie: 'Hoodie', 'Festpreispartner-ID': 'FP-001', Festpreis: '19,00', Handlingskosten: '1,20' },
  { _rowId: 4, Kategorie: 'Kinder-T-Shirt', 'Festpreispartner-ID': 'FP-001', Festpreis: '7,90', Handlingskosten: '1,20' },
  { _rowId: 5, Kategorie: 'Tasse', 'Festpreispartner-ID': 'FP-002', Festpreis: '0', Handlingskosten: '0,80' },
];
const FP_INTERN = [
  { rowId: 31, datum: '07.11.2026', bezeichnung: 'Direktbestellung Lesung Stadtbücherei: 30 Kinder-T-Shirts', anzahl: 30, einzelpreis: 11.9, summe: 357, status: 'offen' },
  { rowId: 27, datum: '02.10.2026', bezeichnung: 'Tassen für Signierstunde', anzahl: 12, einzelpreis: 8.5, summe: 102, status: 'abgerechnet' },
];
const PORTAL_FP = 'FP-001';

// ════════════════════════════════════════════════════════════════════════════
// Lager
// ════════════════════════════════════════════════════════════════════════════
const LAGER_ORTE = [
  { ort: 'Wrist', status: 'aktiv', notiz: 'Hauptlager' },
  { ort: 'Itzehoe', status: 'aktiv', notiz: '' },
  { ort: 'Messe-Lagerbox Halle 3 (Regal hinten links)', status: 'aktiv', notiz: '' },
  { ort: 'Altes Lager', status: 'inaktiv', notiz: '' },
];
const LP = (warenart, schluessel, modell, name, farbe, groesse, ort, menge, hinweis = '') => ({ schluessel, ort, warenart, menge, letzte: '2026-11-18T10:12:00.000Z', modell, name, farbe, groesse, hinweis });
const LAGER_POSTEN = [
  ...['S', 'M', 'L', 'XL', '2XL', '3XL'].map((g, i) => LP('rohling', `LS:12345000${10 + i}`, 'JH001', 'College Hoodie', 'Navy', g, 'Wrist', [4, 12, 15, 9, 3, 1][i])),
  ...['M', 'L'].map((g, i) => LP('rohling', `LS:12345000${12 + i}`, 'JH001', 'College Hoodie', 'Navy', g, 'Itzehoe', [2, 0][i])),
  ...['98/104', '110/116', '122/128', '134/146', '152/164'].map((g, i) => LP('rohling', `LS:12346001${20 + i}`, 'JH01J', 'Kids Hoodie', 'Sky Blue', g, 'Wrist', [6, 8, 11, 5, 2][i])),
  ...['S', 'M', 'L', 'XL'].map((g, i) => LP('fertig', `WC:1834${3 + i}`, 'Weihnachtspullover „Rentier war ausverkauft“ aus Bio-Baumwolle mit gesticktem Schriftzug, Unisex', '', 'Bottle Green', g, 'Messe-Lagerbox Halle 3 (Regal hinten links)', [3, 7, 6, 2][i])),
  LP('trikot', 'TR:40112:M', 'Heimtrikot 2026/27 Herren', '', '', 'M', 'Wrist', 4),
  LP('trikot', 'TR:40112:XL', 'Heimtrikot 2026/27 Herren', '', '', 'XL', 'Wrist', 1),
  LP('fremd', 'EX:BAG-7781', 'Jutebeutel natur 38 × 42 cm', '', 'natur', '', 'Itzehoe', 120),
  LP('frei', 'FREI:LA-0004', 'Aufkleberbogen Leuchtturm A5', '', '', '', 'Wrist', 850),
  LP('fertig', 'WC:16999', 'Variante 16999', '', '', '', 'Wrist', 2, 'Variante nicht mehr gepflegt'),
];
const LV = (id, datum, art, warenart, schluessel, menge, ort, extra, beschr) => ({ id, datum, art, artText: LAGER_ART_TEXT[art] ?? art, warenart, schluessel, menge, ort, grund: '', bezug: '', quelle: 'knopf', notiz: '', stornoVon: '', gegengebucht: false, gegenbuchbar: true, ...extra, ...beschr });
const LAGER_ART_TEXT = {
  vorrat: 'Vorratskauf', zugang_ueberschuss: 'Überschuss Wareneingang', retoure: 'Retoure vom Kunden', storno: 'Storno', inventur: 'Zählung', abgang_shop: 'Shop-Bestellung',
  abgang_vorort: 'Verkauf vor Ort / Event', abgang_auftrag: 'eigener Auftrag', abgang_partner: 'Partner / Muster', abgang_eigen: 'eigene Korb-Position', umlagerung: 'Umlagerung', korrektur: 'Gegenbuchung', abgang_ausschuss: 'Ausschuss',
};
const HOODIE = g => ({ modell: 'JH001', name: 'College Hoodie', farbe: 'Navy', groesse: g, hinweis: '' });
const LAGER_VERLAUF = [
  LV('LB-2026-00412', '2026-11-19T09:41:00.000Z', 'abgang_shop', 'rohling', 'LS:1234500012', -1, 'Wrist', { quelle: 'korb', bezug: 'JFN:21893:4411', gegenbuchbar: false }, HOODIE('M')),
  LV('LB-2026-00411', '2026-11-18T15:02:00.000Z', 'abgang_auftrag', 'rohling', 'LS:1234500013', -5, 'Wrist', { quelle: 'auftrag', bezug: 'AU-2026-0137', notiz: 'AU-2026-0137-02', gegenbuchbar: false }, HOODIE('L')),
  LV('LB-2026-00410', '2026-11-18T11:20:00.000Z', 'vorrat', 'rohling', 'LS:1234500012', 12, 'Wrist', { quelle: 'wareneingang', bezug: 'JFN-2026-0031:EIGEN:2026-0044', grund: 'Wareneingang JFN-2026-0031' }, HOODIE('M')),
  LV('LB-2026-00409', '2026-11-17T16:45:00.000Z', 'abgang_vorort', 'fertig', 'WC:18344', -4, 'Messe-Lagerbox Halle 3 (Regal hinten links)', { bezug: 'EV-0007' }, { modell: 'Weihnachtspullover „Rentier war ausverkauft“ aus Bio-Baumwolle mit gesticktem Schriftzug, Unisex', name: '', farbe: 'Bottle Green', groesse: 'M', hinweis: '' }),
  LV('LB-2026-00408', '2026-11-16T10:00:00.000Z', 'umlagerung', 'rohling', 'LS:1234500013', -3, 'Itzehoe', { bezug: 'LB-2026-00407', gegenbuchbar: true }, HOODIE('L')),
  LV('LB-2026-00407', '2026-11-16T10:00:00.000Z', 'umlagerung', 'rohling', 'LS:1234500013', 3, 'Wrist', { bezug: 'LB-2026-00408' }, HOODIE('L')),
  LV('LB-2026-00406', '2026-11-14T13:30:00.000Z', 'retoure', 'fertig', 'WC:18345', 1, 'Wrist', { bezug: 'JFN:21780:4302', grund: 'Größe passt nicht' }, { modell: 'Weihnachtspullover', name: '', farbe: 'Burgundy', groesse: 'L', hinweis: '' }),
  LV('LB-2026-00405', '2026-11-12T08:15:00.000Z', 'abgang_ausschuss', 'rohling', 'LS:1234500011', -2, 'Wrist', { bezug: 'Fehldruck', grund: 'Rückendruck verrutscht, Transfer zu weit oben aufgebracht – nicht verkaufbar', gegengebucht: true, gegenbuchbar: false }, HOODIE('S')),
  LV('LB-2026-00404', '2026-11-12T08:20:00.000Z', 'korrektur', 'rohling', 'LS:1234500011', 2, 'Wrist', { stornoVon: 'LB-2026-00405', gegenbuchbar: false, grund: 'versehentlich gebucht' }, HOODIE('S')),
  LV('LB-2026-00403', '2026-11-10T09:00:00.000Z', 'abgang_partner', 'fremd', 'EX:BAG-7781', -30, 'Itzehoe', { bezug: 'P-001' }, { modell: 'Jutebeutel natur 38 × 42 cm', name: '', farbe: 'natur', groesse: '', hinweis: '' }),
  LV('LB-2026-00402', '2026-11-05T12:00:00.000Z', 'inventur', 'frei', 'FREI:LA-0004', 850, 'Wrist', { quelle: 'start', grund: 'Startbestand' }, { modell: 'Aufkleberbogen Leuchtturm A5', name: '', farbe: '', groesse: '', hinweis: '' }),
  LV('LB-2026-00401', '2026-11-04T12:00:00.000Z', 'vorrat', 'trikot', 'TR:40112:M', 4, 'Wrist', { quelle: 'wareneingang', bezug: '40112|7|2', grund: 'ersetzt, beflockt', notiz: 'beflockt' }, { modell: 'Heimtrikot 2026/27 Herren', name: '', farbe: '', groesse: 'M', hinweis: '' }),
];
const LAGER_EVENTS = [
  { id: 'EV-0007', name: 'Weihnachtsmarkt Innenstadt', datum: '2026-11-17', ort: 'Messe-Lagerbox Halle 3 (Regal hinten links)', status: 'offen', notiz: '' },
  { id: 'EV-0006', name: 'Comic-Markt Herbst', datum: '2026-10-24', ort: 'Wrist', status: 'abgeschlossen', notiz: '' },
];
const LAGER_PARTNER = PARTNER.filter(p => p.aktiv).map(p => ({ id: p.id, name: p.name }));
function lagerBestand() {
  return {
    einrichtung: [], events: LAGER_EVENTS, eventVorschlag: 'EV-0007', eventsDa: true, partner: LAGER_PARTNER, musterPraefix: 'Muster: ',
    posten: LAGER_POSTEN, verlauf: LAGER_VERLAUF, orte: LAGER_ORTE,
    artikel: [{ laNr: 'LA-0004', bezeichnung: 'Aufkleberbogen Leuchtturm A5', warenart: 'sonstiges', modell: '', farbe: '', groesse: '', status: 'aktiv' }],
    arten: { zugang: ['vorrat', 'zugang_ueberschuss', 'retoure', 'storno'], abgang: ['abgang_vorort', 'abgang_auftrag', 'abgang_partner', 'abgang_shop', 'abgang_ausschuss'], text: LAGER_ART_TEXT, ausschussGruende: ['Fehldruck', 'Ware defekt', 'verschenkt'] },
    artikelWarenarten: ['rohling', 'fertig', 'trikot', 'fremd', 'sonstiges'], mengeMax: 9999,
    hinweise: [], buchungen: LAGER_VERLAUF.length, stand: '2026-11-19T09:45:00.000Z',
  };
}
function lagerAbgaenge(params) {
  const filter = { art: params?.get('art') || '', bezug: params?.get('bezug') || '', von: params?.get('von') || '', bis: params?.get('bis') || '' };
  let posten = [
    { schluessel: 'LS:1234500013', warenart: 'rohling', menge: 5, ort: '', ...HOODIE('L'), _art: 'abgang_auftrag' },
    { schluessel: 'LS:1234500012', warenart: 'rohling', menge: 1, ort: '', ...HOODIE('M'), _art: 'abgang_shop' },
    { schluessel: 'WC:18344', warenart: 'fertig', menge: 4, ort: '', modell: 'Weihnachtspullover „Rentier war ausverkauft“ aus Bio-Baumwolle mit gesticktem Schriftzug, Unisex', name: '', farbe: 'Bottle Green', groesse: 'M', hinweis: '', _art: 'abgang_vorort' },
    { schluessel: 'WC:18345', warenart: 'fertig', menge: 2, ort: '', modell: 'Weihnachtspullover „Rentier war ausverkauft“ aus Bio-Baumwolle mit gesticktem Schriftzug, Unisex', name: '', farbe: 'Bottle Green', groesse: 'L', hinweis: '', _art: 'abgang_vorort' },
    { schluessel: 'EX:BAG-7781', warenart: 'fremd', menge: 30, ort: '', modell: 'Jutebeutel natur 38 × 42 cm', name: '', farbe: 'natur', groesse: '', hinweis: '', _art: 'abgang_partner' },
  ];
  if (filter.art) posten = posten.filter(p => p._art === filter.art);
  posten = posten.map(({ _art, ...p }) => p);
  return {
    einrichtung: [], filter, stueck: posten.reduce((s, p) => s + p.menge, 0), buchungen: posten.length,
    bezuege: [{ art: 'abgang_vorort', bezug: 'EV-0007', stueck: 6 }, { art: 'abgang_auftrag', bezug: 'AU-2026-0137', stueck: 5 }, { art: 'abgang_partner', bezug: 'P-001', stueck: 30 },
      { art: 'abgang_partner', bezug: 'Muster: Agentur Beispiel', stueck: 0 }, { art: 'abgang_shop', bezug: 'JFN:21893:4411', stueck: 1 }],
    posten, events: LAGER_EVENTS, partner: LAGER_PARTNER, artText: LAGER_ART_TEXT, ausschussGruende: ['Fehldruck', 'Ware defekt', 'verschenkt'],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Bestellseite (bestellen.html)
// ════════════════════════════════════════════════════════════════════════════
const BS_GR_ERW = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
const BS_GR_KIND = ['98/104', '110/116', '122/128', '134/146', '152/164'];
const STUFEN = ['lieferbar', 'lieferbar', 'lieferbar', 'null', 'auslauf', 'auslauf_null', 'nicht_gefuehrt', 'lieferbar', ''];
function bsKarte(i, name, farbe, gruppen, groessen, { design, motiv, bild = true, besorgen = false } = {}) {
  const datei = `bestellseite-${i}.jpg`;
  const gr = groessen.map((g, j) => ({ groesse: g, id: besorgen ? `F${i}-${j}` : String(19000 + i * 20 + j), articleNr: besorgen ? '' : String(1234560000 + i * 20 + j),
    lieferbar: besorgen ? '' : STUFEN[(i + j) % STUFEN.length], nochZuBesorgen: besorgen }));
  return { key: `K${i}`, name, farbe, ...(design ? { design } : {}), ...(motiv ? { motiv } : {}),
    bild: bild ? BILD(datei, 120) : '', bildGross: bild ? BILD(datei, 600) : '', gruppen, groessen: gr, nochZuBesorgen: besorgen };
}
function bsArtikelDauer() {
  return [
    bsKarte(1, 'Premium Bio-Hoodie mit Kängurutasche und Vereinswappen „Seit 1921 gemeinsam am Ball“ – Unisex', 'Navy', ['Hoodies & Sweater'], BS_GR_ERW, { design: 'Wappen groß Rücken' }),
    bsKarte(2, 'Premium Bio-Hoodie mit Kängurutasche und Vereinswappen „Seit 1921 gemeinsam am Ball“ – Unisex', 'Heather Grey', ['Hoodies & Sweater'], BS_GR_ERW, { design: 'Wappen groß Rücken' }),
    bsKarte(3, 'Kinder-Hoodie Wappen', 'Fire Red', ['Hoodies & Sweater', 'Kinder'], BS_GR_KIND),
    bsKarte(4, 'T-Shirt Schriftzug Saison 2026/27', 'White', ['T-Shirts'], BS_GR_ERW.slice(0, 7)),
    bsKarte(5, 'T-Shirt Schriftzug Saison 2026/27', 'Black', ['T-Shirts'], BS_GR_ERW.slice(0, 7), { bild: false }),
    bsKarte(6, 'Trainingsjacke mit Stehkragen und reflektierenden Streifen an den Ärmeln für Abendtraining', 'Charcoal Melange / Fire Red', ['Trainingsanzüge'], BS_GR_ERW.slice(1, 8)),
    bsKarte(7, 'Trainingshose', 'Black', ['Trainingsanzüge'], [...BS_GR_KIND, ...BS_GR_ERW.slice(1, 6)]),
    bsKarte(8, 'Strickmütze mit Umschlag', 'Navy', ['Mützen, Schals und Accessoires für kalte Wintertage im Stadion'], ['']),
    bsKarte(9, 'Fanschal Jacquard „Gemeinsam stark“ 140 × 18 cm', 'Navy / White', ['Mützen, Schals und Accessoires für kalte Wintertage im Stadion'], ['']),
    bsKarte(10, 'Sporttasche mit Schuhfach', 'Black', ['Taschen'], [''], { besorgen: true }),
    bsKarte(11, 'Turnbeutel', 'Natur', ['Taschen'], [''], { motiv: 'Wappen klein' }),
    bsKarte(12, 'Regenjacke Coach', 'Bottle Green', ['Trainingsanzüge'], ['S', 'M', 'L', 'XL', '2XL'], { besorgen: true }),
  ];
}
function bsArtikelAuftrag() {
  return [
    bsKarte(21, 'Klassen-Hoodie „Abschlussfahrt 2027 – wir waren dabei“ mit allen Namen auf dem Rücken', 'Deep Purple', [], BS_GR_ERW.slice(0, 7), { motiv: 'Klassenmotiv Rücken' }),
    bsKarte(22, 'Klassen-Hoodie „Abschlussfahrt 2027 – wir waren dabei“ mit allen Namen auf dem Rücken', 'Black', [], BS_GR_ERW.slice(0, 7), { motiv: 'Klassenmotiv Rücken' }),
    bsKarte(23, 'T-Shirt Klassenmotiv', 'White', [], BS_GR_ERW.slice(0, 6)),
    bsKarte(24, 'Turnbeutel Klassenmotiv', 'Natur', [], ['']),
  ];
}
const BS_TRIKOTS = [
  { produktId: '40112', name: 'Heimtrikot 2026/27 Herren', bild: BILD('trikot-heim.jpg', 120), groessen: ['S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { produktId: '40113', name: 'Auswärtstrikot 2026/27 Kinder mit Vereinswappen und Sponsor auf der Brust', bild: '', groessen: ['116', '128', '140', '152', '164'] },
];
const BS_TERMINE_DAUER = [
  { id: 'BT-0031', datum: '2026-11-08', notiz: 'Heimspiel gegen Beispielstadt', bestellschluss: '2026-11-04', empfohlen: '2026-11-01', status: '', eintraege: 9, vergangen: true, nachSchluss: true },
  { id: 'BT-0034', datum: '2026-11-21', notiz: 'Auswärts', bestellschluss: '2026-11-17', empfohlen: '2026-11-14', status: '', eintraege: 3, vergangen: false, nachSchluss: true },
  { id: 'BT-0035', datum: '2026-11-29', notiz: 'Heimspiel und Jahresabschluss der Jugendabteilung mit Weihnachtsfeier im Vereinsheim', bestellschluss: '2026-11-25', empfohlen: '2026-11-22', status: '', eintraege: 14, vergangen: false, nachSchluss: false },
  { id: 'BT-0036', datum: '2026-12-13', notiz: '', bestellschluss: '2026-12-09', empfohlen: '2026-12-06', status: '', eintraege: 0, vergangen: false, nachSchluss: false },
];
const BS_TERMINE_AUFTRAG = [
  { id: 'BT-0040', datum: '2026-12-05', notiz: '', bestellschluss: '2026-11-28', empfohlen: '', status: '', eintraege: 6, vergangen: false, nachSchluss: false },
];
function bsZugang(art) {
  const auftrag = art === 'auftrag';
  const artikel = auftrag ? bsArtikelAuftrag() : bsArtikelDauer();
  const zaehl = new Map();
  for (const a of artikel) for (const g of a.gruppen) zaehl.set(g, (zaehl.get(g) ?? 0) + 1);
  return {
    art: auftrag ? 'auftrag' : 'dauer',
    hinweis: auftrag ? 'Bitte bis zum 28.11. eintragen. Namen für den Rücken bitte genau so schreiben, wie sie gedruckt werden sollen.'
      : 'Neu: Trainingsjacken in Charcoal/Rot. Bestellungen nach Bestellschluss nehmen wir gern an, können aber den Termin nicht garantieren.',
    ablauf: auftrag ? '2027-01-04' : '2027-06-30', heute: '2026-11-19',
    regel: { bestellschlussTage: auftrag ? 7 : 4, empfohlenTage: 7 },
    ...(auftrag ? { titel: 'Abschlussfahrt Jahrgang 10 – Hoodies und T-Shirts mit Klassenmotiv', bestellenBis: '2026-11-28', personalisierung: true, abschliessen: true, abgeschlossen: '' } : {}),
    termine: auftrag ? BS_TERMINE_AUFTRAG : BS_TERMINE_DAUER,
    artikel,
    filter: [...zaehl].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([name, anzahl]) => ({ name, anzahl })),
    trikots: auftrag ? [] : BS_TRIKOTS,
    designLink: 'https://beispiel.invalid/design/entwurf-2026',
    katalogStand: '2026-11-18T20:00:00.000Z',
    termineAnlegen: !auftrag,
    ...(auftrag ? { entwuerfe: true } : {}),
    eintragen: true,
  };
}
const SCHRITTE_AU = ['eingegangen', 'geprüft', 'übernommen', 'bestellt', 'lieferbar', 'bei uns', 'fertig', 'geliefert'];
const fort = (bis, { text, datum = '', hinweis = '', schritt } = {}) => ({
  schritt: schritt ?? bis, text: text ?? bis, datum, ...(hinweis ? { hinweis } : {}),
  schritte: SCHRITTE_AU.map((x, i) => ({ text: x, erreicht: i <= SCHRITTE_AU.indexOf(bis) })),
});
function bsEintrag(id, termin, art, extra) {
  return { id, termin, art, bezeichnung: '', groesse: '', menge: 1, kuerzel: 'MK', zeit: '2026-11-18T17:22:00.000Z', nachSchluss: false, status: 'eingegangen', freitext: '', fuer: '',
    trikotName: '', trikotNummer: '', wunsch: '', geaendertVon: '', stand: '2026-11-18T17:22:00.000Z', auswahl: '', trikotProdukt: '', notiz: '', ablehnGrund: '',
    verschobenVon: '', verschobenGrund: '', geliefertAm: '', ...extra };
}
function bsEintraege(termin) {
  const hoodie = 'Premium Bio-Hoodie mit Kängurutasche und Vereinswappen „Seit 1921 gemeinsam am Ball“ – Unisex · Navy';
  if (termin === 'BT-0031') {
    return { termin, eintraege: [
      bsEintrag('BE-0201', termin, 'artikel', { bezeichnung: hoodie, groesse: 'L', menge: 2, status: 'übernommen', kuerzel: 'TK', fortschritt: fort('geliefert', { datum: '2026-11-08' }) }),
      bsEintrag('BE-0202', termin, 'trikot', { bezeichnung: 'Heimtrikot 2026/27 Herren', groesse: 'M', trikotName: 'MUSTERMANN', trikotNummer: '9', status: 'übernommen', kuerzel: 'TK', fortschritt: fort('geliefert', { datum: '2026-11-08' }) }),
      bsEintrag('BE-0203', termin, 'extra', { freitext: 'Ballpumpe', menge: 1, fuer: 'Trainer', status: 'storniert', ablehnGrund: 'gibt es nicht bei uns', kuerzel: 'JS' }),
    ], summe: { gesamt: 2, beiUns: 2, fertig: 2 }, verschoben: [
      bsEintrag('BE-0199', 'BT-0034', 'artikel', { bezeichnung: 'Trainingshose · Black', groesse: '140', verschobenVon: 'BT-0031', verschobenGrund: 'Größe nicht rechtzeitig lieferbar', verschobenAuf: '2026-11-21' }),
    ] };
  }
  if (termin === 'BT-0035' || termin === 'BT-0040') {
    const auf = termin === 'BT-0040';
    return { termin, eintraege: [
      bsEintrag('BE-0301', termin, 'artikel', { bezeichnung: auf ? 'Klassen-Hoodie „Abschlussfahrt 2027 – wir waren dabei“ mit allen Namen auf dem Rücken · Deep Purple' : hoodie, groesse: 'XL', menge: 3, status: 'übernommen',
        kuerzel: 'Lena', fortschritt: fort('bestellt', { text: 'ca. KW 50', hinweis: 'kommt voraussichtlich erst KW 50 – wir melden uns' }), ...(auf ? { trikotName: 'LENA', trikotNummer: '' } : {}) }),
      bsEintrag('BE-0302', termin, 'artikel', { bezeichnung: 'Kinder-Hoodie Wappen · Fire Red', groesse: '122/128', menge: 1, status: 'übernommen', kuerzel: 'Ole', fortschritt: fort('bei uns', { datum: '2026-11-18' }) }),
      bsEintrag('BE-0303', termin, 'artikel', { bezeichnung: 'T-Shirt Schriftzug Saison 2026/27 · White', groesse: 'M', menge: 12, status: 'geprüft', kuerzel: 'Co-Trainerin Jugend', notiz: 'bitte alle mit Rückennummer 1–12 vorsortieren', nachSchluss: true }),
      bsEintrag('BE-0304', termin, 'extra', { freitext: 'Kapitänsbinde in Vereinsfarben, möglichst mit Klettverschluss und aufgesticktem Wappen', menge: 2, fuer: 'Trainer U15' }),
      bsEintrag('BE-0305', termin, 'trikot', { bezeichnung: 'Auswärtstrikot 2026/27 Kinder mit Vereinswappen und Sponsor auf der Brust', groesse: '140', trikotName: 'KÖNIGSBERGER-LANGNAME', trikotNummer: '17', wunsch: 'Torwart', geaendertVon: 'MK' }),
      bsEintrag('BE-0306', termin, 'artikel', { bezeichnung: 'Strickmütze mit Umschlag · Navy', groesse: '', menge: 1, status: 'storniert', kuerzel: 'Pia' }),
      bsEintrag('BE-0307', termin, 'artikel', { bezeichnung: 'Trainingshose · Black', groesse: '140', menge: 1, verschobenVon: 'BT-0031', verschobenGrund: 'Größe nicht rechtzeitig lieferbar', status: 'übernommen', fortschritt: fort('fertig', { datum: '2026-11-19' }) }),
    ], summe: { gesamt: 6, beiUns: 2, fertig: 1 }, verschoben: [] };
  }
  if (termin === 'BT-0034') {
    return { termin, eintraege: [
      bsEintrag('BE-0310', termin, 'artikel', { bezeichnung: 'Fanschal Jacquard „Gemeinsam stark“ 140 × 18 cm · Navy / White', menge: 4, nachSchluss: true }),
    ], verschoben: [] };
  }
  return { termin: termin || '', eintraege: [], verschoben: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// Verteiler
// ════════════════════════════════════════════════════════════════════════════
export function antwort(method, pfad, params, body, seite) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(pfad || '').replace(/\/+$/, '');
  const q = k => (params && typeof params.get === 'function' ? params.get(k) || '' : '');
  if (m !== 'GET') return undefined;   // nur Lesen fuer die Startansichten
  let x;

  // ── bestellen.html ──
  if (p === '/api/bestellseite/zugang') return bsZugang(q('art') || bestellseiteArt);
  if (p === '/api/bestellseite/eintraege') return bsEintraege(q('termin'));
  if (p === '/api/bestellseite/entwuerfe') return { entwuerfe: [], mehr: false };

  // ── partner.html (Lizenzportal) ──
  if (p === '/api/partner/auth') return { partnerId: PORTAL_LZ, partnerName: PARTNER.find(z => z.id === PORTAL_LZ).name };
  if (p === '/api/partner/kacheln') return KACHELN[PORTAL_LZ];
  if (p === '/api/partner/verkaeufe') return kalkVerkaeufe(PORTAL_LZ).map(({ orderId, artikelname, stueckzahl, datum, status, storno }) => ({ orderId, artikelname, stueckzahl, datum, status, storno }));
  if (p === '/api/partner/intern') return LZ_INTERN.map(({ rowId, ...r }) => r);
  if (p === '/api/partner/saldo') {
    const lizenzNetto = 10372.83, mwst = 19, lizenzBrutto = r2(lizenzNetto * 1.19), interneSumme = 114;
    return { lizenzNetto, lizenzSumme: lizenzNetto, lizenzBrutto, mwstProzent: mwst, interneSumme, saldo: r2(lizenzBrutto - interneSumme), saldoNetto: r2((lizenzBrutto - interneSumme) / 1.19) };
  }
  if (p === '/api/partner/abrechnungen') return LZ_ABRECHNUNGEN.filter(a => a.partnerId === PORTAL_LZ && a.status !== 'entwurf');

  // ── partner-festpreis.html ──
  if (p === '/api/festpreis-public/auth') return { partnerId: PORTAL_FP, partnerName: FP_PARTNER.find(z => z['Partner-ID'] === PORTAL_FP).Name };
  if (p === '/api/festpreis-public/verkaeufe') return fpVerkaeufe(PORTAL_FP).map(({ _rowId, Festpreis, Handlingskosten, ...r }) => r);
  if (p === '/api/festpreis-public/intern') return FP_INTERN.map(({ rowId, ...r }) => r);
  if (p === '/api/festpreis-public/saldo') {
    const s = fpSummary(PORTAL_FP);
    return { auszahlungNetto: s.auszahlungNetto, auszahlungBrutto: s.auszahlungBrutto, mwstProzent: 19, interneSumme: s.interneSumme,
      saldoBrutto: s.gesamtBrutto, saldoNetto: s.gesamtNetto, porto: { einnahmen: s.porto.einnahmen, kosten: s.porto.kosten, saldo: s.porto.saldo, inPruefung: true }, verpackung: s.verpackung };
  }
  if (p === '/api/festpreis-public/abrechnungen') return fpAbrechnungen(PORTAL_FP).filter(a => a.Status !== 'entwurf');

  // ── index.html: Artikel ──
  if (p === '/api/sheets/kategorien') return KATEGORIEN;
  if (p === '/api/woocommerce/categories') return KATEGORIEN;
  if (p === '/api/woocommerce/shipping-classes') return VERSANDKLASSEN;
  if (p === '/api/woocommerce/attributes' || p === '/api/sheets/attribute') return ATTRIBUTE;
  if (p === '/api/sheets/struktur-lieferzeiten') return LIEFERZEITEN;
  if (p === '/api/sheets/erfassung/list') return ENTWUERFE;
  if (p === '/api/sheets/erfassung/seo-pending') return SEO_OFFEN;
  if (p === '/api/lieferbarkeit-shop') { x = lieferbarkeitShop(); if (q('shopStatus')) { x.zaehler.shopStatusGeprueft = true; x.zaehler.ausgeblendet.privat = 2; } return x; }
  if (p === '/api/lshop/modelle/liste') return LSM_LISTE;

  // ── index.html: Kunden & Jey ──
  if (p === '/api/anfragen') return ANFRAGEN;
  if (p === '/api/agent-wissen') return AGENT_WISSEN;
  if (p === '/api/agent-wissen/prompt') return AGENT_PROMPT;

  // ── index.html: Lager ──
  if (p === '/api/lager/bestand') return lagerBestand();
  if (p === '/api/lager/abgaenge') return lagerAbgaenge(params);

  // ── index.html: Lizenz-Partner ──
  if (p === '/api/kalkulation/partner') return PARTNER;
  if ((x = p.match(/^\/api\/kalkulation\/partner\/([^/]+)\/kacheln$/))) return KACHELN[decodeURIComponent(x[1])] ?? { bestellungen: 0, intern: 0, internOhneBetrag: 0, saldo: 0, saldoKachel: true, seit: '' };
  if (p === '/api/kalkulation/verkaeufe') return kalkVerkaeufe(q('partnerId'), q('status'));
  if (p === '/api/kalkulation/abrechnungen') return q('partnerId') ? LZ_ABRECHNUNGEN.filter(a => a.partnerId === q('partnerId')) : LZ_ABRECHNUNGEN;
  if (p === '/api/kalkulation/fixkosten') return FIXKOSTEN;
  if (p === '/api/kalkulation/druckpreise') return DRUCKPREISE;
  if (p === '/api/kalkulation/verkaufspreise') return VERKAUFSPREISE;
  if (p === '/api/kalkulation/artikel') return KALK_ARTIKEL;
  if ((x = p.match(/^\/api\/partner\/([^/]+)\/artikel$/))) return decodeURIComponent(x[1]) === 'P-003' ? [] : PARTNER_ARTIKEL;
  if ((x = p.match(/^\/api\/partner\/([^/]+)\/intern$/))) return decodeURIComponent(x[1]).startsWith('FP-') ? FP_INTERN : LZ_INTERN;

  // ── index.html: Festpreis ──
  if (p === '/api/festpreis/partner') return { partner: FP_PARTNER };
  if (p === '/api/festpreis/verkaeufe') return { verkaeufe: fpVerkaeufe(q('partnerId'), q('status')) };
  if (p === '/api/festpreis/verkaeufe/gesperrt') {
    const pid = q('partnerId');
    if (pid && pid !== 'FP-002') return { anzahl: 0, jePartner: [] };
    return { anzahl: 1, jePartner: [{ partnerId: 'FP-002', anzahl: 1, produktIds: ['18104'] }] };
  }
  if (p === '/api/festpreis/verkaeufe/summary') return fpSummary(q('partnerId'));
  if (p === '/api/festpreis/abrechnungen') return { abrechnungen: fpAbrechnungen(q('partnerId')) };
  if (p === '/api/festpreis/preise') return { preise: FP_PREISE };
  if (p === '/api/festpreis/artikel-kategorien') return { kategorien: FP_KATEGORIEN };
  if ((x = p.match(/^\/api\/festpreis\/artikel\/([^/]+)\/pruefung$/))) return { fehlend: [{ produktId: '18190', name: 'Kalender 2027 Sternenstaub mit zwölf Illustrationen und Feiertagen aller Bundesländer' }], kategorienWeg: [] };
  if ((x = p.match(/^\/api\/festpreis\/artikel\/([^/]+)$/))) return { artikel: fpArtikel(decodeURIComponent(x[1])) };

  return undefined;
}
