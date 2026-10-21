# Claude Code – Arbeitshinweise Mission Control

## frontend/index.html (große Datei)
Vor jeder Änderung erst Struktur prüfen:
```bash
grep "SECTION" frontend/index.html
```

Aktuelle Sektionen (Reihenfolge in der Datei; Zeilennummern per `grep -n "SECTION"`,
im Code und hier bewusst ohne Nummern, weil sie bei jeder Aenderung veralten):
- Navigation (NAV4: Tabelle `BEREICHE` im Block `Navigation-Tabelle: Anfang/Ende`, Test
  navigation.test.js; `oeffneAnsicht(bereich, unterpunkt)` = einziger Weg, eine Ansicht zu oeffnen,
  auch `window.oeffneAnsicht`; Adresse `#bereich/unterpunkt`; Ereignis `mc:ansicht` fuer den
  zweiten Script-Block. Bereiche: dashboard · bestellen (Panel orders, Unterreiter) · artikel
  (Panel products, Modus-Knoepfe) · partner (lizenz = partnerportal, festpreis) · kunden (anfragen,
  agent-wissen) · system (settings). Neue Ansicht = Zeile in BEREICHE, nie `nav button.click()`.)
- Stand-Anzeige
- Helpers (darin: Dashboard inkl. Knopf "Trikot-Sync jetzt")
- Auftragsmonitor, Auftragsmonitor Dual-Source; darunter "Auftragsmonitor: Shop Orders" (kein SECTION-Anker)
- L-Shop-Warenkorb (BO2: Unterpunkt `bestellen/lshop-korb`, Anzeige + Knopf "Abgleich jetzt"; der alte
  Unterreiter "L-Shop Bestellungen" ist seitdem ausgeblendet, nicht entfernt)
- L-Shop-Bestellübersicht (BO3b: Unterpunkt `bestellen/lshop-uebersicht`, direkt hinter dem Korb. Nur eine
  Ansicht auf `korbZustand.daten` - kein eigener Abruf, kein Endpunkt; `korbZeichnen()` zeichnet beide.
  Block `Matrix: Anfang/Ende` (`baueMatrix`, Test bestellmatrix.test.js): nur Status offen, sperrender
  Hinweis (`vorschlag` false) zaehlt nicht ("+n gesperrt"), unbezahlt zaehlt mit (Punkt); Groessen ueber
  `grSortiere`, ohne Rang ans Ende; Modelle mit genau einer Zelle unter "Einzelne Artikel". Aktionen nur
  ueber die BO3-Wege, die eine Leiste `#korb-leiste` wandert ins sichtbare Panel (`korbLeisteParken`).
  Zaehlliste hell, ohne Bestellnummern, Haekchen nie gespeichert; Druck nur mit `body.druck-zaehlliste`.)
- Artikelerfassung
- SEO-Daten aendern (Befehl SE1: Yoast-Felder jedes veroeffentlichten Artikels; nutzt seoMetaBau und yoastSchreiben des SEO-Flows, schreibt nichts ins Sheet)
- SEO-Flow
- Kundenanfragen Extern
- Settings
- L-Shop-Stammdaten (im Settings-Block, Befehl LS1: Knoepfe Pruefen/Uebernehmen)
- Agent-Wissen
- Partnerportal (zweiter Script-Block)
- Partner-Artikel-Tab
- Interne-Bestellungen-Tab
- Fixkosten-Konfiguration sicherstellen
- Festpreis-Tab

Neue Sektionen immer mit Anker versehen:
```javascript
// ── SECTION: NAME ──
```

