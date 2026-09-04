import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { DEFAULT_MODELS, getModelInfo } from '../lib/modelConfig.js';

const pad = (str, len) => String(str).padEnd(len, ' ');

// ── Report (exportiert für Tests/Wiederverwendung) ─────────────────────────────
// Diagnose-Skript: zeigt nur, welches Modell pro Rolle aktuell aufgelöst wird
// und woher (Sheet oder Code-Fallback). Kein Wächter – prüft nicht, ob das
// gegen die Anthropic Models API gültig ist (siehe check-models.js dafür).
export async function runCheck() {
  console.log('== Mission Control – Config-Check (Modell-Zuordnung) ==');
  console.log(`Zeitpunkt: ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  const rollen = Object.keys(DEFAULT_MODELS);
  const infos  = await Promise.all(rollen.map(rolle => getModelInfo(rolle)));

  console.log(`  ${pad('Rolle', 20)} ${pad('Modell', 28)} Quelle`);
  console.log(`  ${'-'.repeat(20)} ${'-'.repeat(28)} ${'-'.repeat(8)}`);
  infos.forEach(({ rolle, modell, quelle }) => {
    console.log(`  ${pad(rolle, 20)} ${pad(modell, 28)} ${quelle}`);
  });

  const ausSheet    = infos.filter(i => i.quelle === 'sheet').length;
  const ausFallback = infos.filter(i => i.quelle === 'fallback').length;

  console.log('\n' + '='.repeat(70));
  console.log(`Zusammenfassung: ${infos.length} Rollen – ${ausSheet} aus Sheet, ${ausFallback} aus Code-Fallback.`);

  return 0;
}

// ── Direktausführung (node backend/scripts/check-config.js) ──────────────────
// Diagnose-Skript: Exit-Code immer 0, auch bei internen Fehlern – es meldet,
// es wächtert nicht (anders als check-models.js).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === __filename || __filename.endsWith(process.argv[1].replace(/\\/g, '/')))) {
  runCheck()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('FEHLER:', err.message ?? err);
      process.exit(0);
    });
}
