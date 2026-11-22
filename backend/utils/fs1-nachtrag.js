// FS1 (einmalig, Inhaber 22.11.2026): Fanshop-Bestueckung von FP-001 aus Partner_Interne_Bestellungen als Nachtrag in die
// Bestellseite BS-001 - reine Logik ohne Netz. Lesen/Schreiben in lib/fs1Nachtrag.js, Aufruf scripts/fs1-fanshop-nachtrag.js.
//
// Regeln (auftrag-FS1):
// - Quelle: Zeilen des Partners mit Status "offen" und Datum im Zeitraum; "abgerechnet" nur getrennt zeigen.
// - Spieltag aus dem Text (02.10.26, 02.10.2026, 16.10., 6.11.); ohne Spieltag = naechster bekannter Spieltag ab dem Zeilendatum (markiert).
// - Spieltage, zu denen BS-001 schon einen Termin hat (22.11., 27.11.), und Zeilen ohne Spieltag ab SCHON_AB werden NICHT eingetragen,
//   nur aus der Abrechnung genommen (Verweis "steht in BS-001").
// - Zuordnung Text -> Artikel nur, wenn Produkt UND Farbe (und ggf. Groesse) genau EINE Auswahl der Bestellseite ergeben; sonst freie
//   Position (Extra) mit bereinigtem Text und einem Vorschlag zur Ansicht. Nichts erfinden: ohne Farbwort keine Farbe.
// - Trikot 33 € + "Handling" 1,50 € gleicher Menge und gleichen Spieltags = EINE Position zu 34,50 €.
// - Porto-Zeilen = freie Position "Porto".
// - Personennamen nur in das Feld der Bestellseite (`Fuer`), nie in Freitext, Bericht, Log. Ausgabe nur "Name ja/nein".
// Preise bleiben in der Quellzeile; die Bestellseite traegt keine Preise (KS3). Die Pruefsumme rechnet in Cent.

const t = v => String(v ?? '').trim();
const ein = v => t(v).replace(/\s+/g, ' ');
const klein = v => ein(v).toLowerCase();
export const cent = v => Math.round(Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) * 100);

/** "TT.MM.JJJJ" -> "JJJJ-MM-TT" (sonst ''). */
export function isoAusDe(v) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t(v));
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
export const deAusIso = v => (/^\d{4}-\d{2}-\d{2}$/.test(t(v)) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : '');

const DATUM_RE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d])/g;

/** Spieltag aus dem Text: erstes Datum; Jahr fehlt = Jahr des Zeilendatums; zweistellig = 20xx. -> ISO oder ''. */
export function spieltagAusText(text, zeilenIso) {
  for (const m of t(text).matchAll(DATUM_RE)) {
    const tag = Number(m[1]), monat = Number(m[2]);
    if (tag < 1 || tag > 31 || monat < 1 || monat > 12) continue;
    const jahr = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : t(zeilenIso).slice(0, 4);
    if (!/^\d{4}$/.test(jahr)) continue;
    return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
  }
  return '';
}

// Woerter, die KEIN Personenname sind (klein, ohne Satzzeichen). Alles Grossgeschriebene, das hier fehlt, gilt als Name.
const WORTSCHATZ = new Set(`fanshop fanhsop fansjop fan shop cb445 cb331 pinke pink rosa schwarze schwarz grüne grün grune grun mützen mütze mützen
  dicke wintermütze wintermützen bommelmützen bommelmütze bommemütze bommemützen carboncap carbon cap caps rot rote matchday match day weiß weiss
  skyline puck pucks puckkind kind kinder plüschtier croco crocodiles neue neu modekke modelle modell traininsgjacke trainingsjacke erwschsene
  erwachsene trainisnghose trainingshose fluffy hoodie hose trikost trikots trikot und porto von jersey weihnachtskugeln weihnachtskugel einzeln 4er
  burgundy standard oktover oktober nov november sitzkissen logo winterjacke jacke bunt blau zipper handling ohne versand mit inkl schwarz-grün`
  .split(/\s+/).filter(Boolean));
const GROESSE_RE = /^(xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl)$/i;