## Wichtige Dateien
- backend/lib/hosterPruefseite.js – Hoster-Pruefseite (ESTUGO, 01.10.2026): nach ~11 schnellen
  Abrufen JS-Pruefseite ("One moment, please...", openresty, **Status 200**), nach >100 nicht
  geloesten Pruefseiten IP-Sperre; jede Wiederholung zaehlt mit. HTML statt JSON (Content-Type
  ohne json oder Body beginnt mit "<") -> `HosterPruefseiteError` (503, Code `hoster_pruefseite`),
  sofort, ohne Wiederholung. Meldung: Shop, Pfad, Uhrzeit - nie Query, nie Schluessel.
  **Regel: Jeder neue WooCommerce- oder WordPress-Zugriff laeuft ueber `getWcClient`
  (lib/shopConfig.js, Pruefung haengt an jedem Request) oder die gemeinsame Pruefung
  `pruefeFetchAntwort` (WordPress-fetch).** Nie ein eigener `WooCommerceRestApi`, nie ein
  roher fetch auf `/wp-json` (Test `wc-zugriff-regel.test.js`). Seitenschleifen: `seitenGrenze`
  vor, `seitenListe` nach jedem Abruf (max. 200 Seiten, keine Liste = Pruefseite), Status
  nacheinander statt `Promise.all`. Jedes catch, das mit dem naechsten Element weitermacht,
  ruft zuerst `wirfWennPruefseite(err)`. Zwischenspeicher nur mit gueltiger Liste/Objekt.
  `middleware/hosterPruefseite.js` (vor dem allgemeinen Fehlerhandler): 503 + Code +
  `notifyHosterPruefseite` (gedrosselt 1/h); Workflows werden rot. Frontend:
  `istHosterPruefseite(res)` beendet Schleifen.
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
- backend/utils/festpreis-verpackung.js – Verpackungspauschale je Bestellung (VP1), Festpreis.
  Kondition NUR im Sheet: FP_Partner `Verpackung_je_Bestellung` (brutto, "nein" = keine, 0 = bewusst 0,
  leer = fehlt) + `Verpackung_ab` (TT.MM.JJJJ); nie im Code/Log/Postfach. Je Bestell-ID einmal (gemischt = 1),
  nur versendet (`local_pickup*`/`pickup_location` = Abholung), Bestelldatum >= ab, Storno = −1 (gleicher
  Zeitraum = 0). Abzug vom Brutto wie interne Bestellungen, in summary, POST /abrechnungen (Positionen-JSON
  `verpackung`) und Portal-Saldo ("in Prüfung" ohne Grund). Fehlt Wert oder Versandmethode: Abrechnung
  OHNE Pauschale, `verpackung.status` "fehlt" + Hinweis (Inhaber: keine Sperre). FP_Verkäufe Spalte W
  `Versandmethode` (method_id, additiv) schreibt der Sync; Bestand: `scripts/fill-fp-versandmethode.js`
  (Trockenlauf Standard, `--write` nur leere Zellen).
- backend/utils/shop-spalte.js – Spalte "Shop" (NAV3) in den SSOT-Reitern mit Bestellbezug:
  Produktions_Status (K), LShop_Bestellungen (I), DTF_Bestellungen (H), hinten angehaengt, nur ueber
  den Namen. Werte JFN/HONK aus `?shop=` (apiFetch haengt ihn immer an); leere Zelle = JFN; fehlt die
  Spalte, filtert nichts (wie vor NAV3). Schluessel = Shop + Bestellnummer (+ Position), weil JFN- und
  HONK-Bestellnummern Beitrags-IDs zweier WordPress-Installationen sind und gleich sein koennen.
  Neue Leser dieser Reiter lesen die ganze Breite (A1:Z), nie A1:J. Kein Shop-Feld: Partner_Interne_
  Bestellungen (Shop am Partner), Trikots (nur JFN), Partner_/HK_/FP_Verkaeufe (schon je Shop).
