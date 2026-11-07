// KS1: Bestellseite per Token - reine Logik (utils/bestellseite.js). Nur erfundene Werte.
import crypto from 'crypto';
import {
  erzeugeToken, tokenHash, tokenAusHeader, findeZugang, zugangStatus, ablaufVorschlag, fristen, anlagePlan, bearbeitenPlan,
  sortimentNamen, katalogDauer, katalogAuftrag, seitenAntwort, zugangFuerMc, naechsteZugangId, naechsteTerminId, artikelFuerSeite,
} from '../utils/bestellseite.js';

const JETZT = '2026-11-07T10:00:00Z';
const tok = (b = 1) => erzeugeToken(() => Buffer.alloc(32, b));

describe('Token', () => {
  test('32 Zufallsbytes base64url (43 Zeichen), Hash = SHA-256 hex, nie gleich dem Token', () => {
    const t = erzeugeToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(t)).toBe(crypto.createHash('sha256').update(t).digest('hex'));
    expect(tokenHash(t)).not.toContain(t);
    expect(erzeugeToken()).not.toBe(t);
  });
  test('nur Bearer-Header in gueltiger Form', () => {
    const t = tok();
    expect(tokenAusHeader(`Bearer ${t}`)).toBe(t);
    expect(tokenAusHeader(t)).toBe('');
    expect(tokenAusHeader('Bearer kurz')).toBe('');
    expect(tokenAusHeader(undefined)).toBe('');
  });
  test('findeZugang ueber den Hash (timingSafeEqual), unbekannt/kaputt -> null', () => {
    const a = tok(1), b = tok(2);
    const z = [{ Zugang_ID: 'BS-001', Token_Hash: 'kaputt' }, { Zugang_ID: 'BS-002', Token_Hash: tokenHash(a) }];
    expect(findeZugang(z, a).Zugang_ID).toBe('BS-002');
    expect(findeZugang(z, b)).toBeNull();
    expect(findeZugang(z, 'x')).toBeNull();
    expect(findeZugang([{ Zugang_ID: 'BS-003', Token_Hash: a }], a)).toBeNull();   // Klartext im Sheet zaehlt nie
  });
});

describe('Status und Fristen', () => {
  test('aktiv / gesperrt / abgelaufen (Ablauf = letzter gueltiger Tag, Berlin)', () => {
    expect(zugangStatus({ Aktiv: 'ja', Ablauf: '2026-11-07' }, JETZT)).toBe('aktiv');
    expect(zugangStatus({ Aktiv: 'ja', Ablauf: '2026-11-06' }, JETZT)).toBe('abgelaufen');
    expect(zugangStatus({ Aktiv: 'nein', Ablauf: '2027-06-30' }, JETZT)).toBe('gesperrt');
    expect(zugangStatus({ Aktiv: 'ja', Ablauf: '' }, JETZT)).toBe('abgelaufen');
  });
  test('Ablauf-Vorschlag: dauer naechster 30.06., auftrag Termin + 30 bzw. heute + 30', () => {
    expect(ablaufVorschlag('dauer', { jetzt: JETZT })).toBe('2027-06-30');
    expect(ablaufVorschlag('dauer', { jetzt: '2027-03-01T10:00:00Z' })).toBe('2027-06-30');
    expect(ablaufVorschlag('auftrag', { jetzt: JETZT, termin: '2026-12-01' })).toBe('2026-12-31');
    expect(ablaufVorschlag('auftrag', { jetzt: JETZT })).toBe('2026-12-07');
  });
  test('Bestellschluss 4 / empfohlen 7 Tage vor dem Termin', () => {
    expect(fristen('2026-11-21', { bestellschlussTage: 4, empfohlenTage: 7 })).toEqual({ bestellschluss: '2026-11-17', empfohlen: '2026-11-14' });
    expect(fristen('', { bestellschlussTage: 4, empfohlenTage: 7 })).toEqual({ bestellschluss: '', empfohlen: '' });
  });
  test('Nummern BS-NNN, BT-NNNN', () => {
    expect(naechsteZugangId([{ Zugang_ID: 'BS-009' }])).toBe('BS-010');
    expect(naechsteTerminId([])).toBe('BT-0001');
  });
});

const KAT = [
  { nr: '549', pfad: 'Club', name: 'Club' }, { nr: '554', pfad: 'Club > Basics', name: 'Basics' },
  { nr: '589', pfad: 'Club > Kinder', name: 'Kinder' }, { nr: '700', pfad: 'Andere > Kinder', name: 'Kinder' },
  { nr: '800', pfad: 'Andere', name: 'Andere' },
];
const AUFTRAG = { Auftrag_Nr: 'AU-2026-0007', Kunden_Nr: 'K-00001', Status: 'Angebot', Termin: '2026-12-01', Kurztitel: 'Turnier' };

