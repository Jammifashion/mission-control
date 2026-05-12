import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';

const router = Router();

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

async function readTab(sheets, sheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A1:Z`,
  });
  const [header, ...rows] = data.values ?? [];
  return { header: header ?? [], rows: rows.filter(r => r.some(c => c)) };
}

// Liest Partner-Zeile aus Sheet und validiert Token
async function resolvePartner(token) {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId)
    throw Object.assign(new Error('BUSINESS_SHEET_ID nicht konfiguriert.'), { status: 503 });

  const sheets = await getSheets();
  const { header, rows } = await readTab(sheets, sheetId, 'Partner');

  const tokenIdx = header.indexOf('Token');
  const idIdx    = header.indexOf('Partner-ID');
  const nameIdx  = header.indexOf('Name');
  const aktivIdx = header.indexOf('Aktiv');

  const row = rows.find(r => token && (r[tokenIdx] ?? '') === token);
  if (!row) throw Object.assign(new Error('Ungültiger Token.'), { status: 401 });
  if ((row[aktivIdx] ?? '').toLowerCase() !== 'ja')
    throw Object.assign(new Error('Partner ist nicht aktiv.'), { status: 403 });

  return { id: row[idIdx] ?? '', name: row[nameIdx] ?? '' };
}

// GET /api/partner-view/me?token=
router.get('/me', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    res.json(await resolvePartner(token));
  } catch (err) { next(err); }
});

// GET /api/partner-view/verkaeufe?token=
router.get('/verkaeufe', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const partner = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Verkäufe');
    const h = col => header.indexOf(col);

    res.json(rows
      .filter(r => r[h('Partner-ID')] === partner.id)
      .map(r => ({
        datum:         r[h('Datum')]                ?? '',
        orderId:       r[h('Order-ID')]             ?? '',
        artikelnummer: r[h('Artikelnummer')]         ?? '',
        variante:      r[h('Variante')]             ?? '',
        stueckzahl:    parseInt(r[h('Stückzahl')]   ?? '1', 10),
        vkPreisBrutto: parseFloat(r[h('VK-Preis-Brutto')] ?? '0'),
        lizenzgebuehr: parseFloat(r[h('Lizenzgebühr')]    ?? '0'),
        status:        r[h('Status')]               ?? '',
      })));
  } catch (err) { next(err); }
});

// GET /api/partner-view/abrechnungen?token=
router.get('/abrechnungen', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(401).json({ error: 'token fehlt.' });
    const partner = await resolvePartner(token);

    const sheetId = process.env.BUSINESS_SHEET_ID;
    const sheets  = await getSheets();
    const { header, rows } = await readTab(sheets, sheetId, 'Partner_Abrechnungen');
    const h = col => header.indexOf(col);

    res.json(rows
      .filter(r => r[h('Partner-ID')] === partner.id)
      .map(r => ({
        abrechnungId: r[h('Abrechnungs-ID')]    ?? '',
        zeitraumVon:  r[h('Zeitraum-Von')]       ?? '',
        zeitraumBis:  r[h('Zeitraum-Bis')]       ?? '',
        saldo:        parseFloat(r[h('Saldo')]   ?? '0'),
        status:       r[h('Status')]             ?? '',
        erstelltAm:   r[h('Erstellt-Am')]         ?? '',
        notiz:        r[h('Notiz')]              ?? '',
      })));
  } catch (err) { next(err); }
});

export default router;