- backend/lib/lshopKorb.js – L-Shop-Warenkorb (BO2), Logik in `utils/korb-logic.js`. Reiter
  `Warenkorb_LShop` (SSOT) ist ein STEHENDER Bestand: jede L-Shop-bestellfaehige Shop-Position eine
  Zeile, Schluessel `JFN:<Bestellnummer>:<Position>`, Spalte Shop von Anfang an. Abgleich
  (`POST /api/bestellen/lshop-korb/abgleich` `{ dryRun, quelle }`, Knopf + Workflow
  `lshop-korb-abgleich.yml` von Hand, stuendlich Cloud Scheduler, CS1) liest nur JFN, Status processing + on-hold, haengt nur NEUE Schluessel
  an, aendert nie Status, loescht nie; schreibt nur `Hinweis` (noch nicht bezahlt / storniert /
  erstattet / abgeschlossen / Menge geaendert / nicht mehr im Shop / Position weg) fuer Zeilen mit
  Status offen oder bestellt. Bestellfaehig = Varianten-Zeile ueber WC_Variation_ID MIT Gegenprobe
  Produkt-ID (`varianteDerPosition`, Varianten/Maske haben kein Shop-Feld), gueltige ArticleNr in
  LShop_Modelle, nicht ausgelaufen/3/6; Trikot/Fremdware/einfach nur als Zaehler. **Kein
  `values.append`:** erste freie Zeile, Nachbarzeile + Zielbereich zuruecklesen, `values.update`,
  zuruecklesen; Hinweise per batchUpdate nach Pruefung von Schluessel + altem Hinweis.
  `GET /api/bestellen/lshop-korb?shop=` liest nur den Reiter, gebuendelt nach ArticleNr, ohne
  Kundennamen. Reiter anlegen: `scripts/setup-lshop-korb-reiter.js` (Trockenlauf Standard, `--write`).
  BO3 (bearbeiten in MC): `POST .../lshop-korb/status` `{ auswahl: [{schluessel, status}], ziel, grund, notiz }`
  nur offen <-> abgewählt (Grund aus `GRUENDE` Pflicht), alles oder nichts: Zeile frisch lesen,
  Schluessel + mitgeschickten Status pruefen (sonst 409), batchUpdate nur Status/Grund/Notiz/
  Status_Datum/Stand, zuruecklesen. Eigene Position `POST .../lshop-korb/eigen` `{ articleNr, menge,
  referenz, notiz }` NUR aus blanken L-Shop-Artikeln (Inhaber 21.10.): Suche `GET .../modelle?q=` in
  LShop_Modelle (10-stellige ArticleNr genau, sonst Teilwort in CatalogNr, Description, Brand,
  CatNrManufacturer), Farbe -> Groesse `.../modelle/:catalogNr/varianten` ueber `lshopAuswertung`
  (ohne ausgelaufen/3/6); SSOT-ID bleibt leer; fehlt das Modell -> `NICHT_IM_BESTAND`, keine freie
  Eingabe, Stammdatei nie direkt lesen. Schluessel `EIGEN:<Jahr>-NNNN` vergibt der SERVER
  (hoechste + 1 aus dem Reiter), Referenz Pflicht (nie Klarnamen). Der Abgleich fasst Herkunft
  `eigen` und Status ausser offen/bestellt nie an. Eine Sperre je Instanz fuer alle Schreiber -> 409
  "gleich noch einmal". Kein Loeschen; bestellt/geliefert setzt erst BO4.
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

