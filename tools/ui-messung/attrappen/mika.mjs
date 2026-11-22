// MI1: Mika - Antworten aus den echten Regeln (backend/utils/mika.js) ueber die Attrappen von Dashboard und Auftraegen.
// Zustand "leer": dieselben Formen ohne Treffer (POST-Antworten leert der Verteiler nicht selbst).
import { antwort as auAntwort } from './auftraege.mjs';

const REPO = new URL('../../../backend/', import.meta.url).href;
const MI = await import(REPO + 'utils/mika.js');
const JETZT = new Date('2026-11-19T09:30:00Z');

const LSHOP = { bestellungen: [{ orderId: 'JFN-2026-0031', wahrscheinlichDa: { liste: '2026-11-18', positionen: [{ schluessel: 'EIGEN:2026-0007' }, { schluessel: 'EIGEN:2026-0008' }] } }] };
const ORDER = { id: 48190, number: '48190', status: 'processing', date_created: '2026-11-02T10:15:00', line_items: [
  { id: 1, name: 'Hoodie Vereinswappen groß – Navy – XL', parent_name: 'Hoodie Vereinswappen groß', quantity: 2 },
  { id: 2, name: 'Trikot Heim 2026/27 – BEISPIEL – 7', parent_name: 'Trikot Heim 2026/27', quantity: 1 },
  { id: 3, name: 'Schlüsselband', parent_name: '', quantity: 3 },
] };
const STAND = { artikel: [
  { wcItemId: '1', fertig: false, versendet: false, lshop: { art: 'bestellt', text: 'bestellt JFN-2026-0031 · versandt · GLS · Paket 1' }, lager: { art: 'offen', n: 4, genug: true } },
  { wcItemId: '2', fertig: true, versendet: false, lshop: { art: 'kein', text: 'kein L-Shop-Artikel', grund: 'Trikot' } },
  { wcItemId: '3', fertig: false, versendet: false, lshop: { art: 'kein', text: 'kein L-Shop-Artikel', grund: '' } },
] };

export function antwort(method, pfad, params, body, _seite, zustand) {
  if (String(method).toUpperCase() !== 'POST') return undefined;
  const p = String(pfad || '').replace(/\/+$/, '');
  const leer = zustand === 'leer';
  if (p === '/api/mika/frage') {
    const fuer = String(body?.fuer ?? '');
    const dash = leer ? { kacheln: {}, fehler: [] } : auAntwort('GET', '/api/dashboard', new URLSearchParams(fuer ? { wer: fuer } : {}));
    const au = leer ? { auftraege: [], aufgaben: [], todos: [] } : auAntwort('GET', '/api/auftraege');
    if (body?.frage === 'heute') return MI.mikaHeute({ dash, au, wer: fuer, jetzt: JETZT });
    if (body?.frage === 'dringend') return MI.mikaDringend({ dash, au, lshop: leer ? null : LSHOP, wer: fuer, jetzt: JETZT });
    return { __status: 422, __body: { error: 'Unbekannte Frage.', code: 'mika_frage' } };
  }
  if (p === '/api/mika/suche') {
    const e = MI.sucheEingabe(body ?? {});
    if (e.fehler) return { __status: 422, __body: { error: e.fehler, code: 'mika_eingabe' } };
    if (e.art === 'au') return (leer ? null : MI.mikaSucheAuftrag({ au: auAntwort('GET', '/api/auftraege'), nr: e.nr })) ?? MI.mikaNichtGefunden(e);
    if (leer || e.nr !== '48190') return MI.mikaNichtGefunden(e);
    return MI.mikaSucheShop({ shop: e.shop, order: ORDER, stand: STAND, jetzt: JETZT });
  }
  return undefined;
}
