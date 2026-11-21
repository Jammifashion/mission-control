// UI-Messung (UI1/AH1): Sichtpruefung aller MC-Ansichten mit Attrappen-Daten.
// Nur von Hand, nicht in CI. Nur erfundene Daten, kein Schluessel, alle fremden Hosts gesperrt.
//
//   cd tools/ui-messung && npm ci && npx playwright install chromium   (einmal)
//   npm run messung -- --breite 375 --aus <ordner ausserhalb des Repos>
//
// Optionen: --breite 375,768,1280,1920   --modus hell,dunkel   --zustand voll,leer
//           --ansicht <Anfang der Kennung, z. B. auftraege>   --aus <Ordner>   --uebersicht (Bild je Ansicht)
// Ausgabe im Ordner: ergebnis.json, funde.md (Tabelle je Stelle), bilder/ (nur Fundstellen, markiert).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteServer, FRONTEND } from './server.mjs';
import { ANSICHTEN_ZUSATZ } from './ansichten.mjs';
import { zusammenfassen } from './auswerten.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..');

// ── Argumente ──
const arg = (name, std) => { const i = process.argv.indexOf('--' + name); return i < 0 ? std : (process.argv[i + 1] ?? ''); };
const flag = name => process.argv.includes('--' + name);
const GROESSEN = { 375: 812, 768: 1024, 1280: 900, 1920: 1080 };
const BREITEN = arg('breite', '375,768,1280,1920').split(',').map(Number).filter(Boolean);
const MODI = arg('modus', 'hell,dunkel').split(',').map(m => (m === 'dunkel' || m === 'dark' ? 'dark' : 'light'));
const ZUSTAENDE = arg('zustand', 'voll,leer').split(',');
const NUR = arg('ansicht', null);
const AUS = path.resolve(arg('aus', path.join(REPO, '..', 'ui-messung')));
const UEBERSICHT = flag('uebersicht');
if (AUS.startsWith(REPO + path.sep)) { console.error('Ausgabe muss ausserhalb des Repos liegen:', AUS); process.exit(1); }
const BILDER = path.join(AUS, 'bilder');
fs.mkdirSync(BILDER, { recursive: true });

// ── Ansichten aus der Navigationstabelle BEREICHE (index.html) ──
function ansichtenAusBereiche() {
  const html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8');   // vor dem Kopieren gelesen = derselbe Stand
  const a = html.indexOf('const BEREICHE = {');
  const e = html.indexOf('\n      };', a);
  if (a < 0 || e < 0) throw new Error('BEREICHE nicht gefunden');
  const BEREICHE = new Function(`return ${html.slice(a + 'const BEREICHE = '.length, e + 8)}`)();
  const liste = [];
  for (const [b, def] of Object.entries(BEREICHE)) for (const p of def.punkte) if (!p.umleitung) liste.push({ id: `${b}/${p.id}` });
  return liste;
}
const ANSICHTEN = [...ansichtenAusBereiche(), ...ANSICHTEN_ZUSATZ]
  .filter(a => !NUR || a.id.startsWith(NUR));

// ── Attrappen ──
const attrappen = [];
let setzeArt = () => {};
for (const f of ['auftraege.mjs', 'bestellen.mjs', 'rest.mjs']) {
  const m = await import(new URL(`./attrappen/${f}`, import.meta.url));
  attrappen.push(m.antwort);
  if (m.setzeBestellseiteArt) setzeArt = m.setzeBestellseiteArt;
}
// Zustand "leer": dieselben Formen, aber jede Liste leer UND jede Zahl 0 (UI3: sonst zeigen Kacheln Zaehler ueber leeren Listen).
// Einstellungen bleiben (Tage, Grenzen, Saetze, Jahr, Masse) - sie sind keine Zaehler.
const KEIN_ZAEHLER = /_tage$|grenze|max|min|satz|ust|jahr|breite|hoehe|rang|stufe|limit/i;
const leeren = (x, k = '') => Array.isArray(x) ? [] : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, leeren(v, kk)]))
  : typeof x === 'number' && !KEIN_ZAEHLER.test(k) ? 0 : x;

const ohneAttrappe = {};
const jsFehler = {};
const merke = (ziel, k, v) => (ziel[k] ??= new Set()).add(v);

