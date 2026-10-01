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
// Die Meldung nennt Shop, Pfad und Uhrzeit - nie Abfrageparameter, nie Schluessel.

export const HOSTER_PRUEFSEITE_CODE = 'hoster_pruefseite';
export const HOSTER_PRUEFSEITE_TEXT = 'Hoster-Prüfseite (Captcha) erhalten, Lauf gestoppt';

// Harte Obergrenze je Seitenschleife (per_page 100 -> 20.000 Eintraege).
export const MAX_SEITEN = 200;

export class HosterPruefseiteError extends Error {
  constructor({ shop = 'unbekannt', pfad = '', zeit = new Date() } = {}) {
    const iso = (zeit instanceof Date ? zeit : new Date(zeit)).toISOString().replace(/\.\d{3}Z$/, 'Z');
    super(`${HOSTER_PRUEFSEITE_TEXT} (Shop ${shop}, Pfad ${pfadOhneQuery(pfad)}, ${iso}).`);
    this.name   = 'HosterPruefseiteError';
    this.code   = HOSTER_PRUEFSEITE_CODE;
    this.status = 503;
    this.shop   = shop;
    this.pfad   = pfadOhneQuery(pfad);
    this.zeit   = iso;
  }
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
  if (istPruefseite({ status, contentType, body })) throw new HosterPruefseiteError({ shop, pfad });
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
  try { return JSON.parse(text); } catch { throw new HosterPruefseiteError({ shop, pfad: pfad ?? res.url }); }
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
