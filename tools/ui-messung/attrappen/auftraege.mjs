// Attrappen-Antworten (erfundene Testdaten) fuer die Layout-Sichtpruefung von Mission Control.
// Die Antwort-Formen werden mit den REINEN Logik-Modulen des Backends (utils/*.js, keine npm-Pakete) gebaut,
// genau wie lib/*.js sie fuer den Browser zusammensetzt - nur die Sheet-/Drive-/Shop-Leser sind ersetzt.
// Repo wird nur gelesen (Import), nichts geschrieben.

const REPO = new URL('../../../backend/', import.meta.url).href;
const imp = p => import(REPO + p);

const AU = await imp('utils/auftraege.js');
const AG = await imp('utils/aufgaben.js');
const PR = await imp('utils/auftrag-preise.js');
const HI = await imp('utils/auftrag-historie.js');
const KU = await imp('utils/kunden.js');
const DB = await imp('utils/dashboard.js');
const RS = await imp('utils/rueckstand.js');
const BS = await imp('utils/bestellseite.js');
const BE = await imp('utils/bestell-eintraege.js');
const BU = await imp('utils/bestell-uebernahme.js');
const ST = await imp('utils/bestell-stand.js');

// Fester "Jetzt" fuer alle Rechnungen (Daten liegen um den 19.11.2026)
const JETZT = new Date('2026-11-19T09:30:00Z');
const ISO = JETZT.toISOString();

// ── L-Shop-Modelle (erfunden) ───────────────────────────────────────────────
const GROESSEN = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const MODELLE = [
  { modell: 'JN054', basis: '40054', bezeichnung: 'Damen Basic-T-Shirt Slim Fit aus gekämmter Baumwolle', farben: ['black', 'white', 'navy'], groessen: GROESSEN, ek: 3.85 },
  { modell: 'BCTU01T', basis: '41101', bezeichnung: 'B&C #E150 Herren T-Shirt Rundhals', farben: ['black', 'royal blue', 'red'], groessen: GROESSEN, ek: 2.4 },
  { modell: 'SG40', basis: '42040', bezeichnung: 'Herren Premium-Kapuzensweatshirt mit Kängurutasche und doppellagiger Kapuze, gebürstete Innenseite', farben: ['heather grey', 'black'], groessen: GROESSEN, ek: 14.9 },
  { modell: 'RT076', basis: '43076', bezeichnung: 'Baseball-Cap 6 Panel', farben: ['navy/white', 'black'], groessen: ['one size'], ek: 2.95 },
];
const nrVon = (modell, farbe, groesse) => {
  const m = MODELLE.find(x => x.modell === modell);
  const ci = m.farben.indexOf(farbe) + 1, si = m.groessen.indexOf(groesse) + 1;
  return `${m.basis}${String(ci).padStart(2, '0')}${String(si).padStart(2, '0')}0`;
};
// info wie lshopInfo (lib/auftraege.js): je ArticleNr { modell, bezeichnung, farbe, groesse, bestellbar, lieferbar? }
const INFO = new Map();
const EK_JE = new Map();
for (const m of MODELLE) {
  for (const f of m.farben) for (const g of m.groessen) {
    const nr = nrVon(m.modell, f, g);
    let lieferbar = { stufe: 'lieferbar', stock: 180 + nr.charCodeAt(6) * 3, nullSeit: '', auslaufdatum: '' };
    if (m.modell === 'JN054' && f === 'navy' && g === '3XL') lieferbar = { stufe: 'null', stock: 0, nullSeit: '2026-10-28', auslaufdatum: '' };
    if (m.modell === 'SG40' && f === 'heather grey') lieferbar = { stufe: 'auslauf', stock: 42, nullSeit: '', auslaufdatum: '2026-12-31' };
    if (m.modell === 'BCTU01T' && f === 'red' && g === 'XS') lieferbar = { stufe: 'nicht_gefuehrt', stock: null, nullSeit: '2026-09-30', auslaufdatum: '' };
    const gesperrt = m.modell === 'BCTU01T' && f === 'red' && g === 'XS';
    INFO.set(nr, { modell: m.modell, bezeichnung: m.bezeichnung, farbe: f, groesse: g, bestellbar: !gesperrt, ...(gesperrt ? {} : { lieferbar }) });
    EK_JE.set(nr, { ek: Math.round((m.ek + (['2XL', '3XL'].includes(g) ? 1.1 : 0)) * 100) / 100, stand: '2026-11-03' });
  }
}

// ── Kunden (eigenes Kunden-Sheet) ────────────────────────────────────────────
const k = (nr, o) => ({ ...Object.fromEntries(KU.KUNDEN_SPALTEN.map(s => [s, ''])), Kunden_Nr: nr, Status: 'aktiv', Land: 'DE', Angelegt: '2026-03-02T10:00:00.000Z', Stand: '2026-10-01T08:00:00.000Z', ...o });
const LEX = i => ({ Lexoffice_Nr: String(10100 + i), Lexoffice_ID: `0000${i}a1c-7e2b-4c11-9d00-00000000${String(i).padStart(4, '0')}`, Quelle: 'lexoffice' });
const KUNDEN = [
  k('K-00001', { ...LEX(1), Art: 'Verein', Name: 'Testverein Nordlicht von 1912 e. V. – Abteilung Handball und Freizeitsport', Spitzname: 'Nordlicht; TVN', Ansprechpartner: 'Vorstand Kasse', 'E-Mail': 'kasse@nordlicht.example', Telefon: '+49 4100 000101', Strasse: 'Sportplatzweg 1', PLZ: '25000', Ort: 'Musterstadt', Notiz: 'Sammelbestellungen immer über den Kassenwart. Rechnung bitte getrennt nach Abteilung Handball und Abteilung Freizeitsport, jeweils mit Kostenstelle im Betreff.' }),
  k('K-00002', { ...LEX(2), Art: 'Verein', Name: 'Fanclub Weiße Möwe e. V.', Spitzname: 'Möwen', Ansprechpartner: 'Fanshop-Team', 'E-Mail': 'fanshop@moewe.example', Telefon: '+49 4100 000102', Strasse: 'Hafenstraße 12', PLZ: '25001', Ort: 'Musterhafen' }),
  k('K-00003', { ...LEX(3), Art: 'Firma', Name: 'Muster GmbH', Ansprechpartner: 'Einkauf', 'E-Mail': 'einkauf@muster.example', Telefon: '+49 40 0000000', Strasse: 'Industrieweg 7', PLZ: '20000', Ort: 'Beispielstadt' }),
  k('K-00004', { Art: 'Firma', Name: 'Beispiel Bau & Montage GmbH & Co. KG Niederlassung Nord', Ansprechpartner: 'Frau Personalabteilung', 'E-Mail': 'info@beispielbau.example', Ort: 'Beispielstadt', PLZ: '20001', Quelle: 'mc' }),
  k('K-00005', { ...LEX(5), Art: 'Person', Name: 'Erika Musterfrau', 'E-Mail': 'erika@privat.example', Telefon: '0151 00000005', Ort: 'Musterdorf', PLZ: '25002' }),
  k('K-00006', { Art: 'Person', Name: 'Max Mustermann', Spitzname: 'Maxi', Telefon: '0151 00000006', Quelle: 'mc', Notiz: 'Meldet sich meist per WhatsApp.' }),
  k('K-00007', { ...LEX(7), Art: 'Verein', Name: 'SV Grünweiß Testhausen', Spitzname: 'SVG', Ansprechpartner: 'Jugendleitung', Ort: 'Testhausen', PLZ: '25003' }),
  k('K-00008', { ...LEX(8), Art: 'Firma', Name: 'Probe Druckerei Werkstatt', 'E-Mail': 'werkstatt@probe.example', Ort: 'Probestadt', PLZ: '25004' }),
  k('K-00009', { Art: 'Verein', Name: 'Kegelclub Alle Neune Beispielort', Quelle: 'mc', Ort: 'Beispielort' }),
  k('K-00010', { ...LEX(10), Art: 'Person', Name: 'Anna Beispiel', 'E-Mail': 'anna@beispiel.example' }),
  k('K-00011', { ...LEX(11), Art: 'Firma', Name: 'Demo Logistik AG', Ansprechpartner: 'Fuhrpark', Status: 'archiviert' }),
  k('K-00012', { Art: 'Person', Name: 'Tom Testmann', Spitzname: 'Tommy; TT', Quelle: 'mc', Telefon: '0170 00000012' }),
  k('K-00013', { ...LEX(13), Art: 'Verein', Name: 'Schützengilde Probeholz', Ansprechpartner: 'Schriftführung', Ort: 'Probeholz' }),
  k('K-00014', { Art: 'Firma', Name: 'Fiktiv Café & Rösterei', Quelle: 'mc', 'E-Mail': 'hallo@fiktiv.example' }),
  k('K-00015', { Lexoffice_ID: '00015a1c-7e2b-4c11-9d00-000000000015', Art: 'Person', Name: 'gelöscht K-00015', Status: 'gesperrt-DSGVO', Quelle: 'lexoffice', Land: '' }),
].map((x, i) => ({ ...x, _zeile: i + 2 }));