function routeFuer(ref) {
  return async route => {
    const req = route.request();
    const u = new URL(req.url());
    if (!/\.run\.app$/.test(u.hostname)) return route.abort();   // nur das (abgefangene) Backend, alles andere gesperrt
    let body = null; try { body = req.postDataJSON(); } catch { /* kein JSON */ }
    let a;
    for (const f of attrappen) {
      try { a = f(req.method(), u.pathname, u.searchParams, body, ref.seite); } catch (e) { merke(jsFehler, 'attrappe', `${u.pathname}: ${e.message}`); }
      if (a !== undefined) break;
    }
    if (a === undefined) { merke(ohneAttrappe, ref.id, `${req.method()} ${u.pathname}`); a = req.method() === 'GET' ? {} : { ok: true }; }
    if (ref.zustand === 'leer' && req.method() === 'GET') a = a?.__status ? { ...a, __body: leeren(a.__body) } : leeren(a);
    if (a && a.__status) return route.fulfill({ status: a.__status, headers: { 'content-type': 'application/json', ...(a.__headers ?? {}) }, body: JSON.stringify(a.__body ?? {}) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) });
  };
}

const PRUEF = fs.readFileSync(path.join(HIER, 'pruefungen.js'), 'utf8');
const PANEL = 'main > .panel.active';
const BILD_ARTEN = new Set(['ueberlauf', 'abgeschnitten', 'knopf-zu-schmal', 'rand-rechts', 'ueberlappung', 'seite-rollt', 'kontrast',
  'schrift-klein', 'tippflaeche', 'auswahl-abgeschnitten', 'platzhalter-abgeschnitten', 'ausrichtung', 'feld-gequetscht', 'feld-leer']);
const VIELE = new Set(['tippflaeche', 'kontrast', 'schrift-klein']);

// Stand zum Start einfrieren: gemessen wird eine Kopie von frontend/ (Aenderungen waehrend des Laufs zaehlen nicht)
const KOPIE = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-messung-'));
fs.cpSync(FRONTEND, KOPIE, { recursive: true });
const srv = await starteServer(KOPIE);
const browser = await chromium.launch();
const ergebnis = [];
const geknipst = new Set();
let bildNr = 0;

