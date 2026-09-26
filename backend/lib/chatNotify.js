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
let formGeprueft    = false;

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

// Befehl PA2: Meldung nach dem taeglichen Partnerartikel-Abgleich
// (lib/partnerArtikel.js). Nur Partner-IDs und Artikelnamen, keine Betraege.
// null = nichts Neues und nichts Offenes -> keine Nachricht.
const ABGLEICH_NAMEN_MAX = 5;
export function buildArtikelAbgleichNachricht({ partner } = {}) {
  const zeilen = [];
  for (const e of partner ?? []) {
    const teile = [];
    const neu = e.neu ?? [];
    if (neu.length) {
      const namen = neu.slice(0, ABGLEICH_NAMEN_MAX).map(n => `${sauber(n.name, 60) || n.produktId}${n.entwurf ? ' (Entwurf)' : ''}`);
      const rest = neu.length - namen.length;
      teile.push(`${neu.length} neu: ${namen.join(', ')}${rest > 0 ? ` +${rest} weitere` : ''}`);
    }
    if (e.ekFehlt)           teile.push(`EK fehlt ${e.ekFehlt}`);
    if (e.druckFehlt)        teile.push(`Druck fehlt ${e.druckFehlt}`);
    if (e.farbenVerschieden) teile.push(`Farben mit verschiedenem EK ${e.farbenVerschieden}`);
    if (e.vertragAbLeer)     teile.push('Vertrag-ab leer');
    if (e.gesperrt)          teile.push(`${e.gesperrt} Verkaufszeile(n) gesperrt`);
    if (e.fehler)            teile.push(`Fehler: ${sauber(e.fehler, 80)}`);
    if (teile.length) zeilen.push(`${sauber(e.id, 12)}: ${teile.join(' · ')}`);
  }
  if (!zeilen.length) return null;
  return ['🧾 Partnerartikel-Abgleich', ...zeilen, LINK].join('\n');
}

// PA6: Wochen-Lebenszeichen, wenn der Abgleich montags nichts zu melden hat -
// sonst ist "keine Nachricht" nicht von "Lauf kaputt" zu unterscheiden.
export function buildAbgleichLebenszeichen(anzahlPartner) {
  const n = Number(anzahlPartner);
  return `Partner-Abgleich: nichts Neues (${Number.isFinite(n) ? n : 0} Partner geprüft)`;
}

// ── Stoerungsalarm ──────────────────────────────────────────────────────────
//
// Der Kundenchat ist der einzige Kanal, bei dem ein Ausfall niemandem auffaellt:
// der Kunde geht weg, es bleibt keine Zeile im Sheet. Der 502 durch die
// fehlende JSON-Huelle lief so drei Wochen unbemerkt. Deshalb meldet sich der
// Chat jetzt selbst, wenn er klemmt.
//
// Gedrosselt auf eine Meldung je Fehlerart und Stunde: bei einer Stoerung
// laufen sonst 20 Requests pro Viertelstunde in denselben Alarm. Der Speicher
// ist prozesslokal - bei zwei Cloud-Run-Instanzen koennen also zwei Meldungen
// derselben Art kommen. Das ist gewollt einfach; ein gemeinsamer Zustand waere
// hier mehr Aufwand als Nutzen.

const ALARM_TTL_MS = 60 * 60 * 1000;
const letzterAlarm = new Map(); // art → Zeitstempel

export function buildFehlerNachricht({ art, status, text }) {
  return [
    `🔴 Chat-Stoerung · ${art}`,
    status ? `HTTP ${status}` : '',
    // sauber() = redact() + kuerzen. Der Text kommt aus Fehlermeldungen, nicht
    // aus Kundeneingaben - die Redaktion ist die zweite Sicherung.
    text ? sauber(text, 200) : '',
    LINK,
  ].filter(Boolean).join('\n');
}

/**
 * Meldet eine Stoerung, hoechstens einmal je Art und Stunde.
 * Rueckgabe: true wenn gesendet, false wenn gedrosselt oder nicht zustellbar.
 * Wirft nie - ein fehlgeschlagener Alarm darf den Fehlerweg nicht kapern.
 */
export async function notifyFehler({ art, status, text }) {
  try {
    const jetzt   = Date.now();
    const zuletzt = letzterAlarm.get(art);
    if (zuletzt !== undefined && jetzt - zuletzt < ALARM_TTL_MS) return false;

    // Zeitstempel VOR dem Senden setzen: sonst laufen bei einem haengenden
    // Webhook alle parallelen Requests in denselben Alarm.
    letzterAlarm.set(art, jetzt);
    return await notify(buildFehlerNachricht({ art, status, text }));
  } catch (err) {
    console.error('[chatNotify] Alarm fehlgeschlagen:', err?.message ?? err);
    return false;
  }
}

// Welche Statuscodes einen Alarm wert sind: ausschliesslich 5xx.
//
// Jeder 4xx sagt etwas ueber den Aufrufer, nicht ueber uns - Honeypot,
// zu lange Nachrichtenliste, fehlender oder abgelehnter Turnstile-Token,
// abgelaufene Sitzung, Rate-Limit. Davon kommen im Betrieb dauernd welche,
// und jede einzelne waere ein Fehlalarm.
//
// Damit das traegt, darf kein Upstream-Fehler seinen Status durchreichen:
// ein Ausfall der Anthropic-API kam als 400 beim Browser an und waere hier
// unsichtbar. callChatAgent bildet solche Fehler deshalb auf 502 ab.
export function alarmWuerdig(status) {
  return status >= 500;
}