- backend/lib/lshop.js – Reiter `LShop_Modelle` lesen (seit LS2; `SKU_LShop` ist Altbestand, wird nicht mehr gelesen; nur lesen, header-basiert ueber die ganze
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
  (SSOT): 15 CSV-Spalten + Status/Quelle_Datei/Quelle_Datum/Stand + (LS2, 21.10.) `Description` =
  L-Shop-Artikelname HINTEN (Spalte T; je Modell genau ein Wert, gemessen), nie in CSV_SPALTEN
  einfuegen (sonst rutschen Status..Stand); erstmals ergaenzter Name zaehlt als `nameErgaenzt`,
  ohne neuen Stand; die alte 19er-Kopfzeile wird einmal hinten ergaenzt. Schluessel ArticleNr; fehlt
  eine Nummer in der Datei -> Status "ausgelaufen", Zeile bleibt. ArticleNr/EAN/CatNrManufacturer
  als Text (RAW-String, Format TEXT erst NACH dem Schreiben setzen - values.update loescht
  es auf beschriebenen Zellen, Befund LS2; sonst 03581 -> 3581, EAN -> E+12), Preis als Zahl.
  `POST /api/lshop/stammdaten` (routes/lshop.js) `{ modus: "trockenlauf" | "uebernehmen", datei }`:
  Trockenlauf schreibt nie; Uebernehmen verweigert (409), wenn `datei` nicht mehr die neueste ist.
  Chat: `buildLShopStammdatenNachricht` (chatNotify.js). Log/Antwort: nur Zaehler und CatalogNr,
  nie Preise. Leser (seit LS2): lshop.js (TAB_LSHOP, dort auch STATUS_*), partnerArtikel.js. Status "ausgelaufen" = in
  lshopAuswertung wie Discontinued 3/6 (nicht waehlbar, `gesperrt` mit wert "ausgelaufen"); Marke,
  Modellnummern und EK lesen ausgelaufene Zeilen weiter. Nachtraege von Hand: Reiter `Modelle_Zusatz`.
- backend/lib/wc-variation-ids.js – WC_Variation_ID zurueckschreiben (VR2), eine Quelle; Frontend-Spiegel
  Block `WC-IDs: Anfang/Ende` (Test vergleicht beide). Zuordnung neue WC-Variation -> Varianten-Zeile NUR
  ueber die Attributkombination (VR1-Schluessel + ae/oe/ue), nie ueber die Position. Nur LEERE IDs fuellen;
  abweichende ID, 0 oder >1 Treffer -> nichts, Hinweis. Mehrere Shop-Variationen auf DERSELBEN Zeile
  (Dubletten im Shop) -> Zeile mehrdeutig, keine davon geschrieben (Zaehler mehrdeutigZeile/mehrdeutigShop).
  Sperre gegen doppelte Variationen (VR3): `PUT /products/:id` liest vor jedem create die Shop-Variationen
  (`leseAlleVariationen`, alle Seiten, NACH dem Produkt-PUT) und prueft mit `sperreDoppelte` (wcSchluessel);
  vorhandene Kombination -> nicht angelegt, Antwort `vorhanden` [{kombination, id, attributes}], die Maske
  uebernimmt die ID ueber wcIdsUebernehmen; Doppel im Request -> einmal (`doppelt_im_request`). Liste nicht
  lesbar -> nichts anlegen, 502 mit Grund (update laeuft). `variationen-ergaenzen` nutzt dieselbe Sperre.
  Backend liefert `variationen` (POST /products) bzw.
  `variationen_neu` (PUT /products/:id, aus der Batch-Antwort) mit id + attributes. Anlage- und
  Aenderungspfad nutzen denselben Helfer; geschrieben wird im normalen Varianten-Writeback.
  Bestand: `scripts/fill-wc-variation-ids.js` (Trockenlauf Standard, `--ssot`, `--csv`, `--write` schreibt
  nur leere Zellen WC_Variation_ID nach erneutem Lesen). Die alte Route `PUT /api/sheets/varianten/:ssotId/wc-ids`
  (Zuordnung ueber Varianten-Nr) ist entfernt.
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
  Marke/Modellnummern des Rohlings (LShop_Modelle Brand, CatalogNr, CatNrManufacturer - mit fuehrender Null, z. B. 03581), feste Liste
  `VERBOTENE_BEGRIFFE` (nur im Code, nie im Prompt), Zeitangabe mit Zahl (Ziffer oder Zahlwort,
  auch Spanne; M4b) und jedes "Lieferzeit"/"Lieferung erfolgt"/"geliefert in", <h1>, Stick bei Druck.
  `pruefeTextMitSsot` = eine Stelle mit SSOT-Daten: nach der Generierung und nach dem Speichern im
  SEO-Reiter (`POST /api/seo/text-pruefung`, Shop-Stand zurueckgelesen, nur Warn-Toast).
  h2/Keyphrase/Groessen bleiben in seo-prompt.js (pruefeSeoText). Frontend-Spiegel der
  Anzeige-Logik: Block `Generator-Eingaben: Anfang/Ende`.

- backend/lib/sku.js – Regeln fuer Kurzbezeichnung, Artikelnummer und Variations-SKU, einzige
  Stelle; Frontend-Spiegel: Block `SKU-Regeln: Anfang/Ende` (sku.test.js vergleicht beide).
  Gesperrte Kuerzel-Teile (KZ1): `GESPERRTE_TEILE` = KZ, SS, NZ, SA - ganze Bindestrich-Teile,
  Gross/Klein egal ("Santa", "Sapphire" erlaubt). Streng bei Anlage und geaenderter SKU;
  eine unveraenderte Bestands-SKU laesst `PUT /products/:id` mit Hinweis durch.
  Kati Zucker heisst seit KZ1 `KaZu-` (vorher `KZ-`).

- backend/lib/vorschlaege.js – Maske "Neu anlegen" (M8), deterministisch: Kurzbezeichnung =
  haeufigstes Praefix der DIREKTEN Kategorie (M8b), sonst der Hauptkategorie, wenn es dort an ihr
  selbst oder in mind. 2 Unterkategorien steht (Erfassungsmaske, z. B. "CH-"; Praefix = 2-4 Buchstaben
  mit mind. zwei Grossbuchstaben, z. B. "KaZu-", gesperrte Teile nie) + erstes kennzeichnendes
  Wort des Namens (ohne Kategorie-/Vereinswoerter; unter 6 Buchstaben + zweites Wort klein, z. B.
  "CH-Matchday"), CamelCase, sku.js-Regeln, eindeutig gegen
  Erfassungsmaske und Motive (sonst Ziffer). Versandklasse = Mehrheit der veroeffentlichten
  Artikel mit derselben L-Shop-Nummer, sonst "paket". Modell der SKU: "SKU vor '/'" ODER
  `modellAusSku` (Token bis / _ - Leerzeichen, KING/Queen davor weg, nur CatalogNr aus LShop_Modelle).
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
  numerisch, dahinter L-Shop-Kindergroessen „1/2 (XXS)“ … „12/13 (XL)“ nach erster Zahl,
  Unbekanntes ans Ende mit Hinweis). Einzige Stelle; seo-meta.js nutzt den Rang,
  woocommerce.js sortiert damit die Optionen der Achse "Größe" und die Variationen (Farbe,
  dann Groesse, menu_order). Frontend-Spiegel: Block `Groessen: Anfang/Ende`.

