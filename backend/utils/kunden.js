// Kundenstamm (AM-1), reine Logik ohne Netz. Reiter `Kunden` im eigenen Sheet "Kunden" (KUNDEN_SHEET_ID),
// getrennt vom SSOT. Lesen/Schreiben in lib/kunden.js, Lexware-Abruf (nur lesen) in lib/lexware.js.
//
// Datenschutz: Namen, Adressen, Mail, Telefon verlassen diese Logik nur als Felder der Kundenliste fuer die
// Oberflaeche - nie in Fehlertexten, Zaehlern oder Meldungen (dort nur Kunden_Nr und Zahlen).

export const TAB_KUNDEN = 'Kunden';

export const KUNDEN_SPALTEN = [
  'Kunden_Nr', 'Lexoffice_Nr', 'Lexoffice_ID', 'Art', 'Name', 'Spitzname', 'Ansprechpartner', 'E-Mail', 'Telefon',
  'Strasse', 'PLZ', 'Ort', 'Land', 'Notiz', 'Status', 'Quelle', 'Angelegt', 'Stand',
];
// Spalten mit Textformat (fuehrende Nullen, "+49 …", lange Nummern).
export const KUNDEN_TEXT = ['Kunden_Nr', 'Lexoffice_Nr', 'Lexoffice_ID', 'Telefon', 'PLZ'];

export const ART = { FIRMA: 'Firma', VEREIN: 'Verein', PERSON: 'Person' };
export const ARTEN = [ART.FIRMA, ART.VEREIN, ART.PERSON];
export const STATUS = { AKTIV: 'aktiv', ARCHIVIERT: 'archiviert', GESPERRT: 'gesperrt-DSGVO' };
export const QUELLE = { LEXOFFICE: 'lexoffice', MC: 'mc' };

// Felder, die der Import aus Lexware fuellt. Spitzname, Notiz, Status, Kunden_Nr, Angelegt fasst er NIE an.
export const LEXOFFICE_FELDER = [
  'Lexoffice_Nr', 'Lexoffice_ID', 'Art', 'Name', 'Ansprechpartner', 'E-Mail', 'Telefon', 'Strasse', 'PLZ', 'Ort', 'Land',
];
// Ansprechpartner (Inhaber 03.11.): fehlt in Lexware fast immer -> in MC pflegbar; der Import fuellt ihn nur, wenn leer.
export const NUR_WENN_LEER = ['Ansprechpartner'];
// In MC aenderbar bei Quelle lexoffice (der Rest kommt aus Lexware); bei Quelle mc alle MC_FREI_FELDER.
export const MC_FELDER = ['Spitzname', 'Ansprechpartner', 'Notiz'];
// Bei Quelle lexoffice in MC gesperrt.
export const LEX_GESPERRT = LEXOFFICE_FELDER.filter(f => !MC_FELDER.includes(f));
export const MC_FREI_FELDER = ['Art', 'Name', 'Spitzname', 'Ansprechpartner', 'E-Mail', 'Telefon', 'Strasse', 'PLZ', 'Ort', 'Land', 'Notiz'];
// Personenbezogen: leert die DSGVO-Sperre.
export const PERSONEN_FELDER = ['Name', 'Spitzname', 'Ansprechpartner', 'E-Mail', 'Telefon', 'Strasse', 'PLZ', 'Ort', 'Land', 'Notiz'];

export const FELD_MAX = { Name: 120, Spitzname: 200, Ansprechpartner: 120, 'E-Mail': 120, Telefon: 40, Strasse: 120, PLZ: 12, Ort: 80, Land: 2, Notiz: 1000 };

const t = v => String(v ?? '').trim();
const klein = s => t(s).toLowerCase();

