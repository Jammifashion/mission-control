import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth.js';
import Anthropic from '@anthropic-ai/sdk';

const TAB_CONFIG = 'Config';
const PREFIX     = 'modell.';

// ── Config-Sheet lesen ──────────────────────────────────────────────────────
// Bewusst KEIN Rückgriff auf modelConfig.js#getModel(): jene Funktion
// schluckt Sheet-Fehler und fällt still auf DEFAULT_MODELS zurück – richtig
// für Laufzeitcode, falsch für dieses Monitoring-Skript. Ein nicht
// erreichbares Sheet soll den Check laut fehlschlagen lassen (Exit-Code 2),
// nicht "0 Einträge gefunden" melden.
async function loadModelRows() {
  const sheetId = process.env.BUSINESS_SHEET_ID;
  if (!sheetId) throw new Error('BUSINESS_SHEET_ID fehlt in .env');

  const auth   = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB_CONFIG}!A:E`,
  });

  const [header, ...rawRows] = data.values ?? [];
  if (!header) {
    throw new Error(`Reiter "${TAB_CONFIG}" ist leer oder existiert nicht. Erst backend/scripts/setup-config-sheet.js ausführen.`);
  }

  const h = col => header.indexOf(col);
  const iSchluessel = h('Schlüssel');
  const iWert       = h('Wert');
  if (iSchluessel === -1 || iWert === -1) {
    throw new Error(`Reiter "${TAB_CONFIG}" hat keine Spalten "Schlüssel"/"Wert".`);
  }

  const rows = rawRows.filter(r => r.some(c => c) && !(r[0] ?? '').startsWith('//'));

  const entries = [];
  rows.forEach(r => {
    const schluessel = String(r[iSchluessel] ?? '').trim();
    if (!schluessel.startsWith(PREFIX)) return;
    const rolle = schluessel.slice(PREFIX.length).trim();
    const wert  = String(r[iWert] ?? '').trim();
    if (!rolle || !wert) return;
    entries.push({ rolle, wert });
  });

  return entries;
}

// ── Anthropic Models List ─────────────────────────────────────────────────────
async function loadAnthropicModels() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY fehlt in .env');
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const models = [];
  for await (const model of client.models.list()) {
    models.push(model);
  }
  return models;
}

const isAnthropicId = wert => /^claude-/i.test(wert);
const pad = (str, len) => String(str).padEnd(len, ' ');

// ── Report + Exit-Code (exportiert für Tests/Wiederverwendung) ────────────────
export async function runCheck() {
  console.log('== Mission Control – Modell-Check (Anthropic) ==');
  console.log(`Zeitpunkt: ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  const entries = await loadModelRows();
  if (entries.length === 0) {
    console.log(`Keine "${PREFIX}*"-Zeilen im Config-Sheet gefunden. Nichts zu prüfen.`);
    return 0;
  }

  const anthropicEntries = entries.filter(e => isAnthropicId(e.wert));
  const otherEntries     = entries.filter(e => !isAnthropicId(e.wert));

  let liveModels;
  try {
    liveModels = await loadAnthropicModels();
  } catch (e) {
    throw new Error(`Anthropic Models API nicht erreichbar: ${e.message}`);
  }
  const liveIds = new Set(liveModels.map(m => m.id));

  console.log(`Anthropic Models API: ${liveModels.length} Modelle verfügbar.\n`);

  console.log('── Konfigurierte Anthropic-Modelle ' + '─'.repeat(35));
  let missingCount = 0;
  if (anthropicEntries.length === 0) {
    console.log('  (keine Anthropic-Einträge im Sheet)');
  }
  anthropicEntries.forEach(({ rolle, wert }) => {
    const ok = liveIds.has(wert);
    if (!ok) missingCount++;
    console.log(`  ${ok ? '✓' : '✗'} ${pad(rolle, 20)} ${pad(wert, 28)} ${ok ? 'OK' : 'FEHLT in Anthropic Models API!'}`);
  });

  if (otherEntries.length > 0) {
    console.log('\n── Nicht geprüft (kein Anthropic-Modell) ' + '─'.repeat(29));
    otherEntries.forEach(({ rolle, wert }) => {
      console.log(`  – ${pad(rolle, 20)} ${wert}`);
    });
  }

  const usedIds   = new Set(anthropicEntries.map(e => e.wert));
  const newModels = liveModels.filter(m => !usedIds.has(m.id));
  console.log('\n── Neue Anthropic-Modelle (in keiner Rolle konfiguriert) ' + '─'.repeat(13));
  if (newModels.length === 0) {
    console.log('  (keine)');
  } else {
    newModels.forEach(m => {
      console.log(`  ℹ ${pad(m.id, 28)} ${m.display_name ?? ''}`);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Zusammenfassung: ${anthropicEntries.length - missingCount}/${anthropicEntries.length} konfigurierte Anthropic-Modelle gültig, ${newModels.length} neue Modelle noch ungenutzt.`);

  if (missingCount > 0) {
    console.log(`FEHLER: ${missingCount} konfigurierte Modell-ID(s) existieren nicht mehr in der Anthropic Models API.`);
    return 1;
  }

  console.log('Alle konfigurierten Anthropic-Modelle sind aktuell gültig.');
  return 0;
}

// ── Direktausführung (node backend/scripts/check-models.js) ──────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === __filename || __filename.endsWith(process.argv[1].replace(/\\/g, '/')))) {
  runCheck()
    .then(code => process.exit(code))
    .catch(err => {
      console.error('FEHLER:', err.message ?? err);
      process.exit(2);
    });
}
