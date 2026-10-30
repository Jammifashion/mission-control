import { Router } from 'express';
import {
  runKorbAbgleich, leseKorb, setzeStatus, sucheLShopModelle, lshopModellVarianten, legeEigenePositionAn, legeEigenePositionenAn,
} from '../lib/lshopKorb.js';
import { notifyFehler } from '../lib/chatNotify.js';
import { ediVorschau, ediErzeugen, ediAlsGesendet, ediSendenVorschau, ediSenden, ediZurueckAufEntwurf } from '../lib/lshopEdi.js';
import { leseLShopBestellungen } from '../lib/lshopBestellungen.js';
import { leseTrikotAnsicht } from '../lib/trikotAnsicht.js';
import { formularVorschau, formularDatei, alsBestelltEintragen } from '../lib/trikotFormular.js';
import { trikotWareneingang } from '../lib/trikotWareneingang.js';
import { wareneingangBuchen, wareneingangZurueck } from '../lib/wareneingang.js';
import { kartonPruefen, kartonAngekommen } from '../lib/karton.js';
import { leseProduktionStand } from '../lib/produktionStand.js';

const router = Router();

// ── POST /api/bestellen/lshop-korb/abgleich  (hinter requireApiKey) ──────────
// Body optional: { dryRun: true|false, quelle: "knopf"|"workflow", laufId }
// Aufrufer: Knopf "Abgleich jetzt" und .github/workflows/lshop-korb-abgleich.yml (von Hand);
// stuendlich ruft Cloud Scheduler routes/intern.js auf (CS1, OIDC statt API-Key).
// Fehler sind laut: Chat-Meldung (gedrosselt 1/h je Art), dann der Fehlerhandler.
router.post('/lshop-korb/abgleich', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const r = await runKorbAbgleich({ dryRun: body.dryRun ?? false, quelle: body.quelle, laufId: body.laufId });
    console.log(
      `L-Shop-Korb-Abgleich ${r.lauf}${r.dryRun ? ' (DRY RUN)' : ''}: vorhanden=${r.vorhanden} ` +
      `shops=${JSON.stringify(r.shops)} geschrieben=${JSON.stringify(r.schreiben)}`
    );
    res.json(r);
  } catch (err) {
    // Hoster-Pruefseite meldet ihre eigene Middleware; 409 (laeuft schon / Zielzeilen belegt) ist kein Ausfall.
    if (err?.code !== 'hoster_pruefseite' && (err?.status ?? 500) >= 500) {
      await notifyFehler({ art: 'L-Shop-Korb-Abgleich', status: err?.status ?? 500, text: err?.message });
    }
    next(err);
  }
});

