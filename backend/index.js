import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
import './scripts/check-env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { loadAllSecrets } from './utils/secrets.js';
import { apiRateLimiter, requireApiKey } from './middleware/auth.js';
import { tokenBremse } from './middleware/tokenBremse.js';
import { hosterPruefseiteHandler } from './middleware/hosterPruefseite.js';
import { healthHandler } from './utils/stand.js';
import woocommerceRouter from './routes/woocommerce.js';
import artikelRouter from './routes/artikel.js';
import claudeRouter from './routes/claude.js';
import sheetsRouter from './routes/sheets.js';
import auftragsmonitorRouter from './routes/auftragsmonitor.js';
import backupRouter from './routes/backup.js';
import systemRoutes, { healthRouter } from './routes/system.js';
import kalkulationRouter from './routes/kalkulation.js';
import partnerPortalRouter from './routes/partnerPortal.js';
import partnerArtikelRouter from './routes/partner-artikel.js';
import anfragenRouter from './routes/anfragen.js';
import anfragenChatRouter from './routes/anfragen-chat.js';
import festpreisRouter from './routes/festpreis-portal.js';
import festpreisPublicRouter from './routes/festpreis-public.js';
import festpreisGutschriftRouter from './routes/festpreis-gutschrift.js';   // GS1
import fanshopKontoRouter from './routes/fanshop-konto.js';   // GS2 Teil B
import agentWissenRouter from './routes/agent-wissen.js';
import trikotRouter from './routes/trikot.js';
import seoMetaRouter from './routes/seo-meta.js';
import lshopRouter from './routes/lshop.js';
import bestellenRouter from './routes/bestellen.js';
import lshopBelegeRouter from './routes/lshopBelege.js';
import lshopLieferbarkeitRouter from './routes/lshopLieferbarkeit.js';
import lieferbarkeitShopRouter from './routes/lieferbarkeitShop.js';
import internRouter from './routes/intern.js';
import lagerRouter from './routes/lager.js';
import kundenRouter from './routes/kunden.js';
import dashboardRouter from './routes/dashboard.js';
import auftraegeRouter from './routes/auftraege.js';
import feedbackRouter from './routes/feedback.js';
import mikaRouter from './routes/mika.js';
import bestellseiteRouter from './routes/bestellseite.js';
import bestellseitenRouter from './routes/bestellseiten.js';
import { fehlerHandler, oeffentlich } from './middleware/fehlerHandler.js';
import { jobAlarm } from './middleware/jobAlarm.js';

// Secrets vor Express-Setup laden – stellt sicher dass process.env.CORS_ORIGIN
// (und alle anderen Secrets) bereits gesetzt sind wenn die Middleware konfiguriert wird.
await loadAllSecrets();

const app = express();
const PORT = process.env.PORT || 3001;

// Hinter Cloud Run (genau 1 Proxy): echte Client-IP aus X-Forwarded-For lesen,
// damit Rate-Limiting pro IP greift. NICHT 'true' (würde XFF-Spoofing erlauben).
app.set('trust proxy', 1);

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'https://jammifashion.github.io').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // X-MC-Stand: letzter guter Stand der WC-Stammdaten (routes/woocommerce.js wcCached)
  exposedHeaders: ['X-MC-Stand'],
}));
app.use(express.json({ limit: '256kb' }));
app.use(jobAlarm());   // FIX3 B1: 5xx der Job-Routen -> Chat (gedrosselt, ohne Kundendaten)

// ── Rate limiting → Auth (Reihenfolge: rateLimiter → requireApiKey → Router) ──
app.use('/api/', apiRateLimiter);
app.use('/api/partner',      oeffentlich, tokenBremse, partnerPortalRouter); // Token-Auth oder eigene Key-Prüfung; PPS1: Bremse nur fuer 401
app.use('/api/anfragen',           oeffentlich, anfragenChatRouter);   // public: nur /chat (kein API-Key nötig)
app.use('/api/festpreis-public',   oeffentlich, tokenBremse, festpreisPublicRouter); // public: Token-Auth (kein API-Key); PPS1: Bremse
app.use('/api/intern',             internRouter);          // Cloud Scheduler: OIDC-Token statt API-Key (CS1)
app.use('/api/bestellseite',       oeffentlich, bestellseiteRouter);    // public: Bestellseite per Token (KS1), Bearer-Token statt API-Key
app.use((req, _res, next) => { req.mcOeffentlich = false; next(); });   // FIX4: ab hier MC (API-Schluessel)
app.use(requireApiKey);

