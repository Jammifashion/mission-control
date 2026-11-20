// Im zweiten Script-Block von frontend/index.html (ab SECTION Partnerportal) muss jeder Text, der in HTML landet,
// durch eine Escape-Funktion gehen. Heuristik: Template-Literale mit "<" (und ihre verschachtelten Ausdruecke), Verkettungen mit
// einem String, der "<" enthaelt, sowie Zuweisungen an innerHTML. Gemeldet wird jeder Ausdruck, der weder escapt noch
// nachweislich ungefaehrlich ist (Zahl, Literal, ...Html(-Baustein, encodeURIComponent, Laenge ...). Was bewusst bleibt,
// steht in tests/hilfen/escape-bestand.json (Ausdruck als Text) - neue unescapte Werte fallen auf.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.ESCAPE_HTML_DATEI || resolve(hier, '../../frontend/index.html'), 'utf8');   // Datei nur zum Gegenprobe-Lauf
const BESTAND = JSON.parse(readFileSync(resolve(hier, 'hilfen/escape-bestand.json'), 'utf8'));

function zweiterBlock() {
  const anker = html.indexOf('// ── SECTION: Partnerportal ──');
  const start = html.lastIndexOf('<script>', anker);
  const ende = html.indexOf('</script>', anker);
  if (anker < 0 || start < 0 || ende < 0) throw new Error('zweiter Script-Block nicht gefunden');
  return html.slice(start + '<script>'.length, ende);
}

// Funktionen, deren Ergebnis HTML-sicher ist (Escape oder fertige Bausteine bzw. reine Zahlen/Formate)
const ESCAPE = new Set(['_escHtml', 'pkEsc', 'fpEsc']);
const SICHER_AUFRUF = new Set([
  'encodeURIComponent', 'Number', 'parseInt', 'parseFloat', 'Math.round', 'Math.abs', 'Math.max', 'Math.min', 'String(Number',
  'pkEuro', '_eur', 'eur', 'fmtEur', '_fmtEur', 'fmt', 'pct',
]);
const SICHER_METHODE = new Set(['toFixed', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'padStart', 'length']);
// Bausteine, die selbst escaptes HTML liefern: Name endet auf Html/HTML (geprueft: alle Bausteine im Block escapen ihre Texte)
const BAUSTEIN = /(Html|HTML)$/;

const quelle = zweiterBlock();
const ast = parse(quelle, { sourceType: 'script', errorRecovery: false, ranges: false });
const text = n => quelle.slice(n.start, n.end).replace(/\s+/g, ' ').trim();
const zeile = n => n.loc.start.line;

function name(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed) {
    const o = callee.object.type === 'Identifier' ? callee.object.name
      : callee.object.type === 'MemberExpression' && !callee.object.computed ? `${name(callee.object)}` : '';
    return o ? `${o}.${callee.property.name}` : callee.property.name;
  }
  return '';
}

const KINDER_AUS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);
const istFunktion = k => /Function/.test(k.type);
const istBereich = k => k.type === 'Program' || k.type === 'BlockStatement' || istFunktion(k);

// Bindungen (const/let/var und Parameter) mit ihrem Gueltigkeitsbereich und allen Zuweisungen -
// damit eine lokale Variable wie `opts = liste.map(x => `<option>${_escHtml(x)}</option>`).join('')`
// als sicher gilt, wenn alles, was ihr zugewiesen wird, sicher ist.
const bindungen = [];
const zuweisungen = [];
(function lauf(k, bereiche) {
  if (!k || typeof k !== 'object') return;
  if (Array.isArray(k)) { k.forEach(x => lauf(x, bereiche)); return; }
  if (!k.type) return;
  const hier = istBereich(k) ? [...bereiche, k] : bereiche;
  if (k.type === 'VariableDeclarator' && k.id.type === 'Identifier') {
    const b = bereiche[bereiche.length - 1];
    bindungen.push({ name: k.id.name, werte: k.init ? [k.init] : [], start: b.start, end: b.end, param: false });
  }
  // xs.map((x, i) => ...): i ist eine Zahl; ['a', 'b'].map(v => ...) bzw. FESTE_LISTE.map(v => ...): v ist ein festes Literal
  if (k.type === 'CallExpression' && k.callee.type === 'MemberExpression' && !k.callee.computed
      && ['map', 'flatMap', 'forEach'].includes(k.callee.property.name) && k.arguments[0] && istFunktion(k.arguments[0])) {
    const fn = k.arguments[0];
    if (fn.params[1]?.type === 'Identifier') fn._sicher = new Set([fn.params[1].name]);
    let liste = k.callee.object;
    if (liste.type === 'Identifier') { const b = bindungAn(liste.name, liste.start); liste = b && !b.param && b.werte.length === 1 ? b.werte[0] : null; }
    if (liste?.type === 'ArrayExpression' && liste.elements.every(e => e && (e.type === 'StringLiteral' || e.type === 'NumericLiteral'))
        && fn.params[0]?.type === 'Identifier') (fn._sicher ??= new Set()).add(fn.params[0].name);
  }
  if (istFunktion(k)) {
    for (const p of k.params) {
      const ids = [];
      (function sammle(x) { if (!x) return; if (x.type === 'Identifier') ids.push(x.name); else if (x.type === 'AssignmentPattern') sammle(x.left); else if (x.type === 'ObjectPattern') x.properties.forEach(pr => sammle(pr.value ?? pr.argument)); else if (x.type === 'ArrayPattern') x.elements.forEach(sammle); else if (x.type === 'RestElement') sammle(x.argument); })(p);
      for (const nm of ids) bindungen.push({ name: nm, werte: [], start: k.start, end: k.end, param: true, fest: !!k._sicher?.has(nm) });
    }
    if (k.type === 'FunctionDeclaration' && k.id) {
      const b = bereiche[bereiche.length - 1];
      bindungen.push({ name: k.id.name, werte: [], start: b.start, end: b.end, param: false, funktion: k });
    }
  }
  if (k.type === 'AssignmentExpression' && k.left.type === 'Identifier') zuweisungen.push({ name: k.left.name, pos: k.start, wert: k.right, op: k.operator });
  for (const s of Object.keys(k)) if (!KINDER_AUS.has(s)) lauf(k[s], hier);
})(ast.program, []);

