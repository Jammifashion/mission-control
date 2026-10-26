// L-Shop-FTP, SCHREIBEN (BO4c): genau eine Bestelldatei nach ORDER. Die einzige Stelle, die hochlaedt
// (Test lshop-ftp-senden.test.js prueft den Quelltext); lib/lshopFtp.js bleibt nur lesend.
//
// Jede XML in ORDER ist eine echte Bestellung - L-Shop holt nach hoechstens ~8 min ab, es gibt keinen
// Testordner. Deshalb: nur ORDER, nur Namen <order_id>_<JJJJMMTT-HHMM>.xml, hoechstens 1 MB, eine
// Verbindung, genau EIN Upload, nie loeschen, umbenennen, Ordner anlegen oder wiederholen.
//
// Ablauf: ORDER listen (liegt der Name oder dieselbe order_id schon da -> nicht senden, "unklar") ->
// hochladen -> ORDER neu listen, Name + Groesse pruefen. Ergebnis:
//   liegt     Server hat bestaetigt (2xx), Datei liegt mit richtiger Groesse
//   abgeholt  Server hat bestaetigt, Datei schon weg (L-Shop hat sie sofort geholt)
//   nicht-da  Fehler SICHER vor Beginn der Uebertragung: Zugang, Anmeldung, erste Liste, oder der Server
//             hat mit einem Fehlercode (>= 400) abgelehnt, bevor die Datei gelesen wurde
//   unklar    alles andere: Abbruch/Zeitlimit nach Beginn der Uebertragung, keine Bestaetigung, zweite
//             Liste geht nicht, falsche Groesse, Datei mit derselben order_id liegt schon da
// "Vor Beginn" erkennt der Lesezaehler der Quelle: basic-ftp (6.x, dist/transfer.js uploadFrom) liest die
// Quelle erst nach der Antwort 150/125 des Servers, also erst, wenn die Uebertragung beginnt.
// Fehlertexte ohne Host, IP, Benutzer, Passwort (gleiche Bereinigung wie das Lesemodul).

import { Readable } from 'stream';
import { Client } from 'basic-ftp';
import { zugang, ohneZugang, LShopFtpFehler, BEFEHL_ZEITLIMIT_MS } from './lshopFtp.js';

export const SENDE_ORDNER = 'ORDER';
export const MAX_BESTELL_BYTES = 1024 * 1024;
export const SENDE_NAME = /^(JFN-\d{4}-\d{4})_\d{8}-\d{4}\.xml$/;
export const SENDE_ERGEBNIS = { LIEGT: 'liegt', ABGEHOLT: 'abgeholt', NICHT_DA: 'nicht-da', UNKLAR: 'unklar' };

const abgelehnt = err => typeof err?.code === 'number' && err.code >= 400;

/**
 * Eine Bestelldatei nach ORDER hochladen.
 * @param {{ dateiname: string, inhalt: Buffer, clientFabrik?: () => any }} o  clientFabrik nur fuer Tests
 * @returns {Promise<{ ergebnis: string, groesse: number|null, hinweis: string }>}  wirft nie wegen FTP
 */
export async function sendeBestellung({ dateiname, inhalt, clientFabrik } = {}) {
  const name = String(dateiname ?? '');
  const m = SENDE_NAME.exec(name);
  if (!m) throw new LShopFtpFehler('Ungültiger Dateiname für ORDER.');
  if (!Buffer.isBuffer(inhalt) || !inhalt.length) throw new LShopFtpFehler('Bestelldatei ist leer.');
  if (inhalt.length > MAX_BESTELL_BYTES) throw new LShopFtpFehler(`Bestelldatei ist größer als ${MAX_BESTELL_BYTES} Bytes.`);
  const orderId = m[1];
  const ergebnis = (e, hinweis, groesse = null) => ({ ergebnis: e, groesse, hinweis });

  let z;
  try { z = await zugang('edi'); } catch (err) { return ergebnis(SENDE_ERGEBNIS.NICHT_DA, err.message); }
  const geheim = [z.host, z.user, z.password];
  const text = err => ohneZugang(err, geheim);
  const client = clientFabrik ? clientFabrik() : new Client(BEFEHL_ZEITLIMIT_MS);
  const ordner = `/${SENDE_ORDNER}/`;
  const liste = async () => (await client.list(ordner)).filter(e => e.isFile !== false).map(e => ({ name: e.name, size: e.size }));

  try {
    // ── vor der Uebertragung: jeder Fehler hier heisst "nichts gesendet" ──
    try {
      await client.access({ host: z.host, port: z.port, user: z.user, password: z.password, secure: false });
    } catch (err) { return ergebnis(SENDE_ERGEBNIS.NICHT_DA, `Anmeldung: ${text(err)}`); }
    let vorher;
    try { vorher = await liste(); } catch (err) { return ergebnis(SENDE_ERGEBNIS.NICHT_DA, `Liste ORDER: ${text(err)}`); }
    const da = vorher.find(e => e.name === name || e.name.startsWith(`${orderId}_`));
    if (da) return ergebnis(SENDE_ERGEBNIS.UNKLAR, `In ORDER liegt schon ${da.name} - nicht gesendet, bitte prüfen.`);

    // ── Uebertragung: genau ein Versuch ──
    let gelesen = false;
    const quelle = new Readable({
      read() {
        if (gelesen) return;
        gelesen = true;
        this.push(inhalt);
        this.push(null);
      },
    });
    try {
      const antwort = await client.uploadFrom(quelle, `${ordner}${name}`);
      if (!(antwort?.code >= 200 && antwort.code < 300)) return ergebnis(SENDE_ERGEBNIS.UNKLAR, `keine Bestätigung des Servers (${antwort?.code ?? 'ohne Code'})`);
    } catch (err) {
      if (!gelesen && abgelehnt(err)) return ergebnis(SENDE_ERGEBNIS.NICHT_DA, `Server hat abgelehnt: ${text(err)}`);
      return ergebnis(SENDE_ERGEBNIS.UNKLAR, `${gelesen ? 'Abbruch während der Übertragung' : 'keine Antwort auf den Sendebefehl'}: ${text(err)}`);
    }

    // ── nach der Uebertragung: nachsehen ──
    let nachher;
    try { nachher = await liste(); } catch (err) { return ergebnis(SENDE_ERGEBNIS.UNKLAR, `gesendet, aber Liste ORDER danach nicht lesbar: ${text(err)}`); }
    const datei = nachher.find(e => e.name === name);
    if (!datei) return ergebnis(SENDE_ERGEBNIS.ABGEHOLT, 'sofort abgeholt');
    if (Number(datei.size) !== inhalt.length) return ergebnis(SENDE_ERGEBNIS.UNKLAR, `Größe in ORDER ${datei.size} statt ${inhalt.length} Bytes`, Number(datei.size));
    return ergebnis(SENDE_ERGEBNIS.LIEGT, '', inhalt.length);
  } finally {
    try { client.close(); } catch { /* schon zu */ }
  }
}
