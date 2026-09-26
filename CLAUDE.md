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
- SEO-Daten aendern (Zeile ~5300, Befehl SE1: Yoast-Felder jedes veroeffentlichten Artikels; nutzt seoMetaBau und yoastSchreiben des SEO-Flows, schreibt nichts ins Sheet)
- Kundenanfragen Extern (Zeile 4222)
- Settings (Zeile 3604)
- L-Shop-Stammdaten (im Settings-Block, Befehl LS1: Knoepfe Pruefen/Uebernehmen)
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
- backend/lib/partnerArtikel.js – einziger Anleger von Zeilen in Partner_Artikel / HK_Partner_Artikel
  (PA2): Knopf "Aus WC importieren" und `POST /api/partner/artikel/abgleich` (erster Schritt in
  sync-partner-daily.yml, VOR sync-all). Dubletten ueber Produkt-ID, nie eine vorhandene Zeile
  aendern, EK/Druck LEER statt 0 (leer = fehlt, 0 = bewusst), kein Lizenz-%, EK aus L-Shop nur
  bei LShop_ArticleNr je Variante (kleinster 10CartonsPrice ueber Groessen + angebotene Farben),
  Spalte `EK_Quelle` additiv am Ende. Nur aktive Lizenz-Partner + HonkShop, nie Festpreis.
  Chat: `buildArtikelAbgleichNachricht` in chatNotify.js, derselbe `notify()`. Antwortfeld `chat`
  (PA6): "gesendet" | "nichts zu melden" | "fehlgeschlagen" | "lebenszeichen gesendet"; ohne Befund
  montags (Europe/Berlin, `istMontagBerlin`, Uhr `uhr.jetzt` im Test setzbar) ein Lebenszeichen.
  Workflow warnt bei "fehlgeschlagen" (::warning::), bricht den Sync nicht ab.
  Sperre (PA2 Teil B, routes/partnerPortal.js): fehlt EK oder Druck (LEER, 0 ist erlaubt), schreibt
  der Sync die Verkaufszeile mit Status "gesperrt", Spalte "Sperre" (additiv am Ende) = Grund und
  LEEREN Betraegen. Erster Schritt jedes Sync-Laufs: `entsperren()` rechnet gesperrte Zeilen, deren
  Eintrag jetzt vollstaendig ist, genau einmal (WC-Bestellung neu gelesen, `verkaufsBetraege` in
  partner-kalkulation.js = dieselbe Rechnung wie der Sync), Zeile vorher ueber den Inhalt geprueft.
  Storno einer gesperrten Zeile = ebenfalls gesperrt. Abrechnung waehlt nur "offen" und meldet
  gesperrte Zeilen im Zeitraum + offene Nachzuegler vor dem Zeitraum (`abrechnungHinweise`,
  sync-logic.js), kein 409. Partnerportal zeigt gesperrt als "in Prüfung", ohne Betrag/Grund.
  `scripts/sync-one-order.js`: Trockenlauf Standard, `--write`, `--partner P-00x`.
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
  Reiter "Trikots" (Business-Sheet), Schreiben header-basiert: A–O Skript (Zeilen-ID …
  Rohtext), P–T manuell (Charge, Bestellt_Am, Geliefert_Am, Status, Notiz – Sync schreibt
  null), U Skript `Zahlart` (= `payment_method_title` unveraendert, sonst leer; Pflichtspalte).
  Neue Skriptspalten nur hinten anfuegen (`SCRIPT_COLUMNS_NACH_MANUELL`), nie zwischen O und P.
  Status `processing`, `on-hold` (Vorkasse), `completed`; ohne `after` Start 3 Tage vor dem
  juengsten Bestelldatum (`UEBERLAPPUNG_TAGE`). Bestandszeilen werden nie geaendert.
- backend/lib/seo-prompt.js – SEO-Prompt: Systemprompt (`SEO_SYSTEM_PROMPT`), User-Template,
  MODUS-Enum, Materialfilter. Serientitel nur als Fanart: steht im Hinweisblock woertlich
  "Fanart zur Serie <Titel>", kommt der Block FANART-SERIE dazu, sonst gilt das Titelverbot.
  Die Ausnahme steht NUR im Block, nie im Systemprompt (sonst "Fanart zur Serie." ohne Titel).
  Das Wort "offiziell" (auch verneint) nie in Prompt-Texte – es landet sonst im Text.
  Die Beschreibung beginnt mit <h2>; `pruefeH2` prueft das mit (ein gemeinsamer
  Wiederholungslauf), die Keyphrase wird im ersten <p> NACH der <h2> gemessen.
  Die Regeln stehen hier, das ist die Quelle. Begründungen und Historie liegen im
  Claude-Projekt unter METHODE/SEO_Beschreibungs_Framework.md (nicht im Repo).
