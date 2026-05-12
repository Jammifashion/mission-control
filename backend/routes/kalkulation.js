import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

// Parst DD.MM.YYYY oder ISO-String → Date (UTC mitternacht)
function parseDate(str) {
  if (!str) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [d, m, y] = str.split('.');
    return new Date(`${y}-${m}-${d}T00:00:00Z`);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// Aus einer Reihe von Zeilen den Eintrag auswählen, dessen Gültig-Ab <= bestelldatum ist
// und unter allen gültigen den neuesten nimmt.
function findGueltig(rows, headerRow, bestellDatum, keyFn) {
  const gueltigIdx = headerRow.indexOf('Gültig-Ab');
  if (gueltigIdx === -1) return rows; // kein Gültig-Ab → alle zurückgeben

  return rows
    .map(row => ({ row, gueltigAb: parseDate(row[gueltigIdx] ?? '') }))
    .filter(({ gueltigAb }) => gueltigAb !== null && gueltigAb <= bestellDatum)
    .reduce((best, cur) => {
      // Gruppiere nach Key-Funktion (z.B. Druckposition+Größe)
      const key = keyFn(cur.row);
      if (!best[key] || cur.gueltigAb > best[key].gueltigAb) best[key] = cur;
      return best;
    }, {});
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

// POST /api/kalkulation/berechnen
router.post('/berechnen', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const {
      lshopNr,
      druckpositionen = [],  // [{ position, groesse }]
      menge           = 1,
      bestelldatum,
    } = req.body;

    if (!lshopNr) return res.status(400).json({ error: 'lshopNr ist erforderlich.' });

    const bestellDatum = bestelldatum ? new Date(bestelldatum) : new Date();
    const sheets       = await getSheets();

    // ── Alle Tabs parallel laden ──────────────────────────────────────────────
    const [artikel, druckpreise, fixkosten, verkaufspreise] = await Promise.all([
      readTab(sheets, sheetId, 'Kalkulation_Artikel'),
      readTab(sheets, sheetId, 'Kalkulation_Druckpreise'),
      readTab(sheets, sheetId, 'Kalkulation_Fixkosten'),
      readTab(sheets, sheetId, 'Kalkulation_Verkaufspreise'),
    ]);

    // ── EK-Preis für Artikel ──────────────────────────────────────────────────
    const artLshopIdx    = artikel.header.indexOf('L-Shop-Nr');
    const artEkIdx       = artikel.header.indexOf('EK-Preis-Netto');
    const artKatIdx      = artikel.header.indexOf('Kategorie');
    const artNameIdx     = artikel.header.indexOf('Artikelname');

    const gueltigeArtikel = findGueltig(
      artikel.rows, artikel.header, bestellDatum,
      r => r[artLshopIdx] ?? ''
    );
    const artikelEintrag = gueltigeArtikel[lshopNr];
    if (!artikelEintrag) {
      return res.status(404).json({ error: `Kein gültiger EK-Preis für L-Shop-Nr "${lshopNr}" zum ${bestellDatum.toISOString().slice(0, 10)}.` });
    }
    const ekPreis    = parseFloat(artikelEintrag.row[artEkIdx] ?? '0');
    const kategorie  = artikelEintrag.row[artKatIdx] ?? '';
    const artikelname = artikelEintrag.row[artNameIdx] ?? '';

    // ── Druckpreise ───────────────────────────────────────────────────────────
    const druckPosIdx    = druckpreise.header.indexOf('Druckposition');
    const druckGroesseIdx = druckpreise.header.indexOf('Größe');
    const druckPreisIdx  = druckpreise.header.indexOf('Preis-Netto');

    const druckGesamt = druckpositionen.reduce((sum, { position, groesse }) => {
      const key = `${position}|${groesse}`;
      const gueltig = findGueltig(
        druckpreise.rows, druckpreise.header, bestellDatum,
        r => `${r[druckPosIdx] ?? ''}|${r[druckGroesseIdx] ?? ''}`
      );
      const eintrag = gueltig[key];
      return sum + (eintrag ? parseFloat(eintrag.row[druckPreisIdx] ?? '0') : 0);
    }, 0);

    // ── Fixkosten ─────────────────────────────────────────────────────────────
    const fixPosIdx    = fixkosten.header.indexOf('Position');
    const fixBetragIdx = fixkosten.header.indexOf('Betrag');
    const fixEinheitIdx = fixkosten.header.indexOf('Einheit');

    const gueltigeFixkosten = findGueltig(
      fixkosten.rows, fixkosten.header, bestellDatum,
      r => r[fixPosIdx] ?? ''
    );

    let fixkostenGesamt = 0;
    const fixkostenDetail = [];
    for (const { row: r } of Object.values(gueltigeFixkosten)) {
      const betrag  = parseFloat(r[fixBetragIdx]  ?? '0');
      const einheit = r[fixEinheitIdx] ?? '';
      fixkostenDetail.push({ position: r[fixPosIdx], betrag, einheit });
      if (einheit !== '%/VK') fixkostenGesamt += betrag;
    }

    // ── VK-Preis lookup (nächst höhere Mengenstaffel) ─────────────────────────
    const vkTypIdx    = verkaufspreise.header.indexOf('Produkttyp');
    const vkMengeIdx  = verkaufspreise.header.indexOf('Ab-Menge');
    const vkPreisIdx  = verkaufspreise.header.indexOf('VK-Brutto');

    const gueltigeVk = findGueltig(
      verkaufspreise.rows, verkaufspreise.header, bestellDatum,
      r => `${r[vkTypIdx] ?? ''}|${r[vkMengeIdx] ?? ''}`
    );

    // Alle gültigen VK-Einträge für die Kategorie, passende Mengenstaffel
    const vkEintraege = Object.values(gueltigeVk)
      .map(({ row: r }) => ({
        typ:      r[vkTypIdx]   ?? '',
        abMenge:  parseInt(r[vkMengeIdx]  ?? '1', 10),
        vkBrutto: parseFloat(r[vkPreisIdx] ?? '0'),
      }))
      .filter(e => parseInt(menge, 10) >= e.abMenge)
      .sort((a, b) => b.abMenge - a.abMenge); // neueste Staffel zuerst

    const vkPreis = vkEintraege[0]?.vkBrutto ?? null;

    // ── PayPal-Anteil (%-basiert) ─────────────────────────────────────────────
    const paypalEintrag = fixkostenDetail.find(f => f.einheit === '%/VK');
    const paypalAnteil  = vkPreis && paypalEintrag
      ? parseFloat(((vkPreis * paypalEintrag.betrag) / 100).toFixed(2))
      : 0;

    // ── Zusammenfassung ───────────────────────────────────────────────────────
    const gesamtkostenNetto = parseFloat((ekPreis + druckGesamt + fixkostenGesamt + paypalAnteil).toFixed(2));
    const deckungsbeitrag   = vkPreis !== null
      ? parseFloat(((vkPreis / 1.19) - gesamtkostenNetto).toFixed(2))
      : null;

    res.json({
      bestelldatum:        bestellDatum.toISOString().slice(0, 10),
      lshopNr,
      artikelname,
      kategorie,
      menge:               parseInt(menge, 10),
      ekPreis,
      druckGesamt:         parseFloat(druckGesamt.toFixed(2)),
      fixkostenGesamt:     parseFloat(fixkostenGesamt.toFixed(2)),
      paypalAnteil,
      gesamtkostenNetto,
      vkPreisBrutto:       vkPreis,
      vkPreisNetto:        vkPreis !== null ? parseFloat((vkPreis / 1.19).toFixed(2)) : null,
      deckungsbeitrag,
      details: {
        druckpositionen:   druckpositionen,
        fixkosten:         fixkostenDetail,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
