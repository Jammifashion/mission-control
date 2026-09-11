// Tier-2 – API-Endpunkte mit supertest + gemockten Abhängigkeiten.
// Mocks müssen VOR allen dynamischen Imports deklariert werden (ESM-Anforderung).
// In ESM-Jest muss `jest` explizit aus @jest/globals importiert werden.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/shopConfig.js', () => ({
  getWcClient: jest.fn(),
  getShopConfig: jest.fn().mockReturnValue({
    shop: 'jfn', label: 'JFN', wcUrl: '', wcKey: '', wcSecret: '',
    tabVerkaeufe: 'Partner_Verkäufe', tabAbrechnungen: 'Partner_Abrechnungen',
  }),
  normalizeShop: jest.fn(s => s ?? 'jfn'),
}));

jest.unstable_mockModule('../lib/agentWissenHelper.js', () => ({
  getAgentSystemPrompt: jest.fn().mockResolvedValue('System-Prompt ohne Platzhalter.'),
}));

jest.unstable_mockModule('../lib/chatCore.js', () => ({
  loadRecentAnfragen: jest.fn().mockResolvedValue([]),
  callChatAgent: jest.fn(),
}));

// partnerPortal.js und anfragen-chat.js benachrichtigen seit dem Google-Chat-
// Sprint. chatNotify zieht ueber secrets.js den Secret-Manager-Client in den
// Modulgraph - hier nicht aufloesbar und fuer diese Suite auch ohne Belang.
// Was wo benachrichtigt wird, prueft chat-notify-hooks.test.js.
jest.unstable_mockModule('../lib/chatNotify.js', () => ({
  notify:                jest.fn().mockResolvedValue(true),
  buildAnfrageNachricht: jest.fn(() => 'anfrage'),
  buildPartnerNachricht: jest.fn(() => 'partner'),
}));

