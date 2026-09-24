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

const router = Router();

router.post('/meta-eingaben', (req, res) => {
  const { eigenschaften = '', farben = [], groessen = [] } = req.body ?? {};
  res.json(metaEingaben({
    eigenschaften: String(eigenschaften ?? ''),
    farben:   Array.isArray(farben)   ? farben.map(f => String(f ?? ''))   : [],
    groessen: Array.isArray(groessen) ? groessen.map(g => String(g ?? '')) : [],
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

export default router;
