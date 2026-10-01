// Hoster-Pruefseite (ESTUGO, 01.10.2026): nach etwa 11 schnellen Abrufen liefert
// der Hoster statt der Shop-Antwort eine JS-Pruefseite ("One moment, please...",
// openresty) - mit HTTP 200. Nach ueber 100 nicht geloesten Pruefseiten sperrt er
// die IP. Jeder weitere Abruf zaehlt als weitere gescheiterte Pruefung.
//
// Regel: Liefert WooCommerce oder WordPress HTML statt JSON, bricht der Lauf
// sofort ab, ohne Wiederholung. Eine Pruefung (pruefeAntwort), ein Fehlertyp
// (HosterPruefseiteError). Jeder WC-Zugriff laeuft ueber getWcClient (dort
// haengt die Pruefung an jedem Request), WordPress-fetch ueber pruefeFetchAntwort.
//
// Die Meldung nennt Shop, Pfad, HTTP-Status, <title> der Seite (max. 80 Zeichen)
// und Uhrzeit - nie Body, nie Abfrageparameter, nie Schluessel. Status + Titel
// zeigen, welche Seite es war (Captcha-Seite, Plesk-403, nginx-502 …).

export const HOSTER_PRUEFSEITE_CODE = 'hoster_pruefseite';
export const HOSTER_PRUEFSEITE_TEXT = 'Hoster-Prüfseite (Captcha) erhalten, Lauf gestoppt';

// Harte Obergrenze je Seitenschleife (per_page 100 -> 20.000 Eintraege).
export const MAX_SEITEN = 200;

export const TITEL_MAX = 80;

export class HosterPruefseiteError extends Error {
  /**
   * @param {{ shop?: string, pfad?: string, httpStatus?: number, titel?: string, zeit?: Date|string }} o
   * httpStatus/titel: aus der Antwort, sofern es eine gab (seitenListe kennt sie nicht).
   */
  constructor({ shop = 'unbekannt', pfad = '', httpStatus, titel, zeit = new Date() } = {}) {
    const iso = (zeit instanceof Date ? zeit : new Date(zeit)).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const t   = kuerzeTitel(titel);
    const teile = [`Shop ${shop}`, `Pfad ${pfadOhneQuery(pfad)}`,
      Number.isInteger(httpStatus) ? `HTTP ${httpStatus}` : null, t ? `Titel "${t}"` : null, iso];
    super(`${HOSTER_PRUEFSEITE_TEXT} (${teile.filter(Boolean).join(', ')}).`);
    this.name       = 'HosterPruefseiteError';
    this.code       = HOSTER_PRUEFSEITE_CODE;
    this.status     = 503;          // Antwort von Mission Control, nicht die des Shops
    this.shop       = shop;
    this.pfad       = pfadOhneQuery(pfad);
    this.httpStatus = Number.isInteger(httpStatus) ? httpStatus : null;
    this.titel      = t;
    this.zeit       = iso;
  }
}

function kuerzeTitel(titel) {
  const t = String(titel ?? '').replace(/\s+/g, ' ').trim();
  return t.length > TITEL_MAX ? `${t.slice(0, TITEL_MAX - 1)}…` : t;
}

const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Inhalt von <title> aus einem HTML-Text (ohne Tags, Entitaeten aufgeloest), sonst ''. */
export function titelAus(body) {
  if (typeof body !== 'string') return '';
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  if (!m) return '';
  return kuerzeTitel(m[1].replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (x, e) => (e[0] === '#'
      ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ENTITAETEN[e.toLowerCase()] ?? x)));
}

export class SeitenGrenzeError extends Error {
  constructor({ shop = 'unbekannt', pfad = '' } = {}) {
    super(`Seitenschleife nach ${MAX_SEITEN} Seiten abgebrochen (Shop ${shop}, Pfad ${pfadOhneQuery(pfad)}).`);
    this.name   = 'SeitenGrenzeError';
    this.status = 502;
  }
}

