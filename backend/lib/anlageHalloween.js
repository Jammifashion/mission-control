// Halloween-Kollektion 2026 anlegen (Auftrag HW2) - Kategorie + 5 variable
// Artikel als ENTWURF, Achsen Farbe (global, ein Wert) x Groesse (global) x
// Motiv (lokal, 8 Werte). Aufrufer: backend/scripts/anlage-halloween.js.
//
// Grundlage: bericht-HW1 + Entscheidungen Inhaber 10.10. (Postfach). Die Maske
// kann das nicht sicher: sie legt Variationen einzeln und ungedrosselt an (je
// Artikel 48-72 POSTs, Hoster-Pruefseite nach ~11 schnellen Abrufen) und bietet
// keinen freien Achsennamen an. Darum hier, mit denselben Bausteinen:
//   sku.js (Artikelnummer, Varianten-SKUs, 50 Zeichen, Dubletten)
//   varianten-achsen.js (Farbachse Pflicht, _wc_gla_color = Farbwert 1:1)
//   lieferzeiten.js (Standard am Elternartikel, "-1" an jeder Variation)
//   lshop.js (lshopAuswertung: Farben, Groessen, ArticleNr, Discontinued)
//   groessen.js (Rang/Sortierung, menu_order), varianten-zeilen.js (Zeilen),
//   wc-variation-ids.js (Sperre gegen doppelte Variationen, Zuordnung der IDs
//   NUR ueber die Kombination).
//
// Global oder lokal (Befund HW1, Luecke 2): WooCommerce REST v3 macht ein
// Attribut nur dann global, wenn es mit `id` kommt; `name` allein ergibt ein
// lokales Attribut. Die Maske sendet nie eine id. Hier: Farbe und Groesse MIT
// id (ermittelt ueber den Namen aus products/attributes, keine IDs im Code),
// Motiv OHNE id. Ein globales Attribut "Motiv" ist dafuer NICHT noetig - gaebe
// es eins, bliebe "Motiv" trotzdem lokal, weil es ohne id gesendet wird.
//
// Variations-SKU: Die vollen Motivtitel passen nicht in 50 Zeichen
// ("JH030F/HW-Halloween-deep-black-xxl-ich-bin-wegen-des-kuchens-hier" = 65).
// Der SKU-Teil des Motivs ist darum ein fester Kurzwert je Motiv (MOTIVE.sku),
// gebaut mit baueVariantenSkus wie in der Maske. Achse und Varianten-Reiter
// tragen den vollen Titel.
//
// Ablauf --write je Artikel: GET products?sku (Fortsetzen) -> Produkt-POST als
// Entwurf -> variations/batch in Bloecken <= 50, 2 s Takt -> alle Variationen
// zuruecklesen -> erst wenn ALLE Kombinationen im Shop stehen: Maske- und
// Varianten-Zeile (mit WC_Variation_ID). Pruefseite, Zeitlimit oder 502 ->
// AnlageStopp mit Stand; der naechste Lauf findet Produkt und Variationen ueber
// SKU und Kombination wieder und legt nur Fehlendes an.

import { baueArtikelnummer, baueVariantenSkus, normalisiereTeil } from './sku.js';
import { achsenVon, pruefeFarbAchse, mitGoogleFarbe, FARB_ACHSE } from './varianten-achsen.js';
import { LIEFERZEIT_WIE_ELTERN, mitLieferzeit, parseLieferzeiten } from './lieferzeiten.js';
import { lshopAuswertung } from './lshop.js';
import { groessenRang, sortiereGroessen, variantenReihenfolge } from './groessen.js';
import { leseAlleVariationen, sperreDoppelte, wcSchluessel, paareAusWc, ordneWcIdsZu } from './wc-variation-ids.js';
import { istLaufStopp, seitenGrenze, seitenListe } from './hosterPruefseite.js';
import { baueVariantenZeilen, pruefeVariantenPayload } from '../utils/varianten-zeilen.js';
import { buildRow } from '../utils/sheet-rows.js';
import { findHeader, requireHeader, requireHeaderAny } from '../utils/sheet-headers.js';
import { letzteZeile, schreibeNeueZeilen } from './sheet-zeilen.js';
// Weiter von hier exportiert (Aufrufer und Tests aus FM2).
export { letzteZeile, zellText, zeilenAbweichungen, spalteBuchstabe, schreibeNeueZeilen, ersetzeZeile } from './sheet-zeilen.js';

// ── Festlegungen (Entscheidungen Inhaber 10.10.) ────────────────────────────

export const KURZ        = 'HW-Halloween';
export const MOTIV_ACHSE = 'Motiv';
export const GROESSE_ACHSE = 'Größe';
export const KATEGORIE   = { name: 'Halloween', slug: 'halloween', parent: 0 };
export const TAKT_MS     = 2000;
export const BLOCK_MAX   = 50;
// Platzhalter: Entwurf, der Text kommt danach ueber den normalen SEO-Flow.
export const TEXT_PLATZHALTER = '<p>Text folgt (SEO-Flow).</p>';

// Reihenfolge = Reihenfolge der Auswahl im Shop. sku = SKU-Teil (normalisiert).
// aufdruck = Text auf dem Mockup (HW3), bild = was zu sehen ist. Alle 8 sind
// eigene Motive: kein Werk- oder Figurenname (Entscheidung Inhaber 10.10., HW3).
// mockup = Schluesselwort im Dateinamen der Mockups (klein geschrieben).
export const MOTIVE = [
  { titel: 'There the Dog',                    sku: 'dog',       bild: 'Mops in der Pfanne',
    aufdruck: 'There the Dog – in the pan becomes crazy!', mockup: ['dog'] },
  { titel: 'There the Otter',                  sku: 'otter',     bild: 'Otter in der Pfanne',
    aufdruck: 'There the Otter – in the pan becomes crazy!', mockup: ['otter'] },
  { titel: 'Free Hugs',                        sku: 'freehugs',  bild: 'Sensenmann',
    aufdruck: 'Free Hugs', mockup: ['free_hugs'] },
  { titel: "Trust me, I'm a Doctor",           sku: 'doctor',    bild: 'Pestdoktor',
    aufdruck: "Trust me, I'm a Doctor", mockup: ['trust_me', 'trus_me'] },
  { titel: 'Vertrau mir, ich bin Arzt',        sku: 'arzt',      bild: 'Zombie-Arzt im Kittel',
    aufdruck: 'Vertrau mir, ich bin Arzt!', mockup: ['vertrau_mir'] },
  { titel: 'Ich will doch nur spielen',        sku: 'clown',     bild: 'Horror-Clown mit Kettensäge',
    aufdruck: 'Ich will doch nur spielen!', mockup: ['spielen'] },
  { titel: 'Stay alive – Challenge accepted',  sku: 'stayalive', bild: 'Zombie-T-Rex',
    aufdruck: 'Stay alive – Challenge accepted!', mockup: ['stay_alive'] },
  { titel: 'Ich bin wegen des Kuchens hier',   sku: 'kuchen',    bild: 'Maskierter mit Axt',
    aufdruck: 'Ich bin wegen des Kuchens hier!', mockup: ['kuchens'] },
];

// Groessen: von/bis in L-Shop-Schreibweise; null = alle waehlbaren.
// farbe null = aus LShop_Modelle: genau eine Modellfarbe mit "wash" und "black"
// (fuer JH180 gebaut; JH180 entfaellt laut Inhaber 10.10., Logik bleibt getestet).
// mockupPraefix = Anfang der Mockup-Dateinamen dieses Artikels.
export const ARTIKEL = [
  { titel: 'Halloween Shirt Herren',   modell: 'E3000',  farbe: 'Black',      von: 'XS', bis: '5XL', versand: 'grossbrief', mockupPraefix: 'E3000 ',
    keyphrase: 'Halloween Shirt Herren',   synonyme: ['Halloween T-Shirt Herren', 'Horror Shirt Herren', 'Grusel Shirt'] },
  { titel: 'Halloween Shirt Damen',    modell: 'E3005',  farbe: 'Black',      von: 'XS', bis: '3XL', versand: 'grossbrief', mockupPraefix: 'E3005 ',
    keyphrase: 'Halloween Shirt Damen',    synonyme: ['Halloween T-Shirt Damen', 'Horror Shirt Damen'] },
  { titel: 'Halloween Pullover Herren', modell: 'JH030', farbe: 'Deep Black', von: 'XS', bis: '5XL', versand: 'paket', mockupPraefix: 'JH030_',
    keyphrase: 'Halloween Pullover Herren', synonyme: ['Halloween Sweatshirt Herren', 'Horror Pullover'] },
  { titel: 'Halloween Pullover Damen', modell: 'JH030F', farbe: 'Deep Black', von: 'XS', bis: 'XXL', versand: 'paket', mockupPraefix: 'JH030F_',
    keyphrase: 'Halloween Pullover Damen', synonyme: ['Halloween Sweatshirt Damen'] },
];

export const KATEGORIE_KARTE = {
  keyphrase: 'Halloween Shirts',
  synonyme:  ['Halloween T-Shirts', 'Horror Shirts', 'Halloween Pullover'],
};

// Vorschlaege fuer SSOT-Texte (gehen in den SEO-Prompt -> FREIGABE INHABER vor --write).
export const KATEGORIE_SEO_HINWEIS =
  'Halloween von JammiFashion: bedruckte Shirts, Pullover und Hoodies mit Halloween-Motiven, '
  + 'gedruckt nach Bestellung in Wrist. Herren im geraden Schnitt, Damen tailliert. '
  + 'Das Motiv wird am Artikel ausgewählt.';