/** Personennamen (Kandidaten) im Text: grossgeschriebene Woerter ausserhalb des Wortschatzes. Nur intern, nie ausgeben. */
export function namenIn(text) {
  const namen = [];
  for (const roh of t(text).split(/[\s,()+/]+/)) {
    const w = roh.replace(/[.:;!?-]+$/g, '').replace(/^[.:;!?-]+/g, '');
    if (!w || !/^[A-ZÄÖÜ][a-zäöüß]{2,}$/.test(w)) continue;
    if (WORTSCHATZ.has(w.toLowerCase())) continue;
    namen.push(w);
  }
  return namen;
}

/** Freitext fuer die freie Position: ohne Fanshop-Vermerk, Datum, Namen, Klammern mit Monatsangaben; <= 200. */
export function bereinigterText(text, namen = []) {
  let s = ein(text)
    .replace(/\(\s*(okto?ver|oktober|nov|november)[^)]*\)/gi, ' ')
    .replace(DATUM_RE, ' ')
    .replace(/\bfan\s*shop\b|\bfanhsop\b|\bfansjop\b|\bfanshop\b/gi, ' ')
    .replace(/\bshop\b/gi, ' ');
  for (const n of namen) s = s.replace(new RegExp(`\\b${n}\\b`, 'g'), ' ');
  s = s.replace(/\bund\b(?=\s*(?:$|fanshop|,))/gi, ' ').replace(/\s*[-,.]\s*$/g, '').replace(/\(\s*\)/g, ' ');
  s = ein(s).replace(/^[-,.\s]+|[-,.\s]+$/g, '').replace(/\s+([,.)])/g, '$1');
  return s.slice(0, 200);
}

// ── Zuordnung Text -> Artikel der Bestellseite ───────────────────────────────

/** Produkt-Erkennung: Wort im Text -> Pruefung an der Karte (Name bzw. L-Shop-Modell). Nur eindeutige Wortbilder. */
const PRODUKTE = [
  { re: /carbon\s*cap/, karte: a => /Cap - Carbon Look/.test(a.name), text: 'Carbon-Cap' },
  { re: /match\s*day\s*cap/, karte: a => /^Match Day Cap/.test(a.name), text: 'Match Day Cap' },
  { re: /bomm?e?l?m(ü|ue)tzen?/, karte: a => /Bommelmütze/.test(a.name), text: 'Bommelmütze', schreibweise: /bommem/ },
  { re: /dicke\s+wintermütze/, karte: a => /^dicke Crocodiles Wintermütze/.test(a.name), text: 'dicke Wintermütze' },
];
const MODELL_RE = /\b(cb\d{3,4}r?|by\d{3,4})\b/;

// Farbwoerter: sicher = feste Uebersetzung; aehnlich = nur Vorschlag (fuehrt zu freier Position).
// Wortgrenzen mit Umlauten/ß ( kennt nur ASCII).
const W = (muster) => new RegExp(`(?<![a-zäöüß])(?:${muster})(?![a-zäöüß])`);
const FARBE_SICHER = [
  { re: W('schwarze?n?'), en: 'black' }, { re: W('grüne?n?|grun'), en: 'green' }, { re: W('rote?n?'), en: 'red' },
  { re: W('wei(?:ß|ss)e?n?'), en: 'white' }, { re: W('blaue?n?'), en: 'blue' },
];
const FARBE_AEHNLICH = [
  { re: W('pinke?n?|rosa'), en: ['fuchsia', 'pink', 'strawberry', 'blush'] },
  { re: W('burgundy'), en: ['burgundy', 'wine', 'maroon'] },
];
const teile = farbe => klein(farbe).split('/').map(x => x.trim());
const enthaelt = (farbe, en) => teile(farbe).some(x => x.split(/\s+/).includes(en) || x === en);

/**
 * Zuordnung einer Quellzeile zu genau einer Auswahl der Bestellseite.
 * @param {string} text
 * @param {object[]} artikel  Katalog (key, name, farbe, groessen [{groesse, id, articleNr}])
 * @param {Map<string,string>} catalogJe  ArticleNr -> CatalogNr (LShop_Modelle)
 * @returns {{ sicher: boolean, auswahl?: {id, articleNr, groesse, bezeichnung}, vorschlag?: string, grund: string }}
 */
