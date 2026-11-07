// AM-6: Oberflaeche "Hatte bisher" und "Wie letztes Mal" (Block "Auftrag-Historie" in frontend/index.html). Nur erfundene Werte.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend/index.html'), 'utf8');
const block = html.slice(html.indexOf('// ── Auftrag-Historie: Anfang'), html.indexOf('// ── Auftrag-Historie: Ende ──'));
const anzeige = html.slice(html.indexOf('// ── Auftraege-Anzeige: Anfang'), html.indexOf('// ── Auftraege-Anzeige: Ende ──'));
const preise = html.slice(html.indexOf('// ── Auftrag-Preise: Anfang'), html.indexOf('// ── Auftrag-Preise: Ende ──'));
const kuEsc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lfbText = l => ({ auslauf: 'läuft aus', null: 'bei L-Shop 0', auslauf_null: 'läuft aus · schon 0', nicht_gefuehrt: 'nicht mehr geführt' }[l?.stufe] ?? 'lieferbar');
const F = new Function('kuEsc', 'lfbText', 'grSortiere', `${preise}\n${anzeige}\n${block}\nreturn { auHistChipsHtml, auHistVorbelegung, auHistKundeHtml, auKundeAuftraegeHtml, auVorlageAus, auVorlageHinweisHtml, auHistStufe, auGruppeLfbHtml, auEntwurfAus, auHistTitel };`)(kuEsc, lfbText, undefined);

const letzter = { auftragNr: 'AU-2026-0002', datum: '2026-05-10', motiv: 'Wappen', druck: 'Brust', notiz: '', Preis_Netto: 12.5, Aufpreis_Netto: 2, Aufpreis_Ab: '3XL', USt_Satz: 7 };
const G = (x = {}) => ({ modell: 'M1', bezeichnung: 'Testshirt', farbe: 'Navy', zuletzt: '2026-05-10', auftraege: 2, stueck: 10, nurAngefragt: false, katalog: true, lieferbar: { stufe: 'lieferbar' }, letzter, ...x });

