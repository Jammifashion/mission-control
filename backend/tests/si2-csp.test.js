// SI2: CSP Stufe 2 (Hashes) und automatisches Abmelden nach 30 Tagen.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { CSP_SEITEN, inlineSkripte, hashVon, cspAus, scriptSrc, mitHashes, pruefe } from '../../.github/scripts/csp-hashes.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lies = p => readFileSync(resolve(repo, p), 'utf8');

describe('CSP-Hashes je Seite', () => {
  test.each(CSP_SEITEN)('%s: nach dem Bauschritt passen Hashes und Skripte, kein unsafe-inline bei Skripten', seite => {
    const html = lies(`frontend/${seite}`);
    expect(inlineSkripte(html).length).toBeGreaterThan(0);
    const gebaut = mitHashes(html);
    expect(pruefe(gebaut)).toEqual([]);
    const src = scriptSrc(cspAus(gebaut));
    expect(src).not.toContain("'unsafe-inline'");
    expect(src.startsWith("script-src 'self' 'sha256-")).toBe(true);
    // style-src bleibt, uebrige Direktiven unveraendert
    expect(cspAus(gebaut).replace(src, '')).toBe(cspAus(html).replace(scriptSrc(cspAus(html)), ''));
    // nur die Meta-Zeile aendert sich
    expect(gebaut.replace(cspAus(gebaut), '')).toBe(html.replace(cspAus(html), ''));
  });

  test('im Repo bleibt unsafe-inline (lokale Vorschau ohne Bauschritt)', () => {
    for (const seite of CSP_SEITEN) expect(scriptSrc(cspAus(lies(`frontend/${seite}`)))).toContain("'unsafe-inline'");
  });

  test('anfrage.html behaelt Turnstile in script-src', () => {
    expect(scriptSrc(cspAus(mitHashes(lies('frontend/anfrage.html'))))).toContain('https://challenges.cloudflare.com');
  });

  test('geaendertes Skript nach dem Bauschritt = Fehler (Deploy bricht ab)', () => {
    const gebaut = mitHashes(lies('frontend/partner.html'));
    const kaputt = gebaut.replace('<script>', '<script> ');
    expect(pruefe(kaputt).some(p => p.startsWith('Hash fehlt'))).toBe(true);
    expect(pruefe(kaputt).some(p => p.startsWith('Hash ohne Skript'))).toBe(true);
  });

  test('Inline-Handler und javascript:-URLs werden erkannt', () => {
    const basis = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">';
    expect(pruefe(`${basis}<button onclick="x()">a</button>`)).toContain('Inline-Handler (on…=) im Markup');
    expect(pruefe(`${basis}<script>el.innerHTML = '<a onclick="y()">b</a>';</script>`.replace('script-src \'self\'', `script-src 'self' ${hashVon("el.innerHTML = '<a onclick=\"y()\">b</a>';")}`)))
      .toContain('Inline-Handler (on…=) in erzeugtem HTML');
    expect(pruefe(`${basis}<a href="javascript:void 0">x</a>`)).toContain('javascript:-URL');
    expect(pruefe(`${basis}<script>el.onclick = () => 1;</script>`.replace("'self'", `'self' ${hashVon('el.onclick = () => 1;')}`))).toEqual([]);
  });

  test('Hash wie der Browser: sha256 ueber den Blockinhalt, base64', () => {
    expect(hashVon('')).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  });

  test('Pages-Deploy ruft den Bauschritt nach dem Stempeln und vor dem Upload, mit Pruefung', () => {
    const wf = lies('.github/workflows/deploy.yml');
    const stempeln = wf.indexOf('name: Stand stempeln');
    const csp = wf.indexOf('name: CSP-Hashes setzen');
    const upload = wf.indexOf('name: Upload artifact');
    expect(stempeln).toBeGreaterThan(0);
    expect(csp).toBeGreaterThan(stempeln);
    expect(upload).toBeGreaterThan(csp);
    expect(wf).toContain('node .github/scripts/csp-hashes.mjs --schreiben $SEITEN');
    expect(wf).toContain('node .github/scripts/csp-hashes.mjs --pruefen $SEITEN');
    for (const s of CSP_SEITEN) expect(wf).toContain(`frontend/${s}`);
  });
});

