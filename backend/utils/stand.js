// Stand des laufenden Codes fuer GET /health.
//
// Anlass: mehrere Deployments, bei denen sich nicht belegen liess, welcher
// Commit eigentlich lief - gcloud, gh und die Actions-Logs stehen uns dafuer
// nicht zur Verfuegung. Darum sagt das Backend es selbst.
//
// MC_COMMIT und MC_GEBAUT kommen als Build-Arg ins Image (Dockerfile: ARG ->
// ENV, gesetzt in .github/workflows/deploy-backend.yml). Sie gehoeren damit zum
// Image und ueberleben einen Redeploy derselben Revision.
//
// Bewusst nur diese zwei Werte: das Repo und seine Actions-Logs sind
// oeffentlich, /health ist ohne API-Key erreichbar. Keine weitere Umgebung,
// keine Konfiguration.

const UNBEKANNT = 'unbekannt';

export function leseStand(env = process.env) {
  const sha    = String(env.MC_COMMIT ?? '').trim().toLowerCase();
  const gebaut = String(env.MC_GEBAUT ?? '').trim();

  return {
    commit: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : UNBEKANNT,
    gebaut: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(gebaut)
      ? gebaut
      : UNBEKANNT,
  };
}

export function healthHandler(_req, res) {
  res.json({ status: 'ok', ts: Date.now(), ...leseStand() });
}
