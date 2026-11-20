// Fasst ergebnis.json zu funde.md zusammen. Auch einzeln: node auswerten.mjs <ergebnis.json> [<vorher.json>]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MASSEN = new Set(['schrift-klein', 'tippflaeche', 'tippflaeche-44', 'tippflaeche-link', 'feld-zoom', 'kontrast']);
const bauteil = sel => sel.split(' > ').pop().replace(/#[\w-]+/, '#id');

/** Zahlen fuer den Vergleich: eindeutige Stellen je Art, Bauteile je Massen-Art (nur 375 px). */
export function zahlen(roh) {
  const stellen = {}, bauteile = {};
  for (const e of roh.ergebnis) for (const f of e.funde) {
    (stellen[f.art] ??= new Set()).add(`${e.ansicht}|${f.sel}`);
    if (MASSEN.has(f.art) && e.breite <= 480) (bauteile[f.art] ??= new Set()).add(bauteil(f.sel));
  }
  const n = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.size]).sort());
  return { stellen: n(stellen), bauteile: n(bauteile) };
}

export function zusammenfassen(roh, vorher = null) {
  const g = new Map();
  for (const e of roh.ergebnis) for (const f of e.funde) {
    const k = `${e.ansicht}|${f.art}|${f.sel}`;
    const x = g.get(k) ?? { ...f, ansicht: e.ansicht, wo: new Set(), bild: null };
    x.wo.add(`${e.zustand === 'leer' ? 'leer ' : ''}${e.breite}${e.modus === 'dark' ? 'd' : 'h'}`);
    x.bild ??= f.bild ?? null;
    g.set(k, x);
  }
  const z = zahlen(roh), zv = vorher ? zahlen(vorher) : null;
  const zeile = (art, a, b) => `| ${art} | ${zv ? `${b ?? 0} → ` : ''}${a ?? 0} |`;
  const out = [`# UI-Messung ${roh.stand}`, '', `Messungen: ${roh.ergebnis.length}. Nicht geladen: ${roh.ergebnis.filter(e => !e.wurzelDa || !e.aktionOk).map(e => `${e.ansicht} ${e.zustand} ${e.breite}${e.aktionOk ? '' : ' (Aktion)'}`).join(', ') || '–'}`, ''];
  out.push('## Eindeutige Stellen je Art', '', `| Art | ${zv ? 'vorher → nachher' : 'Anzahl'} |`, '|---|---|');
  for (const art of [...new Set([...Object.keys(z.stellen), ...Object.keys(zv?.stellen ?? {})])].sort()) out.push(zeile(art, z.stellen[art], zv?.stellen[art]));
  out.push('', '## Bauteile am Handy (375 px)', '', `| Art | ${zv ? 'vorher → nachher' : 'Anzahl'} |`, '|---|---|');
  for (const art of [...new Set([...Object.keys(z.bauteile), ...Object.keys(zv?.bauteile ?? {})])].sort()) out.push(zeile(art, z.bauteile[art], zv?.bauteile[art]));
  out.push('', '## Funde (ohne Massen-Arten)', '', '| Art | Ansicht | wo | Stelle | Text | Detail | Bild |', '|---|---|---|---|---|---|---|');
  const esc = s => String(s ?? '').replace(/\|/g, '\\|').slice(0, 70);
  for (const x of [...g.values()].filter(x => !MASSEN.has(x.art)).sort((a, b) => a.art.localeCompare(b.art) || a.ansicht.localeCompare(b.ansicht))) {
    out.push(`| ${x.art} | ${x.ansicht} | ${[...x.wo].join(',')} | ${esc(x.sel)} | ${esc(x.text)} | ${esc(x.detail)} | ${x.bild ?? ''} |`);
  }
  for (const art of [...MASSEN]) {
    const je = new Map();
    for (const x of g.values()) if (x.art === art) { const b = bauteil(x.sel); const y = je.get(b) ?? { n: 0, d: new Set(), v: new Set() }; y.n++; y.d.add(x.detail); y.v.add(x.ansicht); je.set(b, y); }
    if (!je.size) continue;
    out.push('', `## ${art} je Bauteil`, '', '| Bauteil | Ansichten | Maße |', '|---|---|---|');
    for (const [b, y] of [...je].sort((a, c) => c[1].v.size - a[1].v.size)) out.push(`| ${esc(b)} | ${y.v.size} | ${esc([...y.d].slice(0, 3).join(' '))} |`);
  }
  out.push('', `Ohne Attrappe: ${JSON.stringify(roh.ohneAttrappe)}`, '', `JS-Fehler: ${JSON.stringify(roh.jsFehler)}`, '');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const roh = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const vorher = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
  process.stdout.write(zusammenfassen(roh, vorher));
}
