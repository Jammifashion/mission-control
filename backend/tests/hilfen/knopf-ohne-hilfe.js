// Knoepfe ohne Mouse-over (data-hilfe) in index.html finden - fuer knopf-mouseover.test.js (Dauerregel Inhaber 02.11.).
// Kein Test - jest laeuft nur *.test.js.
//
// Erfasst jedes <button ...> im HTML und in den Template-Strings der Skripte. Ein Knopf hat einen Mouse-over, wenn
// er data-hilfe oder data-hilfe-gruppe (ⓘ) traegt. Kennung = id, sonst data-…-Attributname + Knopftext (gekuerzt).

export function knoepfeOhneHilfe(html) {
  const ergebnis = [];
  const re = /<button\b([^>]*)>([\s\S]{0,80}?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const attr = m[1];
    if (/\bdata-hilfe(-gruppe)?=/.test(attr)) continue;
    const id = attr.match(/\bid="([^"]+)"/)?.[1];
    const daten = attr.match(/\b(data-[a-z-]+)=/)?.[1] ?? '';
    const text = m[2].replace(/<[^>]*>/g, '').replace(/\$\{[^}]*\}/g, '…').replace(/\s+/g, ' ').trim().slice(0, 40);
    ergebnis.push(id ? `#${id}` : `${daten}|${text}`);
  }
  return ergebnis;
}