export function fehler(text, status = 422, code) {
  const e = new Error(text);
  e.status = status;
  if (code) e.code = code;
  return e;
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/**
 * Reiter-Werte -> { idx, kunden: [{ ...Spalten, _zeile }], fehlt }. Spalten nur ueber den Namen.
 * Zeilen ohne Kunden_Nr zaehlen nicht (Leerzeilen).
 */
export function kundenZeilen(werte) {
  const kopf = (werte?.[0] ?? []).map(t);
  const idx = Object.fromEntries(kopf.map((k, i) => [k, i]).filter(([k]) => k));
  const fehlt = KUNDEN_SPALTEN.filter(s => idx[s] === undefined);
  const kunden = [];
  (werte ?? []).slice(1).forEach((r, i) => {
    const k = Object.fromEntries(KUNDEN_SPALTEN.map(s => [s, idx[s] === undefined ? '' : t(r?.[idx[s]])]));
    if (k.Kunden_Nr) kunden.push({ ...k, _zeile: i + 2 });
  });
  return { idx, kunden, fehlt };
}

/** Zeile (Objekt) -> Sheet-Zeile in der Spaltenfolge des Reiters (Breite = Kopfzeile). */
export function alsSheetZeile(idx, obj, breite) {
  const n = breite ?? Math.max(...Object.values(idx)) + 1;
  const zeile = Array.from({ length: n }, () => '');
  for (const [s, i] of Object.entries(idx)) if (KUNDEN_SPALTEN.includes(s)) zeile[i] = t(obj[s]);
  return zeile;
}

/** Naechste Kunden-Nr. K-NNNNN: hoechste + 1, nie wiederverwendet (auch gesperrte/archivierte zaehlen). */
export function naechsteKundenNr(kunden, versatz = 0) {
  const max = (kunden ?? []).reduce((m, k) => {
    const x = /^K-(\d+)$/.exec(t(k.Kunden_Nr));
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `K-${String(max + 1 + versatz).padStart(5, '0')}`;
}

// ── Suche (Oberflaeche spiegelt das im Block Kunden-Liste) ───────────────────

/** Jedes Wort muss in Name, Spitzname, Kunden-Nr., Lexoffice-Nr. oder Ort vorkommen. */
export function sucheKunden(kunden, q) {
  const woerter = klein(q).split(/\s+/).filter(Boolean);
  if (!woerter.length) return [...(kunden ?? [])];
  return (kunden ?? []).filter(k => {
    const text = [k.Name, k.Spitzname, k.Kunden_Nr, k.Lexoffice_Nr, k.Ort].map(klein).join(' ');
    return woerter.every(w => text.includes(w));
  });
}

// ── Lexware-Kontakt -> Kundenfelder ──────────────────────────────────────────

const erste = (...listen) => {
  for (const l of listen) for (const v of (Array.isArray(l) ? l : [])) if (t(v)) return t(v);
  return '';
};

/** Primaerer Ansprechpartner einer Firma (primary, sonst der erste). */
export function ansprechpartner(company) {
  const liste = Array.isArray(company?.contactPersons) ? company.contactPersons : [];
  return liste.find(p => p?.primary) ?? liste[0] ?? null;
}

/**
 * Lexware-Kontakt (GET /v1/contacts) -> Lexoffice-Felder des Reiters. Firma -> Art Firma, Person -> Art Person
 * (Verein kennt Lexware nicht; das setzt der Mensch in MC, der Import laesst es dann stehen).
 */
export function kundeAusKontakt(c) {
  const firma = c?.company && typeof c.company === 'object';
  const ap = firma ? ansprechpartner(c.company) : null;
  const name = firma ? t(c.company.name) : [t(c?.person?.firstName), t(c?.person?.lastName)].filter(Boolean).join(' ');
  const mail = c?.emailAddresses ?? {};
  const tel = c?.phoneNumbers ?? {};
  const adr = c?.addresses?.billing?.[0] ?? c?.addresses?.shipping?.[0] ?? {};
  return {
    Lexoffice_Nr: c?.roles?.customer?.number === undefined || c?.roles?.customer?.number === null ? '' : t(c.roles.customer.number),
    Lexoffice_ID: t(c?.id),
    Art: firma ? ART.FIRMA : ART.PERSON,
    Name: name,
    Ansprechpartner: ap ? [t(ap.firstName), t(ap.lastName)].filter(Boolean).join(' ') : '',
    'E-Mail': erste(mail.business, mail.office, mail.private, mail.other, [ap?.emailAddress]),
    Telefon: erste(tel.business, tel.office, tel.mobile, tel.private, tel.other, [ap?.phoneNumber]),
    Strasse: t(adr.street),
    PLZ: t(adr.zip),
    Ort: t(adr.city),
    Land: t(adr.countryCode),
  };
}

const nameSchluessel = s => klein(s).replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/** Trockenlauf: nur Zahlen ueber die Lexware-Kontakte. */
export function zaehleKontakte(kontakte) {
  const z = {
    gesamt: 0, firmen: 0, personen: 0, archiviert: 0, mitAnsprechpartner: 0, firmenOhneAnsprechpartner: 0,
    mitMail: 0, ohneMail: 0, mitAdresse: 0, ohneAdresse: 0, ohneKundennummer: 0, dublettenGruppen: 0, dublettenKontakte: 0,
  };
  const namen = new Map();
  for (const c of kontakte ?? []) {
    const k = kundeAusKontakt(c);
    z.gesamt++;
    if (c?.archived) z.archiviert++;
    if (k.Art === ART.FIRMA) {
      z.firmen++;
      if (k.Ansprechpartner) z.mitAnsprechpartner++; else z.firmenOhneAnsprechpartner++;
    } else z.personen++;
    if (k['E-Mail']) z.mitMail++; else z.ohneMail++;
    if (k.Strasse || k.Ort) z.mitAdresse++; else z.ohneAdresse++;
    if (!k.Lexoffice_Nr) z.ohneKundennummer++;
    const n = nameSchluessel(k.Name);
    if (n) namen.set(n, (namen.get(n) ?? 0) + 1);
  }
  for (const n of namen.values()) if (n > 1) { z.dublettenGruppen++; z.dublettenKontakte += n; }
  return z;
}

/**
 * Importplan (AM-1): Abgleich ueber Lexoffice_ID, Rueckfall Lexoffice_Nr. Nur Lexoffice-Felder werden
 * ueberschrieben; Spitzname, Notiz, Status, Kunden_Nr, Angelegt nie. Art: "Verein" bleibt bei einer Firma stehen.
 * Gesperrte (DSGVO) Zeilen werden nie wieder befuellt. Archivierte Lexware-Kontakte legen keine neue Zeile an.
 * Ein Kontakt, der auf mehrere Zeilen passt, und eine Zeile, auf die mehrere Kontakte passen -> nichts, Zaehler.
 * nurFirmen (Inhaber 03.11.): Personen-Kontakte ohne Zeile im Sheet werden uebersprungen (Zaehler personenUebersprungen);
 * einzeln uebernommene Personen (AM-1-1) haben eine Zeile und werden mit abgeglichen (Zaehler personenAbgeglichen).
 * @returns {{ neu: object[], aenderungen: { kundenNr, zeile, felder: object }[], zaehler: object }}
 */
export function importPlan({ kunden, kontakte, jetzt, nurFirmen = false }) {
  const zaehler = {
    kontakte: 0, neu: 0, geaendert: 0, unveraendert: 0, felderGeaendert: 0, archiviertUebersprungen: 0,
    gesperrtUebersprungen: 0, mehrdeutig: 0, ohneId: 0, personenUebersprungen: 0, personenAbgeglichen: 0,
  };
  const nachId = new Map(), nachNr = new Map();
  const merke = (map, key, k) => { if (!key) return; map.set(key, [...(map.get(key) ?? []), k]); };
  for (const k of kunden ?? []) { merke(nachId, t(k.Lexoffice_ID), k); merke(nachNr, t(k.Lexoffice_Nr), k); }

  const treffer = new Map();   // Kunden_Nr -> Anzahl passender Kontakte
  const zuordnung = [];
  for (const c of kontakte ?? []) {
    zaehler.kontakte++;
    const soll = kundeAusKontakt(c);
    if (!soll.Lexoffice_ID) { zaehler.ohneId++; continue; }
    let passend = nachId.get(soll.Lexoffice_ID) ?? [];
    if (!passend.length && soll.Lexoffice_Nr) passend = (nachNr.get(soll.Lexoffice_Nr) ?? []).filter(k => !t(k.Lexoffice_ID));
    if (passend.length > 1) { zaehler.mehrdeutig++; continue; }
    if (nurFirmen && soll.Art === ART.PERSON) {
      if (!passend.length) { zaehler.personenUebersprungen++; continue; }
      zaehler.personenAbgeglichen++;
    }
    if (passend.length === 1) treffer.set(passend[0].Kunden_Nr, (treffer.get(passend[0].Kunden_Nr) ?? 0) + 1);
    zuordnung.push({ c, soll, ist: passend[0] ?? null });
  }

  const neu = [], aenderungen = [];
  const angelegt = t(jetzt);
  for (const { c, soll, ist } of zuordnung) {
    if (!ist) {
      if (c?.archived) { zaehler.archiviertUebersprungen++; continue; }
      neu.push({
        ...soll, Kunden_Nr: naechsteKundenNr(kunden, neu.length), Spitzname: '', Notiz: '',
        Status: STATUS.AKTIV, Quelle: QUELLE.LEXOFFICE, Angelegt: angelegt, Stand: angelegt,
      });
      continue;
    }
    if ((treffer.get(ist.Kunden_Nr) ?? 0) > 1) { zaehler.mehrdeutig++; continue; }
    if (ist.Status === STATUS.GESPERRT) { zaehler.gesperrtUebersprungen++; continue; }
    const felder = {};
    for (const f of LEXOFFICE_FELDER) {
      let wert = soll[f];
      if (f === 'Art' && wert === ART.FIRMA && ist.Art === ART.VEREIN) wert = ART.VEREIN;
      if (NUR_WENN_LEER.includes(f) && t(ist[f])) continue;   // in MC gepflegt -> bleibt
      if (t(ist[f]) !== t(wert)) felder[f] = wert;
    }
    if (ist.Quelle !== QUELLE.LEXOFFICE) felder.Quelle = QUELLE.LEXOFFICE;
    if (!Object.keys(felder).length) { zaehler.unveraendert++; continue; }
    zaehler.geaendert++;
    zaehler.felderGeaendert += Object.keys(felder).length;
    aenderungen.push({ kundenNr: ist.Kunden_Nr, zeile: ist._zeile, felder: { ...felder, Stand: angelegt } });
  }
  zaehler.neu = neu.length;
  return { neu, aenderungen, zaehler };
}

// ── Pflege in MC ─────────────────────────────────────────────────────────────

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Eingabe pruefen und normalisieren; nur erlaubte Felder. Fehlertexte nennen das Feld, nie den Wert. */
export function pruefeEingabe(eingabe, erlaubt) {
  const aus = {};
  for (const f of erlaubt) {
    if (eingabe?.[f] === undefined) continue;
    // Notiz behaelt Zeilenumbrueche, sonst Leerraum zu einem Leerzeichen.
    const w = f === 'Notiz' ? t(eingabe[f]) : t(eingabe[f]).replace(/\s+/g, ' ');
    if (FELD_MAX[f] && w.length > FELD_MAX[f]) throw fehler(`${f} ist länger als ${FELD_MAX[f]} Zeichen.`);
    aus[f] = w;
  }
  if (aus.Art !== undefined && !ARTEN.includes(aus.Art)) throw fehler(`Art muss ${ARTEN.join(', ')} sein.`);
  if (aus['E-Mail'] && !MAIL.test(aus['E-Mail'])) throw fehler('E-Mail sieht nicht wie eine Mailadresse aus.');
  if (aus.Land) aus.Land = aus.Land.toUpperCase();
  if (aus.Land && !/^[A-Z]{2}$/.test(aus.Land)) throw fehler('Land als Ländercode mit zwei Buchstaben, z. B. DE.');
  return aus;
}

/** Neuer Kunde in MC: Quelle mc, ohne Lexoffice-Nr., Name und Art Pflicht. */
export function neuerKunde({ eingabe, kunden, jetzt }) {
  const f = pruefeEingabe(eingabe, MC_FREI_FELDER);
  if (!f.Name) throw fehler('Name fehlt.');
  if (!f.Art) throw fehler('Art fehlt (Firma, Verein oder Person).');
  return {
    ...Object.fromEntries(KUNDEN_SPALTEN.map(s => [s, ''])), ...f,
    Kunden_Nr: naechsteKundenNr(kunden), Status: STATUS.AKTIV, Quelle: QUELLE.MC, Angelegt: t(jetzt), Stand: t(jetzt),
  };
}

function findeKunde(kunden, kundenNr, stand) {
  const k = (kunden ?? []).find(x => x.Kunden_Nr === t(kundenNr));
  if (!k) throw fehler(`Kunde ${t(kundenNr) || '(ohne Nummer)'} nicht gefunden.`, 404);
  if (stand !== undefined && t(stand) !== t(k.Stand)) throw fehler(`${k.Kunden_Nr} wurde inzwischen geändert – bitte neu laden.`, 409, 'konflikt');
  return k;
}

/**
 * Bearbeiten: bei Quelle lexoffice nur Spitzname/Ansprechpartner/Notiz (Lexoffice-Felder -> 422 "wird aus Lexoffice übernommen"),
 * bei Quelle mc alle MC-Felder. Gesperrte Kunden nicht. Liefert { kunde, nachher, unveraendert }.
 */
export function bearbeitenPlan({ kunden, eingabe, jetzt }) {
  const k = findeKunde(kunden, eingabe?.kundenNr, eingabe?.stand);
  if (k.Status === STATUS.GESPERRT) throw fehler(`${k.Kunden_Nr} ist gesperrt (DSGVO) und nicht mehr änderbar.`, 409, 'gesperrt');
  const ausLex = k.Quelle === QUELLE.LEXOFFICE;
  if (ausLex) {
    const verboten = LEX_GESPERRT.filter(f => eingabe?.[f] !== undefined && t(eingabe[f]) !== t(k[f]));
    if (verboten.length) throw fehler(`${verboten.join(', ')} wird aus Lexoffice übernommen – dort ändern.`, 422, 'aus_lexoffice');
  }
  const f = pruefeEingabe(eingabe, ausLex ? MC_FELDER : MC_FREI_FELDER);
  if (!ausLex && f.Name === '') throw fehler('Name fehlt.');
  const nachher = { ...k, ...f };
  const unveraendert = Object.keys(f).every(s => t(f[s]) === t(k[s]));
  if (!unveraendert) nachher.Stand = t(jetzt);
  return { kunde: k, nachher, unveraendert };
}

/** Archivieren bzw. zurueckholen (aktiv). Kein Loeschen. */
export function archivPlan({ kunden, eingabe, jetzt }) {
  const k = findeKunde(kunden, eingabe?.kundenNr, eingabe?.stand);
  if (k.Status === STATUS.GESPERRT) throw fehler(`${k.Kunden_Nr} ist gesperrt (DSGVO).`, 409, 'gesperrt');
  const ziel = eingabe?.archivieren === false ? STATUS.AKTIV : STATUS.ARCHIVIERT;
  if (k.Status === ziel) return { kunde: k, nachher: k, unveraendert: true };
  return { kunde: k, nachher: { ...k, Status: ziel, Stand: t(jetzt) }, unveraendert: false };
}

/**
 * DSGVO-Sperre: Personenfelder leeren, Name -> "gelöscht K-NNNNN", Status gesperrt-DSGVO; Kunden_Nr, Lexoffice-ID/-Nr.
 * (damit der Import die Zeile erkennt und nie wieder befuellt), Quelle, Angelegt bleiben. Bestaetigung = die Kunden-Nr.
 * noch einmal getippt (zweite Bestaetigung nach dem Dialog).
 */
export function dsgvoPlan({ kunden, eingabe, jetzt }) {
  const k = findeKunde(kunden, eingabe?.kundenNr, eingabe?.stand);
  if (t(eingabe?.bestaetigung) !== k.Kunden_Nr) throw fehler(`Zur Bestätigung die Kunden-Nr. ${k.Kunden_Nr} eintippen.`, 422, 'bestaetigung');
  if (k.Status === STATUS.GESPERRT) return { kunde: k, nachher: k, unveraendert: true };
  const leer = Object.fromEntries(PERSONEN_FELDER.map(f => [f, '']));
  return {
    kunde: k,
    nachher: { ...k, ...leer, Name: `gelöscht ${k.Kunden_Nr}`, Status: STATUS.GESPERRT, Stand: t(jetzt) },
    unveraendert: false,
  };
}

/** Fuer die Oberflaeche: ohne _zeile, Felder in kleiner Schreibweise bleiben wie im Reiter (Spaltennamen). */
export function kundenAntwort(kunden) {
  return (kunden ?? []).map(({ _zeile, ...k }) => k);
}

// ── AM-1-1: einzelne Kunden aus Lexoffice ────────────────────────────────────

/** Kunde im Sheet zu einem Lexware-Kontakt (ID, sonst Nr. bei Zeilen ohne ID) oder null. */
export function kundeZuKontakt(kunden, soll) {
  return (kunden ?? []).find(k => soll.Lexoffice_ID && t(k.Lexoffice_ID) === soll.Lexoffice_ID)
    ?? (kunden ?? []).find(k => soll.Lexoffice_Nr && !t(k.Lexoffice_ID) && t(k.Lexoffice_Nr) === soll.Lexoffice_Nr) ?? null;
}

/** Trefferliste der Lexoffice-Suche fuer den Browser: nur Name, Art, Ort, Nr., ID und "schon in MC". */
export function lexTreffer(kontakte, kunden) {
  return (kontakte ?? []).map(c => {
    const soll = kundeAusKontakt(c);
    const k = kundeZuKontakt(kunden, soll);
    return {
      lexofficeId: soll.Lexoffice_ID, lexofficeNr: soll.Lexoffice_Nr, art: soll.Art, name: soll.Name,
      ort: [soll.PLZ, soll.Ort].filter(Boolean).join(' '), archiviert: !!c?.archived,
      inMc: k ? k.Kunden_Nr : null, gesperrt: k?.Status === STATUS.GESPERRT,
    };
  });
}

/**
 * Uebernahme genau eines Kontakts (Regeln wie der Import): schon im Sheet -> { schon: kunde } (nichts schreiben;
 * auch beim Doppelklick), DSGVO-gesperrt -> 409, kein Kunde in Lexware -> 422, sonst { neu: Zeile }.
 */
export function uebernahmePlan({ kunden, kontakt, jetzt }) {
  if (!kontakt?.roles?.customer) throw fehler('Dieser Lexoffice-Kontakt ist kein Kunde.', 422, 'kein_kunde');
  const soll = kundeAusKontakt(kontakt);
  if (!soll.Lexoffice_ID) throw fehler('Lexoffice-Kontakt ohne ID.', 422);
  const k = kundeZuKontakt(kunden, soll);
  if (k?.Status === STATUS.GESPERRT) throw fehler(`${k.Kunden_Nr} ist gesperrt (DSGVO) und wird nicht wieder befüllt.`, 409, 'gesperrt');
  if (k) return { schon: k };
  return {
    neu: {
      ...Object.fromEntries(KUNDEN_SPALTEN.map(s => [s, ''])), ...soll, Kunden_Nr: naechsteKundenNr(kunden),
      Status: STATUS.AKTIV, Quelle: QUELLE.LEXOFFICE, Angelegt: t(jetzt), Stand: t(jetzt),
    },
  };
}

/** Nur Zahlen fuer die Dashboard-Kachel und Pruefungen (keine Namen). AM-2 haengt hier die Auftragszahlen an. */
export function kundenZahlen(kunden) {
  const n = f => (kunden ?? []).filter(f).length;
  return {
    gesamt: n(() => true), aktiv: n(k => k.Status === STATUS.AKTIV), archiviert: n(k => k.Status === STATUS.ARCHIVIERT),
    gesperrt: n(k => k.Status === STATUS.GESPERRT), firmen: n(k => k.Art === ART.FIRMA), vereine: n(k => k.Art === ART.VEREIN),
    personen: n(k => k.Art === ART.PERSON),
  };
}