- backend/lib/anlageHalloween.js – Anlage Halloween 2026 (HW2) per Skript statt Maske
  (`scripts/anlage-halloween.js`, Trockenlauf Standard, `--write` erst nach Freigabe). Kategorie
  "Halloween" + 5 Entwuerfe `<Modell>/HW-Halloween`, Achsen Farbe + Groesse GLOBAL (mit `id`,
  ueber den Namen aus products/attributes) und Motiv LOKAL (ohne id). WC REST: `name` ohne `id`
  = lokales Attribut - die Maske sendet nie eine id. Variations-SKU mit Motiv-Kurzteil (volle
  Titel > 50 Zeichen). L-Shop "XXL" -> Shop-Term "2XL" ueber den Groessenrang. Takt 2 s,
  variations/batch <= 50, Pruefseite/Zeitlimit/502 -> `AnlageStopp`; erneuter Lauf findet
  Produkt (SKU) und Variationen (Kombination) und legt nur Fehlendes an. Sheets erst nach
  vollstaendiger Shop-Anlage (RAW). Preise nur aus `backend/scripts/.preise-halloween.json`
  (gitignored), nie in Ausgabe/CSV. HW3: 4 Artikel (JH180 entfaellt), Bilder ueber `--bilder <ordner>`
  (mockups/ + sammelbild-<Modell>.jpg), Zuordnung Datei -> Motiv ueber Schluesselwoerter (`ordneMockups`,
  sonst Stopp), Galerie Sammelbild + 8 Motive, Variationsbild ueber "Motiv"; Upload-Zustand in
  `backend/scripts/.halloween-medien.json` (gitignored, kein Doppel-Upload). `--pruefen` liest zurueck.
