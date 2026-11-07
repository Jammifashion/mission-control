# Claude Code – Arbeitshinweise Mission Control

## Arbeitsweise
- Jeder Auftrag aus dem Postfach wird in einem eigenen Worktree unter `.claude/worktrees/<auftrag>` von
  `origin/main` gebaut, nie direkt auf `main` im Hauptordner.
- Nach `git pull` im Hauptordner: `cd backend && npm ci`.

## frontend/index.html (große Datei)
**Dauerregel Mouse-over (Inhaber 02.11.2026):** Jedes neue Bedienelement (Knopf, Kennzeichen, Feld, Filter) bekommt einen
Mouse-over: Text im Block `Knopf-Hilfe` (`KNOPF_HILFE` + Gruppe in `HILFE_GRUPPEN`, am Handy ⓘ), am Element `data-hilfe`,
nie `title`. `backend/tests/knopf-mouseover.test.js` prueft jeden `<button>`; Knoepfe von vor der Regel stehen in
`backend/tests/hilfen/knopf-ohne-hilfe-bestand.json` (Nachruesten = eigener Auftrag, dann Zeile dort streichen).

**Dauerregel Farben (FK1, Inhaber 06.11.2026):** Jeder Farbwert steht NUR in `frontend/farben.css` (FK4), sonst nur `var(--…)` (auch Inline,
JS, SVG ueber `style="stroke:var(--x)"`); Toenungen per `color-mix(in srgb, var(--x) n%, transparent)`, keine Ersatzwerte
`var(--x, #…)`. Eine Farbe = eine Rolle: `--accent` nur Hauptaktion + aktiver Reiter (Fokus/Haken/Hover-Rand = `--focus`),
`--info` Links/Filter/aktuell/heute, `--warning` Hinweis/bald/laeuft aus/Wartestellung/Goalie, `--danger` nur Fehler/
ueberfaellig/Storno, `--success` erledigt/geliefert, `--au`/`--ag` Kennzeichen (`kzHtml`), `--shop-jfn`/`--shop-honk`,
`--nav-kachel*`/`--nav2-*` nur Handy-Navigation, `--status-design`; Auftragsstatus-Chip `auStatusKlasse`. Zierfarbe (Titel,
Nummern) = `--text`. Test `backend/tests/farbrollen.test.js` (einzige Ausnahme: `<meta name="theme-color">`).
**Heller Modus (FK2):** zweiter Block `:root[data-theme="light"]` in farben.css (nur Variablen, die es dunkel auch gibt;
`--focus` hell = `--info`). Wahl System|Hell|Dunkel je Geraet (`localStorage` `mc_theme`, fehlt = System), Block `Theme: Anfang/Ende` im
`<head>` VOR `<style>` (kein Aufblitzen) setzt `data-theme` (aufgeloest) + `data-theme-wahl`, `theme-color` = aktuelles `--bg`;
`window.mcTheme.setze()`, Auswahl `#theme-wahl` oben in den Einstellungen. Neue Farbe = Wert in BEIDEN Bloecken, Kontrast AA wird im
Test gemessen. Aktionsknoepfe nie `--success` (Hauptaktion = `--accent`/`--accent-text`). Test `theme.test.js`.
**farben.css (FK4):** einzige Farbdatei fuer `index.html`, `partner.html`, `partner-festpreis.html`: `<link rel="stylesheet" href="farben.css">`
im `<head>` NACH dem Theme-Skript, VOR `<style>`; steht im Service-Worker-`PRECACHE` (MC offline). Seiten haben keine eigenen
Farbbloecke (Test farbrollen.test.js). **Partnerportale (FK3/FK4):** Umschalter oben im Kopf (Auto/☀/☾, `#theme-schalter`, Hinweis per
`data-tipp`), Wahl in `localStorage` `partner_theme` (beide Portale, getrennt von `mc_theme`), Theme-Block wortgleich in beiden
Portalen (Test partner-farben.test.js, inkl. Syntaxpruefung aller Skripte). `anfrage.html` (Kunden-Widget) und die Offline-Seite in
`sw.js` sind bewusst nicht angeschlossen.
**Partnerportal-Listen (PP3):** Block `Portal-Listen: Anfang/Ende` + CSS `Portal-Listen CSS` wortgleich in beiden Portalen (Test
partner-listen.test.js): Listen zeigen standardmaessig nur Offenes (Status nicht "abgerechnet"), Schalter "auch abgerechnete anzeigen"
(`localStorage` `partner_abgerechnet_zeigen`, Standard aus); Summen/Saldo ungefiltert. `plTabelleHtml` mit Rollen datum|betrag|haupt|
status|neben -> am Handy (<= 480 px) Karten per CSS. Abrechnungen in `<details id="pv-abr-box">`, am Handy zu. Festpreis: Offene
Auszahlung oben.
**AM-2-1 (Inhaber 03.11.):** Hilfetexte an Eingabefeldern erscheinen nicht, solange das Feld (oder ein Feld im Element, z. B.
Label) Fokus hat, und verschwinden beim Tippen (`feldMitFokus` in `hilfeEinrichten`). Kein `title` an Knoepfen, auch nicht im
Code - wechselnde Zusaetze (Orte, Shop) ueber `data-hilfe-zusatz` (Test trefferliste.test.js). Trefferlisten (Kundenwahl im
Auftrag, Lexoffice-Treffer) ueber den Baustein `twBinden` (Block `Trefferliste: Anfang/Ende`): eine Zeile je Treffer, ↑/↓/Enter/Esc,
Aktionszeilen am Ende, kein Mouse-over in der Liste.

Vor jeder Änderung erst Struktur prüfen:
```bash
grep "SECTION" frontend/index.html
```

Aktuelle Sektionen (Reihenfolge in der Datei; Zeilennummern per `grep -n "SECTION"`,
im Code und hier bewusst ohne Nummern, weil sie bei jeder Aenderung veralten):
- Navigation (NAV4: Tabelle `BEREICHE` im Block `Navigation-Tabelle: Anfang/Ende`, Test
  navigation.test.js; `oeffneAnsicht(bereich, unterpunkt)` = einziger Weg, eine Ansicht zu oeffnen,
  auch `window.oeffneAnsicht`; Adresse `#bereich/unterpunkt`; Ereignis `mc:ansicht` fuer den
  zweiten Script-Block. Bereiche: dashboard · auftraege (liste, kunden; ein Panel `auftraege`, AM-1/AM-2; seit AM-1-1 direkt
  hinter Dashboard) · bestellen (Panel orders, Unterreiter) · artikel
  (Panel products, Modus-Knoepfe) · partner (lizenz = partnerportal, festpreis) · kunden (anfragen,
  agent-wissen) · lager (bestand, buchungen, abgaenge; ein Panel `lager`, BO5-1/BO5-5) · system (settings). Neue Ansicht = Zeile in BEREICHE, nie `nav button.click()`.
  Alte Adresse = Zeile mit `umleitung: '<unterpunkt>'` ohne panel/knopf (BO4d: `bestellen/lshop`).
  NAV5: bis 600 px ist die 2. Ebene (`#bereich-leiste`, `.sub-tabs` in den Panels, `.mode-toggle` in Artikel) ein Kachelraster in
  Violett (`--nav2-*`, aktiv gefuellt), Namen brechen um; Shop-Zusatz "(JFN)" steht in `.sub-shop` und ist am Handy aus. Desktop unveraendert.)
  Am Handy (<= 600 px) ist die Hauptleiste ein Raster aus Kacheln 4 × 2 in Blau (Inhaber 03.11., Variablen `--nav-kachel*`);
  darueber bis 720 px Kurznamen in einer Zeile, am Desktop Langnamen.
