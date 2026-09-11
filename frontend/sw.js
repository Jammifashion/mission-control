// Service Worker – Mission Control PWA
//
// Vorgeschichte (11.09.2026, Befund C10): der Fetch-Handler war cache-first fuer
// jedes same-origin GET, also auch fuer index.html. Nach einem Deploy lieferte
// ein normales F5 weiter die alte Seite, und zwar unbegrenzt lange - die alte
// index.html legte die geloeschten Fixkosten-Zeilen sofort wieder an. Dazu war
// der Cache-Name eine Handnummer (Suffix v9), die beim Deploy niemand
// hochgezaehlt hat, also blieb der alte Cache gueltig und wurde nie verworfen.
//
// Jetzt gilt:
//   - HTML-Navigationen network-first, Cache nur als Offline-Fallback
//   - Cache-Name traegt den Commit-SHA, den der Pages-Workflow einsetzt
//   - jeder Deploy raeumt saemtliche fremden Caches weg
//
// Wichtig zum Scope: registriert wird der Worker nur von index.html, er
// kontrolliert aber jede Seite unter seinem Pfad - also auch partner.html,
// partner-festpreis.html und anfrage.html, die ihn selbst nie registrieren.
// Fuer die drei gilt darum Netz oder nichts (siehe NIE_CACHEN).

// Der Platzhalter unten wird im Pages-Workflow durch den Commit-SHA ersetzt
// (.github/workflows/deploy.yml, Schritt "Cache-Version stempeln"). Er darf in
// dieser Datei nur ein einziges Mal vorkommen, damit das sed eindeutig bleibt -
// service-worker.test.js prueft das. Bleibt er stehen (lokal, oder wenn der
// Schritt fehlt), faellt der Name auf "dev" zurueck, statt eine Version zu
// erfinden, die es nicht gibt.
const BUILD_VERSION = '__BUILD_VERSION__';
const VERSION       = BUILD_VERSION.startsWith('__') ? 'dev' : BUILD_VERSION;

const CACHE_PREFIX = 'mission-control-';
const CACHE_NAME   = CACHE_PREFIX + VERSION;

// Nur die PWA-Shell. Alles andere kommt aus dem Netz.
const PRECACHE = [
  './index.html',
  './manifest.json',
];

// Offline-Fallback fuer eine Navigation, die nicht aus dem Cache kommen darf.
const OFFLINE_HTML = `<!DOCTYPE html><html lang="de"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;
background:#0f0f0f;color:#eee;font:16px/1.5 system-ui,sans-serif;text-align:center">
<div style="padding:24px"><h1 style="font-size:1.1rem;margin:0 0 8px">Keine Verbindung</h1>
<p style="margin:0;color:#999">Diese Seite braucht eine Internetverbindung.
Bitte neu laden, sobald du wieder online bist.</p></div></body></html>`;

// Seiten, die NIE aus dem Cache kommen. anfrage.html ist das Chat-Widget fuer
// Kunden: eine veraltete Kopie haette moeglicherweise die falsche Backend-URL
// oder den falschen Turnstile-Sitekey und wuerde still klemmen - und zwar bei
// einem Besucher, der nie etwas von dieser PWA wollte (die Seite laeuft als
// iframe in WordPress und liegt nur zufaellig im Scope dieses Workers).
// partner.html und partner-festpreis.html tragen ihren Token in der URL; die
// gehoeren nicht in einen Cache, der nach Request-URL schluesselt.
const NIE_CACHEN = ['/anfrage.html', '/partner.html', '/partner-festpreis.html'];

function istAusgenommen(url) {
  return NIE_CACHEN.some(p => url.pathname.endsWith(p));
}

function istNavigation(request) {
  return request.mode === 'navigate'
      || request.destination === 'document'
      || request.destination === 'iframe';
}

// ── Install: Shell vorladen, sofort uebernehmen ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // reload erzwingt einen echten Netz-Treffer: ohne das darf der Browser
      // die Einträge aus seinem HTTP-Cache bedienen und wir precachen genau die
      // alte Datei, die wir loswerden wollen.
      .then(cache => cache.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: alle fremden Caches weg, Kontrolle uebernehmen ─────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API-Aufrufe (auch cross-origin zum Cloud-Run-Backend): nur Netz, nie Cache.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline – keine API-Verbindung.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Ausgenommene Seiten: Netz oder Offline-Hinweis. Bewusst kein Cache-Fallback -
  // ein veraltetes Chat-Widget ist schlechter als eine ehrliche Fehlseite.
  if (istAusgenommen(url)) {
    event.respondWith(
      fetch(request).catch(() => new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }))
    );
    return;
  }

  // HTML-Navigationen: network-first. Der Cache ist ausschliesslich
  // Offline-Fallback, nie die erste Quelle - das war der Fehler aus C10.
  if (istNavigation(request) || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match('./index.html');
          if (shell) return shell;
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        })
    );
    return;
  }

  // Uebrige statische Dateien (manifest, Icons): cache-first mit Nachladen.
  // Unkritisch, weil sie sich selten aendern und der Cache bei jedem Deploy
  // komplett neu aufgebaut wird.
  event.respondWith(
    caches.match(request).then(cached => {
      const netz = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
      return cached || netz;
    })
  );
});
