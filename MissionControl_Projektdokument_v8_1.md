# Mission Control – Projektdokument
**Version:** 8.1
**Letzte Aktualisierung:** Mai 2026 (Sprint 5.4 HonkShop + 5.5 Festpreismodell)
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
| `Kalkulation_Fixkosten` | ✓ Historie-Funktion (Gültig_ab/Gültig_bis) |
| `Kalkulation_Verkaufspreise` | ✓ |
| `Partner` | ✓ + Porto-Modell |
| `Partner_Verkäufe` | ✓ + Produkt-ID Spalte J |
| `Partner_Abrechnungen` | ✓ + Positionen-Spalte (JSON) |
| `Partner_Artikel` | ✓ |
| `Partner_Interne_Bestellungen` | ✓ |
| `Kundenanfragen` | ✓ Sprint 5 |
| `HK_Partner_Verkäufe` | ✓ Sprint 5.4 HonkShop |
| `HK_Partner_Abrechnungen` | ✓ Sprint 5.4 HonkShop |
| `HK_Partner_Artikel` | ✓ Sprint 5.4 HonkShop |
| `FP_Partner` | ✓ Sprint 5.5 Festpreismodell |
| `FP_Artikel` | ✓ Sprint 5.5 Festpreismodell |
| `FP_Verkäufe` | ✓ Sprint 5.5 Festpreismodell |
| `FP_Abrechnungen` | ✓ Sprint 5.5 Festpreismodell |

### Partner_Abrechnungen Spaltenstruktur

```
A: Abrechnungs-ID
B: Partner-ID
C: Zeitraum-Von
D: Zeitraum-Bis
E: Gesamt-Netto
F: Gesamt-Brutto
G: Status          ← Entwurf / Freigegeben
H: Erstellt-Am
I: Positionen      ← JSON Array
```

### Partner_Verkäufe Spaltenstruktur

```
A: Partner-ID
B: Datum                 ← DD.MM.YYYY
C: WC-Bestellnummer
D: Artikelname
E: Variante              ← variation_id
F: Stückzahl
G: VK-Preis-Netto        ← item.total aus WC (bereits netto)
H: Lizenzgebühr          ← netto
I: Status Abrechnung     ← offen / abgerechnet
J: Produkt-ID            ← WC product_id (Primary Key für Lookup)
K: Gewinn-netto
L: Lizenz-Anteil
M: Porto-Saldo
N: Anteil-Brutto
```

**Dedup-Key:** `orderId|artikelName|variationId|partnerId`

### Kalkulation_Fixkosten Spaltenstruktur (neu v8.0)

```
A: Position     ← z.B. "MwSt"
B: Wert         ← 19
C: Einheit      ← %, EUR/Artikel, EUR/Bestellung
D: Gültig_ab    ← 01.01.2022
E: Gültig_bis   ← leer = aktuell gültig
```

**Lookup:** `getKostenSatz(rows, header, position, datum)` → findet historisch korrekten Satz

### Kundenanfragen Spaltenstruktur (neu Sprint 5)

```
A: Anfrage-ID          ← KA-YYYY-NNNN
B: Datum               ← DD.MM.YYYY
C: Kanal               ← Homepage / E-Mail / Manuell
D: Kunde-Name
E: Kunde-Email
F: Produkt-Beschreibung
G: Menge
H: Varianten
I: Partner-ID          ← falls Vereinsauftrag
J: Preisvorschlag      ← berechnet vom Agent
K: Anmerkungen-Kunde
L: Status              ← Neu / Geprüft / Angebot-gesendet / Bestätigt / In-Produktion / Abgeschlossen
M: Notiz-intern
N: WC-Order-ID
```

---

## Kalkulationsmodell (Stand Session 14 – vollständig Netto-Basis)

```
// WC liefert bereits Netto – KEIN MwSt-Abzug mehr nötig!
vkNetto              = item.total (WC, bereits netto)                            // (netto)
herstellung          = ekPreis + druckkosten + herstellungsNK                    // (netto)
versandnk            = (B|P-Versandnebenkosten) × bestellungsAnteil              // (netto)
paypalKosten         = vkNetto × paypal% + (paypalPauschale × bestellungsAnteil) // (netto)
gewinnNetto          = vkNetto − herstellung − versandnk − paypal                // (netto)

Porto separat:
bestellungsAnteil    = itemNetto / orderNetto (wertbasiert)
portoEinnahmeAnteil  = shipping_total (WC, bereits netto) × bestellungsAnteil   // (netto)
portoKostenAnteil    = (Porto-B|Porto-P) × bestellungsAnteil                    // (netto)
portoSaldoArtikel    = portoEinnahmeAnteil − portoKostenAnteil                  // (netto)

partner-trägt:        partnerAnteilNetto = gewinnNetto × lizenz% + portoSaldoArtikel
geteilt-50-50:        partnerAnteilNetto = gewinnNetto × lizenz% + portoSaldoArtikel / 2

// Brutto-Ausgabe für Abrechnung:
partnerAnteilBrutto  = partnerAnteilNetto × (1 + mwst% / 100)
```

