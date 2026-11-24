// DK2 (24.11.): Pages-Deploy wartet, bis das hochgeladene Artefakt in der API gelistet ist (sonst "No artifacts named github-pages-N").
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const wf = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/deploy.yml'), 'utf8');

test('Warteschritt zwischen Upload und Deploy, gleicher Artefaktname, Leserecht fuer Actions', () => {
  const upload = wf.indexOf('- name: Upload artifact'), warten = wf.indexOf('- name: Auf Artefakt warten'), deploy = wf.indexOf('- name: Deploy to GitHub Pages');
  expect(upload).toBeGreaterThan(0);
  expect(warten).toBeGreaterThan(upload);
  expect(deploy).toBeGreaterThan(warten);
  expect(wf.slice(warten, deploy)).toContain('NAME: github-pages-${{ github.run_attempt }}');
  expect(wf.slice(warten, deploy)).toMatch(/exit 1/);
  expect(wf).toMatch(/permissions:[\s\S]*actions: read/);
});