- backend/lib/seo-meta.js – Yoast SEO-Titel und Meta-Beschreibung, deterministisch
  (kein Modell). Einzige Quelle; index.html spiegelt den Bau-Teil im Block
  `SEO-Meta: Anfang/Ende`. Faserangabe + Grammatur liefert
  `POST /api/seo/meta-eingaben` (backend/routes/seo-meta.js), weil
  filterMaterialFarben nur im Backend lebt. Faserangabe und Grammatur gehen OHNE
  Label hinein; Label = Teil vor dem ersten Doppelpunkt, Tab oder 2+ Leerzeichen (`labelUndWert()`
  in seo-prompt.js, L-Shop-Datenblaetter sind Tab-getrennt). Dieselbe Funktion nutzt
  der SEO-Prompt fuer Farb-, Groessen- und Materialzeilen; keine zweite Label-Logik.
  Faserangabe = die Material-Zeile, deren Wert mit Prozent beginnt (Reihenfolge egal);
  weitere Material-Zeilen stehen als "Material: …" in der Detailliste.

- backend/lib/lieferzeiten.js – German-Market-Lieferzeit (`_lieferzeit`, Term-ID als
  String). Quelle: SSOT-Reiter `Struktur_Lieferzeiten` (Term_ID | Name | Slug | Standard),
  genau eine Zeile mit "ja" in `Standard` = Vorbelegung bei der Anlage. Kein Fallback,
  keine IDs im Code. Neu angelegte Variationen bekommen `"-1"` (wie Elternartikel), in
  Anlage- und Aenderungspfad. Aenderungspfad schreibt `_lieferzeit` nur bei geaenderter
  Auswahl, nur am Elternartikel; bestehende Variationen nie. Frontend-Spiegel: Block `Lieferzeit: Anfang/Ende`.

- backend/utils/varianten-zeilen.js – Reiter `Varianten` (SSOT), nur ueber Spaltennamen, ganze
  Zeilen lesen. Speichern loescht die Zeilen einer SSOT-ID und haengt neue an; Spalten, die der
  Payload nicht kennt, kommen aus der alten Zeile mit gleichem Schluessel (Menge Achse=Wert,
  trim/klein/ß=ss, reihenfolgeunabhaengig; doppelter Schluessel -> Fehler, nichts geschrieben).
  `LShop_ArticleNr`: genau 10 Ziffern als String, Spalte Textformat (`sichereTextSpalte`), wird
  erst angelegt, wenn ein Payload sie mitbringt. Mehrere Varianten duerfen dieselbe Nummer tragen.
  `scripts/migrate-varianten.js` ist historisch index-basiert – nicht wiederverwenden.

- backend/lib/lshop.js – Reiter `SKU_LShop` lesen (nur lesen, header-basiert ueber die ganze
  Breite per batchGet, nicht readRange A1:Z1000; ArticleNr als String; 5 min Cache).
  `GET /api/sheets/lshop/:catalogNr?farben=…` liefert Farben ("color1/color2", englisch wie
  L-Shop), Groessen, ArticleNr je Variante, Faser, Grammatur, Hinweise. Faser/Grammatur laufen
  durch filterMaterialFarbenMitMeldung mit allen gewaehlten Farben; je Farbe ungleich -> kein
  Wert + Hinweis; Faser muss je Abschnitt auf 100 % aufgehen; Grammatur leer = kein Wert, kein
  Hinweis. Als `strukturiert: { faser, grammatur }` an `/api/seo/meta-eingaben` und
  `seo_description` hat sie Vorrang vor dem Eigenschaften-Freitext (`strukturierteEingabe()` in
  seo-prompt.js; Schluessel `grammatur` vorhanden = gilt, auch leer).
  Maske (M3, nur Anlagepfad): Feld "L-Shop Artikelnummer" laedt beim Verlassen das Modell;
  gefunden -> Farben NUR aus dem Modell (L-Shop-Schreibweise), Groessen aus den Zeilen der
  gewaehlten Farben (eine Groesse = keine Groessenachse), `lshopArticleNr` je Variante; 404 ->
  freie Eingabe (Fremdware), nie gemischt. Frontend-Spiegel: Block `L-Shop-Modell: Anfang/Ende`.
  SEO-Flow schickt `strukturiert` nur, wenn ALLE Farben Modellfarben sind (Bestand: Freitext).
  Discontinued (M8b): 0/leer normal; 3 und 6 = Variante nicht waehlbar (fehlt in Farben/Groessen/
  Varianten, steht in `gesperrt`, Hinweis fuer gewaehlte Farben); jeder andere Wert waehlbar, aber
  `auslauf` an der Variante + Liste `auslaufend` (Maske markiert "läuft aus (Wert n)", kein Hinweis).