**Wichtig:** Alle Fixkosten (Porto B/P, Versandnebenkosten, PayPal-Pauschale) sind Netto-Werte im Sheet.

---

## API-Routen Übersicht

| Route | Datei | Beschreibung |
|---|---|---|
| `GET /api/orders` | orders.js | WC Bestellungen |
| `GET /api/produkte` | produkte.js | WC Produkte |
| `POST /api/produkte` | produkte.js | Artikel anlegen |
| `GET /api/kalkulation/*` | kalkulation.js | Sheet-Daten |
| `POST /api/partner/verkaeufe/sync` | partnerPortal.js | Partner-Sync |
| `GET /api/partner/verkaeufe` | partnerPortal.js | Verkäufe lesen |
| `POST /api/anfragen/neu` | anfragen.js | Neue Anfrage (API-Key) |
| `GET /api/anfragen` | anfragen.js | Anfragen lesen (API-Key) |
| `PATCH /api/anfragen/:id/status` | anfragen.js | Status updaten (API-Key) |
| `POST /api/anfragen/chat` | anfragen-chat.js | Chat-Agent (öffentlich, Rate-Limit) |

---

## Frontend-Seiten

| Datei | URL | Beschreibung |
|---|---|---|
| `frontend/index.html` | GitHub Pages | Mission Control PWA (Dark UI) |
| `frontend/partner.html` | GitHub Pages | Partner-Portal (öffentlich) |
| `frontend/anfrage.html` | GitHub Pages | Chat-Widget für Kunden (öffentlich) |

**anfrage.jammifashion.de** → CNAME auf GitHub Pages (geplant)

---

## Sprint 5: Kundenanfragen Extern

### Gesprächsfluss Chat-Agent (10 Schritte)
```
1. Begrüßung
2. Produkt/Motiv klären
3. Menge klären
4. Varianten (Farbe, Größe)
5. Vereinsauftrag? → Partner-ID
6. Name + E-Mail
7. Preisvorschlag berechnen + anzeigen
8. Anmerkungen aufnehmen
9. Bestätigung einholen
10. POST /api/anfragen/neu → Mission Control
```

### Modelle
- **Chat-Widget:** `claude-haiku-4-5-20251001` (schnell, günstig, strukturierter Flow)
- **Gmail-Agent:** `gemini-2.5-flash` (Google Workspace nativ)

### Status-Flow Anfragen
```
Neu → Geprüft → Angebot-gesendet → Bestätigt → In-Produktion → Abgeschlossen
```

### Phase-Status

| Phase | Inhalt | Status |
|---|---|---|
| 5.1 | Sheet `Kundenanfragen` + Backend-Endpunkte | ✓ |
| 5.2 | MC-Tab "Kundenanfragen Extern" | ✓ |
| 5.3 | Chat-Widget `anfrage.html` | ✓ |
| 5.4 | HonkShop Multi-Shop anbinden | ✓ |
| 5.5 | Festpreismodell Hamburg Crocodiles | ✓ |
| 5.6 | Agent-Wissen Tab | offen |
| 5.7 | Gmail-Agent (Gemini Workspace) | offen |


---

## Sprint 5.5: Agent-Wissen Tab (Konzept)

Eigener Reiter in Mission Control – alles was der Chat-Agent wissen soll an einem Ort:

**Bereich 1 – Staffelpreise (live aus Sheet + direkt editierbar in MC)**
- Tabelle zeigt aktuelle Staffelpreise aus `Kalkulation_Verkaufspreise`
- Direkt in MC bearbeiten → speichert zurück ins Sheet
- Kein Google Sheets öffnen nötig

**Bereich 2 – Produktinfos**
- Welche Produkte, Mindestmengen, Lieferzeiten
- Druckinfos (Farben egal für Preis, Positionen etc.)
- Was ihr nicht anbietet

