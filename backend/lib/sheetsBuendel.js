// Mehrere Reiter in EINEM values.batchGet lesen (PD1, Lehre BK1: Kontingent). Liefert einen Ersatz fuer den
// Sheets-Client, dessen values.get die vorab gelesenen Reiter aus dem Speicher bedient - so laufen die bestehenden
// Rechnungen (Saldo, Kacheln) unveraendert und lesen trotzdem nur einmal. Andere Bereiche gehen an den echten Client.
// Scheitert der Sammelabruf (z. B. ein Reiter fehlt), wird einzeln gelesen wie bisher.

const tabName = range => String(range ?? '').split('!')[0].replace(/^'(.*)'$/, '$1').replace(/''/g, "'");

export async function gebuendelt(sheets, spreadsheetId, tabs) {
  let werte;
  try {
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, ranges: tabs.map(t => `'${t.replace(/'/g, "''")}'!A1:ZZ`),
    });
    werte = new Map(tabs.map((t, i) => [t, data?.valueRanges?.[i]?.values ?? []]));
  } catch {
    return sheets;
  }
  const get = async args => {
    const t = tabName(args?.range);
    if (args?.spreadsheetId === spreadsheetId && werte.has(t) && /!A1:ZZ$/.test(String(args.range))) {
      return { data: { values: werte.get(t).map(r => [...r]) } };   // Kopie: readTab haengt _sheetRow an
    }
    return sheets.spreadsheets.values.get(args);
  };
  return { spreadsheets: { values: { get } } };
}
