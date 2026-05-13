# Mission Control – Projektdokument
**Version:** 7.5
**Letzte Aktualisierung:** Mai 2026 (Sprint 4.3: Abrechnungs-Flow Redesign + Cron-Job)
**Zweck:** Kontext-Dokument für Claude Sessions + persönliche Knowledge Base

---

## Über mich & meine Unternehmen

### Musik Business
- Aktuell: ~4.000 EUR/Monat Streaming-Einnahmen
- Prognose: sinkend auf ~2.000–2.500 EUR

### Textildruck Firma
- 2 WooCommerce Onlineshops
- **Shop 1:** jammifashion.de (JFN) | **Shop 2:** honkshop.de (HKP) – in Vorbereitung

**GitHub Repository:** `jammifashion/mission-control` (Private)

---

## GCP Setup

- **Projekt-ID:** mission-control-495711
- **Cloud Run URL:** https://mission-control-backend-181760755456.europe-west1.run.app
- **Auth:** X-API-Key Header (`MC_API_KEY` aus localStorage)
- **Rate Limit:** 100 Requests / 15 Minuten pro IP
- **Secrets:** `ANTHROPIC_API_KEY, WC_KEY, WC_SECRET, WC_URL, GOOGLE_SHEET_ID, GEMINI_API_KEY, MC_API_KEY, CORS_ORIGIN, BUSINESS_SHEET_ID`

---

## Jammi Business Sheet

**Sheet ID:** via `BUSINESS_SHEET_ID` in Secret Manager

### Reiter-Übersicht

| Reiter | Status |
|---|---|
| `Kalkulation_Artikel` | ✓ |
| `Kalkulation_Druckpreise` | ✓ |
| `Kalkulation_Fixkosten` | ✓ 8 Positionen (MwSt 19% pflegen!) |
| `Kalkulation_Verkaufspreise` | ✓ |
| `Partner` | ✓ + Porto-Modell |
| `Partner_Verkäufe` | ✓ + Variante-Spalte |
| `Partner_Abrechnungen` | ✓ + Positionen-Spalte (JSON) |
| `Partner_Artikel` | ✓ |
| `Partner_Interne_Bestellungen` | ✓ |

### Partner_Abrechnungen Spaltenstruktur

```
A: Abrechnungs-ID (AB-YYYY-NNNN)
B: Partner-ID
C: Zeitraum von
D: Zeitraum bis
E: Verkaufs-Guthaben
F: Eigenaufträge-Kosten
G: Saldo
H: Status             ← entwurf / freigegeben / bezahlt
I: Erstellt am
J: Positionen         ← JSON mit Verkäufen + Kalkulationsgrundlage + rowIndex
```

**Status-Flow:** `entwurf` → `freigegeben` → `bezahlt`
Altdaten (`angefordert`, `geprüft`) bleiben lesbar, können via Backend-PATCH manuell umgesetzt werden.

### Partner_Verkäufe Spaltenstruktur

```
A: Partner-ID
B: Datum
C: WC-Bestellnummer
D: Artikelname
E: Menge
F: Status             ← offen / abgerechnet
G: Variante           ← variation_id (String, '0' wenn keine Variante)
H: VK-Preis-Brutto
I: Lizenzgebühr
```

**Dedup-Key:** `orderId|artikelName|variationId|partnerId`

---

## Partner-Portal – Kompletter Flow (Stand Sprint 4.3)

### Abrechnungs-Flow

```
1. Admin: "Abrechnung erstellen"
   → Status: entwurf
   → Positionen-JSON mit rowIndex gespeichert
   → Verkäufe + Interne bleiben "offen"
   → Partner sieht NICHTS

2. Admin: Detail aufklappen → Positionen prüfen → "✓ Freigeben"
   → Status: freigegeben
   → Alle referenzierten Verkäufe + Interne → "abgerechnet" (batchUpdate)
   → Partner sieht Abrechnung sofort

3. Admin: "→ Als bezahlt markieren"
   → Status: bezahlt
   → Partner sieht "Ausgezahlt"

4. Alternativ: "✗ Verwerfen"
   → Entwurf gelöscht (deleteDimension, keine Lücke)
   → Positionen bleiben "offen" für nächsten Versuch
```

