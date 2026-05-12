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

// Robustes parseFloat: behandelt Komma als Dezimaltrennzeichen (DE-Format aus Sheet).
function toFloat(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = parseFloat(val.toString().replace(',', '.'));
  return Number.isNaN(n) ? fallback : n;
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
      const betrag  = toFloat(r[fBetragIdx]);
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
        vkBrutto: toFloat(r[vkPreisIdx]),
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
    const idIdx      = header.indexOf('Partner-ID');
    const nameIdx    = header.indexOf('Name');
    const katIdx     = header.indexOf('Hauptkategorie');
    const tokenIdx   = header.indexOf('Token');
    const aktivIdx   = header.indexOf('Aktiv');
    const lizenzIdx  = header.indexOf('Lizenz-%');
    const portoIdx   = header.indexOf('Porto-Modell');
    const notizIdx   = header.indexOf('Notiz');

    res.json(rows.map(r => ({
      id:            r[idIdx]    ?? '',
      name:          r[nameIdx]  ?? '',
      kategorie:     r[katIdx]   ?? '',
      token:         r[tokenIdx] ?? '',
      aktiv:         (r[aktivIdx] ?? '').toLowerCase() === 'ja',
      lizenzProzent: toFloat(r[lizenzIdx]),
      portoModell:   r[portoIdx]   ?? 'geteilt-50-50',
      notiz:         r[notizIdx]   ?? '',
    })));
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/partner ────────────────────────────────────────────
router.post('/partner', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const {
      name, kategorie = '', lizenzProzent = 0,
      portoModell = 'geteilt-50-50', aktiv = true, notiz = '',
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name ist erforderlich.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner');

    const idIdx = header.indexOf('Partner-ID');
    const maxNum = rows
      .map(r => (r[idIdx] ?? '').toString())
      .filter(id => /^P-\d+$/.test(id))
      .map(id => parseInt(id.slice(2), 10))
      .reduce((m, n) => Math.max(m, n), 0);
    const partnerId = `P-${String(maxNum + 1).padStart(3, '0')}`;

    // Header-basiert schreiben (Sheet kann Spalten in beliebiger Reihenfolge haben).
    // Versand-Modell / PayPal-Modell deprecated seit Sprint 4.2 – Spalten bleiben leer.
    const rowVals = new Array(header.length).fill('');
    const put = (col, v) => { const i = header.indexOf(col); if (i !== -1) rowVals[i] = v; };
    put('Partner-ID',     partnerId);
    put('Name',           name);
    put('Hauptkategorie', kategorie);
    put('Token',          '');
    put('Aktiv',          aktiv ? 'Ja' : 'Nein');
    put('Lizenz-%',       lizenzProzent);
    put('Porto-Modell',   portoModell);
    put('Notiz',          notiz);

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `Partner!A:${colLetter(header.length - 1)}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowVals] },
    });

    res.status(201).json({ id: partnerId, name, kategorie, aktiv, lizenzProzent, portoModell, notiz });
  } catch (err) { next(err); }
});

// ── PATCH /api/kalkulation/partner/:id ──────────────────────────────────────
router.patch('/partner/:id', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner');

    const idIdx    = header.indexOf('Partner-ID');
    const rowIndex = rows.findIndex(r => r[idIdx] === req.params.id);
    if (rowIndex === -1)
      return res.status(404).json({ error: `Partner "${req.params.id}" nicht gefunden.` });

    const { name, kategorie, lizenzProzent, portoModell, aktiv, notiz, token } = req.body;
    const sheetRow = rowIndex + 2;

    const colMap = {
      'Name':           name,
      'Hauptkategorie': kategorie,
      'Token':          token,
      'Lizenz-%':       lizenzProzent,
      'Porto-Modell':   portoModell,
      'Aktiv':          aktiv !== undefined ? (aktiv ? 'Ja' : 'Nein') : undefined,
      'Notiz':          notiz,
    };

    const data = Object.entries(colMap)
      .filter(([, v]) => v !== undefined)
      .map(([col, value]) => ({
        range: `Partner!${colLetter(header.indexOf(col))}${sheetRow}`,
        majorDimension: 'ROWS',
        values: [[value]],
      }));

    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    }

    res.json({ id: req.params.id, updated: Object.keys(colMap).filter(k => colMap[k] !== undefined) });
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
        vkPreisBrutto: toFloat(r[header.indexOf('VK-Preis-Brutto')]),
        lizenzgebühr:  toFloat(r[header.indexOf('Lizenzgebühr')]),
        status:       r[header.indexOf('Status')] ?? '',
      }));

    const summe = filtered.reduce((s, v) => s + v.lizenzgebühr, 0);
    res.json({ partnerId: id, anzahl: filtered.length, lizenzSumme: parseFloat(summe.toFixed(2)), verkäufe: filtered });
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/abrechnung/vorschau ────────────────────────────────
// Liefert die Detail-Daten für ein Vorschau-Modal ohne etwas zu schreiben.
router.post('/abrechnung/vorschau', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { partnerId, zeitraumVon, zeitraumBis } = req.body;
    if (!partnerId || !zeitraumVon || !zeitraumBis)
      return res.status(400).json({ error: 'partnerId, zeitraumVon, zeitraumBis sind erforderlich.' });

    const vonDatum = parseDate(zeitraumVon);
    const bisDatum = parseDate(zeitraumBis);
    if (!vonDatum || !bisDatum) return res.status(400).json({ error: 'Ungültiges Datumsformat.' });

    const sheets = await getSheets();
    const [verkäufeTab, internTab] = await Promise.all([
      readTab(sheets, sheetId, 'Partner_Verkäufe'),
      readTab(sheets, sheetId, 'Partner_Interne_Bestellungen'),
    ]);

    const vh = col => verkäufeTab.header.indexOf(col);
    const verkaeufe = verkäufeTab.rows
      .filter(row => {
        if (row[vh('Partner-ID')] !== partnerId) return false;
        if ((row[vh('Status')] ?? '') !== 'offen') return false;
        const d = parseDate(row[vh('Datum')] ?? '');
        return d && d >= vonDatum && d <= bisDatum;
      })
      .map(row => ({
        datum:       row[vh('Datum')]        ?? '',
        orderId:     row[vh('Order-ID')]     ?? '',
        artikelname: row[vh('Artikelnummer')] ?? '',
        stueckzahl:  toFloat(row[vh('Stückzahl')]),
        vkBrutto:    toFloat(row[vh('VK-Preis-Brutto')]),
        lizenz:      toFloat(row[vh('Lizenzgebühr')]),
      }));

    const ih = col => internTab.header.indexOf(col);
    const intern = internTab.rows
      .filter(row => {
        if (row[ih('Partner-ID')] !== partnerId) return false;
        if ((row[ih('Status')] ?? '') !== 'offen') return false;
        const d = parseDate(row[ih('Datum')] ?? '');
        return d && d >= vonDatum && d <= bisDatum;
      })
      .map(row => ({
        datum:       row[ih('Datum')]       ?? '',
        bezeichnung: row[ih('Bezeichnung')] ?? '',
        anzahl:      toFloat(row[ih('Anzahl')]),
        einzelpreis: toFloat(row[ih('Einzelpreis')]),
        summe:       toFloat(row[ih('Summe')]),
      }));

    const lizenzSumme  = verkaeufe.reduce((s, v) => s + v.lizenz, 0);
    const interneSumme = intern.reduce((s, i) => s + i.summe, 0);
    const saldo        = lizenzSumme - interneSumme;

    res.json({
      partnerId,
      zeitraumVon: toDE(vonDatum), zeitraumBis: toDE(bisDatum),
      verkaeufe,
      intern,
      lizenzSumme:  parseFloat(lizenzSumme.toFixed(2)),
      interneSumme: parseFloat(interneSumme.toFixed(2)),
      saldo:        parseFloat(saldo.toFixed(2)),
    });
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
    const [verkäufeTab, internTab, abrechnungenTab] = await Promise.all([
      readTab(sheets, sheetId, 'Partner_Verkäufe'),
      readTab(sheets, sheetId, 'Partner_Interne_Bestellungen'),
      readTab(sheets, sheetId, 'Partner_Abrechnungen'),
    ]);

    // Offene Verkäufe im Zeitraum
    const pIdx    = verkäufeTab.header.indexOf('Partner-ID');
    const datIdx  = verkäufeTab.header.indexOf('Datum');
    const lizIdx  = verkäufeTab.header.indexOf('Lizenzgebühr');
    const stIdx   = verkäufeTab.header.indexOf('Status');

    const offene = verkäufeTab.rows
      .map((row, rowIndex) => ({ row, rowIndex: rowIndex + 2 }))
      .filter(({ row }) => {
        if (row[pIdx] !== partnerId) return false;
        if ((row[stIdx] ?? '') !== 'offen') return false;
        const d = parseDate(row[datIdx] ?? '');
        return d && d >= vonDatum && d <= bisDatum;
      });

    if (!offene.length)
      return res.status(404).json({ error: `Keine offenen Verkäufe für Partner "${partnerId}" im Zeitraum.` });

    const lizenzSumme = offene.reduce((s, { row }) => s + toFloat(row[lizIdx]), 0);

    // Offene interne Bestellungen im Zeitraum (Kosten für Partner → Abzug)
    const ipIdx  = internTab.header.indexOf('Partner-ID');
    const idatIdx = internTab.header.indexOf('Datum');
    const iSumIdx = internTab.header.indexOf('Summe');
    const istIdx  = internTab.header.indexOf('Status');

    const offeneIntern = internTab.rows
      .map((row, rowIndex) => ({ row, rowIndex: rowIndex + 2 }))
      .filter(({ row }) => {
        if (row[ipIdx] !== partnerId) return false;
        if ((row[istIdx] ?? '') !== 'offen') return false;
        const d = parseDate(row[idatIdx] ?? '');
        return d && d >= vonDatum && d <= bisDatum;
      });

    const interneSumme = offeneIntern.reduce((s, { row }) => s + toFloat(row[iSumIdx]), 0);

    // Saldo = Lizenz-Einnahmen − interne Bestellungskosten
    const saldo = parseFloat((lizenzSumme - interneSumme).toFixed(2));

    // Neue Abrechnungs-ID
    const abIdIdx    = abrechnungenTab.header.indexOf('Abrechnungs-ID');
    const abId       = nextAbrechnungId(abrechnungenTab.rows, abIdIdx);
    const erstelltAm = toDE(new Date());

    // Abrechnung schreiben (Verkaufs-Guthaben = Lizenz-Summe, Saldo = nach Abzug Intern)
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Partner_Abrechnungen!A:I',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        abId, partnerId,
        toDE(vonDatum), toDE(bisDatum),
        parseFloat(lizenzSumme.toFixed(2)), saldo, 'angefordert', erstelltAm, notiz ?? '',
      ]]},
    });

    // Verkäufe + interne Bestellungen als 'abgerechnet' markieren (batch)
    const stColLetter  = colLetter(stIdx);
    const istColLetter = colLetter(istIdx);
    const markRequests = [
      ...offene.map(({ rowIndex }) => ({
        range: `Partner_Verkäufe!${stColLetter}${rowIndex}`,
        majorDimension: 'ROWS', values: [['abgerechnet']],
      })),
      ...offeneIntern.map(({ rowIndex }) => ({
        range: `Partner_Interne_Bestellungen!${istColLetter}${rowIndex}`,
        majorDimension: 'ROWS', values: [['abgerechnet']],
      })),
    ];
    if (markRequests.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: markRequests },
      });
    }

    res.status(201).json({
      abrechnungId: abId, partnerId,
      zeitraumVon: toDE(vonDatum), zeitraumBis: toDE(bisDatum),
      anzahlVerkäufe: offene.length, lizenzSumme: parseFloat(lizenzSumme.toFixed(2)),
      anzahlInterne: offeneIntern.length, interneSumme: parseFloat(interneSumme.toFixed(2)),
      saldo, status: 'angefordert',
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
        verkaufsSumme:   toFloat(r[h('Verkaufs-Guthaben')]),
        saldo:           toFloat(r[h('Saldo')]),
        status:          r[h('Status')]              ?? '',
        erstelltAm:      r[h('Erstellt-Am')]         ?? '',
        notiz:           r[h('Notiz')]               ?? '',
      }));

    res.json(filtered);
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/verkaeufe ───────────────────────────────────────────
// Alle Verkäufe – Admin-Sicht (optional ?partnerId=X&status=Y)
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });
    const { partnerId, status } = req.query;
    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Verkäufe');
    const h = col => header.indexOf(col);
    res.json(rows
      .filter(r => (!partnerId || r[h('Partner-ID')] === partnerId) &&
                   (!status    || r[h('Status')]     === status))
      .map(r => ({
        partnerId:     r[h('Partner-ID')]           ?? '',
        datum:         r[h('Datum')]                ?? '',
        orderId:       r[h('Order-ID')]             ?? '',
        artikelnummer: r[h('Artikelnummer')]         ?? '',
        variante:      r[h('Variante')]             ?? '',
        stueckzahl:    parseInt(r[h('Stückzahl')]   ?? '1', 10),
        vkPreisBrutto: toFloat(r[h('VK-Preis-Brutto')]),
        lizenzgebuehr: toFloat(r[h('Lizenzgebühr')]),
        status:        r[h('Status')]               ?? '',
      })));
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

// ── GET /api/kalkulation/artikel ────────────────────────────────────────────────
router.get('/artikel', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Kalkulation_Artikel');

    const h = col => header.indexOf(col);
    res.json(rows.map(r => ({
      lshopNr:       r[h('L-Shop-Nr')]      ?? '',
      artikelname:   r[h('Artikelname')]    ?? '',
      ekPreisNetto:  toFloat(r[h('EK-Preis-Netto')]),
      kategorie:     r[h('Kategorie')]      ?? '',
      gueltigAb:     r[h('Gültig-Ab')]      ?? null,
      notiz:         r[h('Notiz')]          ?? '',
    })));
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/druckpreise ────────────────────────────────────────────
router.get('/druckpreise', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Kalkulation_Druckpreise');

    const h = col => header.indexOf(col);
    res.json(rows.map(r => ({
      druckposition: r[h('Druckposition')] ?? '',
      groesse:       r[h('Größe')]         ?? '',
      preisNetto:    toFloat(r[h('Preis-Netto')]),
      gueltigAb:     r[h('Gültig-Ab')]     ?? null,
    })));
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/fixkosten ──────────────────────────────────────────────
router.get('/fixkosten', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');

    const h = col => header.indexOf(col);
    res.json(rows.map(r => ({
      position:  r[h('Position')]  ?? '',
      betrag:    toFloat(r[h('Betrag')]),
      einheit:   r[h('Einheit')]   ?? '',
      gueltigAb: r[h('Gültig-Ab')] ?? null,
    })));
  } catch (err) { next(err); }
});

// ── GET /api/kalkulation/verkaufspreise ────────────────────────────────────────
router.get('/verkaufspreise', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Kalkulation_Verkaufspreise');

    const h = col => header.indexOf(col);
    res.json(rows.map(r => ({
      produkttyp: r[h('Produkttyp')]  ?? '',
      abMenge:    parseInt(r[h('Ab-Menge')] ?? '1', 10),
      vkBrutto:   toFloat(r[h('VK-Brutto')]),
      gueltigAb:  r[h('Gültig-Ab')]   ?? null,
      notiz:      r[h('Notiz')]       ?? '',
    })));
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/druckpreise ───────────────────────────────────────
router.post('/druckpreise', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { druckposition, groesse, preisNetto, gueltigAb } = req.body;
    if (!druckposition || !groesse || preisNetto === undefined)
      return res.status(400).json({ error: 'druckposition, groesse, preisNetto sind erforderlich.' });

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Kalkulation_Druckpreise!A:D',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[druckposition, groesse, preisNetto, gueltigAb || '']] },
    });

    res.status(201).json({ druckposition, groesse, preisNetto, gueltigAb: gueltigAb || null });
  } catch (err) { next(err); }
});

// ── PATCH /api/kalkulation/fixkosten/:position ──────────────────────────────
router.patch('/fixkosten/:position', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const sheets = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Kalkulation_Fixkosten');

    const posIdx   = header.indexOf('Position');
    const rowIndex = rows.findIndex(r => r[posIdx] === req.params.position);
    if (rowIndex === -1)
      return res.status(404).json({ error: `Fixkosten-Position "${req.params.position}" nicht gefunden.` });

    const { betrag, einheit, gueltigAb } = req.body;
    const sheetRow = rowIndex + 2;

    const colMap = {
      'Betrag':    betrag,
      'Einheit':   einheit,
      'Gültig-Ab': gueltigAb,
    };

    const data = Object.entries(colMap)
      .filter(([, v]) => v !== undefined)
      .map(([col, value]) => ({
        range: `Kalkulation_Fixkosten!${colLetter(header.indexOf(col))}${sheetRow}`,
        majorDimension: 'ROWS',
        values: [[value]],
      }));

    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    }

    res.json({ position: req.params.position, updated: Object.keys(colMap).filter(k => colMap[k] !== undefined) });
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/fixkosten ──────────────────────────────────────────
// Legt eine neue Fixkosten-Position an (z.B. Versandnebenkosten B, Porto P, …).
// Body: { position, betrag, einheit, gueltigAb }
router.post('/fixkosten', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { position, betrag, einheit, gueltigAb } = req.body;
    if (!position || betrag === undefined)
      return res.status(400).json({ error: 'position, betrag sind erforderlich.' });

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Kalkulation_Fixkosten!A:D',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[position, betrag, einheit || '', gueltigAb || '']] },
    });

    res.status(201).json({ position, betrag, einheit: einheit || '', gueltigAb: gueltigAb || null });
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/verkaufspreise ─────────────────────────────────────
router.post('/verkaufspreise', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { produkttyp, abMenge, vkBrutto, gueltigAb, notiz } = req.body;
    if (!produkttyp || abMenge === undefined || vkBrutto === undefined)
      return res.status(400).json({ error: 'produkttyp, abMenge, vkBrutto sind erforderlich.' });

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Kalkulation_Verkaufspreise!A:E',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[produkttyp, abMenge, vkBrutto, gueltigAb || '', notiz || '']] },
    });

    res.status(201).json({ produkttyp, abMenge, vkBrutto, gueltigAb: gueltigAb || null, notiz: notiz || '' });
  } catch (err) { next(err); }
});

// ── POST /api/kalkulation/artikel ────────────────────────────────────────────
router.post('/artikel', async (req, res, next) => {
  try {
    const sheetId = process.env.BUSINESS_SHEET_ID;
    if (!sheetId) return res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });

    const { lshopNr, artikelname, ekPreisNetto, kategorie, gueltigAb, notiz } = req.body;
    if (!lshopNr || !artikelname || ekPreisNetto === undefined)
      return res.status(400).json({ error: 'lshopNr, artikelname, ekPreisNetto sind erforderlich.' });

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Kalkulation_Artikel!A:F',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[lshopNr, artikelname, ekPreisNetto, kategorie || '', gueltigAb || '', notiz || '']] },
    });

    res.status(201).json({ lshopNr, artikelname, ekPreisNetto, kategorie: kategorie || '', gueltigAb: gueltigAb || null, notiz: notiz || '' });
  } catch (err) { next(err); }
});

export default router;