**Bereich 3 – Freitext Wissen**
- Tonalität (du/Sie, locker/förmlich)
- Häufige Fragen + Antworten
- Sonderregeln

**Bereich 4 – Prompt Generator**
- Button "System-Prompt generieren (KI)" → Claude liest alle Daten + Freitext → optimierter Prompt
- Vorschau + manuell anpassbar
- Button "Aktivieren" → speichert als aktiven Agent-Prompt

**Button "Knowledge Base exportieren"** → `jammi-knowledge.md` → wird beim Chat-Agent geladen

---

## Diagnose-Tools

```bash
# Lizenz-Berechnungsweg für eine Order debuggen
NODE_TLS_REJECT_UNAUTHORIZED=0 node backend/scripts/debug-lizenz-order.js <ORDER-ID>

# Orders nach Produktname suchen
NODE_TLS_REJECT_UNAUTHORIZED=0 node backend/scripts/find-order-by-product.js "Produktname"

# Sheet-Formate setzen (Datum + Währung)
NODE_TLS_REJECT_UNAUTHORIZED=0 node backend/scripts/setup-sheet-formate.js
```

---

## Datei-Struktur

```
mission-control/
├── backend/
│   ├── lib/
│   │   └── googleAuth.js
│   ├── routes/
│   │   ├── anfragen.js          ← Sprint 5
│   │   ├── anfragen-chat.js     ← Sprint 5 (öffentlich)
│   │   ├── kalkulation.js
│   │   ├── orders.js
│   │   ├── partnerPortal.js
│   │   ├── partner-artikel.js
│   │   └── produkte.js
│   ├── scripts/
│   │   ├── debug-lizenz-order.js
│   │   ├── find-order-by-product.js
│   │   ├── setup-fixkosten-historie.js
│   │   ├── setup-kundenanfragen.js
│   │   ├── setup-sheet-formate.js
│   │   └── sync-one-order.js
│   └── utils/
│       └── partner-kalkulation.js
├── frontend/
│   ├── index.html               ← Mission Control PWA
│   ├── partner.html             ← Partner-Portal
│   └── anfrage.html             ← Chat-Widget Kunden
└── .github/
    └── workflows/
        ├── backup-daily.yml
        ├── deploy-backend.yml
        └── sync-partner-daily.yml
```

---

## Fahrplan

| Sprint | Inhalt | Status |
|---|---|---|
| 1–2.7 | Core + Auftragsmonitor + DTF | ✓ |
| 3 | Cloud Migration + Kalkulation | ✓ |
| 4.1 | Partner-Portal Basis | ✓ |
| 4.2 | Partner-Artikel + Sync + Kalkulation + partner.html | ✓ |
| 4.3 | Varianten-Bug + Abrechnungs-Flow Redesign + Cron | ✓ |
| Vor-5 | Fixkosten-Historie + Kalkulation Netto-Basis | ✓ |
| 5.1–5.3 | Kundenanfragen Backend + MC-Tab + Chat-Widget | ✓ |
| 5.4 | HonkShop Multi-Shop anbinden | ✓ |
| 5.5 | Festpreismodell Hamburg Crocodiles | ✓ |
| 5.6 | Agent-Wissen Tab | offen |
| 5.7 | Gmail-Agent Gemini | offen |
| 6 | Kunden-Kommunikation | offen |
| 7 | KPI-Dashboard + Agenten | offen |
| 8+ | SaaS-Evaluation | offen |

---

## Gemini Modelle (Stand Mai 2026)

| Modell | API String | Status |
|---|---|---|
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | ✅ GA |
| Gemini 2.5 Flash | `gemini-2.5-flash` | ✅ Stabil, Standard |
| Gemini 2.0 Flash | `gemini-2.0-flash` | ⚠️ Shutdown 1. Juni 2026! |

## Claude Modelle (Stand Mai 2026)

| Modell | API String | Empfehlung |
|---|---|---|
| Claude Opus 4.6 | `claude-opus-4-6` | Komplexe UI, große Refactorings |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | ✅ Standard App-Code |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | Chat-Widget, Klassifizierungen |

⚠️ **Gemini 2.0 Flash deprecated ab 1. Juni 2026 – Codebase prüfen!**

