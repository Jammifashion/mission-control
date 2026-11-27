// Kundenchat "Jey": Nachrichten fuers Modell und Gespraechsverlauf (KA2). Reine Logik; Lesen/Schreiben in lib/anfrageVerlauf.js.
// Teil A: das Modell bekommt nur die letzten MAX_MODELL Nachrichten, die Seite schickt hoechstens MAX_VERLAUF - kein 400 mehr
// bei langen Gespraechen. Teil B (Satz freigegeben 27.11.): der Verlauf wird NUR beim Abschluss gespeichert, im eigenen Reiter,
// geloescht 12 Monate nach der Anfrage (Loeschlauf) und bei DSGVO. Nie in Log, Chat-Meldung, Postfach.

export const TAB_VERLAUF = 'Kundenanfragen_Verlauf';
export const VERLAUF_SPALTEN = ['Anfrage-ID', 'Zeitpunkt', 'Nachrichten'];

export const MAX_MODELL = 20;       // ans Modell (plus Systemprompt)
export const MAX_VERLAUF = 60;      // von der Seite und im Reiter
export const MAX_ROH = 1000;        // mehr Eintraege im Body = Missbrauch -> 400
export const MAX_TEXT_KUNDE = 500;  // je Kunden-Nachricht (wie bisher)
export const MAX_TEXT_JEY = 2000;   // je Antwort im Verlauf
export const MAX_ZELLE = 45000;     // Google-Zelle hat 50.000 Zeichen
export const INIT = '__init__';     // Startsignal der Seite, kein Kundentext

/**
 * Body.messages -> gueltige Nachrichten (Rolle user|assistant, Text gekappt), hoechstens die letzten MAX_VERLAUF.
 * @returns {null | { role, content }[]}  null = kein Array oder Missbrauch (Route antwortet 400)
 */
export function nachrichtenAus(roh) {
  if (!Array.isArray(roh) || roh.length > MAX_ROH) return null;
  return roh
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? MAX_TEXT_KUNDE : MAX_TEXT_JEY) }))
    .slice(-MAX_VERLAUF);
}

/** Die letzten MAX_MODELL Nachrichten, beginnend mit einer Kunden-Nachricht (die API verlangt user zuerst). */
export function fuerModell(nachrichten) {
  const teil = (nachrichten ?? []).slice(-MAX_MODELL);
  const start = teil.findIndex(m => m.role === 'user');
  return start < 0 ? [] : teil.slice(start);
}

/**
 * Verlauf zum Speichern: ohne Startsignal, mit der Abschluss-Antwort, als { r: 'kunde'|'jey', t } (kurz, spart Zellplatz).
 * Passt das JSON nicht in eine Zelle, fallen die aeltesten Nachrichten weg.
 * @returns {string} JSON
 */
export function verlaufFuerSpeicher(nachrichten, antwort) {
  const liste = [...(nachrichten ?? []), ...(antwort ? [{ role: 'assistant', content: String(antwort) }] : [])]
    .filter(m => !(m.role === 'user' && m.content === INIT))
    .map(m => ({ r: m.role === 'user' ? 'kunde' : 'jey', t: String(m.content).slice(0, m.role === 'user' ? MAX_TEXT_KUNDE : MAX_TEXT_JEY) }))
    .slice(-MAX_VERLAUF);
  let json = JSON.stringify(liste);
  while (json.length > MAX_ZELLE && liste.length > 1) { liste.shift(); json = JSON.stringify(liste); }
  return json;
}

/** Gespeicherte Zelle -> [{ von: 'kunde'|'jey', text }] oder null (leer/geloescht/kaputt). */
export function verlaufLesen(zelle) {
  const s = String(zelle ?? '').trim();
  if (!s) return null;
  try {
    const liste = JSON.parse(s);
    if (!Array.isArray(liste)) return null;
    return liste.filter(x => x && (x.r === 'kunde' || x.r === 'jey') && typeof x.t === 'string').map(x => ({ von: x.r, text: x.t }));
  } catch { return null; }
}

/**
 * Antwort fuer den Anfrage-Dialog: { status: 'da' | 'geloescht' | 'keiner', zeitpunkt, nachrichten }.
 * geloescht = Zeile da, Nachrichten geleert (Loeschlauf/DSGVO).
 */
export function verlaufFuerAnfrage(werte, anfrageId) {
  const [kopf = [], ...rows] = werte ?? [];
  const iId = kopf.indexOf('Anfrage-ID'), iZ = kopf.indexOf('Zeitpunkt'), iN = kopf.indexOf('Nachrichten');
  if (iId < 0 || iN < 0) return { status: 'keiner' };
  const zeilen = rows.filter(r => String(r?.[iId] ?? '').trim() === anfrageId);
  if (!zeilen.length) return { status: 'keiner' };
  const r = zeilen[zeilen.length - 1];
  const nachrichten = verlaufLesen(r[iN]);
  return nachrichten ? { status: 'da', zeitpunkt: String(r[iZ] ?? ''), nachrichten } : { status: 'geloescht', zeitpunkt: String(r[iZ] ?? '') };
}
