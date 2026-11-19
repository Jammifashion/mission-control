// FIX3 B1: Job-Routen melden 5xx in den Chat (gedrosselt ueber notifyFehler), nie Pruefseite/Zeitueberschreitung.
import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { jobAlarm, jobFuer, jobAlarmText, JOB_ROUTEN } from '../middleware/jobAlarm.js';

function lauf({ method = 'POST', url, status, body }) {
  const melde = jest.fn(async () => true);
  const req = { method, originalUrl: url };
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200 });
  res.json = jest.fn(() => res);
  let weiter = false;
  jobAlarm({ melde })(req, res, () => { weiter = true; });
  res.statusCode = status;
  if (body) res.json(body);
  res.emit('finish');
  return { melde, weiter };
}
const warte = () => new Promise(r => setImmediate(r));

describe('jobAlarm', () => {
  test('500 an einer Job-Route -> Meldung mit Lauf, Status, Code; ohne Kundendaten', async () => {
    const { melde, weiter } = lauf({ url: '/api/trikot/sync?after=x', status: 500, body: { error: 'Fehler bei Max Mustermann', code: 'kaputt' } });
    await warte();
    expect(weiter).toBe(true);
    expect(melde).toHaveBeenCalledWith({ art: 'Trikot-Sync', status: 500, text: jobAlarmText({ status: 500, code: 'kaputt' }), titel: 'Störung' });
    expect(JSON.stringify(melde.mock.calls)).not.toContain('Mustermann');
  });

  test('200 und 4xx -> keine Meldung', async () => {
    expect(lauf({ url: '/api/backup/manual', status: 200 }).melde).not.toHaveBeenCalled();
    expect(lauf({ url: '/api/backup/manual', status: 409 }).melde).not.toHaveBeenCalled();
  });

  test('Pruefseite (503) und Zeitueberschreitung (504) melden schon selbst', async () => {
    expect(lauf({ url: '/api/partner/verkaeufe/sync-all', status: 503, body: { code: 'hoster_pruefseite' } }).melde).not.toHaveBeenCalled();
    expect(lauf({ url: '/api/partner/verkaeufe/sync-all', status: 504, body: { code: 'shop_timeout' } }).melde).not.toHaveBeenCalled();
  });

  test('andere Route oder GET -> nicht beobachtet', async () => {
    expect(lauf({ url: '/api/lager/bestand', status: 500 }).melde).not.toHaveBeenCalled();
    expect(lauf({ method: 'GET', url: '/api/trikot/sync', status: 500 }).melde).not.toHaveBeenCalled();
  });

  test('alle Laeufe aus dem Auftrag sind erfasst', () => {
    const laeufe = JOB_ROUTEN.map(j => j.lauf);
    for (const l of ['Backup', 'Partner-Sync', 'Trikot-Sync', 'Festpreis-Sync', 'L-Shop-Korb-Abgleich', 'L-Shop-Belege', 'L-Shop-Lieferbarkeit'])
      expect(laeufe).toContain(l);
    expect(jobFuer({ method: 'POST', originalUrl: '/api/festpreis/verkaeufe/sync/' })).toBe('Festpreis-Sync');
  });
});
