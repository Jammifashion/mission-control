import { berechnePartnerAnteil, parseKonfiguration, getKostenSatz } from '../utils/partner-kalkulation.js';
import { berechneFestpreisAnteil } from '../utils/festpreis-kalkulation.js';

const FIXKOSTEN_HEADER = ['Position', 'Wert', 'Gültig_ab', 'Gültig_bis'];

const ZERO_K = {
  herstellungsnebenkosten: 0,
  versandnebenkostenB: 0, versandnebenkostenP: 0,
  portoB: 0, portoP: 0,
  paypalProzent: 0, paypalPauschale: 0,
  mwstProzent: 19,
};

// ── Staffelpreis ──────────────────────────────────────────────────────────────

describe('getKostenSatz – Staffelpreis', () => {
  const rows = [
    ['PayPal Prozent', '1.5', '01.01.2024', ''],
    ['PayPal Prozent', '2.0', '01.06.2024', ''],
  ];

  test('gibt ältere Rate vor dem Wechseldatum zurück', () => {
    expect(getKostenSatz(rows, FIXKOSTEN_HEADER, 'PayPal Prozent', new Date('2024-03-15'))).toBe(1.5);
  });

  test('gibt neuere Rate ab dem Wechseldatum zurück', () => {
    expect(getKostenSatz(rows, FIXKOSTEN_HEADER, 'PayPal Prozent', new Date('2024-07-01'))).toBe(2.0);
  });

  test('gibt null zurück wenn kein Eintrag passt', () => {
    expect(getKostenSatz(rows, FIXKOSTEN_HEADER, 'Porto B', new Date('2024-07-01'))).toBeNull();
  });

  test('parseKonfiguration baut korrektes Konfig-Objekt', () => {
    const kRows = [
      ['PayPal Prozent', '1.9', '01.01.2024', ''],
      ['MwSt',           '19',  '01.01.2024', ''],
    ];
    const k = parseKonfiguration(kRows, FIXKOSTEN_HEADER);
    expect(k.paypalProzent).toBe(1.9);
    expect(k.mwstProzent).toBe(19);
  });
});

// ── PayPal auf Brutto-Basis ───────────────────────────────────────────────────

describe('berechnePartnerAnteil – PayPal auf Brutto-Basis', () => {
  test('PayPal-Prozent wird auf Brutto-VK berechnet', () => {
    const k = { ...ZERO_K, paypalProzent: 2, mwstProzent: 19 };
    const r = berechnePartnerAnteil({
      vkNetto: 100, ekPreis: 0, druckkosten: 0, versandart: 'P',
      portoModell: 'geteilt-50-50', anzahlArtikelInBestellung: 1,
      lizenzProzent: 30, konfiguration: k,
    });
    // paypalKosten = 100 * 1.19 * 0.02 = 2.38
    expect(r.paypalKosten).toBeCloseTo(2.38, 2);
  });

  test('PayPal-Pauschale wird anteilig aufgeteilt', () => {
    const k = { ...ZERO_K, paypalPauschale: 0.35, mwstProzent: 19 };
    const r = berechnePartnerAnteil({
      vkNetto: 50, ekPreis: 0, druckkosten: 0, versandart: 'P',
      portoModell: 'geteilt-50-50', bestellungsAnteil: 0.5,
      lizenzProzent: 30, konfiguration: k,
    });
    // paypalPauschale * 0.5 = 0.175 → nach round2: 0.18
    expect(r.paypalKosten).toBe(0.18);
  });
});

// ── Porto-Split ───────────────────────────────────────────────────────────────

describe('berechnePartnerAnteil – Porto-Split', () => {
  const k = { ...ZERO_K, portoP: 5 };

  test('geteilt-50-50: Partner trägt 50% des Porto-Saldos', () => {
    const r = berechnePartnerAnteil({
      vkNetto: 50, ekPreis: 10, druckkosten: 0, versandart: 'P',
      portoModell: 'geteilt-50-50', anzahlArtikelInBestellung: 1,
      lizenzProzent: 30, portoEinnahmeAnteil: 6, konfiguration: k,
    });
    // portoSaldo = 6 - 5 = 1, 50% = 0.5
    expect(r.portoSaldoPartner).toBeCloseTo(0.5, 2);
  });

  test('partner-trägt: Partner trägt 100% des Porto-Saldos', () => {
    const r = berechnePartnerAnteil({
      vkNetto: 50, ekPreis: 10, druckkosten: 0, versandart: 'P',
      portoModell: 'partner-trägt', anzahlArtikelInBestellung: 1,
      lizenzProzent: 30, portoEinnahmeAnteil: 6, konfiguration: k,
    });
    // portoSaldo = 6 - 5 = 1, 100% = 1
    expect(r.portoSaldoPartner).toBeCloseTo(1.0, 2);
  });

  test('negativer Porto-Saldo (Kosten > Einnahme) korrekt', () => {
    const r = berechnePartnerAnteil({
      vkNetto: 50, ekPreis: 10, druckkosten: 0, versandart: 'P',
      portoModell: 'geteilt-50-50', anzahlArtikelInBestellung: 1,
      lizenzProzent: 30, portoEinnahmeAnteil: 2, konfiguration: k,
    });
    // portoSaldo = 2 - 5 = -3, 50% = -1.5
    expect(r.portoSaldoPartner).toBeCloseTo(-1.5, 2);
  });
});