// Freigegeben vom Inhaber 10.10. (HW3): volle Aufdrucke laut Mockups, keine
// Werk- oder Figurennamen, "Offen" leer.
export const MOTIV_ZEILE = {
  motiv: `Halloween-Kollektion mit ${MOTIVE.length} Motiven zur Auswahl: `
    + MOTIVE.map(m => `„${m.aufdruck}“ (${m.bild})`).join('; '),
  druckposition: 'Front, großflächig',
  druckfarben: 'vollfarbig',
  druckfarbeJeTextilfarbe: 'nein, fest',
  serieKontext: 'Halloween-Kollektion 2026',
  nurIntern: '',
  offen: '',
};

// ── Kollektionen (HW4) ──────────────────────────────────────────────────────
// Eine Kollektion = Kurzbezeichnung, Artikel, Kategorien, Motive-Zeile, Bilder.
// motive null = keine Motiv-Achse (ein Motiv, ein Bild je Artikel, Datei bilddatei).
// kategorie = neu anzulegende Oberkategorie; kategorieIds = feste, vorhandene IDs
// (gemessen, beim Lauf im Shop nachgeprueft). fp = Festpreis-Partner (FP_Artikel).
export const HALLOWEEN = {
  schluessel: 'halloween', kurz: KURZ, motive: MOTIVE, artikel: ARTIKEL,
  kategorie: KATEGORIE, kategorieIds: null, kategorienText: KATEGORIE.name,
  motivZeile: MOTIV_ZEILE, kategorieSeoHinweis: KATEGORIE_SEO_HINWEIS, kategorieKarte: KATEGORIE_KARTE, fp: null,
};

// Crocodiles Hamburg Halloween Kinder (HW4, Entscheidungen Inhaber 10.10.): Partner
// mit vollen Rechten, Motiv "Suesses oder es scheppert!". Hoodie = BY185 (Inhaber:
// BY188 ist im Bestand die Kinderjacke), Shirt = E399, Black, alle Groessen.
// Kategorien wie die Kinderartikel der Kollektion 26/27 (gemessen an 20882, 19343)
// plus Halloween: 549 Crocodiles Hamburg, 589 Kinder, 686 Kollektion 26/27,
// 703 Kinder 26/27, 776 Halloween.
export const CH_HALLOWEEN = {
  schluessel: 'ch-halloween', kurz: 'CH-Halloween', motive: null,
  artikel: [
    { titel: 'Crocodiles Hamburg Halloween Hoodie Kinder', modell: 'BY185', farbe: 'Black', von: null, bis: null, versand: 'paket',
      bilddatei: 'BY188_black_suesses_oder_es_scheppert.jpg', fpArtikelkategorie: 'Kinderhoodie', fpVersandart: 'P',
      keyphrase: 'Crocodiles Hamburg Halloween Hoodie Kinder', synonyme: ['Crocodiles Kinderhoodie Halloween', 'Halloween Hoodie Kinder Eishockey'] },
    { titel: 'Crocodiles Hamburg Halloween T-Shirt Kinder', modell: 'E399', farbe: 'Black', von: null, bis: null, versand: 'grossbrief',
      bilddatei: 'E399black_suesses_oder_es_scheppert.jpg', fpArtikelkategorie: 'Kindershirts', fpVersandart: 'B',
      keyphrase: 'Crocodiles Hamburg Halloween T-Shirt Kinder', synonyme: ['Crocodiles Kindershirt Halloween', 'Halloween T-Shirt Kinder Eishockey'] },
  ],
  kategorie: null, kategorieIds: [549, 589, 686, 703, 776],
  kategorienText: 'Crocodiles Hamburg, Kinder, Kollektion 26/27, Kinder 26/27, Halloween',
  motivZeile: {
    motiv: '„Süßes oder es scheppert!“: grimmiges Krokodil im Crocodiles-Trikot mit Eishockeyschläger, '
      + 'Schriftzug „Crocodiles Hamburg“, Halloween-Flammen, Fledermäuse und Spinnennetz',
    druckposition: 'Front, großflächig', druckfarben: 'vollfarbig', druckfarbeJeTextilfarbe: 'nein, fest',
    serieKontext: 'Crocodiles Hamburg Halloween 2026', nurIntern: '', offen: '',
  },
  kategorieSeoHinweis: null, kategorieKarte: null,
  fp: { partnerId: 'FP-001', wcKategorie: 'Crocodiles Hamburg' },
};

// Fanmeet BoysLove (FM1/FM2, Entscheidungen Inhaber 28.10.): 2 Motive x 6 Produkte,
// je Artikel ein Motiv (wie der BL-Bestand, z. B. Jack/Joker), darum zwei Kollektionen
// mit eigener Kurzbezeichnung und gemeinsamer NEUER Unterkategorie "Fanmeet" unter
// BoysLove (320); die Artikel stehen in 320 + Fanmeet. Die erste Kollektion legt
// Kategorie, Struktur- und Karte-Zeile an, die zweite findet sie vor.
// Struktur_Kategorien: die tote Zeile der geloeschten 444 "Fanmeet Berlin" wird
// umgeschrieben (Inhaber, Frage 8), dazu der SEO_Hinweis von 320 (Nachtrag 28.10.).
// Groessen laut L-Shop bis 5XL (Shop-Terme enden bei 5XL), Farbe = L-Shop-Name.
// Texte zeitlos: kein Anlass, Ort, Datum (Nur_intern, damit die Pruefung meldet).
// Personen nie beschreiben; "offiziell" steht in keinem Prompt-Text (CLAUDE.md),
// die Pruefung (VERBOTENE_BEGRIFFE) faengt es ab.
export const FANMEET_KATEGORIE = {
  name: 'Fanmeet', slug: 'fanmeet', parent: 320,
  pfad: 'BoysLove (BL) > Fanmeet', oberkategorie: 'BoysLove (BL)',
};
export const FANMEET_SEO_HINWEIS =
  'Fanart von Fans für Fans. Zwei Motive: „TayNew“ mit dem Spruch „"Orca-nic chaos but beary much love!"“ (Eisbär und Orca) '
  + 'und „The FORCE of love. The BOOK of our hearts.“ (Fuchs mit Tomate). Sprüche wörtlich. '
  + 'Schauspieler-Namen nur als Motivtext oder im Titel, Personen nie beschreiben. '
  // FM2 Schritt 3 (Inhaber 28.10.): die Texte machten "Fanmeet" zum Anlass und setzten Knappheit/Zeitdruck.
  // Der Kategoriename steht bewusst NICHT im Hinweis (er kommt ohnehin ueber "kategorien" in den Prompt).
  + 'Kein Anlass, kein Ort, kein Datum, kein Treffen, keine Veranstaltung. Kein Zeitdruck und keine Knappheit, gedruckt wird nach Bestellung.';
export const BOYSLOVE_SEO_HINWEIS =
  'Fanart von Fans für Fans. Serien nur nennen, wenn das Motivfeld sie angibt. '
  + 'Schauspieler-Namen nur als Motivtext oder im Titel, Personen nie beschreiben; als Fanart kennzeichnen, '
  + 'sonst keine Aussage zu Lizenz oder Herkunft. Keine Rechteinhaber. Du-Ansprache, locker.';
// "Fanmeet" steht hier, damit die Pruefung den Kategorienamen im Text meldet (FM2 Schritt 3).
const FANMEET_NUR_INTERN = 'Fantreffen; Fanmeet; Berlin; 05.12.2026';

// Produkte je Motiv. bilddatei = Mockup im Ordner --bilder (Namen vom Inhaber).
const FANMEET_PRODUKTE = [
  { modell: 'E3000',   art: 'T-Shirt',                        farbe: 'Black',      von: 'XS', bis: '5XL', versand: 'grossbrief', syn: ['Shirt', 'Shirt Herren'] },
  { modell: 'E3005',   art: 'T-Shirt tailliert',              farbe: 'Black',      von: 'XS', bis: '3XL', versand: 'grossbrief', syn: ['Shirt Damen', 'Shirt tailliert'] },
  { modell: 'BCWU02K', art: 'super weicher Hoodie',           farbe: 'Black Pure', von: 'XS', bis: '4XL', versand: 'paket',      syn: ['Hoodie', 'Hoodie Herren'] },
  { modell: 'BCWW02Q', art: 'super weicher Hoodie tailliert', farbe: 'Black Pure', von: 'XS', bis: '3XL', versand: 'paket',      syn: ['Hoodie Damen', 'Hoodie tailliert'] },
  { modell: 'BY284',   art: 'Fluffy Hoodie',                  farbe: 'Black',      von: 'XS', bis: '5XL', versand: 'grossbrief', syn: ['Teddy Hoodie', 'Fluffy Hoodie Unisex'] },
  { modell: 'BY289',   art: 'Fluffy Hoodie Damen',            farbe: 'Black',      von: 'XS', bis: '5XL', versand: 'grossbrief', syn: ['Teddy Hoodie Damen', 'Fluffy Hoodie tailliert'] },
];

