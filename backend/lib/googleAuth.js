import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { google } from 'googleapis';

let cachedAuth = null;

/**
 * Loads OAuth2 credentials from Google Secret Manager and returns
 * an authenticated GoogleAuth client scoped for Sheets + Drive.
 */
export async function getGoogleAuth() {
  if (cachedAuth) return cachedAuth;

  const secretName = process.env.GOOGLE_SECRET_NAME;
  const projectId  = process.env.GOOGLE_PROJECT_ID;

  if (!secretName || !projectId) {
    throw new Error('GOOGLE_SECRET_NAME und GOOGLE_PROJECT_ID müssen in .env gesetzt sein.');
  }

  const client = new SecretManagerServiceClient();

  const fullName = secretName.startsWith('projects/')
    ? secretName
    : `projects/${projectId}/secrets/${secretName}/versions/latest`;

  const [version] = await client.accessSecretVersion({ name: fullName });
  const payload = version.payload?.data?.toString('utf8');

  if (!payload) throw new Error(`Secret "${secretName}" ist leer oder nicht lesbar.`);

  const credentials = JSON.parse(payload);

  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  return cachedAuth;
}
