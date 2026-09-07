// Gemeinsame Aufbereitung von LLM-Antworten.
//
// Genutzt von routes/claude.js und lib/chatCore.js.

// Text aus einer Anthropic-Antwort einsammeln.
//
// claude-sonnet-5 stellt der Antwort je nach Aufgabe einen thinking-Block
// voran; content[0].text ist dann undefined und die Antwort scheinbar leer.
// Das haengt nicht an der Prompt-Laenge, sondern daran, wie das Modell die
// Aufgabe einschaetzt - dieselbe Route kann mal mit und mal ohne
// thinking-Block antworten. Deshalb nie content[0] nehmen, sondern alle
// text-Bloecke einsammeln.
export function collectText(response) {
  return (response?.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('');
}

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
