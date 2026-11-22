// GS2 Teil B: Fanshop-Konto eines Festpreis-Partners fuer MC (hinter requireApiKey, mit Entwuerfen und Lexware-IDs).
// Das Portal liest dasselbe ueber GET /api/festpreis-public/fanshop (ohne Entwuerfe). Logik lib/fanshopKonto.js.
import { Router } from 'express';
import { leseFanshopKonto } from '../lib/fanshopKonto.js';
import { LINK_BASIS } from '../utils/rechnung.js';
import { LINK_BASIS as GS_LINK_BASIS } from '../utils/gutschrift.js';

const router = Router();
router.get('/:partnerId', async (req, res, next) => {
  try {
    const partnerId = String(req.params.partnerId ?? '').trim();
    if (!/^FP-\d{3,}$/.test(partnerId)) return res.status(422).json({ error: 'Partner-ID ungültig.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ...(await leseFanshopKonto({ partnerId, mitEntwuerfen: true })), linkBasis: { rechnung: LINK_BASIS, gutschrift: GS_LINK_BASIS } });
  } catch (err) { next(err); }
});
export default router;