function fanmeetKollektion({ schluessel, kurz, name, syn1, spruch, bilder, motivZeile, ersteKollektion }) {
  return {
    schluessel, kurz, motive: null,
    artikel: FANMEET_PRODUKTE.map(p => ({
      titel: `${name} ${p.art}`, modell: p.modell, farbe: p.farbe, von: p.von, bis: p.bis, versand: p.versand,
      bilddatei: bilder[p.modell], bildTitel: `${name} ${p.art} Schwarz`,
      keyphrase: `${name} ${p.art}`,
      synonyme: [`${syn1} ${p.syn[0]}`, `${name} Fanart ${p.syn[1]}`, `${spruch} ${p.syn[0]}`],
    })),
    kategorie: FANMEET_KATEGORIE, kategorieIds: null, kategorieIdsZusatz: [320],
    kategorienText: 'BoysLove (BL), Fanmeet',
    motivZeile: {
      motiv: motivZeile, druckposition: 'Front, Brust', druckfarben: 'vollfarbig', druckfarbeJeTextilfarbe: 'nein, fest',
      serieKontext: 'BoysLove-Fanart', nurIntern: FANMEET_NUR_INTERN, offen: '',
    },
    kategorieSeoHinweis: FANMEET_SEO_HINWEIS,
    kategorieKarte: { keyphrase: 'Tay New Fanart', synonyme: ['TayNew Fanart', 'BL Fanmeet Shirts', 'Fanmeet Hoodies'] },
    karteNotiz: 'FM2: angelegt, Yoast-Werte laut fm1-kategorie.md (Inhaber)',
    // Struktur_Kategorien: Zeile mit dieser Kategorienummer wird umgeschrieben statt angehaengt.
    strukturErsetzt: '444',
    // weitere SEO_Hinweise (Kategorienummer -> neuer Text), nur in der ersten Kollektion.
    seoHinweiseNeu: ersteKollektion ? [{ nummer: '320', hinweis: BOYSLOVE_SEO_HINWEIS }] : [],
    // Kategoriebild = Artikelbild dieses Modells (nur gesetzt, wenn die Kategorie noch keins hat).
    kategorieBildModell: ersteKollektion ? 'E3000' : null,
    preise: 'fanmeet', fp: null,
  };
}

export const FANMEET_TAYNEW = fanmeetKollektion({
  schluessel: 'fanmeet-taynew', kurz: 'BL-TayNew', name: 'Tay New', syn1: 'TayNew', spruch: 'Orca-nic chaos', ersteKollektion: true,
  motivZeile: 'Fanart: Eisbär und Orca Rücken an Rücken zwischen Schneeflocken, darüber der Schriftzug „TayNew“, '
    + 'darunter der Spruch „"Orca-nic chaos but beary much love!"“ in Weiß; kleine Signatur am Motiv',
  bilder: {
    E3000: 'E3000 black Tay New.jpg', E3005: 'E3005 black Tay new.jpg', BCWU02K: 'BCWU02K Black Tay new.jpg',
    BCWW02Q: 'BCWW02Q Black Tay new.jpg', BY284: 'BY284 black Tay New.jpg', BY289: 'BY289 black Tay New.jpg',
  },
});
export const FANMEET_FORCELOVE = fanmeetKollektion({
  schluessel: 'fanmeet-forcelove', kurz: 'BL-ForceLove', name: 'Force of Love', syn1: 'ForceBook', spruch: 'Book of our hearts', ersteKollektion: false,
  motivZeile: 'Fanart: Fuchs umarmt eine lächelnde Tomate, kleine Herzen, orange Glitzerspur; darüber der Spruch '
    + '„The FORCE of love. The BOOK of our hearts.“ in Orange; kleine Signatur am Motiv',
  bilder: {
    E3000: 'E3000 black Force of Love.jpg', E3005: 'E3005 black Force of Love.jpg', BCWU02K: 'BCWU02K Force of Love.jpg',
    BCWW02Q: 'BCWW02QForce of Love.jpg', BY284: 'BY284 black Force of Love.jpg', BY289: 'BY289 black Force of Love.jpg',
  },
});

// NEU1 (Entscheidungen Inhaber 28.10., antwort-NEU1 + Terminal): Ugly Christmas Sweater
// "Leb, Kuchen!" wie die Bestands-Sweater (Vorbild Rentier 21164/21175): nur Deep Black,
// Kategorien je Artikel (293 + Herren 685 bzw. Damen 684), grossbrief, ein Preis fuer
// alle Groessen. Motiv KI-erzeugt: KI_SATZ ans Ende der Beschreibung (ki), Vermerk in
// "Offen" - nicht in Nur_intern, sonst meldet die Pruefung jedes Wort des KI-Satzes.
export const UCS_LEBKUCHEN = {
  schluessel: 'ucs-lebkuchen', kurz: 'UCS-LebKuchen', motive: null,
  artikel: ['Herren', 'Damen'].map(art => ({
    titel: `Leb, Kuchen! – Ugly Christmas Sweater ${art}`,
    modell: art === 'Herren' ? 'JH030' : 'JH030F', farbe: 'Deep Black',
    von: 'XS', bis: art === 'Herren' ? '5XL' : 'XXL', versand: 'grossbrief',
    kategorieIds: [293, art === 'Herren' ? 685 : 684],
    kategorienText: `Ugly Christmas Sweater, Ugly Christmas Sweater ${art}`,
    bilddatei: `ugly-christmas-sweater-leb-kuchen-${art.toLowerCase()}-black-${art === 'Herren' ? 'Jh030' : 'Jh030F'}.jpg`,
    bildName: `leb-kuchen-ugly-christmas-sweater-${art.toLowerCase()}-schwarz`,
    bildTitel: `Leb, Kuchen! – Ugly Christmas Sweater ${art} Schwarz`,
    keyphrase: `Leb Kuchen Sweater ${art}`,
    synonyme: [`Lebkuchen Weihnachtspullover ${art}`, `Lebkuchenmann Ugly Christmas Sweater ${art}`, `lustiger Lebkuchen Pullover ${art}`],
  })),
  // Vereinigung - nur zum Nachpruefen im Shop; am Produkt gelten die IDs des Artikels.
  kategorie: null, kategorieIds: [293, 684, 685], kategorienText: 'Ugly Christmas Sweater',
  motivZeile: {
    motiv: 'Zwei Lebkuchenmänner: einer liegt zerbrochen am Boden (Kreuzaugen), der andere mit Sanitäter-Mütze '
      + '(rotes Kreuz) und grüner Fliege weint und hält Defibrillator-Paddles mit Blitzen an ihn; Sprechblase '
      + '„LEB, KUCHEN!“ (Wortspiel „Leb, Kuchen!“); Schneeflocken, Zuckerstangen-Bonbons, Ilex, Streusel',
    druckposition: 'Front, Brust', druckfarben: 'vollfarbig', druckfarbeJeTextilfarbe: 'nein, fest',
    serieKontext: 'Ugly Christmas Sweater', nurIntern: '',
    offen: 'Motiv mit KI gestaltet – KI-Satz am Ende der Beschreibung',
  },
  kategorieSeoHinweis: null, kategorieKarte: null, preise: 'ucs-lebkuchen', fp: null, ki: true,
};

// NEU1: Tobi Torpedo Fluffy Hoodies (Lizenzpartner P-002, Kat. 121), Logo-Motiv TT-Logo
// (vorhanden), mehrere Farben je Artikel, Druckfarbe fest je Textilfarbe (am Mockup).
// Partner_Artikel legt der Abgleich an (lib/partnerArtikel.js), nicht dieses Skript.
const TT_FLUFFY_FARBEN = {
  'Black':      { datei: 'black',      name: 'schwarz',    alt: 'Schwarz mit weißem Druck' },
  'Beryl Blue': { datei: 'beryl-blue', name: 'beryl-blue', alt: 'Beryl Blue mit weißem Druck' },
  'Soft Pink':  { datei: 'Soft-pink',  name: 'soft-pink',  alt: 'Soft Pink mit schwarzem Druck' },
};
function ttFluffy({ titel, modell, farben, synonyme }) {
  return {
    titel, modell, farben, von: 'XS', bis: '5XL', versand: 'grossbrief', keyphrase: titel, synonyme,
    bilder: Object.fromEntries(farben.map(f => {
      const b = TT_FLUFFY_FARBEN[f];
      return [f, { datei: `${modell}-${b.datei}-tobi-torpedo.jpg`, name: b.name, alt: `${titel} ${b.alt}` }];
    })),
  };
}
export const TT_FLUFFY = {
  schluessel: 'tt-fluffy', kurz: 'TT-Logo', motive: null,
  artikel: [
    ttFluffy({ titel: 'Tobi Torpedo Fluffy Hoodie', modell: 'BY284', farben: ['Black', 'Beryl Blue', 'Soft Pink'],
      synonyme: ['Tobi Torpedo Teddy Hoodie', 'Tobi Torpedo Kuschelhoodie', 'Tobi Torpedo Fluffy Kapuzenpullover'] }),
    ttFluffy({ titel: 'Tobi Torpedo Damen Fluffy Hoodie', modell: 'BY289', farben: ['Black', 'Soft Pink'],
      synonyme: ['Tobi Torpedo Teddy Hoodie Damen', 'Tobi Torpedo Kuschelhoodie Damen', 'Tobi Torpedo Fluffy Kapuzenpullover Damen'] }),
  ],
  kategorie: null, kategorieIds: [121], kategorienText: 'Tobi Torpedo',
  motivZeile: null,
  // Vorhandene Motive-Zeile TT-Logo aendern (Inhaber 28.10., Frage 6): Rakete steckt im "O"
  // (Mockups), Druckfarbe der Fluffys ergaenzen. Spalte -> (alt) => neu; wirft, wenn alt nicht passt.
  motivAenderung: {
    Motiv: alt => {
      if (alt.includes('(Rakete im „O“)')) return alt;
      if (!alt.includes('(Torpedo als „I“)')) throw new Error('Motive TT-Logo: "(Torpedo als „I“)" nicht gefunden – nichts geändert.');
      return alt.replace('(Torpedo als „I“)', '(Rakete im „O“)');
    },
    Druckfarbe_je_Textilfarbe: alt => (alt.includes('Fluffy BY284/BY289') ? alt
      : `${alt}; Fluffy BY284/BY289: weiß auf Black und Beryl Blue, schwarz auf Soft Pink`),
  },
  kategorieSeoHinweis: null, kategorieKarte: null, preise: 'tt-fluffy', fp: null,
};

