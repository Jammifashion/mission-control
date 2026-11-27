// DSGVO-Pruefliste (FIX4): wo kommt ein Kunde ausser im Kunden-Reiter noch vor? Reine Logik; Lesen/Schreiben in
// lib/kundeFundstellen.js. Nichts automatisch - die Oberflaeche zeigt Anzahlen und leert je Bereich nach Rueckfrage.
// Zuordnung: Kunden_Nr (Auftraege, Aufgaben, Bestellseiten) bzw. Name/E-Mail genau (Trikots, Kundenanfragen; Gross/Klein
// und Leerzeichen egal). Antworten nur Anzahlen, nie Inhalte.
import { zeilenAus } from './loeschlauf.js';

const t = v => String(v ?? '').trim();
const norm = v => t(v).toLowerCase().replace(/\s+/g, ' ');

export const BEREICHE = {
  auftraege:   { label: 'Aufträge (Notiz)', felder: ['Notiz'] },
  positionen:  { label: 'Auftragspositionen (Notiz, Druckname)', felder: ['Notiz', 'Druckname'] },
  aufgaben:    { label: 'Aufgaben (Notiz)', felder: ['Notiz'] },
  bestellseite:{ label: 'Bestellseite (Kürzel, Notiz, Rückenname, Wunsch)', felder: ['Kuerzel', 'Notiz', 'Trikot_Name', 'Wunsch'] },
  trikots:     { label: 'Trikots (Kunde, Rückenname, Rohtext)', felder: ['Kunde', 'Name', 'Rohtext'] },
  anfragen:    { label: 'Kundenanfragen (Name, Mail, Texte)', felder: ['Kunde-Name', 'Kunde-Email', 'Produkt-Beschreibung', 'Varianten', 'Anmerkungen-Kunde', 'Notiz-intern'] },
  // KA2: Gespraechsverlauf der passenden Anfragen (ueber die KA-Nr.); wird beim Leeren der Anfragen mitgeleert
  verlauf:     { label: 'Gesprächsverlauf der Kundenanfragen', felder: ['Nachrichten'] },
};

/** Zeilen, die passen und mindestens ein nicht leeres Feld haben -> { kopf, leeren: [{ zeile, id, zellen }] }. */
export function treffer(werte, passt, felder, idSpalte) {
  const { kopf, zeilen } = zeilenAus(werte);
  const leeren = [];
  for (const z of zeilen) {
    if (!passt(z)) continue;
    const zellen = felder.filter(f => kopf.includes(f) && t(z[f]) !== '').map(f => ({ feld: f, alt: z[f] }));
    if (zellen.length) leeren.push({ zeile: z._zeile, id: t(z[idSpalte]), zellen });
  }
  return { kopf, leeren };
}

/**
 * @param {object} d  { kundenNr, kunde: { Name, 'E-Mail' }, auftraege, positionen, aufgaben, bestellseiten, eintraege, trikots, anfragen, verlauf } (Werte je Reiter)
 * @returns {{ [bereich]: { kopf, leeren } }}
 */
export function fundstellenPlan(d) {
  const nr = t(d.kundenNr);
  const name = norm(d.kunde?.Name), mail = norm(d.kunde?.['E-Mail']);
  const auNr = new Set(zeilenAus(d.auftraege).zeilen.filter(z => t(z.Kunden_Nr) === nr).map(z => t(z.Auftrag_Nr)));
  const zugaenge = new Set(zeilenAus(d.bestellseiten).zeilen.filter(z => t(z.Kunden_Nr) === nr).map(z => t(z.Zugang_ID)));
  const passtAnfrage = z => (!!name && norm(z['Kunde-Name']) === name) || (!!mail && norm(z['Kunde-Email']) === mail);
  const kaNr = new Set(zeilenAus(d.anfragen).zeilen.filter(passtAnfrage).map(z => t(z['Anfrage-ID'])).filter(Boolean));
  return {
    auftraege:    treffer(d.auftraege, z => t(z.Kunden_Nr) === nr, BEREICHE.auftraege.felder, 'Auftrag_Nr'),
    positionen:   treffer(d.positionen, z => auNr.has(t(z.Auftrag_Nr)), BEREICHE.positionen.felder, 'Position_ID'),
    aufgaben:     treffer(d.aufgaben, z => t(z.Fuer) === nr, BEREICHE.aufgaben.felder, 'Aufgabe_Nr'),
    bestellseite: treffer(d.eintraege, z => zugaenge.has(t(z.Zugang_ID)), BEREICHE.bestellseite.felder, 'Eintrag_ID'),
    trikots:      treffer(d.trikots, z => !!name && norm(z.Kunde) === name, BEREICHE.trikots.felder, 'Zeilen-ID'),
    anfragen:     treffer(d.anfragen, passtAnfrage, BEREICHE.anfragen.felder, 'Anfrage-ID'),
    verlauf:      treffer(d.verlauf, z => kaNr.has(t(z['Anfrage-ID'])), BEREICHE.verlauf.felder, 'Anfrage-ID'),
  };
}

/** Antwort fuer die Oberflaeche: nur Anzahlen je Bereich. */
export function fundstellenAntwort(plan) {
  return Object.entries(BEREICHE).map(([bereich, b]) => ({
    bereich, label: b.label, zeilen: plan[bereich]?.leeren.length ?? 0,
    zellen: (plan[bereich]?.leeren ?? []).reduce((s, x) => s + x.zellen.length, 0),
  }));
}