// ── POST /api/bestellen/lshop-korb/status  (BO3) ─────────────────────────────
// Body: { auswahl: [{ schluessel, status }], ziel: "abgewählt"|"offen", grund, notiz }
// status = was der Browser gesehen hat; weicht die Zeile ab -> 409, nichts geschrieben.
router.post('/lshop-korb/status', async (req, res, next) => {
  try {
    const { auswahl, ziel, grund, notiz } = req.body ?? {};
    const r = await setzeStatus({ auswahl, ziel, grund, notiz });
    console.log(`L-Shop-Korb Status -> ${r.ziel}: ${r.geaendert} Position(en)`);
    res.json(r);
  } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-korb/modelle?q=  (BO3, Auswahl eigene Position) ──
// Eine Suchzeile ueber LShop_Modelle: ArticleNr, Modell, L-Shop-Name, Hersteller.
router.get('/lshop-korb/modelle', async (req, res, next) => {
  try { res.json(await sucheLShopModelle({ q: req.query.q })); } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-korb/modelle/:catalogNr/varianten  (BO3) ────────
router.get('/lshop-korb/modelle/:catalogNr/varianten', async (req, res, next) => {
  try { res.json(await lshopModellVarianten({ catalogNr: req.params.catalogNr })); } catch (err) { next(err); }
});

// ── POST /api/bestellen/lshop-korb/eigen  (BO3) ──────────────────────────────
// Body: { articleNr, menge, referenz, notiz }. SSOT-ID bleibt leer; Nummer EIGEN:<Jahr>-NNNN vergibt der Server.
router.post('/lshop-korb/eigen', async (req, res, next) => {
  try {
    const r = await legeEigenePositionAn({ eingabe: req.body ?? {} });
    console.log(`L-Shop-Korb eigene Position ${r.schluessel} (Zeile ${r.zeile})`);
    res.json(r);
  } catch (err) { next(err); }
});

// ── POST /api/bestellen/lshop-korb/eigen/mehrere  (BO6) ──────────────────────
// Body: { positionen: [{ articleNr, menge }], referenz, notiz }. Groessenraster: je Groesse mit Menge > 0 eine Zeile,
// alle mit derselben Referenz; alles oder nichts unter der Korb-Sperre, ohne values.append, zurueckgelesen.
router.post('/lshop-korb/eigen/mehrere', async (req, res, next) => {
  try {
    const r = await legeEigenePositionenAn({ eingabe: req.body ?? {} });
    console.log(`L-Shop-Korb eigene Positionen ${r.schluessel[0]}..${r.schluessel[r.schluessel.length - 1]} (${r.positionen}, ab Zeile ${r.startZeile})`);
    res.json(r);
  } catch (err) { next(err); }
});

// ── POST /api/bestellen/lshop-korb/edi/vorschau  (BO4a) ──────────────────────
// ── POST /api/bestellen/lshop-korb/edi/erzeugen  (BO4a) ──────────────────────
// Body: { auswahl: [{ schluessel, status }], commission, versandart }. Erzeugt nur die EDI-Datei fuer
// den Browser (Vorschau/Download) - es gibt hier keinen Versand an L-Shop. Vorschau schreibt nichts;
// Erzeugen vergibt die order_id und schreibt eine Protokollzeile. Pruefbericht rot -> 422 + pruefung.
// versandart fehlt -> Vorgabe aus Config (BO4e).
router.post('/lshop-korb/edi/vorschau', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.json(await ediVorschau({ auswahl: b.auswahl, commission: b.commission, versandart: b.versandart }));
  } catch (err) { next(err); }
});

router.post('/lshop-korb/edi/erzeugen', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const r = await ediErzeugen({ auswahl: b.auswahl, commission: b.commission, versandart: b.versandart });
    console.log(`EDI-Datei erzeugt: ${r.orderId} (${r.items.length} Positionen, ${r.stueck} Stueck, Protokollzeile ${r.protokollZeile})`);
    res.json(r);
  } catch (err) {
    if (err?.status === 422 && err.pruefung) return res.status(422).json({ error: err.message, pruefung: err.pruefung });
    next(err);
  }
});

// ── POST /api/bestellen/lshop-korb/edi/gesendet  (BO4e) ──────────────────────
// Body: { orderId }. Markiert einen Entwurf als gesendet (von Hand in ORDER gelegt): EDI-Status + Korb-
// Positionen in einem Schreibaufruf. Keine Uebertragung an L-Shop. Position nicht offen -> 422 + probleme.
router.post('/lshop-korb/edi/gesendet', async (req, res, next) => {
  try {
    const r = await ediAlsGesendet({ orderId: req.body?.orderId });
    console.log(`EDI-Datei als gesendet markiert: ${r.orderId} (${r.positionen} Positionen)`);
    res.json(r);
  } catch (err) {
    if (err?.status === 422 && err.probleme) return res.status(422).json({ error: err.message, probleme: err.probleme });
    next(err);
  }
});

// ── BO4c: an L-Shop senden ───────────────────────────────────────────────────
// POST .../edi/senden/vorschau { orderId }: Pruefbericht, Netto, Staffel fuer den Dialog (schreibt nichts).
// POST .../edi/senden { orderId }: EINMAL nach ORDER hochladen, dann Status/Korb (lib/lshopEdi.js ediSenden).
//   422 + pruefung (rot) · 409 (Status/Doppelklick) · 502 + ergebnis "nicht-da"/"unklar" · 500 + ergebnis "sheet".
// POST .../edi/zurueck { orderId }: "unklar"/haengend -> Entwurf. Nie Preise ins Log.
router.post('/lshop-korb/edi/senden/vorschau', async (req, res, next) => {
  try {
    res.json(await ediSendenVorschau({ orderId: req.body?.orderId }));
  } catch (err) { next(err); }
});