### Aufgeklappte Abrechnung (Admin)

```
▸ AB-2026-0001 | Zeitraum | Status-Badge | Saldo rechts

  ▾ aufgeklappt:
  Verkäufe:
  Datum | Bestellnr | Artikel | Menge | VK Brutto | Lizenz
    ▾ Kalkulation: EK | Druck | Nebenkosten | PayPal | Versand | Porto-Saldo | Gewinn × % = Lizenz

  Interne Bestellungen:
  Datum | Bezeichnung | Anzahl | Einzelpreis | Summe

  Saldo-Block:
  +Lizenz-Summe / −Intern / = Auszahlung (grün) oder Forderung (rot)

  [✓ Freigeben] [✗ Verwerfen]   ← nur bei entwurf
  [→ Als bezahlt markieren]     ← nur bei freigegeben
```

### Partner-Sicht (`partner.html`)

```
Verkäufe-Tabelle (immer sichtbar)
Direkte Bestellungen (mit Preisen – eigene Kosten)
Saldo-Block:
  +Lizenz / −Direkte = Aktuelles Guthaben (grün) / Aktueller Rückstand (rot)

Meine Abrechnungen (nur freigegeben + bezahlt):
  AB-2026-0001 | Zeitraum | Status | Endsumme
  ▾ Detail: Verkäufe | Direkte | Saldo
  Label: "Auszahlung" (freigegeben) / "Ausgezahlt" (bezahlt)
```

### Kalkulationsmodell

```
vkNetto              = vkBrutto / (1 + mwst%/100)
herstellung          = ekPreis + druckkosten + herstellungsnebenkosten
versandnk            = (B|P-Versandnebenkosten) × bestellungsAnteil
paypalKosten         = vkBrutto × paypal% + (paypalPauschale × bestellungsAnteil)
gewinnNetto          = vkNetto − herstellung − versandnk − paypal

Porto separat:
bestellungsAnteil    = itemNetto / orderNetto (wertbasiert)
portoEinnahmeAnteil  = shipping_total (brutto) × bestellungsAnteil
portoKostenAnteil    = (Porto-B|Porto-P) × bestellungsAnteil
portoSaldoArtikel    = portoEinnahmeAnteil − portoKostenAnteil

partner-trägt:        partnerAnteil = gewinnNetto × lizenz% + portoSaldoArtikel
geteilt-50-50:        partnerAnteil = gewinnNetto × lizenz% + portoSaldoArtikel / 2
```

### Täglicher Auto-Sync (Cron-Job)

- **Workflow:** `.github/workflows/sync-partner-daily.yml`
- **Zeit:** täglich 02:00 Uhr
- **Endpoint:** `POST /api/partner/verkaeufe/sync-all`
- **Logik:** Iteriert alle aktiven Partner (Spalte E = Aktiv) → ruft Sync pro Partner auf
- **Response:** `{ partner: N, neueVerkäufe: M, errors: [] }`
- **Auth:** `MC_API_KEY` aus GitHub Secrets

Partner-Aufruf von `partner.html` triggert **keinen** Sync – zeigt nur Sheet-Stand. Manueller Sync-Button bleibt im Admin-Tab für sofortigen Bedarf.

---

## Backend-Endpunkte (Stand Mai 2026)

### Partner-Portal
| Endpunkt | Status |
|---|---|
| GET /api/partner/auth?token=XXX | ✓ |
| GET /api/partner/verkaeufe?token=XXX | ✓ |
| GET /api/partner/abrechnungen?token=XXX | ✓ (nur freigegeben/bezahlt) |
| GET /api/partner/verkaeufe/sync | ✓ (manuell, mit Ab-Datum Modal) |
| POST /api/partner/verkaeufe/sync-all | ✓ Sprint 4.3 (alle aktiven Partner) |