// ── Festpreis-Kalkulation ─────────────────────────────────────────────────────

describe('berechneFestpreisAnteil – EK + Handling + Porto', () => {
  test('netto = VK − (EK+Handling)×Stk − Mehrkosten + Porto-Saldo − PayPal', () => {
    const r = berechneFestpreisAnteil({
      vkNetto: 100, festpreisEK: 20, handlingskosten: 5,
      stueckzahl: 2, mehrkosten: 3,
      portoEinnahmeAnteil: 8, portoKostenAnteil: 6,
      versandnkAnteil: 1, paypalKosten: 2, mwstProzent: 19,
    });
    // netto = 100 − (20+5)×2 − 3 + 8 − 6 − 1 − 2 = 46
    expect(r.netto).toBeCloseTo(46, 2);
    expect(r.brutto).toBeCloseTo(46 * 1.19, 2);
  });

  test('netto-Ergebnis ist negativ wenn Kosten VK übersteigen', () => {
    const r = berechneFestpreisAnteil({
      vkNetto: 10, festpreisEK: 20, handlingskosten: 0,
      stueckzahl: 1, mehrkosten: 0,
      portoEinnahmeAnteil: 0, portoKostenAnteil: 0,
      versandnkAnteil: 0, paypalKosten: 0, mwstProzent: 19,
    });
    expect(r.netto).toBeLessThan(0);
    expect(r.brutto).toBeLessThan(0);
  });
});

// ── Storno ────────────────────────────────────────────────────────────────────

describe('Storno – Geldbeträge negiert', () => {
  test('negativer VK ergibt negativen partnerAnteil', () => {
    const positiv = berechnePartnerAnteil({
      vkNetto: 100, ekPreis: 40, druckkosten: 0, versandart: 'P',
      portoModell: 'geteilt-50-50', anzahlArtikelInBestellung: 1,
      lizenzProzent: 30, konfiguration: ZERO_K,
    });
    const storno = berechnePartnerAnteil({
      vkNetto: -100, ekPreis: -40, druckkosten: 0, versandart: 'P',
      portoModell: 'geteilt-50-50', anzahlArtikelInBestellung: 1,
      lizenzProzent: 30, konfiguration: ZERO_K,
    });
    expect(storno.partnerAnteil).toBeCloseTo(-positiv.partnerAnteil, 2);
    expect(storno.gewinnNetto).toBeCloseTo(-positiv.gewinnNetto, 2);
    expect(storno.brutto).toBeCloseTo(-positiv.brutto, 2);
  });
});

// ── Abrechnungs-Summe ─────────────────────────────────────────────────────────

describe('Abrechnungs-Summe – Invariante: partnerAnteil + eigenAnteil = gewinnNetto + portoSaldo', () => {
  const k = { ...ZERO_K, portoP: 4, paypalProzent: 1.5, paypalPauschale: 0.35 };
  const orderItems = [
    { vkNetto: 80,  ekPreis: 30, druckkosten: 5, lizenzProzent: 30 },
    { vkNetto: 50,  ekPreis: 20, druckkosten: 3, lizenzProzent: 25 },
    { vkNetto: 120, ekPreis: 45, druckkosten: 8, lizenzProzent: 35 },
  ];
  const orderTotal = orderItems.reduce((s, i) => s + i.vkNetto, 0);

  test('jede Position: partnerAnteil + eigenAnteil ≈ gewinnNetto + portoSaldo', () => {
    for (const item of orderItems) {
      const anteil = item.vkNetto / orderTotal;
      const r = berechnePartnerAnteil({
        ...item, versandart: 'P', portoModell: 'geteilt-50-50',
        bestellungsAnteil: anteil,
        portoEinnahmeAnteil: 4 * anteil,
        konfiguration: k,
      });
      const portoSaldoArtikel = r.portoEinnahmeAnteil - r.portoKostenAnteil;
      expect(r.partnerAnteil + r.eigenAnteil).toBeCloseTo(r.gewinnNetto + portoSaldoArtikel, 1);
    }
  });

  test('Summe der Positionen = Gesamt-partnerAnteil (nichts geht verloren)', () => {
    const results = orderItems.map(item => {
      const anteil = item.vkNetto / orderTotal;
      return berechnePartnerAnteil({
        ...item, versandart: 'P', portoModell: 'geteilt-50-50',
        bestellungsAnteil: anteil,
        portoEinnahmeAnteil: 4 * anteil,
        konfiguration: k,
      });
    });
    const sumNetto = Math.round(results.reduce((s, r) => s + r.netto, 0) * 100) / 100;
    const sumPartner = Math.round(results.reduce((s, r) => s + r.partnerAnteil, 0) * 100) / 100;
    // netto === partnerAnteil per Rückgabe-Objekt
    expect(sumNetto).toBe(sumPartner);
  });
});