export function zuordnen(text, artikel, catalogJe = new Map()) {
  const s = klein(text);
  let karten = null, produktText = '', hinweis = '';
  const modell = MODELL_RE.exec(s)?.[1]?.toUpperCase();
  if (modell) {
    karten = artikel.filter(a => (a.groessen ?? []).some(g => catalogJe.get(t(g.articleNr)) === modell));
    produktText = modell;
    if (!karten.length) return { sicher: false, grund: `Modell ${modell} steht nicht auf BS-001` };
  } else {
    const p = PRODUKTE.find(x => x.re.test(s));
    if (!p) return { sicher: false, grund: 'kein Artikel der Bestellseite erkannt' };
    karten = artikel.filter(p.karte);
    produktText = p.text;
    if (p.schreibweise?.test(s)) hinweis = 'Schreibweise im Text abweichend';
    if (!karten.length) return { sicher: false, grund: `${p.text} steht nicht auf BS-001` };
  }
  const sicher = FARBE_SICHER.filter(f => f.re.test(s)).map(f => f.en);
  const aehnlich = FARBE_AEHNLICH.filter(f => f.re.test(s));
  if (aehnlich.length) {
    const vor = karten.filter(a => aehnlich.some(f => f.en.some(en => enthaelt(a.farbe, en))));
    const g1 = vor.length === 1 ? (vor[0].groessen ?? []).filter(g => t(g.id)) : [];
    const einzeln = g1.length === 1 && !t(g1[0].groesse)   // nur Einheitsgroesse: vom Inhaber bestaetigbar
      ? { id: t(g1[0].id), articleNr: t(g1[0].articleNr), groesse: '', bezeichnung: [vor[0].name, vor[0].farbe, vor[0].design].filter(Boolean).join(' · ') } : null;
    return { sicher: false, grund: 'Farbe nur ähnlich', vorschlag: vor.length === 1 ? `${vor[0].name} · ${vor[0].farbe}` : '', vorschlagAuswahl: einzeln };
  }
  if (!sicher.length) {
    return { sicher: false, grund: 'keine Farbe im Text', vorschlag: karten.length === 1 ? `${karten[0].name} · ${karten[0].farbe}` : `${produktText}: ${karten.length} Farben` };
  }
  const passt = karten.filter(a => sicher.every(en => enthaelt(a.farbe, en)));
  if (passt.length !== 1) return { sicher: false, grund: passt.length ? 'mehrere Farben passen' : 'Farbe nicht auf BS-001' };
  const karte = passt[0];
  const gr = (karte.groessen ?? []).filter(g => t(g.id));
  let g = null;
  if (gr.length === 1 && !t(gr[0].groesse)) g = gr[0];
  else {
    const genannt = t(text).split(/[\s,()/]+/).filter(w => GROESSE_RE.test(w)).map(w => w.toUpperCase().replace(/^XXL$/, '2XL'));
    if (genannt.length !== 1) return { sicher: false, grund: genannt.length ? 'mehrere Größen im Text' : 'keine Größe im Text', vorschlag: `${karte.name} · ${karte.farbe}` };
    g = gr.find(x => t(x.groesse).toUpperCase() === genannt[0]) ?? null;
    if (!g) return { sicher: false, grund: 'Größe nicht wählbar', vorschlag: `${karte.name} · ${karte.farbe}` };
  }
  return {
    sicher: true, grund: hinweis,
    auswahl: { id: t(g.id), articleNr: t(g.articleNr), groesse: t(g.groesse), bezeichnung: [karte.name, karte.farbe, karte.design].filter(Boolean).join(' · ') },
  };
}

// ── Plan ─────────────────────────────────────────────────────────────────────

const TRIKOT_RE = /trikos?t/i;   // auch Tippfehler "Trikost"
const HANDLING_RE = /handling/i;
const PORTO_RE = /^\s*porto\b/i;

/**
 * Plan je Quellzeile.
 * @param {object} o
 * @param {object[]} o.zeilen  Quellzeilen { zeile, partnerId, datum (TT.MM.JJJJ), text, menge, einzelpreis (Text), summe (Text), status }
 * @param {string} o.partnerId, o.von, o.bis (ISO, inklusive)
 * @param {string[]} o.terminDaten  ISO-Daten der vorhandenen Termine des Zugangs (= "schon in BS-001")
 * @param {string} o.schonAb  ISO: Zeilen ohne Spieltag ab diesem Datum zaehlen zu "schon in BS-001" (unsicher)
 * @param {object[]} o.artikel, o.catalogJe
 * @returns {{ eintragen: object[], schon: object[], abgerechnet: object[], spieltage: string[] }}
 */
