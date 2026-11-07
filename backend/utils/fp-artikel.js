// PA7: Artikel-Abgleich fuer Festpreis-Partner - reine Logik, nur MELDEN (Variante B).
//
// Warum nur melden: Der FP-Sync holt den Festpreis NICHT aus FP_Artikel, sondern ueber die Artikelkategorie der
// FP_Artikel-Zeile aus FP_Artikel_Kategorie; fehlt die Zuordnung, rechnet er still mit Festpreis 0 (Partner bekommt den
// ganzen VK). Eine automatisch angelegte Zeile ohne Artikelkategorie wuerde also NICHT gesperrt, sondern zu viel
// auszahlen. Deshalb legt PA7 nichts an und setzt nie einen Festpreis - es zeigt nur:
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
    .map(p => ({ produktId: String(p.id), name: t(p.name) }))
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
