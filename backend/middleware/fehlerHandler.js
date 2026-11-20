// Allgemeiner Express-Fehlerhandler (zuletzt eingehaengt, index.js).
// Ins Log kommt nur eine kurze Zusammenfassung des Fehlers - nie das ganze
// Fehlerobjekt (das kann Anfrage-Konfiguration und Anfrage-Inhalt tragen).

const MELDUNG_MAX = 300;

// Kurzform eines Fehlers fuer das Log: Name, Meldung, Status, Code, Pfad.
export function fehlerKurz(err, req) {
  const e = err && typeof err === 'object' ? err : { message: String(err ?? '') };
  const status = e.status ?? e.statusCode ?? e.response?.status;
  const code   = typeof e.code === 'string' || typeof e.code === 'number' ? e.code : undefined;
  const kurz = {
    name:    typeof e.name === 'string' ? e.name : 'Error',
    meldung: String(e.message ?? '').slice(0, MELDUNG_MAX),
  };
  if (status !== undefined) kurz.status = status;
  if (code   !== undefined) kurz.code   = code;
  if (req) kurz.pfad = `${req.method ?? ''} ${req.baseUrl ?? ''}${req.path ?? ''}`.trim();
  return kurz;
}

export function fehlerText(err, req) {
  return JSON.stringify(fehlerKurz(err, req));
}

// Oeffentliche Routen (Partnerportale, Kundenchat, Bestellseite): bei 5xx nie den internen Fehlertext nach aussen -
// Reiter-, Bereichs- und Modellnamen, Kontingentmeldungen gehoeren nicht in den Browser eines Fremden. Fester Text +
// Code (nur ein sauberer Code, sonst "fehler"). 4xx-Meldungen sind fuer den Nutzer geschrieben und bleiben.
export const OEFFENTLICH_TEXT = 'Gerade nicht möglich – bitte später noch einmal versuchen.';
const sichererCode = c => (typeof c === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(c) ? c : 'fehler');
/** Markiert eine Anfrage als oeffentlich (vor den oeffentlichen Routern in index.js eingehaengt). */
export function oeffentlich(req, _res, next) { req.mcOeffentlich = true; next(); }

export function fehlerHandler(err, req, res, _next) {
  console.error(`[fehler] ${fehlerText(err, req)}`);
  const status = err?.status ?? 500;
  if (req?.mcOeffentlich && status >= 500) return res.status(status).json({ error: OEFFENTLICH_TEXT, code: sichererCode(err?.code) });
  const message = process.env.NODE_ENV === 'production'
    ? (err?.message || 'Interner Serverfehler.')
    : (err?.stack || err?.message || 'Interner Serverfehler.');
  res.status(status).json({ error: message });
}
