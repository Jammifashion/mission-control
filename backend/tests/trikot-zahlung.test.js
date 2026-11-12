// TR9: Bezahlstand im Trikot-Reiter (nur Anzeige) und Rueckfrage beim Versand unbezahlter Bestellungen. Nur erfundene Daten.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zahlungStufe, offeneOrderIds, mitZahlung } from '../utils/trikot-zahlung.js';
import { mitTrikotZahlung, trikotZahlungCacheLeeren } from '../lib/trikotZahlung.js';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const URL_ = 'https://shop.example';
const zeile = (o = {}) => ({ zeile: 2, id: '100|1|1', orderId: '100', kundeFertig: false, storniert: false, hinweise: [], ...o });
const ansicht = () => ({
  summen: { offen: 0, chargen: 1, da: 0, zeilen: 4 },
  gruppen: [
    { charge: '7', offen: false, zeilen: [zeile(), zeile({ zeile: 3, orderId: '101' }), zeile({ zeile: 4, orderId: '102', kundeFertig: true })] },
    { charge: '', offen: true, zeilen: [zeile({ zeile: 5, id: 'INT-2026-0001', orderId: '' })] },
    { storniert: true, zeilen: [zeile({ zeile: 6, orderId: '103', storniert: true })] },
  ],
});

describe('Regel unbezahlt (gemessen 12.11.: on-hold + bacs ohne date_paid)', () => {
  test.each([
    [{ status: 'on-hold', date_paid: null }, 'unbezahlt'],
    [{ status: 'pending', date_paid: null }, 'unbezahlt'],
    [{ status: 'failed', date_paid: null }, 'unbezahlt'],
    [{ status: 'processing', date_paid: '2026-11-01T10:00:00' }, ''],
    [{ status: 'on-hold', date_paid: '2026-11-01T10:00:00' }, ''],
    [{ status: 'completed', date_paid: null }, ''],
    [{ status: 'refunded', date_paid: '2026-11-01T10:00:00' }, 'erstattet'],
    [{ status: 'cancelled', date_paid: null }, 'storniert'],
    [null, 'fehlt'],
  ])('%j -> %s', (o, stufe) => expect(zahlungStufe(o)).toBe(stufe));
});

describe('Ansicht + Bezahlstand', () => {
  test('gelesen werden nur offene Shop-Bestellungen (nicht beim Kunden fertig, nicht INT, nicht entfernt)', () => {
    expect(offeneOrderIds(ansicht())).toEqual(['100', '101']);
  });
  test('Kennzeichen + Link nur an Zeilen auffaelliger Bestellungen, Zaehler je Stufe', () => {
    const je = new Map([['100', { id: 100, status: 'on-hold', date_paid: null }], ['101', { id: 101, status: 'processing', date_paid: 'x' }]]);
    const r = mitZahlung(ansicht(), je, URL_);
    expect(r.gruppen[0].zeilen[0].zahlung).toEqual({ stufe: 'unbezahlt', text: 'nicht bezahlt', link: 'https://shop.example/wp-admin/post.php?post=100&action=edit' });
    expect(r.gruppen[0].zeilen[1].zahlung).toBeUndefined();
    expect(r.gruppen[0].zeilen[2].zahlung).toBeUndefined();
    expect(r.zahlung).toEqual({ unbezahlt: 1 });
    expect(JSON.stringify(r)).not.toMatch(/date_paid|total|billing/);
  });
  test('Shop nicht lesbar: Ansicht unveraendert, Hinweis', () => {
    const r = mitZahlung(ansicht(), null, URL_, 'nicht lesbar');
    expect(r.zahlung).toBeNull();
    expect(r.zahlungHinweis).toBe('nicht lesbar');
    expect(r.gruppen[0].zeilen[0].zahlung).toBeUndefined();
  });
  test('gesammelt und zwischengespeichert: ein Abruf je Lauf, danach aus dem Speicher; Fehler -> ohne Bezahlstand', async () => {
    trikotZahlungCacheLeeren();
    const aufrufe = [];
    const laden = async ids => { aufrufe.push(ids); return new Map([['100', { id: 100, status: 'on-hold', date_paid: null }], ['101', null]]); };
    const r1 = await mitTrikotZahlung(ansicht(), { jetzt: 1000, laden });
    expect(aufrufe).toEqual([['100', '101']]);
    expect(r1.zahlung).toEqual({ unbezahlt: 1, fehlt: 1 });
    await mitTrikotZahlung(ansicht(), { jetzt: 2000, laden });
    expect(aufrufe).toHaveLength(1);
    trikotZahlungCacheLeeren();
    const r3 = await mitTrikotZahlung(ansicht(), { jetzt: 3000, laden: async () => { throw new Error('Zeitlimit'); } });
    expect(r3.zahlung).toBeNull();
    expect(r3.zahlungHinweis).toMatch(/nicht lesbar/);
  });
});

