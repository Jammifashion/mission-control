// Google-Chat-Benachrichtigungen fuer zwei Ereignisse: neue Kundenanfrage und
// neue Partnerbestellung aus dem Portal.
//
// Grundregel: notify() wirft nie. Eine Benachrichtigung ist Beiwerk - der
// Vorgang, der sie ausloest (Sheet-Zeile schreiben), ist bereits abgeschlossen
// und darf nicht daran scheitern, dass Google nicht erreichbar ist.
//
// Datenschutz: Der Space ist ein zweiter Ablageort fuer personenbezogene Daten.
// Deshalb gehen weder E-Mail-Adressen noch Telefonnummern hinein - auch nicht
// solche, die der Kunde selbst in den Freitext geschrieben hat. Dafuer laeuft
// jeder uebernommene Freitext durch redact().

import { getSecret } from '../utils/secrets.js';

const TIMEOUT_MS = 5000;
const MC_URL     = 'https://jammifashion.github.io/mission-control/';
const LINK       = `<${MC_URL}|→ Mission Control öffnen>`;

// Nur einmal warnen, danach still - sonst flutet jede Anfrage das Log.
let fehlendGemeldet = false;

// ── Textaufbereitung ────────────────────────────────────────────────────────

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/giu;
// Kandidat fuer eine Telefonnummer: Ziffernfolge mit Trennzeichen. Ob es
// wirklich eine ist, entscheidet erst die Ziffernzahl in der Ersetzung -
// sonst faengt das Muster auch "20.10." oder "128,40" ein.
const TEL_RE = /(?:\+|00)?\d[\d\s/().-]{5,}\d/g;

export function redact(text) {
  let out = String(text ?? '').replace(EMAIL_RE, '[E-Mail entfernt]');
  out = out.replace(TEL_RE, treffer =>
    treffer.replace(/\D/g, '').length >= 7 ? '[Telefon entfernt]' : treffer,
  );
  return out;
}

// Auf Handy-Laenge kuerzen. Zeilenumbrueche fallen weg, damit eine Nachricht
// nicht durch Kundentext aufgerissen wird.
export function kuerze(text, max = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

// Freitext fuer den Space: erst saeubern, dann kuerzen. Reihenfolge ist
// wichtig - ein zuerst gekuerzter Text kann eine halbe Adresse hinterlassen,
// die das E-Mail-Muster nicht mehr erkennt.
function sauber(text, max = 120) {
  return kuerze(redact(text), max);
}

function euro(betrag) {
  const n = typeof betrag === 'number' ? betrag : parseFloat(String(betrag ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// ── Nachrichtenbau ──────────────────────────────────────────────────────────

export function buildAnfrageNachricht({ anfrageId, kundeName, menge, beschreibung }) {
  const name  = sauber(kundeName, 60);
  const m     = String(menge ?? '').trim();
  const mStr  = m ? (/^\d+$/.test(m) ? `${m} Stück` : sauber(m, 30)) : '';
  const zeile2 = [name, mStr].filter(Boolean).join(' · ');
  const zitat  = sauber(beschreibung, 120);

  return [
    `🟢 Neue Anfrage · ${anfrageId}`,
    zeile2,
    zitat ? `"${zitat}"` : '',
    LINK,
  ].filter(Boolean).join('\n');
}

// summe ist optional: Portal-Eigenauftraege haben zum Zeitpunkt der Anlage
// bewusst noch keinen Preis, der wird spaeter vom Admin gepflegt.
export function buildPartnerNachricht({ partnerName, anzahl, summe }) {
  const teile = [];
  const n = Number(anzahl);
  if (Number.isFinite(n) && n > 0) teile.push(`${n} Artikel`);
  const betrag = euro(summe);
  if (betrag) teile.push(`${betrag} netto`);

  return [
    `📦 Partnerbestellung · ${sauber(partnerName, 60) || '—'}`,
    teile.join(' · '),
    LINK,
  ].filter(Boolean).join('\n');
}

// ── Versand ─────────────────────────────────────────────────────────────────

/**
 * Postet text als einfache Chat-Nachricht in den konfigurierten Space.
 * Wirft nie. Rueckgabe sagt nur, ob es geklappt hat - Aufrufer duerfen sie
 * ignorieren und tun das in der Regel auch.
 */
export async function notify(text) {
  let url = '';
  try {
    url = String((await getSecret('GCHAT_WEBHOOK_URL')) ?? '').trim();
  } catch (err) {
    console.error('[chatNotify] GCHAT_WEBHOOK_URL nicht lesbar:', err?.message ?? err);
    return false;
  }

  // Ein lokaler Platzhalter wie "unused" zaehlt als nicht konfiguriert - sonst
  // erzeugt jeder Aufruf in der Entwicklung einen Fetch-Fehler im Log.
  if (!url.startsWith('https://')) {
    if (!fehlendGemeldet) {
      fehlendGemeldet = true;
      console.warn('[chatNotify] GCHAT_WEBHOOK_URL fehlt oder ist leer – Chat-Benachrichtigungen sind aus.');
    }
    return false;
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body:    JSON.stringify({ text }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[chatNotify] Google Chat antwortete mit HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chatNotify] Zustellung fehlgeschlagen:', err?.message ?? err);
    return false;
  }
}

// Nur fuer Tests: den Einmal-Warnhinweis zuruecksetzen.
export function _resetWarnung() {
  fehlendGemeldet = false;
}