router.post('/lshop-korb/edi/senden', async (req, res, next) => {
  try {
    const r = await ediSenden({ orderId: req.body?.orderId });
    console.log(`EDI-Datei an L-Shop gesendet: ${r.orderId} (${r.positionen} Positionen, ${r.stueck} Stueck, ${r.ergebnis})`);
    res.json(r);
  } catch (err) {
    if (err?.status === 422 && err.pruefung) return res.status(422).json({ error: err.message, pruefung: err.pruefung });
    if (err?.ergebnis) {
      console.error(`EDI-Senden ${String(req.body?.orderId ?? '').slice(0, 20)}: ${err.ergebnis}`);
      return res.status(err.status ?? 502).json({ error: err.message, ergebnis: err.ergebnis });
    }
    next(err);
  }
});

router.post('/lshop-korb/edi/zurueck', async (req, res, next) => {
  try {
    res.json(await ediZurueckAufEntwurf({ orderId: req.body?.orderId }));
  } catch (err) { next(err); }
});

// ── BO4b-5: Wareneingang ─────────────────────────────────────────────────────
// POST .../wareneingang { orderId, auswahl: [{schluessel, status}] }: "Ware angekommen" (von Hand), nur
// bestellt -> geliefert, Wareneingang am Paket bei genau einem Paket. POST .../wareneingang/zurueck: Rueckweg.
// 422/409 + probleme, nichts geschrieben. Schreibweg lib/wareneingang.js.
for (const [pfad, fn] of [['/lshop-korb/wareneingang', wareneingangBuchen], ['/lshop-korb/wareneingang/zurueck', wareneingangZurueck]]) {
  router.post(pfad, async (req, res, next) => {
    try {
      const r = await fn({ orderId: req.body?.orderId, auswahl: req.body?.auswahl });
      console.log(`Wareneingang ${r.status}: ${r.orderId} (${r.positionen} Position(en)${r.paket ? `, ${r.paket}` : ''})`);
      res.json(r);
    } catch (err) {
      if ((err?.status === 422 || err?.status === 409) && err.probleme) return res.status(err.status).json({ error: err.message, probleme: err.probleme });
      next(err);
    }
  });
}

// ── BO4b-5 Schritt 2: Karton-Scan ────────────────────────────────────────────
// POST .../karton/pruefen { link }: Karton-PDF lesen und gegen den Korb abgleichen, schreibt nichts.
// POST .../karton/angekommen { link, auswahl }: PDF erneut lesen, archivieren, bestellt -> geliefert, LShop_Kartons.
// ⚠️ link (mit Kundennummer) nie loggen und nie zurueckgeben - im Log nur Karton-ID und order_id.
router.post('/lshop-korb/karton/pruefen', async (req, res, next) => {
  try {
    const r = await kartonPruefen({ link: req.body?.link });
    console.log(`Karton geprueft: ${r.kartonId} -> ${r.orderId || 'ohne order_id'} (${r.ampel})`);
    res.json(r);
  } catch (err) { next(err); }
});
router.post('/lshop-korb/karton/angekommen', async (req, res, next) => {
  try {
    const r = await kartonAngekommen({ link: req.body?.link, auswahl: req.body?.auswahl });
    console.log(`Karton angekommen: ${r.kartonId} -> ${r.orderId} (${r.positionen} Position(en), Archiv ${r.archiv}${r.paket ? `, ${r.paket}` : ''})`);
    res.json(r);
  } catch (err) {
    if ((err?.status === 422 || err?.status === 409) && err.probleme) return res.status(err.status).json({ error: err.message, probleme: err.probleme });
    next(err);
  }
});

// ── GET /api/bestellen/lshop-korb?shop=jfn|honk[&mit=bestelldatum] ───────────
// Liest NUR den Reiter Warenkorb_LShop, gebuendelt nach LShop_ArticleNr, ohne Kundennamen.
// BO3c: mit=bestelldatum liest zusaetzlich das Bestelldatum (nur der Tag) der offenen
// Shop-Positionen aus WooCommerce - fuer "Gruppieren nach Dringlichkeit".
router.get('/lshop-korb', async (req, res, next) => {
  try {
    res.json(await leseKorb({ shop: req.query.shop, mit: req.query.mit }));
  } catch (err) { next(err); }
});

