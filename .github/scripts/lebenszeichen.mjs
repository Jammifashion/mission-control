// FIX3 B4: Wochen-Lebenszeichen. Zaehlt fuer die taeglichen Laeufe die Tage mit erfolgreichem Lauf in den
// letzten 7 Tagen (GitHub-API, nur lesen, GITHUB_TOKEN mit actions: read) und schreibt laeufe.json fuer
// POST /api/system/lebenszeichen. Reine Zaehl-Logik exportiert (Test backend/tests/lebenszeichen.test.js).
//
// Aufruf im Workflow: node .github/scripts/lebenszeichen.mjs > laeufe.json

export const LAEUFE = [
  { name: 'Backup',       workflow: 'backup-daily.yml',       schritt: 'POST /api/backup/manual' },
  { name: 'Partner-Sync', workflow: 'sync-partner-daily.yml', schritt: 'POST /api/partner/verkaeufe/sync-all (jfn)' },
  { name: 'Trikot-Sync',  workflow: 'trikot-sync-daily.yml',  schritt: 'POST /api/trikot/sync' },
  { name: 'FP-Sync',      workflow: 'sync-partner-daily.yml', schritt: 'POST /api/festpreis/verkaeufe/sync' },
];
export const TAGE = 7;

/**
 * Tage (UTC, JJJJ-MM-TT) mit mindestens einem erfolgreichen Schritt `schritt` ab `seit`.
 * @param {Array<{ created_at: string, jobs: Array<{ steps: Array<{ name: string, conclusion: string }> }> }>} laeufe
 */
export function erfolgsTage(laeufe, schritt, seit) {
  const tage = new Set();
  for (const r of laeufe ?? []) {
    if (!(Date.parse(r.created_at) >= seit.getTime())) continue;
    const ok = (r.jobs ?? []).some(j => (j.steps ?? []).some(s => s.name === schritt && s.conclusion === 'success'));
    if (ok) tage.add(String(r.created_at).slice(0, 10));
  }
  return tage;
}

async function holen(pfad, token) {
  const res = await fetch(`https://api.github.com${pfad}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub-API ${res.status} fuer ${pfad.split('?')[0]}`);
  return res.json();
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error('GITHUB_TOKEN oder GITHUB_REPOSITORY fehlt.');
  const seit = new Date(Date.now() - TAGE * 864e5);
  const jeWorkflow = new Map();
  for (const wf of new Set(LAEUFE.map(l => l.workflow))) {
    const { workflow_runs: runs = [] } = await holen(
      `/repos/${repo}/actions/workflows/${wf}/runs?created=%3E%3D${seit.toISOString().slice(0, 19)}Z&per_page=100`, token);
    const mitJobs = [];
    for (const r of runs) {
      const { jobs = [] } = await holen(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`, token);
      mitJobs.push({ created_at: r.created_at, jobs });
    }
    jeWorkflow.set(wf, mitJobs);
  }
  const laeufe = LAEUFE.map(l => ({ name: l.name, n: Math.min(TAGE, erfolgsTage(jeWorkflow.get(l.workflow), l.schritt, seit).size), soll: TAGE }));
  process.stdout.write(JSON.stringify({ laeufe }));
}

if (String(process.argv[1] ?? '').replace(/\\/g, '/').endsWith('/lebenszeichen.mjs')) {
  main().catch(e => { console.error(`::error::Lebenszeichen: ${String(e?.message ?? e).slice(0, 200)}`); process.exit(1); });
}