// ── Auftraege + Positionen (Reiter-Zeilen wie zeilenAus sie liefert) ─────────
const leerAu = () => Object.fromEntries([...AU.AUFTRAG_SPALTEN, ...AU.AUFTRAG_OPTIONAL].map(s => [s, '']));
const leerPos = () => Object.fromEntries([...AU.POSITION_SPALTEN, ...AU.POSITION_OPTIONAL].map(s => [s, '']));
let zA = 2, zP = 2;
const AUFTRAEGE = [];
const POSITIONEN = [];
function au(o, positionen = []) {
  AUFTRAEGE.push({ ...leerAu(), Kanal: 'Mail', Stand: '2026-11-18T15:00:00.000Z', Vorgang: `v-${o.Auftrag_Nr}`, ...o, _zeile: zA++ });
  positionen.forEach((p, i) => POSITIONEN.push({ ...leerPos(), Position_ID: `${o.Auftrag_Nr}-${String(i + 1).padStart(2, '0')}`, Auftrag_Nr: o.Auftrag_Nr,
    Art: 'lshop', Stand: '2026-11-18T15:00:00.000Z', ...p, _zeile: zP++ }));
}
// L-Shop-Gruppe Modell+Farbe ueber Groessen -> Positionen
const gruppe = (modell, farbe, mengen, extra = {}) => Object.entries(mengen).map(([g, n]) => ({ LShop_ArticleNr: nrVon(modell, farbe, g), Menge: String(n), ...extra }));
const frei = (text, menge, extra = {}) => ({ Art: 'frei', Freitext: text, Menge: String(menge), ...extra });

