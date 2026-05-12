# GCP Setup & Secret Management – Mission Control

**Projekt:** mission-control-495711  
**Service Account:** mission-control-sa@mission-control-495711.iam.gserviceaccount.com  
**Region:** europe-west1

---

## Secrets in GCP Secret Manager

### Google Sheets
- **GOOGLE_SHEET_ID** – SSOT (Produkte, Kategorien, Attribute)
- **BUSINESS_SHEET_ID** – Jammi Business (Kalkulation, Partner, Abrechnungen)
  - Secret angelegt: 09.05.2026
  - Sheet: "Jammi Business" im Shared Drive Mission Control
  - ID: `1z2APMm4DQ_v-hKOKcqE7l-jqj9qDeghHVR73C-N9_xs`

### APIs & Authentifizierung
- **ANTHROPIC_API_KEY** – Claude API
- **GEMINI_API_KEY** – Google Gemini API
- **WC_KEY** / **WC_SECRET** – WooCommerce REST API
- **MC_API_KEY** – Mission Control Backend API-Key (Schutz aller /api/* Routes)
- **CORS_ORIGIN** – Erlaubte Frontend-Origins (kommagetrennt)

---

## Cloud Run Deployment

**Service:** mission-control-backend  
**Image:** europe-west1-docker.pkg.dev/mission-control-495711/mission-control/backend  
**Trigger:** GitHub Actions (push zu `main`, changes in `backend/**` oder `Dockerfile`)

Environment-Variablen:
- `NODE_ENV=production`
- `GOOGLE_PROJECT_ID=mission-control-495711`

Alle anderen Secrets werden automatisch via Secret Manager geladen.

---

## Lokale Entwicklung

1. Secrets in `.env` oder als Env-Variablen setzen
2. `backend/utils/secrets.js` lädt sie beim App-Start
3. Priority: Env-Var → `.env` → GCP Secret Manager (Production)

---

## Checkliste neue Secrets

- [ ] Secret in GCP Secret Manager anlegen
- [ ] `BUSINESS_SHEET_ID` zu `.env.example` hinzufügen
- [ ] Secret zu `SECRET_KEYS` in `backend/utils/secrets.js` hinzufügen
- [ ] Diese Notiz updaten mit Datum + Details
- [ ] Commit pushen
