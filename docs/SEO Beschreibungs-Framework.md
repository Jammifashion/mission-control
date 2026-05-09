# SEO Beschreibungs-Framework – Jammifashion
**Version:** 1.0
**Stand:** Mai 2026
**Gilt für:** jammifashion.de (JFN) + honkshop.de (HKP)

---

## Rechtliche Pflichtangaben (Deutschland, 2026)

### Textilkennzeichnung (EU-Verordnung Nr. 1007/2011)
- **Faserzusammensetzung MUSS** gut sichtbar auf der Produktseite stehen – VOR dem Kaufabschluss
- Nur offizielle Faserbezeichnungen aus Anhang I der Verordnung erlaubt (z.B. "Baumwolle", "Polyester", nicht "Bio-Cotton" als Pflichtangabe)
- Prozentangaben erforderlich (z.B. "100% Polyester" oder "60% Baumwolle, 40% Polyester")
- **Urteil LG Kassel 27.03.2025 (Az.: 11 O 695/24):** Fehlende Faserangaben = Abmahnrisiko + Unterlassungsurteil
- Nicht erst im Paket, nicht versteckt hinter Klicks, nicht nur auf der Rechnung

### Weitere Pflichtangaben Textilien Online
- Pflegehinweise (empfohlen, teils Pflicht bei bestimmten Produkten)
- Herkunftsland (wenn für Kaufentscheidung relevant)
- Konfektionsgröße / Größentabelle (empfohlen, reduziert Retouren)

### KEIN Abmahnrisiko durch:
- Marketingsprache in der Beschreibung (solange keine falschen Tatsachen)
- Emojis oder informelle Sprache
- Fehlende Meta-Description (SEO-Verlust, aber kein Rechtsverstoß)

---

## Optimaler Beschreibungsaufbau (SEO 2026)

### Kurzbeschreibung (Short Description)
**Anzeige:** Direkt unter Produkttitel im WooCommerce Shop + Google Shopping Snippet
**Länge:** 2-3 Sätze, 120-160 Zeichen optimal
**Struktur:**
```
[Hauptkeyword] + [USP/Besonderheit]. [Zielgruppe/Verwendungszweck]. [CTA]
```
**Beispiel:**
> Hochwertiges Badminton Trikot mit individuellem DTF-Druck. Perfekt für Vereine und Teams – in deinen Vereinsfarben bestellbar. Jetzt konfigurieren!

**Regeln:**
- Hauptkeyword im ersten Satz (z.B. "Badminton Trikot", "Vereinspullover bedruckt")
- Kein Keyword-Stuffing
- Aktiv formuliert, nicht passiv

---

### Produktbeschreibung (Full Description)

#### Block 1 – Emotionaler Einstieg (2-3 Sätze)
- Zielgruppenansprache (Verein, Team, Künstler, Merch)
- Verwendungszweck und Emotion
- Unique Selling Point

**Beispiel:**
> Euer Team verdient ein Trikot, das genauso stark aufstellt wie ihr. Das Badminton Trikot von Jammifashion verbindet sportliche Passform mit hochwertigem Direktdruck – für Mannschaften, die Auftritt und Funktion vereinen wollen.

---

#### Block 2 – Produktdetails (Pflicht + SEO)
Als strukturierte Liste – muss Pflichtangaben enthalten:

```
📐 Passform: Regular Fit / Slim Fit / Oversized
🎨 Farben: [verfügbare Farben aus Varianten]
📏 Größen: XS – 3XL
🧵 Material: [z.B. 100% Polyester | 60% Baumwolle, 40% Polyester]
🖨️ Drucktechnik: DTF-Druck (Direct-to-Film) / Siebdruck
🌡️ Pflege: Schonwaschgang 30°C, nicht trocknergeeignet
🏭 Hergestellt in: [Herkunftsland wenn bekannt]
```

**Wichtig:** Material-Zeile ist RECHTSPFLICHT – darf nie fehlen.

---

#### Block 3 – SEO-Fließtext (100-150 Wörter)
- 1 Hauptkeyword + 2-3 Longtail-Keywords natürlich eingebaut
- Einzigartiger Text (kein Herstellertext, kein Duplicate Content)
- Informativ + emotional
- Zielgruppe direkt ansprechen

**Keyword-Strategie für Jammifashion:**
| Produkttyp | Hauptkeyword | Longtails |
|---|---|---|
| Trikots | "[Sport] Trikot bedruckt" | "Vereinstrikot individuell", "[Sport] Shirt Druck" |
| Hoodies | "Hoodie bedrucken lassen" | "Vereinshoodie", "Merch Hoodie individuell" |
| T-Shirts | "T-Shirt Druck individuell" | "Vereinsshirt", "Band Merch T-Shirt" |
| Pullis | "Pullover bedruckt" | "Vereinspulli", "Sweatshirt Druck" |