### Partner-Artikel
| Endpunkt | Status |
|---|---|
| GET /api/partner/:id/artikel | ✓ |
| POST /api/partner/:id/artikel/import | ✓ |
| PATCH /api/partner/:id/artikel/:artikelnummer | ✓ |
| POST /api/partner/kalkulation/preview | ✓ |
| POST /api/partner/:id/intern | ✓ |
| GET /api/partner/:id/intern | ✓ |
| PATCH /api/partner/:id/intern/:rowId/status | ✓ |

### Kalkulation
| Endpunkt | Status |
|---|---|
| POST /api/kalkulation/abrechnung/erstellen | ✓ (→ entwurf, kein abgerechnet-setzen) |
| POST /api/kalkulation/abrechnung/vorschau | ✓ read-only |
| POST /api/kalkulation/abrechnung/:id/freigeben | ✓ Sprint 4.3 |
| DELETE /api/kalkulation/abrechnung/:id | ✓ Sprint 4.3 (nur entwurf) |
| GET /api/kalkulation/abrechnungen | ✓ (mit Positionen-JSON) |
| PATCH /api/kalkulation/abrechnung/:id/status | ✓ (bezahlt + Altdaten) |

---

## GitHub Actions Workflows

| Workflow | Trigger | Zweck |
|---|---|---|
| `deploy.yml` | Push main | Frontend → GitHub Pages |
| `deploy-backend.yml` | Push main | Backend → Cloud Run |
| `backup-daily.yml` | täglich | Sheet-Backup |
| `sync-partner-daily.yml` | täglich 02:00 | Partner-Verkäufe Sync alle aktiven Partner |

---

## Repo-Struktur

```
mission-control/
├── frontend/
│   ├── index.html              ← PWA Admin
│   │   └── Partnerportal: Partner | Artikel | Interne Bestellungen | Kalkulation | Verkäufe | Abrechnungen
│   ├── partner.html            ← Partner-View (Token)
│   │   └── Verkäufe | Direkte Bestellungen | Saldo | Meine Abrechnungen
│   ├── manifest.json
│   └── sw.js
├── backend/
│   ├── utils/
│   │   └── partner-kalkulation.js  ✓ (berechnePartnerAnteil, toFloat, bestellungsAnteil)
│   ├── routes/
│   │   ├── kalkulation.js      ✓
│   │   ├── partner.js          ✓ (Sync, sync-all, Token-Auth)
│   │   └── partner-artikel.js  ✓
│   └── index.js
├── .github/workflows/
│   ├── deploy.yml              ✓
│   ├── backup-daily.yml        ✓
│   ├── deploy-backend.yml      ✓
│   └── sync-partner-daily.yml  ✓ Sprint 4.3
```

---

## Fahrplan

| Sprint | Inhalt | Status |
|---|---|---|
| 1–2.7 | Core + Auftragsmonitor | ✓ |
| 3 | Cloud Migration + Kalkulation | ✓ |
| 4.1 | Partner-Portal Basis | ✓ |
| 4.2 | Partner-Artikel + Sync + Kalkulation + partner.html | ✓ |
| 4.3 | Varianten-Bug + Abrechnungs-Flow Redesign + Cron | ✓ |
| **5** | **Manuelle Auftragsverarbeitung** | **offen** |
| 5.5 | Kalender + Lieferzeit-Integration | parkiert |
| 6 | Kunden-Kommunikation | offen |
| 7 | KPI-Dashboard + Agenten | offen |
| 8+ | SaaS-Evaluation | offen |

---

## Gemini Modelle (Stand Mai 2026)

| Modell | API String | Status |
|---|---|---|
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Preview |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | ✅ GA |
| Gemini 2.5 Flash | `gemini-2.5-flash` | ✅ Stabil, Standard |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | Stabil, Fallback |
| Gemini 2.0 Flash | `gemini-2.0-flash` | ⚠️ Shutdown 1. Juni 2026! |

## Claude Modelle (Stand Mai 2026)

| Modell | API String | Empfehlung |
|---|---|---|
| Claude Opus 4.7 | `claude-opus-4-7` | Große Refactorings, komplexe Architektur |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | ✅ Standard App-Code |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Klassifizierungen, kleine Fixes |