### Aktuelle Gemini Modell-Empfehlung (Mai 2026)
| Aufgabe | Modell | Hinweis |
|---|---|---|
| Klassifizierung, SEO, Gmail-Agent | `gemini-3.1-flash-lite` | 40% günstiger + schneller als 2.5 Flash |
| Komplexe Agenten, Reasoning | `gemini-3.5-flash` | Schlägt 3.1 Pro, 4× schneller |
| Chat-Widget Kunden | `claude-haiku-4-5-20251001` | Bleibt |
| Standard App-Code | `claude-sonnet-4-6` | Bleibt |
| Komplexe UI | `claude-opus-4-6` | Bleibt |

---

## Offene Bugs

| Bug | Status |
|---|---|
| Menü rutscht nach unten ohne Inhalt | offen |
| WC-Anlage setzt "publish" statt "draft" | offen |
| Tabellen-Rendering contenteditable SEO | offen |

---

## Erledigt Session 14–16 (Mai 2026)

- ✓ Kalkulation Netto-Basis: MwSt-Abzug entfernt, WC liefert bereits Netto
- ✓ Porto-Einnahme: shipping_total korrekt anteilig gezogen
- ✓ Artikel-Matching: Produkt-ID als Primary Key (kein Name-Matching mehr)
- ✓ RAW-Schreiben ins Sheet: kein Datums-Parsing-Bug mehr
- ✓ Spaltenformate Partner_Verkäufe: Datum + Währung korrekt
- ✓ Partner-Filter beim Sync
- ✓ Fixkosten-Historie: Setup + Helper + UI mit Datepicker
- ✓ Sprint 2.7: DTF Sub-Reiter + Lieferzeit-Anzeige
- ✓ Sprint 5.1: Sheet Kundenanfragen + Backend-Endpunkte
- ✓ Sprint 5.2: MC-Tab "Kundenanfragen Extern" (Opus, modern)
- ✓ Sprint 5.3: Chat-Widget anfrage.html (Haiku, Mobile-first)
- ✓ Varianten Mehrfachauswahl zum Löschen (geplant)
- ✓ Sprint 5.4: HonkShop Multi-Shop (shopConfig.js, withShopParam, HK_* Sheets)
- ✓ HonkShop Single-Partner erzwungen, Artikel-Tab vereinfacht
- ✓ Sprint 5.5: Festpreismodell Hamburg Crocodiles (FP_* Sheets, MC-Tab, partner-festpreis.html)
- ✓ Gem Prompt v2.0 erstellt (Node.js, Multi-Shop, aktueller Stack)
- ✓ SSOT + Gem Prompt in Shared Drive verschoben

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
| Abrechnungs-UI | Event-Delegation statt per-Button-Listener. stopPropagation verhindert versehentliches Schließen. |
| Header-basiert lesen | Per Header-Name statt fixer Position – robust gegen Schema-Änderungen. |
| PayPal-Pauschale aufteilen | Pauschale / Anzahl Artikel → genau einmal pro Bestellung. |
| Porto separat verrechnen | Porto NICHT in Lizenz-Gewinn – sonst zieht Lizenz% auch Porto. |
| WC Bestellungen ohne Kategorie | Kategorie steht nur am Produkt. Partner_Artikel Map nutzen. |
| Doppelte Funktionsdefinition | Führt zu Endlos-Spinner. Funktionsnamen immer eindeutig. |
| toFloat Helper | Zentrale `toFloat(val)` Funktion – behandelt null/undefined/Komma/Punkt einheitlich. |
| Sync Startdatum | Erster Sync: Pflichtfeld manuell. Folge-Sync: auto-detect aus Sheet. |
| Dedup-Key Varianten | `orderId\|artikelName\|variationId\|partnerId` – zwei Varianten = separate Zeilen. |
| WC item.total ist Netto | `prices_include_tax: true` → Netto. Kein MwSt-Abzug nötig. Brutto erst am Ende. |
| Artikel-Matching via Produkt-ID | Name-Matching scheitert an Varianten-Suffixen. Immer product_id als Primary Key. |
| Fixkosten als Netto pflegen | Alle Werte in Kalkulation_Fixkosten sind Netto. Historisierung via Gültig_ab/Gültig_bis. |
| valueInputOption RAW | USER_ENTERED interpretiert 7.39 als Datum. RAW + Number-Typ verhindert das. |
| Spaltenformate Sheet | Formate einmalig via batchUpdate setzen – bleibt egal was reingeschrieben wird. |
| Chat-Agent Kontext | Letzte 20 abgeschlossene Anfragen als Kontext → Agent antwortet "erfahrener". |
| Öffentliche Chat-Route | /api/anfragen/chat vor requireApiKey registrieren. Eigener Rate-Limiter 50/15min. |

---

## Arbeitsweise

