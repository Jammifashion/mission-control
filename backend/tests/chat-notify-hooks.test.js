// Tier-2 – Wo notify() haengt und wo ausdruecklich NICHT.
//
// Der Testendpunkt /api/agent-wissen/prompt/test fuehrt denselben Agenten aus
// wie der Kundenchat, schreibt aber bei completed=true bewusst keine Zeile ins
// Sheet. Er darf folglich auch nicht benachrichtigen. Beide Pfade laufen hier
// mit identischem Agent-Ergebnis gegeneinander, damit der Unterschied belegt
// ist und nicht nur behauptet.

import { jest } from '@jest/globals';

jest.unstable_mockModule('googleapis', () => ({
  google: { sheets: jest.fn() },
}));

jest.unstable_mockModule('../lib/googleAuth.js', () => ({
  getGoogleAuth: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule('../lib/agentWissenHelper.js', () => ({
  getAgentSystemPrompt:   jest.fn().mockResolvedValue('System-Prompt.'),
  getPromptInfo:          jest.fn(),
  buildPromptWithGeruest: jest.fn().mockResolvedValue('System-Prompt.'),
  invalidateCache:        jest.fn(),
  DEFAULT_PROMPT_GERUEST: 'geruest',
}));

jest.unstable_mockModule('../lib/chatCore.js', () => ({
  loadRecentAnfragen: jest.fn().mockResolvedValue([]),
  callChatAgent:      jest.fn(),
}));

jest.unstable_mockModule('../lib/chatNotify.js', () => ({
  notify:                 jest.fn().mockResolvedValue(true),
  buildAnfrageNachricht:  jest.fn(() => 'ANFRAGE-NACHRICHT'),
  buildPartnerNachricht:  jest.fn(() => 'PARTNER-NACHRICHT'),
}));

jest.unstable_mockModule('express-rate-limit', () => ({
  default: jest.fn(() => (_req, _res, next) => next()),
}));

let request, chatApp, agentApp, partnerApp;
let mockValues, mockCallChatAgent, notify;

// Ein abgeschlossener Dialog: genau der Fall, in dem der Kundenchat eine
// Zeile schreibt und benachrichtigt.
const FERTIGES_ERGEBNIS = {
  reply:     'Danke, wir melden uns.',
  completed: true,
  sessionData: {
    kundeName:           'Grundschule Kellinghusen',
    kundeEmail:          'sekretariat@schule.example',
    produktBeschreibung: 'Abschluss-Shirts Klasse 4b',
    menge:               '45',
    kanal:               'Homepage',
  },
};

beforeAll(async () => {
  process.env.BUSINESS_SHEET_ID = 'test-sheet-id';
  process.env.TURNSTILE_SECRET_KEY = '';

  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');

  mockValues = {
    get:    jest.fn().mockResolvedValue({ data: { values: [['Anfrage-ID']] } }),
    append: jest.fn().mockResolvedValue({ data: {} }),
  };
  const { google } = await import('googleapis');
  google.sheets.mockReturnValue({ spreadsheets: { values: mockValues } });

  ({ notify } = await import('../lib/chatNotify.js'));
  const chatCore = await import('../lib/chatCore.js');
  mockCallChatAgent = chatCore.callChatAgent;

  const [chatRouter, agentRouter, partnerRouter] = await Promise.all([
    import('../routes/anfragen-chat.js').then(m => m.default),
    import('../routes/agent-wissen.js').then(m => m.default),
    import('../routes/partnerPortal.js').then(m => m.default),
  ]);

  const errHandler = (err, _req, res, _next) =>
    res.status(err.status ?? 500).json({ error: err.message });

  chatApp = express();
  chatApp.use(express.json());
  chatApp.use('/api/anfragen', chatRouter);
  chatApp.use(errHandler);

  agentApp = express();
  agentApp.use(express.json());
  agentApp.use('/api/agent-wissen', agentRouter);
  agentApp.use(errHandler);

  partnerApp = express();
  partnerApp.use(express.json());
  partnerApp.use('/api/partner', partnerRouter);
  partnerApp.use(errHandler);
});

beforeEach(() => {
  notify.mockClear();
  mockValues.append.mockClear();
  mockCallChatAgent.mockReset();
});

// ── Kundenanfrage ───────────────────────────────────────────────────────────

describe('Kundenanfrage', () => {
  test('abgeschlossener Chat schreibt eine Zeile UND benachrichtigt', async () => {
    mockCallChatAgent.mockResolvedValue(FERTIGES_ERGEBNIS);
    const res = await request(chatApp)
      .post('/api/anfragen/chat')
      .send({ messages: [{ role: 'user', content: 'Hallo' }] });

    expect(res.status).toBe(200);
    expect(mockValues.append).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('laufender Dialog schreibt nichts und benachrichtigt nicht', async () => {
    mockCallChatAgent.mockResolvedValue({
      reply: 'Wie viele Stück denn?', completed: false, sessionData: {},
    });
    await request(chatApp)
      .post('/api/anfragen/chat')
      .send({ messages: [{ role: 'user', content: 'Hallo' }] });

    expect(mockValues.append).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test('nicht pro Chat-Nachricht: drei Runden, eine Benachrichtigung', async () => {
    mockCallChatAgent
      .mockResolvedValueOnce({ reply: 'a', completed: false, sessionData: {} })
      .mockResolvedValueOnce({ reply: 'b', completed: false, sessionData: {} })
      .mockResolvedValueOnce(FERTIGES_ERGEBNIS);

    for (const t of ['eins', 'zwei', 'drei']) {
      await request(chatApp)
        .post('/api/anfragen/chat')
        .send({ messages: [{ role: 'user', content: t }] });
    }
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

// ── Testendpunkt ────────────────────────────────────────────────────────────

describe('Testendpunkt /api/agent-wissen/prompt/test', () => {
  test('benachrichtigt auch bei completed=true nicht', async () => {
    mockCallChatAgent.mockResolvedValue(FERTIGES_ERGEBNIS);
    const res = await request(agentApp)
      .post('/api/agent-wissen/prompt/test')
      .send({ messages: [{ role: 'user', content: 'Hallo' }] });

    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);   // derselbe Agent-Ausgang wie oben
    expect(mockValues.append).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

// ── Partnerbestellung ───────────────────────────────────────────────────────

describe('Partnerbestellung', () => {
  function sheetMitPartner(partnerId) {
    mockValues.get.mockImplementation(async ({ range }) => {
      if (range.startsWith('FP_Partner!')) return { data: { values: [['Partner-ID']] } };
      if (range.startsWith('Partner_Interne_Bestellungen!')) {
        return { data: { values: [[
          'Partner-ID', 'Datum', 'Bezeichnung', 'Anzahl', 'Status', 'Kanal', 'Fulfillment',
        ]] } };
      }
      return { data: { values: [['Partner-ID', 'Name'], [partnerId, 'Hamburg Crocodiles']] } };
    });
  }

  test('Eigenauftrag benachrichtigt mit dem Partnernamen', async () => {
    sheetMitPartner('P-001');
    const { buildPartnerNachricht } = await import('../lib/chatNotify.js');
    buildPartnerNachricht.mockClear();

    const res = await request(partnerApp)
      .post('/api/partner/P-001/eigenauftrag')
      .send({ artikel: 'T-Shirt', menge: 3, varianten: 'S, M, L' });

    expect(res.status).toBe(201);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(buildPartnerNachricht).toHaveBeenCalledWith(
      expect.objectContaining({ partnerName: 'Hamburg Crocodiles', anzahl: 3 }),
    );
  });

  test('unbekannter Partner: 404, keine Benachrichtigung', async () => {
    mockValues.get.mockResolvedValue({ data: { values: [['Partner-ID']] } });
    const res = await request(partnerApp)
      .post('/api/partner/P-999/eigenauftrag')
      .send({ artikel: 'T-Shirt', menge: 3, varianten: 'S' });

    expect(res.status).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });

  test('unvollstaendiger Auftrag: 400, keine Benachrichtigung', async () => {
    sheetMitPartner('P-001');
    const res = await request(partnerApp)
      .post('/api/partner/P-001/eigenauftrag')
      .send({ menge: 3 });

    expect(res.status).toBe(400);
    expect(notify).not.toHaveBeenCalled();
  });
});