describe('Automatisch abmelden nach 30 Tagen (MC)', () => {
  const index = lies('frontend/index.html');
  const block = index.slice(index.indexOf('// ── Anmelden / Abmelden: Anfang'), index.indexOf('// ── Anmelden / Abmelden: Ende ──'));
  const quelle = block.slice(block.indexOf('const AUTO_ABMELDEN_TAGE'), block.indexOf('let nutzungGemerkt'));
  // eslint-disable-next-line no-new-func
  const autoAbmeldenFaellig = new Function(`${quelle}; return autoAbmeldenFaellig;`)();
  const TAG = 24 * 60 * 60 * 1000;
  const jetzt = Date.UTC(2026, 10, 21);

  test('Regel', () => {
    expect(autoAbmeldenFaellig(String(jetzt - 31 * TAG), jetzt)).toBe(true);
    expect(autoAbmeldenFaellig(String(jetzt - 30 * TAG), jetzt)).toBe(false);
    expect(autoAbmeldenFaellig(String(jetzt - 2 * TAG), jetzt)).toBe(false);
    expect(autoAbmeldenFaellig(null, jetzt)).toBe(false);      // ohne Zeitstempel (Altbestand) nie sofort raus
    expect(autoAbmeldenFaellig('kaputt', jetzt)).toBe(false);
  });

  test('beim Start: faellig -> Daten weg + Maske mit Hinweis; Nutzung beim Aufruf gemerkt; Abmelden loescht den Zeitstempel', () => {
    expect(block).toContain("const AUTO_ABMELDEN_TEXT = 'Nach 30 Tagen ohne Nutzung automatisch abgemeldet.';");
    expect(block).toMatch(/autoAbmeldenFaellig\(zuletzt, Date\.now\(\)\)\) \{\s*datenAufDiesemGeraetLoeschen\(\);\s*anmeldeMaskeZeigen\(AUTO_ABMELDEN_TEXT\);/);
    expect(block).toContain('if (k) { nutzungMerken(); return Promise.resolve(k); }');
    expect(block).toMatch(/MC_DATEN_SCHLUESSEL = \[[^\]]*'mc_zuletzt_genutzt'\]/);
  });

  test('Hinweis in der Maske und im Mouse-over', () => {
    expect(index).toContain('bis du dich abmeldest. Nach 30 Tagen ohne Nutzung automatisch abgemeldet.');
    expect(index).toMatch(/'anmelden':\s+\{ name: 'Anmelden', text: '[^']*Nach 30 Tagen ohne Nutzung automatisch abgemeldet\.' \}/);
  });
});

describe('Anmeldemaske fuer den Passwort-Manager (antwort-SI2-1)', () => {
  const index = lies('frontend/index.html');
  const form = index.slice(index.indexOf('<form id="anmelde-form"'), index.indexOf('</form>', index.indexOf('<form id="anmelde-form"')));
  const block = index.slice(index.indexOf('// ── Anmelden / Abmelden: Anfang'), index.indexOf('// ── Anmelden / Abmelden: Ende ──'));

  test('echtes Formular: post, Benutzer (username) + Schluessel (current-password), stabile name/id', () => {
    expect(form).toContain('<form id="anmelde-form" method="post" action="#" autocomplete="on"');
    expect(form).toMatch(/<input id="anmelde-name" name="username" type="text"[^>]*autocomplete="username"[^>]*required/);
    expect(form).toMatch(/<input id="anmelde-key" name="password" type="password"[^>]*autocomplete="current-password"[^>]*required/);
    expect(form).toContain('<button type="submit" class="korb-aktion korb-aktion-haupt" id="anmelde-ok"');
    expect(form).toContain('placeholder="inhaber oder nicole"');   // nie automation; kein datalist (Projektregel Trefferliste)
    expect(form).not.toContain('automation');
    expect(form).not.toMatch(/readonly/);
  });

  test('Absenden ueber submit mit preventDefault; erst Pruefung am Backend, dann speichern', () => {
    expect(block).toContain("document.getElementById('anmelde-form').addEventListener('submit', async e => {");
    expect(block).toContain("const ANMELDE_NAMEN = ['inhaber', 'nicole'];");
    const s = block.slice(block.indexOf("addEventListener('submit'"));
    const pruefen = s.indexOf('/api/system/wer');
    const speichern = s.indexOf("localStorage.setItem('mc_api_key', key)");
    expect(pruefen).toBeGreaterThan(0);
    expect(speichern).toBeGreaterThan(pruefen);
    expect(s).toContain("if (r.status === 401) { anmeldeFehler('Dieser Schlüssel gilt nicht.'); return; }");
    expect(s).toContain('if (wer !== name) {');
    expect(s).toContain("history.replaceState(history.state, '', location.href)");
  });

  test('Hinweis Passwort-Manager an der Maske und im Mouse-over', () => {
    expect(index).toContain('Du kannst den Schlüssel im Passwort-Manager deines Browsers speichern.</p>');
    expect(index).toContain("'anmelde-key':           { name: 'Schlüssel', text: 'Du kannst den Schlüssel im Passwort-Manager deines Browsers speichern.' },");
    expect(index).toContain("'anmelden': ['anmelde-name', 'anmelde-key', 'anmelden', 'dialog-abbrechen'],");
  });

  test('Gegenregel AMQ1: nur EIN Passwortfeld in MC, Einstellungen nur Stand + "Schlüssel ändern …"', () => {
    expect((index.match(/type="password"/g) ?? []).length).toBe(1);
    expect(index).toContain("document.getElementById('schluessel-aendern').addEventListener('click', () => anmeldeMaskeZeigen());");
  });
});
