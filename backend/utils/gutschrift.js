// GS1 (Inhaber 22.11.2026): Rechnungsgutschrift an einen Festpreis-Partner aus einer abgeschlossenen FP-Abrechnung als
// Lexware-ENTWURF - reine Logik ohne Netz. Lesen/Schreiben in lib/gutschrift.js, der eine Lexware-Aufruf in lib/lexwareGutschrift.js.
//
// Hintergrund: Der Partner (Verein) stellt keine Rechnung; JammiFashion erstellt nach jeder Abrechnung eine Gutschrift nach
// § 14 Abs. 2 UStG (Lexware: Rechnungskorrektur, eigener Nummernkreis GS…, die Nummer vergibt Lexware beim Abschliessen).
// Kopf wie die bisherigen Gutschriften: Titel "Rechnungsgutschrift", Einleitung mit dem Zeitraum der Abrechnung.
//
// Regeln:
// - Nur Abrechnungen mit Status freigegeben oder bezahlt (nie Entwurf), mit gespeicherten Positionen (JSON), ohne Kennzeichen.
// - Summe der Gutschrift (brutto) = Gesamt-Brutto der Abrechnung AUF DEN CENT; sonst nicht senden (Problem).
// - Brutto-Beleg (taxType gross), je Zeile Menge 1 und Bruttobetrag in Cent - so rechnet Lexware genau dieselbe Summe.
//   Zeilen: je Artikelgruppe die Auszahlung (netto x MwSt), Porto-Saldo (PO1), interne Bestellungen und Verpackungspauschale
//   als Abzug. Rundungsrest der Netto->Brutto-Umrechnung (wenige Cent) geht auf die groesste Zeile (`ausgleich`).
// - Nur Entwurf; abschliessen/versenden macht der Inhaber in Lexware. Log/Chat nur Abrechnungs-ID und Partner-ID.

export const GUTSCHRIFT_SPALTEN = ['Gutschrift_Lexware_ID', 'Gutschrift_Am', 'Gutschrift_Status'];
export const SPALTE_POSITIONEN = 'Positionen';   // Spalte I der Abrechnung (stand ohne Kopf, Setup traegt ihn nach)
export const SPALTE_KUNDE = 'Kunden_Nr';         // hinten in FP_Partner (auch fuer PD3)
export const GS_STATUS = { ENTWURF: 'entwurf', UNKLAR: 'unklar' };
export const ABRECHNUNG_FERTIG = ['freigegeben', 'bezahlt'];
export const BELEGARTEN = ['creditnote'];        // Einstellung Business-Config `gutschrift.belegart` (leer = creditnote)
export const CONFIG_BELEGART = 'gutschrift.belegart';
export const TITEL = 'Rechnungsgutschrift';
export const EINLEITUNG = 'Folgende Lieferungen/Leistungen schreiben wir Ihnen gut.';
export const EINHEIT = 'Posten';
export const MAX_POSITIONEN = 300;
export const LINK_BASIS = 'https://app.lexware.de/permalink/credit-notes/edit/';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const t = v => String(v ?? '').trim();
const fehler = (text, status, code) => Object.assign(new Error(text), { status, code });

/** Datum der Abrechnung (TT.MM.JJJJ, Sheets-Seriennummer oder JJJJ-MM-TT) -> TT.MM.JJJJ, sonst ''. */
export function deDatum(v) {
  const s = t(v);
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  }
  return '';
}