export function nachtragPlan({ zeilen, partnerId, von, bis, terminDaten = [], schonAb, artikel, catalogJe, bestaetigt = new Set(), ohneName = new Set() }) {
  const alle = (zeilen ?? []).filter(z => t(z.partnerId) === partnerId).map(z => ({ ...z, iso: isoAusDe(z.datum) }));
  const abgerechnet = alle.filter(z => t(z.status) === 'abgerechnet').map(z => ({ zeile: z.zeile, datum: z.iso, menge: Number(z.menge) || 0 }));
  const quelle = alle.filter(z => t(z.status) === 'offen' && z.iso && z.iso >= von && z.iso <= bis);
  for (const z of quelle) z.spieltagText = spieltagAusText(z.text, z.iso);
  const spieltage = [...new Set([...quelle.map(z => z.spieltagText).filter(Boolean), ...terminDaten])].sort();
  const schonDaten = new Set(terminDaten);

  const items = quelle.map(z => {
    let spieltag = z.spieltagText, abgeleitet = false;
    if (!spieltag) { spieltag = spieltage.find(d => d >= z.iso) ?? ''; abgeleitet = true; }
    const namen = namenIn(z.text);
    return { zeile: z.zeile, datum: z.iso, spieltagText: z.spieltagText, text: z.text, menge: Number(String(z.menge).replace(',', '.')) || 0,
      preisCent: cent(z.einzelpreis), summeCent: cent(z.summe), spieltag, abgeleitet, namen, hinweise: [] };
  });

  // Trikot + Handling zusammenfassen (gleicher Spieltag, gleiche Menge, Trikot 33 €, Handling 1,50 €).
  for (const h of items.filter(x => TRIKOT_RE.test(x.text) && HANDLING_RE.test(x.text) && x.preisCent === 150)) {
    const basis = items.filter(x => x !== h && !x.zusammen && TRIKOT_RE.test(x.text) && !HANDLING_RE.test(x.text)
      && x.spieltag === h.spieltag && x.menge === h.menge && x.preisCent === 3300);
    if (basis.length !== 1) { h.hinweise.push('Handling ohne eindeutige Trikot-Zeile'); continue; }
    const b = basis[0];
    b.preisCent += h.preisCent; b.mitHandling = h.zeile;
    b.hinweise.push(`zusammengefasst mit Zeile ${h.zeile} (Handling)`);
    h.zusammen = b.zeile;
    h.hinweise.push(`in Zeile ${b.zeile} zusammengefasst`);
  }

  const eintragen = [], schon = [];
  for (const x of items) {
    const ohneTag = !x.spieltagText && x.abgeleitet;
    if (x.abgeleitet) x.hinweise.push(x.spieltag ? 'Spieltag abgeleitet (nächster ab Zeilendatum)' : 'kein Spieltag ableitbar');
    const istSchon = schonDaten.has(x.spieltag) || (ohneTag && x.datum >= schonAb);
    if (istSchon) {
      if (ohneTag) x.hinweise.push('ohne Spieltag, Datum ab Schwelle – unsicher');
      schon.push(x);
      continue;
    }
    if (x.zusammen) { eintragen.push({ ...x, art: 'zusammengefasst' }); continue; }
    // Porto: das Wort dahinter kann Person oder Firma sein -> nie in "für wen" (Inhaber 22.11.).
    if (PORTO_RE.test(x.text)) { eintragen.push({ ...x, namen: [], nameUnklar: x.namen.length > 0, art: 'extra', freitext: 'Porto', zuordnung: { sicher: false, grund: 'Porto' } }); continue; }
    if (TRIKOT_RE.test(x.text)) {
      // Nie als Trikot-Eintrag (KS3 wuerde ueber TR6 neue Trikot-Zeilen anlegen); Groessen stehen nicht in der Zeile.
      eintragen.push({ ...x, art: 'extra', freitext: x.mitHandling ? 'Trikots (inkl. Handling)' : 'Trikots', zuordnung: { sicher: false, grund: 'Trikots als freie Position' } });
      continue;
    }
    if (ohneName.has(x.zeile)) { x.nameUnklar = x.namen.length > 0; x.namen = []; }
    const zu = zuordnen(x.text, artikel, catalogJe);
    if (!zu.sicher && zu.vorschlagAuswahl && bestaetigt.has(x.zeile)) {   // Vorschlag vom Inhaber bestaetigt
      eintragen.push({ ...x, art: 'artikel', zuordnung: { sicher: true, grund: 'Vorschlag vom Inhaber bestätigt', auswahl: zu.vorschlagAuswahl } });
      continue;
    }
    if (zu.sicher) eintragen.push({ ...x, art: 'artikel', zuordnung: zu });
    else eintragen.push({ ...x, art: 'extra', freitext: bereinigterText(x.text, x.namen), zuordnung: zu });
  }
  return { eintragen, schon, abgerechnet, spieltage: [...new Set(eintragen.map(x => x.spieltag))].filter(Boolean).sort() };
}