jest.unstable_mockModule('express-rate-limit', () => ({
  default: jest.fn(() => (_req, _res, next) => next()),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

let request, partnerApp, chatApp;
let mockValues, mockCallChatAgent;

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';

  const { default: supertest } = await import('supertest');
  request = supertest;

  const { default: express } = await import('express');

  mockValues = {
    get:    jest.fn(),
    append: jest.fn().mockResolvedValue({ data: {} }),
  };

  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  const chatCore = await import('../lib/chatCore.js');
  mockCallChatAgent = chatCore.callChatAgent;

  const [partnerRouter, chatRouter] = await Promise.all([
    import('../routes/partnerPortal.js').then(m => m.default),
    import('../routes/anfragen-chat.js').then(m => m.default),
  ]);

  const errHandler = (err, _req, res, _next) =>
    res.status(err.status ?? 500).json({ error: err.message });

  partnerApp = express();
  partnerApp.use(express.json());
  partnerApp.use('/api/partner', partnerRouter);
  partnerApp.use(errHandler);

  chatApp = express();
  chatApp.use(express.json());
  chatApp.use('/api/anfragen', chatRouter);
  chatApp.use(errHandler);
});

beforeEach(() => {
  mockValues.get.mockReset();
  // Default: leeres Sheet (verhindert Destructuring-Fehler bei Sheet-Zugriffen)
  mockValues.get.mockResolvedValue({ data: { values: [] } });
  mockValues.append.mockResolvedValue({ data: {} });
  mockCallChatAgent.mockReset();
});

// ── Partner Auth ──────────────────────────────────────────────────────────────

describe('GET /api/partner/auth', () => {
  const PARTNER_SHEET = [
    ['Token', 'Partner-ID', 'Name', 'Aktiv'],
    ['valid-token', 'P-001', 'Mustermann GmbH', 'ja'],
  ];

  test('gültiger Token → 200 mit Partner-Objekt', async () => {
    mockValues.get.mockResolvedValue({ data: { values: PARTNER_SHEET } });
    const res = await request(partnerApp)
      .get('/api/partner/auth')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.partnerId).toBe('P-001');
    expect(res.body.partnerName).toBe('Mustermann GmbH');
  });

  test('ungültiger Token → 401', async () => {
    mockValues.get.mockResolvedValue({ data: { values: PARTNER_SHEET } });
    const res = await request(partnerApp)
      .get('/api/partner/auth')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  test('fehlender Token (kein Authorization-Header) → 401', async () => {
    const res = await request(partnerApp).get('/api/partner/auth');
    expect(res.status).toBe(401);
    // Kein Sheets-Call nötig – Route prüft Token zuerst
    expect(mockValues.get).not.toHaveBeenCalled();
  });
});

// ── Eigenauftrag ──────────────────────────────────────────────────────────────

describe('POST /api/partner/:id/eigenauftrag', () => {
  const TOKEN    = 'valid-token';
  const FP_TOKEN = 'fp-token';

  // Partner-Tab traegt P-001 mit TOKEN, FP_Partner-Tab P-FP-1 mit FP_TOKEN.
  // Der Eigenauftrag wird von beiden Portalseiten aufgerufen, die Token-
  // Aufloesung muss daher beide Tabs abdecken.
  function setupSheets() {
    mockValues.get.mockImplementation(async ({ range }) => {
      if (range.startsWith('FP_Partner!')) {
        return { data: { values: [
          ['Partner-ID', 'Name', 'Token', 'Aktiv'],
          ['P-FP-1', 'Festpreis Partner', FP_TOKEN, 'ja'],
        ] } };
      }
      if (range.startsWith('Partner_Interne_Bestellungen!')) {
        // Kanal- UND Fulfillment-Spalte vorhanden → kein batchUpdate nötig.
        // Fehlt Fulfillment, laeuft die Route in den Nachruest-Zweig und ruft
        // values.batchUpdate, das dieser Mock nicht kennt → 500.
        return { data: { values: [[
          'Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Status', 'Kanal', 'Fulfillment',
        ]] } };
      }
      return { data: { values: [
        ['Partner-ID', 'Name', 'Token', 'Aktiv'],
        ['P-001', 'Test Partner', TOKEN, 'ja'],
      ] } };
    });
  }

  const VALID_BODY = { artikel: 'T-Shirt', menge: 10, varianten: 'S, M, L' };

  const post = (id, token) => {
    const req = request(partnerApp).post(`/api/partner/${id}/eigenauftrag`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  beforeEach(() => {
    setupSheets();
    // Der globale beforeEach setzt nur den Rueckgabewert neu, nicht die
    // Aufrufhistorie - ohne dieses Clear zaehlen die 201-Tests in den
    // "kein Schreibzugriff"-Erwartungen der Auth-Tests mit.
    mockValues.append.mockClear();
  });

  test('alle Pflichtfelder vorhanden → 201', async () => {
    const res = await post('P-001', TOKEN).send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.partnerId).toBe('P-001');
    // Portal-Eigenauftraege starten direkt auf 'offen'; mit 'Neu' flossen sie
    // nie in Saldo/Abrechnung ein (Bugfix, siehe partnerPortal.js).
    expect(res.body.status).toBe('offen');
    expect(res.body.kanal).toBe('Portal');
    expect(res.body.fulfillment).toBe('Beauftragt');
  });

  // partner-festpreis.html nutzt denselben Endpunkt mit einem FP_Partner-Token.
  test('Festpreis-Partner mit FP_Partner-Token → 201', async () => {
    const res = await post('P-FP-1', FP_TOKEN).send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.partnerId).toBe('P-FP-1');
  });

  test('ohne Token → 401', async () => {
    const res = await post('P-001', null).send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('unbekannter Token → 401', async () => {
    const res = await post('P-001', 'wrong-token').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('fremde Partner-ID im Pfad → 403', async () => {
    const res = await post('P-999', TOKEN).send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  // Ein Lizenz-Token darf nicht auf einen Festpreis-Partner zeigen.
  test('gueltiger Token, aber Partner-ID aus dem anderen Tab → 403', async () => {
    const res = await post('P-FP-1', TOKEN).send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('inaktiver Partner → 403', async () => {
    mockValues.get.mockImplementation(async ({ range }) => {
      if (range.startsWith('FP_Partner!')) return { data: { values: [['Partner-ID', 'Token']] } };
      return { data: { values: [
        ['Partner-ID', 'Name', 'Token', 'Aktiv'],
        ['P-001', 'Test Partner', TOKEN, 'nein'],
      ] } };
    });
    const res = await post('P-001', TOKEN).send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(mockValues.append).not.toHaveBeenCalled();
  });

  test('artikel fehlt → 400', async () => {
    const res = await post('P-001', TOKEN).send({ menge: 5, varianten: 'M' });
    expect(res.status).toBe(400);
  });

  test('menge fehlt oder 0 → 400', async () => {
    const res1 = await post('P-001', TOKEN).send({ artikel: 'Shirt', varianten: 'M' });
    expect(res1.status).toBe(400);

    const res2 = await post('P-001', TOKEN).send({ artikel: 'Shirt', menge: 0, varianten: 'M' });
    expect(res2.status).toBe(400);
  });

  test('varianten fehlt → 400', async () => {
    const res = await post('P-001', TOKEN).send({ artikel: 'Shirt', menge: 5 });
    expect(res.status).toBe(400);
  });
});

// ── Chat Agent ────────────────────────────────────────────────────────────────

describe('POST /api/anfragen/chat', () => {
  const INIT_BODY = {
    messages: [{ role: 'user', content: '__init__' }],
    sessionData: {},
  };

  test('__init__ → 200 mit reply + sessionData + completed', async () => {
    mockCallChatAgent.mockResolvedValue({
      reply: 'Willkommen bei JammiFashion! Wie kann ich helfen?',
      sessionData: { step: 1, kanal: 'Homepage' },
      completed: false,
    });
    const res = await request(chatApp).post('/api/anfragen/chat').send(INIT_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reply');
    expect(res.body).toHaveProperty('sessionData');
    expect(res.body).toHaveProperty('completed');
    expect(typeof res.body.reply).toBe('string');
    expect(res.body.reply.length).toBeGreaterThan(0);
  });

  test('completed: true nur wenn Schritt 9 bestätigt', async () => {
    // Schritt 8: Agent fragt nach Bestätigung → completed: false
    mockCallChatAgent.mockResolvedValueOnce({
      reply: 'Alles korrekt? Dann bestätige bitte.',
      sessionData: { step: 8, kundeName: 'Max Muster', kundeEmail: 'max@example.de' },
      completed: false,
    });
    const res8 = await request(chatApp)
      .post('/api/anfragen/chat')
      .send({ messages: [{ role: 'user', content: 'Ja, sieht gut aus.' }], sessionData: { step: 8 } });
    expect(res8.body.completed).toBe(false);

    // Schritt 9: Bestätigung → completed: true
    mockCallChatAgent.mockResolvedValueOnce({
      reply: 'Vielen Dank! Wir melden uns innerhalb von 24h.',
      sessionData: { step: 9, kundeName: 'Max Muster', kundeEmail: 'max@example.de' },
      completed: true,
    });
    const res9 = await request(chatApp)
      .post('/api/anfragen/chat')
      .send({ messages: [{ role: 'user', content: 'Bestätigen' }], sessionData: { step: 9 } });
    expect(res9.body.completed).toBe(true);
  });

  test('Antwort enthält keine rohen Platzhalter ({{...}})', async () => {
    mockCallChatAgent.mockResolvedValue({
      reply: 'Ich helfe dir gerne mit deiner Anfrage!',
      sessionData: { step: 1, kanal: 'Homepage' },
      completed: false,
    });
    const res = await request(chatApp).post('/api/anfragen/chat').send(INIT_BODY);
    expect(res.body.reply).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
