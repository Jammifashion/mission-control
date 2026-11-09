// BO7-5 Teil B: WordPress-Snippet "GLA – Lieferdatum für Rückstand" (wordpress/snippets/gla-rueckstand-datum.php).
// Lokal gibt es kein PHP - der Test sichert die Regeln am Quelltext: richtiger Filter, nur Rueckstand, Hand-Datum vor,
// mindestens 26 Tage, ISO 8601 UTC, kein Umbiegen der Verfuegbarkeit, kein Schreiben in die Datenbank.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const php = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../wordpress/snippets/gla-rueckstand-datum.php'), 'utf8');
const code = php.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');   // ohne Kommentare

test('Filter des Plugins mit 3 Argumenten, drittes ohne Typ (zwei Adapter-Klassen rufen ihn)', () => {
  expect(code).toMatch(/add_filter\(\s*'woocommerce_gla_product_attribute_values',\s*function\s*\(\s*\$attributes,\s*\$product = null,\s*\$adapter = null\s*\)/);
  expect(code).toMatch(/\},\s*20,\s*3\s*\);\s*$/);
});

test('nur Rueckstand; Hand-Datum und Datum anderer Filter haben Vorrang', () => {
  expect(code).toContain('$product->is_on_backorder( 1 )');
  expect(code).toContain("get_meta( '_wc_gla_availabilityDate', true )");
  expect(code).toContain("! empty( $attributes['availabilityDate'] )");
  const ersteZuweisung = code.indexOf("$attributes['availabilityDate'] =");
  expect(ersteZuweisung).toBeGreaterThan(code.indexOf('is_on_backorder'));
  expect(ersteZuweisung).toBeGreaterThan(code.indexOf('_wc_gla_availabilityDate'));
});

test('mindestens 26 Tage (> resubmit nach 25), hoechstens 1 Jahr, Montag, ISO 8601 UTC als String', () => {
  expect(code).toMatch(/\$mindest_tage = 26;/);
  expect(Number(code.match(/\$hoechst_tage = (\d+);/)[1]) + 6).toBeLessThanOrEqual(365);
  expect(code).toContain("gmdate( 'N', $ziel )");
  expect(code).toContain("gmdate( 'Y-m-d\\TH:i:s\\Z', $ziel )");
});

test('Lieferzeit aus German Market: Variation, sonst Elternartikel; Wochen / Werktage / Tage', () => {
  expect(code).toContain("get_meta( '_lieferzeit', true )");
  expect(code).toContain("get_post_meta( $product->get_parent_id(), '_lieferzeit', true )");
  expect(code).toMatch(/woche[\s\S]*\$n \* 7/);
  expect(code).toMatch(/werktag[\s\S]*ceil\( \$n \* 7 \/ 5 \)/);
});

test('aendert weder Verfuegbarkeit noch Datenbank', () => {
  expect(code).not.toMatch(/\['availability'\]/);
  expect(code).not.toMatch(/in_stock|IN_STOCK/);
  expect(code).not.toMatch(/update_post_meta|update_meta_data|add_post_meta|delete_post_meta|->save\(|wp_update_post|\$wpdb/);
});