for (const zustand of ZUSTAENDE) for (const bw of BREITEN) for (const modus of MODI) {
  const mobil = bw <= 480;
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: bw, height: GROESSEN[bw] ?? 900 }, colorScheme: modus,
    isMobile: mobil, hasTouch: mobil, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  await ctx.addInitScript(m => {
    try { for (const k of ['mc_theme', 'partner_theme', 'bs_theme']) localStorage.setItem(k, m); localStorage.setItem('mc_api_key', 'attrappe-ohne-wert'); localStorage.setItem('mc_shop', 'jfn'); } catch { /* egal */ }
  }, modus);
  await ctx.clock.install({ time: new Date('2026-11-19T10:00:00+01:00') }).catch(() => {});
  const ref = { id: '', seite: 'index', zustand };
  await ctx.route(u => u.hostname !== '127.0.0.1', routeFuer(ref));
  let page = null;
  for (const a of ANSICHTEN) {
    if (zustand === 'leer' && a.nurVoll) continue;
    Object.assign(ref, { id: a.id, seite: a.seite ?? 'index' });
    if (a.art) setzeArt(a.art);
    if (page) await page.close();
    page = await ctx.newPage();
    page.on('pageerror', e => merke(jsFehler, `${a.id} (${zustand})`, e.message.slice(0, 140)));
    page.on('dialog', d => d.dismiss());
    await page.goto(`http://127.0.0.1:${srv.address().port}/${a.url ?? `index.html#${a.hash ?? a.id}`}`);
    await page.waitForTimeout(2200);
    let aktionOk = true;
    if (a.aktion) { try { await a.aktion(page); } catch (e) { aktionOk = false; if (process.env.UI_DEBUG) console.log(`Aktion ${a.id}: ${String(e.message).slice(0, 2500)}`); } }   // UI_DEBUG=1 zeigt, warum eine Aktion scheitert
    const wurzel = a.wurzel ?? PANEL;
    let r;
    try { r = await page.evaluate(`(${PRUEF})(${JSON.stringify({ wurzelSel: wurzel, mobil })})`); }
    catch (e) { r = { funde: [], karten: [], seiteRollt: 0, fehler: e.message }; }
    const wurzelDa = await page.evaluate(s => [...document.querySelectorAll(s)].some(e => e.getBoundingClientRect().height > 0 && !e.closest('[hidden]')), wurzel);
    // FB1: am Handy vergroessert der Browser die Seite, wenn Inhalt breiter ist als der Bildschirm - dann stimmt innerWidth
    // nicht mehr mit der eingestellten Breite ueberein und die Pruefung in der Seite merkt es nicht.
    const innen = await page.evaluate(() => window.innerWidth).catch(() => bw);
    if (!r.seiteRollt && innen > bw + 1) r.seiteRollt = innen;
    if (r.seiteRollt) r.funde.push({ art: 'seite-rollt', sel: 'html', text: '', rect: { x: 0, y: 0, w: bw, h: 200 }, detail: `Seite ${r.seiteRollt}px breit bei ${bw}px` });
    const name = `${a.id.replace(/[/+.]/g, '-')}_${zustand}_${bw}_${modus}`;
    if (UEBERSICHT && wurzel.startsWith('.edi-dialog')) {
      // Dialoge rollen in sich: je Bildschirmhoehe ein Bild (hoechstens 6), danach wieder nach oben
      const teile = await page.evaluate(() => {
        const d = document.querySelector('.edi-dialog:not([hidden])');
        const r = d && [d, ...d.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        if (!r) return 1;
        r.dataset.uiRoller = '1';
        return Math.min(6, Math.ceil(r.scrollHeight / r.clientHeight));
      });
      for (let i = 0; i < teile; i++) {
        await page.evaluate(i => { const r = document.querySelector('[data-ui-roller]'); if (r) r.scrollTop = i * r.clientHeight * 0.9; }, i);
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(AUS, 'uebersicht', `${name}_${i + 1}.png`) });
      }
      await page.evaluate(() => { const r = document.querySelector('[data-ui-roller]'); if (r) { r.scrollTop = 0; delete r.dataset.uiRoller; } });
    } else if (UEBERSICHT) await page.screenshot({ path: path.join(AUS, 'uebersicht', `${name}.png`), fullPage: true });
    // Fundstellen knipsen: je Ansicht + Art + Stelle einmal ueber alle Laeufe
    const proArt = {};
    for (const f of r.funde) {
      const key = `${a.id}|${f.art}|${f.sel}`;
      if (geknipst.has(key) || !BILD_ARTEN.has(f.art)) continue;
      proArt[f.art] = (proArt[f.art] ?? 0) + 1;
      if (proArt[f.art] > (VIELE.has(f.art) ? 2 : 6)) continue;
      geknipst.add(key);
      const datei = `${String(++bildNr).padStart(3, '0')}_${name}_${f.art}.png`;
      try {
        await page.evaluate(rc => { const d = document.createElement('div'); d.className = '__ui_mark'; Object.assign(d.style, { position: 'absolute', left: `${rc.x - 3}px`, top: `${rc.y - 3}px`, width: `${rc.w + 6}px`, height: `${rc.h + 6}px`, outline: '3px solid #ff00aa', zIndex: 2147483647, pointerEvents: 'none' }); document.body.appendChild(d); }, f.rect);
        const [pw, ph] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
        const x = Math.max(0, f.rect.x - 80), y = Math.max(0, f.rect.y - 80);
        await page.screenshot({ path: path.join(BILDER, datei), fullPage: true, clip: { x, y, width: Math.min(pw - x, Math.max(f.rect.w + 160, Math.min(bw, 900))), height: Math.min(ph - y, Math.max(f.rect.h + 160, 300)) } });
        await page.evaluate(() => document.querySelectorAll('.__ui_mark').forEach(e => e.remove()));
        f.bild = datei;
      } catch { /* Bild ist Beiwerk */ }
    }
    ergebnis.push({ ansicht: a.id, zustand, breite: bw, modus, aktionOk, wurzelDa, ...r });
    console.log(`${a.id} ${zustand} ${bw} ${modus}: ${r.funde.length} Funde${aktionOk ? '' : ' (Aktion fehlgeschlagen)'}${wurzelDa ? '' : ' (nichts sichtbar)'}`);
  }
  if (page) await page.close();
  await ctx.close();
}
const roh = { stand: new Date().toISOString(), ergebnis,
  ohneAttrappe: Object.fromEntries(Object.entries(ohneAttrappe).map(([k, v]) => [k, [...v]])),
  jsFehler: Object.fromEntries(Object.entries(jsFehler).map(([k, v]) => [k, [...v]])) };
fs.writeFileSync(path.join(AUS, 'ergebnis.json'), JSON.stringify(roh, null, 1));
fs.writeFileSync(path.join(AUS, 'funde.md'), zusammenfassen(roh));
await browser.close(); srv.close();
fs.rmSync(KOPIE, { recursive: true, force: true });
console.log(`fertig: ${ergebnis.length} Messungen, ${bildNr} Bilder -> ${AUS}`);