// ── GET /api/bestellen/lshop-bestellungen?shop=  (BO4d) ──────────────────────
// Unterreiter "L-Shop-Bestellungen": je EDI-Bestellung (ab "gesendet") Kopf, Status, Positionen,
// Lieferscheine mit Paketen/Tracking; dazu Portal-Sendungen. Nur lesen, nur Sheets, nur JFN.
router.get('/lshop-bestellungen', async (req, res, next) => {
  try {
    res.json(await leseLShopBestellungen({ shop: req.query.shop }));
  } catch (err) { next(err); }
});

// ── GET /api/bestellen/trikots  (TR2) ─────────────────────────────────────────
// Unterreiter "Trikots (JFN)": Reiter "Trikots" gruppiert nach Produzenten-Bestellung (Charge), oben
// "noch nicht beim Produzenten", je Charge "x von y da". Nur lesen, nur Sheets, ohne Kundennamen.
router.get('/trikots', async (req, res, next) => {
  try {
    res.json(await leseTrikotAnsicht());
  } catch (err) { next(err); }
});

// ── POST /api/bestellen/trikots/wareneingang  (TR4) ─────────────────────────
// Body { richtung: 'setzen'|'zurueck', auswahl: [{ id, zeile, geliefertAm }] }. Haken "da": NUR Status (S) = ok
// und Geliefert_Am (R) = heute bei leeren Zellen; zurueck nur beim gesehenen Haken-Stand. 409 + probleme, nichts geschrieben.
router.post('/trikots/wareneingang', async (req, res, next) => {
  try {
    res.json(await trikotWareneingang({ richtung: req.body?.richtung, auswahl: req.body?.auswahl }));
  } catch (err) {
    if (err?.status === 409 && (err.probleme || err.code)) return res.status(409).json({ error: err.message, probleme: err.probleme ?? [], code: err.code });
    next(err);
  }
});

// ── POST /api/bestellen/trikots/formular/*  (TR3) ────────────────────────────
// Produzenten-Bestellung: Vorschau (schreibt nichts), .xlsx nur als Antwort (nirgends abgelegt), Eintragen
// NUR Charge + Bestellt_Am der gewaehlten Zeilen (leere Zellen, Nummer frei, zurueckgelesen).
router.post('/trikots/formular/vorschau', async (req, res, next) => {
  try {
    res.json(await formularVorschau({ auswahl: req.body?.auswahl }));
  } catch (err) { next(err); }
});
router.post('/trikots/formular/datei', async (req, res, next) => {
  try {
    const { dateiname, buffer } = await formularDatei({ auswahl: req.body?.auswahl });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${dateiname.replace(/[^\w. -]/g, '_')}"`,
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (err) {
    if ((err?.status === 422 || err?.status === 409) && (err.probleme || err.code)) return res.status(err.status).json({ error: err.message, probleme: err.probleme ?? [], code: err.code });
    next(err);
  }
});
router.post('/trikots/formular/eintragen', async (req, res, next) => {
  try {
    res.json(await alsBestelltEintragen({ auswahl: req.body?.auswahl, charge: req.body?.charge }));
  } catch (err) {
    if ((err?.status === 422 || err?.status === 409) && (err.probleme || err.code)) return res.status(err.status).json({ error: err.message, probleme: err.probleme ?? [], code: err.code });
    next(err);
  }
});

// ── POST /api/bestellen/produktion/stand?shop=  (PS1) ────────────────────────
// Bestellansicht "Bestellungen (JFN)": je Artikel L-Shop-Stand aus dem Warenkorb, Fertig/Versendet/
// DTF/Notiz aus Produktions_Status, je Bestellung Zusammenfassung und "wartet auf Teile".
// Body { bestellungen: [{ id, date_created, line_items: [{ id, name, quantity, product_id, variation_id, sku }] }] }.
// Nur lesen.
router.post('/produktion/stand', async (req, res, next) => {
  try {
    res.json(await leseProduktionStand({ shop: req.query.shop, bestellungen: req.body?.bestellungen }));
  } catch (err) { next(err); }
});

export default router;
