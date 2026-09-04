# Bugfix- & Änderungsprotokoll

Dokumentation aller Anpassungen der letzten ~60 Stunden (Stand: 2026-06-09).
Reihenfolge: neueste zuerst. Das früher hier referenzierte Projektdokument v8_1
lag unter docs/ und wird inzwischen außerhalb des Repos gepflegt.

Legende: **FIX** = Fehlerbehebung · **FEAT** = neue Funktion · **TOOL** = Hilfsskript/Tooling

---

## 2026-06-09 (heute)

### FIX – HonkShop-Partner sah keine Verkäufe
**Commit:** `f00d298` · **Datei:** `frontend/index.html`

- **Symptom:** Ein HonkShop-Partner sah im Partnerportal keine Verkäufe ("Keine offenen Verkäufe vorhanden"), obwohl Umsätze vorhanden waren.
- **Ursache:** Der im Partnerportal über "Link kopieren" generierte Portal-Link enthielt keinen `shop`-Parameter. `partner.html` setzt ohne diesen Parameter `SHOP = 'jfn'` (Default). Dadurch las das Backend (`GET /api/partner/verkaeufe`) über `getShopConfig('jfn').tabVerkaeufe` den Tab **`Partner_Verkäufe`** statt **`HK_Partner_Verkäufe`**. HonkShop-Umsätze werden vom Sync aber ausschließlich nach `HK_Partner_Verkäufe` geschrieben → keine Treffer. Dasselbe galt für Saldo und Abrechnungen, da alle drei Endpunkte am `shop`-Parameter hängen.
- **Fix:** Link-Generierung hängt nun `&shop=honk` an, sobald `p.shop === 'honk'`:
  ```js
  const shopParam = p.shop === 'honk' ? '&shop=honk' : '';
  const link = `…/partner.html?token=…${apiUrl ? '&api=…' : ''}${shopParam}`;
  ```
- **Wichtig für die Praxis:**
  - Betroffene Partner brauchen einen **frisch kopierten Link** – alte Links ohne `shop=honk` zeigen weiterhin nichts.
  - Frontend-Änderung (GitHub Pages) → erst nach **Push/Deploy** wirksam.
  - Falls danach immer noch leer: prüfen, ob der **HonkShop-Sync** lief (`shop=honk`) und ob im Partner-Sheet `Shop = honk` und `Aktiv = ja` gesetzt sind.

### FIX – Interne Bestellungen für Festpreis-Partner nicht erfassbar
**Commit:** `333c906` · **Datei:** `backend/routes/partner-artikel.js`

- **Symptom:** Im Festpreis-Reiter unter "Interne Bestellungen" schlug das Anlegen mit der Meldung "Partner nicht gefunden" fehl, obwohl der Partner existierte.
- **Ursache:** Der Festpreis-Reiter ruft den gemeinsamen Endpoint `POST /api/partner/:id/intern` (aus `partner-artikel.js`) auf. Dieser validierte die Partner-ID per `loadPartner()` **nur gegen den `Partner`-Tab**. Festpreis-Partner stehen jedoch ausschließlich im **`FP_Partner`-Tab** → Existenzprüfung schlug fehl. (`GET` und `PATCH` funktionierten, weil sie nur nach `Partner-ID` im gemeinsamen Sheet `Partner_Interne_Bestellungen` filtern, ohne den `Partner`-Tab zu prüfen.)
- **Fix:** Neuer Helper `partnerIdExists()`, der die ID in **`Partner` _oder_ `FP_Partner`** sucht (tolerant gegen fehlende Tabs). Der POST nutzt diese Prüfung statt `loadPartner()` und schreibt mit `req.params.id`.
  ```js
  async function partnerIdExists(sheets, sheetId, partnerId) {
    for (const tab of ['Partner', 'FP_Partner']) {
      try {
        const { header, rows } = await readTab(sheets, sheetId, tab);
        const idx = header.indexOf('Partner-ID');
        if (idx !== -1 && rows.some(r => (r[idx] ?? '') === partnerId)) return true;
      } catch { /* Tab evtl. nicht vorhanden */ }
    }
    return false;
  }
  ```
- **Hinweis:** Reine Backend-Änderung → wird erst nach Deploy (Cloud Run) wirksam.

---

## 2026-06-08 (gestern) – Schwerpunkt Festpreis-Abrechnung

### FEAT – FP Abrechnungs-Entwürfe löschbar
**Commit:** `26212e2` · **Dateien:** `backend/routes/festpreis-portal.js`, `frontend/index.html`

- Abrechnungen im Status "entwurf" können nun gelöscht werden (neuer `DELETE`-Endpunkt + UI-Button).
- Schützt davor, dass fehlerhafte Entwürfe dauerhaft im Sheet verbleiben.

### FIX – FP Abrechnung robust gegen Header-Abweichungen
**Commit:** `5aed836` · **Datei:** `backend/routes/festpreis-portal.js`

- Abrechnungslogik liest Spalten nun namensbasiert/tolerant statt über feste Indizes → unempfindlich gegen verschobene oder umbenannte Sheet-Spalten.
- Die Abrechnungssumme wird konsistent aus der Aggregation der Positionen ermittelt.

### FIX – Festpreis-Auszahlungsformel korrigiert (VK-Netto als Basis)
**Commit:** `9d2af44` · **Dateien:** `backend/routes/festpreis-portal.js`, `backend/utils/festpreis-kalkulation.js`, `frontend/index.html`

- **Ursache:** Die Auszahlung wurde auf einer falschen Bezugsgröße berechnet.
- **Fix:** Auszahlung basiert nun korrekt auf **VK-Netto**. Frontend-Anzeige entsprechend angepasst.

