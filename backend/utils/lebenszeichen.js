// FIX3 B4: Wochen-Lebenszeichen der taeglichen Laeufe (Backup, Partner-Sync, Trikot-Sync, FP-Sync).
// Die Zahlen zaehlt der Workflow lebenszeichen-weekly.yml ueber die GitHub-API (.github/scripts/lebenszeichen.mjs);
// hier nur Pruefung und Text. Fehlt ein Lauf: orange. Muster wie das Lebenszeichen des Artikel-Abgleichs (PA6).

export const LEBENSZEICHEN_LAEUFE = ['Backup', 'Partner-Sync', 'Trikot-Sync', 'FP-Sync'];

/** Eingabe pruefen: { laeufe: [{ name, n, soll }] } mit bekannten Namen, ganzen Zahlen 0 <= n <= soll <= 31. */
export function lebenszeichenEingabe(body) {
  const liste = body?.laeufe;
  if (!Array.isArray(liste) || !liste.length) throw Object.assign(new Error('laeufe fehlt.'), { status: 400 });
  return liste.map(l => {
    const name = String(l?.name ?? '');
    const n = Number(l?.n), soll = Number(l?.soll);
    if (!LEBENSZEICHEN_LAEUFE.includes(name)) throw Object.assign(new Error(`Unbekannter Lauf "${name.slice(0, 40)}".`), { status: 400 });
    if (!Number.isInteger(n) || !Number.isInteger(soll) || soll < 1 || soll > 31 || n < 0 || n > soll)
      throw Object.assign(new Error(`Zahlen für ${name} ungültig.`), { status: 400 });
    return { name, n, soll };
  });
}

export function lebenszeichenText(laeufe) {
  const fehlt = laeufe.filter(l => l.n < l.soll);
  const kopf = fehlt.length
    ? `🟠 Wochen-Lebenszeichen: ${fehlt.length} Lauf/Läufe unvollständig`
    : '✅ Wochen-Lebenszeichen: alle Läufe gelaufen';
  const zeilen = laeufe.map(l => `${l.n < l.soll ? '🟠' : '✅'} ${l.name} ${l.n}/${l.soll}${l.n < l.soll ? ` – ${l.soll - l.n} Tag(e) ohne erfolgreichen Lauf` : ''}`);
  return [kopf, ...zeilen, fehlt.length ? 'Bitte GitHub Actions prüfen (Lauf rot, ausgefallen oder deaktiviert).' : ''].filter(Boolean).join('\n');
}
