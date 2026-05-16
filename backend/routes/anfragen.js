import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

const TAB = 'Kundenanfragen';

const KANAL_VALUES = ['Homepage', 'E-Mail', 'Manuell'];
const STATUS_VALUES = [
  'Neu', 'Geprüft', 'Angebot-gesendet', 'Bestätigt', 'In-Produktion', 'Abgeschlossen',
];

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

function requireSheetId(res) {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) {
    res.status(503).json({ error: 'BUSINESS_SHEET_ID nicht konfiguriert.' });
    return null;
  }
  return sheetId;
}

function colLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
}

function todayDE() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function readTab(sheets, sheetId) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${TAB}!A1:Z`,
  });
  const all = data.values ?? [];
  const [header, ...rest] = all;
  // Note-Zeile (beginnt mit //) ignorieren
  const rows = rest.filter(r => r.some(c => c) && !(r[0] ?? '').startsWith('//'));
  return { header: header ?? [], rows };
}

function rowToAnfrage(r, h) {
  return {
    anfrageId:           r[h('Anfrage-ID')]           ?? '',
    datum:               r[h('Datum')]                ?? '',
    kanal:               r[h('Kanal')]                ?? '',
    kundeName:           r[h('Kunde-Name')]           ?? '',
    kundeEmail:          r[h('Kunde-Email')]          ?? '',
    produktBeschreibung: r[h('Produkt-Beschreibung')] ?? '',
    menge:               r[h('Menge')]                ?? '',
    varianten:           r[h('Varianten')]            ?? '',
    partnerId:           r[h('Partner-ID')]           ?? '',
    preisvorschlag:      r[h('Preisvorschlag')]       ?? '',
    anmerkungenKunde:    r[h('Anmerkungen-Kunde')]    ?? '',
    status:              r[h('Status')]               ?? '',
    notizIntern:         r[h('Notiz-intern')]         ?? '',
    wcOrderId:           r[h('WC-Order-ID')]          ?? '',
  };
}

function generateAnfrageId(existingIds, year) {
  const prefix = `KA-${year}-`;
  const maxNum = existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((acc, n) => Math.max(acc, n), 0);
  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

// ── POST /neu ────────────────────────────────────────────────────────────────
router.post('/neu', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();

    const {
      datum, kanal, kundeName, kundeEmail, produktBeschreibung,
      menge, varianten, partnerId, preisvorschlag, anmerkungenKunde,
      notizIntern, wcOrderId,
    } = req.body ?? {};

    if (!kundeName || !kundeEmail || !produktBeschreibung) {
      return res.status(400).json({
        error: 'kundeName, kundeEmail und produktBeschreibung sind erforderlich.',
      });
    }
    const kanalNorm = kanal || 'Manuell';
    if (!KANAL_VALUES.includes(kanalNorm)) {
      return res.status(400).json({ error: `Ungültiger Kanal. Erlaubt: ${KANAL_VALUES.join(', ')}` });
    }

    const { rows, header } = await readTab(sheets, sheetId);
    const h = c => header.indexOf(c);
    const idCol = h('Anfrage-ID');
    const year = new Date().getFullYear();
    const existingIds = rows.map(r => r[idCol] ?? '').filter(Boolean);
    const anfrageId = generateAnfrageId(existingIds, year);

    const newRow = [
      anfrageId,                                   // A
      datum || todayDE(),                          // B
      kanalNorm,                                   // C
      kundeName,                                   // D
      kundeEmail,                                  // E
      produktBeschreibung,                         // F
      menge ?? '',                                 // G
      varianten ?? '',                             // H
      partnerId ?? '',                             // I
      preisvorschlag ?? '',                        // J
      anmerkungenKunde ?? '',                      // K
      'Neu',                                       // L
      notizIntern ?? '',                           // M
      wcOrderId ?? '',                             // N
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${TAB}!A:N`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] },
    });

    res.status(201).json({
      anfrageId,
      datum:               newRow[1],
      kanal:               kanalNorm,
      kundeName,
      kundeEmail,
      produktBeschreibung,
      menge:               newRow[6],
      varianten:           newRow[7],
      partnerId:           newRow[8],
      preisvorschlag:      newRow[9],
      anmerkungenKunde:    newRow[10],
      status:              'Neu',
      notizIntern:         newRow[12],
      wcOrderId:           newRow[13],
    });
  } catch (err) { next(err); }
});

// ── GET / ────────────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId);
    const h = c => header.indexOf(c);

    const { status, kanal } = req.query;
    const result = rows.map(r => rowToAnfrage(r, h)).filter(a => {
      if (status && a.status !== status) return false;
      if (kanal  && a.kanal  !== kanal)  return false;
      return true;
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── PATCH /:id/status ────────────────────────────────────────────────────────
router.patch('/:id/status', async (req, res, next) => {
  try {
    const sheetId = requireSheetId(res); if (!sheetId) return;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId);
    const h = c => header.indexOf(c);

    const { status, notizIntern } = req.body ?? {};
    if (status === undefined && notizIntern === undefined) {
      return res.status(400).json({ error: 'status oder notizIntern muss angegeben werden.' });
    }
    if (status !== undefined && !STATUS_VALUES.includes(status)) {
      return res.status(400).json({ error: `Ungültiger Status. Erlaubt: ${STATUS_VALUES.join(', ')}` });
    }

    const idCol = h('Anfrage-ID');
    const rowIdx = rows.findIndex(r => (r[idCol] ?? '') === req.params.id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });

    // Sheet-Zeile: Header + ggf. Note + rowIdx → +2 reicht NICHT wenn Note vorhanden.
    // Wir suchen die tatsächliche Zeilennummer im Sheet anhand der ID.
    const { data: idColData } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId, range: `${TAB}!${colLetter(idCol)}:${colLetter(idCol)}`,
    });
    const idValues = idColData.values ?? [];
    const sheetRowIdx = idValues.findIndex(r => (r[0] ?? '') === req.params.id);
    if (sheetRowIdx === -1) return res.status(404).json({ error: 'Anfrage nicht gefunden (sheet).' });
    const sheetRow = sheetRowIdx + 1; // values.get ist 1-basiert in Sheet-Notation

    const updates = [];
    if (status !== undefined) {
      updates.push({
        range: `${TAB}!${colLetter(h('Status'))}${sheetRow}`,
        values: [[status]],
      });
    }
    if (notizIntern !== undefined) {
      updates.push({
        range: `${TAB}!${colLetter(h('Notiz-intern'))}${sheetRow}`,
        values: [[notizIntern]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
    });

    res.json({
      anfrageId: req.params.id,
      ...(status      !== undefined ? { status }      : {}),
      ...(notizIntern !== undefined ? { notizIntern } : {}),
    });
  } catch (err) { next(err); }
});

export default router;