### TOOL – Debug-Skript für Festpreis-Orders
**Commit:** `6bd30fc` · **Datei:** `backend/scripts/debug-festpreis-order.js`

- Neues Hilfsskript, das den Porto- und Auszahlungs-Rechenweg je Order nachvollziehbar ausgibt (zur Verifikation der Kalkulation).

### FEAT – FP Abrechnung speichert Artikel-Aufschlüsselung
**Commit:** `79dfc3d` · **Dateien:** `backend/routes/festpreis-portal.js`, `frontend/index.html`

- Abrechnungen speichern die Positionen je Artikel als JSON → nachträgliche Aufschlüsselung/Transparenz pro Abrechnung möglich.

### FEAT – FP Zusammenfassung auf neues Modell + Stückzahl/Mehrkosten-Fix
**Commit:** `513e281` · **Dateien:** `backend/routes/festpreis-portal.js`, `backend/utils/festpreis-kalkulation.js`, `frontend/index.html`

- Umstellung der Zusammenfassung auf das neue Kalkulationsmodell.
- Korrektur der Stückzahl- und Mehrkosten-Berechnung.

### FEAT – FP Sync-Modal mit optionalem Startdatum
**Commit:** `f717bc2` · **Datei:** `frontend/index.html`

- Der Festpreis-Sync erhält ein Modal mit optionalem Startdatum (analog zum Partnerportal-Sync).

### FEAT – FP Handlingskosten je Kategorie + korrekte Auszahlungsformel
**Commit:** `903755a` · **Dateien:** `backend/routes/festpreis-portal.js`, `backend/utils/festpreis-kalkulation.js`, `frontend/index.html`

- Handlingskosten können je Artikelkategorie hinterlegt werden; fließen korrekt in die Auszahlungsformel ein.

### FIX – Festpreis-Kundenportal zeigt nur offene Bestellungen
**Commit:** `008b13e` · **Datei:** `backend/routes/festpreis-public.js`

- Das öffentliche Festpreis-Kundenportal filtert nun auf offene Bestellungen (bereits abgerechnete/erledigte werden nicht mehr angezeigt).

---

## 2026-06-07 (innerhalb des 60-Stunden-Fensters, ab ~00:53)

### Festpreis-Bereich
- `701f276` **FEAT:** FP Bestellungen VK-Netto-Spalte (item.total aus WC, Spalte U).
- `73bd2f1` **FEAT:** FP Abrechnungen Status änderbar (entwurf/freigegeben/bezahlt).
- `c3f1d8c` **FIX:** Festpreis Vorschau-Modal scrollbar.
- `af8caae` **FEAT:** FP Festpreise je Partner+Kategorie + Mehrkosten im Sync.
- `29c0d8c` **FEAT:** FP Bestellungen – Storno-Zeilen rot markiert.
- `c43fb9a` **FEAT:** FP Bestellungen – Filter ab Order-ID.
- `122ab56` **FEAT:** FP-Artikel Entwürfe importieren + Artikelkategorie-Dropdown.
- `288bada` **FEAT:** Festpreis-Kundenportal – Storno-Zeilen rot markiert.
- `d67aebe` **FEAT:** Festpreis-Kundenportal – Bestellansicht vereinfacht.
- `4c27400` **FIX:** Festpreis-Artikel EK/Handling – Komma-Preise korrekt anzeigen.
- `9d0fbc5` **FEAT:** FP "Interne Bestellungen"-Tab eingeführt.
- `16dd61e` **FEAT:** Festpreis Artikel-Zusammenfassung (summary-Endpunkt + Vorschau + Tab).
- `e1bc19c` **FIX:** Festpreis-Sync – on-hold + Storno-Gegenbuchung (W4).

### Partnerportal / WooCommerce-Sync
- `de06bd0` **FEAT:** Storno-Einträge rot hervorheben in Partnerportal + Partnerlink.
- `c0624f0` **FIX:** `partnerView /abrechnungen` filtert Status "entwurf" heraus.
- `5cd688f` **FEAT:** Interne Bestellungen im Partnerportal editierbar.
- `b9103c2` **FIX:** `_sheetRow`-Handling in partner-artikel + agent-wissen (leerzeilen-sicherer Zeilenindex).
- `88b7be1` **FEAT:** `add-storno-header.js` – setzt Spalte O in `Partner_Verkäufe` + `HK_Partner_Verkäufe`.
- `deb6965` **FEAT:** WC-Sync – on-hold erlaubt, Storno-Gegeneinträge für refunded/cancelled.
- `6c4341a` **FIX:** `parseDate` in partnerPortal definieren – behebt ReferenceError bei leerem Sync-Datum.
- `1361d62` **FIX:** Backup 404-Toleranz, partner-sync dual-shop + Datum optional.

### Sicherheit / Bot-Schutz / Sonstiges
- `c452746` **FEAT:** Cloudflare Turnstile Bot-Schutz (Chat-Widget).
- `d00e676` **FIX:** Turnstile Site Key setzen.
- `8bc01ca` **FIX:** Audit-Findings N1–N4 + N6–N7 (anfragen-chat, woocommerce, secrets).
- `8ee2359` **FIX:** trust proxy, Zeilenindex, Chat-Schutz, PayPal-Brutto; **Projektdoku v8_0 & v8_1 angelegt.**

---

## Deploy-Hinweise
- **Backend-Änderungen** (`backend/**`) werden erst nach Cloud-Run-Deploy wirksam.
- **Frontend-Änderungen** (`frontend/index.html`, `partner*.html`) laufen über GitHub Pages → erst nach Push wirksam.
- Die heutigen beiden Fixes (`333c906`, `f00d298`) sind committet, aber noch **nicht gepusht** (lokal 2 Commits vor `origin/main`).
