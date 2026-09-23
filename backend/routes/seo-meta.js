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

const router = Router();

router.post('/meta-eingaben', (req, res) => {
  const { eigenschaften = '', farben = [] } = req.body ?? {};
  res.json(metaEingaben({
    eigenschaften: String(eigenschaften ?? ''),
    farben: Array.isArray(farben) ? farben.map(f => String(f ?? '')) : [],
  }));
});

export default router;
