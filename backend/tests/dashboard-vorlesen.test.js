// DB2: Dashboard "Vorlesen" - Textbau (Block "Dashboard-Vorlesen") und Knopf-Steuerung in frontend/index.html.
// Nur erfundene Daten.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Dashboard-Vorlesen: Anfang'), html.indexOf('// ── Dashboard-Vorlesen: Ende ──'));
const { dbVorleseSaetze, dbvAbschnitte } = new Function(`${block}\nreturn { dbVorleseSaetze, dbvAbschnitte };`)();
const text = (d, jetzt) => dbVorleseSaetze(d, jetzt).join(' ');

// Freitag, 6.11.2026: 08:30 Berlin = 07:30 UTC, 14:00 Berlin = 13:00 UTC, 19:00 Berlin = 18:00 UTC
const MORGEN = new Date('2026-11-06T07:30:00Z');
const MITTAG = new Date('2026-11-06T13:00:00Z');
const ABEND = new Date('2026-11-06T18:00:00Z');

const NULL_KACHELN = {
  hinweise: { zahl: 0, liste: [] }, lange: { zahl: 0, aeltester: null, rot: false, liste: [] }, todos: { ueberfaellig: 0, heute: 0 },
  rueckstand: { positionen: 0, stueck: 0, kritisch: 0, veraltet: false, liste: true }, ware: { zahl: 0 }, abholung: { zahl: 0 },
  trikots: { nichtBeimProduzenten: 0, goalie: 0, ueber6Wochen: 0 },
};
const leer = (x = {}) => ({ shop: 'jfn', wer: '', fehler: [], kacheln: NULL_KACHELN, neu: [], geld: { heute: 0, sieben: 0, offen: 0, tage: Array(7).fill({ betrag: 0 }) }, ...x });

// Erfundene Namen und Nummern - duerfen nie im Text landen
const NAMEN = ['Erika Testfrau', 'Max Beispielmann', 'FC Erfunden 1899', 'MÜLLERSOHN', 'Goaliename'];
const NUMMERN = ['90015', '90016', 'AU-2026-0006', 'AG-2026-0002', 'K-00042'];
const voll = (x = {}) => leer({
  neu: [
    { art: 'shop', shop: 'jfn', nr: '90015', id: 90015, kunde: NAMEN[0], betrag: 89.7, hinweis: true },
    { art: 'shop', shop: 'jfn', nr: '90016', id: 90016, kunde: NAMEN[1], betrag: 20, hinweis: false },
    { art: 'au', nr: 'AU-2026-0006', titel: 'Hoodies', kunde: NAMEN[2] },
    { art: 'ag', nr: 'AG-2026-0002', titel: 'Musterteile prüfen' },
  ],
  kacheln: {
    hinweise: { zahl: 2, liste: [{ nr: '90015', kunde: NAMEN[0], text: `Bitte ${NAMEN[3]} auf den Rücken` }] },
    lange: { zahl: 3, aeltester: 16, rot: true, liste: [{ art: 'au', nr: 'AU-2026-0006', kunde: NAMEN[2] }] },
    todos: { ueberfaellig: 1, heute: 2 },
    rueckstand: { positionen: 4, stueck: 9, kritisch: 1, veraltet: true, liste: true },
    ware: { zahl: 2 }, abholung: { zahl: 1 },
    trikots: { nichtBeimProduzenten: 5, goalie: 1, ueber6Wochen: 2 },
  },
  geld: { heute: 120.4, sieben: 900, offen: 50, tage: [10, 20, 30, 40, 50, 1234.49, 120.4].map(betrag => ({ betrag })) },
  ...x,
});