/** Euro-Zahl (auch "1.234,50") -> Cent, sonst null. */
export function inCent(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = t(v);
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const hatKennzeichen = a => t(a?.Gutschrift_Status) !== '' || t(a?.Gutschrift_Lexware_ID) !== '';

/** Abrechnungszeile -> Objekt (Spalten A-I positionsfest wie POST /abrechnungen, Kennzeichen ueber den Kopf). */
export function abrechnungAus(kopf, zeile) {
  const k = (kopf ?? []).map(t);
  const bei = name => { const i = k.indexOf(name); return i === -1 ? '' : zeile?.[i]; };
  return {
    id: t(zeile?.[0]), partnerId: t(zeile?.[1]), von: deDatum(zeile?.[2]), bis: deDatum(zeile?.[3]),
    netto: zeile?.[4], brutto: zeile?.[5], status: t(zeile?.[6]) || 'entwurf', erstellt: deDatum(zeile?.[7]) || t(zeile?.[7]),
    positionen: t(zeile?.[8]),
    Gutschrift_Lexware_ID: t(bei('Gutschrift_Lexware_ID')), Gutschrift_Am: t(bei('Gutschrift_Am')), Gutschrift_Status: t(bei('Gutschrift_Status')),
  };
}

/** Gruende, warum fuer diese Abrechnung (noch) keine Gutschrift angelegt werden kann ('' = moeglich, Inhalt egal). */
export function abrechnungGrund(a) {
  if (hatKennzeichen(a)) return 'Gutschrift schon angelegt';
  if (!ABRECHNUNG_FERTIG.includes(a.status)) return 'Abrechnung ist noch ein Entwurf – erst freigeben';
  if (!a.positionen) return 'Abrechnung ohne gespeicherte Aufschlüsselung (alter Stand) – bitte von Hand';
  return '';
}

/**
 * Gutschrift-Plan aus einer Abrechnung.
 * @param {object} o
 * @param {object} o.abrechnung  abrechnungAus(...)
 * @param {number} o.mwstProzent MwSt aus Kalkulation_Fixkosten
 * @param {string} o.kontaktId   Lexoffice_ID des verknuepften MC-Kunden
 * @param {string} o.voucherDate Belegdatum im Lexware-Format (lexwareDatum)
 * @returns {{ payload, zeilen: [{ art, name, cent }], summen: { brutto, netto, mwst }, ausgleich, probleme: string[] }}
 */
export function gutschriftPlan({ abrechnung: a, mwstProzent, kontaktId, voucherDate }) {
  const probleme = [];
  const grund = abrechnungGrund(a);
  if (grund) probleme.push(grund);
  if (!ID_RE.test(t(kontaktId))) probleme.push('Partner ist nicht mit einem Lexoffice-Kunden verknüpft (Spalte Kunden_Nr in FP_Partner bzw. Lexoffice-ID des Kunden).');
  const m = Number(mwstProzent);
  if (!Number.isFinite(m) || m < 0 || m > 30) probleme.push('MwSt-Satz fehlt in Kalkulation_Fixkosten.');
  let pos = null;
  if (a.positionen) { try { pos = JSON.parse(a.positionen); } catch { probleme.push('Aufschlüsselung der Abrechnung nicht lesbar.'); } }
  const zeilen = [];
  let ausgleich = 0;
  const faktor = 1 + (Number.isFinite(m) ? m : 0) / 100;
  if (pos) {
    const gruppen = Array.isArray(pos.produkteGruppen) ? pos.produkteGruppen : [];
    const porto = pos.porto && pos.porto.status !== 'keine' ? Number(pos.porto.saldo) || 0 : 0;
    const auszahlung = Number(pos.summen?.auszahlung) || 0;
    const ziel = Math.round((auszahlung + porto) * faktor * 100);   // wie fpAbrechnungErstellen (auszahlungBrutto)
    for (const g of gruppen) {
      const cent = Math.round((Number(g.auszahlung) || 0) * faktor * 100);
      if (!cent) continue;
      const stueck = Number(g.stueckzahl) || 0;
      zeilen.push({ art: 'artikel', name: `${t(g.artikelname) || 'Artikel'}${stueck ? ` · ${stueck} Stück` : ''}`.slice(0, 255), cent });
    }
    if (porto) zeilen.push({ art: 'porto', name: 'Porto (Einnahmen abzüglich Kosten)', cent: Math.round(porto * faktor * 100) });
    // Rundungsrest Netto->Brutto: auf die betragsgroesste Zeile, damit die Summe genau die der Abrechnung ist.
    const rest = ziel - zeilen.reduce((s, z) => s + z.cent, 0);
    ausgleich = rest;
    if (rest && zeilen.length) zeilen.reduce((x, y) => (Math.abs(y.cent) > Math.abs(x.cent) ? y : x)).cent += rest;
    else if (rest) zeilen.push({ art: 'artikel', name: 'Shop-Verkäufe', cent: rest });
    for (const p of Array.isArray(pos.intern) ? pos.intern : []) {
      const cent = -inCent(p.summe ?? 0);
      if (!cent) continue;
      zeilen.push({ art: 'intern', name: `Interne Bestellung ${deDatum(p.datum) || t(p.datum)}: ${t(p.bezeichnung)}`.slice(0, 255), cent });
    }
    const v = pos.verpackung;
    if (v && v.status === 'ok' && Number(v.summe)) {
      zeilen.push({ art: 'verpackung', name: `Verpackungspauschale · ${Number(v.anzahl) || 0} Bestellungen`, cent: -inCent(v.summe) });
    }
  }
  const brutto = zeilen.reduce((s, z) => s + z.cent, 0);
  const soll = inCent(a.brutto);
  if (pos && soll === null) probleme.push('Gesamt-Brutto der Abrechnung fehlt.');
  else if (pos && brutto !== soll) probleme.push(`Summe der Positionen (${(brutto / 100).toFixed(2).replace('.', ',')} €) weicht von der Abrechnung (${(soll / 100).toFixed(2).replace('.', ',')} €) ab – MwSt-Satz geändert? Bitte von Hand.`);
  if (pos && soll !== null && soll <= 0) probleme.push('Auszahlung der Abrechnung ist nicht positiv – keine Gutschrift.');
  if (!a.von || !a.bis) probleme.push('Zeitraum der Abrechnung fehlt.');
  if (zeilen.length > MAX_POSITIONEN) probleme.push(`Mehr als ${MAX_POSITIONEN} Zeilen.`);
  const netto = Math.round((brutto * 100) / (100 + (Number.isFinite(m) ? m : 0)));
  const payload = {
    voucherDate,
    address: { contactId: t(kontaktId) },
    lineItems: zeilen.map(z => ({
      type: 'custom', name: z.name, quantity: 1, unitName: EINHEIT,
      unitPrice: { currency: 'EUR', grossAmount: z.cent / 100, taxRatePercentage: m },
      discountPercentage: 0,
    })),
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'gross' },
    title: TITEL,
    introduction: einleitung(a.von, a.bis),
  };
  return { payload, zeilen, summen: { brutto, netto, mwst: brutto - netto }, ausgleich, probleme: [...new Set(probleme)] };
}