describe('Oberflaeche', () => {
  const block = html.slice(html.indexOf('// ── Trikots: Anfang'), html.indexOf('// ── Trikots: Ende ──'));
  test('Kennzeichen orange mit Mouse-over, Link wie BS4, Filter nur Unbezahlte', () => {
    const F = new Function(`${block}\nreturn { trZahlungHtml, trNurUnbezahlt, trListeHtml, trSummeText };`)();
    const k = { stufe: 'unbezahlt', text: 'nicht bezahlt', link: 'https://shop.example/wp-admin/post.php?post=100&action=edit' };
    const h = F.trZahlungHtml({ zahlung: k });
    expect(h).toContain('class="tr-zahlung tr-zahlung-unbezahlt" tabindex="0" data-hilfe="tr-zahlung-unbezahlt">nicht bezahlt</span>');
    expect(h).toContain('target="_blank" rel="noopener" data-hilfe="ps-shop-link">Im Shop öffnen ↗</a>');
    expect(h).not.toContain('title=');
    expect(F.trZahlungHtml({ zahlung: { ...k, link: 'javascript:x' } })).not.toContain('<a ');
    expect(F.trZahlungHtml({})).toBe('');
    const d = { gruppen: [{ charge: '7', zeilen: [{ zahlung: k }, {}] }, { charge: '8', zeilen: [{}] }] };
    expect(F.trNurUnbezahlt(d).gruppen).toHaveLength(1);
    expect(F.trNurUnbezahlt(d).gruppen[0].zeilen).toHaveLength(1);
    expect(F.trSummeText({ summen: { offen: 0, chargen: 1, da: 0, zeilen: 2, goalieOffen: 0 }, zahlung: { unbezahlt: 2 } })).toMatch(/· 2 nicht bezahlt$/);
    expect(html).toMatch(/\.tr-zahlung \{[^}]*border: 1px solid var\(--warning\); color: var\(--warning\)/);
    expect(html).toContain('/api/bestellen/trikots?mit=zahlung');
  });
  test('Bestellungen (JFN): Versendet und Abschliessen einer unbezahlten Bestellung nur nach Rueckfrage, nichts gesperrt', () => {
    const ps = html.slice(html.indexOf('// ── Produktion-Stand: Anfang'), html.indexOf('// ── Produktion-Stand: Ende ──'));
    const F = new Function(`${ps}\nreturn { psUnbezahlt };`)();
    expect(F.psUnbezahlt({ status: 'on-hold', date_paid: null })).toBe(true);
    expect(F.psUnbezahlt({ status: 'processing', date_paid: 'x' })).toBe(false);
    expect(html).toMatch(/field === 'versendet' && newVal && psUnbezahlt\(/);
    expect(html).toMatch(/async function completeOrder\(orderId\) \{\s*\/\/ TR9[^\n]*\n\s*if \(psUnbezahlt\(/);
  });
});
