// AL2: Meldung einer LESENDEN Shop-Zeitueberschreitung erst bei der zweiten innerhalb von 2 h (je Shop + Ablauf).
// Reine Logik; Lesen/Schreiben des Reiters in lib/alarmStand.js. Schreibende Zugriffe (Ergebnis unklar) und die
// Hoster-Pruefseite melden weiter sofort. Der Stand liegt im Sheet, weil Cloud Run fast jede Stunde eine neue
// Instanz startet - ein Zaehler im Speicher waere beim naechsten Lauf weg.

export const TAB_ALARM = 'Alarm_Stand';
export const KOPF_ALARM = ['Schluessel', 'Letzte_Zeitueberschreitung', 'Stand'];
export const FENSTER_MS = 2 * 60 * 60 * 1000;

/** Schluessel je Ablauf: Shop + Methode/Pfad der Route (ohne Query). Keine Personendaten. */
export function alarmSchluessel({ shop, ablauf } = {}) {
  return `${String(shop || '?').trim()}|${String(ablauf || '?').replace(/\?.*$/, '').trim()}`.slice(0, 200);
}

/**
 * @param {string} vorher  ISO-Zeit der letzten Zeitueberschreitung dieses Schluessels ('' = keine)
 * @param {number} jetzt   ms
 * @returns {{ melden: boolean, grund: 'erste'|'zweite', abstandMin?: number }}
 */
export function alarmEntscheidung(vorher, jetzt, fenster = FENSTER_MS) {
  const t = Date.parse(String(vorher ?? ''));
  if (!Number.isFinite(t)) return { melden: false, grund: 'erste' };
  const abstand = jetzt - t;
  if (abstand >= 0 && abstand < fenster) return { melden: true, grund: 'zweite', abstandMin: Math.round(abstand / 60000) };
  return { melden: false, grund: 'erste' };
}
