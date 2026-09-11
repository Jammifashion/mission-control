// Quellvertrag fuer frontend/sw.js, frontend/index.html und den Pages-Workflow.
//
// Befund C10: der Worker war cache-first fuer jedes same-origin GET, also auch
// fuer index.html, und der Cache-Name war eine Handnummer. Ein Deploy erreichte
// die Geraete damit nie - das normale F5 lieferte weiter die alte Seite, und die
// alte index.html legte die geloeschten Fixkosten-Zeilen sofort wieder an.
//
// Ein Service Worker laesst sich hier nicht ausfuehren (jest testEnvironment:
// node, kein ServiceWorkerGlobalScope, keine Cache-API). Was sich pruefen laesst,
// ist die Verdrahtung - und gerade die ist der Punkt: nimmt jemand den
// SHA-Platzhalter heraus, dreht die Navigation zurueck auf cache-first oder
// nimmt anfrage.html aus der Ausnahmeliste, faellt das hier auf und nicht erst
// dadurch, dass Geraete wochenlang mit altem Code laufen.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sw       = readFileSync(resolve(root, 'frontend/sw.js'), 'utf8');
const index    = readFileSync(resolve(root, 'frontend/index.html'), 'utf8');
const workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');

const PLATZHALTER = '__BUILD' + '_VERSION__'; // nicht als ein Literal, sonst trifft das sed auch diese Datei

describe('Cache-Version kommt aus dem Deploy', () => {
  test('sw.js enthaelt den Platzhalter genau einmal', () => {
    expect(sw.split(PLATZHALTER)).toHaveLength(2);
  });

  test('Cache-Name ist aus der Version gebaut, nicht handgeschrieben', () => {
    expect(sw).toMatch(/const CACHE_NAME\s*=\s*CACHE_PREFIX \+ VERSION/);
    // Die alte Handnummer darf nicht zurueckkommen.
    expect(sw).not.toMatch(/mission-control-v\d/);
  });

  test('ohne Stempel faellt die Version auf dev zurueck', () => {
    expect(sw).toMatch(/startsWith\('__'\)\s*\?\s*'dev'/);
  });

  test('Pages-Workflow stempelt den Commit-SHA ein', () => {
    expect(workflow).toMatch(/sed -i .*BUILD_VERSION.*GITHUB_SHA.*frontend\/sw\.js/);
  });

  test('Workflow bricht ab, wenn der Platzhalter stehen bleibt', () => {
    expect(workflow).toMatch(/grep -q "__BUILD_VERSION__" frontend\/sw\.js/);
    expect(workflow).toMatch(/exit 1/);
  });

  test('gestempelt wird vor dem Upload des Artefakts', () => {
    const stempel = workflow.indexOf('Cache-Version stempeln');
    const upload  = workflow.indexOf('upload-pages-artifact');
    expect(stempel).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(stempel);
  });
});