// Nur der Pfad: alles ab "?" oder "#" faellt weg, ebenso Schema und Host.
export function pfadOhneQuery(pfad) {
  let p = String(pfad ?? '');
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch { /* bleibt roh */ }
  return p.split(/[?#]/)[0];
}

/**
 * true, wenn die Antwort keine JSON-Antwort ist: Content-Type ohne "json" oder
 * Body (als Text) beginnt mit "<". Der Status spielt keine Rolle - die
 * Pruefseite kommt mit 200. Einzige Ausnahme: 204 ohne Inhalt.
 */
export function istPruefseite({ status, contentType, body } = {}) {
  if (status === 204 && (body === undefined || body === null || body === '')) return false;
  if (typeof body === 'string' && body.trimStart().startsWith('<')) return true;
  return !/json/i.test(String(contentType ?? ''));
}

/** Wirft HosterPruefseiteError, wenn istPruefseite. */
export function pruefeAntwort({ shop, pfad, status, contentType, body }) {
  if (istPruefseite({ status, contentType, body }))
    throw new HosterPruefseiteError({ shop, pfad, httpStatus: status, titel: titelAus(body) });
}

function headerWert(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  return headers[name] ?? headers[name.toLowerCase()];
}

/**
 * Haengt die Pruefung an einen WooCommerceRestApi-Client: jeder get/post/put/
 * delete/options laeuft ueber _request. Gilt fuer Erfolg UND Fehlerantwort
 * (eine HTML-Seite mit 403/503 ist dieselbe Sperre). Netzwerkfehler ohne
 * Antwort bleiben unveraendert.
 */
export function mitPruefung(client, shopLabel) {
  const orig = client._request.bind(client);
  client.shopLabel = shopLabel;
  client._request = (method, endpoint, ...rest) => orig(method, endpoint, ...rest).then(
    res => {
      pruefeAntwort({ shop: shopLabel, pfad: endpoint, status: res?.status, contentType: headerWert(res?.headers, 'content-type'), body: res?.data });
      return res;
    },
    err => {
      const r = err?.response;
      if (r) pruefeAntwort({ shop: shopLabel, pfad: endpoint, status: r.status, contentType: headerWert(r.headers, 'content-type'), body: r.data });
      throw err;
    },
  );
  return client;
}

/**
 * fetch-Antwort (WordPress) pruefen und als JSON lesen. Wirft
 * HosterPruefseiteError bei HTML; sonst das geparste JSON (leerer Body -> {}).
 */
export async function pruefeFetchAntwort(res, { shop, pfad }) {
  const text = await res.text();
  pruefeAntwort({ shop, pfad: pfad ?? res.url, status: res.status, contentType: headerWert(res.headers, 'content-type'), body: text });
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HosterPruefseiteError({ shop, pfad: pfad ?? res.url, httpStatus: res.status }); }
}

/**
 * Fuer jedes catch, das sonst weitermacht (naechste Variante, naechster
 * Partner, naechste Bestellung): die Pruefseite sofort weiterwerfen, alle
 * anderen Fehler behandelt der Aufrufer wie bisher.
 *   } catch (err) { wirfWennPruefseite(err); …bisherige Behandlung… }
 */
export function wirfWennPruefseite(err) {
  if (err instanceof HosterPruefseiteError) throw err;
}

// Zweites Netz fuer Seitenschleifen (falls ein Client an mitPruefung vorbeilaeuft):
//   for (let page = 1; ; page++) {
//     seitenGrenze(page, { wc, pfad });                       // vor dem Abruf
//     const liste = seitenListe((await wc.get(pfad, …)).data, { wc, pfad });
//     …
//   }

/** data keine Liste -> HosterPruefseiteError. Gibt data zurueck. */
export function seitenListe(data, { wc, shop, pfad } = {}) {
  if (!Array.isArray(data)) throw new HosterPruefseiteError({ shop: shop ?? wc?.shopLabel ?? 'unbekannt', pfad });
  return data;
}

/** Vor jedem Abruf einer Seitenschleife: page > MAX_SEITEN -> SeitenGrenzeError. */
export function seitenGrenze(page, { wc, shop, pfad } = {}) {
  if (page > MAX_SEITEN) throw new SeitenGrenzeError({ shop: shop ?? wc?.shopLabel ?? 'unbekannt', pfad });
}