export const KOLLEKTIONEN = {
  [HALLOWEEN.schluessel]: HALLOWEEN, [CH_HALLOWEEN.schluessel]: CH_HALLOWEEN,
  [FANMEET_TAYNEW.schluessel]: FANMEET_TAYNEW, [FANMEET_FORCELOVE.schluessel]: FANMEET_FORCELOVE,
  [UCS_LEBKUCHEN.schluessel]: UCS_LEBKUCHEN, [TT_FLUFFY.schluessel]: TT_FLUFFY,
};

// Satz zur KI-Gestaltung des Druckmotivs (HW4): ans Ende der Langbeschreibung.
// Im Bestand gab es keinen (73 Crocodiles-Artikel gelesen) - Vorschlag aus dem Auftrag.
export const KI_SATZ = 'Das Druckmotiv wurde mit KI gestaltet.';
export const KI_ABSATZ = `<p>${KI_SATZ}</p>`;

/** Langbeschreibung mit KI-Satz am Ende (einmal). */
export function mitKiSatz(html) {
  const h = String(html ?? '').trimEnd();
  return h.includes(KI_SATZ) ? h : `${h}${h ? '\n' : ''}${KI_ABSATZ}`;
}

const t = v => String(v ?? '').trim();
const klein = v => t(v).toLowerCase();

// ── Reine Logik ─────────────────────────────────────────────────────────────

