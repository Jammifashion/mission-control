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
- Settings (Zeile 3604)
- Partnerportal (Zeile 3724)

Neue Sektionen immer mit Anker versehen:
```javascript
// ── SECTION: NAME (Zeile XXX) ──
```

## Wichtige Dateien
- backend/utils/secrets.js – Secret Manager, loadAllSecrets()
- backend/middleware/auth.js – X-API-Key Auth + Rate Limiting
- backend/routes/kalkulation.js – Partnerportal Backend
- docs/SEO Beschreibungs-Framework.md – SEO Prompt Vorlage
- GCP_Setup_Notizen.md – GCP IDs (lokal only, nicht im Repo)

## ENV Variablennamen (tatsächlich im Code)
ANTHROPIC_API_KEY, WC_KEY, WC_SECRET, WC_URL,
GOOGLE_SHEET_ID, BUSINESS_SHEET_ID, GEMINI_API_KEY,
MC_API_KEY, CORS_ORIGIN, GOOGLE_PROJECT_ID

## Script-Scope Problem (gelöst)
index.html hat zwei Script-Blöcke:
- `<script type="module">` (Zeile 1031) – Hauptcode
- `<script>` (Zeile ~3676) – Partnerportal

Helpers sind via window.* exponiert:
- window.apiFetch
- window.showToast
- window.API_BASE
- window.showConfirm
