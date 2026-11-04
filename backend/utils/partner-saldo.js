// Saldo eines Lizenzpartners (PP1): EINE Rechnung fuer Portal (/api/partner/saldo), Abrechnung (vorschau/erstellen)
// und die Kacheln. Lizenzgebuehr (netto) der offenen Verkaeufe + MwSt, minus offene interne Bestellungen (brutto).
// Reine Logik ohne Netz. Keine Betraege ins Log.

export const round2 = n => Math.round(n * 100) / 100;

/**
 * @param {{ lizenzNetto: number, interneSumme: number, mwstProzent: number }} e
 * @returns {{ mwstProzent, lizenzNetto, lizenzBrutto, interneSumme, saldo, saldoNetto }} saldo = brutto; > 0 bekommt, < 0 schuldet
 */
export function saldoRechnung({ lizenzNetto, interneSumme, mwstProzent }) {
  const lizenzBrutto = round2(lizenzNetto * (1 + mwstProzent / 100));
  const saldo = round2(lizenzBrutto - interneSumme);
  return {
    mwstProzent, lizenzNetto: round2(lizenzNetto), lizenzBrutto, interneSumme: round2(interneSumme),
    saldo, saldoNetto: round2(saldo / (1 + mwstProzent / 100)),
  };
}

// Inhaber 04.11. (antwort-PP1): optionale Spalte im Reiter Partner, "nein" blendet NUR die Saldo-Kachel aus; leer/fehlt = ja.
export const SALDO_KACHEL_SPALTE = 'Saldo_Kachel';
const OFFEN = new Set(['offen', 'Neu']);   // interne Bestellungen: Altwert "Neu" = offen (wie migrateNeuStatus), ohne zu schreiben
const t = v => String(v ?? '').trim();

/**
 * Zahlen fuer die Startkacheln eines Partners - nur seine Zeilen.
 * "Seit der letzten Abrechnung" = Status offen (Verkaeufe: offen + gesperrt "in Prüfung" fuer die Anzahl, Saldo nur offen).
 * - bestellungen: verschiedene Order-IDs mit netto Stueckzahl > 0 (Storno-Gegenbuchungen abgezogen)
 * - intern: offene interne Bestellungen (Anzahl), internOhneBetrag: davon mit leerer Summe (zaehlen im Saldo mit 0)
 * - seit: groesstes Zeitraum-Bis seiner Abrechnungen + 1 Tag, sonst Vertrag-ab ('' wenn beides fehlt)
 * - saldoKachel: false nur bei Saldo_Kachel = "nein"
 * tabs: { verkaeufe, intern, abrechnungen, partner } je { header, rows }; hilfen: { toFloat, parseDate, toDE }
 */
export function partnerKacheln({ partnerId, tabs, mwstProzent, hilfen }) {
  const { toFloat, parseDate, toDE } = hilfen;
  const sp = tab => n => tab.header.indexOf(n);
  const v = sp(tabs.verkaeufe), i = sp(tabs.intern), a = sp(tabs.abrechnungen), p = sp(tabs.partner);
  const eigene = tabs.verkaeufe.rows.filter(r => r[v('Partner-ID')] === partnerId);
  const laufend = eigene.filter(r => ['offen', 'gesperrt'].includes(t(r[v('Status')])));
  const jeBestellung = new Map();
  for (const r of laufend) jeBestellung.set(t(r[v('Order-ID')]), (jeBestellung.get(t(r[v('Order-ID')])) ?? 0) + toFloat(r[v('Stückzahl')]));
  const lizenzNetto = eigene.filter(r => t(r[v('Status')]) === 'offen').reduce((s, r) => s + toFloat(r[v('Lizenzgebühr')]), 0);
  const intern = tabs.intern.rows.filter(r => r[i('Partner-ID')] === partnerId && OFFEN.has(t(r[i('Status')])));
  const interneSumme = intern.reduce((s, r) => s + toFloat(r[i('Summe')]), 0);
  const letzte = tabs.abrechnungen.rows.filter(r => r[a('Partner-ID')] === partnerId).map(r => parseDate(r[a('Zeitraum-Bis')] ?? '')).filter(Boolean)
    .sort((x, y) => y - x)[0];
  const partner = tabs.partner.rows.find(r => r[p('Partner-ID')] === partnerId) ?? [];
  const vertrag = parseDate(partner[p('Vertrag-ab')] ?? '');
  const naechster = letzte ? new Date(letzte) : null;
  if (naechster) naechster.setDate(naechster.getDate() + 1);   // Kalendertag, auch ueber die Zeitumstellung
  const seit = naechster ? toDE(naechster) : vertrag ? toDE(vertrag) : '';
  return {
    partnerId,
    bestellungen: [...jeBestellung.values()].filter(n => n > 0).length,
    intern: intern.length,
    internOhneBetrag: intern.filter(r => t(r[i('Summe')]) === '').length,
    seit, letzteAbrechnung: !!letzte,
    saldoKachel: t(partner[p(SALDO_KACHEL_SPALTE)]).toLowerCase() !== 'nein',
    ...saldoRechnung({ lizenzNetto, interneSumme, mwstProzent }),
  };
}