/** Pruefsumme je Spieltag in Cent: Summe der Quellzeilen (inkl. Handling) gegen Menge x Einzelpreis der neuen Eintraege. */
export function pruefsummen(eintragen) {
  const je = new Map();
  for (const x of eintragen) {
    const e = je.get(x.spieltag) ?? { alt: 0, neu: 0 };
    e.alt += x.summeCent;
    if (x.art !== 'zusammengefasst') e.neu += Math.round(x.menge * x.preisCent);
    je.set(x.spieltag, e);
  }
  return je;
}

/**
 * Neue Zeilen fuer Bestell_Termine und Bestell_Eintraege (Objekte nach Spaltenname), Aufbau wie die Bestellseite (KS2).
 * Vorgang = FS1-<Zeile> (erneuter Lauf erkennt schon geschriebene Eintraege).
 */
export function schreibPlan({ eintragen, zugang, termine, eintraege, idx, bestellschlussFuer, kuerzel, terminNotiz, jetzt }) {
  const iso = new Date(jetzt).toISOString();
  const heute = iso.slice(0, 10);
  const max = (liste, feld, re) => (liste ?? []).reduce((m, x) => { const r = re.exec(t(x[feld])); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  let tNr = max(termine, 'Termin_ID', /^BT-(\d+)$/), eNr = max(eintraege, 'Eintrag_ID', /^BE-(\d+)$/);
  const schonVorgang = new Set((eintraege ?? []).map(e => t(e.Vorgang)).filter(Boolean));
  const terminJe = new Map((termine ?? []).filter(x => x.Zugang_ID === zugang.Zugang_ID).map(x => [t(x.Datum), x]));
  const termineNeu = [], eintraegeNeu = [], uebersprungen = [], zuordnung = [];
  for (const x of eintragen.filter(y => y.art !== 'zusammengefasst')) {
    const vorgang = `FS1-${x.zeile}`;
    if (!x.spieltag) throw new Error(`Zeile ${x.zeile}: ohne Spieltag – nicht schreibbar.`);
    let termin = terminJe.get(x.spieltag);
    if (!termin) {
      termin = { Termin_ID: `BT-${String(++tNr).padStart(4, '0')}`, Zugang_ID: zugang.Zugang_ID, Datum: x.spieltag,
        Notiz: `${terminNotiz} ${deAusIso(x.spieltag)}`, Bestellschluss: bestellschlussFuer(x.spieltag), Auftrag_Nr: '', Status: 'offen',
        Angelegt: heute, Stand: iso };
      termineNeu.push(termin);
      terminJe.set(x.spieltag, termin);
    }
    if (schonVorgang.has(vorgang)) { uebersprungen.push(x.zeile); continue; }
    const basis = {
      Eintrag_ID: `BE-${String(++eNr).padStart(5, '0')}`, Zugang_ID: zugang.Zugang_ID, Termin_ID: termin.Termin_ID, Gegner_Notiz: '',
      Kuerzel: kuerzel, Art: '', WC_Variation_ID: '', LShop_ArticleNr: '', Freitext: '', Menge: x.menge, Fuer: '', Trikot_Name: '', Trikot_Nummer: '',
      Wunsch: '', Zeit: iso, Nach_Schluss: '', Status: 'eingegangen', Auftrag_Nr: '', Position_ID: '', Stand: iso, Groesse: '', Bezeichnung: '',
      Trikot_Produkt: '', Vorgang: vorgang, Geaendert_Von: '', Notiz: '',
    };
    const fuer = x.namen.join(', ').slice(0, 40);
    if (x.art === 'artikel') {
      const w = idx.je.get(x.zuordnung.auswahl.id);
      if (!w) throw new Error(`Zeile ${x.zeile}: Auswahl nicht mehr auf der Bestellseite.`);
      Object.assign(basis, { Art: 'artikel', WC_Variation_ID: w.wcId, LShop_ArticleNr: w.articleNr, Groesse: w.groesse, Bezeichnung: w.bezeichnung, Fuer: fuer });
    } else {
      Object.assign(basis, { Art: 'extra', Freitext: x.freitext || 'Position aus interner Bestellung', Bezeichnung: 'Extra', Fuer: fuer });
    }
    eintraegeNeu.push(basis);
    zuordnung.push({ zeile: x.zeile, mitHandling: x.mitHandling ?? null, terminId: termin.Termin_ID, eintragId: basis.Eintrag_ID });
  }
  return { termineNeu, eintraegeNeu, uebersprungen, zuordnung };
}

// ── Schritt 2 (--preise): Einzelpreis an die Auftragsposition, NACH "Prüfen/Übernehmen" in MC ───────────────────────────────
const BE_RE = /^BS-\d+ · BT-\d+ · (BE-\d+)/;

/**
 * Preise je Auftragsposition aus den markierten Quellzeilen (Verweis BE-…). Brutto je Stueck = Summe der Einzelpreise der Quellzeilen
 * desselben Eintrags (Trikot + Handling). Nur Positionen OHNE Preis_Netto; Netto 4 Stellen (AMQ1), am Auftrag Preis_Eingabe "brutto".
 * @param {object} o  quelle [{zeile, status, verweis, einzelpreis}], eintraege, positionen, auftraege (Objekte nach Spaltenname),
 *                    nettoAusBrutto (utils/auftrag-preise.js)
 */
export function preisPlan({ quelle, statusWert, eintraege, positionen, auftraege, nettoAusBrutto }) {
  const jeEintrag = new Map();
  for (const q of quelle ?? []) {
    if (t(q.status) !== statusWert) continue;
    const m = BE_RE.exec(t(q.verweis));
    if (!m) continue;
    jeEintrag.set(m[1], (jeEintrag.get(m[1]) ?? 0) + cent(q.einzelpreis));
  }
  const eJe = new Map((eintraege ?? []).map(e => [t(e.Eintrag_ID), e]));
  const jePosition = new Map(), offen = [], hinweise = [];
  for (const [be, bruttoCent] of jeEintrag) {
    const e = eJe.get(be);
    if (!e || t(e.Status) !== 'übernommen' || !t(e.Position_ID)) { offen.push(be); continue; }
    const pid = t(e.Position_ID);
    const vor = jePosition.get(pid);
    if (vor && vor.bruttoCent !== bruttoCent) { vor.konflikt = true; continue; }
    jePosition.set(pid, { pid, bruttoCent, auftragNr: t(e.Auftrag_Nr), eintraege: [...(vor?.eintraege ?? []), be] });
  }
  const pJe = new Map((positionen ?? []).map(p => [t(p.Position_ID), p]));
  const setzen = [], schon = [];
  for (const x of jePosition.values()) {
    if (x.konflikt) { hinweise.push(`${x.pid}: zusammengelegte Einträge mit verschiedenen Preisen – nicht gesetzt`); continue; }
    const p = pJe.get(x.pid);
    if (!p || t(p.Entfernt)) { hinweise.push(`${x.pid}: Position fehlt oder entfernt`); continue; }
    if (t(p.Preis_Netto) !== '') { schon.push(x.pid); continue; }
    setzen.push({ positionId: x.pid, auftragNr: t(p.Auftrag_Nr), zeile: p._zeile, netto: nettoAusBrutto(x.bruttoCent / 100, t(p.USt_Satz) || undefined) });
  }
  const auftragNrn = [...new Set(setzen.map(s => s.auftragNr))];
  const auftraegeBrutto = auftragNrn.map(nr => (auftraege ?? []).find(a => t(a.Auftrag_Nr) === nr)).filter(Boolean)
    .map(a => ({ auftragNr: t(a.Auftrag_Nr), zeile: a._zeile, setzeEingabe: t(a.Preis_Eingabe) !== 'brutto' }));
  return { setzen, schon, offen, hinweise, auftraege: auftraegeBrutto };
}