- Anlage (M3): Versandklasse ist Pflicht (Frontend anlageZustand + Backend 400 `feld:
  shipping_class`); Aenderungspfad speichert ohne Klasse weiter, mit Hinweis (S2b). Jede NEU
  angelegte Variation bekommt `_wc_gla_color` = Farbwert 1:1 (`mitGoogleFarbe` in
  varianten-achsen.js), Bestand nie; Google_Farbe im Reiter Varianten gleich. Schritt 10 der
  Anlage (POST /erfassung/overwrite) schickt KEINE `varianten` (`erfassungNachAnlage`) - sonst
  leert er die in Schritt 9 geschriebenen WC_Variation_IDs.

- backend/lib/lshopStammdaten.js – L-Shop-Stammdaten-Update (LS1), einzige Quelle, kein Modell.
  Neueste `DE_Standard_DE_EUR_<TT.MM.JJJJ>.csv` (nach NAMENSdatum) aus der geteilten Ablage
  (Drive-API, supportsAllDrives) wird gestreamt, nie gespeichert; Parser: BOM, CRLF, Semikolon,
  Anfuehrungszeichen; Spalten nur ueber den exakten Namen (fehlt/doppelt -> 422, nichts
  geschrieben). Gebrauchte Modelle = `modellAus()` ueber Shop-SKUs JFN+HonkShop (status any),
  Partner_Artikel, Erfassungsmaske, Reiter `Modelle_Zusatz` (CatalogNr, von Hand, fehlt = leer)
  + CatalogNr der Varianten.LShop_ArticleNr (zweiter Durchlauf). Ziel Reiter `LShop_Modelle`
  (SSOT): 15 CSV-Spalten + Status/Quelle_Datei/Quelle_Datum/Stand, Schluessel ArticleNr; fehlt
  eine Nummer in der Datei -> Status "ausgelaufen", Zeile bleibt. ArticleNr/EAN/CatNrManufacturer
  als Text (Format + RAW-String; sonst 03581 -> 3581, EAN -> E+12), Preis als Zahl.
  `POST /api/lshop/stammdaten` (routes/lshop.js) `{ modus: "trockenlauf" | "uebernehmen", datei }`:
  Trockenlauf schreibt nie; Uebernehmen verweigert (409), wenn `datei` nicht mehr die neueste ist.
  Chat: `buildLShopStammdatenNachricht` (chatNotify.js). Log/Antwort: nur Zaehler und CatalogNr,
  nie Preise. Die Leser (lshop.js TAB_LSHOP, partnerArtikel.js) lesen noch SKU_LShop (Umstellung LS2).
- backend/lib/ssot-reiter.js – gemeinsamer Leser fuer SSOT-Reiter: Kopfzeile, dann nur die
  benoetigten Spalten per batchGet (ganze Hoehe/Breite, FORMATTED_VALUE), Pflicht- und optionale
  Spalten ueber den Namen. Nutzer: lshop.js, seo-ssot.js.
- backend/lib/seo-ssot.js – Generator-Eingaben (M4): Motive je Artikelkurzbezeichnung,
  SEO_Hinweis je Kategorienummer (Vorlage "Eigene Hinweise": Kategorie-Reihenfolge, leere und
  doppelte weg), SEO_Karte (Keyphrase gleich fremder Soll/Ist -> Warnung, Teilstring -> Info,
  nie blockieren). `Nur_intern` geht NIE in den Prompt und nie ans Frontend (`motivFuerPrompt`
  laesst es weg); nur in die Pruefung. Route: `GET /api/seo/generator-eingaben`.
