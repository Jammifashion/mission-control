// Befehl SP1: Serientitel als Fanart zulassen – nur mit woertlicher Wendung
// "Fanart zur Serie <Titel>" im Hinweisblock. Anlass BL7 (24.09.): Jack & Joker
// fiel bei 5 von 6 Artikeln aus dem Text, Keiju blieb trotz Verbot stehen.

import {
  SEO_SYSTEM_PROMPT, buildSeoUserPrompt, fanartSerien, fanartBlock,
} from '../lib/seo-prompt.js';

const basis = {
  produktname: 'Jack/Joker T-Shirt',
  kategorien: 'BoysLove (BL)',
  eigenschaften: 'Material: 100% Baumwolle\nGrammatur: 180 g/m²',
  motiv: 'Zwei Hände mit verhakten kleinen Fingern',
  modus: 'kollektion',
  farben: ['Weiß'],
  groessen: ['S', 'M'],
  keyphrase: 'Jack Joker Fanart T-Shirt',
};
const prompt = hinweise => buildSeoUserPrompt({ ...basis, hinweise }).prompt;

describe('fanartSerien', () => {
  test('Titel ohne Anfuehrungszeichen bis Zeilenende', () => {
    expect(fanartSerien('Serie/Kontext: Fanart zur Serie Jack & Joker\nKategorie: x'))
      .toEqual([{ wendung: 'Fanart zur Serie Jack & Joker', titel: 'Jack & Joker' }]);
  });

  test('Titel in „…“ bleibt samt Anfuehrungszeichen, Rest nach Gedankenstrich faellt weg', () => {
    expect(fanartSerien('Fanart zur Serie „A tale of 1000 stars“ – Gemälde von Keiju'))
      .toEqual([{ wendung: 'Fanart zur Serie „A tale of 1000 stars“', titel: '„A tale of 1000 stars“' }]);
  });

  test('Titel endet an Komma, Semikolon, Punkt, " - "', () => {
    expect(fanartSerien('Fanart zur Serie Jack & Joker, Motiv vorne').map(s => s.titel)).toEqual(['Jack & Joker']);
    expect(fanartSerien('Fanart zur Serie Jack & Joker; Rücken').map(s => s.titel)).toEqual(['Jack & Joker']);
    expect(fanartSerien('Fanart zur Serie Jack & Joker. Sonst nichts').map(s => s.titel)).toEqual(['Jack & Joker']);
    expect(fanartSerien('Fanart zur Serie Jack & Joker - Druck vorne').map(s => s.titel)).toEqual(['Jack & Joker']);
  });

  test('mehrere Serien, Dubletten nur einmal', () => {
    // SP3: Einbuchstaben-Titel sind Platzhalter – darum echte Namen.
    expect(fanartSerien('Fanart zur Serie Alpha\nFanart zur Serie Beta\nFanart zur Serie Alpha').map(s => s.titel)).toEqual(['Alpha', 'Beta']);
  });

  // SP3: Platzhalter sind kein Titel.
  test('Kategoriehinweis aus BL7 Lauf 3 -> keine Serie, kein Block', () => {
    const satz = 'Serien nur als „Fanart zur Serie …“ nennen, wenn im Motivfeld angegeben.';
    expect(fanartSerien(satz)).toEqual([]);
    expect(fanartBlock(satz)).toBe('');
    expect(buildSeoUserPrompt({ ...basis, hinweise: `Kategorie: ${satz}` }).prompt).not.toContain('FANART-SERIE');
  });

  test.each(['…', '...', '<Titel>', '[Titel]', 'X', '„…“', '"..."', '- Titel', '123'])(
    'Platzhalter "%s" wird verworfen', p => {
      expect(fanartSerien(`Fanart zur Serie ${p}`)).toEqual([]);
    });

  test('echte Titel bleiben: Buchstabe, Ziffer oder Anfuehrungszeichen am Anfang', () => {
    expect(fanartSerien('Fanart zur Serie Jack & Joker').map(s => s.titel)).toEqual(['Jack & Joker']);
    expect(fanartSerien('Fanart zur Serie 2gether').map(s => s.titel)).toEqual(['2gether']);
    expect(fanartSerien('Fanart zur Serie „A tale of 1000 stars“').map(s => s.titel)).toEqual(['„A tale of 1000 stars“']);
    expect(fanartSerien('Fanart zur Serie "Bad Buddy"').map(s => s.titel)).toEqual(['"Bad Buddy"']);
  });

  test('Platzhalter-Hinweis neben echter Serie: nur die echte zaehlt', () => {
    const h = 'Serie/Kontext: Fanart zur Serie Jack & Joker\nKategorie: Serien nur als „Fanart zur Serie …“ nennen, wenn im Motivfeld angegeben.';
    expect(fanartSerien(h).map(s => s.titel)).toEqual(['Jack & Joker']);
  });

  test('ohne woertliche Wendung: nichts', () => {
    expect(fanartSerien('Serie Jack & Joker, Fanart')).toEqual([]);
    expect(fanartSerien('Merch zur Serie Jack & Joker')).toEqual([]);
    expect(fanartSerien('')).toEqual([]);
    expect(fanartSerien(undefined)).toEqual([]);
  });
});

