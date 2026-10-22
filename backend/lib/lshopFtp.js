// L-Shop-FTP, NUR LESEN (BO4b-1). Die einzige Stelle, die basic-ftp importiert (Test lshop-ftp-regel).
//
// Angeboten werden nur liste(ordner) und lade(ordner, datei). Der Client verlaesst dieses Modul nie;
// es gibt keinen Weg zum Hochladen, Loeschen, Umbenennen oder Anlegen (Test prueft den Quelltext).
// Das EDI-Konto auf dem Server DARF schreiben - "nur lesen" sichert allein dieser Code.
// Schreiben in ORDER kommt erst mit BO4c, und dann nur dort: Dateien <order_id>_…xml aus
// LShop_EDI_Dateien, nie loeschen oder umbenennen.
//
// Zugang aus dem Secret Manager (nie Code, Log, Postfach, Testdaten):
//   LSHOP_FTP_HOST          gemeinsamer Host (Bestand + Belege), Port 21 Standard, "host:port" moeglich
//   LSHOP_EDI_FTP_USER/PASS Konto fuer Belege und Bestellen (EDI)
//   LSHOP_FTP_USER/PASS     Konto fuer die Bestandsdatei (stockfile, ab BO4b-3)
// Der Server ist unverschluesselt (Entscheidung Inhaber 22.10.) und wackelt (gemessen: Abbruch,
// Zeitueberschreitung): eine Verbindung je Lauf, alles nacheinander, keine Wiederholung im Lauf.
// Fehlermeldungen nennen nie Host, IP oder Benutzer.

import { Writable } from 'stream';
import { Client } from 'basic-ftp';
import { getSecret } from '../utils/secrets.js';

export const BEFEHL_ZEITLIMIT_MS = 30_000;
export const MAX_BELEG_BYTES = 1024 * 1024;

// Was gelesen werden darf. ORDER nur als Liste (fremde Dateien erkennen), nie geladen.
export const ERLAUBT_LISTE = new Set(['ORDER', 'ORDERCONFIRMATION', 'DELIVERYCONFIRMATION', 'INVOICE/XML', 'INVOICE/PDF']);
export const ERLAUBT_LADEN = new Set(['ORDERCONFIRMATION', 'DELIVERYCONFIRMATION', 'INVOICE/XML']);
const DATEINAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

export class LShopFtpFehler extends Error {
  constructor(message) {
    super(message);
    this.name = 'LShopFtpFehler';
    this.code = 'lshop_ftp';
    this.status = 502;
  }
}

// Nur der Fehlercode oder die FTP-Antwort ohne Adressen.
function ohneZugang(err, geheim) {
  let s = String(err?.code && typeof err.code === 'string' ? `${err.code} ${err.message ?? ''}` : err?.message ?? err);
  for (const g of geheim) if (g) s = s.split(g).join('<…>');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>').replace(/\[[0-9a-f:]+\](?::\d+)?/gi, '<ip>');
  return s.replace(/\s+/g, ' ').trim().slice(0, 140);
}

async function zugang(konto) {
  if (konto !== 'edi') throw new LShopFtpFehler(`Unbekanntes FTP-Konto "${konto}".`);
  const [hostRoh, user, password] = await Promise.all([
    getSecret('LSHOP_FTP_HOST'), getSecret('LSHOP_EDI_FTP_USER'), getSecret('LSHOP_EDI_FTP_PASS'),
  ]);
  const h = String(hostRoh ?? '').trim();
  if (!h || !user || !password || h === 'unused') throw new LShopFtpFehler('FTP-Zugang nicht konfiguriert (Secrets LSHOP_FTP_HOST / LSHOP_EDI_FTP_*).');
  const [, host, port] = /^([^:]+)(?::(\d+))?$/.exec(h) ?? [];
  if (!host) throw new LShopFtpFehler('LSHOP_FTP_HOST hat kein gültiges Format.');
  return { host, port: port ? Number(port) : 21, user: String(user).trim(), password: String(password) };
}

function pruefeOrdner(ordner, erlaubt) {
  if (!erlaubt.has(ordner)) throw new LShopFtpFehler(`Ordner "${ordner}" ist hier nicht erlaubt.`);
}

/**
 * Oeffnet EINE Verbindung, gibt fn nur { liste, lade } und schliesst danach immer.
 * Jeder FTP-Fehler wird zu LShopFtpFehler (502, code lshop_ftp) ohne Zugangsdaten.
 *
 * @param {(ftp: { liste: (ordner: string) => Promise<object[]>, lade: (ordner: string, datei: string, o?: { maxBytes?: number }) => Promise<Buffer> }) => Promise<any>} fn
 * @param {{ konto?: 'edi', clientFabrik?: () => any }} [o]  clientFabrik nur fuer Tests
 */
export async function mitLShopFtp(fn, { konto = 'edi', clientFabrik } = {}) {
  const z = await zugang(konto);
  const geheim = [z.host, z.user, z.password];
  const client = clientFabrik ? clientFabrik() : new Client(BEFEHL_ZEITLIMIT_MS);
  const ftpFehler = err => (err instanceof LShopFtpFehler ? err : new LShopFtpFehler(`FTP: ${ohneZugang(err, geheim)}`));

  const liste = async ordner => {
    pruefeOrdner(ordner, ERLAUBT_LISTE);
    try {
      const eintraege = await client.list(`/${ordner}/`);
      return eintraege.map(e => ({
        name: e.name, size: e.size, istDatei: Boolean(e.isFile), modifiedAt: e.modifiedAt, rawModifiedAt: e.rawModifiedAt,
      }));
    } catch (err) { throw ftpFehler(err); }
  };

  const lade = async (ordner, datei, { maxBytes = MAX_BELEG_BYTES } = {}) => {
    pruefeOrdner(ordner, ERLAUBT_LADEN);
    if (!DATEINAME.test(String(datei)) || String(datei).includes('..')) throw new LShopFtpFehler('Ungültiger Dateiname.');
    const teile = [];
    let laenge = 0;
    const ziel = new Writable({
      write(chunk, _enc, cb) {
        laenge += chunk.length;
        if (laenge > maxBytes) return cb(new LShopFtpFehler(`${ordner}/${datei} ist größer als ${maxBytes} Bytes.`));
        teile.push(chunk);
        cb();
      },
    });
    try {
      await client.downloadTo(ziel, `/${ordner}/${datei}`);
    } catch (err) { throw ftpFehler(err); }
    return Buffer.concat(teile);
  };

  try {
    try {
      await client.access({ host: z.host, port: z.port, user: z.user, password: z.password, secure: false });
    } catch (err) { throw ftpFehler(err); }
    return await fn(Object.freeze({ liste, lade }));
  } finally {
    try { client.close(); } catch { /* schon zu */ }
  }
}
