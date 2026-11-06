// TR8: Goalie-Hinweis erkennen - NUR LESEN, setzt nie "Goalie". Der Mensch entscheidet mit einem Klick
// ("als Goalie markieren" / "kein Goalie"). Quellen sind nur menschliche Freitexte einer Trikotzeile:
//   - Rohtext (Sync: Positions-Zusatzfelder ohne "_"-Schluessel + "Kundennotiz: …"; INT: Referenz/Notiz),
//   - Spalte "Notiz".
// Technische Felder zaehlen nie (AUSSCHLUSS: "_"-Metafelder, ppcp_*, reCAPTCHA, Zahlungs-/Tracking-Daten, MC-Vorgang).
// Stichwoerter: torwart, goalie, goali, keeper auch als Wortteil ("Torwarttrikot"); "gk" und "goal" nur als eigenes Wort
// (Punkt 0 in TR7: "gk" steckte zufaellig in einem reCAPTCHA-Wert). Ausgabe nur Fundstelle + Stichwort, nie der Text.

export const STICHWORT_TEIL = /(torwart|goalie|goali|keeper)/giu;
export const STICHWORT_WORT = /(?<![\p{L}\p{N}])(gk|goal)(?![\p{L}\p{N}])/giu;
export const AUSSCHLUSS = [/^_/, /^ppcp/i, /captcha/i, /^mc-vorgang$/i, /payment|zahlung|transaction|transaktion|tracking|sendung|paypal|stripe|klarna|token/i];

const t = v => String(v ?? '').trim();
export const technischesFeld = feld => AUSSCHLUSS.some(re => re.test(t(feld)));

/** Stichwoerter in einem Text (klein, ohne Doppel, in Fundreihenfolge). */
export function stichworte(text) {
  const s = String(text ?? '');
  const funde = [...s.matchAll(STICHWORT_TEIL), ...s.matchAll(STICHWORT_WORT)].sort((a, b) => a.index - b.index);
  return [...new Set(funde.map(m => m[1].toLowerCase()))];
}

/** Rohtext -> [{ feld, wert }]: "Feld: Wert" beginnt ein Feld, Zeilen ohne "Feld:" gehoeren zum vorigen (mehrzeilige Kundennotiz). */
export function rohtextFelder(rohtext) {
  const felder = [];
  for (const zeile of String(rohtext ?? '').split('\n')) {
    const m = zeile.match(/^([^:\n]{1,60}):\s?(.*)$/);
    if (m && !/^\s/.test(zeile)) felder.push({ feld: m[1].trim(), wert: m[2] });
    else if (felder.length) felder.at(-1).wert += `\n${zeile}`;
    else if (t(zeile)) felder.push({ feld: '', wert: zeile });
  }
  return felder;
}

/**
 * Hinweise einer Trikotzeile. z = { rohtext, notiz }.
 * @returns {Array<{ quelle: string, stichwort: string }>}  quelle = Feldname (z. B. "Kundennotiz") bzw. "Notiz (Spalte)"
 */
export function goalieHinweise({ rohtext, notiz } = {}) {
  const aus = [];
  for (const f of rohtextFelder(rohtext)) {
    if (technischesFeld(f.feld) || /^\(keine Meta-Daten/.test(t(f.wert))) continue;
    for (const s of stichworte(f.wert)) aus.push({ quelle: f.feld || 'Rohtext', stichwort: s });
  }
  for (const s of stichworte(notiz)) aus.push({ quelle: 'Notiz (Spalte)', stichwort: s });
  return aus;
}

/** Kurztext fuer den Mouse-over: "Kundennotiz: ‚torwart‘ · Notiz (Spalte): ‚gk‘" - ohne den Text selbst. */
export const hinweisText = hinweise => (hinweise ?? []).map(h => `${h.quelle}: ‚${h.stichwort}‘`).join(' · ');