export const einleitung = (von, bis) => `${EINLEITUNG} Für Shop Verkäufe zwischen ${von} und ${bis}`;

/** Belegart aus der Einstellung pruefen (leer = creditnote). */
export function belegartAus(wert) {
  const w = t(wert) || 'creditnote';
  if (!BELEGARTEN.includes(w)) throw fehler(`Belegart „${w}“ (Config ${CONFIG_BELEGART}) wird nicht unterstützt – erlaubt: ${BELEGARTEN.join(', ')}.`, 409, 'belegart');
  return w;
}

/** Zellen fuer das Kennzeichen. */
export const kennzeichenFelder = ({ id = '', status, am }) => ({ Gutschrift_Lexware_ID: id, Gutschrift_Status: status, Gutschrift_Am: am });
export const leerFelder = () => ({ Gutschrift_Lexware_ID: '', Gutschrift_Status: '', Gutschrift_Am: '' });

/** Kennzeichen von Hand: "angelegt" (unklar -> entwurf, ID Pflicht) oder "zuruecksetzen" (entwurf/unklar -> leer). */
export function kennzeichenPlan({ abrechnung, aktion, lexwareId = '' }) {
  const st = t(abrechnung?.Gutschrift_Status);
  if (![GS_STATUS.ENTWURF, GS_STATUS.UNKLAR].includes(st)) throw fehler(`${t(abrechnung?.id)}: kein Gutschrift-Kennzeichen von MC (Status „${st || 'leer'}“).`, 409, 'kennzeichen');
  if (aktion === 'zuruecksetzen') return { zuruecksetzen: true };
  if (aktion === 'angelegt') {
    const id = t(lexwareId) || t(abrechnung.Gutschrift_Lexware_ID);
    if (!ID_RE.test(id)) throw fehler('Bitte die Lexware-ID des Entwurfs angeben (aus „In Lexware nachsehen“).', 422, 'id');
    if (st !== GS_STATUS.UNKLAR) throw fehler('Nur ein unklares Kennzeichen kann als angelegt markiert werden.', 409, 'kennzeichen');
    return { id };
  }
  throw fehler('Aktion unbekannt.', 422);
}

/** Chat-Text bei Fehler/unklar: nur Abrechnungs- und Partner-ID. */
export const chatText = ({ ergebnis, abrechnungId, partnerId, grund }) =>
  `⚠️ Lexware-Gutschrift ${ergebnis === 'unklar' ? 'UNKLAR (bitte in Lexware nachsehen, nicht erneut senden)' : 'fehlgeschlagen'}: ${abrechnungId} (${partnerId})${grund ? ` – ${grund}` : ''}.`;
