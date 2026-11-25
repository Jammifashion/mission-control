// DTF-Warenkorb (DT1) - hinter requireApiKey. Logik lib/dtfKorb.js, Drive lib/dtfAblage.js.
// Nie Namen, Preise, Drucknamen ins Log. Die Scan-Ansicht (Vorname) gibt es nur hier, hinter dem API-Key.
import express, { Router } from 'express';
import {
  runDtfAbgleich, leseDtfKorb, setzeDtfStatus, zuordnenKontext, zuordnen, dateiHochladen, bestellVorschau, bestellungAbsenden,
  bestellungPruefen, lieferungDa, scan, leseWasFehlt, DTF_BESCHAEFTIGT,
} from '../lib/dtfKorb.js';
import { sucheDateien, vorschau } from '../lib/dtfAblage.js';
import { quellSchluessel, QUELLE, DATEI_TYPEN, DATEI_MAX_BYTE } from '../utils/dtf-korb.js';

const router = Router();
const t = v => String(v ?? '').trim();
const mitMeldung = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (err) {
    if ([404, 409, 413, 422, 502, 503].includes(err?.status) && err?.code !== 'hoster_pruefseite') {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.probleme ? { probleme: err.probleme } : {}) });
    }
    next(err);
  }
};

router.get('/korb', mitMeldung(() => leseDtfKorb()));
router.post('/abgleich', mitMeldung(async req => {
  try { return await runDtfAbgleich({ dryRun: req.body?.dryRun === true, quelle: 'knopf' }); } catch (err) {
    if (err?.status === 409 && err?.message === DTF_BESCHAEFTIGT) return { uebersprungen: 'läuft schon' };
    throw err;
  }
}));
// "trotzdem aufnehmen": eine aeltere Bestellung bzw. einen aelteren Auftrag in den Korb holen
router.post('/aufnehmen', mitMeldung(async req => {
  const quelle = t(req.body?.quelle), nummer = t(req.body?.nummer);
  if (![QUELLE.JFN, QUELLE.AU].includes(quelle) || !/^[A-Z0-9-]{1,20}$/.test(nummer)) throw Object.assign(new Error('Bestellung/Auftrag unbekannt.'), { status: 422 });
  return runDtfAbgleich({ quelle: 'aufnehmen', zwang: new Set([quellSchluessel(quelle, nummer)]) });
}));
router.post('/status', mitMeldung(req => setzeDtfStatus({ eingabe: req.body ?? {} })));
router.get('/zuordnen', mitMeldung(req => zuordnenKontext({ schluessel: req.query.schluessel })));
router.post('/zuordnen', mitMeldung(req => zuordnen({ eingabe: req.body ?? {} })));
router.get('/datei/suche', mitMeldung(async req => ({ dateien: await sucheDateien(req.query.q) })));
router.post('/datei/hochladen', express.raw({ type: DATEI_TYPEN, limit: DATEI_MAX_BYTE }), mitMeldung(req => {
  if (!Buffer.isBuffer(req.body)) throw Object.assign(new Error('Dateityp bitte PNG, JPG, WEBP, TIFF, SVG oder PDF.'), { status: 422 });
  return dateiHochladen({ bezug: req.query.bezug, name: req.query.name, mime: t(req.headers['content-type']).split(';')[0], buf: req.body });
}));
router.get('/datei/:id/vorschau', async (req, res, next) => {
  try {
    const b = await vorschau(t(req.params.id), req.query.groesse);
    res.set('Content-Type', b.typ).set('Cache-Control', 'private, max-age=300').send(b.buf);
  } catch (err) {
    if ([404, 502, 503].includes(err?.status)) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});
router.post('/bestellung/vorschau', mitMeldung(req => bestellVorschau({ eingabe: req.body ?? {} })));
router.post('/bestellung/absenden', mitMeldung(req => bestellungAbsenden({ eingabe: req.body ?? {} })));
router.post('/bestellung/pruefen', mitMeldung(req => bestellungPruefen({ id: req.body?.id })));
router.post('/bestellung/geliefert', mitMeldung(req => lieferungDa({ id: req.body?.id })));
router.get('/scan/:id', mitMeldung(req => scan({ id: req.params.id })));
router.get('/was-fehlt', mitMeldung(() => leseWasFehlt()));

export default router;
