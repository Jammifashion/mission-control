import { Router } from 'express';
import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import { getAgentSystemPrompt } from '../lib/agentWissenHelper.js';
import { loadRecentAnfragen, callChatAgent } from '../lib/chatCore.js';
import rateLimit from 'express-rate-limit';
import { notify, buildAnfrageNachricht, notifyFehler, alarmWuerdig } from '../lib/chatNotify.js';
import { issueSessionToken, pruefeSessionToken } from '../lib/chatSession.js';
import { SESSION_LAENGEN, kanalAusListe, preisZelle } from '../utils/anfrage-felder.js';

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

// Fehlerantwort mit Alarm. Der Alarm geht mit await raus, VOR der Antwort -
// Cloud Run drosselt die CPU danach, ein spaeter laufender fetch ginge verloren
// (dieselbe Begruendung wie bei den Anfrage-Benachrichtigungen weiter unten).
async function fehler(res, status, meldung) {
  if (alarmWuerdig(status)) {
    await notifyFehler({ art: `HTTP ${status}`, status, text: meldung });
  }
  return res.status(status).json({ error: meldung });
}

// ── POST /chat ────────────────────────────────────────────────────────────────
router.post('/chat', chatLimiter, async (req, res, next) => {
  try {
    const { messages = [], sessionData = {}, website = '',
            cfTurnstileToken, chatSession } = req.body ?? {};

    // Honeypot: verstecktes Feld 'website' wird nur von Bots ausgefüllt.
    if (typeof website === 'string' && website.trim() !== '') {
      return fehler(res, 400, 'Ungültige Anfrage.');
    }

    if (!Array.isArray(messages) || messages.length > 20) {
      return fehler(res, 400, 'Ungültige Anfrage.');
    }

    // ── Zugang ────────────────────────────────────────────────────────────
    // Entweder eine gueltige Session ODER eine frische Turnstile-Pruefung.
    // Bewusst OHNE Ausnahme fuer __init__ und ohne Blick auf messages.length:
    // die Laenge kommt vom Client, ein Bot haette sonst nur eine erfundene
    // Historie mitschicken muessen, um an der Pruefung vorbeizukommen.
    let sessionToken;
    const sitzung = pruefeSessionToken(chatSession);
    if (sitzung.gueltig) {
      // Gleitendes Fenster: jede Antwort traegt einen frischen Token (30 min Leerlauf),
      // SI1: hoechstens SESSION_MAX_MS ab der Bot-Pruefung - der Start wandert mit.
      sessionToken = issueSessionToken(Date.now(), sitzung.start);
    } else {
      if (!cfTurnstileToken) {
        // SI1: laufendes Gespraech, Sitzung abgelaufen -> kein Fehler, sondern Hinweis + neue Bot-Pruefung im Widget
        // (kein Alarm: das ist der Normalfall nach Leerlauf oder 2 h).
        if (sitzung.grund === 'abgelaufen') {
          return res.status(401).json({ code: 'sitzung_abgelaufen', error: 'Kurze Sicherheitsprüfung – danach geht es direkt weiter.' });
        }
        return fehler(res, 403, 'Bot-Verifikation erforderlich. Bitte Seite neu laden.');
      }
      const tsSecret = process.env.TURNSTILE_SECRET_KEY;
      if (!tsSecret) {
        return fehler(res, 500, 'Turnstile nicht konfiguriert.');
      }
      const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: tsSecret, response: cfTurnstileToken }),
      });
      const tsData = await tsRes.json();
      if (!tsData.success) {
        return fehler(res, 403, 'Bot-Verifikation fehlgeschlagen. Bitte Seite neu laden.');
      }
      sessionToken = issueSessionToken();
    }

    const validMsgs = messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));

    const [history, kbBase] = await Promise.all([loadRecentAnfragen(), getAgentSystemPrompt()]);
    const result = await callChatAgent({ messages: validMsgs, sessionData, kbBase, history });

    if (!result) {
      return fehler(res, 502, 'Agent konnte keine Antwort generieren.');
    }

    const { reply, sessionData: merged, completed } = result;
    let anfrageId = null;

    // Das Modell hat die JSON-Huelle weggelassen; chatCore hat den Fliesstext
    // gerettet. Der Kunde merkt nichts, wir sollen es trotzdem erfahren -
    // sonst laeuft so etwas wieder wochenlang unbemerkt.
    if (result.fallback) {
      await notifyFehler({
        art:  'Antwort ohne JSON-Huelle',
        // Bewusst ohne Modelltext: der koennte Kundenangaben zitieren. Die
        // vollstaendige Rohantwort steht im Log unter [chat-fallback].
        text: `${result.fallback.modell} antwortete in Fliesstext `
            + `(${result.fallback.zeichen} Zeichen). Details im Log unter [chat-fallback].`,
      });
    }

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
          const L = SESSION_LAENGEN;
          const safeId    = String(merged.partnerId || '').replace(/[^A-Za-z0-9\-]/g, '').slice(0, L.partnerId);
          const safePreis = preisZelle(String(merged.preisvorschlag || '').replace(/[^0-9.,]/g, '').slice(0, L.preisvorschlag));

          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${TAB}!A:N`,
            valueInputOption: 'RAW',   // Text bleibt Text, nie Formel
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
              values: [[
                anfrageId,
                todayDE(),
                kanalAusListe(merged.kanal, 'Homepage'),
                safeStr(merged.kundeName, L.kundeName),
                safeStr(merged.kundeEmail, L.kundeEmail),
                safeStr(merged.produktBeschreibung, L.produktBeschreibung),
                safeStr(merged.menge, L.menge),
                safeStr(merged.varianten, L.varianten),
                safeId,
                safePreis,
                safeStr(merged.anmerkungenKunde, L.anmerkungenKunde),
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
      chatSession: sessionToken,
      ...(anfrageId ? { anfrageId } : {}),
    });

  } catch (err) {
    const status = err.status ?? 500;
    if (alarmWuerdig(status)) {
      await notifyFehler({ art: `HTTP ${status}`, status, text: err.message });
    }
    next(err);
  }
});

export default router;
