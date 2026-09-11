// POST /api/claude/chat - Verlaufskuerzung.
//
// history.slice(-MAX_HISTORY) mit geradem MAX_HISTORY schneidet ab Runde 6 so,
// dass eine assistant-Nachricht an erster Stelle steht. Die Messages-API
// verlangt dort eine user-Nachricht und antwortet sonst mit 400 - der interne
// Assistent war ab der sechsten Nachricht einer Sitzung kaputt, bis jemand den
// Verlauf leerte.

import { jest } from '@jest/globals';

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class { constructor() { this.messages = { create: mockCreate }; } },
}));

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: jest.fn() }; } },
}));

jest.unstable_mockModule('../lib/modelConfig.js', () => ({
  getModel: jest.fn().mockResolvedValue('claude-sonnet-5'),
}));

let request, app;

// Die Route haengt die Antwort an DASSELBE Array an, das sie an die API
// uebergibt. Jest haelt nur die Referenz fest - ohne Schnappschuss sieht der
// Test den Stand nach der Mutation, nicht den gesendeten.
let gesendet;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { default: supertest } = await import('supertest');
  request = supertest;
  const { default: express } = await import('express');
  const router = (await import('../routes/claude.js')).default;

  app = express();
  app.use(express.json());
  app.use('/api/claude', router);
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
});

beforeEach(() => {
  gesendet = [];
  mockCreate.mockReset().mockImplementation(async ({ messages }) => {
    gesendet.push(messages.map(m => ({ ...m })));
    return { content: [{ type: 'text', text: 'Antwort.' }] };
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const sende = (session_id, message) =>
  request(app).post('/api/claude/chat').send({ session_id, message });

const gesendeteMessages = i => gesendet[i];

describe('Verlauf beginnt immer mit einer user-Nachricht', () => {
  test('auch nach mehr Runden als MAX_HISTORY', async () => {
    const sid = 'lange-sitzung';
    // MAX_HISTORY ist 10; ab Runde 6 lag hier vorher eine assistant-Nachricht vorn.
    for (let i = 1; i <= 12; i++) {
      const res = await sende(sid, `Frage ${i}`);
      expect(res.status).toBe(200);
    }

    expect(mockCreate).toHaveBeenCalledTimes(12);
    for (let i = 0; i < 12; i++) {
      const msgs = gesendeteMessages(i);
      expect(msgs[0].role).toBe('user');
    }
  });

  test('Runde 6 - genau der Fall, der vorher 400 ergab', async () => {
    const sid = 'runde-sechs';
    for (let i = 1; i <= 6; i++) await sende(sid, `Frage ${i}`);
    expect(gesendeteMessages(5)[0].role).toBe('user');
  });

  test('Verlauf bleibt auf MAX_HISTORY begrenzt', async () => {
    const sid = 'begrenzt';
    for (let i = 1; i <= 15; i++) await sende(sid, `Frage ${i}`);
    for (let i = 0; i < 15; i++) {
      expect(gesendeteMessages(i).length).toBeLessThanOrEqual(10);
    }
  });

  test('Rollen wechseln sich weiterhin ab', async () => {
    const sid = 'abwechselnd';
    for (let i = 1; i <= 9; i++) await sende(sid, `Frage ${i}`);
    const msgs = gesendeteMessages(8);
    msgs.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant'));
  });

  test('die letzte Nachricht ist immer die neue Frage des Nutzers', async () => {
    const sid = 'letzte';
    for (let i = 1; i <= 8; i++) await sende(sid, `Frage ${i}`);
    const msgs = gesendeteMessages(7);
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'Frage 8' });
  });

  test('getrennte Sitzungen teilen keinen Verlauf', async () => {
    await sende('a', 'Erste');
    await sende('b', 'Zweite');
    expect(gesendeteMessages(1)).toEqual([{ role: 'user', content: 'Zweite' }]);
  });

  test('DELETE leert den Verlauf', async () => {
    await sende('c', 'Eins');
    await request(app).delete('/api/claude/chat/c');
    await sende('c', 'Zwei');
    expect(gesendeteMessages(1)).toEqual([{ role: 'user', content: 'Zwei' }]);
  });
});
