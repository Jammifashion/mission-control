// Partner-Eigenauftrag (Portal): Grenzen der Eingaben, geprueft in routes/partnerPortal.js.

// Höchstlängen je Freitextfeld des Eigenauftrags (Zeichen nach trim).
export const EIGENAUFTRAG_LAENGEN = {
  artikel: 200, varianten: 500, lieferName: 150, lieferStrasse: 150,
  lieferPlzOrt: 150, wunschtermin: 30, anmerkungen: 1000,
};
export const EIGENAUFTRAG_MENGE_MAX = 100000;
const EIGENAUFTRAG_FELDNAMEN = {
  artikel: 'Artikel', varianten: 'Varianten', lieferName: 'Name', lieferStrasse: 'Straße',
  lieferPlzOrt: 'PLZ & Ort', wunschtermin: 'Wunschtermin', anmerkungen: 'Anmerkungen',
};
// Liefert den Namen des ersten zu langen Felds (mit Grenze) oder ''.
export function eigenauftragZuLang(body = {}) {
  for (const [feld, max] of Object.entries(EIGENAUFTRAG_LAENGEN)) {
    const wert = (body?.[feld] ?? '').toString().trim();
    if (wert.length > max) return `${EIGENAUFTRAG_FELDNAMEN[feld]} (höchstens ${max} Zeichen)`;
  }
  return '';
}