au({ Auftrag_Nr: 'AU-2026-0042', Kunden_Nr: 'K-00003', Kurztitel: 'Firmenshirts Sommerfest – Bestellseite', Kanal: 'Bestellseite', Status: 'Design',
  Termin: '2026-12-05', Anfrage_Am: '2026-11-12', Design_Am: '2026-11-12', Angelegt: '2026-11-12T09:00:00.000Z', Zugang_ID: 'BS-002', Termin_ID: 'BT-0003',
  Zustaendig: 'Christian', Preis_Eingabe: 'netto' }, [
  ...gruppe('JN054', 'black', { S: 2, M: 3, L: 1 }, { Motiv: 'Vereins-Shirt Damen · Logo Brust', Druck: 'DTF Brust 10 cm', Preis_Netto: 14.5, USt_Satz: 19 }),
  ...gruppe('BCTU01T', 'royal blue', { L: 2, XL: 2 }, { Motiv: 'Logo Brust', Druck: 'DTF Brust 10 cm', Preis_Netto: 12.9, USt_Satz: 19 }),
]);
au({ Auftrag_Nr: 'AU-2026-0041', Kunden_Nr: 'K-00001', Kurztitel: 'Aufwärmshirts Handball-Herren und Damen mit Rückennummern und Sponsorlogo', Kanal: 'WhatsApp', Status: 'Design',
  Termin: '2026-11-25', Anfrage_Am: '2026-11-19', Design_Am: '2026-11-19', Angelegt: '2026-11-19T07:12:00.000Z', Zustaendig: 'Nicole', Rabatt: '10%',
  Design_Link: 'https://www.canva.com/design/DEMO000000/view', Preis_Eingabe: 'netto',
  Notiz: 'Sponsorlogo kommt noch als Vektordatei vom Kassenwart. Rückennummern laut Liste im Anhang der Mail vom 18.11., Damen in Schwarz, Herren in Navy. Bitte vor dem Druck einmal Probedruck auf Restware zeigen – der Verein möchte die Farbe des Sponsorlogos abnehmen, bevor alle 38 Stück gedruckt werden.' }, [
  ...gruppe('JN054', 'black', { XS: 2, S: 4, M: 6, L: 3, XL: 1 }, { Motiv: 'Vereinswappen Brust links + Sponsor Rücken oben + Rückennummer', Druck: 'Flex weiß, 3 Positionen', Preis_Netto: 18.9, Aufpreis_Netto: 2, Aufpreis_Ab: '2XL', USt_Satz: 19 }),
  ...gruppe('JN054', 'navy', { M: 5, L: 8, XL: 6, '2XL': 2, '3XL': 1 }, { Motiv: 'Vereinswappen Brust links + Sponsor Rücken oben + Rückennummer', Druck: 'Flex weiß, 3 Positionen', Preis_Netto: 18.9, Aufpreis_Netto: 2, Aufpreis_Ab: '2XL', USt_Satz: 19 }),
  frei('Rückennummern-Satz Flex (Sonderfarbe Vereinsgold)', 38, { Preis_Netto: 1.5, USt_Satz: 19, EK_Hand: 0.4, Notiz: 'Folie noch besorgen' }),
]);
au({ Auftrag_Nr: 'AU-2026-0040', Kunden_Nr: 'K-00007', Kurztitel: 'Jugendtrainingsanzüge Hoodies', Kanal: 'Mail', Status: 'bestellt',
  Termin: '2026-11-28', Anfrage_Am: '2026-11-03', Design_Am: '2026-11-04', Bestellt_Am: '2026-11-10', Angelegt: '2026-11-03T12:30:00.000Z', Zustaendig: 'Christian' }, [
  ...gruppe('SG40', 'black', { S: 4, M: 6 }, { Motiv: 'SVG Wappen groß', Druck: 'Siebdruck 1-farbig', Preis_Netto: 29.9, USt_Satz: 19 }).map((p, i) => ({ ...p, Korb_Schluessel: `EIGEN:2026-01${10 + i}` })),
  ...gruppe('SG40', 'heather grey', { L: 3 }, { Motiv: 'SVG Wappen groß', Druck: 'Siebdruck 1-farbig', Preis_Netto: 29.9, USt_Satz: 19, Korb_Schluessel: 'EIGEN:2026-0112' }),
]);
au({ Auftrag_Nr: 'AU-2026-0039', Kunden_Nr: 'K-00008', Kurztitel: 'Arbeitsshirts Werkstatt', Kanal: 'Telefon', Status: 'in Produktion',
  Termin: '2026-11-21', Anfrage_Am: '2026-10-20', Design_Am: '2026-10-21', Bestellt_Am: '2026-10-24', Produktion_Am: '2026-11-17', Angelegt: '2026-10-20T08:00:00.000Z' }, [
  ...gruppe('BCTU01T', 'black', { M: 4, L: 6, XL: 4 }, { Motiv: 'Logo Rücken', Druck: 'DTF Rücken A3', Preis_Netto: 11.5, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-11-18' }).map((p, i) => ({ ...p, Korb_Schluessel: `EIGEN:2026-009${i}` })),
  { Art: 'lshop', LShop_ArticleNr: nrVon('RT076', 'black', 'one size'), Menge: '14', Herkunft: 'lager', Lager_Ort: 'Wrist', Lager_Buchung: 'LB-2026-00412', Motiv: 'Stick vorne', Druck: 'Stick', Preis_Netto: 9.9, USt_Satz: 19 },
]);
au({ Auftrag_Nr: 'AU-2026-0038', Kunden_Nr: 'K-00004', Kurztitel: 'Komplettausstattung Belegschaft 2027 (Shirts, Hoodies, Caps) – Niederlassung Nord und Süd', Kanal: 'persönlich', Status: 'fertig',
  Termin: '2026-11-20', Anfrage_Am: '2026-09-15', Angebot_Am: '2026-09-20', Bestellt_Am: '2026-10-01', Produktion_Am: '2026-10-20', Fertig_Am: '2026-11-14', Angelegt: '2026-09-15T10:00:00.000Z',
  Angebot_Netto: 12480.5, Angebot_Brutto: 14851.8, Angebot_Stand: '2026-09-20', Zustaendig: 'Christian' }, [
  ...gruppe('SG40', 'black', { M: 60, L: 120, XL: 90, '2XL': 40, '3XL': 15 }, { Motiv: 'Firmenlogo Brust + Rücken groß', Druck: 'Siebdruck 2-farbig', Preis_Netto: 31.5, Aufpreis_Netto: 3, Aufpreis_Ab: '2XL', USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-11-14', Korb_Schluessel: 'EIGEN:2026-0070' }),
  ...gruppe('RT076', 'navy/white', { 'one size': 250 }, { Motiv: 'Logo Stick', Druck: 'Stick', Preis_Netto: 8.9, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-11-13', Korb_Schluessel: 'EIGEN:2026-0071' }),
  frei('Einrichtung Stickprogramm Firmenlogo', 1, { Preis_Netto: 89, USt_Satz: 19, Herkunft: 'vorhanden', Fertig: 'ja', Fertig_Am: '2026-11-10' }),
]);
au({ Auftrag_Nr: 'AU-2026-0037', Kunden_Nr: 'K-00006', Kurztitel: 'Geburtstagsshirts Familie', Kanal: 'WhatsApp', Status: 'übergeben',
  Termin: '2026-11-15', Anfrage_Am: '2026-10-30', Design_Am: '2026-10-30', Bestellt_Am: '2026-11-02', Produktion_Am: '2026-11-08', Fertig_Am: '2026-11-12', Uebergeben_Am: '2026-11-14',
  Angelegt: '2026-10-30T18:00:00.000Z', Preis_Eingabe: 'brutto' }, [
  ...gruppe('BCTU01T', 'red', { S: 1, M: 2, L: 2 }, { Motiv: '„Team Geburtstag 50“', Druck: 'Flex gold', Preis_Netto: 16.8067, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-11-12', Versendet: '2026-11-14', Herkunft: 'vorhanden', Verweis: 'LAGER:Wrist' }),
]);
au({ Auftrag_Nr: 'AU-2026-0036', Kunden_Nr: 'K-00013', Kurztitel: 'Schützenfest Polos', Kanal: 'Mail', Status: 'bezahlt',
  Termin: '2026-08-01', Anfrage_Am: '2026-06-10', Angebot_Am: '2026-06-12', Bestellt_Am: '2026-06-20', Produktion_Am: '2026-07-10', Fertig_Am: '2026-07-25', Uebergeben_Am: '2026-07-28', Bezahlt_Am: '2026-08-05',
  Angelegt: '2026-06-10T09:00:00.000Z', Angebot_Netto: 640, Angebot_Brutto: 761.6, Angebot_Stand: '2026-06-12', Lexoffice_Rechnung: 'RE-2026-0815' }, [
  ...gruppe('JN054', 'white', { M: 10, L: 10 }, { Motiv: 'Gilde-Wappen', Druck: 'Stick', Preis_Netto: 32, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-07-25', Versendet: '2026-07-28', Korb_Schluessel: 'EIGEN:2026-0031' }),
]);
au({ Auftrag_Nr: 'AU-2026-0035', Kunden_Nr: 'K-00010', Kurztitel: 'Junggesellinnenabschied', Kanal: 'Telefon', Status: 'storniert',
  Termin: '2026-11-08', Anfrage_Am: '2026-10-12', Design_Am: '2026-10-13', Storniert_Am: '2026-10-20', Angelegt: '2026-10-12T16:00:00.000Z' }, [
  ...gruppe('JN054', 'white', { S: 3, M: 4 }, { Motiv: 'Team Braut', Druck: 'Flex rosa', Preis_Netto: 14, USt_Satz: 19 }),
]);
au({ Auftrag_Nr: 'AU-2026-0034', Kunden_Nr: 'K-00012', Kurztitel: 'Anfrage Caps für Stammtisch', Kanal: 'WhatsApp', Status: 'Anfrage',
  Termin: '', Anfrage_Am: '2026-10-05', Angelegt: '2026-10-05T19:00:00.000Z' }, []);
au({ Auftrag_Nr: 'AU-2026-0033', Kunden_Nr: 'K-00009', Kurztitel: 'Vereinsshirts Kegelclub', Kanal: 'Mail', Status: 'Angebot',
  Termin: '2026-12-12', Anfrage_Am: '2026-10-08', Angebot_Am: '2026-10-09', Angelegt: '2026-10-08T11:00:00.000Z', Rabatt: 25,
  Angebot_Netto: 189.5, Angebot_Brutto: 225.51, Angebot_Stand: '2026-10-09' }, [
  ...gruppe('BCTU01T', 'black', { L: 6, XL: 4, '2XL': 2 }, { Motiv: 'Alle Neune – Kegel-Logo', Druck: 'DTF Brust', Preis_Netto: 15.5, Aufpreis_Netto: 1.5, Aufpreis_Ab: '2XL', USt_Satz: 19 }),
]);
au({ Auftrag_Nr: 'AU-2026-0032', Kunden_Nr: 'K-00005', Kurztitel: 'Hoodie mit Hundemotiv', Kanal: 'persönlich', Status: 'Design',
  Termin: '2026-11-15', Anfrage_Am: '2026-11-05', Design_Am: '2026-11-05', Angelegt: '2026-11-05T14:00:00.000Z', Zustaendig: 'Nicole', Preis_Eingabe: 'brutto' }, [
  { Art: 'lshop', LShop_ArticleNr: nrVon('SG40', 'black', 'M'), Menge: '1', Herkunft: 'lager', Lager_Ort: 'Wrist', Motiv: 'Hund „Bello“ Foto-Druck', Druck: 'DTF Rücken', Preis_Netto: 33.6134, USt_Satz: 19 },
  frei('Eigene Tasche des Kunden besticken', 1, { Herkunft: 'vorhanden', Preis_Netto: 12.605, USt_Satz: 19 }),
]);
au({ Auftrag_Nr: 'AU-2026-0031', Kunden_Nr: 'K-00002', Kurztitel: 'Fanshop Nachbestellung Shirts', Kanal: 'Bestellseite', Status: 'bestellt',
  Termin: '2026-11-22', Anfrage_Am: '2026-11-06', Design_Am: '2026-11-06', Bestellt_Am: '2026-11-11', Angelegt: '2026-11-06T10:00:00.000Z', Zugang_ID: 'BS-001', Termin_ID: 'BT-0001' }, [
  { ...gruppe('JN054', 'navy', { M: 2 }, { Motiv: 'Möwe klein', Druck: 'DTF', Preis_Netto: 13.9, USt_Satz: 19 })[0], Korb_Schluessel: 'EIGEN:2026-0120' },
  { ...gruppe('JN054', 'navy', { '3XL': 1 }, { Motiv: 'Möwe klein', Druck: 'DTF', Preis_Netto: 13.9, USt_Satz: 19 })[0], Korb_Schluessel: 'EIGEN:2026-0121' },
  { ...gruppe('BCTU01T', 'black', { L: 2 }, { Motiv: 'Möwe groß', Druck: 'DTF', Preis_Netto: 12.5, USt_Satz: 19 })[0] },   // noch nicht im Korb
  { ...gruppe('BCTU01T', 'black', { XL: 1 }, { Motiv: 'Möwe groß' })[0], Entfernt: '2026-11-15' },
  { ...gruppe('BCTU01T', 'black', { M: 1 }, { Motiv: 'Möwe groß' })[0], Entfernt: '2026-11-16', Verschoben_Nach: 'AU-2026-0043-01' },
  frei('Aufnäher Fanclub (vom Kunden besorgt)', 20, { Da_Am: '2026-11-17' }),
]);
au({ Auftrag_Nr: 'AU-2026-0030', Kunden_Nr: 'K-00014', Kurztitel: 'Schürzen Café', Kanal: 'Mail', Status: 'bestellt',
  Termin: '2026-11-27', Anfrage_Am: '2026-11-01', Design_Am: '2026-11-02', Bestellt_Am: '2026-11-09', Angelegt: '2026-11-01T09:00:00.000Z' }, [
  frei('Latzschürze Canvas schwarz (Großhandel)', 12, { Preis_Netto: 19.5, EK_Hand: 8.2, USt_Satz: 19, Notiz: 'beim Großhändler bestellt, Lieferung ca. 25.11.' }),
  frei('Bistroschürze kurz', 6, { Preis_Netto: 14, USt_Satz: 19 }),
]);

au({ Auftrag_Nr: 'AU-2026-0012', Kunden_Nr: 'K-00001', Kurztitel: 'Saisonshirts Handball Frühjahr', Kanal: 'Mail', Status: 'bezahlt',
  Termin: '2026-03-20', Anfrage_Am: '2026-02-10', Angebot_Am: '2026-02-12', Bestellt_Am: '2026-02-20', Produktion_Am: '2026-03-05', Fertig_Am: '2026-03-15',
  Uebergeben_Am: '2026-03-18', Bezahlt_Am: '2026-03-30', Angelegt: '2026-02-10T09:00:00.000Z', Lexoffice_Rechnung: 'RE-2026-0211' }, [
  ...gruppe('JN054', 'black', { S: 3, M: 5, L: 4 }, { Motiv: 'Vereinswappen Brust links', Druck: 'Flex weiß', Preis_Netto: 16.5, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-03-15', Versendet: '2026-03-18', Korb_Schluessel: 'EIGEN:2026-0008' }),
  ...gruppe('SG40', 'heather grey', { L: 2, XL: 2 }, { Motiv: 'Wappen groß Rücken', Druck: 'Siebdruck', Preis_Netto: 34, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-03-15', Versendet: '2026-03-18', Korb_Schluessel: 'EIGEN:2026-0009' }),
  frei('Trainerjacke (Kunde bringt mit) – Wappen sticken', 2, { Herkunft: 'vorhanden', Preis_Netto: 15, USt_Satz: 19, Fertig: 'ja', Fertig_Am: '2026-03-15', Versendet: '2026-03-18' }),
]);

// Korb (Warenkorb_LShop) nur mit den Feldern, die korbStand/standFuer lesen
const korbZ = (Schluessel, Status, o = {}) => ({ Schluessel, Status, Bestell_ID: '', Liefertermin: '', Hinweis: '', AB_Hinweis: '', Status_Datum: '2026-11-12', ...o });
const KORB = new Map([
  korbZ('EIGEN:2026-0110', 'bestellt', { Bestell_ID: 'JFN-2026-0019', AB_Hinweis: 'ok', Liefertermin: '2026-11-24' }),
  korbZ('EIGEN:2026-0111', 'bestellt', { Bestell_ID: 'JFN-2026-0019' }),
  korbZ('EIGEN:2026-0112', 'geliefert', { Bestell_ID: 'JFN-2026-0019', Status_Datum: '2026-11-18' }),
  korbZ('EIGEN:2026-0090', 'geliefert', { Bestell_ID: 'JFN-2026-0015' }),
  korbZ('EIGEN:2026-0091', 'geliefert', { Bestell_ID: 'JFN-2026-0015' }),
  korbZ('EIGEN:2026-0092', 'geliefert', { Bestell_ID: 'JFN-2026-0015' }),
  korbZ('EIGEN:2026-0070', 'geliefert', { Bestell_ID: 'JFN-2026-0011' }),
  korbZ('EIGEN:2026-0071', 'geliefert', { Bestell_ID: 'JFN-2026-0011' }),
  korbZ('EIGEN:2026-0031', 'geliefert', { Bestell_ID: 'JFN-2026-0006' }),
  korbZ('EIGEN:2026-0008', 'geliefert', { Bestell_ID: 'JFN-2026-0002' }),
  korbZ('EIGEN:2026-0009', 'geliefert', { Bestell_ID: 'JFN-2026-0002' }),
  korbZ('EIGEN:2026-0120', 'offen'),
  korbZ('EIGEN:2026-0121', 'bestellt', { Bestell_ID: 'JFN-2026-0020', Hinweis: '' }),
].map(z => [z.Schluessel, z]));
// AU-2026-0038 hat mehrere Positionen auf demselben Schluessel - fuer die Anzeige egal

// ── Aufgaben + To-dos ────────────────────────────────────────────────────────
const leerAg = () => Object.fromEntries([...AG.AUFGABE_SPALTEN, 'Zustaendig'].map(s => [s, '']));
const AUFGABEN = [
  { ...leerAg(), Aufgabe_Nr: 'AG-2026-0012', Kurztitel: 'Musterteile für Messestand 2027 beim Großhändler anfragen und Preise vergleichen', Notiz: 'Mindestens drei Angebote.', Faellig: '2026-11-17', Status: 'offen', Fuer_Art: 'intern', Offen_Am: '2026-11-10', Angelegt: '2026-11-10T08:00:00.000Z', Stand: '2026-11-10T08:00:00.000Z', Zustaendig: 'Christian' },
  { ...leerAg(), Aufgabe_Nr: 'AG-2026-0013', Kurztitel: 'Rückruf wegen Vereinsfarben', Faellig: '2026-11-19', Status: 'in Arbeit', Fuer_Art: 'kunde', Fuer: 'K-00001', Gehoert_Zu: 'AU-2026-0041', Offen_Am: '2026-11-18', In_Arbeit_Am: '2026-11-19', Angelegt: '2026-11-18T16:00:00.000Z', Stand: '2026-11-19T07:00:00.000Z', Zustaendig: 'Nicole' },
  { ...leerAg(), Aufgabe_Nr: 'AG-2026-0014', Kurztitel: 'Produktfotos Wintermütze', Faellig: '2026-11-24', Status: 'wartet', Fuer_Art: 'artikel', Fuer: '15783', Wartet_Auf: 'Lieferung Musterstücke', Offen_Am: '2026-11-12', Wartet_Am: '2026-11-14', Angelegt: '2026-11-12T10:00:00.000Z', Stand: '2026-11-14T10:00:00.000Z' },
  { ...leerAg(), Aufgabe_Nr: 'AG-2026-0011', Kurztitel: 'Stickprogramm archivieren', Faellig: '2026-11-08', Status: 'erledigt', Fuer_Art: 'intern', Offen_Am: '2026-11-01', Erledigt_Am: '2026-11-07', Angelegt: '2026-11-01T10:00:00.000Z', Stand: '2026-11-07T10:00:00.000Z' },
].map((x, i) => ({ ...x, Vorgang: `vg-${i}`, _zeile: i + 2 }));
const leerTd = () => Object.fromEntries(AG.TODO_SPALTEN.map(s => [s, '']));
const td = (bezug, n, Text, Faellig = '', o = {}) => ({ ...leerTd(), Todo_ID: `${bezug}-T${String(n).padStart(2, '0')}`, Bezug: bezug, Text, Faellig, Reihenfolge: String(n),
  Angelegt: '2026-11-15T09:00:00.000Z', Stand: '2026-11-15T09:00:00.000Z', ...o });
const TODOS = [
  td('AU-2026-0041', 1, 'Sponsorlogo als Vektordatei beim Kassenwart anfordern', '2026-11-17'),
  td('AU-2026-0041', 2, 'Nummernliste mit Größen abgleichen – zwei Spieler haben noch keine Größe gemeldet, bitte nachfragen', '2026-11-19'),
  td('AU-2026-0041', 3, 'Probedruck zeigen', '2026-11-21'),
  td('AU-2026-0041', 4, 'Farbe Flex bestätigen lassen', '', { Erledigt: 'ja', Erledigt_Am: '2026-11-18' }),
  td('AU-2026-0040', 1, 'Rest-Lieferung L-Shop prüfen', '2026-11-24'),
  td('AU-2026-0038', 1, 'Rechnung schreiben (Abschlag verrechnen)', '2026-11-14'),
  td('AU-2026-0032', 1, 'Foto in besserer Auflösung anfragen', '2026-11-12'),
  td('AG-2026-0012', 1, 'Großhändler A anschreiben', '2026-11-16'),
  td('AG-2026-0012', 2, 'Großhändler B anschreiben', '2026-11-25'),
  td('AG-2026-0013', 1, 'Pantone-Fächer bereitlegen'),
  td('AU-2026-0036', 1, 'alte Aufgabe (erledigter Auftrag)', '2026-08-01'),
].map((x, i) => ({ ...x, Vorgang: `vt-${i}`, _zeile: i + 2 }));

// ── GET /api/auftraege (wie leseAuftraege in lib/auftraege.js) ───────────────
function summenFuer(auftrag, aktive) {
  const eingaben = aktive.map(p => PR.positionAusZeile(p, { groesse: INFO.get(p.LShop_ArticleNr)?.groesse ?? '', ekAuto: p.LShop_ArticleNr ? EK_JE.get(p.LShop_ArticleNr)?.ek ?? null : null }));
  let rabatt = null;
  try { rabatt = PR.rabattAus(auftrag.Rabatt); } catch { /* ohne */ }
  return PR.auftragSummen(eingaben, rabatt);
}
function auftraegeAntwort() {
  const anreichern = x => ({
    ...x,
    ...(x.LShop_ArticleNr ? { lshop: INFO.get(x.LShop_ArticleNr) ?? { bestellbar: false } } : {}),
    ...(x.Korb_Schluessel ? { korb: AU.korbStand(KORB.get(x.Korb_Schluessel)) } : {}),
    ...(AU.VERWEIS_KORB.test(String(x.Verweis ?? '')) ? { verweisKorb: AU.korbStand(KORB.get(String(x.Verweis).trim())) } : {}),
  });
  const ware = new Map();
  const auftraege = AU.auftraegeAntwort(AUFTRAEGE, POSITIONEN, x => {
    const y = anreichern(x);
    const e = x.LShop_ArticleNr ? EK_JE.get(x.LShop_ArticleNr) : null;
    return e ? { ...y, ekAuto: e.ek, ekStand: e.stand } : y;
  }).map(x => {
    const akt = AU.aktivePositionen(POSITIONEN, x.Auftrag_Nr);
    const summen = summenFuer(x, akt);
    const w = AU.wareStand(akt, KORB);
    ware.set(x.Auftrag_Nr, w);
    return {
      ...x, vorschlagFertig: AU.fertigVorschlag(x, akt), ware: w,
      freiOffen: akt.filter(y => y.Art === AU.ART.FREI && !y.Herkunft && !String(y.Da_Am ?? '').trim()).length,
      autoBestellt: false,
      preise: { ...summen, angebotGeaendert: PR.angebotAbweichung(x, summen) },
    };
  });
  const todos = TODOS.filter(AG.todoAktiv);
  const offenJe = new Map([...AUFTRAEGE.map(x => [x.Auftrag_Nr, x.Status !== 'storniert' && x.Status !== 'bezahlt']), ...AUFGABEN.map(x => [x.Aufgabe_Nr, AG.aufgabeOffen(x)])]);
  return {
    auftraege, aufgaben: AUFGABEN.map(AG.ohneIntern), todos: todos.map(AG.ohneIntern),
    zahlen: { ...AU.auftragZahlen(AUFTRAEGE, ISO, ware), ...AG.aufgabenZahlen(AUFGABEN, todos, ISO, nr => offenJe.get(nr) ?? false) },
    designSpalte: true,
    spalten: { preise: true, rabatt: true, angebot: true, zustaendig: true, zustaendigAufgaben: true, preisEingabe: true, designLink: true },
    zustaendigAuswahl: PR.ZUSTAENDIG,
    einrichtung: { aufgaben: true, todos: true },
  };
}
const AUFTRAEGE_ANTWORT = auftraegeAntwort();

// ── Kunden ───────────────────────────────────────────────────────────────────
const KUNDEN_ANTWORT = { kunden: KU.kundenAntwort(KUNDEN), anzahl: KUNDEN.length };
const KUNDEN_ZAHLEN = { ...KU.kundenZahlen(KUNDEN), auftraege: AUFTRAEGE_ANTWORT.zahlen };

function historie(nr) {
  if (!/^K-\d{5}$/.test(nr)) return undefined;
  const eigene = new Set(AUFTRAEGE.filter(x => x.Kunden_Nr === nr).map(x => x.Auftrag_Nr));
  const pos = POSITIONEN.filter(x => eigene.has(x.Auftrag_Nr) && !x.Entfernt);
  return HI.kundenHistorie({ auftraege: AUFTRAEGE, positionen: pos, info: INFO, kundenNr: nr });
}

// ── Rueckstand (RS1) ─────────────────────────────────────────────────────────
function rueckstand() {
  const kopf = ['Kundennr', 'Auftrag', 'INET', 'Fremdbeleg', 'Kommission', 'Bestelldatum', 'LieferantArtNr', 'KatalogNr', 'Bezeichnung', 'Farbe', 'Größe', 'Bestellt', 'Geliefert', 'Menge im Rückstand', 'Liefertermin'];
  const z = (fb, nr, best, gel, rueck, lt) => { const i = INFO.get(nr); return ['00000', 'VA-0000000', '', fb, 'JFN Sammelbestellung KW46', '10.11.2026', nr, i.modell, i.bezeichnung, i.farbe, i.groesse, best, gel, rueck, lt]; };
  const pos = RS.rueckstandPositionen([kopf,
    z('JFN-2026-0019', nrVon('SG40', 'black', 'M'), 6, 0, 6, '6 Stk ca. KW 49/2026'),
    z('JFN-2026-0019', nrVon('SG40', 'black', 'S'), 4, 2, 2, '2 Stk in Klärung'),
    z('JFN-2026-0020', nrVon('JN054', 'navy', '3XL'), 1, 0, 1, '1 Stk unbekannt'),
    z('JFN-2026-0018', nrVon('BCTU01T', 'royal blue', 'XL'), 12, 4, 8, '5 Stk sofort 3 Stk ca. KW 48/2026'),
    z('', nrVon('RT076', 'black', 'one size'), 30, 0, 30, '30 Stk ca. KW 50/2026'),
  ]);
  const korb = [
    { Schluessel: 'EIGEN:2026-0110', Bestell_ID: 'JFN-2026-0019', LShop_ArticleNr: nrVon('SG40', 'black', 'S'), Referenz: 'AU-2026-0040', Herkunft: 'eigen', referenz: 'AU-2026-0040' },
    { Schluessel: 'EIGEN:2026-0111', Bestell_ID: 'JFN-2026-0019', LShop_ArticleNr: nrVon('SG40', 'black', 'M'), Referenz: 'AU-2026-0040', Herkunft: 'eigen', referenz: 'AU-2026-0040' },
    { Schluessel: 'EIGEN:2026-0121', Bestell_ID: 'JFN-2026-0020', LShop_ArticleNr: nrVon('JN054', 'navy', '3XL'), Referenz: 'AU-2026-0031', Herkunft: 'eigen', referenz: 'AU-2026-0031' },
    { Schluessel: 'JFN:48211:9001', Bestell_ID: 'JFN-2026-0018', LShop_ArticleNr: nrVon('BCTU01T', 'royal blue', 'XL'), Referenz: '', Herkunft: 'shop', Shop: 'JFN', Bestellnummer: '48211', referenz: 'JFN-48211-9001' },
  ];
  const antwort = RS.rueckstandAntwort(RS.zuordnen(pos, { korb, edi: new Set(['JFN-2026-0018', 'JFN-2026-0019', 'JFN-2026-0020']) }));
  return { liste: { name: 'Rueckstandsliste_2026-11-18.xlsx', datum: '2026-11-18', alterTage: 1, veraltet: false }, ...antwort, hinweis: '' };
}
const RUECKSTAND = rueckstand();

// ── Bestellseiten (KS1-KS7) ──────────────────────────────────────────────────
const leerZ = () => Object.fromEntries(BS.ZUGANG_ALLE.map(s => [s, '']));
const HASH = c => c.repeat(64);
const ZUGAENGE = [
  { ...leerZ(), Zugang_ID: 'BS-001', Art: 'dauer', Kunden_Nr: 'K-00002', Token_Hash: HASH('a'), Token_Verschluesselt: 'v1.x.y.z', Aktiv: 'ja', Ablauf: '2027-06-30',
    Bestellschluss_Tage: '4', Empfohlen_Tage: '7', Sortiment: '310,315', Hinweis: 'Bitte Kürzel angeben, damit wir die Bestellungen beim Ausgeben zuordnen können. Abholung immer am Fanshop-Stand vor dem Heimspiel.', Angelegt: '2026-10-01', Stand: '2026-11-15T10:00:00.000Z' },
  { ...leerZ(), Zugang_ID: 'BS-002', Art: 'auftrag', Kunden_Nr: 'K-00003', Auftrag_Nr: 'AU-2026-0042', Token_Hash: HASH('b'), Aktiv: 'ja', Ablauf: '2027-01-04',
    Bestellschluss_Tage: '4', Empfohlen_Tage: '7', Hinweis: 'Bestellung für das Sommerfest-Team', Angelegt: '2026-11-12', Stand: '2026-11-18T08:00:00.000Z', Design_Link_Zeigen: 'ja',
    Titel: 'Sommerfest-Team Muster GmbH – Shirts und Polos für alle Standorte', Bestellschluss_Datum: '2026-11-28', Personalisierung: 'ja', Abschliessen: 'ja', Entwurf_Ordner: 'drive-ordner-demo',
    Auswahl: JSON.stringify([{ modell: 'JN054', farben: ['black'], name: 'Damen-Shirt', motiv: 'Logo Brust' }, { modell: 'BCTU01T', farben: ['royal blue', 'black'], name: 'Herren-Shirt Rundhals mit großem Rückendruck', motiv: 'Logo Brust + Rücken' }]) },
  { ...leerZ(), Zugang_ID: 'BS-003', Art: 'auftrag', Kunden_Nr: 'K-00013', Auftrag_Nr: 'AU-2026-0036', Token_Hash: HASH('c'), Aktiv: 'nein', Ablauf: '2026-08-31',
    Bestellschluss_Tage: '4', Empfohlen_Tage: '7', Angelegt: '2026-06-12', Stand: '2026-09-01T08:00:00.000Z', Abgeschlossen: '2026-07-02T18:00:00.000Z' },
];
const TERMINE = [
  { Termin_ID: 'BT-0001', Zugang_ID: 'BS-001', Datum: '2026-11-22', Notiz: 'Heimspiel gegen Beispiel-Elf', Bestellschluss: '2026-11-18', Auftrag_Nr: 'AU-2026-0031', Status: 'offen', Angelegt: '2026-10-20T10:00:00.000Z', Stand: '2026-11-11T10:00:00.000Z' },
  { Termin_ID: 'BT-0002', Zugang_ID: 'BS-001', Datum: '2026-12-06', Notiz: 'Weihnachtsheimspiel – Sonderverkauf mit Glühwein und Fanartikeln am Nordeingang', Bestellschluss: '2026-12-02', Auftrag_Nr: '', Status: 'offen', Angelegt: '2026-11-01T10:00:00.000Z', Stand: '2026-11-01T10:00:00.000Z' },
  { Termin_ID: 'BT-0004', Zugang_ID: 'BS-001', Datum: '2026-11-08', Notiz: '', Bestellschluss: '2026-11-04', Auftrag_Nr: '', Status: 'offen', Angelegt: '2026-10-10T10:00:00.000Z', Stand: '2026-10-10T10:00:00.000Z' },
  { Termin_ID: 'BT-0003', Zugang_ID: 'BS-002', Datum: '2026-12-05', Notiz: '', Bestellschluss: '2026-11-28', Auftrag_Nr: 'AU-2026-0042', Status: 'offen', Angelegt: '2026-11-12T10:00:00.000Z', Stand: '2026-11-12T10:00:00.000Z' },
];
const leerE = () => Object.fromEntries([...BS.EINTRAG_SPALTEN, ...BE.EINTRAG_OPTIONAL].map(s => [s, '']));
const ein = o => ({ ...leerE(), Stand: o.Zeit, ...o });
const EINTRAEGE = [
  ein({ Eintrag_ID: 'BE-00001', Zugang_ID: 'BS-001', Termin_ID: 'BT-0001', Kuerzel: 'Jens', Art: 'artikel', WC_Variation_ID: '16101', Bezeichnung: 'Fanshirt Möwe navy', Groesse: 'M', Menge: '2', Zeit: '2026-11-10T18:00:00.000Z', Status: 'übernommen', Auftrag_Nr: 'AU-2026-0031', Position_ID: 'AU-2026-0031-01' }),
  ein({ Eintrag_ID: 'BE-00002', Zugang_ID: 'BS-001', Termin_ID: 'BT-0001', Kuerzel: 'Mo', Art: 'artikel', WC_Variation_ID: '16107', Bezeichnung: 'Fanshirt Möwe navy', Groesse: '3XL', Menge: '1', Zeit: '2026-11-10T19:10:00.000Z', Status: 'übernommen', Auftrag_Nr: 'AU-2026-0031', Position_ID: 'AU-2026-0031-02', Notiz: 'bitte etwas länger, falls möglich' }),
  ein({ Eintrag_ID: 'BE-00003', Zugang_ID: 'BS-001', Termin_ID: 'BT-0001', Kuerzel: 'Kim', Art: 'extra', Freitext: 'Aufnäher Fanclub, 20 Stück, Rand in Vereinsgold wie letzte Saison', Menge: '20', Fuer: 'Fanclub-Stand', Zeit: '2026-11-11T09:00:00.000Z', Status: 'übernommen', Auftrag_Nr: 'AU-2026-0031', Position_ID: 'AU-2026-0031-06' }),
  ein({ Eintrag_ID: 'BE-00004', Zugang_ID: 'BS-001', Termin_ID: 'BT-0002', Kuerzel: 'Jens', Art: 'trikot', Trikot_Produkt: '9001', Bezeichnung: 'Heimtrikot 2026/27', Groesse: 'L', Trikot_Name: 'MUSTERMANN', Trikot_Nummer: '7', Wunsch: 'Name bitte in Großbuchstaben', Menge: '1', Zeit: '2026-11-18T20:00:00.000Z', Status: 'eingegangen' }),
  ein({ Eintrag_ID: 'BE-00005', Zugang_ID: 'BS-001', Termin_ID: 'BT-0002', Kuerzel: 'Anke', Art: 'artikel', WC_Variation_ID: '16220', Bezeichnung: 'Wintermütze Möwe mit Bommel und eingesticktem Schriftzug', Groesse: 'one size', Menge: '3', Zeit: '2026-11-19T06:40:00.000Z', Status: 'eingegangen', Nach_Schluss: '' }),
  ein({ Eintrag_ID: 'BE-00006', Zugang_ID: 'BS-001', Termin_ID: 'BT-0002', Kuerzel: 'Lu', Art: 'artikel', WC_Variation_ID: '16221', Bezeichnung: 'Schal Möwe', Groesse: 'one size', Menge: '1', Zeit: '2026-11-17T12:00:00.000Z', Status: 'geprüft' }),
  ein({ Eintrag_ID: 'BE-00007', Zugang_ID: 'BS-001', Termin_ID: 'BT-0001', Kuerzel: 'Ole', Art: 'artikel', WC_Variation_ID: '16102', Bezeichnung: 'Fanshirt Möwe navy', Groesse: 'L', Menge: '1', Zeit: '2026-11-19T07:30:00.000Z', Status: 'storniert', Ablehn_Grund: 'nach Bestellschluss, Größe nicht mehr lieferbar', Nach_Schluss: 'ja' }),
  ein({ Eintrag_ID: 'BE-00008', Zugang_ID: 'BS-002', Termin_ID: 'BT-0003', Kuerzel: 'Petra', Art: 'artikel', LShop_ArticleNr: nrVon('JN054', 'black', 'M'), Bezeichnung: 'Damen-Shirt black', Groesse: 'M', Menge: '1', Trikot_Name: 'PETRA', Zeit: '2026-11-15T10:00:00.000Z', Status: 'übernommen', Auftrag_Nr: 'AU-2026-0042', Position_ID: 'AU-2026-0042-02' }),
  ein({ Eintrag_ID: 'BE-00009', Zugang_ID: 'BS-002', Termin_ID: 'BT-0003', Kuerzel: 'Sven', Art: 'artikel', LShop_ArticleNr: nrVon('BCTU01T', 'royal blue', 'XL'), Bezeichnung: 'Herren-Shirt Rundhals mit großem Rückendruck royal blue', Groesse: 'XL', Menge: '2', Zeit: '2026-11-18T13:00:00.000Z', Status: 'eingegangen' }),
];
const POS_JE = new Map(POSITIONEN.map(p => [p.Position_ID, p]));
function zugaengeAntwort() {
  return {
    zugaenge: ZUGAENGE.map(x => BS.zugangFuerMc(x, ISO, TERMINE)).sort((a, b) => b.Zugang_ID.localeCompare(a.Zugang_ID)),
    bilderStand: '2026-11-15T09:00:00.000Z', bilderAnzahl: 214,
    spalten: { designLink: true, linkVerschluesselt: true },
    linkSchluessel: true,
  };
}
function eintraegeMc(zugangId) {
  if (!ZUGAENGE.some(z => z.Zugang_ID === zugangId)) return undefined;
  const liste = EINTRAEGE.filter(x => x.Zugang_ID === zugangId).sort((a, b) => a.Zeit.localeCompare(b.Zeit) || a.Eintrag_ID.localeCompare(b.Eintrag_ID));
  const terminDatum = new Map(TERMINE.filter(x => x.Zugang_ID === zugangId).map(x => [x.Termin_ID, x.Datum]));
  const offen = ['eingegangen', 'geprüft'];
  return {
    zugangId,
    eintraege: liste.map(x => ({ ...BE.eintragFuerSeite(x), auftragNr: x.Auftrag_Nr, positionId: x.Position_ID,
      fortschritt: ST.standFuer(x, { posJe: POS_JE, korbJe: KORB, terminDatum: terminDatum.get(x.Termin_ID) ?? '' }),
      ...(offen.includes(x.Status) ? {
        alternativen: x.Art === 'artikel' ? ['S', 'M', 'L', 'XL'].map((g, i) => ({ id: x.WC_Variation_ID ? String(Number(x.WC_Variation_ID) + i) : nrVon('BCTU01T', 'royal blue', g), groesse: g })) : undefined,
        trikotGroessen: x.Art === 'trikot' ? ['152', '164', 'S', 'M', 'L', 'XL', '2XL'] : undefined,
      } : {}) })),
    eingerichtet: true, ablehnen: true, spalten: { verschieben: true, geliefert: true },
  };
}
const KATEGORIEN = { kategorien: [
  { nr: '300', pfad: 'Vereine' },
  { nr: '310', pfad: 'Vereine > Fanclub Weiße Möwe' },
  { nr: '311', pfad: 'Vereine > Fanclub Weiße Möwe > Shirts' },
  { nr: '312', pfad: 'Vereine > Fanclub Weiße Möwe > Mützen und Schals für die kalte Jahreszeit' },
  { nr: '315', pfad: 'Vereine > Fanclub Weiße Möwe > Trikots' },
  { nr: '320', pfad: 'BoysLove' },
  { nr: '121', pfad: 'Partner > Testpartner Beispiel' },
] };

// ── Dashboard (DB1) ──────────────────────────────────────────────────────────
function dashboard(wer) {
  const o = (id, status, date_created, total, nachname, extra = {}) => ({ id, number: String(id), status, date_created, total, currency: 'EUR',
    billing: { first_name: 'Test', last_name: nachname }, customer_note: '', shipping_lines: [{ method_id: 'flat_rate', instance_id: '1', method_title: 'Versand' }], line_items: [], ...extra });
  const offen = [
    o(48190, 'processing', '2026-11-02T10:15:00', '64.80', 'Kundin Lang', { customer_note: 'Bitte als Geschenk verpacken und ohne Rechnung im Paket versenden, die Rechnung bitte per Mail an mich. Danke!' }),
    o(48205, 'on-hold', '2026-11-09T21:40:00', '129.90', 'Vorkasse'),
    o(48211, 'processing', '2026-11-12T08:05:00', '39.95', 'Abholer', { shipping_lines: [{ method_id: 'local_pickup', instance_id: '6', method_title: 'Abholung Stadion' }] }),
    o(48230, 'processing', '2026-11-18T17:22:00', '12345.67', 'Großbestellung'),
    o(48241, 'processing', '2026-11-19T07:55:00', '24.90', 'Neu', { customer_note: 'Größe M statt L, falls noch möglich.' }),
  ];
  const woche = [
    ...offen.filter(x => x.date_created >= '2026-11-13'),
    o(48220, 'completed', '2026-11-15T12:00:00', '89.70', 'Fertig'),
    o(48225, 'completed', '2026-11-16T09:30:00', '45.00', 'Fertig'),
    o(48238, 'cancelled', '2026-11-18T11:00:00', '19.90', 'Storno'),
  ];
  const norm = x => DB.shopBestellung(x, 'jfn', { artikel: null, trikotOrderIds: new Set() });
  const shops = { jfn: { offen: offen.map(norm), woche: woche.map(norm), neu: woche.map(norm) } };
  const kundenMap = new Map(KUNDEN.map(k => [k.Kunden_Nr, String(k.Spitzname ?? '').split(';')[0].trim() ? `${k.Name} (${String(k.Spitzname).split(';')[0].trim()})` : k.Name]));
  const d = DB.baueDashboard({ shops, shop: 'jfn', au: AUFTRAEGE_ANTWORT, kunden: kundenMap, rueckstand: RUECKSTAND,
    trikots: { summen: { offen: 7, goalieOffen: 1 } }, gelesen: new Map(), wer, jetzt: JETZT, fehler: {},
    bestellseiten: BU.ungepruefteZahlen(EINTRAEGE) });
  return { ...d, fehlerText: {}, einrichtung: { gelesen: true } };
}

// ── Router ───────────────────────────────────────────────────────────────────
export function antwort(method, pfad, params, body) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(pfad || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (m !== 'GET') return undefined;
  if (p === '/health') return { status: 'ok', ts: Date.now(), commit: 'f1x7ure', gebaut: '2026-11-19T08:00:00.000Z' };
  if (p === '/api/health/full') return { ok: true, services: { woocommerce: { ok: true, ms: 120 }, sheet: { ok: true, ms: 80 }, claude: { ok: true, ms: 300 } } };
  if (p === '/api/auftraege') return AUFTRAEGE_ANTWORT;
  let x = /^\/api\/(?:auftraege\/)?kunden\/(K-\d{5})\/historie$/.exec(p);
  if (x) return historie(x[1]);
  if (p === '/api/kunden') return KUNDEN_ANTWORT;
  if (p === '/api/kunden/zahlen') return KUNDEN_ZAHLEN;
  if (p === '/api/kunden/lexoffice-schreiben') return { bereit: true };
  if (p === '/api/bestellen/rueckstand') return RUECKSTAND;
  if (p === '/api/bestellseiten') return zugaengeAntwort();
  if (p === '/api/bestellseiten/kategorien') return KATEGORIEN;
  x = /^\/api\/bestellseiten\/auftrag\/([^/]+)\/eintraege$/.exec(p);
  if (x) { const nr = decodeURIComponent(x[1]); return { auftragNr: nr, eintraege: BU.eintraegeJePosition(EINTRAEGE, nr) }; }
  x = /^\/api\/bestellseiten\/([^/]+)\/eintraege$/.exec(p);
  if (x) return eintraegeMc(decodeURIComponent(x[1]));
  x = /^\/api\/bestellseiten\/([^/]+)\/entwuerfe$/.exec(p);
  if (x) return { ordner: false, entwuerfe: [], mehr: false, ausgelassen: 0 };
  if (p === '/api/dashboard') {
    const w = params?.get?.('wer') ?? '';
    return dashboard(w);
  }
  return undefined;
}
