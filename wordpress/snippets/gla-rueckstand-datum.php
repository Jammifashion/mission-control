<?php
/**
 * GLA – Lieferdatum für Rückstand (BO7-5)
 *
 * Zweck
 *   Eine Variation (oder ein einfacher Artikel) auf „Lieferrückstand“ geht an Google als `backorder`. Google verlangt
 *   dazu ein `availability_date`; ohne Datum scheitert schon die Vorprüfung im Plugin („Availability date is required …“)
 *   und die Variation wird nicht gesendet. Dieses Snippet setzt für solche Artikel ein ERRECHNETES Datum:
 *     heute + Lieferzeit (German Market `_lieferzeit`), mindestens 26 Tage, aufgerundet auf den nächsten Montag 00:00 UTC.
 *   Die Verfügbarkeit bleibt `backorder` – genau das, was die Produktseite zeigt („Lieferrückstand“). Kein Umbiegen auf
 *   `in_stock` (Feed und Seite müssen übereinstimmen, Google Merchant Center Hilfe 6324448 / 12470049).
 *
 * Warum so
 *   - Der Filter `woocommerce_gla_product_attribute_values` läuft im Plugin VOR der Vorprüfung (WCProductAdapter::
 *     override_attributes) und noch einmal beim Bau der Merchant-API-Daten (WCProductInputAdapter::override_attributes).
 *     Das Plugin selbst macht es für „WooCommerce Pre-Orders“ genauso (Integration/WooCommercePreOrders.php).
 *   - Mindestens 26 Tage: Das Plugin sendet Artikel spätestens nach 25 Tagen neu (Job resubmit_expiring, täglich 03:00
 *     UTC) – das Datum bei Google liegt so nie in der Vergangenheit.
 *   - Auf Montag gerundet: Das Datum fließt in die Prüfsumme (sync_hash). Ändert es sich nur einmal je Woche, löst ein
 *     Speichern innerhalb derselben Woche keinen zusätzlichen Versand aus.
 *   - Ein von Hand gesetztes Datum (Feld „Availability date“ im Reiter Google for WooCommerce, Meta
 *     `_wc_gla_availabilityDate`) hat immer Vorrang; ein Datum aus einem anderen Filter ebenfalls.
 *   - Nur bei Rückstand: Das Plugin sendet ein gesetztes Datum sonst auch bei „vorrätig“ mit.
 *
 * Geprüft gegen
 *   Google for WooCommerce (google-listings-and-ads) 3.10.0, WooCommerce 11.2.2, German Market (`_lieferzeit` = Term-ID,
 *   "-1" = vom Elternartikel). Bei einer neuen Plugin-Version: Filtername und Schlüssel `availabilityDate` prüfen.
 *
 * Ausführung (Code Snippets)
 *   „Überall ausführen“ (Run snippet everywhere). Der Abgleich läuft im Hintergrund (Action Scheduler über WP-Cron bzw.
 *   admin-ajax) – „Nur im Administrationsbereich“ würde einen Teil der Läufe verpassen. Im Frontend tut das Snippet
 *   nichts (der Filter wird dort nie aufgerufen).
 *
 * Schreibt nichts in die Datenbank. Rückweg: Snippet deaktivieren und die betroffenen Artikel einmal speichern.
 * Quelle im Repo: wordpress/snippets/gla-rueckstand-datum.php (mission-control). Kein Child-Theme, nie functions.php.
 */

add_filter( 'woocommerce_gla_product_attribute_values', function ( $attributes, $product = null, $adapter = null ) {
	if ( ! is_array( $attributes ) ) {
		$attributes = array();
	}
	if ( ! ( $product instanceof WC_Product ) || ! $product->is_on_backorder( 1 ) ) {
		return $attributes;   // nur Rückstand
	}
	if ( ! empty( $attributes['availabilityDate'] ) ) {
		return $attributes;   // ein anderer Filter hat schon ein Datum gesetzt
	}
	if ( '' !== trim( (string) $product->get_meta( '_wc_gla_availabilityDate', true ) ) ) {
		return $attributes;   // von Hand gesetztes Datum hat Vorrang (das Plugin liest es selbst)
	}

	$mindest_tage = 26;    // > 25 Tage (resubmit_expiring)
	$hoechst_tage = 358;   // Google: höchstens 1 Jahr in der Zukunft (+ bis zu 6 Tage Aufrunden auf Montag)

	// Lieferzeit (German Market): Term-ID an der Variation, "-1"/leer = vom Elternartikel.
	$lieferzeit = trim( (string) $product->get_meta( '_lieferzeit', true ) );
	if ( ( '' === $lieferzeit || '-1' === $lieferzeit ) && $product->get_parent_id() ) {
		$lieferzeit = trim( (string) get_post_meta( $product->get_parent_id(), '_lieferzeit', true ) );
	}
	$tage = 0;
	if ( ctype_digit( $lieferzeit ) ) {
		$term = get_term( (int) $lieferzeit );
		if ( $term && ! is_wp_error( $term ) && preg_match_all( '/\d+/', $term->name, $zahlen ) ) {
			$n = (int) max( $zahlen[0] );   // obere Grenze der Spanne, z. B. "ca. 5-6 Wochen" -> 6
			if ( preg_match( '/woche/i', $term->name ) ) {
				$tage = $n * 7;
			} elseif ( preg_match( '/werktag/i', $term->name ) ) {
				$tage = (int) ceil( $n * 7 / 5 );
			} elseif ( preg_match( '/tag/i', $term->name ) ) {
				$tage = $n;
			}
		}
	}
	$tage = min( max( $tage, $mindest_tage ), $hoechst_tage );

	// heute (UTC) + Tage, auf den nächsten Montag 00:00 UTC aufgerundet
	$ziel      = strtotime( gmdate( 'Y-m-d' ) . ' 00:00:00 UTC' ) + $tage * DAY_IN_SECONDS;
	$wochentag = (int) gmdate( 'N', $ziel );   // 1 = Montag … 7 = Sonntag
	if ( 1 !== $wochentag ) {
		$ziel += ( 8 - $wochentag ) * DAY_IN_SECONDS;
	}

	$attributes['availabilityDate'] = gmdate( 'Y-m-d\TH:i:s\Z', $ziel );   // ISO 8601 UTC, als String
	return $attributes;
}, 20, 3 );
