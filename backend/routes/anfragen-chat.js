import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getAgentSystemPrompt } from '../lib/agentWissenHelper.js';
import { loadRecentAnfragen, callChatAgent } from '../lib/chatCore.js';
import rateLimit from 'express-rate-limit';
import { notify, buildAnfrageNachricht } from '../lib/chatNotify.js';

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte in 15 Minuten erneut versuchen.' },
});

const TAB = 'Kundenanfragen';

function todayDE() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function generateAnfrageId(existingIds, year) {
  const prefix = `KA-${year}-`;
  const max = existingIds
    .filter(id => id.startsWith(prefix))
    .map(id => parseInt(id.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((acc, n) => Math.max(acc, n), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function getSheets() {
  return getGoogleAuth().then(auth => google.sheets({ version: 'v4', auth }));
}

// ── POST /chat ────────────────────────────────────────────────────────────────
router.post('/chat', chatLimiter, async (req, res, next) => {
  try {
    const { messages = [], sessionData = {}, website = '', cfTurnstileToken } = req.body ?? {};

    // Honeypot: verstecktes Feld 'website' wird nur von Bots ausgefüllt.
    if (typeof website === 'string' && website.trim() !== '') {
      return res.status(400).json({ error: 'Ungültige Anfrage.' });
    }

    if (!Array.isArray(messages) || messages.length > 20) {
      return res.status(400).json({ error: 'Ungültige Anfrage.' });
    }

    // Turnstile-Verifikation: nur bei der ersten Nachricht (token wird einmalig mitgeschickt)
    if (cfTurnstileToken) {
      const tsSecret = process.env.TURNSTILE_SECRET_KEY;
      if (!tsSecret) {
        return res.status(500).json({ error: 'Turnstile nicht konfiguriert.' });
      }
      const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: tsSecret, response: cfTurnstileToken }),
      });
      const tsData = await tsRes.json();
      if (!tsData.success) {
        return res.status(403).json({ error: 'Bot-Verifikation fehlgeschlagen. Bitte Seite neu laden.' });
      }
    }

    const validMsgs = messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));

    const [history, kbBase] = await Promise.all([loadRecentAnfragen(), getAgentSystemPrompt()]);
    const result = await callChatAgent({ messages: validMsgs, sessionData, kbBase, history });

    if (!result) {
      return res.status(502).json({ error: 'Agent konnte keine Antwort generieren.' });
    }

    const { reply, sessionData: merged, completed } = result;
    let anfrageId = null;

    if (completed && merged.kundeName && merged.kundeEmail) {
      try {
        const sheetId = process.env.BUSINESS_SHEET_ID;
        if (sheetId) {
          const sheets = await getSheets();
          const { data: idData } = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId, range: `${TAB}!A:A`,
          });
          const ids = (idData.values ?? []).flat();
          anfrageId = generateAnfrageId(ids, new Date().getFullYear());

          // Sanitize: user-gesteuerte Felder kappen + unerwünschte Zeichen entfernen
          const safeStr   = (v, max) => String(v ?? '').replace(/[\r\n\t]/g, ' ').slice(0, max);
          const safeId    = String(merged.partnerId || '').replace(/[^A-Za-z0-9\-]/g, '').slice(0, 20);
          const safePreis = String(merged.preisvorschlag || '').replace(/[^0-9.,]/g, '').slice(0, 10);

          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${TAB}!A:N`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
              values: [[
                anfrageId,
                todayDE(),
                merged.kanal || 'Homepage',
                safeStr(merged.kundeName, 100),
                safeStr(merged.kundeEmail, 200),
                safeStr(merged.produktBeschreibung, 500),
                safeStr(merged.menge, 100),
                safeStr(merged.varianten, 200),
                safeId,
                safePreis,
                safeStr(merged.anmerkungenKunde, 500),
                'Neu',
                '', '',
              ]],
            },
          });

          // Genau hier, nicht pro Chat-Nachricht: es gibt jetzt eine Zeile.
          // Mit await, vor der Antwort - Cloud Run drosselt die CPU nach dem
          // Response, ein danach laufender fetch geht verloren.
          await notify(buildAnfrageNachricht({
            anfrageId,
            kundeName:    merged.kundeName,
            menge:        merged.menge,
            beschreibung: merged.produktBeschreibung,
          }));
        }
      } catch (err) {
        console.error('Chat-Anfrage Erstellung fehlgeschlagen:', err.message);
      }
    }

    res.json({
      reply,
      sessionData: merged,
      completed,
      ...(anfrageId ? { anfrageId } : {}),
    });

  } catch (err) { next(err); }
});

export default router;
