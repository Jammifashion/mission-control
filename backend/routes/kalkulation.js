import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

// DD.MM.YYYY oder ISO → Date UTC
function parseDate(str) {
  if (!str) return null;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const [d, m, y] = str.split('.');
    return new Date(`${y}-${m}-${d}T00:00:00Z`);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function toDE(date) {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}

// Aus Zeilen den Eintrag wählen, dessen Gültig-Ab <= datum ist — bei mehreren den neuesten
function findGueltig(rows, header, datum, keyFn) {
  const idx = header.indexOf('Gültig-Ab');
  if (idx === -1) return rows;
  return rows
    .map(row => ({ row, gueltigAb: parseDate(row[idx] ?? '') }))
    .filter(({ gueltigAb }) => gueltigAb !== null && gueltigAb <= datum)
    .reduce((best, cur) => {
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

// Liefert Spaltenbuchstaben für Index (0=A, 25=Z, 26=AA …)
function colLetter(idx) {
  let s = ''; idx++;
  while (idx > 0) { idx--; s = String.fromCharCode(65 + (idx % 26)) + s; idx = Math.floor(idx / 26); }
  return s;
}

// Nächste AB-YYYY-NNNN ID generieren
function nextAbrechnungId(existingRows, idIdx) {
  const year = new Date().getUTCFullYear();
  const prefix = `AB-${year}-`;
  const max = existingRows
    .map(r => r[idIdx] ?? '')
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => !isNaN(n))
    .reduce((m, n) => Math.max(m, n), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ── POST /api/kalkulation/berechnen ─────────────────────────────────────────
router.post('/berechnen', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { lshopNr, druckpositionen = [], menge = 1, bestelldatum } = req.body;
    if (!lshopNr) return res.status(400).json({ error: 'lshopNr ist erforderlich.' });

    const datum  = bestelldatum ? new Date(bestelldatum) : new Date();
    const sheets = await getSheets();

    const [artikel, druckpreise, fixkosten, verkaufspreise] = await Promise.all([
      readTab(sheets, sheetId, 'Kalkulation_Artikel'),
      readTab(sheets, sheetId, 'Kalkulation_Druckpreise'),
      readTab(sheets, sheetId, 'Kalkulation_Fixkosten'),
      readTab(sheets, sheetId, 'Kalkulation_Verkaufspreise'),
    ]);

    // EK-Preis
    const artLshopIdx = artikel.header.indexOf('L-Shop-Nr');
    const artEkIdx    = artikel.header.indexOf('EK-Preis-Netto');
    const artKatIdx   = artikel.header.indexOf('Kategorie');
    const artNameIdx  = artikel.header.indexOf('Artikelname');

    const gArtikel = findGueltig(artikel.rows, artikel.header, datum, r => r[artLshopIdx] ?? '');
    const artEntry = gArtikel[lshopNr];
    if (!artEntry) return res.status(404).json({ error: `Kein gültiger EK-Preis für "${lshopNr}" zum ${datum.toISOString().slice(0,10)}.` });

    const ekPreis    = parseFloat(artEntry.row[artEkIdx] ?? '0');
    const kategorie  = artEntry.row[artKatIdx] ?? '';
    const artikelname = artEntry.row[artNameIdx] ?? '';

    // Druckpreise
    const dPosIdx  = druckpreise.header.indexOf('Druckposition');
    const dGroeIdx = druckpreise.header.indexOf('Größe');
    const dPreisIdx = druckpreise.header.indexOf('Preis-Netto');

    const druckGesamt = druckpositionen.reduce((sum, { position, groesse }) => {
      const gD = findGueltig(druckpreise.rows, druckpreise.header, datum,
        r => `${r[dPosIdx]??''}|${r[dGroeIdx]??''}`);
      const e = gD[`${position}|${groesse}`];
      return sum + (e ? parseFloat(e.row[dPreisIdx] ?? '0') : 0);
    }, 0);

    // Fixkosten
    const fPosIdx    = fixkosten.header.indexOf('Position');
    const fBetragIdx = fixkosten.header.indexOf('Betrag');
    const fEinheitIdx = fixkosten.header.indexOf('Einheit');

    const gFix = findGueltig(fixkosten.rows, fixkosten.header, datum, r => r[fPosIdx] ?? '');
    let fixGesamt = 0;
    const fixDetail = [];
    for (const { row: r } of Object.values(gFix)) {
      const betrag  = parseFloat(r[fBetragIdx] ?? '0');
      const einheit = r[fEinheitIdx] ?? '';
      fixDetail.push({ position: r[fPosIdx], betrag, einheit });
      if (einheit !== '%/VK') fixGesamt += betrag;
    }

    // VK-Preis (Mengenstaffel)
    const vkTypIdx   = verkaufspreise.header.indexOf('Produkttyp');
    const vkMengeIdx = verkaufspreise.header.indexOf('Ab-Menge');
    const vkPreisIdx = verkaufspreise.header.indexOf('VK-Brutto');

    const gVk = findGueltig(verkaufspreise.rows, verkaufspreise.header, datum,
      r => `${r[vkTypIdx]??''}|${r[vkMengeIdx]??''}`);

    const vkEintraege = Object.values(gVk)
      .map(({ row: r }) => ({
        typ: r[vkTypIdx] ?? '', abMenge: parseInt(r[vkMengeIdx] ?? '1', 10),
        vkBrutto: parseFloat(r[vkPreisIdx] ?? '0'),
      }))
      .filter(e => parseInt(menge, 10) >= e.abMenge)
      .sort((a, b) => b.abMenge - a.abMenge);

    const vkPreis = vkEintraege[0]?.vkBrutto ?? null;

    const paypalEntry  = fixDetail.find(f => f.einheit === '%/VK');
    const paypalAnteil = vkPreis && paypalEntry
      ? parseFloat(((vkPreis * paypalEntry.betrag) / 100).toFixed(2)) : 0;

    const gesamtkostenNetto = parseFloat((ekPreis + druckGesamt + fixGesamt + paypalAnteil).toFixed(2));
    const deckungsbeitrag   = vkPreis !== null
      ? parseFloat(((vkPreis / 1.19) - gesamtkostenNetto).toFixed(2)) : null;

    res.json({
      bestelldatum: datum.toISOString().slice(0, 10), lshopNr, artikelname, kategorie,
      menge: parseInt(menge, 10), ekPreis,
      druckGesamt:     parseFloat(druckGesamt.toFixed(2)),
      fixkostenGesamt: parseFloat(fixGesamt.toFixed(2)),
      paypalAnteil, gesamtkostenNetto,
      vkPreisBrutto: vkPreis,
      vkPreisNetto:  vkPreis !== null ? parseFloat((vkPreis / 1.19).toFixed(2)) : null,
      deckungsbeitrag,
      details: { druckpositionen, fixkosten: fixDetail },
    });
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/partner ─────────────────────────────────────────────
router.get('/partner', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner');
    const idIdx   = header.indexOf('Partner-ID');
    const nameIdx = header.indexOf('Name');
    const katIdx  = header.indexOf('Hauptkategorie');
    const aktivIdx = header.indexOf('Aktiv');
    const lizenzIdx = header.indexOf('Lizenz-%');
    const versandIdx = header.indexOf('Versand-Modell');
    const paypalIdx  = header.indexOf('PayPal-Modell');
    const notizIdx   = header.indexOf('Notiz');

    res.json(rows.map(r => ({
      id:            r[idIdx]    ?? '',
      name:          r[nameIdx]  ?? '',
      kategorie:     r[katIdx]   ?? '',
      aktiv:         (r[aktivIdx] ?? '').toLowerCase() === 'ja',
      lizenzProzent: parseFloat(r[lizenzIdx] ?? '0'),
      versandModell: r[versandIdx] ?? '',
      paypalModell:  r[paypalIdx]  ?? '',
      notiz:         r[notizIdx]   ?? '',
    })));
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/partner-verkauf ────────────────────────────────────
// Einen Verkauf für einen Partner erfassen
router.post('/partner-verkauf', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { partnerId, datum, orderId, artikelnummer, variante, stueckzahl, vkPreisBrutto } = req.body;
    if (!partnerId || !orderId || !artikelnummer || !vkPreisBrutto)
      return res.status(400).json({ error: 'partnerId, orderId, artikelnummer, vkPreisBrutto sind erforderlich.' });

    const sheets = await getSheets();

    // Partner-Lizenz laden
    const { header: pHeader, rows: pRows } = await readTab(sheets, sheetId, 'Partner');
    const pIdIdx     = pHeader.indexOf('Partner-ID');
    const pLizenzIdx = pHeader.indexOf('Lizenz-%');
    const partner    = pRows.find(r => r[pIdIdx] === partnerId);
    if (!partner) return res.status(404).json({ error: `Partner "${partnerId}" nicht gefunden.` });

    const lizenzProzent = parseFloat(partner[pLizenzIdx] ?? '0');
    const vkBrutto      = parseFloat(vkPreisBrutto);
    const lizenzgebühr  = parseFloat(((vkBrutto * lizenzProzent) / 100).toFixed(2));
    const datumStr      = datum ? toDE(new Date(datum)) : toDE(new Date());

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Partner_Verkäufe!A:I',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        partnerId, datumStr, orderId, artikelnummer,
        variante ?? '', stueckzahl ?? 1, vkBrutto, lizenzgebühr, 'offen',
      ]]},
    });

    res.status(201).json({ partnerId, orderId, lizenzgebühr, status: 'offen' });
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/partner/:id/verkäufe ────────────────────────────────
// Offene Verkäufe eines Partners abrufen
router.get('/partner/:id/verkaeufe', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { id } = req.params;
    const { status } = req.query; // optional: ?status=offen

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Verkäufe');

    const pIdx  = header.indexOf('Partner-ID');
    const stIdx = header.indexOf('Status');

    const filtered = rows
      .filter(r => r[pIdx] === id && (!status || r[stIdx] === status))
      .map(r => ({
        partnerId:    r[header.indexOf('Partner-ID')]      ?? '',
        datum:        r[header.indexOf('Datum')]           ?? '',
        orderId:      r[header.indexOf('Order-ID')]        ?? '',
        artikelnummer: r[header.indexOf('Artikelnummer')]  ?? '',
        variante:     r[header.indexOf('Variante')]        ?? '',
        stueckzahl:   parseInt(r[header.indexOf('Stückzahl')] ?? '1', 10),
        vkPreisBrutto: parseFloat(r[header.indexOf('VK-Preis-Brutto')] ?? '0'),
        lizenzgebühr:  parseFloat(r[header.indexOf('Lizenzgebühr')] ?? '0'),
        status:       r[header.indexOf('Status')] ?? '',
      }));

    const summe = filtered.reduce((s, v) => s + v.lizenzgebühr, 0);
    res.json({ partnerId: id, anzahl: filtered.length, lizenzSumme: parseFloat(summe.toFixed(2)), verkäufe: filtered });
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/abrechnung/erstellen ───────────────────────────────
// Abrechnung für einen Partner für einen Zeitraum erstellen
router.post('/abrechnung/erstellen', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { partnerId, zeitraumVon, zeitraumBis, notiz } = req.body;
    if (!partnerId || !zeitraumVon || !zeitraumBis)
      return res.status(400).json({ error: 'partnerId, zeitraumVon, zeitraumBis sind erforderlich.' });

    const vonDatum = parseDate(zeitraumVon);
    const bisDatum = parseDate(zeitraumBis);
    if (!vonDatum || !bisDatum) return res.status(400).json({ error: 'Ungültiges Datumsformat (DD.MM.YYYY oder ISO).' });

    const sheets = await getSheets();
    const [verkäufeTab, abrechnungenTab] = await Promise.all([
      readTab(sheets, sheetId, 'Partner_Verkäufe'),
      readTab(sheets, sheetId, 'Partner_Abrechnungen'),
    ]);

    // Offene Verkäufe im Zeitraum
    const pIdx    = verkäufeTab.header.indexOf('Partner-ID');
    const datIdx  = verkäufeTab.header.indexOf('Datum');
    const lizIdx  = verkäufeTab.header.indexOf('Lizenzgebühr');
    const stIdx   = verkäufeTab.header.indexOf('Status');

    const offene = verkäufeTab.rows
      .map((row, rowIndex) => ({ row, rowIndex: rowIndex + 2 })) // +2: 1-basiert + Header
      .filter(({ row }) => {
        if (row[pIdx] !== partnerId) return false;
        if ((row[stIdx] ?? '') !== 'offen') return false;
        const d = parseDate(row[datIdx] ?? '');
        return d && d >= vonDatum && d <= bisDatum;
      });

    if (!offene.length)
      return res.status(404).json({ error: `Keine offenen Verkäufe für Partner "${partnerId}" im Zeitraum.` });

    const verkaufsSumme = offene.reduce((s, { row }) => s + parseFloat(row[lizIdx] ?? '0'), 0);
    const saldo         = parseFloat(verkaufsSumme.toFixed(2));

    // Neue Abrechnungs-ID
    const abIdIdx   = abrechnungenTab.header.indexOf('Abrechnungs-ID');
    const abId      = nextAbrechnungId(abrechnungenTab.rows, abIdIdx);
    const erstelltAm = toDE(new Date());

    // Abrechnung schreiben
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Partner_Abrechnungen!A:I',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        abId, partnerId,
        toDE(vonDatum), toDE(bisDatum),
        saldo, saldo, 'angefordert', erstelltAm, notiz ?? '',
      ]]},
    });

    // Verkäufe als 'abgerechnet' markieren (batch)
    const stColLetter = colLetter(stIdx);
    const requests = offene.map(({ rowIndex }) => ({
      range:          `Partner_Verkäufe!${stColLetter}${rowIndex}`,
      majorDimension: 'ROWS',
      values:         [['abgerechnet']],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: requests },
    });

    res.status(201).json({
      abrechnungId: abId, partnerId,
      zeitraumVon: toDE(vonDatum), zeitraumBis: toDE(bisDatum),
      anzahlVerkäufe: offene.length, saldo, status: 'angefordert',
    });
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/abrechnungen ────────────────────────────────────────
// Alle Abrechnungen (optional ?partnerId=X oder ?status=geprüft)
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { partnerId, status } = req.query;
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Abrechnungen');

    const h = col => header.indexOf(col);
    const filtered = rows
      .filter(r => (!partnerId || r[h('Partner-ID')] === partnerId) &&
                   (!status    || r[h('Status')]     === status))
      .map(r => ({
        abrechnungId:    r[h('Abrechnungs-ID')]     ?? '',
        partnerId:       r[h('Partner-ID')]          ?? '',
        zeitraumVon:     r[h('Zeitraum-Von')]        ?? '',
        zeitraumBis:     r[h('Zeitraum-Bis')]        ?? '',
        verkaufsSumme:   parseFloat(r[h('Verkaufs-Guthaben')] ?? '0'),
        saldo:           parseFloat(r[h('Saldo')]    ?? '0'),
        status:          r[h('Status')]              ?? '',
        erstelltAm:      r[h('Erstellt-Am')]         ?? '',
        notiz:           r[h('Notiz')]               ?? '',
      }));

    res.json(filtered);
  } catch (err) { next(err); }
});

// ── PATCH /api/kalkulation/abrechnung/:id/status ─────────────────────────────
// Status einer Abrechnung ändern (geprüft → freigegeben → bezahlt)
router.patch('/abrechnung/:id/status', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const VALID = ['angefordert', 'geprüft', 'freigegeben', 'bezahlt'];
    const { status } = req.body;
    if (!VALID.includes(status))
      return res.status(400).json({ error: `Ungültiger Status. Erlaubt: ${VALID.join(', ')}` });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Abrechnungen');

    const abIdIdx  = header.indexOf('Abrechnungs-ID');
    const stIdx    = header.indexOf('Status');
    const rowIndex = rows.findIndex(r => r[abIdIdx] === req.params.id);
    if (rowIndex === -1)
      return res.status(404).json({ error: `Abrechnung "${req.params.id}" nicht gefunden.` });

    const sheetRow   = rowIndex + 2; // 1-basiert + Header
    const stColLetter = colLetter(stIdx);

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Partner_Abrechnungen!${stColLetter}${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] },
    });

    res.json({ abrechnungId: req.params.id, status });
  } catch (err) { next(err); }
});

export default router;
