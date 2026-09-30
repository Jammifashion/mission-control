// Fehlerausgabe der Workflows: HTTP-Code plus Fehlertext der Antwort, damit im Actions-Log
// steht, WAS schiefging. Das Log ist oeffentlich: Text wird maskiert und auf 300 Zeichen
// gekuerzt. Maskiert werden
//   - URLs und Mailadressen,
//   - Ziffernfolgen ab 6 Stellen,
//   - ID-artige Teile: Kennungen wie P-001, FP-001, JFN-2026-0247, gla_21173 und
//     Zahlen direkt hinter ID/Nr/Bestellung/Order/Produkt/Partner,
//   - lange undurchsichtige Zeichenketten (ab 25 Zeichen mit Buchstaben und Ziffern:
//     Sheet-/Drive-IDs, Tokens).
// Die Logik lebt nur hier; backend/tests/antwort-fehler.test.js prueft sie.
import { readFileSync } from 'fs';

export const MAX_ZEICHEN = 300;
const M = '…';

export function maskiere(text) {
  let s = String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<mail>')
    .replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{25,}\b/g, M)
    .replace(/\b[A-Za-z]{1,6}(?:[-_~][A-Za-z0-9]{1,6})*[-_~]\d{2,}(?:-\d+)*\b/g, M)
    .replace(/\b(ID|Id|id|Nr\.?|Nummer|Bestellung|Order|Produkt|Partner)(\W{0,3})\d{3,}\b/g, `$1$2${M}`)
    .replace(/\d{6,}/g, M);
  return s;
}

export function kuerze(text, max = MAX_ZEICHEN) {
  return text.length <= max ? text : text.slice(0, max - 11).trimEnd() + ' [gekuerzt]';
}

/** Eine Zeile fuers Log: "Antwort (HTTP 500): <Text>". JSON mit .error -> dessen Text, sonst Rohtext. */
export function fehlerZeile(http, body) {
  let roh = String(body ?? '');
  try {
    const j = JSON.parse(roh);
    if (j && typeof j.error === 'string') roh = j.error;
    else if (j && j.error != null) roh = JSON.stringify(j.error);
  } catch { /* kein JSON: Rohtext */ }
  const text = kuerze(maskiere(roh));
  return `Antwort (HTTP ${http || '?'}): ${text || '(leer)'}`;
}

// Aufruf im Workflow: node .github/scripts/antwort-fehler.mjs response.json "$http"
if (process.argv[1]?.endsWith('antwort-fehler.mjs')) {
  const [, , datei, http] = process.argv;
  let body = '';
  try { body = readFileSync(datei, 'utf8'); } catch { /* keine Antwortdatei */ }
  console.log(fehlerZeile(http, body));
}
