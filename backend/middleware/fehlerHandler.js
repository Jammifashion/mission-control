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

export function fehlerHandler(err, req, res, _next) {
  console.error(`[fehler] ${fehlerText(err, req)}`);
  const message = process.env.NODE_ENV === 'production'
    ? (err?.message || 'Interner Serverfehler.')
    : (err?.stack || err?.message || 'Interner Serverfehler.');
  res.status(err?.status ?? 500).json({ error: message });
}