- **claude.ai:** Planung, Architektur, Briefings, Doku
- **Claude Code Sonnet 4.6:** Standard App-Code, Debugging
- **Claude Code Opus 4.6:** Komplexe UI, großes Frontend
- **Gemini:** Google-Infrastruktur, Gmail-Agent, Sprint-Briefings

---

*Dokument wird nach jeder relevanten Session aktualisiert und ins Claude Project hochgeladen.*

---

## Sprint 5.5: Festpreismodell (Hamburg Crocodiles)

### Zwei Abrechnungsmodelle

| | Lizenzmodell | Festpreismodell |
|---|---|---|
| **Basis** | Lizenz-% vom Gewinn | Fester EK-Preis je Artikel |
| **Porto-Einnahmen** | 50/50 oder Partner-trägt | 100% an Partner |
| **Porto-Kosten** | 50/50 oder Partner-trägt | 100% abgezogen |
| **PayPal** | anteilig abgezogen | direkt aus Bestellung |
| **Handling** | – | je Bestellung/Artikel konfigurierbar |
| **Beispiel** | Tim, Tobi | Hamburg Crocodiles |

### Kategorie-Zuordnung
- Jede WC-Hauptkategorie bekommt Modell: `Lizenz` oder `Festpreis`
- Kategorie `Festpreis` → gesperrt für Lizenz-Abrechnung
- Kategorie `Lizenz` → gesperrt für Festpreis-Abrechnung
- Hamburg Crocodiles Kategorien → alle `Festpreis`

### Neuer MC-Tab: "Festpreis Partner"

Gleiche Struktur wie Lizenzmodell-Tab, aber angepasst:

| Unter-Tab | Inhalt |
|---|---|
| Artikel | Artikel aus WC ziehen, Festpreis je Artikel pflegen, Handling-Gebühr je Artikel |
| Bestellungen | Sync + Übersicht Festpreis-Verkäufe |
| Interne Bestellungen | wie Lizenzmodell |
| Abrechnung | Festpreis-Abrechnung erstellen + freigeben |

**Kalkulation-Tab entfällt** – keine Staffelpreise/Lizenz-Vorschau nötig.

### Sheet-Struktur (neu)

**`Festpreis_Artikel`**
```
A: Partner-ID
B: Produkt-ID        ← WC product_id
C: Artikelname
D: Festpreis-EK      ← was Partner bekommt je Artikel
E: Handling-Gebühr   ← zusätzlich je Artikel (0 wenn keins)
F: WC-Kategorie
G: Letzte-Synchro
```

**`Festpreis_Verkäufe`**
```
A: Partner-ID
B: Datum
C: WC-Bestellnummer
D: Artikelname
E: Variante
F: Stückzahl
G: Festpreis-EK      ← aus Festpreis_Artikel
H: Handling          ← aus Festpreis_Artikel
I: Porto-Einnahme    ← shipping_total anteilig (100% an Partner)
J: Porto-Kosten      ← Porto B/P aus Fixkosten (100% abgezogen)
K: Versandnebenkosten← aus Fixkosten (100% abgezogen)
L: PayPal-Kosten     ← direkt aus WC Bestellung berechnet
M: Gesamt-Partner    ← EK + Handling + Porto-Einnahme - Porto-Kosten - NK - PayPal
N: Status Abrechnung ← offen / abgerechnet
O: Produkt-ID
```

### Berechnungsformel Festpreismodell
```
partnerBetrag = festpreisEK
              + handlingGebuehr
              + portoEinnahmeAnteil      // 100% shipping_total anteilig
              - portoKostenAnteil        // Porto B/P aus Fixkosten
              - versandnebenkostenAnteil // aus Fixkosten
              - paypalKosten             // vkBrutto × paypal% + pauschale anteilig

// Brutto am Ende:
partnerBrutto = partnerBetrag × (1 + mwst% / 100)
```

### Partner-Oberfläche
- Eigene `partner-festpreis.html` oder Erweiterung von `partner.html` mit Modell-Erkennung
- Zeigt Festpreis-Verkäufe + Abrechnungen
- Keine Lizenz-Spalten, keine Gewinn-Anzeige

### Offene Fragen vor Sprint-Start
- Handling-Gebühr: einheitlich pro Bestellung oder je Artikel unterschiedlich? → je Artikel
- Mehrere Festpreis-Partner möglich? → ja, Kategorie-Zuordnung regelt das
- Eigene `partner-festpreis.html` oder gemeinsame `partner.html` mit Weiche? → klären
