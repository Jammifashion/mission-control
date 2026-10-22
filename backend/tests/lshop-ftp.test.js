// BO4b-1: L-Shop-FTP NUR LESEN (lib/lshopFtp.js). Das EDI-Konto darf auf dem Server schreiben -
// "nur lesen" sichert allein der Code: nur liste/lade, feste Ordner, kein Schreibweg im Quelltext,
// basic-ftp nur in lshopFtp.js. Fehlermeldungen ohne Host/IP/Benutzer/Passwort.
// Zugangsdaten hier sind erfundene Platzhalter.

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { mitLShopFtp, LShopFtpFehler, ERLAUBT_LADEN } from '../lib/lshopFtp.js';
import { _secretCacheLeeren } from '../utils/secrets.js';

const hier = dirname(fileURLToPath(import.meta.url));
const backend = resolve(hier, '..');
const HOST = 'ftp.beispiel.test', USER = 'nutzer-x', PASS = 'pw-geheim-123';

function attrappe({ dateien = {}, accessFehler, listeFehler, inhalt = Buffer.from('<x/>') } = {}) {
  const c = {
    aufrufe: [], closed: 0,
    access: async o => { c.aufrufe.push(['access', o]); if (accessFehler) throw accessFehler; },
    list: async p => { c.aufrufe.push(['list', p]); if (listeFehler) throw listeFehler; return dateien[p] ?? []; },
    downloadTo: async (w, p) => {
      c.aufrufe.push(['downloadTo', p]);
      w.on('error', () => {});   // basic-ftp haengt selbst einen Fehler-Hoerer an
      await new Promise((res, rej) => w.write(inhalt, err => (err ? rej(err) : res())));
    },
    close: () => { c.closed++; },
  };
  return c;
}

beforeEach(() => {
  _secretCacheLeeren();
  process.env.LSHOP_FTP_HOST = HOST;
  process.env.LSHOP_EDI_FTP_USER = USER;
  process.env.LSHOP_EDI_FTP_PASS = PASS;
});