// Nur fuer Tests: Drosselung zuruecksetzen.
export function _resetAlarme() {
  letzterAlarm.clear();
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

  // Ueber new URL() statt roh: das raeumt eingebettete Steuerzeichen weg und
  // ist die einzige Stelle, an der Parameter jemals angehaengt wuerden - dann
  // ueber searchParams, nie per String-Verkettung.
  let ziel;
  try {
    ziel = new URL(url);
  } catch {
    console.error('[chatNotify] Webhook-URL unvollständig: kein gültiges URL-Format');
    return false;
  }
  pruefeForm(url, ziel);

  try {
    const res = await fetch(ziel.toString(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body:    JSON.stringify({ text }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Der Antworttext traegt die eigentliche Begruendung: 404 heisst
      // Webhook geloescht oder rotiert, 403 fehlende Rechte im Space, 400
      // Payload. Ohne ihn steht im Log nur eine Zahl, und man raet.
      // Durch sauber(): redact() gegen Personendaten, die Google in einer
      // Fehlerantwort zitieren koennte, plus Kuerzung auf 300 Zeichen.
      let detail;
      try {
        detail = sauber(await res.text(), 300) || '(leere Antwort)';
      } catch {
        detail = '(Antworttext nicht lesbar)';
      }
      console.error(`[chatNotify] Google Chat antwortete mit HTTP ${res.status}: ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chatNotify] Zustellung fehlgeschlagen:', err?.message ?? err);
    return false;
  }
}

// Nur fuer Tests: die Einmal-Hinweise zuruecksetzen.
export function _resetWarnung() {
  fehlendGemeldet = false;
  formGeprueft    = false;
}

// Einmalige Formpruefung der Webhook-URL.
//
// Anlass: Google antwortete mit 400 "Missing or malformed token", waehrend
// dieselbe URL per PowerShell 200 lieferte. chatNotify veraendert die URL
// nicht - der gespeicherte Wert muss sich also vom erwarteten unterscheiden.
// Der haeufigste Fall ist ein HTML-escaptes &amp; statt &: der zweite
// Parameter heisst dann "amp;token", und Google sieht kein Token.
//
// Geprueft wird nur die FORM. Der Wert selbst wird nie ausgegeben - er ist das
// Geheimnis.
// Nicht-ASCII-Zeichen als Codepunkte benennen. Eine Webhook-URL ist reines
// ASCII; alles andere ist eine Anomalie und meist der Grund, warum derselbe
// Wert von Hand kopiert funktioniert und aus dem Secret nicht: ein "…"
// (U+2026) aus einer abgeschnittenen Anzeige, ein geschuetztes Leerzeichen
// (U+00A0) aus einem Dokument, ein Soft Hyphen (U+00AD).
function nichtAscii(roh) {
  const codes = new Set();
  for (const z of roh) {
    const cp = z.codePointAt(0);
    if (cp > 0x7f) codes.add('U+' + cp.toString(16).toUpperCase().padStart(4, '0'));
  }
  return [...codes];
}

function pruefeForm(roh, u) {
  if (formGeprueft) return;
  formGeprueft = true;

  // ── Fingerabdruck ─────────────────────────────────────────────────────────
  // Genug, um den geladenen Wert mit dem erwarteten zu vergleichen, ohne ihn
  // preiszugeben. Vom Token gehen die letzten vier Zeichen mit - sie
  // identifizieren die Version, verraten aber nichts Brauchbares. Bei einem
  // auffaellig kurzen Token entfaellt auch das, weil vier Zeichen dort ein
  // grosser Anteil waeren.
  const key   = u.searchParams.get('key')   ?? '';
  const token = u.searchParams.get('token') ?? '';
  const tokenEnde = token.length > 8 ? token.slice(-4) : '(zu kurz, nicht gezeigt)';
  const fremd = nichtAscii(roh);

  console.log(
    `[chatNotify] Webhook-Fingerabdruck: Laenge ${roh.length}, Host ${u.hostname}, `
    + `key ${key.length} Zeichen, token ${token.length} Zeichen (endet auf ${tokenEnde}), `
    + `Nicht-ASCII: ${fremd.length ? `${fremd.length} verschieden (${fremd.slice(0, 5).join(', ')})` : 'keine'}`,
  );

  const maengel = [];
  if (u.hostname !== 'chat.googleapis.com') {
    maengel.push(`Host ist "${u.hostname}", erwartet "chat.googleapis.com"`);
  }
  if (!u.searchParams.get('key'))   maengel.push('Parameter key fehlt');
  if (!u.searchParams.get('token')) maengel.push('Parameter token fehlt');
  // Konkreter Hinweis statt Raetselraten.
  if (roh.includes('&amp;')) {
    maengel.push('URL enthaelt "&amp;" statt "&" (HTML-escaped kopiert?)');
  }
  if (/[\r\n\t]/.test(roh)) {
    maengel.push('URL enthaelt einen Zeilenumbruch oder Tabulator');
  }
  if (fremd.length) {
    maengel.push(`URL enthaelt Nicht-ASCII-Zeichen (${fremd.slice(0, 5).join(', ')})`);
  }

  if (maengel.length) {
    console.error(`[chatNotify] Webhook-URL unvollständig: ${maengel.join('; ')}`);
  }
}