describe('Textbau', () => {
  test('Begruessung + Wochentag/Datum in Europe/Berlin', () => {
    expect(dbVorleseSaetze(leer(), MORGEN).slice(0, 2)).toEqual(['Guten Morgen.', 'Heute ist Freitag, der 6. November.']);
    expect(dbVorleseSaetze(leer(), MITTAG)[0]).toBe('Guten Tag.');
    expect(dbVorleseSaetze(leer(), ABEND)[0]).toBe('Guten Abend.');
    // 23:30 UTC am 6.11. = 00:30 Berlin am 7.11. (Samstag)
    expect(dbVorleseSaetze(leer(), new Date('2026-11-06T23:30:00Z')).slice(0, 2)).toEqual(['Guten Morgen.', 'Heute ist Samstag, der 7. November.']);
  });
  test('alles 0: "Alles erledigt, nichts Offenes." und kein Umsatz-Satz', () => {
    expect(text(leer(), MORGEN)).toBe('Guten Morgen. Heute ist Freitag, der 6. November. Alles erledigt, nichts Offenes.');
  });
  test('voller Tag: Reihenfolge Neu, Zu tun, Geld; Mehrzahl', () => {
    expect(dbVorleseSaetze(voll(), MITTAG)).toEqual([
      'Guten Tag.', 'Heute ist Freitag, der 6. November.',
      'Seit gestern 2 neue Bestellungen im Jammifashion Shop, eine davon mit Kundenhinweis.',
      'Dazu ein neuer Auftrag und eine neue Aufgabe.',
      '2 Kundenhinweise ungelesen.',
      '3 Aufträge warten über 7 Tage, der älteste 16 Tage.',
      'To-dos: 1 überfällig, 2 heute fällig.',
      '2 Aufträge warten auf Ware.',
      'Eine Abholung offen.',
      'L-Shop-Rückstand: 4 Positionen, davon eine kritisch, Liste veraltet.',
      'Trikots: 2 Bestellungen über 6 Wochen, 1 Goalie offen.',
      'Umsatz gestern 1.234 Euro.',
    ]);
  });
  test('Einzahl', () => {
    const d = voll({
      neu: [{ art: 'shop', shop: 'jfn', nr: '1', hinweis: true }, { art: 'au', nr: 'AU-2026-0001' }, { art: 'au', nr: 'AU-2026-0002' }],
      kacheln: { ...NULL_KACHELN, hinweise: { zahl: 1 }, lange: { zahl: 1, aeltester: 9 }, todos: { ueberfaellig: 0, heute: 1 }, ware: { zahl: 1 },
        abholung: { zahl: 3 }, rueckstand: { positionen: 1, kritisch: 0, veraltet: false, liste: true }, trikots: { goalie: 0, ueber6Wochen: 1 } },
    });
    expect(dbVorleseSaetze(d, MITTAG).slice(2, -1)).toEqual([
      'Seit gestern eine neue Bestellung im Jammifashion Shop, mit Kundenhinweis.', 'Dazu 2 neue Aufträge.',
      'Ein Kundenhinweis ungelesen.', 'Ein Auftrag wartet über 7 Tage, seit 9 Tagen.', 'To-dos: 1 heute fällig.',
      'Ein Auftrag wartet auf Ware.', '3 Abholungen offen.', 'L-Shop-Rückstand: eine Position.', 'Trikots: eine Bestellung über 6 Wochen.',
    ]);
  });
  test('nur Auftraege neu, keine Bestellungen', () => {
    const d = leer({ neu: [{ art: 'au', nr: 'AU-2026-0003' }] });
    expect(dbVorleseSaetze(d, MORGEN)[2]).toBe('Seit gestern ein neuer Auftrag.');
  });
  test('nur was > 0 ist: Rueckstand 0 ohne Satz, veraltete Liste trotzdem; keine Liste = still', () => {
    const k = (rueckstand) => text(leer({ kacheln: { ...NULL_KACHELN, rueckstand } }), MORGEN);
    expect(k({ positionen: 0, kritisch: 0, veraltet: false, liste: true })).not.toContain('Rückstand');
    expect(k({ positionen: 0, kritisch: 0, veraltet: true, liste: true })).toContain('Die Rückstandsliste ist veraltet.');
    expect(k({ positionen: 0, kritisch: 0, veraltet: false, liste: false })).toContain('Alles erledigt');
  });
  test('Geld: vor 18 Uhr gestern, ab 18 Uhr heute bisher; gerundet; 0 = still', () => {
    expect(text(voll(), MORGEN)).toContain('Umsatz gestern 1.234 Euro.');
    expect(text(voll(), ABEND)).toContain('Umsatz heute bisher 120 Euro.');
    expect(text(voll({ geld: { heute: 0.4, tage: Array(7).fill({ betrag: 0.3 }) } }), ABEND)).not.toContain('Umsatz');
    expect(text(voll({ geld: { fehlt: ['shop_jfn'] } }), MORGEN)).not.toContain('Umsatz');
  });
  test('Shop-Wechsel: HONK-Shop ausgeschrieben, Rueckstand/Trikots "nur JFN" werden nicht vorgelesen', () => {
    const d = voll({ shop: 'honk', neu: [{ art: 'shop', shop: 'honk', nr: '5', hinweis: false }],
      kacheln: { ...voll().kacheln, rueckstand: { nurJfn: true }, trikots: { nurJfn: true } } });
    const t = text(d, MITTAG);
    expect(t).toContain('Seit gestern eine neue Bestellung im HONK-Shop.');
    expect(t).not.toMatch(/JFN|Rückstand|Trikots/);
  });
  test('Alle/Christian/Nicole: Person wird genannt, sonst nichts', () => {
    expect(text(leer({ wer: 'Nicole' }), MORGEN)).toContain('Ansicht Nicole.');
    expect(text(leer({ wer: 'Christian' }), MORGEN)).toContain('Ansicht Christian.');
    expect(text(leer({ wer: '' }), MORGEN)).not.toContain('Ansicht');
    expect(text(leer({ wer: NAMEN[0] }), MORGEN)).not.toContain(NAMEN[0]);   // nur die zwei bekannten Werte
  });
  test('fehlende Quellen: Kachel still, ein Satz "Einige Zahlen fehlen."', () => {
    const d = leer({ fehler: ['shop_jfn'], neu: { fehlt: ['shop_jfn'] }, kacheln: { ...NULL_KACHELN, hinweise: { fehlt: ['shop_jfn'] } } });
    expect(dbVorleseSaetze(d, MORGEN).slice(2)).toEqual(['Alles erledigt, nichts Offenes.', 'Einige Zahlen fehlen.']);
    expect(text(leer({ fehler: ['gelesen', 'kunden'] }), MORGEN)).not.toContain('fehlen');
  });
  test('keine Namen, keine Bestell-/Auftragsnummern, keine Hinweistexte', () => {
    for (const jetzt of [MORGEN, ABEND]) {
      const t = text(voll(), jetzt);
      for (const x of [...NAMEN, ...NUMMERN, 'Hoodies', 'Musterteile', '#']) expect([x, t.includes(x)]).toEqual([x, false]);
    }
  });
  test('Laenge: voller Tag hoechstens 82 Woerter (~30 s; DB2-1: +"Aufträge", Inhaber)', () => {
    const t = text(voll({ wer: 'Nicole', fehler: ['auftraege'] }), MITTAG);
    expect(t.split(/\s+/).length).toBeLessThanOrEqual(82);
  });
  test('Abschnitte: ganze Saetze, hoechstens 180 Zeichen, nichts verloren', () => {
    const saetze = dbVorleseSaetze(voll({ wer: 'Nicole' }), MITTAG);
    const ab = dbvAbschnitte(saetze);
    expect(ab.join(' ')).toBe(saetze.join(' '));
    expect(ab.every(x => x.length <= 180)).toBe(true);
    expect(ab.length).toBeLessThan(saetze.length);
    expect(dbvAbschnitte(['x'.repeat(200), 'kurz.'])).toEqual(['x'.repeat(200), 'kurz.']);   // zu langer Einzelsatz bleibt ganz
  });
  test('ohne Daten nur Begruessung', () => {
    expect(dbVorleseSaetze(null, MORGEN)).toEqual(['Guten Morgen.', 'Heute ist Freitag, der 6. November.']);
  });
});

