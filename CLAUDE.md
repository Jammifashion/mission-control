# Claude Code – Arbeitshinweise Mission Control

## frontend/index.html (große Datei)
Vor jeder Änderung erst Struktur prüfen:
```bash
grep "SECTION" frontend/index.html
```

Aktuelle Sektionen:
- Navigation (Zeile 1072)
- Stand-Anzeige (Zeile ~2276)
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
- backend/routes/trikot.js – POST /api/trikot/sync (hinter requireApiKey), Body optional
  `{ after, dryRun }`; Aufrufer ist `.github/workflows/trikot-sync-daily.yml` per curl
- backend/lib/trikotSync.js – einzige Implementierung des Trikot-Sync (WC + Sheets);
  `backend/scripts/sync-trikot.js` ist nur der lokale Aufrufer. Reine Logik in
  `backend/utils/trikot-logic.js`, Reiter-Setup in `backend/scripts/setup-trikot-reiter.js`.
  Grundsatz: API-Aufrufe an externe Dienste liegen in `lib/`, nicht in `routes/`.
- backend/lib/seo-prompt.js – SEO-Prompt: User-Template, MODUS-Enum, Materialfilter.
  Die Regeln stehen hier, das ist die Quelle. Begründungen und Historie liegen im
  Claude-Projekt unter METHODE/SEO_Beschreibungs_Framework.md (nicht im Repo).
- backend/lib/seo-meta.js – Yoast SEO-Titel und Meta-Beschreibung, deterministisch
  (kein Modell). Einzige Quelle; index.html spiegelt den Bau-Teil im Block
  `SEO-Meta: Anfang/Ende`. Faserangabe + Grammatur liefert
  `POST /api/seo/meta-eingaben` (backend/routes/seo-meta.js), weil
  filterMaterialFarben nur im Backend lebt.

- backend/lib/lieferzeiten.js – German-Market-Lieferzeit (`_lieferzeit`, Term-ID als
  String). Quelle: SSOT-Reiter `Struktur_Lieferzeiten` (Term_ID | Name | Slug), erste
  Zeile = Standard bei der Anlage. Kein Fallback, keine IDs im Code. Variationen bekommen
  bei der Anlage `"-1"` (wie Elternartikel). Aenderungspfad schreibt nur bei geaenderter
  Auswahl, nur am Elternartikel. Frontend-Spiegel: Block `Lieferzeit: Anfang/Ende`.

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
CORS_ORIGIN, TURNSTILE_SECRET_KEY, WP_APP_PASSWORD, WP_APP_PASSWORD_HONK,
CHAT_SESSION_SECRET, GOOGLE_DRIVE_SHARED_DRIVE_ID, GOOGLE_DRIVE_BACKUP_DAILY_ID,
GOOGLE_DRIVE_BACKUP_MONTHLY_ID

Ein leerer Wert zählt als fehlend. Für lokal ungenutzte Dienste (HonkShop,
Turnstile, WP-Upload) reicht ein Platzhalter wie `unused` – Hauptsache nicht
leer. Beim Abbruch listet die Konsole die Namen einzeln:
`✗ Secrets nicht vollständig geladen:` gefolgt von `<KEY> ist leer` je Zeile.

Zusätzlich läuft davor `backend/scripts/check-env.js` (Import in index.js) mit
einer kleineren Pflichtliste: ANTHROPIC_API_KEY, WC_KEY, WC_SECRET, WC_URL,
GOOGLE_SHEET_ID, GOOGLE_PROJECT_ID – meldet `✗ ENV fehlt: <KEY>`.

## Deployment (Cloud Run)
Projekt `mission-control-495711`, Region `europe-west1`, Service
`mission-control-backend`.

Image in der Artifact Registry:
`europe-west1-docker.pkg.dev/mission-control-495711/mission-control/backend`

Der GitHub-Actions-Trigger (`.github/workflows/deploy-backend.yml`) feuert nur
bei **push auf `main` UND** Änderungen unter `backend/**` oder am `Dockerfile`.
Änderungen ausserhalb dieser Pfade (z.B. nur `docs/`, CLAUDE.md, `.env.example`)
lösen **kein** Backend-Deployment aus – die Revision bleibt auf dem alten Stand.
`frontend/**` hat einen eigenen Workflow (`deploy.yml` → GitHub Pages), der das
Backend nicht anfasst. `deploy-backend.yml` hat **kein** `workflow_dispatch`:
eine neue Revision entsteht nur über einen Push, der die Pfad-Filter trifft.

In Cloud Run gesetzt sind nur `NODE_ENV=production` und
`GOOGLE_PROJECT_ID=mission-control-495711`; alle übrigen Werte kommen aus dem
Secret Manager.

Welcher Code laeuft, zeigt die Fusszeile im Dashboard: "Stand: Oberflaeche <sha> · Backend <sha>".
Backend: `GET /health` (offen) gibt `commit` (7 Zeichen) und `gebaut` (ISO) aus
(`backend/utils/stand.js`). Die Werte kommen als Build-Arg `MC_COMMIT`/`MC_GEBAUT` ins Image
(Dockerfile ARG -> ENV, gesetzt in `deploy-backend.yml`), nicht als Service-Variable.
Oberflaeche: Meta-Tags `mc-commit`/`mc-gebaut` in `index.html`, Platzhalter `__MC_COMMIT__`/
`__MC_GEBAUT__` stempelt `deploy.yml` (Schritt "Stand stempeln"); im Repo bleiben sie stehen,
lokal zeigt die Fusszeile "lokal". Unterschiedliche Kennungen sind normal.

Ladereihenfolge der Konfiguration: **Env-Var → `.env` → GCP Secret Manager**
(Secret Manager greift in production, siehe `getSecret()` in
`backend/utils/secrets.js`).

## Neues Secret anlegen
1. Secret im GCP Secret Manager anlegen (Browser, Account gbr@jammifashion.de)
2. Platzhalter in `.env.example` ergänzen
3. Schlüssel in `SECRET_KEYS` in `backend/utils/secrets.js` eintragen
4. Pushen

Cloud Run zieht eine neue Secret-Version erst beim Start einer neuen Revision –
ein Secret-Update allein wirkt nicht auf die laufende Instanz.

`deploy-backend.yml` hat kein `workflow_dispatch`, es gibt also keinen
Redeploy-Knopf in der GitHub-UI. Eine neue Revision erzwingt man nur mit einem
Push, der den `paths`-Filter trifft – also einer **echten** Änderung unter
`backend/**` oder am `Dockerfile` (z.B. eine Kommentarzeile).
`git commit --allow-empty` funktioniert dafür **nicht**: ein leerer Commit ändert
keine Datei, der `paths`-Filter matcht nichts, der Workflow startet nicht.
Alternative: `workflow_dispatch` im Workflow ergänzen – bisher bewusst nicht
geschehen, weil es noch niemand gebraucht hat.

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
