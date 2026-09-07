// Gemeinsame JSON-Aufbereitung fuer LLM-Antworten.
//
// Genutzt von routes/claude.js (Gemini) und lib/chatCore.js (Chat-Agent).
// Seit dem Wegfall des Assistant-Prefills in chatCore ist die Antwort dort
// nicht mehr garantiert ein nacktes JSON-Objekt, deshalb liegen beide
// Hilfsfunktionen zentral.

// Gemini gibt gelegentlich rohe Steuerzeichen (echte \n, \r, \t) innerhalb von
// JSON-String-Werten zurück statt sie zu escapen – JSON.parse bricht dann mit
// "Bad control character in string literal" ab. Diese Funktion läuft den Text
// zeichenweise durch, erkennt anhand unescapter " ob sie sich gerade innerhalb
// eines String-Literals befindet, und escapt Steuerzeichen NUR dort – das
// JSON-Grundgerüst (Klammern, Kommas etc.) bleibt unangetastet.
export function sanitizeJsonControlChars(str) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        result += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        result += ch;
        inString = false;
        continue;
      }
      const code = str.charCodeAt(i);
      if (code < 0x20) {
        if (ch === '\n') result += '\\n';
        else if (ch === '\r') result += '\\r';
        else if (ch === '\t') result += '\\t';
        else result += '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      result += ch;
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }
  return result;
}

// Markdown-Zaun um eine Antwort abstreifen: ```json ... ``` oder ``` ... ```.
// Modelle liefern den trotz gegenteiliger Anweisung gelegentlich. Seit dem
// Wegfall des Prefills ist das der wahrscheinlichste Grund fuer ein
// fehlschlagendes JSON.parse.
export function stripCodeFence(text) {
  let s = String(text ?? '').trim();
  if (!s.startsWith('```')) return s;
  s = s.replace(/^```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n?/, '');
  s = s.replace(/\r?\n?[ \t]*```[ \t]*$/, '');
  return s.trim();
}