- Stand-Anzeige
- Helpers (darin: Dashboard DB1, Block `Dashboard-Anzeige: Anfang/Ende` (Test dashboard-frontend.test.js): EINE Route
  `GET /api/dashboard?wer=&shop=` (folgt dem Shop-Kennzeichen, Inhaber 06.11.: nur dieser Shop wird gelesen und gezaehlt, Auftraege
  immer; Rueckstand/Trikots bei HONK "nur JFN"; lib/dashboard.js, Logik utils/dashboard.js, Test dashboard.test.js) - oben "Zu tun" (7 Kacheln, immer
  sichtbar, 0 grau, fehlende Quelle = "–"), "Neu 24 h", "Am längsten wartend", "Eigene Aufträge", "Geld". Wartet lange = > 7
  Kalendertage Berlin (rot > 14), Shop + Aufträge vor "fertig", OHNE jede JFN-Bestellung mit Trikot-Position (Trikot_Artikel wie
  der Sync + Order-ID im Reiter Trikots). Kundenhinweis "gelesen" fuer alle: Reiter `Hinweis_Gelesen` (nur Shop, Nr, Pruefsumme,
  Kuerzel, Zeit; `scripts/setup-hinweis-gelesen.js`), geaenderte Notiz = neue Pruefsumme = wieder ungelesen. Alle/Christian/Nicole je
  Geraet (`mc_dash_wer`). DB2 "Vorlesen" (`#dash-vorlesen`, Block `Dashboard-Vorlesen: Anfang/Ende`, Test dashboard-vorlesen.test.js):
  Text aus festen Regeln NUR aus den Zahlen der Antwort (nie Namen/Bestell-/AU-Nummern/Hinweistexte), nur was > 0, Geld vor 18 Uhr
  gestern, ab 18 Uhr heute; `speechSynthesis` mit lokaler deutscher Stimme (`localService`, nie Online-Stimmen), Abschnitte <= 180
  Zeichen NACHEINANDER (DB2-1: Android-Chrome bricht eingereihte Aeusserungen ab; cancel() nur wenn etwas laeuft; Fehler = Toast mit
  Code), "Jammifashion Shop", "n Auftraege warten"; Stopp bei Klick, `mc:ansicht`, Alle/Christian/Nicole, pagehide; ohne Sprachausgabe verborgen. Abholung im Backend = `versandArt` (Spiegel von `psVersandArt`, Test vergleicht). Der Knopf "Trikot-Sync
  jetzt" steht seit DB1 auf der Trikot-Seite.)
- Auftragsmonitor, Auftragsmonitor Dual-Source; darunter "Auftragsmonitor: Shop Orders" (kein SECTION-Anker) mit der
  Bestellansicht "Bestellungen (JFN)" (PS1, Block `Produktion-Stand: Anfang/Ende`, Test produktion-stand.test.js)
  BS2: Versandart je Karte `psVersandArt(o, shop)` aus `shipping_lines` (method_id + instance_id, Titel nur Rueckfall; Abholung =
  local_pickup*/pickup_location, JFN 6 Stadion · 3 Wrist · 5 Sammelbestellung, flat_rate/4 = AT; unbekannt = Titel), Abholung gold
  hervorgehoben. Filter Status (`#ps-status`, "ausstehend" nur bei Bedarf) + Versandart (`#ps-versand`) mit Zaehlern (`psFacetten`),
  kombiniert mit "wartet auf Teile", BS1-Suche und Shop; Wahl in localStorage `mc_bestellungen_status`/`_versand` (Test
  bestellungen-versand.test.js).
- L-Shop-Warenkorb (BO2: Unterpunkt `bestellen/lshop-korb`, Anzeige + Knopf "Abgleich jetzt"; der alte
  Unterreiter "L-Shop Bestellungen" ist seitdem ausgeblendet, nicht entfernt. BO4a am Ende der Sektion:
  "EDI-Entwurf" - Knopf "EDI-Datei erzeugen (Entwurf)" in der Leiste, "alle offenen wählen" (ohne
  gesperrte), Dialog `#edi-dialog` im Panel orders; Block `EDI-Pruefung: Anfang/Ende` (Test
  edi-frontend.test.js): Knopf nur frei bei gruen + Browser-`DOMParser` ok, vor dem Download erneut;
  nach dem Erzeugen gesperrt, bis neu geprueft wird. Nur Download, kein Versand.
  UX1: Bedienleiste `.korb-bedienung` = links Ansicht (Segment-Filter), rechts Aktionen (`.korb-aktion`
  haupt/ruhig), ebenso in der Bestelluebersicht. Erklaerungen NUR im Block `Knopf-Hilfe: Anfang/Ende`
  (`KNOPF_HILFE`, `HILFE_GRUPPEN`, Test knopf-hilfe.test.js): `data-hilfe="<schluessel>"` = Tooltip bei Maus
  und Tastatur-Fokus, kein `title`; ⓘ (`data-hilfe-gruppe`) blendet die Liste ein (Handy). Neuer Knopf =
  Text + Schluessel dort. HT1 (03.11.): JEDER Knopf hat jetzt einen Mouse-over, `knopf-ohne-hilfe-bestand.json` ist leer (Test ohne
  Ausnahmen). Wiederkehrende Knoepfe teilen EINEN Text: `dialog-abbrechen`, `dialog-schliessen`, `dialog-bestaetigen`, `dialog-speichern`,
  `liste-bearbeiten`, `zeile-speichern`, `link-kopieren`, `token-neu`, `nav-bereich`, `nav-unterreiter`, `tab-offen/-protokoll`,
  `editor-*` (Test knopf-mouseover.test.js) - neue Dialoge nutzen sie, keine Kopien. Gruppen ohne ⓘ stehen in `GRUPPEN_OHNE_I`
  (knopf-hilfe.test.js). HT2: jede Gruppe hat ein ⓘ (`GRUPPEN_OHNE_I` leer); jedes Fenster (`HILFE_FENSTER`: .edi-dialog,
  .modal-backdrop, Anfragen-Fenster, Shop-Wahl) hat eins im Kopf - im Code erzeugte Fenster bekommen es beim Oeffnen (`fensterI`,
  MutationObserver). Ein ⓘ im Fenster listet die Knoepfe genau dieses Fensters. Der Tooltip haengt im offenen Fenster (z-index
  10050 ueber allem); Fenster mit transform (Anfragen-Seitenleiste) werden verrechnet. Nie ein ⓘ in die Editor-Leiste
  (`.rich-toolbar` - deren mousedown fuehrt execCommand aus). Der Erkenner prueft jedes `<button>`-Tag, egal wie lang der Inhalt.)
- L-Shop-Bestellübersicht (BO3b: Unterpunkt `bestellen/lshop-uebersicht`, direkt hinter dem Korb. Nur eine
  Ansicht auf `korbZustand.daten` - kein eigener Abruf, kein Endpunkt; `korbZeichnen()` zeichnet beide.
  Block `Matrix: Anfang/Ende` (`baueMatrix`, Test bestellmatrix.test.js): nur Status offen, sperrender
  Hinweis (`vorschlag` false) zaehlt nicht ("+n gesperrt"), unbezahlt zaehlt mit (Punkt); Groessen ueber
  `grSortiere`, ohne Rang ans Ende; Modelle mit genau einer Zelle unter "Einzelne Artikel". Aktionen nur
  ueber die BO3-Wege, die eine Leiste `#korb-leiste` wandert ins sichtbare Panel (`korbLeisteParken`).
  Zaehlliste hell, ohne Bestellnummern, Haekchen nie gespeichert; Druck nur mit `body.druck-zaehlliste`.
  BO3c "Gruppieren nach" Modell · Hersteller · Dringlichkeit (keine Druckart - es gibt keine Quelle):
  Block `Gruppen: Anfang/Ende` (`gruppiere`, Test bestellgruppen.test.js) baut je Gruppe `baueMatrix` nur
  aus deren Positionen (eine Matrix in mehreren Gruppen moeglich), Gesamtsumme oben aus einem baueMatrix
  ueber alles. Hersteller = `marke` (LShop_Modelle.Brand, wie L-Shop schreibt). Dringlichkeit: Stufen
  > 30 · > 7 (8-30) · 3-7 · < 3 Kalendertage Europe/Berlin, dann "ohne Datum"; "wartet seit" = aelteste
  Position. Wahl in `localStorage` `mc_uebersicht_gruppe` (nicht in der Adresse), Aufklappen nie gespeichert.
  Das Bestelldatum laedt `loadLShopKorb` nur, wenn die Uebersicht nach Dringlichkeit sichtbar ist.)
- L-Shop-Bestellungen (BO4d: Unterpunkt `bestellen/lshop-bestellungen`, direkt hinter der Uebersicht, Panel
  `tab-lshop-bestellungen`. Laedt `GET /api/bestellen/lshop-bestellungen` nur beim Oeffnen. Block
  `L-Shop-Bestellungen: Anfang/Ende` (Test lshop-bestellungen.test.js): je Bestellung `<details>`-Karte
  (Kopf, Status-Etikett, Positionen, Lieferscheine mit "Paket 1…n" nur auf textilelogistics.eu), Filter
  Unterwegs · Geliefert (14 Tage) · Alle (`data-bfilter`, `localStorage` `mc_lb_filter`), eingeklappte
  "Portalbestellungen" (30 Tage, "ältere anzeigen" nie gespeichert). Hilfe-Gruppe `bestellungen`.
  Die alte Adresse `#bestellen/lshop` (ausgeblendeter Vorgaenger des Warenkorbs, schreibt ueber
  `/api/auftragsmonitor/lshop/*` in `LShop_Bestellungen`/`Produktions_Status`) leitet per `umleitung` in
  BEREICHE hierher; Panel und Endpunkte stehen noch, Ausbau in eigenem Auftrag. Filter "Bestellt" und
  Block "Unterwegs von L-Shop" aus BO4b-2 sind entfernt.)
- Trikots (TR2: Unterpunkt `bestellen/trikots`, Unterreiter "Trikots (JFN)" hinter L-Shop-Bestellungen, `shop: false`;
  Block `Trikots: Anfang/Ende` (Test trikot-ansicht-frontend.test.js), `TR_HINWEISE` = Spiegel von `HINWEISE` in
  utils/trikot-ansicht.js; Hilfe-Gruppe `trikots`. Nur lesen. Klick auf die Bestellnummer: `psSpringeZu` + Bestellansicht,
  Karte nur markiert (`tr-markiert`), nie aufgeklappt - das Aufklappen legt Produktions-Zeilen an.
  TR3 am Ende der Sektion: Knopf "Produzenten-Bestellung …", Dialog `#tr-dialog`, Block `Trikot-Formular: Anfang/Ende`
  (Test trikot-formular-frontend.test.js): Vorwahl = offene Zeilen ohne Hinweis; "Als bestellt eintragen …" erst nach
  dem Download GENAU dieser Auswahl (`trFormularGrund`), sonst Toast mit Grund (Hilfe `tr-erst-download`).
  TR4 Wareneingang: Haken "da" je Zeile (`abhaken` aus der Ansicht) und "alle offenen dieser Bestellung als da" in
  `trZeileHtml`/`trGruppeHtml`; Schreibteil "Trikot-Wareneingang (TR4)" am Ende der Sektion (Bestaetigung beim Rueckweg
  und beim Sammelknopf, `trWe.laeuft`). Tippflaeche Haken >= 44 px.
  TR5: Gruppenkopf "bestellt TT.MM.JJJJ · seit X Wochen" (`trSeit`), KEIN errechnetes Lieferdatum (Inhaber: 4-6 Wochen je
  Auslastung). Kennzeichen auf der Karte in "Bestellungen (JFN)": `trKarteText`/`trKarteHtml` aus `bestellungen` der
  Trikot-Antwort (nur JFN, Laden still neben dem Stand, `psZustand.trikots`); Klick = `trSpringeZu` + Trikot-Ansicht,
  Zeilen der Order-ID markiert, Karte nie aufgeklappt.
  TR7 Goalie (Torwart-Version, nur auf Nachfrage, nie im Shop/Sync): optionale Spalte `Goalie` ganz hinten ("ja"/leer,
  `SPALTE_GOALIE`/`goalieWert` in utils/trikot-logic.js, `scripts/setup-trikot-goalie.js`; fehlt sie, Goalie setzen = 409
  `einrichtung`). "ändern …" an JEDER Zeile ohne Charge, nicht storniert (`aenderbar`; Shop: Groesse/Name/Nummer/Notiz-Spalte/
  Goalie, Trikot fest; INT wie TR6 + Goalie), `POST /api/bestellen/trikots/aendern` { id, zeile, trikot, vorher } - `vorher` =
  gesehener Stand, je Zelle geprueft (409 `geaendert`, nichts geschrieben); mit Charge gesperrt (Hilfe `tr-aendern-gesperrt`,
  Ersatz = TR3b). "entfernen" bleibt nur INT. Dialog `#ti-dialog` mit GK-Schalter je Trikot. Kennzeichen `trGkHtml` (Zeile),
  Karte " · GK". Formular: SIZE = "GK" + Groesse, EXTRA = "GOALI" (`GOALIE_FORMULAR`), Goalie ans Ende des Produkts.
  TR8 Goalie-Hinweis (nur lesen, nie automatisch "ja"): `utils/goalie-hinweis.js` sucht torwart/goalie/goali/keeper (auch
  Wortteil), gk/goal nur als eigenes Wort, NUR in Rohtext-Feldern (ohne `AUSSCHLUSS`: _-Meta, ppcp_*, captcha, Zahlung/Tracking,
  MC-Vorgang) und Spalte Notiz. `Goalie` = "ja" | "nein" (quittiert, `goalieStatus`) | leer. Offen (`goalieOffen`) = Hinweis +
  leer + ohne Charge + Spalte da -> gelb "GK? prüfen" (`trGkPruefenHtml`, Fundstelle+Stichwort in `data-hilfe-zusatz`, nie der
  Text), Knoepfe "als Goalie markieren" / "kein Goalie" = `POST .../trikots/goalie` { id, zeile, wert, vorher } (TR7-Weg, nur
  Zelle Goalie). Zaehler in `trSummeText`. Formular: nicht vorgewaehlt, Download/Eintragen gesperrt (409 `goalie_offen`).
  TR6: Knopf "+ Interne Trikotbestellung" (Dialog `#ti-dialog`, je Trikot eine Zeile, "+ weiteres Trikot", Referenz AU-… per Trefferliste
  oder Freitext) -> `lib/trikotIntern.js` / `utils/trikot-intern.js`: MC vergibt INT-JJJJ-NNNN (hoechste des Jahres + 1, auch gegen
  Handzeilen), Zeilen wie TK1 (Quelle intern, Bestelldatum Text, Stueck 1, P-T und Zahlart leer), Referenz/Notiz/`MC-Vorgang:` im Rohtext
  (Doppelklick; die Ansicht blendet den Vorgang aus). "ändern …"/"entfernen" nur bei INT + intern + ohne Charge; entfernen = Status
  `storniert` (Zeile bleibt) -> eigene, eingeklappte Gruppe "entfernt", nie im Formular (TR3 lehnt ab) oder in Zaehlern. Auftragsansicht:
  `#au-d-trikots` "n Trikots (Trikot-Seite)" ueber `referenz` (nur lesen). UI-Code am Ende der Trikot-Sektion (nicht im Lese-Teil).)
- Lager (BO5-1: Bereich `lager`, Unterpunkte `lager/bestand` und `lager/buchungen` im Panel `#panel-lager`, geladen ueber
  `mc:ansicht`; Block `Lager-Anzeige: Anfang/Ende` (Test lager-frontend.test.js, braucht grSortiere/grRang); Dialog
  `#lager-dialog` Einbuchen (Haken "Zählung / Startbestand" = Aktion start) · Ausbuchen · Umlagern · Korrektur (gezaehlt);
  Raster je Warenart, "da: n" am gewaehlten Ort; Vorgangs-Kennung `lagerDlg.vorgang` erst nach Erfolg neu. Hilfe-Gruppe `lager`.
  BO5-3 im Warenkorb: Block `Korb-Lager: Anfang/Ende` (Test lager-korb.test.js) - "im Lager: n" (Orte im title) bzw. "n von m",
  Knopf "aus Lager nehmen …" nur bei genug, Dialog `#korb-lager-dialog` (Vorbelegung meister Ort, hoechstens zwei), Filter
  "Aus Lager" mit "zurück in den Korb", Hinweis `#korb-grund-lager` beim Grund "Ware da / Lager"; Verlauf verlinkt Korb-Position
  (`korbSpringeZu`) und Bestellung (`psSpringeZu`); `lagerSpringeZu(articleNr)` filtert den Bestand.
  BO5-5: Ausbuchen = Bezug je Art (`#lager-bezug`: Event-Auswahl + "+ neues Event", Auftrag-Freitext, Partner P-… oder
  "Muster: …") und Liste "auszubuchen" (`lagerDlg.liste`, "Zur Liste und weitere Farbe" / "Alles ausbuchen", je Zeile ein
  Ort); bei Verkauf vor Ort bleibt der Dialog mit dem Event offen (Event-Modus). Unterpunkt `lager/abgaenge` (Auswertung im
  Zaehlliste-Stil, Druck ueber `body.druck-zaehlliste`). Wrist (`LAGER_HAUPTORT`) ist ueberall vorgewaehlt, auch im Korb-Dialog.
  BO5-6: Einbuchen Art "Retoure vom Kunden" = Shop-Wahl + Bestellnummer + "Positionen laden" im `#lager-bezug` (`lagerDlg.retoure`,
  Zeilen je Position mit Lager-Artikel, "bestellt n · schon m zurückgebucht", Rest vorbelegt), Hinweis Defekt = Ausschuss. Verlauf:
  Retoure verlinkt "Retoure zu JFN #… · Pos. …" (`lagerRetoureBezugHtml` -> `psSpringeZu`), HONK nur Text. Korb "Aus Lager": Position
  mit Hinweis gelb `.korb-storno` + Knopf "zurück ins Lager" (`data-lager-storno`, `korbStornoZurueck`) statt "zurück in den Korb".)
- Aufträge (AM-1: Bereich `auftraege`, Unterpunkt `auftraege/kunden` = Kundenliste, `auftraege/liste` = Platzhalter bis AM-2;
  Panel `#panel-auftraege`, geladen ueber `mc:ansicht`. Block `Kunden-Liste: Anfang/Ende` (Test kunden-frontend.test.js,
  `kuSuche` = Spiegel von `sucheKunden` in utils/kunden.js). Suche/Filter nur im Browser, Suchbegriff nie gespeichert (kein
  Browser-Speicher, keine Adresse, nie an den Server). Dialog `#ku-dialog`: Quelle lexoffice = nur Spitzname/Ansprechpartner/Notiz aenderbar;
  Archivieren mit Bestaetigung; DSGVO = `showConfirm` + Kunden-Nr. eintippen (`#ku-dsgvo-schritt`). Toasts nur Kunden-Nr.
  Hilfe-Gruppe `auftraege`.
  AMQ1: Dashboard-Kachel -> `auftraege/liste` (offen), Teilzahlen mit Filter (`AU_KACHEL_ZIEL`). Positionen erst ab "bestellt"
  Pflicht (`POSITIONEN_PFLICHT_AB`, 422 `ohne_positionen`), davor Hinweis `#au-pos-leer`. Dialog: Kopf -> Positionen -> unten
  `#au-preis-block`. `Preis_Eingabe` (brutto | leer = netto) + `Design_Link` (nur https) hinten in Auftraege. Brutto-Eingabe:
  Netto bis 4 Nachkommastellen (`nettoAusBrutto`/`apNettoAusBrutto`), Cent mit Bruchteil, gerundet erst je Steuersatz
  (MwSt = round(brutto) - round(netto)) - ein brutto getippter Preis kommt genau wieder heraus. Entwurf haelt unberuehrte Preise
  als Zahl (`auNettoRoh`). AMQ2: neuer Auftrag - Kundenart Person -> "Preise eingeben" brutto (`auEingabeVorbelegen`),
  sonst netto; nicht mehr nach Handumschaltung (`auDlg.eingabeHand`), nie beim Bearbeiten. Angefangene freie Position/Raster wird beim Speichern uebernommen (`auOffeneEingaben`), Enter uebernimmt.
  API-Schluessel in eigenem `<form id="api-key-form">`, Feld nie vorbelegt (sonst "Passwort speichern?" bei jeder Eingabe).
  AM-1-1: Knopf "In Lexoffice suchen …" = Baustein `kuKundeSuchen({ q, beiAuswahl })` (auch `window.kuKundeSuchen`; AM-2 nutzt
  ihn im Dialog "Auftrag anlegen": lokal -> Lexoffice -> "+ Neuer Kunde in MC"). Dialog `#kl-dialog`, Block `Lexoffice-Treffer:
  Anfang/Ende` (Test kunden-einzeln.test.js); Suche per POST, Treffer nur im Dialog. Unterpunkte: Aufträge vor Kunden (Inhaber). Dashboard-Kachel `#dash-auftraege` (Block
  `Auftraege-Kachel: Anfang/Ende`, `GET /api/kunden/zahlen`, nur Zahlen); AM-2 haengt `auftraege` { offen, terminBald,
  wartetAufWare, fertigNichtBezahlt } an dieselbe Antwort, `auKachelHtml` zeigt sie dann. Shop-Zahlen in `#dash-stats-row`
  (= `.dash-stats-shop`, display: contents) zeichnet loadDashboard neu, die Kachel steht daneben.
  AM-2 (SECTION "Aufträge – Liste, Ansicht, Erfassen"): Liste `#au-ansicht` (Filter offen/Termin <= 7 Tage/Status/alle, Suche
  Nr./Titel/Kunde/Spitzname; Kundennamen nur hier aus `kuZ.kunden`), Ansicht `#au-detail` (Status-Leiste, weiter/zurueck/bezahlt/
  stornieren, Haken fertig je Position, Vorschlag "auf fertig setzen"), Dialog `#au-dialog` (Kunde lokal -> `kuKundeSuchen` ->
  neu mit Rueckruf `nachSpeichern`; Raster BO6 ueber die LESENDEN Endpunkte `.../lshop-korb/modelle`, nie Korb-Schreiben; freie
  Position; Motiv/Druck/Notiz je Gruppe Modell+Farbe). Block `Auftraege-Anzeige: Anfang/Ende` (Test auftraege-frontend.test.js).
  Kundenkarte `#ku-auftraege` = Auftraege des Kunden. Kachel: Hauptzahl offene Auftraege.
  AM-6 Historie je Kunde: `GET /api/auftraege/kunden/:kundenNr/historie` (`leseKundenHistorie`, Logik utils/auftrag-historie.js, Test
  auftrag-historie.test.js; nur lesen, nichts ins Log, nur Kunden_Nr): je Modell + Farbe (ueber `lshopInfo`) zuletzt · Anzahl Auftraege ·
  Stueck · letztes Motiv/Druck/Preis; "hatte" erst ab "bestellt", Anfrage/Angebot/Design = "nur angefragt", storniert zaehlt nicht;
  `katalog` false = nicht mehr waehlbar (ausgelaufen, 3/6, Nummer fehlt), `lieferbar` = schlechteste BO7-Stufe der gehabten Groessen.
  Freie Positionen je gleichem Text. Oberflaeche Block `Auftrag-Historie: Anfang/Ende` (Test auftrag-historie-frontend.test.js):
  Kundenkarte (Auftraege neueste zuerst, Haken "mit stornierten", Karten "Hatte bisher", "Weitere Positionen", Aufgaben fuer den
  Kunden), Leiste `#au-hist` im Dialog (nur NEUER Auftrag, max. 8 + "mehr …", nur "hatte"): Klick oeffnet das Groessenraster der
  Farbe mit `auDlg.vorbelegung` (Motiv/Druck/Preis, Mengen leer; gilt nur fuer genau Modell + Farbe), "Preis von AU-… vom …"
  (`preisVon`, faellt beim Aendern des Preises weg). "Wie letztes Mal" (`#au-wie-letztes`, Kundenkarte `data-ku-wie`): `auVorlageAus`
  = Kurztitel, Kanal, Preis_Eingabe, Design_Link, Positionen mit Mengen + Preisen; NICHT Termin/Notiz/Rabatt/Status/Angebot/
  Herkunft-Lager-Korb/Zustaendig/EK von Hand; nicht mehr bestellbare Nummern fallen raus (Liste oben). `Vorlage_Von` hinten in
  Auftraege (Setup), nur beim Anlegen (422 bei unbekannter Vorlage); fehlt die Spalte, wird ohne Vermerk angelegt
  (`vorlageNichtVermerkt`). Ansicht "nach Vorlage AU-…".
  AM-6-1: im Dialog (nur neu, mit Kunde) `#au-letzte` = hoechstens 3 letzte AU des Kunden aus `auZ.daten` (`auLetzteAuftraege`: ohne
  storniert, ohne AG; mehr -> "alle in der Kundenkarte"). Klick = `#au-nachsehen` (eigenes `.edi-dialog` NACH `#au-dialog` im DOM,
  z-index 51, nur lesen `auNachsehenHtml`, Handy bildschirmfuellend ueber `#au-nachsehen`); Schliessen laesst den Dialog unberuehrt.
  "Als Vorlage übernehmen" = `auDialogOeffnen(null, { vorlage })`, bei Eingaben (`auHatEingaben`) vorher `showConfirm("Eingaben
  ersetzen?")`. Vorlage uebernimmt seit AM-6-1 `EK_Hand` der FREIEN Positionen (`ekVon`, "EK von AU-… vom …"). Test auftrag-letzte.test.js.
  AM-3: Ansicht mit "Design überspringen", "Rohlinge bereitstellen …" (Dialog `#ab-dialog`, Vorschau je Position, "Rest bestellen
  (teilen)", Ortswahl), Korb-Stand je Position (Klick `korbSpringeZu`), "Übergabe zurücknehmen", Ware-Kennzeichen, Hinweis freie
  Positionen; Liste: Kennzeichen Ware + Filter "wartet auf Ware". Korb: AU-Referenz als Link `data-korb-au` (Kurztitel ueber
  `window.auKurztitel`, nur in MC), Lager-Verlauf: Quelle auftrag -> `data-lager-au`; beide oeffnen `window.auOeffnen`.
  AM-3-1 (Inhaber 03.11.): Lagerbestand schon bei der Warenwahl - Raster je Groesse "📦 n" (alle Orte, Orte im Mouse-over),
  Zeile "im Lager: …", Farbauswahl "· 📦 n im Lager" (`auLagerJe`, nur gelesen aus `GET /api/lager/bestand`). Gruppe "bestellen"
  mit Bestand: Hinweis + Knopf "aus Lager nehmen" bzw. "teilen" (`auLagerVorschlag`, Hauptort zuerst; `auBestandOhne` zieht ab,
  was andere Positionen des Entwurfs schon aus Lager nehmen). Nichts wird gebucht - das bleibt beim Bereitstellen.
  AM-4: Unterpunkt `auftraege/todos` "Offene To-dos" (Karte `#td-ansicht`, Filter alle/ueberfaellig/woche/aufgaben/auftraege,
  abhaken direkt). Liste zeigt Auftraege UND Aufgaben (Filter `#au-art`, Kennzeichen "Aufgabe", "n offene To-dos"); "+ Neue Aufgabe"
  (`#ag-dialog`: Kurztitel, Notiz, Faellig, "für" Kunde/Partner/Shop-Artikel/intern, "gehört zu" AU-…), Ansicht `#ag-detail` mit eigener
  Leiste (`agLeisteHtml`) und Checkliste. Checkliste `tdBlockHtml` (Block `Auftraege-Anzeige`) in Auftrag und Aufgabe: Enter legt an,
  Haken, ↑/↓ (nur unter gleich erledigten), ✎, ✕ = archivieren, erledigte eingeklappt "n/m erledigt". Ereignisse fuer alle Bloecke in
  SECTION "Aufgaben und To-dos (AM-4)" (`tdAktion`, nach jeder Aktion `loadAuftraege`). Freitexte nie in Adresse/Browser-Speicher.
  AM-2-2: Modellsuche im Auftrag ueber `twBinden` (`twModell`: Modell fett · Name · Marke). Herkunft je Gruppe (Modell+Farbe+
  Herkunft+Ort): bestellen | aus Lager (Ort, Bestand nur gelesen aus `GET /api/lager/bestand`, Knopf "teilen" = `auTeilen`) |
  schon vorhanden; frei nur leer/vorhanden. Gebucht wird im Lager erst mit AM-3. Ansicht: Kennzeichen 🛒/📦/✓.)
- Bestellseiten (KS1: Unterpunkt `auftraege/bestellseiten`, Karte `#bsm-ansicht` im Panel `auftraege`, SECTION Bestellseiten (KS1) vor
  Artikelerfassung, Block `Bestellseiten-MC: Anfang/Ende` (Test bestellseite-seite.test.js), Praefix `bsm`, Hilfe-Gruppe `bestellseiten`.
  Einstiege: Knopf "Bestellseite für Kunden …" (`#au-bestellseite`, Auftragsansicht, Art auftrag) und "Dauer-Bestellseite …"
  (`#ku-dauer-bestellseite`, Kundenkarte, Art dauer). Ein Dialog `#bsm-dialog` (nach `#ku-dialog` im DOM, z-index 52 ueber die id): Anlegen,
  Link einmal anzeigen + kopieren, Speichern (Gueltig bis, Hinweis, Design-Link), neuer Link, sperren/wieder freigeben, Termine (dauer).
  Der Link (`bestellen.html#t=<Token>`) steht nur in `bsmZ.link`, solange der Dialog offen ist - nie Browser-Speicher/Adresse/Toast.
  Knopf "Artikelliste aktualisieren" = Bilder der Dauer-Sortimente.)
- Artikelerfassung (dazu Modus-Knopf "🧵 L-Shop-Modelle", LS4: Unterpunkt `artikel/lshop-modelle`, Panel `#lsm-panel`,
  SECTION L-Shop-Modelle mit Block `L-Shop-Modelle: Anfang/Ende`, Test lshop-modelle-frontend.test.js; Hilfe-Gruppe
  `lshop-modelle`; Links `data-lsm-link` aus Warenkorb "Nicht im Bestand" und Maske "Kein L-Shop-Modell".
  LS4-1: "Übernehmen" tut nie still nichts - `lsmUebernehmenGrund` liefert den Hilfe-Schluessel (`lsm-laeuft`,
  `lsm-erst-pruefen`, `lsm-erst-waehlen`, `lsm-nichts-da`, `lsm-nichts-neu`, `lsm-erst-update`) fuer Tooltip und Meldung beim Klick)
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
  `notifyHosterPruefseite` (gedrosselt 1/h); Workflows werden rot. AL2: eine LESENDE Shop-Zeitueberschreitung
  meldet MC erst bei der zweiten innerhalb von 2 h je Shop + Ablauf (`lib/alarmStand.js`, Logik `utils/alarm-stand.js`,
  SSOT-Reiter `Alarm_Stand` - nur bei Zeitueberschreitung geschrieben, `scripts/setup-alarm-stand.js`); schreibend
  (Ergebnis unklar) und Pruefseite sofort; Reiter fehlt/Sheets-Fehler = sofort. Routen melden Laufstopps nie selbst (AL1). Frontend:
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
  PA7 (07.11.): derselbe Abgleich prueft danach die aktiven **Festpreis-Partner** - NUR MELDEN, nichts anlegen, nie ein Festpreis
  (`lib/fpArtikel.js` `fpArtikelPruefung`, Logik `utils/fp-artikel.js`). Grund: der FP-Sync holt den Festpreis ueber die
  Artikelkategorie aus FP_Artikel_Kategorie und rechnet ohne Zuordnung STILL mit Festpreis 0 (Partner bekaeme den ganzen VK) - eine
  automatisch angelegte Zeile wuerde also nicht gesperrt. Gemeldet (Antwort `festpreis`, Chat in derselben Meldung "Festpreis FP-…: …",
  Lebenszeichen zaehlt FP-Partner mit): veroeffentlichte Shop-Artikel der Partner-Kategorien inkl. Unterkategorien ohne FP_Artikel-Zeile,
  FP_Artikel-Zeilen ohne Festpreis-Kategorie (leer oder ohne Zeile in FP_Artikel_Kategorie; Festpreis 0 dort ist bewusst), Kategorie-Nummern
  nicht im Shop. Fehlende FP-Reiter = keine FP-Partner. Shop: Kategorien + `products?status=publish` mit `_fields`, 1,5 s Takt.
  MC Festpreis → Artikel: Hinweis `#fp-artikel-hinweis` (ohne Festpreis-Kategorie, "zeigen" markiert Zeilen) und Knopf "Fehlende pruefen"
  (`GET /api/festpreis/artikel/:partnerId/pruefung`), Block `PA7 Festpreis-Hinweis: Anfang/Ende`. FP-Sync (`POST /api/festpreis/verkaeufe/sync`)
  ueberspringt Positionen ohne FP_Artikel-Zeile nicht mehr still: Antwort `ohneEintrag` (Partner-Kategorien, je Produkt Bestellungen +
  fruehestes Datum, `fpUebersprungenePruefen`) und `ohneFestpreisAnzahl`; MC-Toast "NICHT abgerechnet … Sync mit Datum ab … wiederholen"
  (der Sync liest sonst nur ab dem neuesten Verkauf). Rechnen/Schreiben des Syncs unveraendert. Test fp-artikel.test.js.
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
- backend/lib/produktionStand.js – Bestellansicht "Bestellungen (JFN)" (PS1), Logik in `utils/produktion-stand.js`.
  `POST /api/bestellen/produktion/stand?shop=` `{ bestellungen: [{ id, date_created, line_items }] }` (der Browser
  schickt die Bestellungen, die er schon hat; nur lesen, ohne Kundennamen): je Artikel L-Shop-Stand aus
  `Warenkorb_LShop` ueber den Korb-Schluessel `JFN:<Bestellnummer>:<line_item.id>` (= WC_Item_ID in
  Produktions_Status) - im Korb offen · herausgenommen: Grund · bestellt JFN-… (+ versandt · GLS · Paket 1 aus
  BO4d) · geliefert; ohne Korbzeile die Einstufung des Abgleichs (`stufeEin`, Kontext `ladeKontext` + Produkttypen
  nur fuer diese Positionen): bestellbar = "nicht im Korb", Trikot/Fremdware/einfach/ohne Varianten-Zeile =
  "kein L-Shop-Artikel", Nummer fehlt/falsch/unbekannt/ausgelaufen/fremdes Produkt = gelb "L-Shop-Nummer fehlt";
  HONK "nur JFN". Klick: Korb bzw. L-Shop-Bestellungen (`lbSpringeZu` oeffnet die Karte). Haekchen je Artikel:
  Fertig (im Karton) · DTF bestellt · Versendet + Notiz. **"L-Shop_bestellt" (F) ist nicht mehr schreibbar**
  (PUT 400), nur Altstand "von Hand markiert (alt)", wo der Korb nichts weiss; "Gedruckt" (H) wird nicht mehr
  gezeigt (Spalten bleiben). Neu hinten in Produktions_Status: `Fertig` + `Fertig_Am` (ISO), nur ueber den Namen;
  PUT `field: fertig` schreibt genau diese zwei Zellen RAW, liest zurueck, 409 ohne Spalten
  (`scripts/setup-produktion-fertig.js`, Trockenlauf Standard, `--write` nur die zwei Kopfzellen). Versendet zaehlt
  als fertig. Kopf: "2/3 fertig · 1/3 versendet · wartet auf: …"; Filter "wartet auf Teile" = mind. 1 fertig und
  mind. 1 nicht, aelteste zuerst nach fruehestem Fertig_Am (sonst Bestelldatum), "wartet seit" Kalendertage
  Europe/Berlin; Filter in localStorage `mc_bestellungen_filter`. Liste laedt seitenweise (100, max. 5 Seiten).
  BS1: Suchfeld `#ps-suche` neben dem Filter (Label "Suche" traegt den Mouse-over): `psSuche` im Block `Produktion-Stand` sucht ab 2
  Zeichen in Elternname der Position (nie im Variantennamen - der traegt bei Trikots den Rueckennamen), SKU, Merkmale Farbe/Groesse und
  Bestell-Nr.; ae = ä; mehrere Woerter alle in EINER Position. Wirkt auf die Sicht des Filters; Kopf "n von m offenen Bestellungen
  enthalten ‚…‘", Treffer-Zeile je Karte. Nur im Speicher der Seite. Mehr als 500 offene -> Hinweis `ps-grenze`.
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
  Kundennamen; je Buendel auch `marke` (BO3c). Nur mit `&mit=bestelldatum` (BO3c, Dringlichkeit) liest
  er zusaetzlich WooCommerce: offene Shop-Positionen, `ladeBestellungenNachId` mit `_fields: id,date_created`,
  1 Anfrage je 100, 10 min Zwischenspeicher je Shop+Bestellnummer, Pruefseite -> 503; je Position
  `bestelldatum` = Tag (JJJJ-MM-TT), eigene Positionen = `Angelegt` als Tag in Europe/Berlin. Reiter anlegen: `scripts/setup-lshop-korb-reiter.js` (Trockenlauf Standard, `--write`).
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
  BO6 (Groessenraster): Dialog "+ Eigene Position" = Modell -> Farbe -> je Groesse ein Mengenfeld (Block
  `Eigene-Raster: Anfang/Ende`, Test korb-eigen-raster.test.js; nur Groessen mit ArticleNr aus `lshopAuswertung`,
  Kindergroessen VORN, dann XS…; leer/0 = nicht bestellen) -> eine Referenz/Notiz fuer alle. `POST
  .../lshop-korb/eigen/mehrere` `{ positionen: [{ articleNr, menge }], referenz, notiz }` -> `legeEigenePositionenAn`:
  je Groesse mit Menge > 0 eine Zeile, fortlaufende EIGEN-Nummern, `eigeneZeilen` prueft alles vorher (422 = keine
  Zeile), unter der Korb-Sperre, EIN Schreibaufruf in die gepruefte Zielzeilen-Strecke (`schreibeNeueZeilen` mit
  `allesOderNichts`), zurueckgelesen. "Hinzufuegen und weitere Farbe" behaelt Modell/Referenz/Notiz. Der Einzelweg
  (eine Groesse je Klick) ist in der Oberflaeche entfallen; `POST .../eigen` bleibt (Tests, Altaufrufer).
  BO6-1 (bearbeiten): Knopf "bearbeiten …" an eigenen Positionen offen/abgewählt (Block `Eigen-Bearbeiten: Anfang/Ende`,
  Dialog `#eb-dialog`, Test korb-eigen-bearbeiten.test.js); Lager im Korb, bestellt/geliefert in L-Shop-Bestellungen nur
  gesperrt (aria-disabled, Grund im Mouse-over). `POST .../lshop-korb/eigen/bearbeiten` `{ schluessel, status, stand,
  articleNr, menge, referenz, notiz, lagerZiel }` -> `bearbeiteEigenePosition` / `eigenBearbeitenPlan`: unter der Korb-Sperre,
  Reiter UNFORMATTED frisch gelesen, ArticleNr nur aus dem Modell der bisherigen (waehlbar, ohne ausgelaufen/3/6; die
  bisherige bleibt erlaubt), anderes Modell = herausnehmen + neu anlegen. Gleiche Werte = `unveraendert` (Doppelklick),
  sonst Status + `Stand` wie gesehen (409), dann GENAU diese Zeile ueber `ersetzeZeile` (Vorher-Pruefung der ganzen Zeile,
  409; nur geaenderte Zellen RAW, zurueckgelesen), Stand + Status_Datum neu. Spur in Spalte `Aenderung` hinten
  ("geändert 02.11.: Menge 2 → 3, M → L", angehaengt mit " | "; nicht im Hinweis - der gehoert dem Abgleich und schaltet
  bei Lager-Zeilen "zurück ins Lager" frei). Fehlt die Spalte -> 409 `einrichtung` (`scripts/setup-korb-aenderung.js`,
  Trockenlauf Standard, `--write`).
- backend/lib/lshopEdi.js – L-Shop-EDI-Bestelldatei aus dem Warenkorb (BO4a), Logik in
  `utils/edi-bestellung.js`. **Erzeugt nur, verschickt nichts:** kein FTP/SFTP, kein Shop, nur Sheets;
  die Datei geht als Download an den Browser (nie in den FTP-Ordner `Order`, dort ist jede XML eine
  echte Bestellung). `POST /api/bestellen/lshop-korb/edi/vorschau` schreibt nichts (order_id
  `JFN-<Jahr>-____`); `.../edi/erzeugen` unter der Korb-Sperre (`mitKorbSperre`): Pruefbericht neu,
  rot -> 422 + `pruefung`, sonst naechste order_id (`naechsteOrderId`, hoechste + 1 je Jahr, nie
  wiederverwendet) und GENAU EINE Zeile im SSOT-Reiter `LShop_EDI_Dateien` (Status "Entwurf", Korb-
  Schluessel), Schreibmuster des Korbs (kein append, zuruecklesen). Der Korb bleibt unveraendert.
  Aufbau nach Guideline 1.4.1 wie die Testdatei JFN-2026-0001 (L-Shop 23.09. fehlerfrei): `order ->
  orderheader -> orderitems -> item`, `additional_information` weg, **nie** `shippingaddress`/
  `senderaddress`, Kopf `shipping_method` (BO4e: waehlbar, s. u.), `partial_delivery` -1, `mail` info@,
  `printmode` 0, `order_date` = Tag (Europe/Berlin, TT.MM.JJJJ), **kein `delivery_date`** (BO4e: laut
  Guideline Datum fuer VERSPAETETE Lieferung). Eine Zeile je Korb-Position,
  `reference` = `<Shop>-<Bestellnr>-<Pos>` bzw. die eigene Referenz. `customer_id` NUR aus Business
  `Config` Schluessel `lshop.customer_id` (nie im Code/Log/Postfach; fehlt -> rot). Commission
  Standard `JFN Sammelbestellung KW<KW>`, <= 30. Pruefregeln: `EDI_REGELN` (rot sperrt, "noch nicht
  bezahlt" gelb, nach 14 Uhr Hinweis). XML-Pruefung ohne Paket: strenger Rueckleser `pruefeBestellXml`
  (nur unser Aufbau) + `DOMParser` im Browser. Einrichtung: `scripts/setup-lshop-edi-reiter.js`
  (Trockenlauf Standard, `--write`; Reiter + Zeile 0001 + Config-Zeile mit leerem Wert, idempotent).
  BO4e: **Versandart** nur aus `VERSANDARTEN` (Standard, Abholung, DHL, GLS, DPD, UPS, EX007-EX011; in die
  Datei nur der Code, ohne CDATA; sonst rot). Vorgabe Business `Config` `lshop.shipping_method` (leer ->
  Standard, unbekannt -> Standard + gelb `versandart_config`), Auswahl `#edi-versandart` im Dialog (Liste vom
  Server), Body `versandart`. Express: vor 13:30 Berlin Hinweis, ab 13:30 gelb (`nachExpressSchluss`);
  Abholung gelb. Textfelder `order_id`, `commission`, `reference`, `mail` **immer CDATA** (`cdata()`),
  Zahlen/Datum/`shipping_method` roh. Protokoll `LShop_EDI_Dateien` hat hinten `Versandart`, `Gesendet`.
  **"Als gesendet markieren"** (Bruecke bis BO4c): `POST .../edi/gesendet` `{ orderId }` -> `ediAlsGesendet`
  unter der Korb-Sperre, Plan `gesendetPlan` (nur Status Entwurf; JEDE `Korb_Schluessel`-Position vorhanden
  und offen, sonst 422 + `probleme`, nichts geschrieben), dann EIN `values.batchUpdate` ueber beide Reiter:
  EDI `Status = gesendet` + `Gesendet` (Klickzeit) und je Position `Status = bestellt`, `Bestell_ID`,
  `Status_Datum`, `Stand`; alles zurueckgelesen. Kein FTP, keine Uebertragung. Knopf im Abschnitt
  "Entwuerfe" des Unterreiters L-Shop-Bestellungen (`entwuerfeAus`: Entwurf mit nicht mehr offenen
  Positionen = ueberholt, ohne Knopf; Testdatei nie), mit `showConfirm`.
- backend/lib/lshopFtp.js – L-Shop-FTP, **NUR LESEN** (BO4b-1), einzige Stelle mit `basic-ftp` (Test
  lshop-ftp.test.js: kein anderer Import, am Client nur access/list/downloadTo/close, kein Schreibweg).
  `mitLShopFtp(fn)` = EINE Verbindung, fn bekommt nur `{ liste, lade }`; feste Ordner (`ORDER` nur Liste,
  nie laden), Dateiname ohne Pfad, 1 MB je Beleg (Rechnungs-PDF 10 MB), 30 s je Befehl. Fehler -> `LShopFtpFehler` (502,
  `lshop_ftp`) ohne Host/IP/Benutzer. Das EDI-Konto DARF auf dem Server schreiben/loeschen - "nur lesen"
  sichert allein dieser Code. Schreiben kommt erst mit BO4c: nur in `ORDER`, nur `<order_id>_…xml` aus
  `LShop_EDI_Dateien`, nie loeschen/umbenennen - das macht seit BO4c NUR `lib/lshopFtpSenden.js` (exportiert
  von hier nur `zugang`/`ohneZugang`). Secrets: `LSHOP_FTP_HOST` (gemeinsam, Port 21),
  `LSHOP_EDI_FTP_USER/PASS` (Belege + Bestellen), `LSHOP_FTP_USER/PASS` (Bestandsdatei, ab BO4b-3).
  Server unverschluesselt (Inhaber 22.10.) und wackelig: alles nacheinander, keine Wiederholung im Lauf.
- backend/lib/lshopFtpSenden.js – **einziger Schreibweg** zum L-Shop-FTP (BO4c), `sendeBestellung({ dateiname,
  inhalt })`: nur `ORDER`, nur `JFN-JJJJ-NNNN_JJJJMMTT-HHMM.xml`, <= 1 MB, EINE Verbindung, genau EIN `uploadFrom`,
  nie remove/rename/ensureDir/Wiederholung (Test edi-senden.test.js: nur hier `uploadFrom`, basic-ftp nur hier und
  in lshopFtp.js). Liegt der Name oder dieselbe order_id schon in ORDER -> nicht senden, `unklar`. Ergebnis
  `liegt` (2xx + Groesse stimmt) · `abgeholt` (2xx, Datei schon weg) · `nicht-da` NUR vor Beginn der
  Uebertragung (Zugang, Anmeldung, erste Liste, oder Fehlercode >= 400, bevor die Quelle gelesen wurde -
  basic-ftp liest sie erst nach 150/125) · sonst `unklar`. Jede XML in ORDER ist eine echte Bestellung
  (L-Shop holt nach ~8 min), kein Testordner: Tests nur mit Client-Attrappe.
  Ablauf `ediSenden` (lib/lshopEdi.js, `POST /api/bestellen/lshop-korb/edi/senden` `{ orderId }`, Vorschau
  `.../edi/senden/vorschau`, schreibt nichts): unter der Korb-Sperre frisch pruefen (nur `Entwurf`, <= 24 h ab
  `Erzeugt`, jede Position offen, Pruefbericht gruen; **Express nach 13:30 Berlin beim Senden rot**,
  Regel `express_senden`); Datei NEU gebaut (der Entwurf ist nirgends gespeichert), `order_date` = Sendetag,
  Name mit Sendezeit. Status `wird gesendet` + `Sendeversuch` (sperrt ueber Instanzen) -> Upload -> liegt/
  abgeholt: EIN batchUpdate wie "Als gesendet markieren" (+ `Dateiname`, `Sende_Hinweis`, ggf. `Abgeholt`),
  Archiv Drive `L-Shop Belege/Bestellung/<Jahr>` (`Drive_ID`), Chat "📤 L-Shop gesendet: …" (nie Preise);
  nicht-da -> zurueck `Entwurf` (502); unklar -> Status `unklar` + Chat-Alarm (502), **nie erneut hochladen**;
  Datei liegt, Sheet scheitert -> Chat-Alarm (500). Rueckwege aus `unklar` oder haengendem `wird gesendet`
  (> `HAENGT_MIN` 10 min): "Als gesendet markieren" und `POST .../edi/zurueck` (zurueck auf Entwurf).
  `LShop_EDI_Dateien` hinten seit BO4c: `Abgeholt`, `Drive_ID`, `Sende_Hinweis`, `Sendeversuch`.
  **Netto/Staffel** (nur MC-Oberflaeche, nie XML/Chat/Log/Zaehlliste/Postfach): EK = `10CartonsPrice` der
  ArticleNr x Menge (`nettoSummen`), Staffel aus Business `Config` `lshop.versandstufe.<n>.ab` / `.kosten`
  (lueckenlos ab 1, `versandstaffel`/`staffelStand`; fehlt -> grauer Hinweis). Anzeige im Erzeugen- und
  Sende-Dialog und live in `#korb-leiste` (`GET .../lshop-korb` liefert `ek` je Buendel + `staffel`);
  Frontend-Spiegel Block `Netto-Staffel: Anfang/Ende`. Keine Betraege in Code, Tests (erfunden), Log.
  BO4f: Dialog "L-Shop-Bestellung" (Leistenknopf "L-Shop-Bestellung …") hat "An L-Shop senden …" (erzeugt den
  Entwurf OHNE Download, schliesst den Dialog, oeffnet den Bestaetigungsdialog fuer diese order_id - erst dort wird
  gesendet; Abbruch = Entwurf bleibt) und "Nur Entwurf + herunterladen" (Download + Link auf Entwuerfe). Beide
  gesperrt ueber aria-disabled (Erklaerung "edi-gesperrt" beim Darueberfahren), nie zweiter Entwurf ohne "Neu
  pruefen". Express-Zeilen (express, express_spaet, express_senden) zeigen beide Dialoge nur bei Versandart EX…
  (`ediPunkteSichtbar`, Block `EDI-Pruefung: Anfang/Ende`, Test edi-frontend.test.js); die Pruefung selbst bleibt.
- backend/lib/wareneingang.js – Wareneingang (BO4b-5), Logik `utils/wareneingang.js`. Schritt 1 „Ware angekommen“
  von Hand: Knopf auf jeder Karte in „L-Shop-Bestellungen“ (Block `L-Shop-Bestellungen`, `lbEingangKnopfHtml`),
  Dialog `#we-dialog` mit den Positionen (bestellt vorgewaehlt, geliefert mit „zurück auf bestellt“).
  `POST /api/bestellen/lshop-korb/wareneingang` bzw. `…/wareneingang/zurueck` `{ orderId, auswahl }` unter der
  Korb-Sperre: nur Positionen mit `Bestell_ID` = order_id, nur `bestellt` -> `geliefert` (Rueckweg umgekehrt),
  Status wie im Browser gesehen (sonst 409/422 + probleme, nichts geschrieben); EIN batchUpdate (Status,
  Status_Datum, Stand) + `LShop_Sendungen.Wareneingang` NUR bei genau einem Paket der Bestellung (Rueckweg
  leert ihn, wenn nichts mehr geliefert ist); zurueckgelesen. „geliefert/teilweise“ leitet `bestellStatus` ab.
- backend/lib/karton.js – Karton-Scan (BO4b-5 Schritt 2), Logik `utils/karton.js`. QR auf dem L-Shop-Karton ->
  `https://textilelogistics.eu/pdf/<2>/<2>/<Kundennr>_<Karton-ID>_<64 Hex>.pdf` (je KARTON eine PDF, ohne Anmeldung).
  ⚠️ Der Link enthaelt die L-Shop-Kundennummer: nie speichern, loggen, zurueckgeben, nie in Fehlertexte, Tests nur
  erfundene Werte; weitergegeben wird nur die Karton-ID. Abruf nur bei exakt `KARTON_LINK`, Kundennr still gegen Config
  `lshop.customer_id` (sonst 422 vor dem Abruf), 15 s, <= 1 MB, `redirect: 'error'`, muss mit `%PDF-` beginnen.
  PDF ohne Bibliothek (`leseKartonPdf`, Aufbau gemessen 27.10.): Kopf LA/VA/order_id, je Gruppe Referenzzeile links
  vor der Kopfzeile Article-No|SKU|Color|Size|Ord.|Qty., Spalten ueber die x der Kopfzeile, Gruppen ueber Seiten.
  Jede Datenzeile = 1 Stueck: Menge = Summe `Ord.` je reference + SKU, `Qty.` NIE benutzen. Abgleich `kartonAbgleich`
  ueber `referenzFuer` + LShop_ArticleNr: ok (bestellt, Menge gleich, vorgewaehlt) · gelb Menge anders (waehlbar, ohne
  Haken) · gelb schon geliefert / nicht im Korb / anderer Status (nicht waehlbar) · rot unbekannte order_id.
  `POST /api/bestellen/lshop-korb/karton/pruefen { link }` schreibt nichts; `…/karton/angekommen { link, auswahl }`
  liest die PDF NEU, unter der Korb-Sperre: Archiv `Karton/<Jahr>/<LA>_<Karton-ID>.pdf` (belegArchiv, Name + MD5)
  -> `bucheEingangInSperre` (derselbe Weg wie „Ware angekommen“) -> Zeile im SSOT-Reiter `LShop_Kartons` (ohne append,
  nur beim ersten Eingang; Karton_ID|LA|VA|order_id|Eingang|Quelle|Positionen|Abweichungen|Datei|Drive_ID|Stand, nie
  Link/Kundennr). Doppelter Scan = gelb mit Datum, Rest buchbar. EDI-Status wird nicht gesetzt. Reiter + Archiv-Ordner:
  `scripts/setup-lshop-belege-reiter.js` (Trockenlauf, `--write`). Frontend: Knopf „Karton scannen“ in
  L-Shop-Bestellungen, Dialog `#ks-dialog` (Kamera + `BarcodeDetector`, sonst Link einfuegen), Anzeige `ksErgebnisHtml`
  im Block `L-Shop-Bestellungen`; Link nur in `ksZustand.link`, nie Adresse/localStorage/Anzeige/Toast.
- backend/lib/lshopLieferbarkeit.js – Lieferbarkeit L-Shop (BO7-1), Logik `utils/lshop-lieferbarkeit.js`. Quellen: `stockfile.csv`
  (FTP-Wurzel, Konto "bestand" = Secrets `LSHOP_FTP_USER/PASS`, `ladeBestandsdatei` in lib/lshopFtp.js: nur list + downloadTo,
  <= 10 MB, alle 30 min neu, `article;stock;catalog`, UTF-8 BOM, catalog = CatalogNr) und die Auslaufliste
  `Auslaufartikel - Stand TT.MM.JJJJ….xlsx` (Ordner "L-Shop Auslauf" in der Ablage, sonst ablageweite Suche; neueste nach
  NAMENSdatum; Spalten `Artikelnummer`, `Auslaufdatum` ueber den Namen; gelesen mit drive.readonly, nie gespeichert; > 14 Tage
  alt -> Hinweis). Reiter `LShop_Lieferbarkeit` (SSOT): ArticleNr | CatalogNr | stock | Stand_Datei | Auslauf | Auslaufdatum |
  Quelle_Liste | Geaendert_Am | Null_seit, NUR unsere Nummern (Varianten Aktiv TRUE, alle Korb-Zeilen, Lager `LS:`); stock leer =
  nicht mehr bei L-Shop gefuehrt; `Null_seit` = seit wann durchgehend 0/nicht gefuehrt (BO7-3: 14 Tage). Jeder Lauf schreibt den
  ganzen Reiter in EINEM values.update (kein append, vorher frisch gelesen = Stand vom Anfang, sonst 409; Rest darunter geleert;
  zurueckgelesen). "laeuft aus" NUR aus der Liste; `Discontinued` 3/6 bleibt harte Sperre (Anzeige-Umstellung BO7-2). Chat
  (`buildLieferbarkeitNachricht`) erst nach dem Schreiben, nur fuer Nummern mit OFFENEN Korb-Positionen und nur beim Wechsel
  gegen die vorhandene Zeile (lieferbar -> 0/nicht gefuehrt, Auslauf nein -> ja); Erstbestand still, keine Shop-Variationen.
  FTP-Fehler = 200 `ftp: fehler`, nichts geschrieben; letzter `Stand_Datei` > 6 h -> 502 (Chat + Log-Alarm). Liste nicht
  lesbar -> Auslauf-Spalten bleiben. `POST /api/intern/lshop-lieferbarkeit/abruf` (Scheduler, Lauf-ID `LB-…`, Sperre -> 200
  uebersprungen), `POST /api/bestellen/lshop-lieferbarkeit/abruf` { dryRun } (Knopf "📦 Lieferbarkeit jetzt" im Korb, Block
  `Lieferbarkeit: Anfang/Ende`, eigener Router `routes/lshopLieferbarkeit.js`). Einrichtung `scripts/setup-lshop-lieferbarkeit.js`
  (Reiter + Ordner "L-Shop Auslauf" ueber `richteAuslaufOrdnerEin` in belegArchiv.js; Trockenlauf, `--write`), von Hand
  `scripts/lshop-lieferbarkeit.js` (Trockenlauf Standard, `--write`; lokal NODE_ENV=production fuer die FTP-Secrets).
  BO7-2 Anzeige (nur lesen): `lib/lieferbarkeitLesen.js` (`leseLieferbarkeit`, 60 s Zwischenspeicher, der Lauf leert ihn;
  fehlt/kaputt der Reiter -> leere Map, alles ohne Kennzeichen) -> `{ stufe, stock, nullSeit, auslaufdatum }` je ArticleNr
  (`stufeAus`: nicht_gefuehrt > auslauf > null > lieferbar) + `stand` (Stand_Datei, veraltet > 3 h, Liste > 14 Tage).
  `lshopAuswertung(zeilen, { lieferbarkeit })`: Variante traegt `lieferbar`, `auslaufend` NUR aus der Liste ({farbe, groesse,
  datum}); Discontinued 1/2/8 zeigt NICHTS mehr, 3/6 + "ausgelaufen" bleiben Sperre (`gesperrt`). Angehaengt in: Korb (je Buendel
  `lieferbar`, `lieferbarkeitStand`, `summen.nichtLieferbar`), `.../modelle/:c/varianten` (BO6/BO6-1), `GET /api/sheets/lshop/:c`
  (Maske, `mitLieferbarkeit`), Lager `rohlingVarianten` (`gesperrt` statt `auslauf`), LS4 `vorschau.lieferbar` (nur genutzte
  Nummern). Frontend Block `Lieferbarkeit-Anzeige: Anfang/Ende` (Test lieferbarkeit-anzeige.test.js), Praefix **`lfb`** (nicht `lb` -
  das ist L-Shop-Bestellungen): `lfbPunkt` (CSS `lfb-<stufe>`, Hilfe `lfb-*`, Zahl in `data-hilfe-zusatz` - der Tooltip stellt sie vor
  den festen Text), `lfbStandHtml`, `lfbRasterHinweis` (Raster nur Punkt, Text darunter), Korb "nicht lieferbar zuerst"
  (`mc_korb_lb_zuerst`). Der Test parst das ganze Modul-Skript (doppelte Namen zwischen Bloecken = rot).
  BO7-3 Problemliste "Lieferbarkeit Shop" (Unterpunkt `artikel/lieferbarkeit`, Modus-Knopf `#mode-btn-lieferbarkeit`, Panel
  `#lfbs-panel`, SECTION Lieferbarkeit Shop, Block `Lieferbarkeit-Shop: Anfang/Ende`, Praefix `lfbs`, Test lieferbarkeit-shop.test.js):
  `lib/lieferbarkeitShop.js` (`leseProblemliste`, NUR LESEN), Logik `utils/lieferbarkeit-shop.js`, `GET /api/lieferbarkeit-shop[?shopStatus=1]`.
  Drin: Varianten Aktiv TRUE + WC_Variation_ID + LShop_ArticleNr eines veroeffentlichten JFN-Artikels mit Rohling nicht gefuehrt / laeuft
  aus / 0 seit >= 14 Tagen am Stueck (`problemStufe`, `NULL_AB_TAGE`). Privat: MC setzt beim Privat-Setzen Aktiv FALSE (faellt heraus);
  der Status JEDER Variation nur per Knopf "Shop-Status pruefen" (je Artikel ein Abruf, Takt 2 s, 30 min Zwischenspeicher), Produkte
  (Status/Name/Kategorie/`_lieferzeit`) 10 min. Vorschlaege nur Text (beobachten, ab 30 Tagen Lieferzeit pruefen, Nachfolger nur mit
  LIEFERBARER Alternative aus dem Reiter, nicht gefuehrt -> privat ueber die Loeschliste). "Liste kopieren" (`lfbsExport` = Spiegel
  von `exportText`) und Drucken (`body.druck-zaehlliste`) ohne Preise. Maske: `lfbsMaskeHinweis` beim Laden eines Artikels
  (`#pf-lfbs-hinweis`). Lieferzeit-Namen aus `Struktur_Lieferzeiten`. HONK: Varianten/Erfassungsmaske sind nur JFN.
  BO7-4: Stufe **`auslauf_null`** "laeuft aus · schon 0" (Auslaufliste UND stock 0, ohne 14-Tage-Grenze) = dringendste nach
  "nicht mehr gefuehrt" (`stufeAus`, Rang nicht_gefuehrt > auslauf_null > auslauf > null > lieferbar), ueberall wo Punkte stehen
  (CSS `lfb-auslauf_null` orange, Hilfe `lfb-auslauf-null`, Mouse-over "laeuft aus bis … – bei L-Shop schon 0 seit …"), in der
  Problemliste eigener Filter/Zaehler, je Artikel `schonNull` ("x davon schon 0"), Vorschlag "jetzt handeln: …". `auslaufend` in
  lshopAuswertung enthaelt sie mit `schonNull`. Chat (BO7-1): eine Zeile je Nummer, nennt "laeuft aus" UND "schon 0".
- backend/lib/lshopBelege.js – Belege-Abruf (BO4b-1), Logik in `utils/lshop-belege.js`. Scheduler
  `POST /api/intern/lshop-belege/abruf` (Job `lshop-belege-abruf`, `7,37 * * * *`) und Knopf
  `POST /api/bestellen/lshop-belege/abruf` (`routes/lshopBelege.js`, eigener Router, damit
  routes/bestellen.js FTP-frei bleibt; `{ dryRun }`). Protokoll SSOT-Reiter `LShop_Belege` (eine Zeile je
  verarbeiteter Datei, Schluessel Ordner+Datei, Schreibmuster des Korbs, nie loeschen; Einrichtung
  `scripts/setup-lshop-belege-reiter.js`). Waechter: jede Datei in `ORDER`, die nicht `<order_id>_…xml`
  mit Status aus `EDI_EIGEN_ORDER` ist (BO4c: wird gesendet, gesendet, unklar, bestaetigt, versandt,
  geliefert) -> Alarm; AB: order_id im Text suchen (`dekodiere` nach
  BOM - Lieferbestaetigungen sind UTF-16 LE trotz `encoding="utf-8"`), fehlt/unbekannt/Entwurf/
  Testdatei -> Alarm, sonst Auswertung (BO4i, `lib/lshopAb.js`). Gleicher Name, anderer Hash -> Alarm
  "veraendert" (AB: neu ausgewertet + Chat "AB geändert", Archiv bleibt die alte Datei). Erst schreiben, dann Chat.
  FTP-Fehler = 200 + Zeile Art "Lauf"/"fehler"; Chat ab 3 in Folge, 1/h (Zustand im Reiter, weil
  Cloud-Run-Instanzen zwischen den Takten wegfallen); andere Fehler 5xx. Eigene Datei, die > 20 min in
  `ORDER` liegt: Chat einmal je Datei (Merker im Hinweis der Protokollzeile). BO4c: per Knopf gesendete Datei
  (Sendeversuch gesetzt) nicht mehr in ORDER -> `Abgeholt` = Laufzeit ("spaetestens", `abgeholtPlan`);
  `wird gesendet` > 10 min -> Chat einmal (Merker in `Sende_Hinweis`, `haengendPlan`), Status nie geaendert.
  Frontend: Knopf "Belege abrufen" im Korb,
  Block `Belege-Abruf: Anfang/Ende`.
  BO4b-2: **Lieferbestaetigung je PAKET** (`leseLieferbestaetigung`): eine Datei = Tagesstand aller Pakete
  eines Abends, mehrere VA je Datei, ein VA in Teillieferungen (LA) ueber mehrere Tage. Gelesen werden NUR
  Paketnummer, VorgangDE (VA/LA), KdBestellNrDE, Frachtfuehrer, Gewicht, Url (nur textilelogistics.eu) -
  nie Kundennummer, Adressfelder, Mail, INETNummer, Kommission. SSOT-Reiter `LShop_Sendungen` (eine Zeile
  je Paket, Schluessel Paketnummer, RAW-Text; gleiche Nummer gleicher Inhalt -> uebersprungen, anderer ->
  Alarm, nie ueberschrieben). KdBestellNrDE leer = Portal (nur Sendung, kein Alarm); `JFN-…` mit Status
  gesendet/bestaetigt/versandt/geliefert = eigen -> `LShop_EDI_Dateien` Status `versandt` (nur aus
  gesendet/bestaetigt, nur die Zelle) + Chat "📦 L-Shop versandt: …" mit Tracking; unbekannt/Entwurf/fremd
  -> Alarm. Korb-Status bleibt `bestellt`. Erstbestand still: keine Zeile "Lieferbestaetigung" im
  Protokoll ODER Namensdatum <= `ERSTBESTAND_BIS` (20261022). Je Lauf hoechstens
  `MAX_NEUE_BELEGE_JE_LAUF` (15) neue Belege (Scheduler-Frist), Rest = `offen`, naechster Takt.
  Ablauf je Datei: laden -> archivieren -> Sendungen -> EDI-Status -> Protokoll (`Drive_ID` hinten) ->
  Chat; jeder Schritt wiederholbar. Archiv-Fehler = Datei nicht verarbeitet + Zeile "Lauf"/"fehler"
  (gleiche Serie wie FTP); Archiv-Konflikt = Alarm, Datei verarbeitet ohne Drive_ID. Rechnungen XML/PDF:
  nur Archiv, kein zweiter Weg nach Lexware. Anzeige der Sendungen seit BO4d im Unterreiter
  "L-Shop-Bestellungen" (lib/lshopBestellungen.js), nicht mehr im Korb.
- backend/lib/lshopBestellungen.js – Unterreiter "L-Shop-Bestellungen (JFN)" (BO4d), Logik in
  `utils/lshop-bestellungen.js`. `GET /api/bestellen/lshop-bestellungen?shop=` NUR LESEN, nur Sheets
  (LShop_EDI_Dateien, Warenkorb_LShop, LShop_Modelle, LShop_Sendungen), nur JFN (HONK -> `nurJfn`), fehlende
  Reiter = leer. Bestellung = EDI-Zeile ab "gesendet" (Entwurf/Testdatei nie); Positionen ueber Korb
  `Bestell_ID` = order_id, ersatzweise EDI `Korb_Schluessel`. Status aus den Daten (`bestellStatus`):
  geliefert (alle Positionen geliefert) > teilweise geliefert (eine geliefert oder Paket mit Wareneingang)
  > versandt (Pakete) > bestaetigt (EDI) > gesendet. Lieferscheine = Pakete nach LA. Je Bestellung
  `filter.unterwegs` / `filter.geliefert` (geliefert in den letzten 14 Tagen, juengstes Status_Datum); der
  Browser filtert nur ueber diese Kennzeichen. Portal-Sendungen (order_id leer) getrennt nach VA, `aelter` =
  > 30 Tage. Datum: `gesendet` aus Spalte `Gesendet` (BO4e, Klick "Als gesendet markieren"), sonst
  "erstellt am" (Erzeugt); dazu `versandart` und `entwuerfe` (BO4e). Tracking-Links nur aus `TRACKING_HOSTS`
  (utils/lshop-belege.js, Spiegel `LB_TRACKING` im Frontend; heute nur textilelogistics.eu - ein weiterer
  Host, z. B. GLS, erst nach Messung an einer echten Lieferbestaetigung). Liefertermin und AB-Abweichungen
  aus der AB (BO4i): "AB vom …" je Karte, je Position "sofort" / gelb "Liefertermin …" / gelb-rot Hinweis;
  ohne AB "Liefertermin folgt". Wareneingang seit BO4b-5 (lib/wareneingang.js, lib/karton.js). Der Korb (`GET .../lshop-korb`) zeigt seit BO4d nur
  `KORB_SICHTBAR` = offen + abgewählt (`summen.positionen` = beide), liefert keine `sendungen` mehr; die
  Zeilen bleiben unveraendert.
- backend/lib/rueckstand.js – L-Shop-Rueckstandsliste (RS1), NUR LESEN, Logik `utils/rueckstand.js`. Apps Script (info@) legt jeden
  Mittwoch `Rueckstandsliste_JJJJ-MM-TT.xlsx` in den Ordner "L-Shop Rueckstandsliste" der geteilten Ablage (`RUECKSTAND_ORDNER_ID`,
  per Env ueberschreibbar; drive.readonly). Die Datei hat keinen Standard-Stil (exceljs findet kein Blatt, Blattdatei "Sheet1.xml"):
  `leseXlsxZeilen` liest das Zip selbst (jszip 3.10.1, gepinnt), NUR Spalten A-O - P-T (Empfaenger/Adresse) nie. Kommission =
  Kommission der GANZEN Bestellung ("JFN Sammelbestellung KWnn"), nicht die Positions-Referenz: Zuordnung ueber Fremdbeleg
  (`order_id`) + LieferantArtNr auf Korb-Positionen (mehrere moeglich) -> AU (Korb-Referenz AU-…), Shop-Bestellungen, L-Shop-Bestellung;
  sonst "ohne Bezug in MC". `GET /api/bestellen/rueckstand` (ohne Kommission/Kunden-Nr.), nichts gespeichert, Datei-Cache nach ID +
  Aenderungszeit, Ordnerliste 10 min. Liste > 8 Tage -> Hinweis veraltet. Frontend Block `Rueckstand: Anfang/Ende` (Abschnitt
  `#rs-bereich` oben in L-Shop-Bestellungen), Kennzeichen `rsKorbKennzeichen` / `rsShopKennzeichen` / `rsAuftragKennzeichen`, `zahlen`
  fuer das Dashboard (DB1). Test rueckstand.test.js.
- backend/lib/lshopAb.js – Auftragsbestaetigung (AB-XML) auswerten (BO4i), Logik `utils/lshop-ab.js`. **IDs:** im alten
  Stufenplan (auftrag-BO4b) war "BO4b-4" der Wareneingang - erledigt als BO4b-5; die AB-Auswertung heisst BO4i.
  AB kommt seit 27.10. nur noch als XML in `ORDERCONFIRMATION` (Mail aus), je VA. Gemessen 28.10.: UTF-8 ohne BOM;
  `Header/IhreBestellung` = order_id, `Vorgang` = VA, `Belegnummer` = AB-Nr, Daten `TT.MM.JJJJ`; `Item`: Artikelnummer,
  Menge, Liefertermin, `PositionFreiText` = unsere `reference`. Versandkosten-Zeile `Artikelnummer 9900000001` wird
  ignoriert. Adressen, EPreis/GPreis/PayTerms, Kundennummer werden NIE gelesen (kein Preisvergleich - gehoert zur
  Rechnung). Liefertermin "sofort" = L-Shop schreibt das Belegdatum (vor dem Bestelldatum); spaeter = nach dem
  `Bestelldatum` der AB. `leseAb` -> `abAbgleich`: Zuordnung reference + Artikelnummer (gleiche in Dateifolge);
  Abweichungen rot Menge gekuerzt / fehlt in AB / unbekannte AB-Zeile, gelb Menge mehr / Termin spaeter.
  `werteAbAus` unter der Korb-Sperre (belegt -> Datei ohne Protokollzeile, naechster Takt), ein batchUpdate RAW nur
  geaenderter Zellen, zurueckgelesen: EDI Status NUR gesendet -> `bestätigt` (versandt/geliefert bleiben, unklar
  bleibt + Hinweis), hinten `AB_Nr`, `AB_VA`, `AB_Datum`, `AB_Eingang`, `AB_Hinweis` ("ok" oder Zaehler); Korb hinten
  `Liefertermin` (JJJJ-MM-TT, leer = sofort) + `AB_Hinweis` je Position der Bestellung - Menge/Status bleiben. Spalten:
  `scripts/setup-lshop-ab-spalten.js` (Trockenlauf, `--write`); fehlen sie, 409 + Alarm (Trockenlauf rechnet ohne).
  Beleg-Abruf: Protokoll-Ergebnis `ausgewertet` / `Abweichung` / `verändert`; IhreBestellung muss zur gefundenen
  order_id passen (sonst Alarm). **Chat nur bei Abweichung, geaenderter oder zweiter AB** (`buildAbNachricht`, ohne
  Preise), "alles ok" still. Bestand: `scripts/ab-auswerten.js` (Trockenlauf, `--write`, `--order`; FTP nur lesend,
  lokal mit NODE_ENV=production fuer die FTP-Secrets), setzt Protokoll "erkannt" -> ausgewertet. Anzeige: Felder `ab`
  je Bestellung und `liefertermin`/`abHinweis`/`abStufe` je Position (utils/lshop-bestellungen.js).
- backend/lib/belegArchiv.js – Archiv der L-Shop-Belege (BO4b-2), einzige Stelle mit Drive-SCHREIBEN
  ausser dem Backup. Geteilte Ablage "Mission Control" -> `L-Shop Belege/<Art>/<Jahr>/` (Art
  Lieferbestaetigung | Auftragsbestaetigung | Rechnung_XML | Rechnung_PDF; Jahr aus dem Dateinamen, sonst
  FTP-Zeit Berlin). Eigene Anmeldung mit Scope **`drive.file`** (`googleAuthMitScopes`): MC sieht nur, was
  es selbst angelegt hat - deshalb legt MC die Ordner selbst an (Setup-Skript bzw. bei Bedarf); ein von
  Hand angelegter Ordner gleichen Namens waere unsichtbar. Cloud Run und lokal = `mission-control-sa`
  (sonst saehen sie gegenseitig ihre Ordner nicht). Datei unveraendert (Bytes, Name, keine Umwandlung),
  nach Upload `size` + `md5Checksum` geprueft. Gleicher Name: gleiche MD5 -> vorhandene ID; andere MD5
  oder mehrfach -> `ArchivKonflikt`. Nie loeschen, ueberschreiben, Papierkorb, Freigaben (Quelltext-Test
  beleg-archiv.test.js).
- backend/routes/partnerPortal.js – Token-Auth für partner.html + WC-Sync
  PP1: Startkacheln `GET /api/partner/kacheln` (Token) und `GET /api/kalkulation/partner/:id/kacheln` (Admin, MC unter Partner ->
  Lizenzpartner, Auswahl "Partner auf einen Blick"), beide ueber `leseKacheln` -> `partnerKacheln` (utils/partner-saldo.js): Bestellungen =
  Order-IDs mit offenen/gesperrten Zeilen (netto Stueck > 0), interne = offene (Neu = offen, ohne zu schreiben; leere Summe = 0 + "n ohne
  Betrag"), "seit" = groesstes Zeitraum-Bis der Abrechnungen + 1 Tag, sonst Vertrag-ab. **Saldo nur ueber `saldoRechnung`** - dieselbe
  Funktion nutzen `/api/partner/saldo` und Abrechnung vorschau/erstellen (keine zweite Formel). Optionale Spalte `Saldo_Kachel` im Reiter
  Partner ("nein" blendet NUR die Kachel aus; Setup `scripts/setup-partner-saldo-kachel.js`, P-012 = nein). Frontend-Baustein Block
  `Partner-Kacheln: Anfang/Ende` wortgleich in partner.html und index.html (Test partner-kacheln.test.js); im Portal stehen die bisherigen
  Karten unveraendert unter "Details" (`#pv-details`).
- backend/utils/partner-token.js – Zugang der Partnerportale (PPS1), einzige Stelle fuer Pruefen/Erzeugen. Reiter `Partner` und
  `FP_Partner`: Spalte `Token_Hash` hinten = SHA-256 (hex); Pruefung `findeZeileZumToken` (Hash + `timingSafeEqual`, jede Zeile
  geprueft); Uebergang: ohne Hash gilt der Klartext `Token` (gehasht verglichen), mit Hash NUR der Hash. Der Link der Partner bleibt
  derselbe (`?token=`). Neue Tokens nur im Backend (`randomBytes(32)` base64url) ueber `lib/partnerLink.js`
  (`POST /api/kalkulation/partner/:id/link-neu`, `POST /api/festpreis/partner/:id/link-neu`): Hash schreiben, `Token` leeren, Link
  EINMAL an MC (Block `Partner-Link: Anfang/Ende`, `showConfirm`); PATCH mit `token` -> 400 `token_vom_browser`. MC bekommt den
  Klartext nur im Uebergang (`klartextFuerMc`, "Link kopieren"), nie den Hash. Bremse `middleware/tokenBremse.js` (20 Fehlversuche
  = 401 je IP / 15 min, gueltige zaehlen nie) vor `/api/partner` und `/api/festpreis-public`. Portale: Block `Portal-Token:
  Anfang/Ende` im `<head>` (wortgleich, vor dem Theme-Block) liest den Token, legt ihn in sessionStorage, entfernt ihn per
  `history.replaceState`; `<meta name="referrer" content="no-referrer">`. Umstellung `scripts/setup-partner-token-hash.js`
  (Trockenlauf; `--write` = Hashes; `--leeren --write` = Klartext leeren, nur wo der Hash schon passt; `--zurueck <sicherung>`;
  Sicherung vorher nach Documents/mc-sicherungen). Test partner-token.test.js.
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
  Status `processing`, `on-hold` (Vorkasse), `completed`; ohne `after` Start 14 Tage (TK1, vorher 3)
  vor dem juengsten Bestelldatum (`UEBERLAPPUNG_TAGE`). Bestandszeilen werden nie geaendert.
  Variantenmerkmal "Name - Nummer": Zerlegung am letzten " - "; ohne " - " (TS2) Zahl 1-3 Ziffern am Ende nach
  Leerzeichen = Nummer, Rest = Name (Platzhalter WUNSCHNAME bleibt notiz); Add-on/Kundennotiz unveraendert.
  Zeilen-ID des Syncs = `Order-ID|Order-Item-ID|Laufnummer` (keine fortlaufende Nummer). Den Startpunkt
  bestimmen NUR Shop-Zeilen (`istSyncZeilenId`, `shopBestelldaten`); ein Bestelldatum nach heute
  (Europe/Berlin) zaehlt nicht und steht als `hinweise` in der Antwort (Workflow ::warning::, Knopf-Toast).
  Handzeilen (TK1, intern/Telefon/Verein): ID `INT-JJJJ-NNNN` (Nummer vergibt der Inhaber), Quelle
  `intern`, Order-ID und Order-Item-ID leer; Bestelldatum als Text `JJJJ-MM-TT`; Kunde/Artikelnummer/
  Produktname/Groesse/Farbe/Name/Nummer/Stueck frei, Referenz in Rohtext; P–T wie immer, U leer. Sie
  zaehlen fuer Dedup (eigene ID) und werden nie angefasst. Merker: "+ Interne Trikotbestellung" kommt
  spaeter mit einem Trikot-Reiter in MC (Abbild des Sheets fuer den Wareneingang), noch nicht gebaut.
- backend/lib/trikotAnsicht.js – Ansicht "Trikots (JFN)" (TR2), Logik `utils/trikot-ansicht.js`. `GET /api/bestellen/trikots`
  NUR LESEN, nur Reiter `Trikots` im Business-Sheet, Spalten ueber den Namen, `Kunde` verlaesst das Backend nie.
  Gruppen: "noch nicht beim Produzenten" (Charge leer) oben, dann Chargen numerisch absteigend; je Charge "x von y da"
  und Bestellt_Am (TR5: kein Lieferdatum mehr; nur das Produzenten-Formular traegt D2 = +30 Tage).
  TR5: Antwort `bestellungen` = Stand je Order-ID (`bestellungStand`, eine Logik mit der Ansicht): Stufe nicht_bestellt >
  da > ersatz > teil > bestellt; je Kunden-Trikot gezaehlt (Ersatzzeile ueber ihr Original), Zeilen ohne Order-ID
  gehoeren zu keiner Bestellung. 60 s Zwischenspeicher (`CACHE_MS`), TR3-Eintragen und TR4-Wareneingang leeren ihn. Zaehlregel (Inhaber 30.10.): Status `ok` =
  geliefert; `ersetzt` = beim Produzenten da, beim Kunden nicht fertig, bis die Ersatzzeile `ok` hat. Ersatzzeile =
  eigene Zeile (`INT-…`, Quelle `ersatz`), optionale Spalte `Ersetzt` hinten = Zeilen-ID des Originals; fehlt sie, keine
  Verbindungen, kein Fehler. Kundenangabe = Zeilen aus `Rohtext`, nur Anzeige, nie nach Name/Nummer uebernommen.
  Hinweise (gelb, nur Anzeige): Name/Nummer leer, Charge ohne Bestellt_Am, `Ersetzt` unbekannt, ersetzt ohne Ersatzzeile,
  Zeilen-ID doppelt (dann wird keine Verbindung geraten).
  TR4: je Zeile `abhaken` ('setzen' = Charge da + Status UND Geliefert_Am leer; 'zurueck' = Status ok MIT Geliefert_Am;
  sonst '' - "ersetzt", andere Werte, "ok" von Hand ohne Datum, ohne Charge) und `bestellungKomplett` (alle Trikots der
  Order-ID beim Kunden fertig, Ersatzzeile zaehlt ueber ihr Original). Schreiben: `lib/trikotWareneingang.js`, Logik
  `utils/trikot-wareneingang.js`, `POST /api/bestellen/trikots/wareneingang` `{ richtung, auswahl:[{id,zeile,geliefertAm}] }`:
  NUR S (`ok`/leer) + R (Datumswert heute bzw. leer; fehlt das Datumsformat dd.mm.yyyy, nur Format setzen), Sperre je
  Instanz, frisch gelesen, Vorher-Zustand je Zeile (zurueck nur beim gesehenen Datum), sonst 409 ohne Schreiben; EIN
  batchUpdate RAW, ganzer Reiter zurueckgelesen.
- backend/lib/trikotFormular.js – Produzenten-Bestellung (TR3), Logik `utils/trikot-formular.js`, `exceljs` 4.4.0 (gepinnt).
  `POST /api/bestellen/trikots/formular/vorschau` (schreibt nichts), `.../datei` (.xlsx nur als Antwort, nirgends abgelegt),
  `.../eintragen` `{ auswahl:[{id,zeile}], charge }`. ITEM/MATERIAL/COLLAR NUR aus `Trikot_Artikel` (`Formular_Artikel`,
  `Formular_Material`, `Formular_Kragen`, `scripts/setup-trikot-formular-spalten.js`); Zuordnung Trikots.Produktname = Shop-Name
  der Produkt-ID (getWcClient, 10 min Cache), nicht die SKU; ohne Zuordnung gelb + 422. Formular wie das Muster: Blatt
  "Sheet1", A1-A5 Beschriftung (Wortlaut inkl. Leerzeichen), D1/D2 FESTES Datum (heute, +30, D:E verbunden), D3 Team,
  D4 `JJJJ/NN` (Jahr des Bestelltags Berlin), D5 NO; Zeile 7 Kopf gold, ab 8 je Trikot QUANTITY 1, Calibri 8, Rahmen bis
  249; Nummer als Text, Kindergroesse als Zahl. Reihenfolge Produkt (Zeilenfolge Trikot_Artikel), Groesse (Kinder cm,
  dann S->4XL), Nummer. Team/Saison/NO/30 Tage in `FORMULAR`. Nummer im Download vorlaeufig; Eintragen: Sperre je
  Instanz, frisch gelesen, Zeilen-ID gleich, P+Q leer, Charge = hoechste + 1 (sonst 409, nichts geschrieben); EIN
  batchUpdate RAW: P = Zahl, Q = Datumswert (Seriennummer, Format dd.mm.yyyy wie der Bestand; fehlt das Format, nur
  Format setzen); ganzer Reiter zurueckgelesen.
- backend/lib/lager.js – Lager (BO5-1), Logik `utils/lager.js`, Routen `routes/lager.js` (`/api/lager`, hinter requireApiKey).
  Modell A (Inhaber 30.10.): Journal `Lager_Buchungen` (SSOT; Buchung_ID `LB-JJJJ-NNNNN` | Datum | Art | Warenart | Schluessel |
  Menge ± | Ort | Grund | Bezug | Quelle | Notiz | Storno_von | Stand | Vorgang), Bestand = Summe je Schluessel + Ort, nur
  gerechnet, NIE ueberschrieben: Korrektur = Gegenbuchung (Art `korrektur`, `Storno_von`; Umlagerung beide Zeilen), Umlagerung =
  zwei Zeilen (Bezug gegenseitig). Nie negativ (Ausbuchen/Umlagern/Gegenbuchung gesperrt, 422); Zaehlung bucht nur die
  Differenz zum gezaehlten Stand (Art `inventur`, Quelle `inventur`), Startbestand = Art `inventur`, Quelle `start`. Nur
  Stueckzahlen. Schluessel: `LS:<ArticleNr>` · `WC:<WC_Variation_ID>` · `TR:<Produkt-ID>:<Groesse>` (beflockt nur in der
  Notiz, nie der Rueckenname) · `EX:<SKU_Extern.ArticleNr>` · `FREI:LA-NNNN` (`Lager_Artikel`). Orte nur aus `Lager_Orte`
  ("+ neuer Ort", eindeutig ohne Gross/Klein). Keine Reservierung, kein WooCommerce-Bestand, keine Personennamen.
  Schreiben: eine Sperre je Instanz (409 `laeuft_gerade`), frisch gelesen, EIN values.update ueber `schreibeNeueZeilen(...,
  { alt })` (lib/sheet-zeilen.js: der gelesene Stand gilt - andere Instanz dazwischen -> 409 `konflikt`), zurueckgelesen,
  alles oder nichts. Gleiche `vorgang`-Kennung = schon gebucht (Doppelklick), nichts doppelt. Bestand/Verlauf 60 s
  Zwischenspeicher, jede Buchung leert ihn; Stammdaten 5 min (Trikots aus dem Business-Sheet, nicht lesbar = Hinweis).
  Fehlen Reiter/Spalten -> 409 `einrichtung`. Einrichtung: `scripts/setup-lager-reiter.js` (Trockenlauf, `--write`, nur neue
  Reiter; `Produkt_Inventar` ist eine Artikelliste, kein Bestand). Noch nicht: Retouren (BO5-6).
- backend/lib/lagerEingang.js + utils/lager-eingang.js – Lager beim Wareneingang (BO5-4), nichts automatisch:
  "Ware angekommen" (lib/wareneingang.js `bucheEingangInSperre`) und "Karton angekommen" SIND die Bestaetigung - im selben
  `values.batchUpdate` (Korb + Paket + Lager, Korb- und Lager-Sperre) kommen ins Lager: Positionen mit `Lager_Ziel`
  (Art vorrat, Menge = Positionsmenge, je Position abwaehlbar `insLager: false`) und "mehr gekommen" (`auswahl[].mehr`,
  Art zugang_ueberschuss); Quelle wareneingang bzw. karton, Bezug = Korb-Schluessel, Grund "Wareneingang <order_id>"; je
  Korb-Schluessel nur ein offener Zugang; "zurück auf bestellt" gesperrt (409 `lager`), solange er offen ist.
  Eigene Knoepfe (nur Lager): `POST .../karton/ueberschuss` "Rest ins Lager"/"ins Lager" (PDF neu gelesen, Menge
  `lagerRestFuer` aus Ord. - nie Qty, Bezug `<order_id>:<Karton-ID>:<reference>:<sku>` - nie die Kundennummer) und
  `POST /api/bestellen/trikots/ins-lager` (Status ersetzt, `TR:<Produkt-ID>:<Groesse>`, Notiz nur "beflockt", Trikots nur
  gelesen). `Lager_Ziel` = optionale Spalte ganz hinten in `Warenkorb_LShop` (`KORB_OPTIONAL`, nur ueber den Namen;
  Setup `scripts/setup-korb-lager-ziel.js`), nur eigene Positionen, setzen im BO6-Dialog oder `POST .../lshop-korb/lager-ziel`
  (offen/bestellt). Ortsauswahl ueberall mit Wrist vorgewaehlt (`lagerOrtWaehlen`, Dialog `#lo-dialog`).
- Lager-Dialog BO5-7: Umlagern und Ausbuchen waehlen standardmaessig **aus dem Bestand** des gewaehlten Orts (`lagerAusBestand`,
  `lagerDlg.herkunft`; Umschalter `#lager-quelle` "aus Bestand wählen" / "Artikel suchen", Einbuchen immer ueber Stammdaten):
  Liste `lagerBestandAmOrt` (nur Menge > 0, Suche jedes Wort in Modell/Name/Farbe-Motiv/Groesse) im `#lager-raster`
  (Klasse `lager-best-liste`), "alles" je Zeile und Gruppe, "ganzen Ort umlagern …" mit Bestaetigung (`lagerGanzerOrt`).
  Abgangsart `abgang_ausschuss` (Ausschuss): Grund Pflicht aus `AUSSCHUSS_GRUENDE` (Fehldruck · Ware defekt · verschenkt)
  im Bezug, Freitext optional in Grund; Fehldrucke nie zurueck in den Bestand. `POSTEN_MAX` 300 (ganzer Ort in einem Schritt).
  BO5-5 Abgaenge: Bezug je Art (`bezugRegel`): `abgang_vorort` = offenes Event `EV-NNNN` aus `Lager_Events` (Event_ID |
  Name | Datum JJJJ-MM-TT | Ort | Status offen/… | Notiz; optional - fehlt der Reiter, nur Hinweis; `POST /api/lager/events`),
  `abgang_auftrag` = Freitext 2-80 ohne Klarnamen (spaeter die Auftragsnummer), `abgang_partner` = aktive P-ID aus Business-Reiter
  `Partner` (nur gelesen, 5 min) oder `Muster: <Empfaenger>`. Nach einem Event wird nur Verkauftes ausgebucht (keine Ruecknahme-
  Art; Fehler = Gegenbuchung). Sammelausbuchen: `posten[].ort` je Zeile (nur Aktion ausbuchen), nie negativ je Ort, ein
  Schreibaufruf. `GET /api/lager/abgaenge?art&bezug&von&bis` (`abgaengeAuswertung`: nur Abgangsarten inkl. abgang_eigen,
  Gegenbuchungen abgezogen, Tag Europe/Berlin). Fertigware-Suche: jedes Wort in Name/Artikelnummer/Kurzbezeichnung/Variantenwerten.
  Setup `--orte=Wrist,Itzehoe` legt nur fehlende Orte an (Trockenlauf ohne `--write`). Orte nie umbenennen (Text in Buchungen).
  BO5-6 Retoure (Zugangsart `retoure`): Bezug Pflicht `JFN:<Nr>` oder `HONK:<Nr>` (`retoureBestellung`), je Posten `bezug`
  `<Shop>:<Nr>:<line_item.id>`. `GET /api/lager/retoure?bestellung=` (`leseRetourePositionen`) liest die Bestellung NUR ueber
  `getWcClient(shop).get('orders/<nr>')` (404 -> 404), Groesse aus den Positions-Metadaten; Vorschlag `WC:<variation_id>` nur JFN
  (Varianten im Sheet = JFN-IDs), Trikot `TR:<Produkt-ID>:<Groesse>`, Positionsname bei Trikots = `parent_name` (der Variantenname
  traegt den Rueckennamen - nie an den Browser, nie ins Journal). `bucheLager` liest die Bestellung beim Buchen frisch
  (`retoureGrenzen`): nie mehr zurueck als bestellt je Position und je Bestellung, Gegenbuchungen abgezogen (`retourenMengen`,
  `retoureUeberGrenze`, 422 "bestellt X, schon Y zurückgebucht"). Defekt/Fehldruck wird nicht eingebucht (Ausschuss).
- backend/lib/lagerKorb.js – Lager im L-Shop-Warenkorb (BO5-3), Logik `utils/lager-korb.js`. MC schlaegt vor, der Inhaber
  bestaetigt; nichts automatisch, der Abgleich aendert nie einen Status. `GET .../lshop-korb` liefert je Buendel `lager`
  ({ summe, orte }) und je offener, nicht gesperrter Position `lager` ({ n, genug }) - NUR gleiche ArticleNr (LS:), in
  Positionsreihenfolge ohne Doppelverplanung (`korbVorschlaege`); Status `Lager` (Konstante STATUS.LAGER, gross, nicht
  umbenennen) steht seit BO5-3 in `KORB_SICHTBAR` (Filter "Aus Lager", `summen.lager`; "Alle"/`summen.positionen` bleibt
  offen + herausgenommen) mit `lagerAbgang`. Lager nicht lesbar -> Korb ohne Vorschlag + `lagerHinweis`.
  `POST .../lshop-korb/aus-lager` { schluessel, status, verteilung: [{ort, menge}] (hoechstens 2 Orte, Summe = Menge),
  vorgang } und `.../zurueck-aus-lager` { schluessel, vorgang }: unter Korb- UND Lager-Sperre, beide frisch gelesen,
  Zielstrecke im Journal ueber `pruefeZielStrecke` (lib/sheet-zeilen.js), dann EIN values.batchUpdate ueber beide Reiter
  (Korb Status/Grund leer/Status_Datum/Stand + neue Journal-Zeilen), beide zurueckgelesen. Abgang Art `abgang_shop` bzw.
  `abgang_eigen`, Quelle `korb`, Bezug = Korb-Schluessel; Rueckweg = Status offen + Gegenbuchung (`Storno_von`). Korb-
  Abgaenge sind im Lagerverlauf NICHT von Hand gegenbuchbar (sonst stimmt der Korb-Status nicht). Lager-Positionen gehen
  nie in EDI (Regel `vorhanden` = offen) oder Matrix/Zaehlliste (nur offen). Teilen (Lager deckt nur einen Teil) gibt es nicht.
  BO5-6 Storno: der Abgleich prueft auch Shop-Zeilen mit Status `Lager` (nur `LAGER_PRUEF_TAGE` 60 ab Status_Datum,
  `brauchtHinweisPruefung`) und schreibt NUR `Hinweis` (`hinweisFuerZeile`: storniert/erstattet/nicht mehr im Shop/Position weg/
  Menge; "abgeschlossen" und "unbezahlt" nicht). `POST .../lshop-korb/storno-zurueck-ins-lager` { schluessel, vorgang }
  (`stornoZurueckInsLager`, `stornoZurueckPlan`): nur Lager-Zeile MIT Hinweis (sonst 422), Gegenbuchung wie zurueck-aus-lager
  (Grund "Storno – zurück ins Lager") + Korb `abgewählt`, Grund `Bestellung storniert` (`STORNO_GRUND`), EIN batchUpdate.
  Storno nach Lieferung (Status geliefert) prueft der Abgleich nicht.
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
  LS4: Ein Lauf zur Zeit je Instanz (`mitStammdatenSperre`, sonst 409 `laeuft_gerade`), auch `/stammdaten`.
  `stammdatenLauf` kennt `zusatzModelle`, `beobachte` (je Dateizeile) und `vorSchreiben` (wirft = nichts
  geschrieben); Antwort `neuJeModell`. `Modelle_Zusatz`-Zeilen mit Status "zurückgezogen" zaehlen nicht als gebraucht.
- backend/lib/lshopModelle.js – Ansicht "L-Shop-Modelle" (LS4, Nicole), Logik `utils/lshop-modelle.js`. Sammelliste
  im Browser (localStorage `mc_lsm_liste`, nur Eingabe + Notiz) -> `POST /api/lshop/modelle/ampel` (nur Sheets:
  da / liste / zurueckgezogen / suchen) -> `.../pruefen` (EIN Stammdaten-Trockenlauf mit den Eingaben, Suche:
  CatalogNr exakt = gefunden; Hersteller-Nummer `CatNrManufacturer` (auch "3000/3099"), "endet auf", Name, aehnliche
  Nummer = Vorschlag, nie still uebernommen; Vorschau Name/Marke/Farben/Groessen/Auslauf, keine Preise) ->
  `.../uebernehmen` { auswahl, datei }: nur Nummern, die `modellAus` erkennt; schon vorhandene raus; Stammdaten-Lauf
  "uebernehmen" mit `vorSchreiben`: jedes Modell bringt neue Zeilen UND keine Fremdaenderung (geaendert/ausgelaufen/
  Name/neue Zeilen anderer Modelle) - sonst 409, nichts geschrieben (Inhaber: dann erst das Update in den Einstellungen).
  ERST DANACH `Modelle_Zusatz` (neue Zeilen ohne append ueber `lib/sheet-zeilen.js`, zurueckgezogene wieder aktiv),
  Chat `buildLShopModelleNachricht` (nur Modellnummern). `.../zurueckziehen` setzt nur `Status` = "zurückgezogen"
  (LShop_Modelle bleibt, Inhaber 28.10.), `GET .../liste`. Spalten `Notiz`, `Eingetragen`, `Status` hinten in
  `Modelle_Zusatz` (ohne Namen der Person): `scripts/setup-modelle-zusatz-spalten.js` (Trockenlauf, `--write`); fehlen
  sie, 409 `einrichtung` vor jedem Schreiben.
- backend/lib/sheet-zeilen.js – Zeilen ohne `values.append` schreiben (`schreibeNeueZeilen`, `ersetzeZeile`), gemeinsam
  fuer anlageHalloween.js (FM2) und lshopModelle.js (LS4).
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
  FM2 (Fanmeet BoysLove): Kollektionen `fanmeet-taynew` (zuerst) und `fanmeet-forcelove`, je 6 Artikel ohne
  Motiv-Achse, neue Unterkategorie "Fanmeet" (Slug `fanmeet`) unter 320 + feste 320 (`kategorieIdsZusatz`,
  `produktKategorien`); Struktur-Zeile der geloeschten 444 wird umgeschrieben (`strukturErsetzt`, `ersetzeZeile`),
  SEO_Hinweis 320 neu (`seoHinweiseNeu`), Kategoriebild = Bild des E3000-Artikels. Jede Anlage blendet die einzige
  Farbe vor (`default_attributes`, Ruecklesen `pruefeVorblendung`), Bild-ALT = Titel + Farbe (`bildTitel`).
  Preise `.preise-fanmeet.json` (gitignored). Sheets **ohne `values.append`**: `schreibeNeueZeilen` (erste freie
  Zeile, Nachbar + Zielbereich pruefen, `values.update` RAW, UNFORMATTED zuruecklesen) auch fuer Maske/Varianten.
  NEU1: `artikel.farben` = mehrere Farben je Artikel (gleiche Groessen je Farbe, sonst Stopp; ArticleNr je Farbe;
  KEINE Vorblendung, `pruefeVorblendung(…, null)` erwartet leer), Bild je Farbe (`artikel.bilder`, Variationsbild
  `farbBild`, Galerie in Farbreihenfolge); `artikel.kategorieIds`/`kategorienText` vor denen der Kollektion.
  Kollektionen `ucs-lebkuchen` (Sweater 293 + 685/684, `ki`: KI_SATZ nach dem SEO-Text, Vermerk in Motive "Offen" -
  nie Nur_intern, sonst meldet die Pruefung den KI-Satz) und `tt-fluffy` (P-002, Kat. 121, `motivAenderung` aendert
  die vorhandene Motive-Zeile TT-Logo, alter Inhalt geprueft). Partner_Artikel legt der Import/Abgleich an, nie das Skript.
  Preise `.preise-ucs-lebkuchen.json`, `.preise-tt-fluffy.json` (gitignored).
- backend/lib/kunden.js – Kundenstamm (AM-1), Logik `utils/kunden.js`, Routen `routes/kunden.js` (`/api/kunden`, hinter
  requireApiKey: GET /, POST /neu, /bearbeiten, /archivieren, /dsgvo-sperren). **Eigenes Google Sheet "Kunden"** (Secret
  `KUNDEN_SHEET_ID`, freigegeben fuer Inhaber, Nicole, Dienstkonto), getrennt vom SSOT; Reiter `Kunden`: Kunden_Nr (`K-NNNNN`,
  vergibt MC, hoechste + 1, nie wiederverwendet) | Lexoffice_Nr | Lexoffice_ID | Art (Firma/Verein/Person) | Name | Spitzname
  (mehrere mit ;) | Ansprechpartner | E-Mail | Telefon | Strasse | PLZ | Ort | Land | Notiz | Status (aktiv/archiviert/
  gesperrt-DSGVO) | Quelle (lexoffice/mc) | Angelegt | Stand. Setup `scripts/setup-kunden-reiter.js` (Trockenlauf, `--write`).
  Schreiben: Sperre je Instanz, frisch gelesen, kein append, `ersetzeZeile` bzw. `schreibeNeueZeilen`, `stand` wie gesehen
  (sonst 409 `konflikt`). Nie loeschen: Archivieren; DSGVO-Sperre leert Personenfelder, Name = "gelöscht K-NNNNN", Kunden_Nr und
  Lexoffice-ID bleiben (der Import befuellt gesperrte Zeilen nie wieder). **Nie Namen/Adressen/Mail/Telefon in Log, Chat,
  Fehlertext, Postfach, Tests** (nur Kunden_Nr und Zahlen). Backup: drittes Ziel `KUNDEN` in backup-daily.js.
  Import `scripts/kunden-import.js` (Trockenlauf Standard = nur Zahlen, `--write`): `importPlan` gleicht ueber Lexoffice_ID ab
  (Rueckfall Lexoffice_Nr bei Zeilen ohne ID), ueberschreibt nur `LEXOFFICE_FELDER`, nie Spitzname/Notiz/Status, Ansprechpartner nur wenn leer (`NUR_WENN_LEER`); Firma bleibt
  "Verein", wenn MC es so gesetzt hat; archivierte Lexware-Kontakte legen nichts an; mehrdeutig = nichts. `--nur-firmen`
  (Stand live): Firmen + schon uebernommene Personen werden abgeglichen, weitere Personen nie pauschal geholt.
  AM-1-1 einzeln: `POST /api/kunden/lexoffice-suche` { feld name|email|number, q } (Suchbegriff nie in Adresse/Log, eine
  Seite 25, `lexTreffer` mit "schon in MC" ueber ID bzw. Nr.) und `POST .../lexoffice-uebernehmen` { lexofficeId }
  (`uebernehmeAusLexoffice`: Kontakt frisch per GET, unter der Sperre ueber die ID geprueft - schon da = `schon: true`,
  gesperrt = 409; sonst eine Zeile wie der Import). `GET /api/kunden/zahlen` = nur Zahlen. EIN batchUpdate
  (geaenderte Zellen + neue Zeilen in gepruefter Zielstrecke), zurueckgelesen. Wiederholbar (Grundlage AM-5).
- backend/lib/auftraege.js – Auftraege (AM-2), Logik `utils/auftraege.js`, Routen `routes/auftraege.js` (`/api/auftraege`: GET /,
  POST /neu, /bearbeiten, /status, /position-fertig). Reiter im **SSOT** `Auftraege` (Auftrag_Nr `AU-JJJJ-NNNN`, Kunden_Nr, Kurztitel,
  Kanal, Status, Termin, je Schritt ein Datum, Notiz, Anfrage_ID, Lexoffice_Angebot/_Rechnung, Angelegt, Stand, hinten `Storniert_Am`,
  `Vorgang`) und `Auftrag_Positionen` (Position_ID `AU-…-NN`, Art lshop|frei, LShop_ArticleNr, Freitext, Menge, Motiv, Druck, Notiz,
  Korb_Schluessel/Lager_Ziel (AM-3), Fertig, Fertig_Am, Versendet, Stand, hinten `Entfernt`). **Nur Kunden_Nr, keine Personendaten,
  keine Preise.** Setup `scripts/setup-auftraege-reiter.js` (Trockenlauf, `--write`). Status Anfrage → Angebot → bestellt → in
  Produktion → fertig → übergeben → bezahlt (+ storniert): weiter setzt Datum, zurueck einen Schritt und leert es, bezahlt jederzeit
  (Vorkasse; bei "übergeben" -> bezahlt), storniert ueber Storniert_Am, zurueck auf den letzten Schritt mit Datum. Bis "Angebot" alles
  aenderbar, ab "bestellt" nur Notiz/Termin (409 `gesperrt`). Entfernte Positionen = `Entfernt` (nie loeschen). Schreiben: Sperre,
  beide Reiter frisch, Auftrag-`stand` wie gesehen (409 `konflikt`), EIN values.batchUpdate (Zellen + neue Zeilen in gepruefter
  Strecke), zurueckgelesen; Anlage mit `vorgang` (gleiche Kennung = schon angelegt). L-Shop-Nummern neu nur waehlbare (ohne
  ausgelaufen/3/6), bisherige bleiben. `GET /api/kunden/zahlen` haengt `auftraege` { offen, terminBald, fertigNichtBezahlt } an.
  AM-2-2: optionale Spalten hinten in Auftrag_Positionen `Herkunft` (bestellen | lager | vorhanden, leer = bestellen) + `Lager_Ort`
  (`POSITION_OPTIONAL`; Setup haengt sie an). Ohne Spalten: bestellen wie bisher, lager/vorhanden -> 409 `einrichtung`. Lagerort muss
  aktiv sein (`leseLager`, nur lesen) - der Auftrag bucht nie im Lager.
  AM-3: Status **Design** zwischen Angebot und bestellt (optionale Spalte `Design_Am`, ohne Spalte 409 `einrichtung`; ueberspringbar
  `ueberspringen: true` von Angebot -> bestellt, Leiste zeigt ihn dann grau; frei bearbeitbar bis Design). Uebergebene Positionen
  (`Korb_Schluessel` bzw. optionale Spalte `Lager_Buchung`) sind gesperrt (409 `uebergeben`, nur Motiv/Druck/Notiz). Lesen liefert je
  Position `korb` (`korbStand`: offen/herausgenommen/bestellt/bestätigt (AB)/geliefert/Lager), je Auftrag `ware` (`wareStand`, nur 🛒),
  `freiOffen`; Kachel `wartetAufWare`. **Automatisches "bestellt"** (`autoBestellt`/`setzeAutoBestellt`, nur nach vorn aus Anfrage/
  Angebot/Design, alle 🛒 im Korb >= bestellt + alle 📦 ausgebucht): beim Lesen (`GET /api/auftraege`) und nach dem stuendlichen
  Korb-Abgleich (`routes/intern.js`); Sperre belegt = still uebersprungen.
- backend/lib/auftragBereitstellen.js – Rohlinge eines Auftrags bereitstellen (AM-3), Logik `utils/auftrag-bereitstellen.js`.
  `POST /api/auftraege/bereitstellen/vorschau` (schreibt nichts), `.../bereitstellen` { auftragNr, stand, teilen, ortWahl, vorgang },
  `.../zuruecknehmen` { auftragNr, positionId, vorgang }. Unter Auftrags-, Korb- UND Lager-Sperre alle Reiter frisch (SSOT), EIN
  values.batchUpdate ueber Korb + Lager_Buchungen + Auftrag_Positionen + Auftraege, zurueckgelesen. 🛒 = eigene Korb-Zeile
  (`EIGEN:…`, **Referenz = AU-Nr.**, Notiz leer, Quelle_Lauf "Auftrag"); 📦 = `abgang_auftrag`, Bezug AU-Nr., Quelle `auftrag`, Notiz
  Position_ID, Bestand JETZT (nie negativ; zu wenig -> 409 `knapp`, `teilen` = was da ist + Rest als neue Position bestellen); ✓/frei
  nichts. Ort inaktiv -> 409 `ort` + Ortswahl. Bis einschliesslich "bestellt" (`kannBereitstellen`, spaeter auch Auftragsart AM-3a).
  Zuruecknehmen: Korb nur offen/abgewaehlt -> abgewaehlt, Grund "Auftrag geändert"; Lager -> Gegenbuchung (korrektur, Storno_von).
  Korb/Lager schuetzen Auftragszeilen: Korb-Bearbeiten gesperrt (`eigenGesperrtGrund`), kein "bei Ankunft ins Lager"
  (`lagerZielPlan`), keine manuelle Gegenbuchung (`planGegenbuchung`, Quelle auftrag). EDI-`reference` = AU-Nr. (Korb-Referenz).
- backend/utils/auftrag-preise.js – Preise je Auftrag (AM-5), einzige Rechen-Stelle; Frontend-Spiegel Block `Auftrag-Preise: Anfang/Ende`
  (Test auftrag-preise.test.js vergleicht beide). Eingabe NETTO, Rechnen in Cent, gerundet erst in der Anzeige (`euroText`). Spalten hinten
  optional: `Auftrag_Positionen` Preis_Netto | Aufpreis_Netto | Aufpreis_Ab | USt_Satz (leer = 19) | EK_Hand, `Auftraege` Rabatt ("10%" Text
  oder Betrag Zahl) | Angebot_Netto | Angebot_Brutto | Angebot_Stand | Zustaendig, `Aufgaben` Zustaendig. Betraege als ZAHL (RAW, `zellWert`
  in utils/auftraege.js). Preis je Gruppe (Modell+Farbe) auf allen Groessen, Aufpreis nur L-Shop ab Groesse (`aufpreisGilt`, gleiche Klasse,
  Vorbelegung 3XL), USt 19/7/0, Rabatt vor MwSt anteilig je Satz (`verteile`, Summe exakt). EK: `EK_Hand` vor L-Shop `10CartonsPrice` der
  ArticleNr (je Groesse, KEINE Mengenstaffel in der Quelle; Lager/vorhanden zaehlen mit); Rohertrag nur ueber Positionen mit Preis UND EK.
  Preise sind auch ab "bestellt" aenderbar (nur Preisfelder, `bearbeitenPlan`: Positionen sonst 409 `gesperrt`), storniert nie. Beim Wechsel
  auf "Angebot" (und Anlage als Angebot) haelt lib/auftraege.js netto/brutto nach Rabatt + Tag fest; `angebotAbweichung` -> "geändert seit
  Angebot", `POST /api/auftraege/angebot` aktualisiert. Fehlen Spalten: Lesen wie bisher (`spalten` in der Antwort), Schreiben 409.
  "Zuständig" (`ZUSTAENDIG` = Christian, Nicole; leer = niemand): `POST /api/auftraege/zustaendig` { nr AU-/AG-, zustaendig }, einfach
  ueberschreiben (Stand bleibt, kein Verlauf); Filter in Liste und "Offene To-dos" (To-dos nehmen das Merkmal ihres Bezugs).
  **Preise/EK nie in Korb, EDI, Log, Chat** (Test). Oberflaeche: Dialog "Preise (netto)" mit Rabatt + Live-Summe, Preiszeile je Gruppe
  (`auPreisZeileHtml`), Ansicht `auDetailPreise` (Summen, Angebotsstand, "Kalkulation zeigen" - am Handy zu), Liste "… € netto" (* = unvollstaendig).
- backend/utils/aufgaben.js – Aufgaben (AG) und To-dos (AM-4), Lesen/Schreiben in lib/auftraege.js (gleiche Sperre, ein Schreibaufruf,
  kein append, zurueckgelesen). **Eigene Reiter** im SSOT (Bericht AM-4 Punkt 0): `Aufgaben` (Aufgabe_Nr `AG-JJJJ-NNNN`, eigener
  Zaehler | Kurztitel | Notiz | Faellig | Status offen/in Arbeit/wartet/erledigt/verworfen | Fuer_Art kunde/partner/artikel/intern |
  Fuer K-…/P-…/Produkt-ID | Gehoert_Zu AU-… | Wartet_Auf | je Schritt ein Datum | Angelegt | Stand | Vorgang) und `Auftrag_Todos`
  (Todo_ID `<Bezug>-Tnn` | Bezug AU-/AG-Nr. | Text | Faellig | Erledigt ja | Erledigt_Am | Reihenfolge | Angelegt | Stand | Archiviert | Vorgang).
  Keine Kundenauftrags-Logik liest Aufgaben (darum kein gemeinsamer Reiter). Fehlen die Reiter, laeuft `GET /api/auftraege` wie bisher
  (`einrichtung: { aufgaben, todos }` false), Schreiben -> 409 `einrichtung`. Routen `POST /api/auftraege/aufgabe/{neu,bearbeiten,status}`,
  `.../todo/{neu,aendern,verschieben,archivieren}`. Status: weiter (nach "wartet" Pflicht `wartetAuf`, keine Personennamen), erledigt (direkt),
  zurueck (Schritte ohne Datum uebergangen, "wartet" leert Wartet_Auf), verwerfen / verwerfen_zurueck. To-dos aendern nie einen Status;
  Haken ohne Stand (Zielzustand), Text/Faelligkeit mit Stand; entfernen = `Archiviert`. "für Partner" gegen `ladePartner` (lib/lager.js,
  nur gelesen). **AG ist nie Korb-Referenz:** `eigeneZeile`/`eigenBearbeitenPlan` 422, EDI-Regel `reference` rot, `kannBereitstellen`
  false + `bereitstellenVorschau` 422 `aufgabe`. Kachel: `todosUeberfaellig` (nur offene Bezuege), `aufgabenOffen`. Backup: automatisch
  (backup-daily.js sichert alle Reiter des SSOT). Setup `scripts/setup-auftraege-reiter.js` legt beide Reiter an (Trockenlauf, `--write`).
- backend/lib/lexware.js – Lexware Office Public API (`https://api.lexware.io`), **NUR LESEN**, einzige Stelle mit Zugriff
  (Test kunden.test.js: nur `method: 'GET'`, kein anderer Ort nennt die URL). Heute nur `GET /v1/contacts?customer=true` (alle Seiten; AM-1-1 auch Suche `name`/`email`/`number`, eine Seite)
  und `GET /v1/contacts/{id}`,
  Paging (250, `last`/`totalPages`, max. 200 Seiten), Takt 600 ms (Limit 2/s), 429 -> Retry-After bzw. steigend warten,
  hoechstens 5 Mal. Schluessel Secret `LEXWARE_API_KEY` ueber `getSecret` (NICHT in SECRET_KEYS: Backend startet ohne ihn),
  nur Leserecht Kontakte, hoechstens 24 Monate gueltig. Fehlertexte: Pfad + Status, nie Antwortinhalt/Schluessel.
- backend/lib/bestellseite.js – Bestellseite per Token fuer Kunden (KS1), Logik `utils/bestellseite.js`. Inhaber 07.11.: fuer JEDEN Auftrag
  moeglich, Fanshop ist der erste Fall. Zwei Arten: `auftrag` (genau ein AU-…, Artikel = Gruppen Modell + Farbe der Positionen mit allen
  waehlbaren Groessen des Modells aus LShop_Modelle, Name = Motiv bzw. Kurztitel - nie L-Shop-Name/Marke/Modellnummer, ein Termin = Termin
  des Auftrags) und `dauer` (ein Kunde, Sortiment = Shop-Kategorie(n) mit Unterkategorien aus Struktur_Kategorien; die Maske fuehrt
  Kategorien als NAMEN, ein Name, den es auch ausserhalb gibt, zaehlt allein nicht (`sortimentNamen`); nur Status Shop "Veröffentlicht",
  aktive Varianten mit WC_Variation_ID; ohne L-Shop-Nr. auswaehlbar mit "noch zu besorgen"). SSOT-Reiter `Bestellseiten` (Zugang_ID BS-NNN |
  Art | Kunden_Nr | Auftrag_Nr | Partner_ID (nur Merkmal) | Token_Hash | Aktiv | Ablauf | Bestellschluss_Tage 4 | Empfohlen_Tage 7 |
  Sortiment | Hinweis | Angelegt | Stand | Design_Link_Zeigen | Vorgang), `Bestell_Termine` (BT-NNNN), `Bestell_Eintraege` (nur angelegt,
  beschrieben ab KS2), `Bestell_Bilder` (WC_ID | Art produkt/variante | Bild_URL | Status | Stand). Setup
  `scripts/setup-bestellseiten-reiter.js` (Trockenlauf, `--write`).
  **Token:** nur im Backend `randomBytes(32)` base64url, im Sheet NUR der SHA-256-Hash, Vergleich `timingSafeEqual` ueber alle Zeilen;
  Klartext einmal in der Antwort von `/neu` bzw. `/neuer-link`, nie Log/Fehlertext/Adresse. Ablauf = letzter gueltiger Tag (Berlin), Vorschlag
  dauer 30.06., auftrag Termin + 30. Je Auftrag bzw. Kunde (dauer) hoechstens ein nicht gesperrter Zugang.
  Oeffentlich `GET /api/bestellseite/zugang` (routes/bestellseite.js, VOR requireApiKey, hinter dem allgemeinen Limiter; Token nur
  `Authorization: Bearer`): 401 unbekannt, 403 gesperrt/abgelaufen (freundlicher Text), sonst `seitenAntwort` = FESTE Feldauswahl
  (`artikelFuerSeite`) - nie Preis, EK, L-Shop-Name, Kunden-/Partner-/Auftrag-Nr. Kein Limiter je Token (Inhaber), nur Fehlversuchs-Bremse je
  IP fuer 401 (20 / 15 min). Katalog 5 min je Zugang+Stand zwischengespeichert. Die Seite greift NIE in den Shop: Bilder nur aus
  `Bestell_Bilder`, gefuellt per MC-Knopf (`POST /api/bestellseiten/bilder`, nur veroeffentlichte Artikel der nicht gesperrten
  Dauer-Sortimente, getWcClient, nacheinander 2 s Takt, `products?include` + `products/<id>/variations` mit `_fields`, ganzer Reiter in
  EINEM values.update, vorher/nachher gelesen). Verwaltung `routes/bestellseiten.js` (`/api/bestellseiten`, hinter requireApiKey: GET /,
  /kategorien, POST /neu, /bearbeiten, /neuer-link, /bilder). KS-Dateien nennen nie die Reiter der Partner-Abrechnung (Quelltext-Test).
  Seite `frontend/bestellen.html` (GitHub Pages): Token im #-Teil, sofort `history.replaceState`, danach nur `sessionStorage` (`bs_token`),
  `no-referrer`, noindex, Hell/Dunkel (`bs_theme`), Bloecke `Bestellseite-Token` und `Bestellseite-Anzeige`.
  KS2 (07.11.) Eintragen: `lib/bestellEintraege.js`, Logik `utils/bestell-eintraege.js`. Oeffentlich (Bearer, Bremse = `baueTokenBremse()` aus
  middleware/tokenBremse.js mit eigenem Zaehler): `GET /eintraege?termin=`, `POST /termin` { datum, notiz } (nur Art dauer, Datum >= heute,
  gleiches Datum = vorhandener Termin), `POST /absenden` { termin, kuerzel, vorgang, positionen } (artikel {id,menge} | extra {freitext,menge,fuer} |
  trikot {produktId,groesse,name,nummer,wunsch}; 1-60 je Absenden, Menge 1-999, <= 500 offene je Termin; nur Groessen/Trikots aus dem Katalog des
  Zugangs; gleiche Vorgang-Kennung = schon gespeichert), `POST /aendern` / `/stornieren` { eintrag, stand, kuerzel, … } (jedes Kürzel bis
  "übernommen", Stand wie gesehen sonst 409, Groesse nur innerhalb derselben Karte, Vermerk `Geaendert_Von`, nie loeschen). Vergangener Termin =
  nur lesen; nach Bestellschluss erlaubt, `Nach_Schluss` = ja. Schreibt NUR Bestell_Termine/Bestell_Eintraege (gemeinsame `mitSperre`, kein
  append, zurueckgelesen). Chat nach jedem Absenden (`absendenNachricht`): nur Zugang, Anzahl, Termin-Datum - nie Kürzel/Namen/Texte.
  Bestell_Eintraege hinten `Groesse`, `Bezeichnung`, `Trikot_Produkt`, `Vorgang`, `Geaendert_Von` (EINTRAG_OPTIONAL), Bestell_Bilder hinten
  `Kategorien` (Setup). Katalog: Cache-Schluessel enthaelt den Bilder-Stand (Befund "ohne Bild" 07.11.); Bilder ueber das Jetpack-CDN klein
  (`bildGroesse`: fit=120 bzw. 600, nur Host i0-i3.wp.com), je Karte `gruppen` (Unterkategorie, ohne Wurzel) und Antwort `filter`; Trikots aus
  Trikot_Artikel, wenn ihre Shop-Kategorien (Bestell_Bilder.Kategorien, "Artikelliste aktualisieren" holt sie mit) im Sortiment liegen;
  Groessen wie TR6. Seite: Termin waehlen/"+ Termin", Kürzel (sessionStorage `bs_kuerzel`), Reiter Artikel (kompakte Zeilen, 60-px-Bild,
  antippen = Mengen-Raster) · Extra · Trikot, Sammelkorb + "Absenden", Liste je Termin mit ändern/stornieren; "nach Bestellschluss – ohne
  Garantie" orange. MC: im Dialog je Zugang "Einträge ansehen" (`GET /api/bestellseiten/:zugangId/eintraege`, nur lesen, Filter je Termin,
  `bsmEintraegeHtml`). Test bestell-eintraege.test.js.
  KS2-1: Bild je Farbkarte = erstes EIGENES Variationsbild (anders als das Hauptbild), sonst Hauptbild (Befund Babybody: erste Groesse trug noch
  das Hauptbild). "Artikelliste aktualisieren" meldet `bilderNeu` / `bilderUnveraendert` / `ohneBild` (MC `bsmBilderText`). Notiz je Position
  (alle Arten, <= 100, Spalte `Notiz` hinten in Bestell_Eintraege, im Raster eine Notiz fuer alle Groessen der Karte), sichtbar in Korb, Liste
  und MC, aenderbar bis "übernommen"; Datenschutz wie Rueckennamen, KS3 uebernimmt sie in die Notiz der Auftragsposition. Test bestellseite-ks21.test.js.
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
GOOGLE_DRIVE_BACKUP_MONTHLY_ID, GCHAT_WEBHOOK_URL, SCHEDULER_SA_EMAIL,
SCHEDULER_AUDIENCE, LSHOP_FTP_HOST, LSHOP_EDI_FTP_USER, LSHOP_EDI_FTP_PASS, KUNDEN_SHEET_ID

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

Zweiter Job `lshop-belege-abruf` (BO4b-1): `7,37 * * * *` Europe/Berlin, POST auf
`<BACKEND_URL>/api/intern/lshop-belege/abruf`, gleiches Dienstkonto, **gleiche Audience** wie CS1
(`SCHEDULER_AUDIENCE` = URL des Korb-Endpunkts; die Audience ist nur ein Sollwert), Versuchsfrist
300 s, keine Wiederholung (der naechste Takt holt nach). Lauf-ID `BA-<Zeit>`. FTP-Fehler sind 200;
nur echte Fehler (Sheets, 401, Zeitlimit) machen den Versuch rot -> Log-Alarm (Kanal Mission Control Chat).

Dritter Job `lshop-lieferbarkeit` (BO7-1): `47 * * * *` Europe/Berlin, POST auf
`<BACKEND_URL>/api/intern/lshop-lieferbarkeit/abruf`, gleiches Dienstkonto, gleiche Audience wie CS1, Versuchsfrist 300 s,
keine Wiederholung. FTP-Fehler sind 200; rot erst, wenn der letzte Stand aelter als 6 h ist (oder Sheets/401/Zeitlimit).

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
Seit FM2 dort auch Regel 8 `KNAPPHEIT` (Druck/Knappheit als Muster: "solange … da ist", "bevor andere",
"zuschlagen", "jetzt … sichern", "nur noch", "begrenzt", "limitiert" - Druck auf Bestellung) und Regel 9
"Faserangabe unvollständig" (Prozent-Faser im Text, aber nicht jede Faser der Artikel-Faserangabe genannt;
Faser aus `strukturiert` der Generierung, beim SEO-Reiter aus LShop_Modelle ueber `lshopNr` als `grundFaser` (ohne die
Farb-Ausnahmen in Klammern, sonst 340 Fehlalarme im Bestand); reine Stoffe nie). Regel 8 meldet kein Fundwort, das im
Produktnamen steht (Motivtitel "Rentier war ausverkauft"). Scan 28.10. ueber 569 Artikel: R8 7 Treffer, R9 1.
SG1 (07.11.): Regel 10 "Zeitbezug" (`ZEITBEZUG`, `zeitJahre`): "dieses Jahr", "diesen Winter", "diese Saison", "heuer", "naechstes/letztes
Jahr …" und Jahreszahlen 20xx - ausser im Produkt- oder Kategorienamen (`kategorien` geht in Generierung und `text-pruefung` mit), hinter
"Kollektion" oder als Saisonname "2026/2027" bzw. "2026/27". Scan 07.11. ueber 624 Artikel (JFN + HONK): 10 Jahreszahlen, davon 2 echt,
keine Wendung; R8 1, R9 1. F2-Faser-Hinweis (`FASER_FEHLT_HINWEIS`) nur bei Textil: Groessen-Achse ODER Material-Zeile mit Faser/Stoff
(`TEXTIL_WORT_RE`) - "Material: Glas" (Christbaumkugel) bleibt still. Reiter SEO-Daten: "Beschreibung generieren" direkt unter
"Eigenschaften" (`.seo-generieren-zeile`, Kurzzeile `#seo-generate-msg` = `seoGenerierenKurz`), "SEO Speichern" mit allen Meldungen unten.
Leere Fokus-Keyphrase: `POST /api/seo/meta-eingaben` liefert mit `produktname` den Rueckfall `keyphraseAusTitel` (= `hauptKeyword`,
Produkttitel ohne Farbe/Groesse); SEO-Titel/Meta bauen daraus (`seoKeyphraseEffektiv`, markiert "aus Produkttitel"), nach dem Generieren
bzw. beim Speichern (nach dem Beschreibungs-PUT, vor Sheet/Yoast) steht er sichtbar im Feld (`seoKeyphraseAusTitelSetzen`, Pruefung gegen
SEO_Karte ueber "change"). SE1 (SEO-Daten aendern) unveraendert. Test seo-sg1.test.js.

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