function bindungAn(nm, pos) {
  let beste = null;
  for (const b of bindungen) if (b.name === nm && b.start <= pos && pos < b.end && (!beste || b.start >= beste.start)) beste = b;
  return beste;
}
for (const z of zuweisungen) { const b = bindungAn(z.name, z.pos); if (b) b.werte.push(z.op === '=' || z.op === '+=' ? z.wert : null); }

const inPruefung = new Set();
function identSicher(n) {
  const b = bindungAn(n.name, n.start);
  if (b?.fest) return true;
  if (!b || b.param || b.funktion || !b.werte.length || b.werte.includes(null)) return false;
  if (inPruefung.has(b)) return true;   // Kreis: die anderen Werte entscheiden
  inPruefung.add(b);
  try { return b.werte.every(w => unsicher(w).length === 0); } finally { inPruefung.delete(b); }
}

// Aufruf einer lokalen Funktion (function f / const f = () => ...): sicher, wenn alle ihre Rueckgaben sicher sind
function aufrufSicher(n) {
  if (n.callee.type !== 'Identifier') return false;
  const b = bindungAn(n.callee.name, n.start);
  if (!b || b.param) return false;
  const fn = b.funktion ?? (b.werte.length === 1 && b.werte[0] && istFunktion(b.werte[0]) ? b.werte[0] : null);
  if (!fn) return false;
  if (inPruefung.has(b)) return true;
  inPruefung.add(b);
  try { return rueckgaben(fn).every(w => unsicher(w).length === 0); } finally { inPruefung.delete(b); }
}

// .replace(/[^A-Za-z0-9_-]/g, '') laesst nur ungefaehrliche Zeichen uebrig
const istFilterReplace = n => n.arguments[0]?.type === 'RegExpLiteral' && /^\[\^[A-Za-z0-9_\\-]+\]\+?$/.test(n.arguments[0].pattern)
  && n.arguments[1]?.type === 'StringLiteral' && n.arguments[1].value === '';

