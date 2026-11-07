// PA7: Artikel-Abgleich fuer Festpreis-Partner - reine Logik.
//
// Der FP-Sync holt den Festpreis NICHT aus FP_Artikel, sondern ueber die Artikelkategorie der FP_Artikel-Zeile aus
// FP_Artikel_Kategorie. Seit PA8 (FP-Sperre) wird ein Verkauf ohne gueltige Zuordnung GESPERRT statt mit 0 gerechnet - darum
// darf der taegliche Abgleich fehlende Artikel jetzt OHNE Artikelkategorie anlegen (Variante A, `fpAnlagePlan`; geschrieben in
// lib/fpArtikelAnlegen.js), nie mit Festpreis. Gemeldet wird:
//   - fehlend:      veroeffentlichte Shop-Artikel der Partner-Kategorien (inkl. Unterkategorien) ohne FP_Artikel-Zeile
//   - ohneFestpreis: FP_Artikel-Zeilen, deren Artikelkategorie leer ist oder keine Zeile in FP_Artikel_Kategorie hat
//                    (Festpreis 0 in FP_Artikel_Kategorie ist bewusst und zaehlt als gesetzt)
//   - kategorienWeg: Nummern in FP_Partner.Kategorien, die es im Shop nicht (mehr) gibt
// Nie Preise in Antwort, Log oder Chat.

const t = v => String(v ?? '').trim();

/** Kategorie-Liste des Partners -> { ziel: Set<id> inkl. aller Unterkategorien, weg: string[] (nicht im Shop) }. */
export function fpZielKategorien(liste, kategorien) {
  const nummern = [...new Set(t(liste).split(/[,;\s]+/).map(t).filter(Boolean))];
  const ids = new Set((kategorien ?? []).map(c => Number(c.id)));
  const kinder = new Map();
  for (const c of kategorien ?? []) if (Number(c.parent)) {
    if (!kinder.has(Number(c.parent))) kinder.set(Number(c.parent), []);
    kinder.get(Number(c.parent)).push(Number(c.id));
  }
  const ziel = new Set();
  const nimm = id => { if (ziel.has(id)) return; ziel.add(id); for (const k of kinder.get(id) ?? []) nimm(k); };
  const weg = [];
  for (const n of nummern) {
    const id = Number(n);
    if (!Number.isInteger(id) || !ids.has(id)) { weg.push(n); continue; }
    nimm(id);
  }
  return { ziel, weg };
}

/**
 * Ein Partner: fehlende Artikel und Zeilen ohne Festpreis.
 * @param {object} o
 * @param {{id:string,kategorien:string}} o.partner
 * @param {{id,parent}[]} o.kategorien   Shop-Kategorien
 * @param {{id,name,status,categories}[]} o.produkte  Shop-Produkte (nur veroeffentlichte zaehlen)
 * @param {{produktId,artikelkategorie}[]} o.artikel  FP_Artikel-Zeilen dieses Partners
 * @param {Set<string>} o.festpreisKategorien  Kategorien mit Zeile in FP_Artikel_Kategorie fuer diesen Partner
 */
export function fpPartnerBefund({ partner, kategorien, produkte, artikel, festpreisKategorien }) {
  const { ziel, weg } = fpZielKategorien(partner.kategorien, kategorien);
  const vorhanden = new Set((artikel ?? []).map(a => t(a.produktId)));
  const fehlend = (produkte ?? [])
    .filter(p => t(p.status) === 'publish' && (p.categories ?? []).some(c => ziel.has(Number(c.id))) && !vorhanden.has(String(p.id)))
    .map(p => ({ produktId: String(p.id), name: t(p.name), ...(t(p.categories?.[0]?.name) ? { wcKategorie: t(p.categories[0].name) } : {}) }))
    .sort((a, b) => Number(a.produktId) - Number(b.produktId));
  const ohneFestpreis = (artikel ?? [])
    .filter(a => !t(a.artikelkategorie) || !festpreisKategorien.has(t(a.artikelkategorie)))
    .map(a => ({ produktId: t(a.produktId), name: t(a.name), grund: t(a.artikelkategorie) ? 'Artikelkategorie ohne Festpreis-Zeile' : 'Artikelkategorie leer' }));
  return { id: partner.id, fehlend, ohneFestpreis, kategorienWeg: weg, kategorienGeprueft: ziel.size };
}