// ── Knopf ──
const steuer = html.slice(html.indexOf('      const dbv = { lauf: 0'), html.indexOf("      dbEl('panel-dashboard').addEventListener('click'"));
function aufbau({ mitSprache = true, daten = voll() } = {}) {
  const el = { 'dash-vorlesen': { hidden: false, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }, 'dash-vorlese-text': { hidden: true, textContent: '' } };
  const gesprochen = [];
  const synth = { warteschlange: [], cancel() { this.abgebrochen = (this.abgebrochen ?? 0) + 1; this.warteschlange = []; this.speaking = false; }, speak(u) { this.speaking = true; this.warteschlange.push(u); gesprochen.push(u); }, speaking: false, pending: false,
    getVoices: () => [{ lang: 'en-US', name: 'E', localService: true }, { lang: 'de-DE', name: 'Google Deutsch', localService: false }, { lang: 'de-DE', name: 'Deutsch', localService: true }] };
  const win = mitSprache ? { speechSynthesis: synth, SpeechSynthesisUtterance: function U(t) { this.text = t; } } : {};
  const horcher = {};
  const doc = { addEventListener: (n, f) => { horcher[n] = f; } };
  const winHorcher = {};
  win.addEventListener = (n, f) => { winHorcher[n] = f; };
  const toasts = [];
  const f = new Function('window', 'document', 'dbEl', 'dbZ', 'showToast', 'dbVorleseSaetze', 'dbvAbschnitte', 'SpeechSynthesisUtterance',
    `${steuer}\nreturn { dbvStart, dbvStopp, dbv };`);
  const api = f(win, doc, id => el[id], { daten }, (m) => toasts.push(m), dbVorleseSaetze, dbvAbschnitte, win.SpeechSynthesisUtterance);
  return { ...api, el, synth, gesprochen, horcher, winHorcher, toasts };
}