// Rueckgabe: Liste unsicherer Teil-Ausdruecke (leer = sicher)
function unsicher(n) {
  switch (n.type) {
    case 'Identifier': return identSicher(n) ? [] : [n];
    case 'ArrayExpression': return n.elements.filter(Boolean).flatMap(unsicher);
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': case 'NullLiteral': return [];
    case 'TemplateLiteral': return n.expressions.flatMap(unsicher);
    case 'ConditionalExpression': return [...unsicher(n.consequent), ...unsicher(n.alternate)];
    case 'LogicalExpression':
      return n.operator === '&&' ? unsicher(n.right) : [...unsicher(n.left), ...unsicher(n.right)];
    case 'BinaryExpression':
      return n.operator === '+' ? [...unsicher(n.left), ...unsicher(n.right)] : [];   // - * / % < === ... = Zahl/Boolean
    case 'UnaryExpression': return [];
    case 'UpdateExpression': return [];
    case 'SequenceExpression': return unsicher(n.expressions[n.expressions.length - 1]);
    case 'AwaitExpression': return unsicher(n.argument);
    case 'MemberExpression':
      if (!n.computed && SICHER_METHODE.has(n.property.name)) return [];
      // ({ a: 'x', b: 'y' })[s] - Nachschlagen in einer festen Tabelle
      if (n.computed && n.object.type === 'ObjectExpression') return n.object.properties.flatMap(pr => pr.value ? unsicher(pr.value) : [pr]);
      return [n];
    case 'CallExpression': case 'OptionalCallExpression': {
      const c = n.callee;
      const nm = name(c);
      const letzter = nm.split('.').pop();
      if (ESCAPE.has(nm) || ESCAPE.has(letzter)) return [];
      if (SICHER_AUFRUF.has(nm) || SICHER_METHODE.has(letzter)) return [];
      if (BAUSTEIN.test(letzter)) return [];
      if (aufrufSicher(n)) return [];
      if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed) {
        // xs.map(fn).join(sep) / xs.map(fn) / xs.filter(...).map(fn).join(...): sicher, wenn fn Sicheres liefert
        if (letzter === 'join') return unsicher(c.object);
        if (letzter === 'map' || letzter === 'flatMap') {
          const fn = n.arguments[0];
          if (fn?.type === 'Identifier' && ESCAPE.has(fn.name)) return [];   // xs.map(_escHtml)
          return rueckgaben(fn).flatMap(unsicher);
        }
        if (letzter === 'replace' && istFilterReplace(n)) return [];
        if (['slice', 'trim', 'replace', 'filter', 'concat'].includes(letzter)) return unsicher(c.object);
      }
      return [n];
    }
    case 'ArrowFunctionExpression': case 'FunctionExpression': return [];
    default: return [n];
  }
}
function rueckgaben(fn) {
  if (!fn || !/Function/.test(fn.type)) return fn ? [fn] : [];
  if (fn.body.type !== 'BlockStatement') return [fn.body];
  const r = [];
  (function lauf(k) {
    if (!k || typeof k !== 'object') return;
    if (Array.isArray(k)) { k.forEach(lauf); return; }
    if (k !== fn.body && /Function/.test(k.type)) return;
    if (k.type === 'ReturnStatement' && k.argument) r.push(k.argument);
    for (const s of Object.keys(k)) if (s !== 'loc' && s !== 'leadingComments' && s !== 'trailingComments') lauf(k[s]);
  })(fn.body);
  return r;
}

const istHtmlTemplate = n => n.type === 'TemplateLiteral' && n.quasis.some(q => q.value.raw.includes('<'));
const istHtmlString = n => (n.type === 'StringLiteral' && n.value.includes('<')) || istHtmlTemplate(n);
function kettenTeile(n) { return n.type === 'BinaryExpression' && n.operator === '+' ? [...kettenTeile(n.left), ...kettenTeile(n.right)] : [n]; }

const funde = new Map();   // text -> Zeilen im Block
function melde(liste) { for (const u of liste) { const t = text(u); if (!funde.has(t)) funde.set(t, []); funde.get(t).push(zeile(u)); } }

(function lauf(k, elternKette) {
  if (!k || typeof k !== 'object') return;
  if (Array.isArray(k)) { k.forEach(x => lauf(x, false)); return; }
  if (istHtmlTemplate(k)) melde(k.expressions.flatMap(unsicher));
  if (k.type === 'BinaryExpression' && k.operator === '+' && !elternKette) {
    const teile = kettenTeile(k);
    if (teile.some(istHtmlString)) melde(teile.filter(t => !istHtmlString(t)).flatMap(unsicher));
  }
  if (k.type === 'AssignmentExpression' && k.left.type === 'MemberExpression' && !k.left.computed
      && ['innerHTML', 'outerHTML'].includes(k.left.property.name)) melde(unsicher(k.right));
  // showConfirm(titel, html, ...) setzt Titel und Text per innerHTML; insertAdjacentHTML(pos, html)
  if (k.type === 'CallExpression') {
    const nm = name(k.callee).split('.').pop();
    if (nm === 'showConfirm') melde(k.arguments.slice(0, 4).flatMap(unsicher));
    if (nm === 'insertAdjacentHTML' && k.arguments[1]) melde(unsicher(k.arguments[1]));
  }
  for (const s of Object.keys(k)) {
    if (s === 'loc' || s === 'leadingComments' || s === 'trailingComments' || s === 'innerComments') continue;
    lauf(k[s], k.type === 'BinaryExpression' && k.operator === '+' && (s === 'left' || s === 'right'));
  }
})(ast.program, false);

test('zweiter Block: kein unescapter Text in HTML (ausser Bestandsliste)', () => {
  const neu = [...funde.entries()].filter(([t]) => !BESTAND.includes(t)).map(([t, z]) => `Zeile ${z.join(', ')} im Block: ${t}`);
  if (process.env.ESCAPE_LISTE) console.log(neu.join('\n'));
  expect(neu).toEqual([]);
});

test('Bestandsliste enthaelt nur noch vorhandene Ausdruecke', () => {
  expect(BESTAND.filter(t => !funde.has(t))).toEqual([]);
});

test('Escape-Funktion des Blocks ersetzt alle fuenf Zeichen', () => {
  const m = quelle.match(/function _escHtml\(s\) \{[\s\S]*?\n {6}\}/);
  expect(m).not.toBeNull();
  const _escHtml = new Function(`${m[0]}; return _escHtml;`)();
  expect(_escHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  expect(_escHtml(null)).toBe('');
});