/** Liste in Bloecke von hoechstens n Eintraegen (Reihenfolge bleibt). */
export function teileInBloecke(liste, n = BLOCK_MAX) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Blockgroesse ${n} ungueltig.`);
  const out = [];
  for (let i = 0; i < (liste ?? []).length; i += n) out.push(liste.slice(i, i + n));
  return out;
}

/**
 * Shop-Term zur L-Shop-Groesse: exakt (Gross/Klein egal), sonst gleicher Rang
 * in derselben Klasse (L-Shop "XXL" = Shop "2XL"). Kein oder mehrere -> null.
 */
export function shopGroesse(lshopGroesse, shopTerme) {
  const terme = (shopTerme ?? []).map(t);
  const exakt = terme.find(x => klein(x) === klein(lshopGroesse));
  if (exakt) return exakt;
  const r = groessenRang(lshopGroesse);
  if (!r) return null;
  const gleich = terme.filter(x => { const s = groessenRang(x); return s && s.klasse === r.klasse && s.rang === r.rang; });
  return gleich.length === 1 ? gleich[0] : null;
}

/** Groessen im Bereich von..bis (Rang, inklusive). Ohne Grenzen: alle. */
export function groessenImBereich(groessen, von, bis) {
  if (!von && !bis) return [...groessen];
  const rv = von ? groessenRang(von)?.rang : -Infinity;
  const rb = bis ? groessenRang(bis)?.rang : Infinity;
  return groessen.filter(g => { const r = groessenRang(g)?.rang; return r != null && r >= rv && r <= rb; });
}

/** Erwartete Groessen von..bis (nur Buchstabengroessen), fuer die Vollstaendigkeitspruefung. */
function erwarteteRaenge(von, bis) {
  const a = groessenRang(von)?.rang, b = groessenRang(bis)?.rang;
  if (a == null || b == null) return [];
  const r = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}

/**
 * Preis je Groesse aus der lokalen Preisdatei: { <Modell>: { basis, groessen: { "3XL": .. } } }.
 * Groessen-Schluessel in Shop- oder L-Shop-Schreibweise (Rang-Vergleich).
 * @returns {string|null} "25.00" oder null (fehlt)
 */
export function preisFuer(preise, modell, groesse) {
  const p = preise?.[modell];
  if (!p) return null;
  const r = groessenRang(groesse);
  let wert = null;
  for (const [k, v] of Object.entries(p.groessen ?? {})) {
    const rk = groessenRang(k);
    if ((klein(k) === klein(groesse) || (r && rk && rk.klasse === r.klasse && rk.rang === r.rang)) && v !== null && v !== '') wert = v;
  }
  if (wert === null) wert = p.basis;
  if (wert === null || wert === undefined || wert === '') return null;
  const n = Number(String(wert).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

/** Vorlage der Preisdatei: alle Modelle, Groessen der Planung, leere Werte. */
export function preisVorlage(plaene) {
  const out = { _hinweis: 'Preise in EUR brutto, z. B. 25 oder "25,00". basis = alle Groessen, groessen = Abweichung je Groesse. Datei nie einchecken.' };
  for (const p of plaene) {
    const groessen = p.groessen?.length ? p.groessen.map(g => g.shop ?? g.lshop) : [];
    out[p.artikel.modell] = { basis: null, groessen: Object.fromEntries(groessen.map(g => [g, null])) };
  }
  return out;
}

/**
 * Plan EINES Artikels (ohne Shop-Zugriff).
 * @param {object} o
 * @param {object} o.artikel    Eintrag aus ARTIKEL
 * @param {object[]} o.lshopZeilen  alle Zeilen aus LShop_Modelle (ladeLShopZeilen)
 * @param {string[]} o.groessenTerme  Namen der Terme von "Größe" im Shop
 * @param {object} [o.preise]
 * @returns {{ artikel, status: 'bereit'|'wartet auf LS1'|'fehler', artikelnummer, farbe,
 *             groessen: {lshop, shop, articleNr}[], varianten: object[], hinweise: string[] }}
 */
export function planeArtikel({ artikel, lshopZeilen, groessenTerme, preise, k = HALLOWEEN }) {
  const hinweise = [];
  const plan = { artikel, k, status: 'bereit', artikelnummer: '', farbe: artikel.farbe, groessen: [], varianten: [], hinweise };
  const fehler = (msg, status = 'fehler') => { hinweise.push(msg); plan.status = status; return plan; };

  const nr = baueArtikelnummer(artikel.modell, k.kurz);
  if (nr.fehler) return fehler(nr.fehler);
  plan.artikelnummer = nr.artikelnummer;

  const zeilen = (lshopZeilen ?? []).filter(z => klein(z.catalogNr) === klein(artikel.modell));
  if (!zeilen.length) return fehler(`${artikel.modell} steht nicht in LShop_Modelle – wartet auf LS1 (Modelle_Zusatz + Übernehmen).`, 'wartet auf LS1');

  // NEU1: artikel.farben = mehrere Farben (Achse Farbe mit allen), sonst genau artikel.farbe.
  let farben = artikel.farben?.length ? [...artikel.farben] : [artikel.farbe];
  if (!farben[0]) {
    const alle = lshopAuswertung(zeilen).alleFarben;
    const treffer = alle.filter(f => /wash/i.test(f) && /black/i.test(f));
    if (treffer.length !== 1)
      return fehler(`${artikel.modell}: gewaschene schwarze Farbe nicht eindeutig (${treffer.length ? treffer.join(', ') : 'keine'}; Modellfarben: ${alle.join(', ')}) – Inhaber legt fest.`);
    farben = [treffer[0]];
  }
  plan.farben = farben;
  plan.farbe = farben[0];

  // Je Farbe dieselben Groessen (sonst Stopp); plan.groessen aus der ersten Farbe.
  for (const [i, farbe] of farben.entries()) {
    const aus = lshopAuswertung(zeilen, { farben: [farbe] });
    hinweise.push(...aus.hinweise);
    if (!aus.farben.length) return fehler(`${artikel.modell}: Farbe "${farbe}" nicht wählbar.`);
    if (aus.auslaufend.some(a => a.farbe === farbe))
      hinweise.push(`${artikel.modell} ${farbe}: läuft aus (${aus.auslaufend.filter(a => a.farbe === farbe).map(a => `${a.groesse}=${a.wert}`).join(', ')}).`);

    const imBereich = groessenImBereich(aus.groessen, artikel.von, artikel.bis);
    if (artikel.von && artikel.bis) {
      const fehlt = erwarteteRaenge(artikel.von, artikel.bis).filter(r => !imBereich.some(g => groessenRang(g)?.rang === r));
      if (fehlt.length) return fehler(`${artikel.modell} ${farbe}: ${fehlt.length} Größe(n) zwischen ${artikel.von} und ${artikel.bis} nicht wählbar.`);
    }
    if (!imBereich.length) return fehler(`${artikel.modell} ${farbe}: keine wählbare Größe.`);
    const sortiert = sortiereGroessen(imBereich).sortiert;

    if (i === 0) {
      for (const g of sortiert) {
        const shop = shopGroesse(g, groessenTerme);
        if (!shop) hinweise.push(`Größe "${g}" hat keinen Term in "Größe" – wird beim Anlegen neu angelegt.`);
        plan.groessen.push({ lshop: g, shop: shop ?? g, articleNr: aus.varianten.find(x => x.farbe === farbe && x.groesse === g).articleNr, neuTerm: !shop });
      }
    } else if (sortiert.join('|') !== plan.groessen.map(g => g.lshop).join('|')) {
      return fehler(`${artikel.modell}: Größen von "${farbe}" (${sortiert.join(', ')}) weichen von "${farben[0]}" ab.`);
    }

    // Varianten: Farbe, dann Groesse aufsteigend, je Groesse die Motive in fester
    // Reihenfolge (ohne Motiv-Achse: eine Variante je Groesse).
    for (const g of plan.groessen) {
      const v = aus.varianten.find(x => x.farbe === farbe && x.groesse === g.lshop);
      for (const m of k.motive ?? [null]) {
        plan.varianten.push({
          farbe, groesse: g.shop, lshopGroesse: g.lshop, motiv: m?.titel ?? null, motivSku: m?.sku ?? null,
          articleNr: v.articleNr, preis: preisFuer(preise, artikel.modell, g.shop),
        });
      }
    }
  }
  const skus = baueVariantenSkus(plan.artikelnummer,
    plan.varianten.map(v => ({ attrs: [{ value: v.farbe }, { value: v.groesse }, ...(v.motivSku ? [{ value: v.motivSku }] : [])] })));
  if (skus.fehler) return fehler(skus.fehler);
  plan.varianten.forEach((v, i) => { v.sku = skus.skus[i]; });

  const achsenFehler = pruefeFarbAchse(achsenVon({ varianten: plan.varianten.map(variationsAttribute) }));
  if (achsenFehler) return fehler(achsenFehler.fehler);

  const ohnePreis = plan.varianten.filter(v => !v.preis).length;
  if (ohnePreis) hinweise.push(`${ohnePreis} von ${plan.varianten.length} Variationen ohne Preis (Preisdatei).`);
  return plan;
}

/** Variations-Attribute im WooCommerce-Format; ids nur, wenn bekannt (global). */
export function variationsAttribute(v, attrIds = {}) {
  return [
    { ...(attrIds.farbe ? { id: attrIds.farbe } : {}), name: FARB_ACHSE, option: v.farbe },
    { ...(attrIds.groesse ? { id: attrIds.groesse } : {}), name: GROESSE_ACHSE, option: v.groesse },
    ...(v.motiv ? [{ name: MOTIV_ACHSE, option: v.motiv }] : []),
  ];
}

/**
 * Body fuer POST products (Entwurf).
 * @param {object} plan  aus planeArtikel (status bereit)
 * @param {object} o  { kategorieId, attrIds: {farbe, groesse}, markeId, lieferzeit }
 */
export function produktPayload(plan, { kategorieId, attrIds, markeId, lieferzeit, bilder }) {
  if (!attrIds?.farbe || !attrIds?.groesse) throw new Error('Attribut-IDs fuer Farbe/Größe fehlen.');
  return {
    // HW3: Galerie = Sammelbild vorn, dann die 8 Motive in Motiv-Reihenfolge.
    ...(bilder ? { images: galerie(bilder, plan.k) } : {}),
    name: plan.artikel.titel,
    type: 'variable',
    status: 'draft',
    sku: plan.artikelnummer,
    description: TEXT_PLATZHALTER,
    short_description: '',
    reviews_allowed: true,
    shipping_class: plan.artikel.versand,
    categories: produktKategorien(plan.k, kategorieId, plan.artikel).map(id => ({ id })),
    ...(markeId ? { brands: [{ id: markeId }] } : {}),
    // FM2: genau eine Farbe -> vorgeblendet (Inhaber 12.10.), Groesse nie.
    // NEU1: mehrere Farben -> keine Vorblendung, der Kunde waehlt (Inhaber 28.10.).
    default_attributes: farbenVon(plan).length === 1 ? [{ id: attrIds.farbe, option: plan.farbe }] : [],
    meta_data: mitLieferzeit([], lieferzeit),
    attributes: [
      { id: attrIds.farbe,   position: 0, visible: true, variation: true, options: farbenVon(plan) },
      { id: attrIds.groesse, position: 1, visible: true, variation: true, options: plan.groessen.map(g => g.shop) },
      ...((plan.k ?? HALLOWEEN).motive ? [{ name: MOTIV_ACHSE, position: 2, visible: true, variation: true, options: (plan.k ?? HALLOWEEN).motive.map(m => m.titel) }] : []),
    ],
  };
}

/** Farben eines Plans (NEU1: mehrere; aeltere Plaene nur plan.farbe). */
export const farbenVon = plan => (plan.farben?.length ? plan.farben : [plan.farbe]);

/**
 * Ruecklese-Pruefung der Vorblendung (FM2): genau ein Eintrag, Attribut Farbe, Option
 * = Farbe (WooCommerce liefert den Namen oder den Slug zurueck). null = in Ordnung.
 * farbe null (NEU1, mehrere Farben): es darf nichts vorgeblendet sein.
 */
export function pruefeVorblendung(defaultAttributes, farbe, farbAttrId) {
  const def = defaultAttributes ?? [];
  if (farbe === null) return def.length ? `default_attributes ${JSON.stringify(def)} statt leer (mehrere Farben)` : null;
  const soll = [klein(farbe), klein(farbe).replace(/\s+/g, '-')];
  if (def.length === 1 && Number(def[0].id) === Number(farbAttrId) && soll.includes(klein(def[0].option))) return null;
  return `default_attributes ${JSON.stringify(def)} statt Farbe "${farbe}"`;
}

/**
 * Kategorie-IDs am Produkt: die des Artikels (NEU1: Herren/Damen), sonst feste IDs,
 * sonst die zusaetzlichen festen (FM2: 320) und die neue Kategorie. Reihenfolge =
 * Reihenfolge der SEO_Hinweise im SEO-Flow.
 */
export function produktKategorien(k, kategorieId, artikel = null) {
  if (artikel?.kategorieIds) return [...artikel.kategorieIds];
  if (k?.kategorieIds) return [...k.kategorieIds];
  return [...(k?.kategorieIdsZusatz ?? []), ...(kategorieId ? [kategorieId] : [])];
}

/**
 * Bodies fuer variations/batch create, sortiert (Farbe, Groesse, dann Motiv-
 * Reihenfolge) mit menu_order. Jede Variation: "-1" Lieferzeit, _wc_gla_color.
 */
export function variationsPayloads(plan, attrIds, bilder) {
  const roh = plan.varianten.map(v => ({ v, attributes: variationsAttribute(v, attrIds) }));
  const reihenfolge = variantenReihenfolge(roh.map(r => ({ attributes: r.attributes })),
    [{ name: FARB_ACHSE, options: farbenVon(plan) }]);
  return reihenfolge.map((i, pos) => {
    const { v, attributes } = roh[i];
    return {
      sku: v.sku,
      regular_price: v.preis ?? '',
      status: 'publish',
      menu_order: pos + 1,
      attributes,
      meta_data: mitGoogleFarbe(mitLieferzeit([], LIEFERZEIT_WIE_ELTERN), attributes),
      // HW3: Variationsbild ueber "Motiv".
      // NEU1: ohne Motiv das Bild der eigenen Farbe (sonst das einzige Bild).
      ...(bilder ? { image: { id: v.motiv ? motivBild(bilder, v.motiv) : farbBild(bilder, v.farbe) } } : {}),
    };
  });
}

// ── Bilder (HW3) ────────────────────────────────────────────────────────────
// Mockups vom Inhaber (Postfach halloween/mockups, Namen bleiben), je Artikel
// 8 Stueck; Sammelbild sammelbild-<Modell>.jpg (4 x 2) lokal gebaut. Hochgeladen
// wird mit SEO-Dateiname, Titel = ALT. Zustand der Uploads lokal (Datei, nicht
// im Repo): ein erneuter Lauf laedt nichts doppelt.

export const sammelbildDatei = modell => `sammelbild-${modell}.jpg`;

/**
 * Mockup-Dateien -> { zuordnung: { <Modell>: { <Motivtitel>: datei } }, fehler: string[] }.
 * Jede Datei genau einem Artikel (Praefix) und genau einem Motiv (Schluesselwort);
 * je Artikel genau 8 Dateien, jedes Motiv genau einmal. Sonst Fehler (= Stopp).
 */
export function ordneMockups(dateinamen, artikelListe = ARTIKEL) {
  const fehler = [];
  const zuordnung = Object.fromEntries(artikelListe.map(a => [a.modell, {}]));
  for (const datei of dateinamen ?? []) {
    if (!/.jpe?g$/i.test(datei)) continue;
    const artikel = artikelListe.filter(a => a.mockupPraefix && datei.startsWith(a.mockupPraefix));
    if (artikel.length !== 1) { fehler.push(`${datei}: ${artikel.length ? 'mehrere Artikel' : 'kein Artikel'} (Präfix)`); continue; }
    const name = datei.toLowerCase();
    const motive = MOTIVE.filter(m => m.mockup.some(k => name.includes(k)));
    if (motive.length !== 1) { fehler.push(`${datei}: ${motive.length ? `mehrere Motive (${motive.map(m => m.titel).join(', ')})` : 'kein Motiv'}`); continue; }
    const z = zuordnung[artikel[0].modell];
    if (z[motive[0].titel]) { fehler.push(`${artikel[0].modell}: Motiv "${motive[0].titel}" doppelt (${z[motive[0].titel]}, ${datei})`); continue; }
    z[motive[0].titel] = datei;
  }
  for (const a of artikelListe) {
    const n = Object.keys(zuordnung[a.modell]).length;
    const fehlt = MOTIVE.filter(m => !zuordnung[a.modell][m.titel]).map(m => m.titel);
    if (n !== MOTIVE.length) fehler.push(`${a.modell}: ${n} Mockups statt ${MOTIVE.length}${fehlt.length ? ` (fehlt: ${fehlt.join(', ')})` : ''}`);
  }
  return { zuordnung, fehler };
}

/** Upload-Liste eines Artikels: Sammelbild, dann 8 Motive (Reihenfolge MOTIVE). */
export function bildListe(artikel, mockups, k = HALLOWEEN) {
  const basis = normalisiereTeil(artikel.titel);
  // NEU1: ein Bild je Farbe (artikel.bilder), Reihenfolge = artikel.farben.
  if (!k.motive && artikel.bilder) return artikel.farben.map(f => ({
    schluessel: `farbe:${f}`, quelle: artikel.bilder[f].datei, dateiname: `${basis}-${artikel.bilder[f].name}.jpg`, titel: artikel.bilder[f].alt,
  }));
  // FM2: Titel = ALT = Artikelname + Farbe (SE6), wo die Kollektion ihn vorgibt; NEU1: bildName.
  if (!k.motive) return [{ schluessel: 'einzel', quelle: artikel.bilddatei, dateiname: `${artikel.bildName ?? basis}.jpg`, titel: artikel.bildTitel ?? artikel.titel }];
  return [
    { schluessel: 'sammel', quelle: sammelbildDatei(artikel.modell), dateiname: `${basis}-alle-motive.jpg`,
      titel: `${artikel.titel} alle Motive` },
    ...MOTIVE.map(m => ({
      schluessel: m.titel, quelle: `mockups/${mockups[m.titel]}`, dateiname: `${basis}-${normalisiereTeil(m.titel)}.jpg`,
      titel: `${artikel.titel} ${m.titel}`,
    })),
  ];
}

/** Bild-IDs eines Artikels aus dem Upload-Zustand: { sammel, motive: { titel: id } } oder null. */
export function bilderAusZustand(liste, zustand) {
  const id = b => zustand?.[b.dateiname]?.id ?? null;
  const ids = liste.map(id);
  if (!ids.length || ids.some(x => !x)) return null;
  if (liste[0].schluessel === 'einzel') return { einzel: ids[0] };
  if (liste[0].schluessel.startsWith('farbe:'))
    return { einzel: ids[0], farben: Object.fromEntries(liste.map((b, i) => [b.schluessel.slice('farbe:'.length), ids[i]])) };
  return { sammel: ids[0], motive: Object.fromEntries(liste.slice(1).map((b, i) => [b.schluessel, ids[i + 1]])) };
}

export const galerie = (bilder, k = HALLOWEEN) => (k.motive
  ? [{ id: bilder.sammel }, ...k.motive.map(m => ({ id: motivBild(bilder, m.titel) }))]
  : bilder.farben ? Object.values(bilder.farben).map(id => ({ id }))
  : [{ id: einzelBild(bilder) }]);

function einzelBild(bilder) {
  if (!bilder?.einzel) throw new Error('Artikelbild fehlt.');
  return bilder.einzel;
}

/** Bild einer Farbe (NEU1); ohne Farbbilder das einzige Bild. */
export function farbBild(bilder, farbe) {
  if (!bilder?.farben) return einzelBild(bilder);
  const id = bilder.farben[farbe];
  if (!id) throw new Error(`Bild für Farbe "${farbe}" fehlt.`);
  return id;
}

function motivBild(bilder, motiv) {
  const id = bilder?.motive?.[motiv];
  if (!id) throw new Error(`Bild für Motiv "${motiv}" fehlt.`);
  return id;
}

/**
 * Bilder eines Artikels hochladen (nur --write), fehlende nur.
 * @param {object[]} liste  aus bildListe
 * @param {object}   o  { zustand, speichere(zustand), lade({ datei, dateiname, titel }) -> { id, src, titel, alt }, log }
 * @returns {Promise<{ bilder: object, neu: number, vorhanden: number }>}
 */
export async function ladeBilderHoch(liste, { zustand, speichere, lade, log = () => {} }) {
  let neu = 0, vorhanden = 0;
  for (const b of liste) {
    if (zustand[b.dateiname]?.id) { vorhanden++; continue; }
    const r = await lade(b);
    zustand[b.dateiname] = { id: r.id, src: r.src, titel: r.titel, alt: r.alt };
    speichere(zustand);
    neu++;
    log(`  Bild ${b.dateiname} -> ${r.id}`);
  }
  return { bilder: bilderAusZustand(liste, zustand), neu, vorhanden };
}

/** Payload fuer den Reiter Varianten (utils/varianten-zeilen.js) mit WC-IDs. */
export function variantenSheetPayload(plan, wcIds = []) {
  return plan.varianten.map((v, i) => ({
    nr: i + 1,
    e1: FARB_ACHSE, v1: v.farbe,
    e2: GROESSE_ACHSE, v2: v.groesse,
    e3: v.motiv ? MOTIV_ACHSE : '', v3: v.motiv ?? '',
    preis: v.preis !== null && v.preis !== undefined && v.preis !== '' ? Number(v.preis) : '',
    aktiv: true,
    wcVariationId: wcIds[i] ? Number(wcIds[i]) : '',
    googleFarbe: v.farbe,
    lshopArticleNr: v.articleNr,
  }));
}

/** Body fuer die Erfassungsmaske (wie buildSheetPayload + Nachlauf der Maske). */
export function maskeBody(plan, { produktId = '', marke = '' } = {}) {
  return {
    'Status': 'Im Shop',
    'Status Shop': 'Entwurf',
    'Produkt-ID': String(produktId ?? ''),
    'SEO_Status': 'Ausstehend',
    'Produktname': plan.artikel.titel,
    'Produktart': 'Variabel',
    'L-Shop-Artikelnummer': plan.artikel.modell,
    'Artikelkurzbezeichnung': plan.k?.kurz ?? KURZ,
    'Artikelnummer': plan.artikelnummer,
    'Versandklasse': plan.artikel.versand,
    'Kategorien': plan.artikel.kategorienText ?? plan.k?.kategorienText ?? KATEGORIE.name,
    'Marke': marke,
    'Fokus_Keyphrase': plan.artikel.keyphrase,
    'Fokus_Synonyme': plan.artikel.synonyme.join(', '),
  };
}

/** Naechste SSOT-ID nach dem Muster der Maske (JFN-<Jahr>-<4 Ziffern>, max + 1). */
export function naechsteSsotIds(ids, anzahl, jahr = new Date().getFullYear()) {
  const prefix = `JFN-${jahr}-`;
  let max = 0;
  for (const id of ids ?? []) {
    const s = t(id);
    if (!s.startsWith(prefix)) continue;
    const n = parseInt(s.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return Array.from({ length: anzahl }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, '0')}`);
}