describe('User-Prompt', () => {
  test('Titel im Hinweis -> Block FANART-SERIE mit der Wendung in genau dieser Schreibweise', () => {
    const p = prompt('Serie/Kontext: Fanart zur Serie Jack & Joker');
    expect(p).toContain('FANART-SERIE (Ausnahme vom Titelverbot');
    expect(p).toContain('- Nenne die Serie genau in dieser Form und Schreibweise: Fanart zur Serie Jack & Joker');
    expect(p).toContain('sonst keine Aussage zu Lizenz oder Herkunft');
    expect(p).toContain('Keine Figurennamen, keine Handlung, keine Schauspieler:innen.');
  });

  test('Block steht nach KONTEXT & HINWEISE und vor PRODUKTDATEN', () => {
    const p = prompt('Fanart zur Serie Jack & Joker');
    const k = p.indexOf('KONTEXT & HINWEISE'), f = p.indexOf('FANART-SERIE ('), d = p.indexOf('PRODUKTDATEN:');
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThan(f);
    expect(f).toBeLessThan(d);
  });

  test('Titel NICHT im Hinweis -> kein Block, das Verbot im Systemprompt gilt', () => {
    for (const h of ['Serie/Kontext: BL-Insider-Spruch', 'Serie Jack & Joker', '', undefined]) {
      expect(prompt(h)).not.toContain('FANART-SERIE');
      expect(fanartBlock(h)).toBe('');
    }
  });
});

describe('Systemprompt', () => {
  // SP2: die Ausnahme steht nur noch im Block, der Systemprompt traegt allein das Verbot.
  test('Verbot bleibt, der Systemprompt kennt weder die Wendung noch den Block', () => {
    expect(SEO_SYSTEM_PROMPT).toMatch(/Keine fremden Marken, Filmtitel oder geschützten Figuren/);
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/Fanart zur Serie/i);
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/FANART-SERIE/);
  });

  test('ohne Serie steht "Fanart zur Serie" in keinem Prompt-Teil', () => {
    const p = prompt('Serie/Kontext: BL-Insider-Spruch');
    expect(`${SEO_SYSTEM_PROMPT}\n${p}`).not.toMatch(/Fanart zur Serie/i);
  });

  test('mit Serie steht die Wendung nur im Block (und im Hinweis selbst)', () => {
    const hinweis = 'Serie/Kontext: Fanart zur Serie Jack & Joker';
    const p = prompt(hinweis);
    const ohneHinweisUndBlock = p.replace(hinweis, '').replace(fanartBlock(hinweis), '');
    expect(ohneHinweisUndBlock).not.toMatch(/Fanart zur Serie/i);
    expect(fanartBlock(hinweis)).toContain('Fanart zur Serie Jack & Joker');
  });

  test('"offiziell" steht in keinem Prompt-Text (auch nicht verneint)', () => {
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/offiziell/i);
    expect(prompt('Fanart zur Serie Jack & Joker')).not.toMatch(/offiziell/i);
    expect(prompt('')).not.toMatch(/offiziell/i);
    expect(buildSeoUserPrompt({ ...basis, hinweise: 'x', modus: 'auftrag' }).prompt).not.toMatch(/offiziell/i);
  });

  test('JSON-Escape-Zeile unveraendert: im Prompt steht Backslash-n, kein echter Umbruch', () => {
    expect(SEO_SYSTEM_PROMPT).toContain('ausschließlich escaped (\\n, \\r, \\t)');
  });
});