⚠️ **Claude 4.0 Modelle (20250514) deprecated ab 15. Juni 2026 – Codebase prüfen!**
⚠️ **Gemini 2.0 Flash deprecated ab 1. Juni 2026 – Codebase prüfen!**

---

## Offene Bugs

| Bug | Status |
|---|---|
| Menü rutscht nach unten ohne Inhalt | offen |
| WC-Anlage setzt "publish" statt "draft" | offen |
| Tabellen-Rendering contenteditable SEO | offen |

---

## Lessons Learned

| Thema | Erkenntnis |
|---|---|
| Quill → contenteditable | Quill konnte WC Tabellen-HTML nicht rendern. Lösung: contenteditable-Div mit Mini-Toolbar. |
| dotenv Pfad | `.env` in Projekt-Root. Immer von Root starten. |
| Service Account + Drive | `supportsAllDrives: true` immer mitgeben. |
| GoogleAuth | Liest `GOOGLE_APPLICATION_CREDENTIALS` automatisch. |
| Auftragsmonitor on-hold | Status-Filter auf `processing,on-hold` erweitert. |
| GCP Org-Policy | Workload Identity statt JSON Key. |
| L-Shop Architektur | Inverse Verknüpfung: ein Klick markiert alle betroffenen Orders. |
| Abrechnungs-UI | Event-Delegation statt per-Button-Listener. stopPropagation auf Buttons verhindert versehentliches Schließen. |
| Header-basiert lesen | Per Header-Name statt fixer Position – robust gegen Schema-Änderungen. |
| PayPal-Pauschale aufteilen | Pauschale / Anzahl Artikel → genau einmal pro Bestellung. |
| Porto separat verrechnen | Porto NICHT in Lizenz-Gewinn – sonst zieht Lizenz% auch Porto. |
| WC Bestellungen ohne Kategorie | Kategorie steht nur am Produkt. Partner_Artikel Map nutzen – kein Extra-API-Call. |
| Doppelte Funktionsdefinition | Führt zu Endlos-Spinner. Funktionsnamen immer eindeutig und kontextspezifisch. |
| Dezimalzahlen im Frontend | `step="0.01"` + `parseFloat(val.replace(',', '.'))` + `valueInputOption: USER_ENTERED`. |
| toFloat Helper | Zentrale `toFloat(val)` Funktion – behandelt null/undefined/Komma/Punkt einheitlich. In 4 Dateien. |
| Sync Startdatum | Erster Sync: Pflichtfeld manuell. Folge-Sync: auto-detect aus Sheet → `?after=ISO`. |
| Dedup-Key Varianten | `orderId|artikelName|variationId|partnerId` – zwei Varianten desselben Artikels = separate Zeilen. |
| MwSt muss gepflegt sein | `line_item.total` aus WC = Netto. Ohne 19% in Fixkosten → falsche Brutto-Werte. |
| Abrechnungs-Flow Entwurf | Erstellen ≠ sofort fertig. Entwurf → prüfen → freigeben. Erst Freigabe setzt Positionen auf abgerechnet und macht Abrechnung für Partner sichtbar. |
| batchUpdate für Freigabe | Alle rowIndex-Updates in einem Sheets-API-Call statt N einzelnen. Schneller + atomarer. |
| deleteDimension statt leeren | Beim Verwerfen eines Entwurfs die Zeile physisch löschen – keine Lücken im Sheet. |
| Rate Limit 429 | 100 Req/15min pro IP. Cloud Run neu deployen leert In-Memory-Counter. |
| Cron-Job Partner-Sync | Partner-Aufruf triggert keinen Sync. Täglicher GitHub Actions Cron um 02:00. Manueller Button bleibt für sofortigen Bedarf. |

---

## Arbeitsweise

- **claude.ai:** Planung, Architektur, Briefings, Doku
- **Claude Code:** Implementierung (`claude-sonnet-4-6` Standard, `claude-opus-4-7` für komplexe Architektur/viel Frontend)
- **Gemini:** Google-Infrastruktur, Sprint-Briefings

---

*Dokument wird nach jeder relevanten Session aktualisiert und ins Claude Project hochgeladen.*