describe('mitLShopFtp', () => {
  test('meldet sich unverschluesselt an, gibt nur { liste, lade } heraus, schliesst immer', async () => {
    const c = attrappe({ dateien: { '/ORDERCONFIRMATION/': [{ name: 'a.xml', size: 3, isFile: true, rawModifiedAt: 'x' }] } });
    const r = await mitLShopFtp(async ftp => {
      expect(Object.keys(ftp).sort()).toEqual(['lade', 'liste']);
      expect(Object.isFrozen(ftp)).toBe(true);
      return ftp.liste('ORDERCONFIRMATION');
    }, { clientFabrik: () => c });
    expect(r).toEqual([{ name: 'a.xml', size: 3, istDatei: true, modifiedAt: undefined, rawModifiedAt: 'x' }]);
    expect(c.aufrufe[0]).toEqual(['access', { host: HOST, port: 21, user: USER, password: PASS, secure: false }]);
    expect(c.closed).toBe(1);
  });

  test('host:port', async () => {
    process.env.LSHOP_FTP_HOST = `${HOST}:2121`;
    _secretCacheLeeren();
    const c = attrappe();
    await mitLShopFtp(async () => null, { clientFabrik: () => c });
    expect(c.aufrufe[0][1].port).toBe(2121);
  });

  test('nur erlaubte Ordner; ORDER nur listen, nie laden; Dateiname ohne Pfad', async () => {
    const c = attrappe();
    await mitLShopFtp(async ftp => {
      await expect(ftp.liste('/')).rejects.toBeInstanceOf(LShopFtpFehler);
      await expect(ftp.liste('../etc')).rejects.toThrow(/nicht erlaubt/);
      await expect(ftp.lade('ORDER', 'x.xml')).rejects.toThrow(/nicht erlaubt/);
      await expect(ftp.lade('ORDERCONFIRMATION', '../ORDER/x.xml')).rejects.toThrow(/Ungültiger Dateiname/);
      await expect(ftp.lade('ORDERCONFIRMATION', 'a/b.xml')).rejects.toThrow(/Ungültiger Dateiname/);
      expect((await ftp.lade('ORDERCONFIRMATION', 'AB_1.xml')).toString()).toBe('<x/>');
    }, { clientFabrik: () => c });
    expect(ERLAUBT_LADEN.has('ORDER')).toBe(false);
    expect(c.aufrufe.filter(a => a[0] === 'downloadTo')).toEqual([['downloadTo', '/ORDERCONFIRMATION/AB_1.xml']]);
  });

  test('Groessenlimit je Datei', async () => {
    const c = attrappe({ inhalt: Buffer.alloc(20) });
    await mitLShopFtp(async ftp => {
      await expect(ftp.lade('ORDERCONFIRMATION', 'gross.xml', { maxBytes: 10 })).rejects.toThrow(/größer als 10 Bytes/);
    }, { clientFabrik: () => c });
  });

  test('Fehler -> LShopFtpFehler (502, lshop_ftp) ohne Host, IP, Benutzer, Passwort; Verbindung zu', async () => {
    const err = Object.assign(new Error(`connect ECONNREFUSED 85.22.1.2:21 ${HOST} 530 user ${USER} pass ${PASS}`), { code: 'ECONNREFUSED' });
    const c = attrappe({ accessFehler: err });
    const e = await mitLShopFtp(async () => null, { clientFabrik: () => c }).catch(x => x);
    expect(e).toBeInstanceOf(LShopFtpFehler);
    expect(e).toMatchObject({ status: 502, code: 'lshop_ftp' });
    for (const g of [HOST, USER, PASS, '85.22.1.2']) expect(e.message).not.toContain(g);
    expect(e.message).toMatch(/ECONNREFUSED/);
    expect(c.closed).toBe(1);

    const c2 = attrappe({ listeFehler: new Error('Timeout (control socket)') });
    const e2 = await mitLShopFtp(f => f.liste('ORDER'), { clientFabrik: () => c2 }).catch(x => x);
    expect(e2.message).toBe('FTP: Timeout (control socket)');
    expect(c2.closed).toBe(1);
  });

  test('Fehler aus fn (z. B. Sheets) wird NICHT zum FTP-Fehler', async () => {
    const e = await mitLShopFtp(async () => { throw new TypeError('Sheets'); }, { clientFabrik: () => attrappe() }).catch(x => x);
    expect(e).toBeInstanceOf(TypeError);
  });

  test('fehlende oder Platzhalter-Secrets -> "nicht konfiguriert", keine Verbindung', async () => {
    process.env.LSHOP_FTP_HOST = 'unused';
    _secretCacheLeeren();
    const c = attrappe();
    await expect(mitLShopFtp(async () => null, { clientFabrik: () => c })).rejects.toThrow(/nicht konfiguriert/);
    expect(c.aufrufe).toEqual([]);
  });
});

describe('Quelltext-Regeln', () => {
  const quelle = readFileSync(join(backend, 'lib/lshopFtp.js'), 'utf8');
  const code = quelle.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  test('lshopFtp.js ruft am Client nur access, list, downloadTo, close', () => {
    const benutzt = new Set([...code.matchAll(/client\.(\w+)/g)].map(m => m[1]));
    expect([...benutzt].sort()).toEqual(['access', 'close', 'downloadTo', 'list']);
  });

  test('kein Schreibweg im Quelltext', () => {
    for (const verboten of ['uploadFrom', 'appendFrom', 'uploadFromDir', 'remove', 'removeDir', 'clearWorkingDir', 'rename', 'ensureDir', '.send(', 'STOR', 'DELE', 'RNFR', 'MKD']) {
      expect(code).not.toContain(verboten);
    }
  });

  test('basic-ftp wird nur in lib/lshopFtp.js importiert', () => {
    const treffer = [];
    const lauf = dir => {
      for (const n of readdirSync(dir)) {
        if (['node_modules', 'tests', '.git'].includes(n)) continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) lauf(p);
        else if (/\.(c|m)?js$/.test(n) && /from\s+['"]basic-ftp['"]|require\(\s*['"]basic-ftp['"]\s*\)|import\(\s*['"]basic-ftp['"]\s*\)/.test(readFileSync(p, 'utf8'))) {
          treffer.push(relative(backend, p).replace(/\\/g, '/'));
        }
      }
    };
    lauf(backend);
    expect(treffer).toEqual(['lib/lshopFtp.js']);
  });
});