/**
 * Sheet-Plan: SSOT-IDs, Zeilennummern und Zeileninhalte - aus den aktuell
 * gelesenen Reitern (Zaehler werden jedes Mal neu gemessen).
 * @param {object} reiter  { Erfassungsmaske, Varianten, Motive, Struktur_Kategorien, SEO_Karte } (Werte inkl. Kopf)
 * @param {object[]} plaene  aus planeArtikel
 */
export function planeSheets(reiter, plaene, { kategorieId = '', heute, k = HALLOWEEN } = {}) {
  const E = reiter.Erfassungsmaske ?? [[]], V = reiter.Varianten ?? [[]], M = reiter.Motive ?? [[]];
  const K = reiter.Struktur_Kategorien ?? [[]], S = reiter.SEO_Karte ?? [[]];
  const eh = E[0] ?? [];
  const eId = requireHeaderAny(eh, ['SSOT-ID', 'ID'], 'Erfassungsmaske');
  const eArt = requireHeader(eh, 'Artikelnummer', 'Erfassungsmaske');
  const ssotIds = naechsteSsotIds(E.slice(1).map(r => r[eId]), plaene.length);

  const vorhandenMaske = new Map(E.slice(1).map((r, i) => [t(r[eArt]), { ssot: t(r[eId]), zeile: i + 2 }]));
  let maskeZeile = letzteZeile(E), variantenZeile = letzteZeile(V);
  let n = 0;
  const artikel = plaene.map(p => {
    if (p.status !== 'bereit') return { plan: p, ssot: '', maskeZeile: null, variantenVon: null, variantenBis: null };
    const da = vorhandenMaske.get(p.artikelnummer);
    if (da) return { plan: p, ssot: da.ssot, maskeZeile: da.zeile, vorhanden: true, variantenVon: null, variantenBis: null };
    const ssot = ssotIds[n++];
    maskeZeile += 1;
    const von = variantenZeile + 1;
    variantenZeile += p.varianten.length;
    return { plan: p, ssot, maskeZeile, variantenVon: von, variantenBis: variantenZeile };
  });

  const mh = M[0] ?? [];
  const mKurz = requireHeader(mh, 'Artikelkurzbezeichnung', 'Motive');
  const motivIdx = M.findIndex((r, i) => i > 0 && t(r[mKurz]) === k.kurz);
  const motivDa = motivIdx > 0;
  if (!motivDa && !k.motivZeile) throw new Error(`Motive: Zeile "${k.kurz}" fehlt und die Kollektion bringt keine mit – nichts geplant.`);
  // NEU1: vorhandene Motive-Zeile aendern (nur geaenderte Spalten, alt wird beim Schreiben geprueft).
  let motivAenderung = null;
  if (k.motivAenderung) {
    if (!motivDa) throw new Error(`Motive: Zeile "${k.kurz}" fehlt – Änderung nicht möglich.`);
    const alt = M[motivIdx];
    const neu = mh.map((_, j) => alt[j] ?? '');
    const spalten = [];
    for (const [name, fn] of Object.entries(k.motivAenderung)) {
      const j = requireHeader(mh, name, 'Motive');
      const wert = fn(t(alt[j]));
      if (wert !== t(alt[j])) { neu[j] = wert; spalten.push({ spalte: name, alt: t(alt[j]), neu: wert }); }
    }
    motivAenderung = { zeile: motivIdx + 1, alt, neu, spalten, gleich: !spalten.length };
  }
  const kh = K[0] ?? [];
  const kName = requireHeader(kh, 'Kategoriename', 'Struktur_Kategorien');
  const kNr = findHeader(kh, 'Kategorienummer');
  const kHinweis = findHeader(kh, 'SEO_Hinweis');
  const kategorieDa = !k.kategorie || K.slice(1).some(r => klein(r[kName]) === klein(k.kategorie.name));
  // FM2: tote Zeile (geloeschte Kategorie) umschreiben statt anhaengen.
  const ersetzIdx = !kategorieDa && k.strukturErsetzt && kNr >= 0 ? K.findIndex((r, i) => i > 0 && t(r[kNr]) === t(k.strukturErsetzt)) : -1;
  // FM2: weitere SEO_Hinweise je Kategorienummer (nur geaenderte).
  const hinweiseNeu = (k.seoHinweiseNeu ?? []).map(h => {
    const i = kNr >= 0 ? K.findIndex((r, j) => j > 0 && t(r[kNr]) === t(h.nummer)) : -1;
    if (i < 0 || kHinweis < 0) return { nummer: h.nummer, fehler: `Struktur_Kategorien: Kategorie ${h.nummer} oder Spalte SEO_Hinweis fehlt.` };
    const alt = K[i];
    const neu = kh.map((_, j) => (j === kHinweis ? h.hinweis : alt[j] ?? ''));
    return { nummer: h.nummer, zeile: i + 1, alt, neu, altHinweis: t(alt[kHinweis]), neuHinweis: h.hinweis, gleich: t(alt[kHinweis]) === t(h.hinweis) };
  });
  const sh = S[0] ?? [];
  const sTyp = requireHeader(sh, 'Typ', 'SEO_Karte'), sName = requireHeader(sh, 'Name', 'SEO_Karte');
  const karteDa = !k.kategorie || S.slice(1).some(r => t(r[sTyp]) === 'Kategorie' && klein(r[sName]) === klein(k.kategorie.name));

  return {
    artikel,
    zaehler: {
      ssotZuletzt: maxSsot(E.slice(1).map(r => r[eId])),
      maskeZuletzt: letzteZeile(E), variantenZuletzt: letzteZeile(V), motiveZuletzt: letzteZeile(M),
      kategorienZuletzt: letzteZeile(K), karteZuletzt: letzteZeile(S),
    },
    motive:     motivDa ? { vorhanden: true } : { zeile: letzteZeile(M) + 1, werte: motivZeile(mh, heute, k) },
    motivAenderung,
    kategorie:  kategorieDa ? { vorhanden: true }
      : ersetzIdx > 0 ? { zeile: ersetzIdx + 1, ersetzt: K[ersetzIdx], werte: kategorieZeile(kh, kategorieId, k, K[ersetzIdx]) }
      : { zeile: letzteZeile(K) + 1, werte: kategorieZeile(kh, kategorieId, k) },
    karte:      karteDa ? { vorhanden: true } : { zeile: letzteZeile(S) + 1, werte: karteZeile(sh, kategorieId, heute, k) },
    hinweiseNeu,
  };
}