describe('Leiste "Hatte bisher" im Dialog', () => {
  test('Chip uebernimmt Motiv, Druck und letzten Preis (+ Aufpreis/ab, USt) - Mengen leer, Preis markiert', () => {
    const v = F.auHistVorbelegung(G());
    expect(v).toEqual({ modell: 'M1', farbe: 'Navy', motiv: 'Wappen', druck: 'Brust', preis: 12.5, aufpreis: 2, aufpreisAb: '3XL', ust: '7', preisVon: 'AU-2026-0002 vom 10.05.2026' });
    expect(v).not.toHaveProperty('menge');
  });
  test('ohne Preis keine Markierung, USt leer = 19', () => {
    expect(F.auHistVorbelegung(G({ letzter: { ...letzter, Preis_Netto: '', USt_Satz: '' } }))).toMatchObject({ preis: '', ust: '19', preisVon: '' });
  });
  test('Stufen: nicht im Katalog = aus, schon im Entwurf = drin (kein Doppel), laeuft aus / 0 = Hinweis', () => {
    expect(F.auHistStufe(G({ katalog: false }), [])).toBe('aus');
    expect(F.auHistStufe(G(), [{ art: 'lshop', modell: 'M1', farbe: 'Navy' }])).toBe('drin');
    expect(F.auHistStufe(G(), [{ art: 'lshop', modell: 'M1', farbe: 'Black' }])).toBe('ok');
    for (const stufe of ['auslauf', 'null', 'auslauf_null', 'nicht_gefuehrt']) expect(F.auHistStufe(G({ lieferbar: { stufe } }), [])).toBe('hinweis');
  });
  test('Chips: aus = ausgegraut und gesperrt mit Mouse-over, drin = "✓ übernommen", Hinweis orange', () => {
    const h = F.auHistChipsHtml([G(), G({ farbe: 'Red', katalog: false }), G({ farbe: 'Black', lieferbar: { stufe: 'auslauf' } })], [{ art: 'lshop', modell: 'M1', farbe: 'Navy' }]);
    expect(h).toContain('class="au-hist-chip au-hist-drin" data-au-hist="0" data-hilfe="au-hist-drin">M1 Navy <span class="au-hist-ok">✓ übernommen</span>');
    expect(h).toContain('class="au-hist-chip au-hist-aus" data-au-hist="1" data-hilfe="au-hist-aus" aria-disabled="true">M1 Red · nicht mehr bei L-Shop');
    expect(h).toContain('class="au-hist-chip au-hist-hinweis" data-au-hist="2" data-hilfe="au-hist-chip">M1 Black <span class="au-hist-lfb">· läuft aus</span>');
  });
  test('hoechstens 8, dann "mehr …"; nur angefragt nicht in der Leiste; ohne Historie leer (Leiste unsichtbar)', () => {
    const viele = Array.from({ length: 10 }, (_, i) => G({ farbe: `F${i}` }));
    const h = F.auHistChipsHtml(viele, []);
    expect((h.match(/data-au-hist="/g) ?? []).length).toBe(8);
    expect(h).toContain('mehr … (2)');
    expect((F.auHistChipsHtml(viele, [], { alle: true }).match(/data-au-hist="/g) ?? []).length).toBe(10);
    expect(F.auHistChipsHtml([G({ nurAngefragt: true })], [])).toBe('');
    expect(F.auHistChipsHtml([], [])).toBe('');
  });
  test('Gruppe im Dialog: laeuft aus orange, lieferbar ohne Hinweis', () => {
    expect(F.auGruppeLfbHtml({ positionen: [{ lieferbar: { stufe: 'lieferbar' } }, { lieferbar: { stufe: 'null' } }] })).toContain('bei L-Shop 0');
    expect(F.auGruppeLfbHtml({ positionen: [{ lieferbar: { stufe: 'lieferbar' } }] })).toBe('');
  });
});

describe('Kundenkarte', () => {
  test('Karten: zuletzt, Anzahl, Stueck, Motiv/Druck, Preis mit Mouse-over "aus AU-… vom …", Knopf "+ in neuen Auftrag"', () => {
    const h = F.auHistKundeHtml({ gruppen: [G()], frei: [] });
    expect(h).toContain('zuletzt 10.05.2026');
    expect(h).toContain('in 2 Aufträgen');
    expect(h).toContain('10 Stück');
    expect(h).toContain('data-hilfe-zusatz="aus AU-2026-0002 vom 10.05.2026"');
    expect(h).toContain('12,50 € netto');
    expect(h).toContain('data-ku-hist="0" data-hilfe="ku-hist-neu">+ in neuen Auftrag');
  });
  test('nur angefragt grau ohne Stueck; nicht im Katalog: Knopf gesperrt', () => {
    expect(F.auHistKundeHtml({ gruppen: [G({ nurAngefragt: true, stueck: 0 })], frei: [] })).toMatch(/au-hist-angefragt[\s\S]*nur angefragt/);
    expect(F.auHistKundeHtml({ gruppen: [G({ katalog: false })], frei: [] })).toContain('data-hilfe="au-hist-aus" aria-disabled="true">nicht mehr bei L-Shop');
  });
  test('weitere Positionen und Aufgaben; ohne Historie Hinweis', () => {
    const h = F.auHistKundeHtml({ gruppen: [], frei: [{ text: 'Tasse', zuletzt: '2026-05-10', auftraege: 1 }] }, [{ Aufgabe_Nr: 'AG-2026-0001', Kurztitel: 'Muster', Status: 'offen' }]);
    expect(h).toContain('Noch nichts bestellt.');
    expect(h).toContain('Weitere Positionen');
    expect(h).toContain('data-ku-hist-frei="0" data-hilfe="ku-hist-frei-neu"');
    expect(h).toContain('Aufgaben für diesen Kunden');
    expect(h).not.toMatch(/data-ku-wie="AG-/);   // Aufgaben ohne "Wie letztes Mal"
  });
  test('Auftraege: neueste zuerst, stornierte nur mit Haken am Ende, je Zeile "Wie letztes Mal"', () => {
    const liste = [
      { Auftrag_Nr: 'AU-2026-0001', Kurztitel: 'A', Status: 'bezahlt', Angelegt: '2026-01-01', Anfrage_Am: '2026-01-01', preise: { netto: 100, nettoNach: 9000 } },
      { Auftrag_Nr: 'AU-2026-0002', Kurztitel: 'B', Status: 'storniert', Angelegt: '2026-03-01', Anfrage_Am: '2026-03-01' },
      { Auftrag_Nr: 'AU-2026-0003', Kurztitel: 'C', Status: 'Anfrage', Angelegt: '2026-02-01', Anfrage_Am: '2026-02-01' },
    ];
    const nr = h => [...h.matchAll(/data-ku-au="([^"]+)"/g)].map(m => m[1]);
    expect(nr(F.auKundeAuftraegeHtml(liste))).toEqual(['AU-2026-0003', 'AU-2026-0001']);
    expect(nr(F.auKundeAuftraegeHtml(liste, { mitStorniert: true }))).toEqual(['AU-2026-0003', 'AU-2026-0001', 'AU-2026-0002']);
    expect(F.auKundeAuftraegeHtml(liste, { mitStorniert: true })).toContain('ku-au-zeile ku-gesperrt');
    expect(F.auKundeAuftraegeHtml(liste)).toContain('90,00 € netto');
    expect(F.auKundeAuftraegeHtml(liste)).toContain('data-ku-wie="AU-2026-0001" data-hilfe="ku-wie-letztes"');
  });
});

describe('Wie letztes Mal - Vorbelegung', () => {
  const a = {
    Auftrag_Nr: 'AU-2026-0004', Kunden_Nr: 'K-00001', Kurztitel: 'Saison 26', Kanal: 'Mail', Status: 'bezahlt', Termin: '2026-04-01', Notiz: 'intern',
    Rabatt: '10%', Preis_Eingabe: 'brutto', Design_Link: 'https://example.invalid/d', Zustaendig: 'Nicole', Anfrage_Am: '2026-03-01', Bestellt_Am: '2026-03-05',
    Angebot_Netto: 100, Lexoffice_Rechnung: 'R-1',
    positionen: [
      { Position_ID: 'AU-2026-0004-01', Art: 'lshop', LShop_ArticleNr: '1000000001', Menge: '3', Motiv: 'Wappen', Druck: 'Brust', Notiz: 'n1', Preis_Netto: 12.5, USt_Satz: 7,
        Herkunft: 'lager', Lager_Ort: 'Wrist', Lager_Buchung: 'LB-1', Korb_Schluessel: 'K1', Fertig: 'ja', lshop: { modell: 'M1', farbe: 'Navy', groesse: 'S', bestellbar: true, lieferbar: { stufe: 'auslauf' } } },
      { Position_ID: 'AU-2026-0004-02', Art: 'lshop', LShop_ArticleNr: '2000000001', Menge: '2', lshop: { modell: 'M2', farbe: 'Red', groesse: 'L', bestellbar: false } },
      { Position_ID: 'AU-2026-0004-03', Art: 'frei', Freitext: 'Tasse', Menge: '4', Herkunft: 'vorhanden', EK_Hand: 3, Preis_Netto: 8 },
    ],
  };
  const v = F.auVorlageAus(a);
  test('uebernommen: Kurztitel, Kanal, Preis_Eingabe, Design_Link; Gruppen mit Motiv/Druck/Notiz und Mengen, freie mit Menge, Preise markiert', () => {
    expect(v.kopf).toEqual({ Kurztitel: 'Saison 26', Kanal: 'Mail', Preis_Eingabe: 'brutto', Design_Link: 'https://example.invalid/d' });
    expect(v.vorlage).toBe('AU-2026-0004');
    expect(v.entwurf).toHaveLength(2);
    expect(v.entwurf[0]).toMatchObject({ art: 'lshop', articleNr: '1000000001', menge: 3, motiv: 'Wappen', druck: 'Brust', notiz: 'n1', preis: 12.5, ust: '7',
      modell: 'M1', farbe: 'Navy', lieferbar: { stufe: 'auslauf' }, preisVon: 'AU-2026-0004 vom 05.03.2026' });
    expect(v.entwurf[1]).toMatchObject({ art: 'frei', freitext: 'Tasse', menge: 4, preis: 8 });
  });
  test('NICHT uebernommen: Termin, Notiz, Rabatt, Status, Angebot, Zustaendig, Lexware; Herkunft/Lager/Korb/Fertig zurueck; EK von Hand leer', () => {
    expect(Object.keys(v.kopf)).not.toEqual(expect.arrayContaining(['Termin']));
    for (const f of ['Termin', 'Notiz', 'Rabatt', 'Status', 'Angebot_Netto', 'Zustaendig', 'Lexoffice_Rechnung']) expect([f, f in v.kopf]).toEqual([f, false]);
    const e0 = v.entwurf[0];
    expect(e0).not.toHaveProperty('positionId');
    expect(e0).toMatchObject({ herkunft: 'bestellen', lagerOrt: '' });
    expect(JSON.stringify(v.entwurf)).not.toMatch(/LB-1|"K1"|Fertig/);
    expect(v.entwurf[1]).toMatchObject({ herkunft: '', ekHand: '' });
  });
  test('nicht mehr bei L-Shop: nicht uebernommen, oben als Liste', () => {
    expect(v.nicht).toEqual(['M2 Red']);
    expect(F.auVorlageHinweisHtml(v)).toContain('nicht übernommen: M2 Red (nicht mehr bei L-Shop)');
  });
  test('stornierte Vorlage erlaubt, mit Hinweis; Vorlage-Objekt selbst bleibt unveraendert', () => {
    const kopie = JSON.parse(JSON.stringify(a));
    F.auVorlageAus(a);
    expect(a).toEqual(kopie);
    expect(F.auVorlageHinweisHtml(F.auVorlageAus({ ...a, Status: 'storniert' }))).toContain('Die Vorlage ist storniert.');
  });
  test('USt bleibt beim Bearbeiten erhalten (Fehler aus AM-5: ust stand im Kommentar)', () => {
    expect(F.auEntwurfAus({ Art: 'lshop', USt_Satz: 7, Menge: '1' }).ust).toBe('7');
    expect(F.auEntwurfAus({ Art: 'lshop', USt_Satz: '', Menge: '1' }).ust).toBe('19');
  });
});

describe('Verdrahtung', () => {
  test('Knopf "Wie letztes Mal" in der Auftragsansicht, Vorlage-Link, Body Vorlage_Von, Start Anfrage', () => {
    expect(html).toContain('id="au-wie-letztes" data-hilfe="au-wie-letztes">Wie letztes Mal …</button>');
    expect(html).toContain('data-au-vorlage="${kuEsc(a.Vorlage_Von)}" data-hilfe="au-vorlage-von"');
    expect(html).toContain("...(auDlg.vorlageVon ? { Vorlage_Von: auDlg.vorlageVon } : {})");
    expect(html).toContain("if (!auftrag) auEl('au-start').value = 'Anfrage';");
  });
  test('Historie per Route, nicht im Browser-Speicher; Leiste nur beim neuen Auftrag', () => {
    expect(html).toContain('/api/auftraege/kunden/${encodeURIComponent(nr)}/historie');
    const teil = html.slice(html.indexOf('const auHist = {'), html.indexOf('      function auKundeSetzen(k) {'));
    expect(teil).not.toMatch(/localStorage|sessionStorage/);
    expect(teil).toContain("auDlg.modus === 'neu' && auDlg.kunde?.Kunden_Nr");
  });
  test('Raster: Vorbelegung nur fuer genau Modell + Farbe', () => {
    expect(html).toContain('auDlg.vorbelegung.modell === auDlg.modell?.catalogNr && auDlg.vorbelegung.farbe === farbe');
  });
});
