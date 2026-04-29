import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { google } from 'googleapis';

let cachedAuth = null;

/**
 * Returns an authenticated GoogleAuth client.
 *
 * Priority:
 *  1. GOOGLE_CREDENTIALS_JSON  – raw service-account JSON in .env (local dev)
 *  2. GOOGLE_SECRET_NAME       – loads JSON from Google Secret Manager (production)
 */
export async function getGoogleAuth() {
  if (cachedAuth) return cachedAuth;

  let credentials;

  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    // Local dev: credentials JSON directly in .env
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch {
      throw new Error('GOOGLE_CREDENTIALS_JSON ist kein gültiges JSON.');
    }
  } else {
    // Production: load from Secret Manager
    const secretName = process.env.GOOGLE_SECRET_NAME;
    const projectId  = process.env.GOOGLE_PROJECT_ID;

    if (!secretName || !projectId) {
      throw new Error(
        'Google-Credentials fehlen. Setze entweder GOOGLE_CREDENTIALS_JSON (lokal) ' +
        'oder GOOGLE_SECRET_NAME + GOOGLE_PROJECT_ID (Produktion) in .env.'
      );
    }

    const client = new SecretManagerServiceClient();
    const fullName = secretName.startsWith('projects/')
      ? secretName
      : `projects/${projectId}/secrets/${secretName}/versions/latest`;

    const [version] = await client.accessSecretVersion({ name: fullName });
    const payload = version.payload?.data?.toString('utf8');
    if (!payload) throw new Error(`Secret "${secretName}" ist leer oder nicht lesbar.`);
    credentials = JSON.parse(payload);
  }

  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  return cachedAuth;
}
