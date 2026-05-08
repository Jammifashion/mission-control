import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const cache = new Map();
let smClient = null;

export const SECRET_KEYS = [
  'ANTHROPIC_API_KEY',
  'WC_KEY',
  'WC_SECRET',
  'WC_URL',
  'GOOGLE_SHEET_ID',
  'GEMINI_API_KEY',
  'MC_API_KEY',
];

function getSmClient() {
  if (!smClient) smClient = new SecretManagerServiceClient();
  return smClient;
}

/**
 * getSecret(key)
 *   production  → Google Secret Manager (cached after first call)
 *   development → process.env[key]
 */
export async function getSecret(key) {
  if (cache.has(key)) return cache.get(key);

  if (process.env.NODE_ENV !== 'production') {
    const val = process.env[key] ?? '';
    cache.set(key, val);
    return val;
  }

  const project = process.env.GOOGLE_PROJECT_ID;
  if (!project) throw new Error('GOOGLE_PROJECT_ID fehlt in .env');

  const name = `projects/${project}/secrets/${key}/versions/latest`;
  const [version] = await getSmClient().accessSecretVersion({ name });
  const val = version.payload.data.toString('utf8').trim();
  cache.set(key, val);
  return val;
}

/**
 * loadAllSecrets()
 * Lädt alle Secrets beim Start. In production werden die Werte zusätzlich
 * in process.env geschrieben, damit bestehende Routen (process.env.X) ohne
 * Änderung weiter funktionieren.
 */
export async function loadAllSecrets() {
  const isProd = process.env.NODE_ENV === 'production';

  const results = await Promise.allSettled(
    SECRET_KEYS.map(async key => {
      const val = await getSecret(key);
      if (isProd && val) process.env[key] = val;
      return { key, ok: Boolean(val) };
    }),
  );

  const failed = results
    .filter(r => r.status === 'rejected' || !r.value?.ok)
    .map(r =>
      r.status === 'rejected'
        ? (r.reason?.message ?? String(r.reason))
        : `${r.value.key} ist leer`,
    );

  if (failed.length > 0) {
    console.error(`✗ Secrets nicht vollständig geladen:\n  ${failed.join('\n  ')}`);
    process.exit(1);
  }

  const source = isProd ? 'GCP Secret Manager' : '.env';
  console.log(`✓ ${SECRET_KEYS.length} Secrets geladen (${source})`);
}