- backend/lib/seo-karte.js – SEO_Karte-Zeile nach dem Yoast-Speichern (M9), einziger Schreiber der
  Karte. Frontend `yoastSchreiben` (SEO-Reiter + SE1) ruft nach dem Zuruecklesen `POST /api/seo/karte`
  { wcId }; Fehler dort = Toast, Yoast bleibt. Nur Typ "Artikel", Schluessel WC_ID, Werte aus dem
  neu gelesenen Shop-Stand. Neu: Ist_*, Soll = Ist (Synonyme ohne ["…"]), Typ/Status "Artikel"/
  "geschrieben", Pfad = WC-Namenskette der EINEN Blattkategorie (mehrere -> leer + Hinweis),
  Oberkategorie = erster Teil. Vorhanden: Ist_* + Stand; Soll nur wenn leer oder = altes Ist.
  Mehrfach -> 409, nichts. Schreibt nur geaenderte Zellen (RAW), liest zurueck.
  Frontend-Spiegel der Toasts: Block `SEO-Karte: Anfang/Ende`.
- backend/lib/seo-pruefung.js – deterministische Pruefung nach der Generierung
  (`pruefeGeneratorText`, Antwortfeld `pruefhinweise`, kein zweiter Modelllauf): Nur_intern,
  Marke/Modellnummern des Rohlings (SKU_LShop Brand, CatalogNr, CatNrManufacturer), feste Liste
  `VERBOTENE_BEGRIFFE` (nur im Code, nie im Prompt), Zeitangabe mit Zahl (Ziffer oder Zahlwort,
  auch Spanne; M4b) und jedes "Lieferzeit"/"Lieferung erfolgt"/"geliefert in", <h1>, Stick bei Druck.
  `pruefeTextMitSsot` = eine Stelle mit SSOT-Daten: nach der Generierung und nach dem Speichern im
  SEO-Reiter (`POST /api/seo/text-pruefung`, Shop-Stand zurueckgelesen, nur Warn-Toast).
  h2/Keyphrase/Groessen bleiben in seo-prompt.js (pruefeSeoText). Frontend-Spiegel der
  Anzeige-Logik: Block `Generator-Eingaben: Anfang/Ende`.

- backend/lib/vorschlaege.js – Maske "Neu anlegen" (M8), deterministisch: Kurzbezeichnung =
  haeufigstes Praefix der DIREKTEN Kategorie (M8b), sonst der Hauptkategorie, wenn es dort an ihr
  selbst oder in mind. 2 Unterkategorien steht (Erfassungsmaske, z. B. "CH-") + erstes kennzeichnendes
  Wort des Namens (ohne Kategorie-/Vereinswoerter; unter 6 Buchstaben + zweites Wort klein, z. B.
  "CH-Matchday"), CamelCase, sku.js-Regeln, eindeutig gegen
  Erfassungsmaske und Motive (sonst Ziffer). Versandklasse = Mehrheit der veroeffentlichten
  Artikel mit derselben L-Shop-Nummer, sonst "paket". Modell der SKU: "SKU vor '/'" ODER
  `modellAusSku` (Token bis / _ - Leerzeichen, KING/Queen davor weg, nur CatalogNr aus SKU_LShop).
  `GET /api/sheets/vorschlaege`.
  Vorschlaege setzen ein Feld nur, wenn es leer ist oder noch den letzten Vorschlag traegt.
- backend/lib/schlagwoerter.js – Schlagwoerter (product_tag) fuer den SEO-Generator (M8):
  vorhandene bevorzugt (Liste im Prompt), neue als "neu" (hoechstens 2 neue, zusammen 5),
  Pruefung je Wort (`sperrTreffer`).
  ⚠️ Ein `tags`-Array im WooCommerce-PUT ERSETZT alle Schlagwoerter: `tagsFuerPut` schickt immer
  die ganze Liste; der SEO-Reiter schickt `tags` nur, wenn die vorhandenen gelesen sind.
  Keyphrase/Synonym-Vorschlaege laufen gegen SEO_Karte inkl. Ist_Synonyme (`werteGegenKarte`),
  Kollision -> markiert, nicht uebernommen. Schlagwort-Archive stehen auf noindex, follow.

- backend/lib/groessen.js – Groessen-Rang und -Sortierung (XXS … 8XL, Kindergroessen
  numerisch, Unbekanntes ans Ende mit Hinweis). Einzige Stelle; seo-meta.js nutzt den Rang,
  woocommerce.js sortiert damit die Optionen der Achse "Größe" und die Variationen (Farbe,
  dann Groesse, menu_order). Frontend-Spiegel: Block `Groessen: Anfang/Ende`.

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
