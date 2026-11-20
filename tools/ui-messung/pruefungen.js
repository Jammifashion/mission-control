// Laeuft IM Browser (page.evaluate). Liefert Funde je Pruefung fuer den sichtbaren Bereich `wurzelSel`.
// Rueckgabe: { funde: [{ art, sel, text, rect, detail }], karten: [...], seiteRollt }
(({ wurzelSel, mobil }) => {
  const W = innerWidth;
  const wurzeln = [...document.querySelectorAll(wurzelSel)].filter(sichtbar);
  const funde = [];
  function sichtbar(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.closest('[hidden]')) return false;
    // UI1-Artefakte vermeiden: unsichtbare Vorfahren (opacity 0), zugeklappte <details>, weggerollt/abgeschnitten im Vorfahren
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const ec = getComputedStyle(e);
      if (ec.display === 'none' || Number(ec.opacity) === 0 || ec.visibility === 'hidden') return false;
      if (e.tagName === 'DETAILS' && !e.open && !e.querySelector(':scope > summary')?.contains(el)) return false;
      if (ec.overflowX !== 'visible' || ec.overflowY !== 'visible') {
        const p = e.getBoundingClientRect();
        if (r.bottom <= p.top + 1 || r.top >= p.bottom - 1 || r.right <= p.left + 1 || r.left >= p.right - 1) return false;
      }
    }
    return true;
  }
  function sel(el) {
    const teile = [];
    let e = el;
    for (let i = 0; e && e !== document.body && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { teile.unshift(s + '#' + e.id); break; }
      const k = [...e.classList].filter(c => !/^(active|is-|open)/.test(c)).slice(0, 2);
      if (k.length) s += '.' + k.join('.');
      teile.unshift(s);
    }
    return teile.join(' > ');
  }
  const txt = el => (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const klebt = el => { for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'sticky') return e; return null; };
  const rollt = el => { for (let e = el.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return e; } return null; };

  const alle = wurzeln.flatMap(w => [w, ...w.querySelectorAll('*')]).filter(e => !['SCRIPT', 'STYLE', 'OPTION', 'svg', 'path', 'BR'].includes(e.tagName) && !e.closest('svg'));
  const sichtbare = alle.filter(sichtbar);

  // 1) Ueberlauf: Inhalt breiter als der Kasten
  for (const el of sichtbare) {
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents') continue;
    if (el.scrollWidth <= el.clientWidth + 2 || el.clientWidth === 0) continue;
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName)) continue;
    const ox = cs.overflowX;
    if (ox === 'auto' || ox === 'scroll') continue;   // gewolltes Rollen
    if (ox === 'hidden' || ox === 'clip') {
      if (cs.textOverflow === 'ellipsis') continue;   // gewollt gekuerzt
      funde.push({ art: 'abgeschnitten', sel: sel(el), text: txt(el), rect: box(el), detail: `${el.scrollWidth} > ${el.clientWidth}px, overflow hidden` });
      continue;
    }
    // sichtbarer Ueberlauf: welches Kind ragt heraus?
    const r = el.getBoundingClientRect();
    let kind = null, mx = r.right;
    for (const c of el.children) { const cr = c.getBoundingClientRect(); if (cr.width && cr.right > mx + 1) { mx = cr.right; kind = c; } }
    if (!kind && el.children.length) continue;   // Ursache tiefer -> dort gemeldet
    funde.push({ art: 'ueberlauf', sel: sel(el), text: txt(kind ?? el), rect: box(el), detail: `${el.scrollWidth} > ${el.clientWidth}px` + (kind ? `, Kind ${sel(kind)}` : ', Text') });
  }
  // 1b) Auswahlfeld/Platzhalter: Text breiter als die Innenflaeche (Browser schneidet still ab)
  const cv = document.createElement('canvas').getContext('2d');
  for (const el of sichtbare.filter(e => e.matches('select, input[type=text], input[type=search], input:not([type]), input[type=email], input[type=tel], textarea'))) {
    const cs = getComputedStyle(el);
    const t = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text ?? '') : (!el.value ? (el.placeholder ?? '') : '');
    if (!t || el.tagName === 'TEXTAREA') continue;
    cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const breit = cv.measureText(t).width;
    const pfeil = el.tagName === 'SELECT' ? Math.max(parseFloat(cs.paddingRight), 20) : parseFloat(cs.paddingRight);
    const frei = el.clientWidth - parseFloat(cs.paddingLeft) - pfeil;
    if (breit > frei + 1) funde.push({ art: el.tagName === 'SELECT' ? 'auswahl-abgeschnitten' : 'platzhalter-abgeschnitten', sel: sel(el), text: t.slice(0, 80), rect: box(el), detail: `Text ${Math.round(breit)}px, Platz ${Math.round(frei)}px` });
  }
  // 2) Knopf-Text abgeschnitten / Knopf ueber den Rand
  for (const el of sichtbare.filter(e => e.matches('button, .btn, a.korb-aktion, [role=button]'))) {
    if (el.scrollWidth > el.clientWidth + 2) funde.push({ art: 'knopf-zu-schmal', sel: sel(el), text: txt(el), rect: box(el), detail: `${el.scrollWidth} > ${el.clientWidth}px` });
  }
  // 3) ragt ueber den rechten Bildschirmrand (nicht in rollendem Behaelter)
  for (const el of sichtbare) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && r.left < W && !rollt(el) && getComputedStyle(el).position !== 'fixed') {
      if ([...el.children].some(c => c.getBoundingClientRect().right > W + 1)) continue;   // nur das innerste
      funde.push({ art: 'rand-rechts', sel: sel(el), text: txt(el), rect: box(el), detail: `rechts ${Math.round(r.right)} > ${W}px` });
    }
  }
  // 4) Ueberlappung von Bedienelementen
  const bed = sichtbare.filter(e => e.matches('button, input:not([type=hidden]), select, textarea, a[href], label'));
  for (let i = 0; i < bed.length; i++) for (let j = i + 1; j < bed.length; j++) {
    const a = bed[i], b = bed[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (klebt(a) !== klebt(b)) continue;   // Inhalt rollt gewollt unter einem klebenden Fuss/Kopf (position: sticky) durch
    if (a.tagName === 'LABEL' && (a.control === b)) continue;
    if (b.tagName === 'LABEL' && (b.control === a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 4 && iy > 4) funde.push({ art: 'ueberlappung', sel: sel(a) + ' ⟂ ' + sel(b), text: txt(a) + ' | ' + txt(b), rect: box(a), detail: `${Math.round(ix)}×${Math.round(iy)}px` });
  }
  // 5) Handy: Schrift < 12 px, Tippflaechen < 40 px
  if (mobil) {
    const gesehen = new Set();
    for (const el of sichtbare) {
      const hatText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!hatText) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12 && !gesehen.has(sel(el))) { gesehen.add(sel(el)); funde.push({ art: 'schrift-klein', sel: sel(el), text: txt(el), rect: box(el), detail: `${fs}px` }); }
    }
    for (const el of sichtbare.filter(e => e.matches('button, a[href], select, input[type=checkbox], input[type=radio], [role=button]'))) {
      let r = el.getBoundingClientRect();
      const lab = el.closest('label');                          // Haken im Label: Label ist die Tippflaeche
      if (lab && el.matches('input')) r = lab.getBoundingClientRect();
      const kurz = Math.min(r.height, r.width);
      if (kurz < 44) {
        const inText = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        // tippflaeche = unter 40 px (UI1-Grenze), tippflaeche-44 = 40-43 px (AH1-Ziel fuer Knoepfe im Auftragsdialog)
        const art = inText ? 'tippflaeche-link' : kurz < 40 ? 'tippflaeche' : 'tippflaeche-44';
        funde.push({ art, sel: sel(el), text: txt(el), rect: box(el), detail: `${Math.round(r.width)}×${Math.round(r.height)}px` });
      }
    }
    // 5b) Handy: Eingabefelder unter 16 px Schrift -> iPhone zoomt beim Antippen
    for (const el of sichtbare.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea'))) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) funde.push({ art: 'feld-zoom', sel: sel(el), text: txt(el), rect: box(el), detail: `${fs}px` });
    }
  }
  // 6) Kontrast
  const farbe = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  function hintergrund(el) {
    const schichten = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.startsWith('linear')) return null;
      const c = farbe(cs.backgroundColor);
      if (c && c[3] > 0) { schichten.push(c); if (c[3] >= 1) break; }
    }
    let r = [255, 255, 255];
    for (const c of schichten.reverse()) r = r.map((v, i) => c[i] * c[3] + v * (1 - c[3]));
    return r;
  }
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const kseen = new Set();
  for (const el of sichtbare) {
    if (!['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName) && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[disabled], [aria-disabled=true]')) continue;
    const cs = getComputedStyle(el);
    const vg = farbe(cs.color); const hg = hintergrund(el);
    if (!vg || !hg) continue;
    const v = vg.slice(0, 3).map((x, i) => x * vg[3] + hg[i] * (1 - vg[3]));
    const k = (Math.max(lum(v), lum(hg)) + 0.05) / (Math.min(lum(v), lum(hg)) + 0.05);
    const fs = parseFloat(cs.fontSize), gross = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
    const soll = gross ? 3 : 4.5;
    const key = sel(el) + cs.color;
    if (k < soll && !kseen.has(key)) { kseen.add(key); funde.push({ art: 'kontrast', sel: sel(el), text: txt(el), rect: box(el), detail: `${k.toFixed(2)}:1 (soll ${soll}) ${cs.color} auf rgb(${hg.map(Math.round)})` }); }
  }
  // 6b) Zusammengedrueckte und leere Felder (UI2 Teil 3): Eingabe/Auswahl/Anzeigefeld < 28 px hoch,
  //     oder ohne Inhalt UND ohne Platzhalter (Anzeigefelder = .form-input/.form-select, die kein Eingabeelement sind)
  for (const el of sichtbare.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]), select, textarea, .form-input, .form-select'))) {
    const r = el.getBoundingClientRect();
    if (r.height < 28) { funde.push({ art: 'feld-gequetscht', sel: sel(el), text: txt(el), rect: box(el), detail: `${Math.round(r.width)}×${Math.round(r.height)}px` }); continue; }
    const eingabe = el.matches('input, select, textarea');
    const leer = eingabe ? (el.tagName === 'SELECT' ? !(el.selectedOptions[0]?.text ?? '').trim() : !el.value && !el.placeholder)
      : !el.textContent.trim() && !el.querySelector('input, select, textarea, img');
    if (leer && (!eingabe || el.readOnly || el.disabled || el.tagName === 'SELECT')) {
      funde.push({ art: 'feld-leer', sel: sel(el), text: '', rect: box(el), detail: `${Math.round(r.width)}×${Math.round(r.height)}px, ohne Inhalt und Platzhalter` });
    }
  }
  // 6c) Ausrichtung (UI2 Teil 3): Bloecke im Panel ausserhalb jeder Karte, die breiter sind als die Karten direkt davor/danach
  //     (die Nachbarn zaehlen, nicht die breiteste Karte des Panels - weiter unten darf eine breite Tabelle stehen)
  for (const w of wurzeln) {
    if (!w.matches('.panel')) continue;
    const kartenW = [...w.querySelectorAll('.card')].filter(c => sichtbar(c) && !c.parentElement.closest('.card'));
    if (!kartenW.length) continue;
    const NAV = '.sub-tabs, .mode-toggle, #bereich-leiste, .hilfe-legende';
    const kandidaten = [...w.querySelectorAll('*')].filter(e => sichtbar(e) && !e.closest('.card') && !e.querySelector('.card')
      && !e.closest(NAV) && !['inline', 'contents'].includes(getComputedStyle(e).display));
    for (const e of kandidaten) {
      if (kandidaten.includes(e.parentElement)) continue;   // nur der aeusserste Block
      const vor = kartenW.filter(c => c.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
      const nach = kartenW.find(c => c.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING);
      const ref = Math.max(...[vor, nach].filter(Boolean).map(c => c.getBoundingClientRect().width));
      const b = e.getBoundingClientRect().width;
      if (b > ref + 4) funde.push({ art: 'ausrichtung', sel: sel(e), text: txt(e), rect: box(e), detail: `${Math.round(b)}px breit, Karten davor/danach ${Math.round(ref)}px` });
    }
  }
  // 7) Karten: Breite, max-width-Regel, ungenutzter Platz, umgebrochene Tabellenzellen
  const karten = [];
  for (const w of wurzeln) for (const c of w.querySelectorAll('.card')) {
    if (!sichtbar(c) || c.parentElement.closest('.card')) continue;
    const cs = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    const eltern = c.parentElement.getBoundingClientRect();
    let umbruch = 0, zellen = 0;
    for (const td of c.querySelectorAll('td, th, .ku-zeile, .au-zeile, li')) {
      if (!sichtbar(td)) continue; zellen++;
      const lh = parseFloat(getComputedStyle(td).lineHeight) || parseFloat(getComputedStyle(td).fontSize) * 1.3;
      if (td.getBoundingClientRect().height > lh * 2.2 && td.innerText.length < 200) umbruch++;
    }
    karten.push({ sel: sel(c), titel: (c.querySelector('h2,h3,.card-title')?.innerText || '').trim().slice(0, 50),
      klasse: c.classList.contains('inhalt-breit') ? 'inhalt-breit' : c.classList.contains('inhalt-liste') ? 'inhalt-liste' : 'karten-max-breite',
      maxWidth: cs.maxWidth, breite: Math.round(r.width), frei: Math.round(eltern.right - r.right), umbruch, zellen,
      innenUeberlauf: c.scrollWidth > c.clientWidth + 2 });
  }
  return { funde, karten, seiteRollt: document.documentElement.scrollWidth > W + 1 ? document.documentElement.scrollWidth : 0, hoehe: document.documentElement.scrollHeight };
})