/**
 * FP-Sync (Punkt 4): Positionen, die der Sync uebersprungen hat (Produkt-ID nicht in FP_Artikel), deren Produkt aber in
 * den Kategorien eines aktiven FP-Partners liegt -> nicht abgerechnet. Je Partner + Produkt die Bestellnummern und das
 * frueheste Bestelldatum (damit man nach dem Import mit diesem Datum neu synchronisieren kann).
 * @param {{produktId, bestellung, datum}[]} o.uebersprungen
 * @param {{id, categories}[]} o.produkte   Shop-Produkte (mit Kategorien) zu den uebersprungenen IDs
 * @param {{id, kategorien}[]} o.partner    aktive FP-Partner dieses Shops
 */
export function fpOhneEintragInVerkaeufen({ uebersprungen, produkte, kategorien, partner }) {
  const katJe = new Map((produkte ?? []).map(p => [String(p.id), (p.categories ?? []).map(c => Number(c.id))]));
  const aus = new Map();
  for (const p of partner ?? []) {
    const { ziel } = fpZielKategorien(p.kategorien, kategorien);
    for (const u of uebersprungen ?? []) {
      if (!(katJe.get(String(u.produktId)) ?? []).some(id => ziel.has(id))) continue;
      const k = `${p.id}|${u.produktId}`;
      if (!aus.has(k)) aus.set(k, { partnerId: p.id, produktId: String(u.produktId), bestellungen: [], ab: u.datum });
      const e = aus.get(k);
      if (!e.bestellungen.includes(String(u.bestellung))) e.bestellungen.push(String(u.bestellung));
      if (u.datum && (!e.ab || u.datum < e.ab)) e.ab = u.datum;
    }
  }
  return [...aus.values()];
}

/**
 * PA8 (Variante A): neue FP_Artikel-Zeilen fuer fehlende Artikel - OHNE Artikelkategorie und OHNE Festpreis/EK/Handling
 * (leer, nicht 0), Versandart P wie "Aus WC importieren". Zeile nach den Spaltennamen des Reiters; schon vorhandene
 * Partner + Produkt-ID (frisch gelesen) fallen heraus, doppelte im Befund einmal.
 * @param {string[]} kopf  Kopfzeile FP_Artikel
 * @param {any[][]} zeilen Datenzeilen FP_Artikel (frisch gelesen)
 * @param {{id, fehlend: {produktId, name, wcKategorie}[]}[]} befund
 * @returns {{ zeilen: any[][], neu: {partnerId, produktId}[] }}
 */
export function fpAnlagePlan(kopf, zeilen, befund) {
  const h = c => kopf.indexOf(c);
  for (const c of ['Partner-ID', 'Produkt-ID', 'Artikelname', 'Artikelkategorie'])
    if (h(c) === -1) throw Object.assign(new Error(`FP_Artikel: Spalte ${c} fehlt – nichts angelegt.`), { status: 409, code: 'einrichtung' });
  const da = new Set((zeilen ?? []).map(r => `${t(r[h('Partner-ID')])}|${t(r[h('Produkt-ID')])}`));
  const aus = [], neu = [];
  for (const p of befund ?? []) for (const f of p.fehlend ?? []) {
    const k = `${t(p.id)}|${t(f.produktId)}`;
    if (!t(p.id) || !/^\d+$/.test(t(f.produktId)) || da.has(k)) continue;
    da.add(k);
    const z = Array.from({ length: kopf.length }, () => '');
    z[h('Partner-ID')] = t(p.id);
    z[h('Produkt-ID')] = t(f.produktId);
    z[h('Artikelname')] = t(f.name);
    if (h('Versandart') !== -1) z[h('Versandart')] = 'P';
    if (h('WC-Kategorie') !== -1) z[h('WC-Kategorie')] = t(f.wcKategorie);
    z[h('Artikelkategorie')] = '';   // bewusst leer: Verkaeufe bleiben gesperrt, bis jemand die Kategorie setzt
    aus.push(z);
    neu.push({ partnerId: t(p.id), produktId: t(f.produktId) });
  }
  return { zeilen: aus, neu };
}
