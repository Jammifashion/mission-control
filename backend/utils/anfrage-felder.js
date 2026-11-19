// Kundenanfragen: erlaubte Werte und Feldgrenzen, gemeinsam fuer Kundenchat
// (routes/anfragen-chat.js, lib/chatCore.js) und Admin (routes/anfragen.js).

export const KANAL_VALUES = ['Homepage', 'E-Mail', 'Manuell'];

// Formularstand des Kundenchats: nur diese Felder, nur Text, hoechstens so lang.
// Dieselben Grenzen gelten beim Schreiben ins Sheet.
export const SESSION_LAENGEN = {
  produktBeschreibung: 500,
  menge:               100,
  varianten:           200,
  partnerId:           20,
  kundeName:           100,
  kundeEmail:          200,
  preisvorschlag:      10,
  anmerkungenKunde:    500,
};
export const STEP_MAX = 20;

const textWert = (v, max) => String(v ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);

// Bereinigt einen Formularstand (vom Browser oder vom Modell).
// Unbekannte Felder fallen weg, Werte werden Text mit Laengengrenze,
// partnerId/preisvorschlag nur aus erlaubten Zeichen, kanal immer 'Homepage'.
export function bereinigeSessionData(roh) {
  const quelle = roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {};
  const aus = { kanal: 'Homepage' };
  for (const [feld, max] of Object.entries(SESSION_LAENGEN)) {
    const v = quelle[feld];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    let s = textWert(v, 1000);
    if (feld === 'partnerId')      s = s.replace(/[^A-Za-z0-9-]/g, '');
    if (feld === 'preisvorschlag') s = s.replace(/[^0-9.,]/g, '');
    s = s.slice(0, max);
    if (s !== '') aus[feld] = s;
  }
  const step = Number(quelle.step);
  if (Number.isInteger(step) && step >= 0 && step <= STEP_MAX) aus.step = step;
  return aus;
}

// Kanal nur aus der festen Liste, sonst der Ersatzwert.
export function kanalAusListe(kanal, ersatz) {
  return KANAL_VALUES.includes(kanal) ? kanal : ersatz;
}

// Preisvorschlag als Zahl, wenn er eindeutig eine ist ("580", "580,50"), sonst Text.
export function preisZelle(s) {
  const t = String(s ?? '').trim();
  if (/^\d{1,7}([.,]\d{1,2})?$/.test(t)) return Number(t.replace(',', '.'));
  return t;
}
