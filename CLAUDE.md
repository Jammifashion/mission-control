# Claude Code – Arbeitshinweise Mission Control

## frontend/index.html (große Datei)
Vor jeder Änderung erst Struktur prüfen:
```bash
grep "SECTION" frontend/index.html
```

Aktuelle Sektionen:
- Navigation (Zeile 1072)
- Helpers (Zeile 1104)
- Auftragsmonitor (Zeile 1207)
- Auftragsmonitor: Shop Orders (Zeile 1801)
- Artikelerfassung (Zeile 1978)
- SEO-Flow (Zeile 2664)
- Kundenanfragen Extern (Zeile 4222)
- Settings (Zeile 3604)
- Partnerportal (Zeile 3724)
- Partner-Artikel-Tab (Zeile ~4532)
- Interne-Bestellungen-Tab (Zeile ~4710)
- Fixkosten-Konfiguration (Zeile ~4810)

Neue Sektionen immer mit Anker versehen:
```javascript
// ── SECTION: NAME (Zeile XXX) ──
```

## Wichtige Dateien
- backend/utils/secrets.js – Secret Manager, loadAllSecrets()
- backend/middleware/auth.js – X-API-Key Auth + Rate Limiting
- backend/routes/kalkulation.js – Partner CRUD, Druck-/Fixkosten, Abrechnungen
- backend/routes/partner-artikel.js – Partner_Artikel + Interne Bestellungen (Admin, MC_API_KEY)
- backend/routes/partnerPortal.js – Token-Auth für partner.html + WC-Sync
- backend/routes/anfragen.js – Kundenanfragen Admin (POST /neu, GET /, PATCH /:id/status) – hinter requireApiKey
- backend/routes/anfragen-chat.js – Chat-Widget public endpoint (POST /chat, kein API-Key) – vor requireApiKey
- frontend/anfrage.html – Standalone Chat-Widget für Kunden (GitHub Pages, kein MC-Design)
- backend/utils/partner-kalkulation.js – berechnePartnerAnteil() Helper
- docs/SEO Beschreibungs-Framework.md – SEO Prompt Vorlage
- GCP_Setup_Notizen.md – GCP IDs (lokal only, nicht im Repo)

## Deprecated
- Sheet-Spalten `Versand-Modell` und `PayPal-Modell` im Partner-Reiter sind seit Sprint 4.2 deprecated.
  Der Kalkulations-Helper nutzt zentrale Fixkosten + `Porto-Modell`. Spalten bleiben im Sheet, werden
  aber von Backend/Frontend nicht mehr gelesen/geschrieben.

## ENV Variablennamen (tatsächlich im Code)
ANTHROPIC_API_KEY, WC_KEY, WC_SECRET, WC_URL,
GOOGLE_SHEET_ID, BUSINESS_SHEET_ID, GEMINI_API_KEY,
MC_API_KEY, CORS_ORIGIN, GOOGLE_PROJECT_ID

## .env – nur im Repo-Root
Es gibt genau **eine** `.env`, im Projekt-Root. Kein `backend/.env` (war eine
veraltete Teilkopie, entfernt). Jedes Skript unter `backend/` lädt sie explizit
mit dem Pfad relativ zum eigenen Modul – nie `dotenv.config()` ohne `path`,
weil das vom aktuellen Arbeitsverzeichnis abhängt:

```javascript
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
// backend/index.js liegt eine Ebene höher → '../.env'
```

## Secrets für den lokalen Start (loadAllSecrets)
`backend/index.js` ruft vor dem Express-Setup `loadAllSecrets()` auf
(`backend/utils/secrets.js`). Lokal (`NODE_ENV !== 'production'`) kommen die
Werte aus `process.env`, also aus der Root-`.env`. **Jeder** Key aus
`SECRET_KEYS` muss gesetzt UND nicht leer sein – sonst `process.exit(1)`:

ANTHROPIC_API_KEY, WC_KEY, WC_SECRET, WC_URL, WC_KEY_HONK, WC_SECRET_HONK,
WC_URL_HONK, GOOGLE_SHEET_ID, BUSINESS_SHEET_ID, GEMINI_API_KEY, MC_API_KEY,
CORS_ORIGIN, TURNSTILE_SECRET_KEY, WP_APP_PASSWORD, WP_APP_PASSWORD_HONK

Ein leerer Wert zählt als fehlend. Für lokal ungenutzte Dienste (HonkShop,
Turnstile, WP-Upload) reicht ein Platzhalter wie `unused` – Hauptsache nicht
leer. Beim Abbruch listet die Konsole die Namen einzeln:
`✗ Secrets nicht vollständig geladen:` gefolgt von `<KEY> ist leer` je Zeile.

Zusätzlich läuft davor `backend/scripts/check-env.js` (Import in index.js) mit
einer kleineren Pflichtliste: ANTHROPIC_API_KEY, WC_KEY, WC_SECRET, WC_URL,
GOOGLE_SHEET_ID, GOOGLE_PROJECT_ID – meldet `✗ ENV fehlt: <KEY>`.

## Modell-Konfiguration
Modell-IDs stehen nicht in der `.env`, sondern im Business-Sheet, Reiter
`Config`: Spalte `Schlüssel` = `modell.<rolle>`, Spalte `Wert` = Modell-ID.
Rollen: `chat-kunde`, `klassifizierung`, `seo-text`, `agent-intern`.
Gelesen von `backend/lib/modelConfig.js` (`getModel(rolle)`, 5 min Cache).
Fallback auf `DEFAULT_MODELS`, wenn das Sheet nicht erreichbar ist oder der
Wert nicht auf `claude-*` / `gemini-*` passt.

## Script-Scope Problem (gelöst)
index.html hat zwei Script-Blöcke:
- `<script type="module">` (Zeile 1031) – Hauptcode
- `<script>` (Zeile ~3676) – Partnerportal

Helpers sind via window.* exponiert:
- window.apiFetch
- window.showToast
- window.API_BASE
- window.showConfirm
