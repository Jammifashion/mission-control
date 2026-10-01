import { HosterPruefseiteError, HOSTER_PRUEFSEITE_CODE } from '../lib/hosterPruefseite.js';
import { notifyHosterPruefseite } from '../lib/chatNotify.js';

// Express-Fehlerhandler fuer die Hoster-Pruefseite, vor dem allgemeinen
// Handler eingehaengt (index.js). Jeder Lauf, der mit HosterPruefseiteError
// endet (Partner-, Festpreis-, Trikot-Sync, Artikel-Abgleich, Artikelanlage …),
// antwortet 503 mit Code "hoster_pruefseite": der Workflow (curl
// --fail-with-body) wird rot, das Frontend bricht seine Schleife ab.
// Dazu eine gedrosselte Meldung in den Chat (hoechstens 1/h).
export async function hosterPruefseiteHandler(err, req, res, next) {
  if (!(err instanceof HosterPruefseiteError)) return next(err);
  console.error(`[hoster] ${err.message} (${req.method} ${req.baseUrl ?? ''}${req.path ?? ''})`);
  await notifyHosterPruefseite({
    ablauf: `${req.method} ${req.baseUrl ?? ''}${req.path ?? ''}`,
    shop: err.shop, pfad: err.pfad, httpStatus: err.httpStatus, titel: err.titel, zeit: err.zeit,
  });
  if (res.headersSent) return next(err);
  res.status(503).json({ error: err.message, code: HOSTER_PRUEFSEITE_CODE });
}