function maxSsot(ids) {
  const s = (ids ?? []).map(t).filter(x => /^JFN-\d{4}-\d+$/.test(x)).sort();
  return s[s.length - 1] ?? '';
}

function zeileNachKopf(header, felder) {
  return header.map(h => { const k = Object.keys(felder).find(n => findHeader([h], n) === 0); return k ? felder[k] : ''; });
}

export function motivZeile(header, heute, k = HALLOWEEN) {
  const z = k.motivZeile;
  return zeileNachKopf(header, {
    Artikelkurzbezeichnung: k.kurz, Motiv: z.motiv, Druckposition: z.druckposition,
    Druckfarben: z.druckfarben, Druckfarbe_je_Textilfarbe: z.druckfarbeJeTextilfarbe,
    Serie_Kontext: z.serieKontext, Nur_intern: z.nurIntern, Offen: z.offen, Stand: heute ?? '',
  });
}

/**
 * Zeile fuer Struktur_Kategorien. Pfad "Eltern > Name" fuer Unterkategorien (FM2).
 * alt = umzuschreibende Zeile: Spalten, die hier nicht gesetzt werden (Instagram,
 * TikTok), bleiben wie sie sind.
 */
export function kategorieZeile(header, kategorieId, k = HALLOWEEN, alt = null) {
  const neu = zeileNachKopf(header, {
    Kategorienummer: kategorieId ? String(kategorieId) : '', Kategorien: k.kategorie.pfad ?? k.kategorie.name,
    Kategoriename: k.kategorie.name, SEO_Hinweis: k.kategorieSeoHinweis,
  });
  if (!alt) return neu;
  const gesetzt = new Set(['Kategorienummer', 'Kategorien', 'Kategoriename', 'SEO_Hinweis'].map(n => findHeader(header, n)));
  return header.map((_, j) => (gesetzt.has(j) ? neu[j] : alt[j] ?? ''));
}

export function karteZeile(header, kategorieId, heute, k = HALLOWEEN) {
  return zeileNachKopf(header, {
    Typ: 'Kategorie', Name: k.kategorie.name, Pfad: k.kategorie.pfad ?? k.kategorie.name, WC_ID: kategorieId ? String(kategorieId) : '',
    Oberkategorie: k.kategorie.oberkategorie ?? k.kategorie.name, Soll_Keyphrase: k.kategorieKarte.keyphrase,
    Soll_Synonyme: k.kategorieKarte.synonyme.join(', '), Status: 'Vorschlag', Stand: heute ?? '',
    Notiz: k.karteNotiz ?? 'HW2: vorbereitet, Yoast-Werte folgen',
  });
}

/**
 * Anzahl Shop-Aufrufe fuer --write (Planung, ohne Zuruecklesen von Fehlern).
 * Je Artikel: GET sku + POST Produkt + Bloecke + Zuruecklesen (100 je Seite).
 */
export function geplanteAufrufe(plaene, { kategorieFehlt = true, neueTerme = 0, bilderJeArtikel = 0 } = {}) {
  const bereit = plaene.filter(p => p.status === 'bereit');
  const jeArtikel = bereit.map(p => {
    const n = p.varianten.length;
    return bilderJeArtikel + 2 + teileInBloecke(p.varianten, BLOCK_MAX).length + Math.max(1, Math.ceil((n + 1) / 100));
  });
  const vorlauf = 5;   // attributes, terms Farbe, terms Groesse, shipping_classes, brands
  const summe = vorlauf + (kategorieFehlt ? 2 : 0) + neueTerme + jeArtikel.reduce((a, b) => a + b, 0);
  return { jeArtikel, summe, sekunden: summe * TAKT_MS / 1000 };
}

// ── Shop-Zugriff (getaktet) ─────────────────────────────────────────────────

/** Fehler, der den Lauf beendet; traegt den Stand (was schon angelegt ist). */
export class AnlageStopp extends Error {
  constructor(grund, stand, ursache) {
    super(`Lauf gestoppt: ${grund}`);
    this.name = 'AnlageStopp';
    this.stand = stand;
    this.ursache = ursache;
  }
}

export const istStoppFehler = err => istLaufStopp(err) || err?.response?.status === 502;

/**
 * WooCommerce-Client mit Takt: hoechstens ein Aufruf je `taktMs`, gezaehlt.
 * Gleiche Schnittstelle wie getWcClient (get/post/put), damit
 * leseAlleVariationen ihn ebenfalls nutzt.
 */
export function getakteterClient(wc, { taktMs = TAKT_MS, warte = ms => new Promise(r => setTimeout(r, ms)), jetzt = () => Date.now() } = {}) {
  let letzte = -Infinity;
  const zaehler = { get: 0, post: 0, put: 0 };
  const takt = async () => {
    const w = letzte + taktMs - jetzt();
    if (w > 0) await warte(w);
    letzte = jetzt();
  };
  const mach = m => async (...args) => { await takt(); zaehler[m]++; return wc[m](...args); };
  // Andere Shop-Aufrufe (WordPress-Upload) im selben Takt und Zaehler.
  const getaktet = (art, fn) => async (...args) => { await takt(); zaehler[art] = (zaehler[art] ?? 0) + 1; return fn(...args); };
  return { get: mach('get'), post: mach('post'), put: mach('put'), getaktet, zaehler, shopLabel: wc.shopLabel };
}

/** Globale Attribut-IDs ueber den Namen (Farbe, Größe). Fehlt eins -> Fehler. */
export function attributIds(attribute) {
  const finde = name => (attribute ?? []).find(a => klein(a.name) === klein(name))?.id ?? null;
  const ids = { farbe: finde(FARB_ACHSE), groesse: finde(GROESSE_ACHSE), motivGlobal: finde(MOTIV_ACHSE) };
  if (!ids.farbe || !ids.groesse) throw new Error(`Globales Attribut fehlt: ${[!ids.farbe && FARB_ACHSE, !ids.groesse && GROESSE_ACHSE].filter(Boolean).join(', ')}.`);
  return ids;
}

/** Alle Terme eines Attributs (Namen), alle Seiten. */
export async function leseTerme(wc, attributId) {
  const alle = [];
  for (let page = 1; ; page++) {
    seitenGrenze(page, { wc, pfad: 'products/attributes/terms' });
    const { data } = await wc.get(`products/attributes/${attributId}/terms`, { per_page: 100, page });
    const liste = seitenListe(data, { wc, pfad: 'products/attributes/terms' });
    alle.push(...liste.map(x => ({ id: x.id, name: x.name })));
    if (liste.length < 100) return alle;
  }
}

