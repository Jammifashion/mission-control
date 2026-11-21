// SI2: CSP Stufe 2 - Inline-Skripte per Hash erlauben statt 'unsafe-inline'.
// Im Repo steht in script-src weiter 'unsafe-inline' (lokale Vorschau laeuft ohne Bauschritt). Der Pages-Deploy
// ruft dieses Skript mit --schreiben NACH dem Stempeln auf: je Seite wird 'unsafe-inline' in script-src durch die
// sha256-Hashes aller Inline-<script>-Bloecke ersetzt. Danach --pruefen: jeder Inline-Block muss seinen Hash in der
// Meta haben, script-src darf kein 'unsafe-inline' mehr tragen, keine Inline-Handler (on…=) und keine javascript:-URLs.
// Abweichung = Exit-Code 1, der Deploy bricht ab. style-src bleibt unveraendert.
//
//   node .github/scripts/csp-hashes.mjs --schreiben frontend/index.html ...
//   node .github/scripts/csp-hashes.mjs --pruefen   frontend/index.html ...

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

export const CSP_SEITEN = ['index.html', 'partner.html', 'partner-festpreis.html', 'bestellen.html', 'anfrage.html'];

const META_RE = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

/** Inhalte aller Inline-<script>-Bloecke (ohne src), genau so, wie der Browser sie hasht. */
export function inlineSkripte(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

export const hashVon = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

/** Die CSP-Meta der Seite (Inhalt) oder null. */
export function cspAus(html) {
  const m = html.match(META_RE);
  return m ? m[2] : null;
}

const direktiven = csp => csp.split(';').map(s => s.trim()).filter(Boolean);
export function scriptSrc(csp) {
  return direktiven(csp).find(d => d.startsWith('script-src ')) ?? null;
}

/** HTML mit Hashes statt 'unsafe-inline' in script-src. Wirft, wenn Meta oder script-src fehlen. */
export function mitHashes(html) {
  const csp = cspAus(html);
  if (csp === null) throw new Error('CSP-Meta fehlt');
  const alt = scriptSrc(csp);
  if (!alt) throw new Error('script-src fehlt in der CSP');
  const hashes = [...new Set(inlineSkripte(html).map(hashVon))];
  const teile = alt.split(/\s+/).filter(t => t !== "'unsafe-inline'" && !t.startsWith("'sha256-"));
  const neu = [teile[0], teile[1] === "'self'" ? "'self'" : null, ...hashes, ...teile.slice(1).filter(t => t !== "'self'")]
    .filter(Boolean).join(' ');
  const cspNeu = csp.replace(alt, neu);
  return html.replace(META_RE, (_g, a, _b, c) => `${a}${cspNeu}${c}`);
}

/** Liste der Probleme einer (gebauten) Seite; leer = in Ordnung. */
export function pruefe(html) {
  const probleme = [];
  const csp = cspAus(html);
  if (csp === null) return ['CSP-Meta fehlt'];
  const src = scriptSrc(csp);
  if (!src) return ['script-src fehlt'];
  if (src.split(/\s+/).includes("'unsafe-inline'")) probleme.push("script-src enthaelt noch 'unsafe-inline'");
  const erlaubt = new Set(src.split(/\s+/).filter(t => t.startsWith("'sha256-")));
  const noetig = new Set(inlineSkripte(html).map(hashVon));
  for (const h of noetig) if (!erlaubt.has(h)) probleme.push(`Hash fehlt: ${h}`);
  for (const h of erlaubt) if (!noetig.has(h)) probleme.push(`Hash ohne Skript: ${h}`);
  // Inline-Handler im Markup (auch in erzeugtem HTML in Skript-Strings) waeren ohne 'unsafe-inline' tot.
  const ohneSkripte = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(ohneSkripte)) probleme.push('Inline-Handler (on…=) im Markup');
  for (const s of inlineSkripte(html)) {
    if (/<[a-z][^<>]*\son[a-z]+\s*=\s*["']/i.test(s)) { probleme.push('Inline-Handler (on…=) in erzeugtem HTML'); break; }
  }
  if (/href\s*=\s*["']\s*javascript:/i.test(html)) probleme.push('javascript:-URL');
  return probleme;
}

// ── Aufruf von der Kommandozeile ──
const istHaupt = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (istHaupt) {
  const [modus, ...dateien] = process.argv.slice(2);
  if (!['--schreiben', '--pruefen'].includes(modus) || !dateien.length) {
    console.error('Aufruf: csp-hashes.mjs --schreiben|--pruefen <datei.html> ...');
    process.exit(2);
  }
  let fehler = 0;
  for (const datei of dateien) {
    const html = readFileSync(datei, 'utf8');
    if (modus === '--schreiben') {
      const neu = mitHashes(html);
      writeFileSync(datei, neu);
      console.log(`${datei}: ${inlineSkripte(neu).length} Inline-Skripte gehasht`);
    }
    const probleme = pruefe(readFileSync(datei, 'utf8'));
    if (modus === '--pruefen' || probleme.length) {
      for (const p of probleme) console.log(`::error::${datei}: ${p}`);
      if (!probleme.length) console.log(`${datei}: CSP ok (${inlineSkripte(html).length} Hashes)`);
    }
    fehler += probleme.length;
  }
  process.exit(fehler ? 1 : 0);
}
