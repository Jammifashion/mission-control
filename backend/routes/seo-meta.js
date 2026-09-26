// POST /api/seo/meta-eingaben – Faserangabe (NACH filterMaterialFarben) und
// Grammatur aus dem Eigenschaften-Freitext des SEO-Reiters.
//
// Warum eine Route: filterMaterialFarben lebt nur im Backend (lib/seo-prompt.js)
// und wird nicht ins Frontend gespiegelt. Den Rest der Meta-Beschreibung baut
// das Frontend mit dem gespiegelten Block aus lib/seo-meta.js.
//
// Kein Sprachmodell, kein externer Dienst – reine Rechnung.

import { Router } from 'express';
import { metaEingaben } from '../lib/seo-meta.js';
import { getWcClient } from '../lib/shopConfig.js';
import { sucheArtikel, keyphraseDubletten } from '../lib/seo-artikel.js';
import {
  motivFuer, motivFuerPrompt, seoHinweisVorlage, keyphraseGegenKarte, keyphraseMeldungen,
} from '../lib/seo-ssot.js';
import { pruefeTextMitSsot } from '../lib/seo-pruefung.js';
import { seoKarteNachziehen } from '../lib/seo-karte.js';

const router = Router();

router.post('/meta-eingaben', (req, res) => {
  const { eigenschaften = '', farben = [], groessen = [], strukturiert } = req.body ?? {};
  res.json(metaEingaben({
    eigenschaften: String(eigenschaften ?? ''),
    farben:   Array.isArray(farben)   ? farben.map(f => String(f ?? ''))   : [],
    groessen: Array.isArray(groessen) ? groessen.map(g => String(g ?? '')) : [],
    // Befehl M1: { faser, grammatur } aus GET /api/sheets/lshop/:catalogNr.
    strukturiert,
  }));
});

// ── Befehl SE1: Reiter "SEO-Daten aendern" ──────────────────────────────────
// GET /api/seo/artikel-suche?q= – veroeffentlichte Artikel nach Name, SKU, ID.
router.get('/artikel-suche', async (req, res, next) => {
  try {
    res.json(await sucheArtikel(getWcClient(req.query.shop), req.query.q));
  } catch (err) { next(err); }
});

// GET /api/seo/keyphrase-dubletten?kw=&ausser=<id> – andere veroeffentlichte
// Artikel mit derselben Keyphrase (Gross/Klein egal). Nur lesen.
router.get('/keyphrase-dubletten', async (req, res, next) => {
  try {
    res.json(await keyphraseDubletten(getWcClient(req.query.shop), req.query.kw, req.query.ausser));
  } catch (err) { next(err); }
});

// ── Befehl M4: Generator-Eingaben aus der SSOT ──────────────────────────────
// GET /api/seo/generator-eingaben?kurz=CH-Matchday&kategorien=686,556&keyphrase=…&wcId=…
// Liefert NUR, was der SEO-Reiter anzeigen darf: Motiv-Felder OHNE Nur_intern,
// die Vorlage fuer "Eigene Hinweise" (SEO_Hinweis der Kategorien) und die
// Keyphrase-Pruefung gegen SEO_Karte. Jeder Teil fuer sich: ein Lesefehler
// steht in `fehler`, die anderen Teile kommen trotzdem.
router.get('/generator-eingaben', async (req, res) => {
  const q = req.query ?? {};
  const kurz      = String(q.kurz ?? '').trim();
  const kategorien = String(q.kategorien ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const keyphrase = String(q.keyphrase ?? '').trim();
  const fehler = [];
  const teil = async (name, f) => { try { return await f(); } catch (e) { fehler.push(`${name}: ${e.message}`); return null; } };

  const [motiv, hinweisVorlage, kp] = await Promise.all([
    kurz ? teil('Motive', async () => motivFuerPrompt(await motivFuer(kurz))) : null,
    kategorien.length ? teil('Struktur_Kategorien', () => seoHinweisVorlage(kategorien)) : '',
    keyphrase ? teil('SEO_Karte', () => keyphraseGegenKarte(keyphrase, { wcId: q.wcId })) : null,
  ]);
  res.json({
    motiv:          motiv ?? null,
    hinweisVorlage: hinweisVorlage ?? '',
    keyphrase:      kp ? { ...kp, ...keyphraseMeldungen(keyphrase, kp) } : null,
    fehler,
  });
});

// ── Befehl M4b: Pruefung nach dem Speichern ───────────────────────────────
// POST /api/seo/text-pruefung { kurzbeschreibung, produktbeschreibung,
//   produktname, keyphrase, artikelkurz, lshopNr } -> { pruefhinweise }
// Der SEO-Reiter schickt den TATSAECHLICH gespeicherten Text (WooCommerce-
// Antwort nach dem PUT, also auch nach Handbearbeitung). Nur lesen, blockiert nie.
router.post('/text-pruefung', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    res.json({ pruefhinweise: await pruefeTextMitSsot({
      kurzbeschreibung:    String(b.kurzbeschreibung ?? ''),
      produktbeschreibung: String(b.produktbeschreibung ?? ''),
      produktname:         String(b.produktname ?? ''),
      keyphrase:           String(b.keyphrase ?? ''),
      artikelkurz:         String(b.artikelkurz ?? ''),
      lshopNr:             String(b.lshopNr ?? ''),
    }) });
  } catch (err) { next(err); }
});

// ── POST /api/seo/karte  Body: { wcId } ──────────────────────────────────────
// Befehl M9: SEO_Karte-Zeile des Artikels nach dem Yoast-Speichern nachziehen.
// Logik in lib/seo-karte.js; der Artikel wird dort neu aus dem Shop gelesen.
// 409 = WC_ID mehrfach in der Karte, nichts geschrieben.
router.post('/karte', async (req, res, next) => {
  try {
    res.json(await seoKarteNachziehen(String(req.body?.wcId ?? '')));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
