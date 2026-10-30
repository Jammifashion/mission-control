// Zeilen in ein Google-Sheet schreiben ohne values.append (FM2, Muster des Korbs),
// gemeinsam fuer das Anlage-Skript (anlageHalloween.js) und die L-Shop-Modelle (LS4).

const t = v => String(v ?? '').trim();

/** Letzte belegte Zeile (1-basiert) eines Reiters: letzte Zeile mit irgendeinem Wert. */
export function letzteZeile(werte) {
  for (let i = (werte ?? []).length - 1; i >= 0; i--)
    if ((werte[i] ?? []).some(c => t(c))) return i + 1;
  return 0;
}

// Erste freie Zeile, Nachbarzeile oben und Zielbereich (plus eine Zeile darunter)
// pruefen, values.update RAW, zuruecklesen (UNFORMATTED: Preise und Wahrheitswerte
// kommen sonst formatiert zurueck). Abweichung -> Fehler, der Lauf haelt an.

/** Zellwert fuer den Vergleich: Wahrheitswerte wie Sheets sie zeigen, sonst Text getrimmt. */
export const zellText = v => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v ?? '').trim());

/** Abweichungen zwischen Geschriebenem und Gelesenem: [{ zeile, spalte, soll, ist }] (Index ab 0). */
export function zeilenAbweichungen(soll, ist) {
  const ab = [];
  (soll ?? []).forEach((r, i) => (r ?? []).forEach((w, j) => {
    const a = zellText(w), b = zellText(ist?.[i]?.[j]);
    if (a !== b) ab.push({ zeile: i, spalte: j, soll: a, ist: b });
  }));
  return ab;
}

/** Spaltenbuchstabe zu Index ab 0 (0 -> A, 26 -> AA). */
export function spalteBuchstabe(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const istLeer = rows => !(rows ?? []).some(r => (r ?? []).some(z => zellText(z)));

/**
 * Neue Zeilen unter die letzte belegte Zeile schreiben (kein append).
 * @param {object} [opts]
 * @param {any[][]} [opts.alt]  schon gelesener Reiter (UNFORMATTED); dann gilt GENAU dieser Stand (BO5-1:
 *   der Lager-Bestand wurde daraus geprueft) - hat sich die letzte Zeile seitdem geaendert, wird nichts geschrieben.
 * @returns {Promise<number>} erste geschriebene Zeile (1-basiert)
 */
export async function schreibeNeueZeilen(sheets, spreadsheetId, tab, zeilen, { alt: vorgelesen } = {}) {
  if (!zeilen?.length) return null;
  const q = `'${tab}'`;
  const alt = vorgelesen ?? (await sheets.spreadsheets.values.get({ spreadsheetId, range: q, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const start = Math.max(letzteZeile(alt), 1) + 1;
  const ende = start + zeilen.length - 1;
  const spalte = spalteBuchstabe(Math.max(...zeilen.map(r => r.length), (alt[0] ?? []).length) - 1);
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
  const info = (meta.sheets ?? []).map(s => s.properties).find(p => p.title === tab);
  if (!info) throw new Error(`Reiter ${tab} fehlt – nichts geschrieben.`);
  const raster = info.gridProperties?.rowCount ?? 0;
  if (raster < ende + 1) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
      { appendDimension: { sheetId: info.sheetId, dimension: 'ROWS', length: ende + 1 - raster } },
    ] } });
  }
  const { data: um } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${q}!A${start - 1}:${spalte}${ende + 1}`, valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const umgebung = um.values ?? [];
  if (zeilenAbweichungen([alt[start - 2] ?? []], [umgebung[0] ?? []]).length)
    throw new Error(`${tab}: Zeile ${start - 1} hat sich seit dem Lesen geändert – nichts geschrieben.`);
  if (!istLeer(umgebung.slice(1))) throw new Error(`${tab}: Zielbereich Z${start}–Z${ende + 1} ist nicht leer – nichts geschrieben.`);
  const range = `${q}!A${start}:${spalte}${ende}`;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: zeilen } });
  const { data: zurueck } = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
  const ab = zeilenAbweichungen(zeilen, zurueck.values ?? []);
  if (ab.length) throw new Error(`${tab}: Rücklesen Z${start}–Z${ende} weicht ab (${ab.length} Zellen, erste Z${start + ab[0].zeile} Spalte ${spalteBuchstabe(ab[0].spalte)}).`);
  return start;
}

/**
 * Bestehende Zeile ersetzen (FM2: Struktur_Kategorien Z60, SEO_Hinweis 320). Vorher
 * wird die Zeile frisch gelesen und muss dem erwarteten alten Inhalt gleichen
 * (sonst Fehler, nichts geschrieben); geschrieben werden nur geaenderte Zellen, RAW,
 * danach zurueckgelesen.
 * @returns {Promise<number>} Anzahl geaenderter Zellen (0 = schon so)
 */
export async function ersetzeZeile(sheets, spreadsheetId, tab, zeile, alt, neu) {
  const q = `'${tab}'`;
  const breite = Math.max(alt.length, neu.length);
  const range = `${q}!A${zeile}:${spalteBuchstabe(breite - 1)}${zeile}`;
  const lies = async () => ((await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [[]])[0] ?? [];
  const jetzt = await lies();
  const altVoll = Array.from({ length: breite }, (_, i) => alt[i] ?? '');
  if (zeilenAbweichungen([altVoll], [jetzt]).length) throw new Error(`${tab} Z${zeile} hat sich seit dem Lesen geändert – nichts geschrieben.`);
  const daten = [];
  neu.forEach((w, j) => {
    if (zellText(w) !== zellText(jetzt[j])) daten.push({ range: `${q}!${spalteBuchstabe(j)}${zeile}`, values: [[w]] });
  });
  if (!daten.length) return 0;
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: daten } });
  const zurueck = await lies();
  const ab = zeilenAbweichungen([neu], [zurueck]);
  if (ab.length) throw new Error(`${tab} Z${zeile}: Rücklesen weicht ab (Spalte ${spalteBuchstabe(ab[0].spalte)}).`);
  return daten.length;
}