describe('Navigationen sind network-first', () => {
  test('istNavigation deckt Dokument und iframe ab', () => {
    expect(sw).toMatch(/request\.mode === 'navigate'/);
    expect(sw).toMatch(/request\.destination === 'document'/);
    // Das Chat-Widget laeuft als iframe in WordPress.
    expect(sw).toMatch(/request\.destination === 'iframe'/);
  });

  test('der Navigations-Zweig fetcht zuerst und greift erst im catch auf den Cache', () => {
    const zweig = sw.match(/if \(istNavigation\(request\)[\s\S]*?\n    return;\n  \}/);
    expect(zweig).not.toBeNull();
    const code = zweig[0];
    const fetchPos = code.indexOf('fetch(request)');
    const cachePos = code.indexOf('caches.match(request)');
    expect(fetchPos).toBeGreaterThan(-1);
    expect(cachePos).toBeGreaterThan(fetchPos);
    expect(code).toMatch(/\.catch\(/);
  });

  test('kein "cached || fetch" mehr fuer HTML', () => {
    // Das Muster darf nur noch im Zweig fuer statische Dateien stehen,
    // und dort genau einmal.
    expect(sw.match(/return cached \|\|/g) ?? []).toHaveLength(1);
    const statisch = sw.lastIndexOf('return cached ||');
    const navZweig = sw.indexOf('if (istNavigation(request)');
    expect(statisch).toBeGreaterThan(navZweig);
  });
});

describe('install und activate', () => {
  test('install ruft skipWaiting', () => {
    const fn = sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/);
    expect(fn).not.toBeNull();
    expect(fn[0]).toContain('skipWaiting()');
  });

  test('install umgeht den HTTP-Cache beim Precache', () => {
    const fn = sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/);
    expect(fn[0]).toMatch(/cache: 'reload'/);
  });

  test('activate loescht jeden fremden Cache und claimt die Clients', () => {
    const fn = sw.match(/addEventListener\('activate'[\s\S]*?\n\}\);/);
    expect(fn).not.toBeNull();
    expect(fn[0]).toMatch(/keys\.filter\(k => k !== CACHE_NAME\)/);
    expect(fn[0]).toMatch(/caches\.delete\(k\)/);
    expect(fn[0]).toContain('clients.claim()');
  });
});

describe('Kundenseiten kommen nie aus dem Cache', () => {
  // anfrage.html registriert den Worker nicht, liegt aber in seinem Scope und
  // wird darum mitkontrolliert. Ein veraltetes Widget haette moeglicherweise
  // die falsche Backend-URL oder den falschen Turnstile-Sitekey.
  test.each(['/anfrage.html', '/partner.html', '/partner-festpreis.html'])(
    '%s steht in NIE_CACHEN',
    (pfad) => {
      const liste = sw.match(/const NIE_CACHEN = \[([\s\S]*?)\];/);
      expect(liste).not.toBeNull();
      expect(liste[1]).toContain(pfad);
    },
  );

  test('der ausgenommene Zweig hat keinen Cache-Fallback', () => {
    const zweig = sw.match(/if \(istAusgenommen\(url\)\)[\s\S]*?\n    return;\n  \}/);
    expect(zweig).not.toBeNull();
    expect(zweig[0]).toContain('fetch(request)');
    expect(zweig[0]).not.toContain('caches.match');
  });

  test('die Ausnahmen werden vor dem Navigations-Zweig geprueft', () => {
    const aus = sw.indexOf('if (istAusgenommen(url))');
    const nav = sw.indexOf('if (istNavigation(request)');
    expect(aus).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(aus);
  });

  test('precacht wird nur die Shell, keine Kundenseite', () => {
    const pre = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
    expect(pre).not.toBeNull();
    for (const p of ['anfrage.html', 'partner.html', 'partner-festpreis.html']) {
      expect(pre[1]).not.toContain(p);
    }
  });
});

describe('controllerchange laedt genau einmal neu', () => {
  test('index.html hoert auf controllerchange und laedt neu', () => {
    expect(index).toContain("addEventListener('controllerchange'");
    expect(index).toMatch(/location\.reload\(\)/);
  });

  test('Erstinstallation loest keinen Reload aus', () => {
    expect(index).toMatch(/const hatteController = !!navigator\.serviceWorker\.controller/);
    expect(index).toMatch(/if \(!hatteController \|\| neugeladen\) return;/);
  });

  test('die Sperre wird gesetzt, bevor neu geladen wird', () => {
    const fn = index.match(/addEventListener\('controllerchange'[\s\S]*?\n        \}\);/);
    expect(fn).not.toBeNull();
    expect(fn[0].indexOf('neugeladen = true')).toBeLessThan(fn[0].indexOf('location.reload()'));
  });

  test('nur index.html registriert den Worker', () => {
    for (const datei of ['anfrage.html', 'partner.html', 'partner-festpreis.html']) {
      const html = readFileSync(resolve(root, 'frontend', datei), 'utf8');
      expect(html).not.toContain('serviceWorker.register');
    }
  });
});