/** Shop-Vorlauf (nur GET): Attribute, Terme, Versandklassen, Kategorie, Marke. */
export async function leseShopStand(wc, { markenSlug = 'jammifashion', k = HALLOWEEN } = {}) {
  const attrListe = seitenListe((await wc.get('products/attributes', { per_page: 100 })).data, { wc, pfad: 'products/attributes' });
  const ids = attributIds(attrListe);
  const farbTerme = await leseTerme(wc, ids.farbe);
  const groessenTerme = await leseTerme(wc, ids.groesse);
  const klassen = seitenListe((await wc.get('products/shipping_classes', { per_page: 100 })).data, { wc, pfad: 'products/shipping_classes' });
  let kategorie = null, kategorienFehlen = [];
  if (k.kategorie) {
    const kats = seitenListe((await wc.get('products/categories', { search: k.kategorie.name, per_page: 100 })).data, { wc, pfad: 'products/categories' });
    // FM2: Unterkategorie -> Eltern-ID aus der Kollektion (Halloween: 0).
    kategorie = kats.find(x => klein(x.name) === klein(k.kategorie.name) && Number(x.parent) === Number(k.kategorie.parent ?? 0)) ?? null;
    if (k.kategorieIdsZusatz?.length) {
      const zus = seitenListe((await wc.get('products/categories', { include: k.kategorieIdsZusatz.join(','), per_page: 100 })).data, { wc, pfad: 'products/categories' });
      kategorienFehlen = k.kategorieIdsZusatz.filter(id => !zus.some(x => x.id === id));
    }
  } else {
    // Feste Kategorien: nur ueber die IDs nachpruefen (include).
    const kats = seitenListe((await wc.get('products/categories', { include: k.kategorieIds.join(','), per_page: 100 })).data, { wc, pfad: 'products/categories' });
    kategorienFehlen = k.kategorieIds.filter(id => !kats.some(x => x.id === id));
    kategorie = { ids: k.kategorieIds, namen: k.kategorieIds.map(id => kats.find(x => x.id === id)?.name ?? '?') };
  }
  const marken = (await wc.get('products/brands', { slug: markenSlug })).data;
  const marke = (Array.isArray(marken) ? marken : [marken]).find(m => m?.slug === markenSlug) ?? null;
  return {
    attrIds: { farbe: ids.farbe, groesse: ids.groesse }, motivGlobal: ids.motivGlobal,
    farbTerme: farbTerme.map(x => x.name), groessenTerme: groessenTerme.map(x => x.name),
    versandklassen: klassen.map(x => x.slug),
    kategorie: kategorie?.ids ? kategorie : (kategorie ? { id: kategorie.id, count: kategorie.count, slug: kategorie.slug, bild: kategorie.image?.id ?? null } : null), kategorienFehlen,
    marke: marke ? { id: marke.id, name: marke.name } : null,
  };
}

/** Produkt ueber die exakte SKU (status any) - fuer Fortsetzen ohne Doppelanlage. */
export async function findeProdukt(wc, sku) {
  const { data } = await wc.get('products', { sku, status: 'any', per_page: 10, _fields: 'id,sku,status,type,name' });
  const liste = seitenListe(data, { wc, pfad: 'products' }).filter(p => t(p.sku) === t(sku));
  if (liste.length > 1) throw new Error(`SKU "${sku}" ist im Shop ${liste.length}-mal vergeben (${liste.map(p => p.id).join(', ')}) – nichts angelegt.`);
  return liste[0] ?? null;
}

/**
 * Einen Artikel im Shop anlegen bzw. vervollstaendigen (nur mit --write).
 * Gibt { produktId, angelegt, vorhanden, fehler, variationen } zurueck.
 * Pruefseite/Zeitlimit/502 -> AnlageStopp mit Stand.
 */
export async function legeArtikelAn(wc, plan, kontext, { log = () => {} } = {}) {
  const stand = { artikel: plan.artikel.titel, sku: plan.artikelnummer, produktId: null, produktNeu: false, angelegt: 0, vorhanden: 0, fehler: [] };
  try {
    let produkt = await findeProdukt(wc, plan.artikelnummer);
    if (produkt) {
      if (produkt.type !== 'variable') throw new Error(`SKU "${plan.artikelnummer}" gehört zu Produkt ${produkt.id} vom Typ ${produkt.type} – nichts angelegt.`);
      log(`  vorhanden: Produkt ${produkt.id} (${produkt.status}) – nur Fehlendes wird ergänzt`);
    } else {
      const { data } = await wc.post('products', produktPayload(plan, kontext));
      produkt = Array.isArray(data) ? data[0] : data;
      if (!produkt?.id) throw new Error('WooCommerce hat keine Produkt-ID zurückgegeben – keine Variationen angelegt.');
      stand.produktNeu = true;
      log(`  angelegt: Produkt ${produkt.id} (Entwurf)`);
    }
    stand.produktId = produkt.id;

    const neu = variationsPayloads(plan, kontext.attrIds, kontext.bilder);
    const bestehend = stand.produktNeu ? [] : await leseAlleVariationen(wc, produkt.id);
    const sperre = sperreDoppelte(neu, bestehend);
    stand.vorhanden = sperre.vorhanden.length;
    const anlegen = sperre.anlegen.map(i => neu[i]);
    for (const block of teileInBloecke(anlegen, BLOCK_MAX)) {
      const { data } = await wc.post(`products/${produkt.id}/variations/batch`, { create: block });
      for (const [i, c] of (data?.create ?? []).entries()) {
        if (c?.id && !c.error) stand.angelegt++;
        else stand.fehler.push(`${block[i]?.sku}: ${c?.error?.message ?? 'ohne ID'}`);
      }
      log(`  Block: ${block.length} gesendet, bisher ${stand.angelegt} angelegt`);
    }

    const imShop = await leseAlleVariationen(wc, produkt.id);
    const zuordnung = ordneWcIdsZu(plan.varianten.map(v => ({ paare: paareAusWc(variationsAttribute(v)), wcVariationId: '' })),
      imShop.map(v => ({ id: v.id, attributes: v.attributes })));
    const ids = [];
    for (const z of zuordnung.zuordnung) ids[z.index] = z.id;
    const fehlend = plan.varianten.filter((_, i) => !ids[i]).length;
    return { ...stand, variationen: imShop.length, wcIds: ids, fehlend, hinweise: zuordnung.hinweise };
  } catch (err) {
    if (istStoppFehler(err)) throw new AnlageStopp(err.message, stand, err);
    throw Object.assign(err, { stand });
  }
}

/** Shop-Kombinationen vollstaendig? (Schluessel ueber wcSchluessel). */
export function fehlendeKombinationen(plan, shopVariationen) {
  const da = new Set((shopVariationen ?? []).map(v => wcSchluessel(paareAusWc(v.attributes))));
  return plan.varianten.filter(v => !da.has(wcSchluessel(paareAusWc(variationsAttribute(v)))));
}

// ── Sheets schreiben (nur --write, nach vollstaendiger Shop-Anlage) ─────────

/**
 * Maske- und Varianten-Zeilen eines Artikels anhaengen (RAW). Liest vorher neu:
 * Artikelnummer schon in der Maske -> keine zweite Zeile; SSOT-ID hat schon
 * Varianten-Zeilen -> keine neuen (Nachtrag: scripts/fill-wc-variation-ids.js).
 */
export async function schreibeArtikelSheets(sheets, spreadsheetId, plan, { produktId, marke, wcIds }) {
  const lies = async tab => (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'` })).data.values ?? [];
  const E = await lies('Erfassungsmaske');
  const eh = E[0] ?? [];
  const eId = requireHeaderAny(eh, ['SSOT-ID', 'ID'], 'Erfassungsmaske');
  const eArt = requireHeader(eh, 'Artikelnummer', 'Erfassungsmaske');
  let ssot, maskeNeu = false;
  const da = E.slice(1).find(r => t(r[eArt]) === plan.artikelnummer);
  if (da) ssot = t(da[eId]);
  else {
    ssot = naechsteSsotIds(E.slice(1).map(r => r[eId]), 1)[0];
    await schreibeNeueZeilen(sheets, spreadsheetId, 'Erfassungsmaske', [buildRow(eh, maskeBody(plan, { produktId, marke }), ssot)]);
    maskeNeu = true;
  }

  const V = await lies('Varianten');
  const vh = V[0] ?? [];
  const vSsot = requireHeader(vh, 'SSOT-ID', 'Varianten');
  if (V.slice(1).some(r => t(r[vSsot]) === ssot)) return { ssot, maskeNeu, variantenNeu: 0, hinweis: `${ssot}: Varianten-Zeilen schon da – nicht neu geschrieben.` };
  const payload = variantenSheetPayload(plan, wcIds);
  pruefeVariantenPayload(ssot, payload);
  if (findHeader(vh, 'LShop_ArticleNr') < 0) throw new Error('Reiter Varianten: Spalte LShop_ArticleNr fehlt – nichts geschrieben.');
  const zeilen = baueVariantenZeilen(vh, ssot, payload, []);
  await schreibeNeueZeilen(sheets, spreadsheetId, 'Varianten', zeilen);
  return { ssot, maskeNeu, variantenNeu: zeilen.length, hinweis: null };
}

/** FP_Artikel-Zeile (Business-Sheet) fuer einen Festpreis-Partner, Muster der Bestandszeilen. */
export function fpArtikelZeile(header, plan, produktId) {
  const fp = plan.k?.fp;
  if (!fp) return null;
  return zeileNachKopf(header, {
    'Partner-ID': fp.partnerId, 'Produkt-ID': String(produktId ?? ''), Artikelname: plan.artikel.titel,
    'Festpreis-EK-Netto': 0, 'Handling-Gebühr': 0, Versandart: plan.artikel.fpVersandart,
    'WC-Kategorie': fp.wcKategorie, Artikelkategorie: plan.artikel.fpArtikelkategorie,
  });
}

// ── Sheets schreiben ohne values.append: lib/sheet-zeilen.js (seit LS4 gemeinsam) ──

/** Eine fertige Zeile anhaengen (Motive, Struktur_Kategorien, SEO_Karte, FP_Artikel) – ohne append. */
export async function haengeZeileAn(sheets, spreadsheetId, tab, werte) {
  return schreibeNeueZeilen(sheets, spreadsheetId, tab, [werte]);
}


/** Lieferzeit-Standard aus den Zeilen von Struktur_Lieferzeiten. */
export function standardLieferzeit(rows) {
  return parseLieferzeiten(rows).find(l => l.standard);
}