- backend/lib/wpMedien.js – Upload in die WordPress-Mediathek (`ladeMedienHoch`, `setzeMedienText`),
  eine Stelle fuer `POST /api/artikel/media-upload` und das Halloween-Skript (fetchMitZeitlimit +
  pruefeFetchAntwort; Titel/ALT als Abfrageparameter).

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

## Cloud Scheduler (CS1)
Job `lshop-korb-abgleich` (Region `europe-west1`), Zeitplan `17 * * * *`, Zeitzone
`Europe/Berlin`, POST auf `<BACKEND_URL>/api/intern/lshop-korb/abgleich`, Versuchsfrist 300 s,
1 Wiederholung nach 10 min. Anmeldung per **OIDC-Token** des Dienstkontos
`korb-scheduler@mission-control-495711.iam.gserviceaccount.com` (ohne Rollen; Cloud Run bleibt
oeffentlich, das Backend prueft das Token selbst): `middleware/schedulerAuth.js`
(`requireSchedulerOidc`, Sollwerte aus den Secrets `SCHEDULER_SA_EMAIL` und `SCHEDULER_AUDIENCE`,
401 ohne Details, Log nur Grund + Pfad). `routes/intern.js` steht VOR `requireApiKey`; ein
MC_API_KEY oeffnet `/api/intern` nicht. Body wird ignoriert (nie Trockenlauf), Lauf-ID `CS-<Zeit>`.
Sperre "laeuft schon" -> 200 `uebersprungen`, 5xx bleibt 5xx (Chat-Meldung), 503 Pruefseite bleibt.
Der Workflow `lshop-korb-abgleich.yml` hat kein `schedule` mehr, nur noch `workflow_dispatch`.
Scheitert der Job selbst (401, Zeitlimit), meldet ein Log-Alarm in Cloud Monitoring per Mail.

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

Aufruf (KI2): `backend/lib/modellAufruf.js` (`textAufruf({ modellId, system, prompt, art })`)
fuer `seo_description` (Art `seo`) und `suggest_variants` (Art `klassifizierung`). Anbieter NUR
ueber das Praefix der Modell-ID; Spalte C "Anbieter" ist Info, modelConfig warnt bei Abweichung.
Anthropic-Parameter je Art zentral in `ARTEN`: seo = Effort low + `max_tokens` 16000 (Denken an),
klassifizierung = `thinking: disabled` + 1024. Haiku/Sonnet 5.5 denken standardmaessig - ein
kleines `max_tokens` ohne Denken-Steuerung schneidet die Antwort ab (KI1: 4/6 ohne JSON).
`stop_reason` "max_tokens"/"refusal" -> 502 mit `code` `ki_abgeschnitten`/`ki_abgelehnt`.
Kunden-Chat (chatCore) und Health-Ping rufen noch selbst auf (nicht umgebaut). Der interne
Claude-Chat (POST/DELETE /api/claude/chat) und die Aktionen generate_description/generate_variants
sind seit NAV2 entfernt; generate-product kennt nur noch seo_description und suggest_variants.
Floskeln prueft `seo-pruefung.js` (Regel 7, `FLOSKELN`); neue Wendungen nur dort, nie im Prompt.

## Script-Scope Problem (gelöst)
index.html hat zwei Script-Blöcke:
- `<script type="module">` – Hauptcode (Navigation bis Agent-Wissen)
- `<script>` – ab SECTION Partnerportal

Helpers sind via window.* exponiert:
- window.apiFetch
- window.showToast
- window.API_BASE
- window.showConfirm

Löschen: Claude Code löscht nie endgültig (Variationen haben keinen Papierkorb). Eine Löschliste im
Bericht, die der Inhaber im Terminal mit „Freigabe Löschliste“ freigibt, setzt Claude Code auf
**privat** (unsichtbar, nicht kaufbar, umkehrbar) — vorher Sicherung, danach Nachmessung; Varianten-Zeilen
`Aktiv` FALSE. Das endgültige Löschen macht der Inhaber (auf Wunsch per vorbereitetem Skript,
Trockenlauf Standard, `--write`, das er selbst startet). Artikel, Kategorien, Terme, Sheet-Zeilen nie löschen.
