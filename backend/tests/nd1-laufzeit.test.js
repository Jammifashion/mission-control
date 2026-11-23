// ND1: eine Node-Version (26) fuer Cloud Run, Tests in den Workflows und lokal; GitHub-Actions ohne node20-Laufzeit,
// jede Action per Commit-SHA gepinnt; Backend-Deploy kann eine Revision ohne Verkehr ausrollen.

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lies = p => readFileSync(resolve(root, p), 'utf8');
const WF_ORDNER = '.github/workflows';
const workflows = readdirSync(resolve(root, WF_ORDNER)).filter(n => n.endsWith('.yml'))
  .map(n => ({ name: n, text: lies(`${WF_ORDNER}/${n}`) }));

const NODE = '26';

// Staende mit node20-Laufzeit (gemessen 23.11.2026) - duerfen nicht zurueckkommen.
const NODE20_SHAS = [
  '11d5960a326750d5838078e36cf38b85af677262', // actions/checkout v4.4.0
  '49933ea5288caeca8642d1e84afbd3f7d6820020', // actions/setup-node v4.4.0
  'c200f3691d83b41bf9bbd8638997a462592937ed', // google-github-actions/auth v2.1.13
  'e427ad8a34f8676edf47cf7d7925499adf3eb74f', // google-github-actions/setup-gcloud v2.2.1
];

describe('ND1 Node-Version', () => {
  test('Backend-Image auf Node 26 (alpine wie bisher), npm ohne Dev-Pakete', () => {
    const df = lies('Dockerfile');
    expect(df).toMatch(new RegExp(`^FROM node:${NODE}-alpine$`, 'm'));
    expect(df).toContain('npm ci --omit=dev');
  });

  test('engines und .nvmrc nennen dieselbe Hauptversion', () => {
    const pkg = JSON.parse(lies('backend/package.json'));
    expect(pkg.engines.node).toBe(`>=${NODE} <${Number(NODE) + 1}`);
    const lock = JSON.parse(lies('backend/package-lock.json'));
    expect(lock.packages[''].engines.node).toBe(pkg.engines.node);
    expect(lies('.nvmrc').trim()).toBe(NODE);
  });

  test('jedes setup-node in den Workflows nutzt Node 26', () => {
    const versionen = workflows.flatMap(w => [...w.text.matchAll(/node-version:\s*(\S+)/g)].map(m => m[1]));
    expect(versionen.length).toBeGreaterThan(0);
    for (const v of versionen) expect(v).toBe(NODE);
  });
});

describe('ND1 GitHub-Actions', () => {
  test('jede Action ist per vollem Commit-SHA gepinnt und traegt die Version als Kommentar', () => {
    for (const w of workflows) {
      for (const m of w.text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)) {
        expect(`${w.name}: ${m[1]}`).toMatch(/@[0-9a-f]{40}$/);
        expect(`${w.name}: ${m[2]}`).toMatch(/# v\d+\.\d+\.\d+/);
      }
    }
  });

  test('keine Action mehr auf einem bekannten node20-Stand', () => {
    for (const w of workflows) for (const sha of NODE20_SHAS) expect(`${w.name}: ${w.text.includes(sha)}`).toBe(`${w.name}: false`);
  });

  test('Backend-Deploy: Revision ohne Verkehr ueber Repo-Variable, Tag geprueft', () => {
    const wf = lies(`${WF_ORDNER}/deploy-backend.yml`);
    expect(wf).toContain('DEPLOY_TAG_OHNE_VERKEHR: ${{ vars.DEPLOY_TAG_OHNE_VERKEHR }}');
    expect(wf).toContain('VERKEHR="--no-traffic --tag $DEPLOY_TAG_OHNE_VERKEHR"');
    expect(wf).toContain('gcloud run deploy mission-control-backend $VERKEHR');
    expect(wf).toMatch(/grep -Eq '\^\[a-z\]\[a-z0-9-\]\{0,45\}\[a-z0-9\]\$'/);
    // Ein Push ohne Variable rollt wie bisher mit Verkehr aus.
    expect(wf).toMatch(/if \[ -n "\$DEPLOY_TAG_OHNE_VERKEHR" \]; then\n\s+VERKEHR=/);
  });
});