---

#### Block 4 – Abschluss / CTA (optional, 1-2 Sätze)
> Alle Produkte werden nach Bestellung gefertigt. Bei Fragen zur Individualisierung stehen wir gerne zur Verfügung.

---

## Gemini Flash Prompt (für SEO-Generator in Mission Control)

### System Prompt
```
Du bist ein SEO-Texter für den deutschen Online-Shop jammifashion.de, 
der individuell bedruckte Textilien für Vereine, Teams und Künstler verkauft.

WICHTIGE REGELN:
1. Schreibe immer auf Deutsch
2. Ton: professionell aber nahbar, sportlich-modern
3. KEIN Keyword-Stuffing
4. Beschreibungen müssen einzigartig sein (kein Herstellertext)
5. Faserzusammensetzung MUSS als Pflichtangabe enthalten sein (EU-Textilkennzeichnungsverordnung)
6. Wenn Material unbekannt: Platzhalter "[Material: bitte ergänzen]" setzen
7. Antworte NUR mit dem JSON-Objekt, ohne Präambel oder Markdown-Codeblock
```

### User Prompt Template
```
Erstelle SEO-optimierte Produktbeschreibungen für folgenden Artikel:

PRODUKTDATEN:
- Produktname: {produktname}
- Kategorie: {kategorie}
- L-Shop Artikelnummer: {lshop_nr}
- Verfügbare Größen: {groessen}
- Verfügbare Farben: {farben}
- Material: {material} (PFLICHTANGABE - wenn unbekannt: "[Material: bitte ergänzen]")
- Drucktechnik: {drucktechnik}
- Zielgruppe: {zielgruppe}

EIGENE HINWEISE / IDEEN:
{eigene_hinweise}

Erstelle folgende Texte und antworte NUR mit diesem JSON:
{
  "kurzbeschreibung": "2-3 Sätze, 120-160 Zeichen, Hauptkeyword im ersten Satz, CTA am Ende",
  "produktbeschreibung": "HTML-formatiert mit 4 Blöcken: 1) Emotionaler Einstieg (2-3 Sätze) 2) Produktdetails als <ul>-Liste mit Material als PFLICHTANGABE 3) SEO-Fließtext 100-150 Wörter mit Longtail-Keywords 4) kurzer CTA-Abschluss"
}
```

---

## UI-Änderungen SEO-Flow (Mission Control)

### Entfernen:
- ❌ L-Shop Link Eingabefeld (war für Web-Scraping – zu teuer, raus)

### Ändern:
- ✅ "Eigene Ideen / Hinweise" Feld → ÜBER Kurzbeschreibung und Produktbeschreibung platzieren
- ✅ Reihenfolge: Hinweise → KI generiert → Ergebnis in Kurz- + Langbeschreibung

### Modell-Empfehlung:
- **Primär:** `gemini-2.5-flash` (günstig, schnell, gut für strukturierten Output)
- **Fallback:** `claude-sonnet-4-6` (falls Gemini nicht verfügbar)

---

## Qualitätskriterien für generierte Beschreibungen

### Kurzbeschreibung ✓ wenn:
- [ ] Hauptkeyword in ersten 10 Wörtern
- [ ] 120-160 Zeichen
- [ ] CTA enthalten
- [ ] Kein Keyword-Stuffing

### Produktbeschreibung ✓ wenn:
- [ ] Material-Angabe vorhanden (oder Platzhalter)
- [ ] Mindestens 1 Longtail-Keyword
- [ ] 4 Blöcke vorhanden
- [ ] Kein Herstellertext / kein Duplicate Content
- [ ] HTML valide (<ul>, <li>, <strong>, <p>)
- [ ] 150-300 Wörter gesamt

---

## Bekannte Produktkategorien Jammifashion

| Kategorie | Typische Keywords | Zielgruppe |
|---|---|---|
| Badminton | "Badminton Trikot", "Federball Shirt" | Vereine, Teams |
| Fußball | "Fußball Trikot bedruckt", "Vereinstrikot" | Vereine, Jugendteams |
| Handball | "Handball Trikot", "Handballer Shirt" | Vereine |
| Merch | "Band Merch", "Künstler Merchandise" | Künstler, Bands |
| Allgemein | "Shirt bedrucken", "Hoodie individuell" | Endkunden |

---

*Dokument wird bei Prompt-Optimierungen aktualisiert.*
*Nächste Überprüfung: nach 50 generierten Beschreibungen (A/B-Test Ergebnisse)*
```
