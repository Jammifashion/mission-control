import {
  HosterPruefseiteError, HOSTER_PRUEFSEITE_CODE, ShopZeitueberschreitungError, SHOP_TIMEOUT_CODE,
} from '../lib/hosterPruefseite.js';
import { notifyHosterPruefseite, notifyShopZeitueberschreitung } from '../lib/chatNotify.js';
import { zeitueberschreitungPruefen } from '../lib/alarmStand.js';
import { alarmSchluessel } from '../utils/alarm-stand.js';

// Express-Fehlerhandler fuer Laufstopps, vor dem allgemeinen Handler
// eingehaengt (index.js). Jeder Lauf, der mit HosterPruefseiteError oder
// ShopZeitueberschreitungError endet (Partner-, Festpreis-, Trikot-Sync,
// Artikel-Abgleich, Artikelanlage …):
//   - Pruefseite        -> 503 { code: "hoster_pruefseite" }
//   - Zeitueberschreitung -> 504 { code: "shop_timeout", ergebnisUnklar }
// Der Workflow (curl --fail-with-body) wird rot, das Frontend bricht seine
// Schleife ab. Dazu eine gedrosselte Meldung in den Chat (hoechstens 1/h je Art).
// AL2: eine LESENDE Zeitueberschreitung meldet erst die zweite innerhalb von 2 h je Shop + Ablauf (Stand im
// Reiter Alarm_Stand, lib/alarmStand.js); schreibend (Ergebnis unklar) und Pruefseite sofort. Antwort unveraendert.
export async function hosterPruefseiteHandler(err, req, res, next) {
  const pruefseite = err instanceof HosterPruefseiteError;
  const timeout    = err instanceof ShopZeitueberschreitungError;
  if (!pruefseite && !timeout) return next(err);

  const ablauf = `${req.method} ${req.baseUrl ?? ''}${req.path ?? ''}`;
  console.error(`[hoster] ${err.message} (${ablauf})`);
  if (pruefseite) {
    await notifyHosterPruefseite({
      ablauf, shop: err.shop, pfad: err.pfad, httpStatus: err.httpStatus, titel: err.titel, zeit: err.zeit,
    });
  } else {
    const e = err.ergebnisUnklar
      ? { melden: true, grund: 'schreibend' }
      : await zeitueberschreitungPruefen({ schluessel: alarmSchluessel({ shop: err.shop, ablauf }), zeit: err.zeit })
        .catch(() => ({ melden: true, grund: 'fehler' }));
    console.log(`[alarm] Zeitüberschreitung ${e.grund}: ${e.melden ? 'Meldung' : 'noch keine Meldung (erst bei der zweiten in 2 h)'}`);
    if (e.melden) {
      await notifyShopZeitueberschreitung({
        ablauf, shop: err.shop, methode: err.methode, pfad: err.pfad, limitMs: err.limitMs,
        ergebnisUnklar: err.ergebnisUnklar, zeit: err.zeit, vorigeVorMin: e.grund === 'zweite' ? e.abstandMin : undefined,
      });
    }
  }
  if (res.headersSent) return next(err);
  if (pruefseite) return res.status(503).json({ error: err.message, code: HOSTER_PRUEFSEITE_CODE });
  res.status(504).json({ error: err.message, code: SHOP_TIMEOUT_CODE, ergebnisUnklar: err.ergebnisUnklar });
}
