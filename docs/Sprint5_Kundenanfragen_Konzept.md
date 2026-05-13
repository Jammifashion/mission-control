# Sprint 5 – Kundenanfragen Extern
**Version:** 1.0
**Erstellt:** Mai 2026
**Status:** Konzept / Planung

---

## Ziel

Externe Kundenanfragen (Homepage + E-Mail) strukturiert erfassen, per KI-Agent vorqualifizieren und gesammelt in Mission Control übergeben. Kein manuelles Abtippen, kein Informationsverlust.

---

## Zwei Eingangskanäle

### Kanal 1: Homepage Chat-Widget

**Konzept:**
- Eigene moderne HTML-Seite (`jammifashion.de/anfrage` oder ähnlich)
- Kein generisches Widget – eigenes Design, modern, "Hey das ist neu"-Gefühl
- Chat-Interface: Kunde tippt, KI-Agent antwortet live, stellt Rückfragen
- Wenn alle Infos vollständig: Preisvorschlag anzeigen
- Kunde bestätigt → Daten gehen an Mission Control

**Gesprächsfluss Agent:**
```
1. Begrüßung + "Was kann ich für dich tun?"
2. Produkt/Motiv klären
3. Menge klären
4. Varianten (Farbe, Größe)
5. Vereinsauftrag? → Partner-Zuordnung
6. Name + E-Mail für Rückmeldung
7. Preisvorschlag berechnen + anzeigen
8. Anmerkungen des Kunden aufnehmen
9. "Soll ich die Anfrage absenden?" → Bestätigung
10. POST an Mission Control
```

**Preisberechnung:**
- Anhand Kalkulation_Verkaufspreise + Kalkulation_Druckpreise aus Business Sheet
- Ausnahme: Wenn Kunde Kategorie für Shop-Lizenzeinnahmen möchte → anderer Flow (später klären)

**Technisch:**
- Eigene statische HTML-Seite (modern, nicht PWA-Style)
- Backend-Endpoint: `POST /api/anfragen/chat` → Claude Sonnet führt Gespräch
- Agent kennt: Produktkatalog (WC), Preise (Sheet), Partner-Liste
- Abschluss: `POST /api/anfragen/neu` → Sheet `Kundenanfragen`
- Modell: `claude-sonnet-4-6`

---

### Kanal 2: Gmail-Agent (Google Workspace)

**Konzept:**
- Kundenanfragen per E-Mail kommen in Gmail-Postfach
- Gemini-Agent liest, klassifiziert, beantwortet automatisch
- Führt ggf. Rückfrage-E-Mail wenn Infos fehlen
- Wenn E-Mailverkehr final/vollständig: Info an Mission Control
- Umlabeln in Gmail (z.B. Label "Anfragen → Erledigt" oder "An MC übergeben")

**Technisch:**
- Google Workspace + Gemini Integration (Apps Script oder Cloud Function)
- Gemini 2.5 Flash für Klassifizierung + Antwort
- Gmail-Label als Trigger: z.B. Label "Kundenanfrage"
- Automatische Antwort ohne manuelles Zutun
- Abschluss: `POST /api/anfragen/neu` → gleicher Endpoint wie Chat-Widget
- Modell: `gemini-2.5-flash` (Google Workspace nativ)

**Status-Labels in Gmail (Vorschlag):**
```
Kundenanfrage/Neu       ← eingehend
Kundenanfrage/In Arbeit ← Agent klärt Rückfragen
Kundenanfrage/Fertig    ← an Mission Control übergeben
```

---

## Neuer Reiter: Kundenanfragen (Mission Control)

**Tab-Name:** "Kundenanfragen Extern" (neben JFN Shop, HonkShop, L-Shop, DTF)

**Sheet-Reiter:** `Kundenanfragen` (im SSOT oder Business Sheet – noch offen)

**Spaltenstruktur:**
```
A: Anfrage-ID          ← KA-YYYY-NNNN
B: Datum
C: Kanal               ← Homepage / E-Mail / Manuell
D: Kunde Name
E: Kunde E-Mail
F: Produkt/Beschreibung
G: Menge
H: Varianten           ← Farbe, Größe etc.
I: Partner-ID          ← falls Vereinsauftrag
J: Preisvorschlag      ← berechnet vom Agent
K: Anmerkungen Kunde
L: Status              ← Neu / Geprüft / Angebot gesendet / Bestätigt / In Produktion / Abgeschlossen
M: Notiz intern
N: Übergabe an WC      ← leer / WC-Order-ID wenn angelegt
```

**Status-Flow:**
```
Neu → Geprüft → Angebot gesendet → Bestätigt → In Produktion → Abgeschlossen
```

**UI in Mission Control:**
- Tabelle mit allen Anfragen, filterbar nach Status + Kanal
- Klick auf Zeile → Detail-Ansicht mit vollständigem Gesprächsverlauf
- Button "In WooCommerce anlegen" → legt Bestellung manuell an (Sprint 5.2)
- Button "Angebot senden" → öffnet E-Mail-Template (Sprint 6)

---

## Offene Punkte (für spätere Klärung)

| Punkt | Details |
|---|---|
| Shop-Lizenz-Anfragen | Wenn Kunde Kategorie für Shop-Lizenzeinnahmen will → eigener Flow |
| WC-Anlage aus Anfrage | Button "In WooCommerce anlegen" – Sprint 5.2 |
| E-Mail-Template | Angebotsmail automatisch generieren – Sprint 6 |
| Voice-Eingang | Sprachnachrichten → Transkription → Agent – später |
| WhatsApp | Über externe App, kein direkter MC-Eingang aktuell |

---

## Technische Abhängigkeiten

| Abhängigkeit | Status |
|---|---|
| `POST /api/anfragen/chat` | neu (Sprint 5) |
| `POST /api/anfragen/neu` | neu (Sprint 5) |
| `GET /api/anfragen` | neu (Sprint 5) |
| Sheet `Kundenanfragen` | neu (Sprint 5, Setup-Skript) |
| Gmail-Label-Integration | Gemini Workspace Agent (Sprint 5) |
| Chat-Widget HTML | neue Seite, kein PWA-Style (Sprint 5) |

---

## Reihenfolge (Vorschlag)

```
Phase 1: Backend + Sheet
  - Setup-Skript Kundenanfragen-Reiter
  - POST /api/anfragen/neu
  - GET /api/anfragen

Phase 2: Mission Control Tab
  - Neuer Tab "Kundenanfragen Extern"
  - Tabelle + Detail-Ansicht

Phase 3: Chat-Widget
  - Eigene HTML-Seite (modernes Design)
  - Claude Sonnet Agent mit Gesprächsfluss
  - Preisberechnung via Sheet-API

Phase 4: Gmail-Agent
  - Google Workspace / Gemini Integration
  - Auto-Antwort + Umlabeln
  - Übergabe an Mission Control

Phase 5: WC-Anlage aus Anfrage (Sprint 5.2)
```

---

*Konzept wird vor Sprint-Start verfeinert. Zuerst Sprint 4.3 testen und stabilisieren.*
