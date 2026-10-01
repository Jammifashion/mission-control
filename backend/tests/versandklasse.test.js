// Befund Versandklasse (Erfassungsmaske): die Auswahl blieb manchmal stumm leer.
//
// Die Logik steht im Block "Versandklasse" in index.html (reine Funktionen,
// kein document). Der Test fuehrt den Block aus und prueft die Anbindung:
// (a) sichtbare Meldung + "Neu laden", (b) Nachladen beim Reiterwechsel,
// (c) Vorschlag vor der Liste geht nicht verloren, (d) Hinweis bei einer
// gespeicherten Klasse, die es im Shop nicht mehr gibt.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html  = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = (a, e) => html.slice(html.indexOf(a), html.indexOf(e));
const VK    = block('// ── Versandklasse: Anfang', '// ── Versandklasse: Ende ──');
const fe    = new Function(`${VK}\n return { vkLadeFehler, vkSlug, vkAuswahl, VK_TIMEOUT_MS };`)();

const KLASSEN = [
  { id: 11, slug: 'paket', name: 'Paket' },
  { id: 12, slug: 'grossbrief', name: 'Großbrief' },
];

// ════════════════════════════════════════════════════════════════════════════
describe('(a) Ladefehler erkennen', () => {
  test('Liste ok -> kein Fehler', () => {
    expect(fe.vkLadeFehler({ status: 200, daten: KLASSEN })).toBeNull();
  });

  test.each([
    ['Fehlerstatus mit Server-Meldung', { status: 502, daten: { error: 'WC 401' } }, 'HTTP 502 – WC 401'],
    ['Fehlerstatus ohne Meldung',       { status: 401, daten: null },              'HTTP 401'],
    ['leere Liste',                     { status: 200, daten: [] },                'keine Versandklassen im Shop gefunden'],
    ['keine Liste',                     { status: 200, daten: { x: 1 } },          'Antwort ist keine Liste'],
    ['Zeitueberschreitung',             { fehler: Object.assign(new Error('t'), { name: 'TimeoutError' }) }, 'Zeitüberschreitung nach 20 s'],
    ['Abbruch',                         { fehler: Object.assign(new Error('a'), { name: 'AbortError' }) },   'Zeitüberschreitung nach 20 s'],
    ['Netzfehler',                      { fehler: new TypeError('Failed to fetch') },                        'nicht erreichbar (Failed to fetch)'],
  ])('%s -> "%s"', (_n, eingabe, soll) => {
    expect(fe.vkLadeFehler(eingabe)).toBe(soll);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Slug aus ID / Slug / Name', () => {
  test.each([['11', 'paket'], ['paket', 'paket'], ['Großbrief', 'grossbrief']])('%s -> %s', (w, s) => {
    expect(fe.vkSlug(KLASSEN, w)).toBe(s);
  });
  test('leer -> "", unbekannt -> null', () => {
    expect(fe.vkSlug(KLASSEN, '')).toBe('');
    expect(fe.vkSlug(KLASSEN, 'warensendung')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Auswahl nach dem Befuellen', () => {
  test('Liste fehlt noch -> gespeicherter Wert und Vorschlag bleiben offen, kein Hinweis', () => {
    expect(fe.vkAuswahl({ klassen: [], geladen: false, gespeichert: 'paket', vorschlag: 'grossbrief' }))
      .toEqual({ wert: '', offen: 'paket', vorschlagOffen: 'grossbrief', vorschlagGesetzt: '', hinweis: '' });
  });

  test('gespeicherter Wert vorhanden -> gesetzt (auch ueber den Namen)', () => {
    expect(fe.vkAuswahl({ klassen: KLASSEN, geladen: true, gespeichert: 'Großbrief' }))
      .toMatchObject({ wert: 'grossbrief', hinweis: '', offen: '' });
  });

  test('(d) gespeicherte Klasse gibt es nicht mehr -> Hinweis statt stumm leer', () => {
    const a = fe.vkAuswahl({ klassen: KLASSEN, geladen: true, gespeichert: 'warensendung' });
    expect(a.wert).toBe('');
    expect(a.hinweis).toBe('Gespeicherte Versandklasse „warensendung“ gibt es im Shop nicht mehr – bitte neu wählen.');
  });

  test('(d) nicht gefunden -> Vorschlag ueberschreibt die Entscheidung nicht', () => {
    const a = fe.vkAuswahl({ klassen: KLASSEN, geladen: true, gespeichert: 'warensendung', vorschlag: 'paket' });
    expect(a.wert).toBe('');
    expect(a.vorschlagGesetzt).toBe('');
  });

  test('(c) Vorschlag kam vor der Liste -> wird danach gesetzt', () => {
    expect(fe.vkAuswahl({ klassen: KLASSEN, geladen: true, gespeichert: '', vorschlag: 'paket' }))
      .toMatchObject({ wert: 'paket', vorschlagGesetzt: 'paket', vorschlagOffen: '', hinweis: '' });
  });

  test('(c) gespeicherter Wert hat Vorrang vor dem offenen Vorschlag', () => {
    expect(fe.vkAuswahl({ klassen: KLASSEN, geladen: true, gespeichert: 'grossbrief', vorschlag: 'paket' }))
      .toMatchObject({ wert: 'grossbrief', vorschlagGesetzt: '' });
  });

  test('Vorschlag nicht in der Liste -> nichts gesetzt', () => {
    expect(fe.vkAuswahl({ klassen: KLASSEN, geladen: true, gespeichert: '', vorschlag: 'warensendung' }))
      .toMatchObject({ wert: '', vorschlagGesetzt: '' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Anbindung in index.html', () => {
  test('(a) Meldung + Knopf "Neu laden" stehen am Feld', () => {
    const feld = html.slice(html.indexOf('id="pf-shipping"'), html.indexOf('id="pf-shipping"') + 900);
    expect(feld).toContain('id="pf-shipping-status"');
    expect(feld).toMatch(/id="btn-shipping-reload"[^>]*>Neu laden</);
    expect(html).toContain("getElementById('btn-shipping-reload').addEventListener('click', () => ladeVersandklassen());");
  });

  test('(a) Laden geht ueber vkLadeFehler, Fehler werden nicht mehr verschluckt', () => {
    const f = html.slice(html.indexOf('async function ladeVersandklassenEinmal'), html.indexOf('const ladeVersandklassen ='));
    expect(f).toContain('vkLadeFehler({ status, daten, fehler })');
    expect(f).toContain('console.warn(');
    expect(f).toContain("showToast(`Versandklassen nicht geladen: ${grund}`");
    expect(html).toContain('const ladeVersandklassen = einmalGleichzeitig(ladeVersandklassenEinmal);');
    // der alte Sammelabruf mit stummem Fallback ist weg
    expect(html).not.toContain("['wcShippingClasses', `${base}/api/woocommerce/shipping-classes`]");
  });

  test('(b) Reiterwechsel laedt die Versandklassen einzeln nach, auch wenn die Kategorien da sind', () => {
    expect(html).toContain('if (ssot.kategorien.length && !ssot.versandGeladen) ladeVersandklassen();');
  });

  test('(c) Vorschlag ohne Liste wird gemerkt', () => {
    const f = html.slice(html.indexOf('async function maskeVorschlaegeLaden'), html.indexOf("addEventListener('change', maskeVorschlaegeLaden)"));
    expect(f).toContain('else if (neu !== null && !ssot.versandGeladen) {');
    expect(f).toContain('_vkVorschlagOffen = neu;');
  });

  test('(d) Zeile laden und Shop-Artikel laden gehen ueber versandSetzen', () => {
    expect(html).toContain("versandSetzen(d.data['Versandklasse'] || '');");
    expect(html).toContain("versandSetzen(p.shipping_class || '');");
    expect(html).not.toMatch(/getElementById\('pf-shipping'\)\.value = _(sv|wcShipping)/);
  });

  test('populateShipping nutzt vkAuswahl und zeigt den Hinweis', () => {
    const f = html.slice(html.indexOf('function populateShipping()'), html.indexOf('function versandSetzen('));
    expect(f).toContain('vkAuswahl({');
    expect(f).toContain('vkZeigeStatus(a.hinweis, false);');
    expect(f).toContain('Fehler: Versandklassen nicht geladen');
  });
});
