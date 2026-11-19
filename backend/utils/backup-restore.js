// FIX3: Backup-Rueckweg - reine Logik fuer scripts/restore-backup.js (kein Zugriff).
// Das Backup (backup-daily.js) speichert die ANGEZEIGTEN Werte als Text. Beim Zurueckspielen gibt es drei Fallen:
//   zahl_text      jede angezeigte Zahl ("12", "1.234,50", "12,5", "19 %", "4,90 €") - RAW bleibt Text (Summen zaehlen sie
//                  nicht mit), USER_ENTERED rechnet je Locale; Nummern, die Text bleiben sollen (ArticleNr), zaehlen mit
//   fuehrende_null Nummer mit fuehrender Null ("03581", L-Shop-Nummern, PLZ) - USER_ENTERED macht 3581 daraus
//   datum          Datum/Zeit als Text ("01.10.2026", "2026-10-01", "3-4") - USER_ENTERED macht Datumswerte daraus

const t = v => String(v ?? '');
const ZAHL_DE = /^-?\d{1,3}(\.\d{3})*(,\d+)?(\s?(%|€))?$|^-?\d+(,\d+)?(\s?(%|€))?$/;
const FUEHRENDE_NULL = /^0\d+$/;
const DATUM = /^\d{1,2}\.\d{1,2}\.\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$|^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$|^\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/;

/** Falle einer Zelle oder null. */
export function falle(wert) {
  const s = t(wert).trim();
  if (!s) return null;
  if (FUEHRENDE_NULL.test(s)) return 'fuehrende_null';
  if (DATUM.test(s)) return 'datum';
  if (ZAHL_DE.test(s)) return 'zahl_text';
  return null;
}

/** Ueberblick eines Backups: je Reiter Zeilen, Zellen und Fallen (mit je hoechstens 3 Beispiel-Adressen, keine Werte). */
export function analyse(payload) {
  const tabs = payload?.tabs ?? {};
  return Object.entries(tabs).map(([titel, zeilen]) => {
    const fallen = { zahl_text: 0, fuehrende_null: 0, datum: 0 };
    const beispiele = { zahl_text: [], fuehrende_null: [], datum: [] };
    let zellen = 0;
    (zeilen ?? []).forEach((r, i) => (r ?? []).forEach((w, j) => {
      if (t(w) === '') return;
      zellen++;
      const f = falle(w);
      if (!f) return;
      fallen[f]++;
      if (beispiele[f].length < 3) beispiele[f].push(`${spalte(j)}${i + 1}`);
    }));
    return { titel, zeilen: (zeilen ?? []).length, zellen, fallen, beispiele };
  });
}

export function spalte(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Soll (Backup) gegen Ist (zurueckgelesen, FORMATTED_VALUE) vergleichen.
 * -> { gleich, abweichungen: { zahl_text, fuehrende_null, datum, sonst }, beispiele: [Adressen] }
 */
export function vergleiche(soll, ist) {
  const ab = { zahl_text: 0, fuehrende_null: 0, datum: 0, sonst: 0 };
  const beispiele = [];
  let gleich = 0;
  const zeilen = Math.max((soll ?? []).length, (ist ?? []).length);
  for (let i = 0; i < zeilen; i++) {
    const a = soll?.[i] ?? [], b = ist?.[i] ?? [];
    const breite = Math.max(a.length, b.length);
    for (let j = 0; j < breite; j++) {
      const x = t(a[j]), y = t(b[j]);
      if (x === '' && y === '') continue;
      if (x === y) { gleich++; continue; }
      ab[falle(x) ?? 'sonst']++;
      if (beispiele.length < 10) beispiele.push(`${spalte(j)}${i + 1}`);
    }
  }
  return { gleich, abweichungen: ab, beispiele };
}

/** Darf in dieses Sheet geschrieben werden? Nie in eines der Original-Sheets, nur leer. */
export function zielPruefen({ zielId, originale, reiter }) {
  if (!t(zielId).trim()) return 'Ziel-Sheet fehlt (--ziel <Sheet-ID>).';
  if ((originale ?? []).filter(Boolean).includes(zielId)) return 'Ziel ist ein Original-Sheet von MC - verweigert.';
  const mitDaten = (reiter ?? []).filter(r => r.zellen > 0);
  if (mitDaten.length) return `Ziel-Sheet ist nicht leer (${mitDaten.map(r => r.titel).join(', ')}) - nur in ein neues, leeres Sheet.`;
  return null;
}