describe('Knopf', () => {
  test('ohne speechSynthesis verborgen, Start tut nichts', () => {
    const a = aufbau({ mitSprache: false });
    expect(a.el['dash-vorlesen'].hidden).toBe(true);
    a.dbvStart();
    expect(a.dbv.spricht).toBe(false);
    expect(a.el['dash-vorlesen'].hidden).toBe(true);
  });
  // Ablauf nachspielen: jeden gesprochenen Abschnitt beenden, bis nichts mehr nachkommt (DB2-1: einer nach dem anderen)
  const allesVorlesen = a => { for (let i = 0; i < 50 && a.gesprochen[i]; i++) a.gesprochen[i].onend(); };
  test('Start: Abschnitte NACHEINANDER, de-DE + lokale deutsche Stimme (nie online), Knopf "Stopp", Text sichtbar', () => {
    const a = aufbau();
    expect(a.el['dash-vorlesen'].hidden).toBe(false);
    expect(a.el['dash-vorlesen'].textContent).toBe('🔊 Vorlesen');
    a.dbvStart();
    expect(a.synth.abgebrochen).toBeUndefined();   // nichts lief -> kein cancel() (Android bricht sonst die naechste Aeusserung ab)
    expect(a.gesprochen.length).toBe(1);   // erst der erste Abschnitt
    expect(a.el['dash-vorlesen'].textContent).toBe('⏹ Stopp');
    expect(a.el['dash-vorlesen'].attrs['aria-pressed']).toBe('true');
    expect(a.el['dash-vorlese-text'].hidden).toBe(false);
    a.gesprochen[0].onend();
    expect(a.gesprochen.length).toBe(2);   // der naechste erst nach dem Ende des vorigen
    allesVorlesen(a);
    expect(a.gesprochen.length).toBeGreaterThan(2);
    expect(a.gesprochen.every(u => u.lang === 'de-DE' && u.voice?.name === 'Deutsch')).toBe(true);
    expect(a.el['dash-vorlese-text'].textContent).toBe('');   // fertig -> Text weg
    expect(a.dbv.spricht).toBe(false);
    expect(a.el['dash-vorlesen'].textContent).toBe('🔊 Vorlesen');
    expect(a.el['dash-vorlese-text'].hidden).toBe(true);
  });
  test('Mitlese-Text = alle Abschnitte', () => {
    const a = aufbau();
    a.dbvStart();
    const t = a.el['dash-vorlese-text'].textContent;
    allesVorlesen(a);
    expect(a.gesprochen.map(u => u.text).join(' ')).toBe(t);
  });
  test('Android: Sprache "de_DE" wird erkannt', () => {
    const a = aufbau();
    a.synth.getVoices = () => [{ lang: 'de_DE', name: 'Android Deutsch', localService: true }];
    a.dbvStart();
    expect(a.gesprochen[0].voice?.name).toBe('Android Deutsch');
  });
  test('kein Doppelstart: zweiter Start bricht den ersten ab, altes onend spricht nicht weiter', () => {
    const a = aufbau();
    a.dbvStart();
    const alter = a.gesprochen[0];
    a.dbvStart();
    expect(a.synth.abgebrochen).toBe(1);
    const n = a.gesprochen.length;
    alter.onend();
    expect(a.gesprochen.length).toBe(n);   // alter Lauf haengt nichts an
    expect(a.dbv.spricht).toBe(true);
  });
  test('Stopp und Abbruch beim Ansichtswechsel / Seite weg', () => {
    for (const ausloeser of [a => a.dbvStopp(), a => a.horcher['mc:ansicht'](), a => a.winHorcher.pagehide()]) {
      const a = aufbau();
      a.dbvStart();
      ausloeser(a);
      expect(a.synth.abgebrochen).toBe(1);
      expect(a.dbv.spricht).toBe(false);
      expect(a.el['dash-vorlese-text'].hidden).toBe(true);
      a.gesprochen[0].onend();
      expect(a.gesprochen.length).toBe(1);
      expect(a.dbv.spricht).toBe(false);
    }
  });
  test('Fehler: erst ohne gewaehlte Stimme neu versuchen, dann sauber beenden mit Meldung samt Fehlercode', () => {
    const a = aufbau();
    a.dbvStart();
    a.gesprochen[0].onerror({ error: 'synthesis-failed' });
    expect(a.gesprochen.length).toBe(2);
    expect(a.gesprochen[1].voice).toBeUndefined();
    expect(a.dbv.spricht).toBe(true);
    a.gesprochen[1].onerror({ error: 'synthesis-failed' });
    expect(a.dbv.spricht).toBe(false);
    expect(a.toasts).toEqual(['Vorlesen abgebrochen (synthesis-failed).']);
  });
  test('Fehler nach Beginn: kein zweiter Versuch, Meldung', () => {
    const a = aufbau();
    a.dbvStart();
    a.gesprochen[0].onstart();
    a.gesprochen[0].onerror({ error: 'interrupted' });
    expect(a.gesprochen.length).toBe(1);
    expect(a.dbv.spricht).toBe(false);
    expect(a.toasts).toEqual(['Vorlesen abgebrochen (interrupted).']);
  });
  test('ohne Daten: Toast, kein Sprechen', () => {
    const a = aufbau({ daten: null });
    a.dbvStart();
    expect(a.gesprochen).toEqual([]);
    expect(a.toasts.length).toBe(1);
  });
  test('Verdrahtung: Klick, Wechsel Alle/Christian/Nicole stoppt, Mouse-over ohne title', () => {
    expect(html).toContain("if (ev.target.closest('#dash-vorlesen')) { if (dbv.spricht) dbvStopp(); else dbvStart(); return; }");
    expect(html).toMatch(/dbZ\.wer = wer\.dataset\.dashWer;\n\s+dbvStopp\(\);/);
    expect(html).toMatch(/<button type="button" class="korb-aktion korb-aktion-ruhig" id="dash-vorlesen" data-hilfe="dash-vorlesen" aria-pressed="false" hidden>/);
    expect(html).toContain("'dashboard': ['dash-vorlesen',");
    expect(html).toMatch(/'dash-vorlesen':\s+\{ name: 'Vorlesen'/);
  });
});