// ── Routes ────────────────────────────────────────────────────────────────────
// Liveness-Probe plus Stand des laufenden Codes (commit, gebaut) - siehe utils/stand.js.
app.get('/health', healthHandler);

app.use('/api/woocommerce', woocommerceRouter);
app.use('/api/artikel', artikelRouter);
app.use('/api/claude', claudeRouter);
app.use('/api/sheets', sheetsRouter);
app.use('/api/auftragsmonitor', auftragsmonitorRouter);
app.use('/api/backup', backupRouter);
app.use('/api/system', systemRoutes);
app.use('/api/kalkulation', kalkulationRouter);
app.use('/api/partner',     partnerArtikelRouter); // Admin-Endpunkte (hinter requireApiKey)
app.use('/api/anfragen',    anfragenRouter);
app.use('/api/festpreis/gutschrift', festpreisGutschriftRouter);   // GS1: vor dem allgemeinen FP-Router
app.use('/api/festpreis/fanshop', fanshopKontoRouter);   // GS2 Teil B
app.use('/api/festpreis',      festpreisRouter);
app.use('/api/agent-wissen',  agentWissenRouter);
app.use('/api/trikot',        trikotRouter);        // POST /sync – täglicher Trikot-Sync
app.use('/api/seo',           seoMetaRouter);       // POST /meta-eingaben – Yoast-Meta ohne Modell
app.use('/api/lshop',         lshopRouter);         // POST /stammdaten – L-Shop-Stammdaten (LS1)
app.use('/api/bestellen',     bestellenRouter);     // L-Shop-Warenkorb: Abgleich + Anzeige (BO2)
app.use('/api/bestellen/lshop-belege', lshopBelegeRouter); // Belege vom L-Shop-FTP, nur lesen (BO4b-1)
app.use('/api/bestellen/lshop-lieferbarkeit', lshopLieferbarkeitRouter); // Bestandsdatei + Auslaufliste, nur lesen (BO7-1)
app.use('/api/lieferbarkeit-shop', lieferbarkeitShopRouter);   // Problemliste Shop-Artikel, nur lesen (BO7-3)
app.use('/api/lager',         lagerRouter);         // Lager: Bestand, Buchungen (BO5-1)
app.use('/api/kunden',        kundenRouter);        // Kundenstamm, eigenes Sheet KUNDEN_SHEET_ID (AM-1)
app.use('/api/dashboard',     dashboardRouter);     // DB1: gebuendeltes Dashboard + Kundenhinweis gelesen
app.use('/api/auftraege',     auftraegeRouter);     // Auftraege im SSOT, nur Kunden_Nr (AM-2)
app.use('/api/feedback',      feedbackRouter);      // FB1: Feedback ins eigene Sheet (FEEDBACK_SHEET_ID), kein Lesen
app.use('/api/mika',          mikaRouter);          // MI1: Assistent Mika Stufe 0 - drei feste Fragen ohne KI, nur lesen
app.use('/api/bestellseiten', bestellseitenRouter); // KS1: Bestellseiten verwalten (Token nur einmal in der Antwort)
app.use('/api/health', healthRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
// Hoster-Pruefseite zuerst: 503 + Code "hoster_pruefseite" + Chat (gedrosselt).
app.use(hosterPruefseiteHandler);
app.use(fehlerHandler);   // loggt nur Name, Meldung, Status, Code, Pfad

app.listen(PORT, () => {
  console.log(`Mission Control backend → http://localhost:${PORT}`);
});