describe('Anlegen', () => {
  test('auftrag: Kunde vom Auftrag, ein Termin mit Bestellschluss, Ablauf Termin + 30', () => {
    const r = anlagePlan({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0007', vorgang: 'v-12345678' }, zugaenge: [], termine: [], auftraege: [AUFTRAG], kategorien: [], kundeDa: () => true, jetzt: JETZT });
    expect(r.zugang).toMatchObject({ Zugang_ID: 'BS-001', Art: 'auftrag', Kunden_Nr: 'K-00001', Auftrag_Nr: 'AU-2026-0007', Aktiv: 'ja', Ablauf: '2026-12-31', Token_Hash: '' });
    expect(r.termin).toMatchObject({ Termin_ID: 'BT-0001', Zugang_ID: 'BS-001', Datum: '2026-12-01', Bestellschluss: '2026-11-27', Auftrag_Nr: 'AU-2026-0007', Status: 'offen' });
  });
  test('auftrag: storniert / unbekannt / schon offener Zugang -> Fehler', () => {
    const p = x => () => anlagePlan({ eingabe: { art: 'auftrag', auftragNr: 'AU-2026-0007' }, zugaenge: [], termine: [], auftraege: [AUFTRAG], kategorien: [], jetzt: JETZT, ...x });
    expect(p({ auftraege: [{ ...AUFTRAG, Status: 'storniert' }] })).toThrow(/storniert/);
    expect(p({ auftraege: [] })).toThrow(/gibt es nicht/);
    expect(p({ zugaenge: [{ Zugang_ID: 'BS-001', Auftrag_Nr: 'AU-2026-0007', Aktiv: 'ja', Ablauf: '2027-01-01' }] })).toThrow(/schon eine Bestellseite/);
    expect(p({ zugaenge: [{ Zugang_ID: 'BS-001', Auftrag_Nr: 'AU-2026-0007', Aktiv: 'nein', Ablauf: '2027-01-01' }] })).not.toThrow();
  });
  test('dauer: Sortiment Pflicht und bekannt, Ablauf 30.06., kein Termin, Partner nur Merkmal', () => {
    const r = anlagePlan({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', partnerId: 'FP-001' }, zugaenge: [], termine: [], auftraege: [], kategorien: KAT, kundeDa: () => true, jetzt: JETZT });
    expect(r.zugang).toMatchObject({ Art: 'dauer', Kunden_Nr: 'K-00063', Sortiment: '549', Partner_ID: 'FP-001', Ablauf: '2027-06-30', Bestellschluss_Tage: 4, Empfohlen_Tage: 7 });
    expect(r.termin).toBeNull();
    const p = e => () => anlagePlan({ eingabe: { art: 'dauer', kundenNr: 'K-00063', ...e }, zugaenge: [], termine: [], auftraege: [], kategorien: KAT, kundeDa: () => true, jetzt: JETZT });
    expect(p({ sortiment: '' })).toThrow(/Sortiment/);
    expect(p({ sortiment: '999' })).toThrow(/unbekannt/);
    expect(p({ sortiment: '549', partnerId: 'X' })).toThrow(/Partner/);
    expect(() => anlagePlan({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549' }, zugaenge: [], termine: [], auftraege: [], kategorien: KAT, kundeDa: () => false, jetzt: JETZT })).toThrow(/Kunde/);
  });
  test('Ablauf in der Vergangenheit, Tage ausserhalb 0-60 -> Fehler', () => {
    const p = e => () => anlagePlan({ eingabe: { art: 'dauer', kundenNr: 'K-00063', sortiment: '549', ...e }, zugaenge: [], termine: [], auftraege: [], kategorien: KAT, jetzt: JETZT });
    expect(p({ ablauf: '2026-01-01' })).toThrow(/Vergangenheit/);
    expect(p({ bestellschlussTage: 99 })).toThrow(/0–60/);
  });
});

describe('Bearbeiten', () => {
  const Z = { Zugang_ID: 'BS-001', Art: 'dauer', Aktiv: 'ja', Ablauf: '2027-06-30', Stand: 's1', Sortiment: '549' };
  test('Stand wie gesehen, sonst 409', () => {
    expect(() => bearbeitenPlan({ zugang: Z, eingabe: { stand: 'alt', aktiv: false }, jetzt: JETZT })).toThrow(expect.objectContaining({ status: 409 }));
  });
  test('sperren, verlaengern, Design-Link nur bei auftrag', () => {
    const n = bearbeitenPlan({ zugang: Z, eingabe: { stand: 's1', aktiv: false, ablauf: '2027-07-31' }, jetzt: JETZT });
    expect(n).toMatchObject({ Aktiv: 'nein', Ablauf: '2027-07-31' });
    expect(zugangStatus(n, JETZT)).toBe('gesperrt');
    expect(() => bearbeitenPlan({ zugang: Z, eingabe: { stand: 's1', designLinkZeigen: true }, jetzt: JETZT })).toThrow(/Design-Link/);
  });
});

describe('Katalog Art dauer', () => {
  test('Namen: Kategorie-Name, den es auch ausserhalb des Sortiments gibt, zaehlt allein nicht', () => {
    expect([...sortimentNamen('549', KAT)].sort()).toEqual(['Basics', 'Club']);
  });
  const maske = [
    { id: 'A1', status: 'Veröffentlicht', produktId: '11', name: 'Hoodie Club', kategorien: 'Club, Basics' },
    { id: 'A2', status: 'Entwurf', produktId: '12', name: 'Entwurf', kategorien: 'Club' },
    { id: 'A3', status: 'Veröffentlicht', produktId: '13', name: 'Fremd Kinder', kategorien: 'Kinder' },   // nur "Kinder" -> nicht dabei
    { id: 'A4', status: 'Veröffentlicht', produktId: '14', name: 'Becher', kategorien: 'Basics' },
    { id: 'A5', status: 'Veröffentlicht', produktId: '15', name: 'Im Shop privat', kategorien: 'Club' },
  ];
  const v = (id, wc, farbe, gr, nr, x = {}) => ({ ssotId: id, E1: 'Farbe', V1: farbe, E2: gr ? 'Größe' : '', V2: gr, aktiv: 'TRUE', wcId: wc, articleNr: nr, Preis: '29,90', ...x });
  const varianten = [
    v('A1', '101', 'Black', 'XL', '1000000002'), v('A1', '102', 'Black', 'S', '1000000001'), v('A1', '103', 'Red', 'M', '1000000003'),
    v('A1', '104', 'Red', 'L', '1000000004', { aktiv: 'FALSE' }), v('A1', '', 'Red', 'XL', '1000000005'),
    v('A4', '401', 'Schwarz', '', ''), v('A5', '501', 'Weiß', '', ''),
  ];
  const lieferbarkeit = new Map([['1000000002', { stufe: 'null' }], ['1000000001', { stufe: 'lieferbar' }]]);
  const bilder = new Map([['101', { url: 'https://shop.example/b101.jpg' }], ['14', { url: 'https://shop.example/p14.jpg', status: 'publish' }], ['15', { url: '', status: 'private' }]]);
  const k = katalogDauer({ sortiment: '549', kategorien: KAT, maske, varianten, lieferbarkeit, bilder });
  test('nur veroeffentlichte Artikel des Sortiments (und im Shop nicht privat), je Farbe eine Karte', () => {
    expect(k.map(a => `${a.name}|${a.farbe}`)).toEqual(['Becher|Schwarz', 'Hoodie Club|Black', 'Hoodie Club|Red']);
  });
  test('Groessen sortiert, nur aktive mit WC-ID, Lieferbarkeit je ArticleNr, Bild der Variation', () => {
    const b = k.find(a => a.farbe === 'Black');
    expect(b.groessen.map(g => [g.groesse, g.id, g.lieferbar])).toEqual([['S', '102', 'lieferbar'], ['XL', '101', 'null']]);
    expect(b.bild).toBe('https://shop.example/b101.jpg');
    expect(k.find(a => a.farbe === 'Red').groessen.map(g => g.groesse)).toEqual(['M']);
  });
  test('ohne L-Shop-Nr. auswaehlbar mit "noch zu besorgen", Bild des Produkts als Ersatz', () => {
    const b = k.find(a => a.name === 'Becher');
    expect(b.groessen).toEqual([{ groesse: '', id: '401', articleNr: '', lieferbar: '', nochZuBesorgen: true }]);
    expect(b.nochZuBesorgen).toBe(true);
    expect(b.bild).toBe('https://shop.example/p14.jpg');
  });
});

describe('Katalog Art auftrag', () => {
  const info = new Map([
    ['1000000011', { modell: 'M1', bezeichnung: 'Lieferanten-Name', farbe: 'Navy', groesse: 'M' }],
    ['1000000012', { modell: 'M1', bezeichnung: 'Lieferanten-Name', farbe: 'Navy', groesse: 'L' }],
  ]);
  const groessenJe = new Map([['M1|Navy', [{ articleNr: '1000000012', groesse: 'L', lieferbar: 'auslauf' }, { articleNr: '1000000011', groesse: 'M', lieferbar: '' }, { articleNr: '1000000013', groesse: 'S', lieferbar: 'lieferbar' }]]]);
  const positionen = [
    { Art: 'lshop', LShop_ArticleNr: '1000000011', Motiv: 'Logo vorne', Preis_Netto: 12.5 },
    { Art: 'lshop', LShop_ArticleNr: '1000000012', Motiv: '' },
    { Art: 'frei', Freitext: 'Tasse', Motiv: '' },
  ];
  const k = katalogAuftrag({ auftrag: AUFTRAG, positionen, info, groessenJe });
  test('Gruppe Modell + Farbe mit allen waehlbaren Groessen des Modells, Name = Motiv (nie L-Shop-Name)', () => {
    expect(k[0]).toMatchObject({ name: 'Logo vorne', farbe: 'Navy', motiv: 'Logo vorne' });
    expect(k[0].groessen.map(g => g.groesse)).toEqual(['S', 'M', 'L']);
    expect(JSON.stringify(k)).not.toContain('Lieferanten-Name');
    expect(JSON.stringify(k)).not.toContain('M1');
  });
  test('freie Position ohne Groessen', () => {
    expect(k[1]).toMatchObject({ name: 'Tasse', groessen: [] });
  });
});

describe('Keine Preise in der Antwort (erfundene Daten MIT Preisen)', () => {
  test('feste Feldauswahl: kein Preis-Schluessel, keine Preiszahl', () => {
    const roh = { key: 'k', name: 'Hoodie', farbe: 'Black', bild: 'https://x.example/a.jpg', preis: 29.9, Preis_Netto: 12.34, EK: 7.77, ek: 7.77, lshopName: 'Lieferant',
      groessen: [{ groesse: 'M', id: '1', articleNr: '1000000001', lieferbar: 'lieferbar', price: 29.9, regular_price: '29.90', '10CartonsPrice': '4,10' }] };
    const antwort = seitenAntwort({ zugang: { Art: 'dauer', Hinweis: 'Abholung im Laden', Ablauf: '2027-06-30', Bestellschluss_Tage: 4, Empfohlen_Tage: 7, Kunden_Nr: 'K-00001', Partner_ID: 'FP-001', Token_Hash: 'a'.repeat(64) },
      termine: [{ Termin_ID: 'BT-0001', Datum: '2026-11-21', Notiz: 'Gegner X', Auftrag_Nr: 'AU-2026-0001', Status: 'offen' }], artikel: [roh] });
    const text = JSON.stringify(antwort);
    expect(text).not.toMatch(/price|preis|Preis|"ek"|EK|netto|brutto|Summe|Einzelpreis|Cartons/i);
    for (const zahl of ['29.9', '29,90', '12.34', '7.77', '4,10']) expect(text).not.toContain(zahl);
    expect(text).not.toContain('Lieferant');
    expect(text).not.toContain('K-00001');
    expect(text).not.toContain('FP-001');
    expect(text).not.toContain('AU-2026-0001');
    expect(text).not.toContain('a'.repeat(64));
    expect(antwort.termine[0]).toEqual({ id: 'BT-0001', datum: '2026-11-21', notiz: 'Gegner X', bestellschluss: '2026-11-17', empfohlen: '2026-11-14', status: 'offen',
      eintraege: 0, vergangen: false, nachSchluss: false });   // KS2
    expect(antwort.eintragen).toBe(true);   // KS2
  });
  test('Bild nur https', () => {
    expect(artikelFuerSeite({ bild: 'javascript:alert(1)' }).bild).toBe('');
    expect(artikelFuerSeite({ bild: 'http://x.example/a.jpg' }).bild).toBe('');
  });
});

test('MC-Liste ohne Token_Hash, mit Status und Termine', () => {
  const z = zugangFuerMc({ Zugang_ID: 'BS-001', Token_Hash: 'f'.repeat(64), Aktiv: 'ja', Ablauf: '2027-06-30', Vorgang: 'v', _zeile: 2 }, JETZT, [{ Termin_ID: 'BT-0001', Zugang_ID: 'BS-001', _zeile: 2 }]);
  expect(z).not.toHaveProperty('Token_Hash');
  expect(z).not.toHaveProperty('Vorgang');
  expect(z).toMatchObject({ status: 'aktiv', hatLink: true, termine: [{ Termin_ID: 'BT-0001' }] });
});
