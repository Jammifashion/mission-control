// Maskierung der Fehlerausgabe in den Workflows (oeffentliches Actions-Log).
import { maskiere, kuerze, fehlerZeile, MAX_ZEICHEN } from '../../.github/scripts/antwort-fehler.mjs';

describe('maskiere', () => {
  test('Ziffernfolgen ab 6 Stellen', () => {
    expect(maskiere('Projekt 181760755456 Quota')).toBe('Projekt … Quota');
    expect(maskiere('Code 12345 bleibt')).toContain('12345');
  });

  test('ID-artige Kennungen', () => {
    for (const id of ['P-001', 'FP-001', 'JFN-2026-0247', 'gla_21173']) {
      expect(maskiere(`Fehler bei ${id} aufgetreten`)).toBe('Fehler bei … aufgetreten');
    }
  });

  test('Zahl hinter ID/Bestellung/Produkt/Partner', () => {
    expect(maskiere('Produkt 21164 nicht gefunden')).toBe('Produkt … nicht gefunden');
    expect(maskiere('Bestellung #21160 fehlt')).toBe('Bestellung #… fehlt');
    expect(maskiere('Produkt-ID 13337')).toBe('Produkt-ID …');
  });

  test('lange undurchsichtige Zeichenketten (Sheet-ID, Token)', () => {
    const sheet = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(maskiere(`Tabelle ${sheet} nicht lesbar`)).toBe('Tabelle … nicht lesbar');
  });

  test('URLs und Mailadressen', () => {
    expect(maskiere('siehe https://example.run.app/api/x?a=1 bitte')).toBe('siehe <url> bitte');
    expect(maskiere('an kunde@example.de gesendet')).toBe('an <mail> gesendet');
  });

  test('normaler Fehlertext bleibt lesbar', () => {
    const t = 'Quota exceeded for quota metric Read requests per minute';
    expect(maskiere(t)).toBe(t);
    expect(maskiere('Requested entity was not found.')).toBe('Requested entity was not found.');
    expect(maskiere('Tab Partner_Verkäufe ohne Spalte Sperre')).toBe('Tab Partner_Verkäufe ohne Spalte Sperre');
  });

  test('HTML-Seite der Infrastruktur wird zu Text', () => {
    expect(maskiere('<html><body><h1>500 Server Error</h1>\n<p>Fehler</p></body></html>')).toBe('500 Server Error Fehler');
  });
});

describe('fehlerZeile', () => {
  test('JSON mit error: HTTP-Code plus dessen Text', () => {
    expect(fehlerZeile(500, JSON.stringify({ error: 'Quota exceeded 123456789' })))
      .toBe('Antwort (HTTP 500): Quota exceeded …');
  });

  test('Rohtext, wenn kein JSON', () => {
    expect(fehlerZeile('503', 'Service Unavailable')).toBe('Antwort (HTTP 503): Service Unavailable');
  });

  test('leere Antwort und fehlender Code', () => {
    expect(fehlerZeile('', '')).toBe('Antwort (HTTP ?): (leer)');
  });

  test('auf 300 Zeichen gekuerzt, Marker zaehlt mit', () => {
    const z = fehlerZeile(500, 'Fehler '.repeat(200));
    const text = z.replace('Antwort (HTTP 500): ', '');
    expect(text.length).toBeLessThanOrEqual(MAX_ZEICHEN);
    expect(text.endsWith('[gekuerzt]')).toBe(true);
    expect(kuerze('kurz')).toBe('kurz');
  });

  test('maskiert vor dem Kuerzen, nichts Langes rutscht durch', () => {
    const body = 'x '.repeat(140) + 'JFN-2026-0247 ' + '1234567890123456';
    expect(fehlerZeile(500, body)).not.toMatch(/JFN-2026-0247|1234567890/);
  });

  test('error als Objekt wird als Text ausgegeben, nicht als [object Object]', () => {
    expect(fehlerZeile(400, JSON.stringify({ error: { code: 400 } }))).not.toMatch(/object Object/);
  });
});
