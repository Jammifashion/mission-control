// FIX3 B1: Chat-Meldung, wenn eine Job-Route mit 5xx endet (bisher war das einzige Signal der rote
// GitHub-Lauf). EINE Stelle fuer alle Laeufe, vor den Routern eingehaengt (index.js) - die Routen melden
// nichts selbst (AL1). Gedrosselt ueber notifyFehler (hoechstens 1 Meldung je Lauf und Stunde und Instanz).
// Ohne Kundendaten: nur Lauf, HTTP-Status und Fehler-Code; Details stehen im Cloud-Run-Log.
// Nicht gemeldet: Hoster-Pruefseite und Shop-Zeitueberschreitung (eigene Meldung, middleware/hosterPruefseite.js)
// und /api/intern (Scheduler-Routen melden selbst, routes/intern.js).
import { notifyFehler } from '../lib/chatNotify.js';
import { HOSTER_PRUEFSEITE_CODE, SHOP_TIMEOUT_CODE } from '../lib/hosterPruefseite.js';

export const JOB_ROUTEN = [
  { pfad: '/api/backup/manual',                       lauf: 'Backup' },
  { pfad: '/api/partner/artikel/abgleich',            lauf: 'Partner-Artikel-Abgleich' },
  { pfad: '/api/partner/verkaeufe/sync-all',          lauf: 'Partner-Sync' },
  { pfad: '/api/festpreis/verkaeufe/sync',            lauf: 'Festpreis-Sync' },
  { pfad: '/api/trikot/sync',                         lauf: 'Trikot-Sync' },
  { pfad: '/api/bestellen/lshop-korb/abgleich',       lauf: 'L-Shop-Korb-Abgleich' },
  { pfad: '/api/bestellen/lshop-belege/abruf',        lauf: 'L-Shop-Belege' },
  { pfad: '/api/bestellen/lshop-lieferbarkeit/abruf', lauf: 'L-Shop-Lieferbarkeit' },
  { pfad: '/api/system/modell-check',                 lauf: 'Modell-Check' },
  { pfad: '/api/dtf/abgleich',                        lauf: 'DTF-Korb-Abgleich' },
];
const EIGENE_MELDUNG = new Set([HOSTER_PRUEFSEITE_CODE, SHOP_TIMEOUT_CODE]);

/** Lauf-Name der Anfrage oder null (nur POST, Pfad ohne Abfrage, ohne Schraegstrich am Ende). */
export function jobFuer(req) {
  if (req.method !== 'POST') return null;
  const pfad = String(req.originalUrl ?? req.url ?? '').split('?')[0].replace(/\/+$/, '');
  return JOB_ROUTEN.find(j => j.pfad === pfad)?.lauf ?? null;
}

/** Text der Meldung - nur Lauf, Status, Code. */
export function jobAlarmText({ status, code }) {
  return `Lauf endete mit HTTP ${status}${code ? ` (${code})` : ''} - Details im Cloud-Run-Log. Shop/Sheets pruefen, Lauf ggf. per Knopf wiederholen.`;
}

export function jobAlarm({ melde = notifyFehler } = {}) {
  return (req, res, next) => {
    const lauf = jobFuer(req);
    if (!lauf) return next();
    const json = res.json.bind(res);
    res.json = body => {
      if (body && typeof body === 'object' && typeof body.code === 'string') res.locals.jobCode = body.code;
      return json(body);
    };
    res.on('finish', () => {
      if (res.statusCode < 500) return;
      const code = res.locals.jobCode;
      if (EIGENE_MELDUNG.has(code)) return;
      Promise.resolve(melde({ art: lauf, status: res.statusCode, text: jobAlarmText({ status: res.statusCode, code }), titel: 'Störung' }))
        .catch(() => {});
    });
    next();
  };
}
