// Dialoge, Zustaende und Einzelseiten zusaetzlich zu den Ansichten aus BEREICHE.
// id = Ansicht + "+" + Zusatz; hash = welche Ansicht zuerst geoeffnet wird; wurzel = was gemessen wird.
const PANEL = 'main > .panel.active';
export const DLG = '.edi-dialog:not([hidden]), .modal-backdrop';
const toastsWeg = p => p.evaluate(() => document.querySelectorAll('.toast-bleibt').forEach(t => t.click()));   // MI1
const klick = s => async p => { await p.locator(s).first().click({ timeout: 3000 }); await p.waitForTimeout(900); };

// Neuer Auftrag mit Kunde und mehreren Gruppen (Modell + Farbe + Mengen), ueber die normale Oberflaeche
async function auftragMitGruppen(p, gruppen) {
  await klick('#au-neu')(p);
  await p.fill('#au-kunde-suche', 'Nordlicht');
  await p.waitForTimeout(400);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  await p.fill('#au-Kurztitel', 'Trainingsshirts Saison 2027 mit Rückennummer');
  for (const [modell, farbIndex] of gruppen) {
    await p.fill('#au-modell-suche', modell);
    await p.waitForTimeout(900);
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
    await p.waitForTimeout(900);
    const farbe = p.locator('#au-farbe');
    const optionen = await farbe.locator('option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
    if (optionen.length) await farbe.selectOption(optionen[Math.min(farbIndex, optionen.length - 1)]);
    await p.waitForTimeout(600);
    const mengen = p.locator('#au-raster input[type=number]');
    const n = await mengen.count();
    for (let i = 0; i < Math.min(n, 3); i++) await mengen.nth(i).fill(String(i + 2));
    await p.locator('#au-raster-hinzu').click();
    await p.waitForTimeout(600);
    if (gruppen.indexOf(gruppen.find(g => g[0] === modell && g[1] === farbIndex)) === 0) {   // erste Gruppe: Motiv/Druck/Preis, die weiteren uebernehmen sie (U4)
      await p.fill('[data-au-gruppe="0"][data-au-feld="motiv"]', 'Vereinswappen groß Rücken');
      await p.fill('[data-au-gruppe="0"][data-au-feld="druck"]', 'DTF Rücken A4');
      await p.fill('[data-au-gruppe="0"][data-au-feld="preis"]', '18,50');
    }
  }
}

export const ANSICHTEN_ZUSATZ = [
  // MI1: Mika - Blatt offen (ohne Antwort), mit den drei Antworten; gemessen wird nur das Mika-Fenster
  // (stehende Fehlermeldungen des Zustands "leer" liegen - wie ueber jedem Fenster - oben; vorher wegtippen, wie ein Mensch)
  { id: 'dashboard/start+mika', hash: 'dashboard/start', aktion: async p => { await toastsWeg(p); await klick('#mika-knopf')(p); }, wurzel: '#mika-fenster' },
  { id: 'dashboard/start+mika-heute', hash: 'dashboard/start', aktion: async p => { await toastsWeg(p); await klick('#mika-knopf')(p); await klick('[data-mika-frage="heute"]')(p); }, wurzel: '#mika-fenster' },
  { id: 'dashboard/start+mika-dringend', hash: 'dashboard/start', aktion: async p => { await toastsWeg(p); await klick('#mika-knopf')(p); await klick('[data-mika-frage="dringend"]')(p); }, wurzel: '#mika-fenster' },
  { id: 'auftraege/liste+mika-suche', hash: 'auftraege/liste', aktion: async p => {
      await toastsWeg(p); await klick('#mika-knopf')(p); await klick('[data-mika-frage="suche"]')(p);
      await p.fill('#mika-nummer', '48190'); await klick('#mika-suchen')(p); }, wurzel: '#mika-fenster' },
  // UB1: Ueberblick im Dashboard aufgeklappt (am Handy standardmaessig zu)
  { id: 'dashboard/start+ueberblick', hash: 'dashboard/start', aktion: async p => { await p.evaluate(() => { document.getElementById('dash-ueberblick').open = true; }); await p.waitForTimeout(300); }, wurzel: '#dash-ueberblick' },
  { id: 'auftraege/liste+ansicht', hash: 'auftraege/liste', aktion: klick('#au-ansicht [data-au-oeffnen]'), wurzel: DLG, nurVoll: true },
  { id: 'auftraege/liste+neuer-auftrag', hash: 'auftraege/liste', aktion: klick('#au-neu'), wurzel: DLG },
  // AU-UX1: Ansicht eines bestellten Auftrags (Aktionsleiste, Menue "mehr …") und sein Bearbeiten-Dialog (gesperrte Positionen)
  { id: 'auftraege/liste+ansicht-bestellt', hash: 'auftraege/liste', aktion: async p => {
      await p.evaluate(() => { const s = document.getElementById('au-f'); if (s) { s.value = 'alle'; s.dispatchEvent(new Event('change')); } }); await p.waitForTimeout(400);
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0040"]')(p);
      if (await p.locator('#au-mehr:visible').count()) await klick('#au-mehr')(p); }, wurzel: DLG, nurVoll: true },
  { id: 'auftraege/liste+bearbeiten-gesperrt', hash: 'auftraege/liste', aktion: async p => {
      await p.evaluate(() => { const s = document.getElementById('au-f'); if (s) { s.value = 'alle'; s.dispatchEvent(new Event('change')); } }); await p.waitForTimeout(400);
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0040"]')(p);
      if (await p.locator('#au-mehr:visible').count()) await klick('#au-mehr')(p);
      await klick('#au-bearbeiten')(p); }, wurzel: '#au-dialog', nurVoll: true },
  // AP1: fertiger Auftrag mit offenem Nachtrag (oranger Hinweis, Kennzeichen) und "+ Position …" im laufenden Auftrag (neue Gruppe frei)
  { id: 'auftraege/liste+ansicht-nachtrag', hash: 'auftraege/liste', aktion: async p => {
      await p.evaluate(() => { const s = document.getElementById('au-f'); if (s) { s.value = 'alle'; s.dispatchEvent(new Event('change')); } }); await p.waitForTimeout(400);
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0038"]')(p); }, wurzel: DLG, nurVoll: true },
  { id: 'auftraege/liste+plus-position', hash: 'auftraege/liste', aktion: async p => {
      await p.evaluate(() => { const s = document.getElementById('au-f'); if (s) { s.value = 'alle'; s.dispatchEvent(new Event('change')); } }); await p.waitForTimeout(400);
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0039"]')(p);
      if (await p.locator('#au-mehr:visible').count()) await klick('#au-mehr')(p);
      await klick('#au-plus-position')(p);
      await p.fill('#au-frei-text', 'Aufnäher nachbestellt'); await p.fill('#au-frei-menge', '5'); await klick('#au-frei-hinzu')(p); }, wurzel: '#au-dialog', nurVoll: true },
  // DK1: Druckkosten in der Auftragsansicht (Kalkulation offen), Dialog "Maße eingeben …", Pflege-Ansicht mit Dialog
  { id: 'auftraege/liste+ansicht-druck', hash: 'auftraege/liste', aktion: async p => {
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0041"]')(p);
      await p.evaluate(() => document.querySelectorAll('#au-d-preise details').forEach(d => { d.open = true; })); await p.waitForTimeout(300); }, wurzel: DLG, nurVoll: true },
  { id: 'auftraege/liste+druckmasse-hand', hash: 'auftraege/liste', aktion: async p => {
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0041"]')(p);
      await p.evaluate(() => document.querySelectorAll('#au-d-preise details').forEach(d => { d.open = true; }));
      await klick('#au-d-pos [data-dk-pos]')(p); await p.waitForTimeout(300); }, wurzel: '#dk-dialog', nurVoll: true },
  // DK2: Dialog mit altem Freitext ("bitte zuordnen" + Vorschlag)
  { id: 'auftraege/liste+druckmasse-zuordnen', hash: 'auftraege/liste', aktion: async p => {
      await klick('#au-ansicht [data-au-oeffnen="AU-2026-0041"]')(p);
      await klick('#au-d-pos [data-dk-pos="AU-2026-0041-16"]')(p); await p.waitForTimeout(300); }, wurzel: '#dk-dialog', nurVoll: true },
  // SA5 (FB-0003): Reiter 3 Artikeleigenschaften mit zwei Eigenschaften (Feldbreite am PC)
  { id: 'artikel/neu+eigenschaften', hash: 'artikel/neu', aktion: async p => { await klick('#btn-add-property')(p); await klick('#btn-add-property')(p);
      await p.evaluate(() => document.querySelector('.property-row')?.scrollIntoView()); }, wurzel: '#properties-container' },
  // DT1: DTF-Korb - Zuordnen, Bestellung, Scan-Karte
  { id: 'bestellen/dtf+zuordnen', hash: 'bestellen/dtf', aktion: klick('[data-dtf-zuordnen]'), wurzel: '#dtf-zu-dialog', nurVoll: true },
  { id: 'bestellen/dtf+bestellung', hash: 'bestellen/dtf', aktion: async p => { await klick('#dtf-alle-bereit')(p); await klick('#dtf-bestellen')(p); }, wurzel: '#dtf-best-dialog', nurVoll: true },
  { id: 'bestellen/dtf+scan', hash: 'dtf/scan/DTF-2026-0002-01', aktion: async p => { await p.waitForTimeout(900); }, wurzel: '#dtf-scan', nurVoll: true },
  // ZW2: SEO-Reiter mit HONK!-Zwilling (zwei Textpaare), Trefferliste am L-Shop-Feld ohne Treffer, Dialog "als Fremdware anlegen"
  { id: 'artikel/seo+zwilling', hash: 'artikel/seo', aktion: async p => { await p.selectOption('#seo-article-select', '0'); await p.waitForTimeout(1200);
      await p.evaluate(() => document.getElementById('seo-jfn-block')?.scrollIntoView()); }, wurzel: '#seo-article-panel', nurVoll: true },
  { id: 'artikel/neu+treffer', hash: 'artikel/neu', aktion: async p => { await p.locator('#pf-lshop-nr').pressSequentially('Zauberhut', { delay: 20 });
      await p.waitForTimeout(1200); }, wurzel: '#pf-lshop-treffer' },
  { id: 'artikel/neu+fremdware', hash: 'artikel/neu', aktion: async p => { await p.locator('#pf-lshop-nr').pressSequentially('Zauberhut', { delay: 20 });
      await p.waitForTimeout(1200); await p.locator('#pf-lshop-treffer .tw-zeile', { hasText: 'als Fremdware' }).click();
      await p.waitForTimeout(600); }, wurzel: '#ex-dialog' },
  { id: 'artikel/druckmasse+neu', hash: 'artikel/druckmasse', aktion: klick('#dkm-neu'), wurzel: '#dkm-dialog' },
  { id: 'artikel/druckmasse+bearbeiten', hash: 'artikel/druckmasse', aktion: klick('[data-dkm-id]'), wurzel: '#dkm-dialog', nurVoll: true },
  // PR1: Dialog 'Wie letztes Mal' mit Marge-Vergleich
  { id: 'auftraege/liste+wie-letztes-mal', hash: 'auftraege/liste', aktion: async p => { await klick('#au-ansicht [data-au-oeffnen]')(p); await klick('#au-mehr')(p); await klick('#au-wie-letztes')(p); }, wurzel: DLG, nurVoll: true },
  // FB1: Feedback-Fenster allein und ueber einem offenen Fenster (gemessen wird nur das Feedback-Fenster)
  { id: 'dashboard/start+feedback', hash: 'dashboard/start', aktion: async p => {
      await klick('#feedback-oeffnen')(p);
      await p.fill('#fb-text', 'Im Lager-Fenster ist der Knopf „alles“ am Handy zu klein, ich treffe ihn kaum. Bitte größer machen.'); }, wurzel: '#fb-dialog' },
  { id: 'auftraege/liste+ansicht+feedback', hash: 'auftraege/liste', aktion: async p => {
      await klick('#au-ansicht [data-au-oeffnen]')(p);
      await p.evaluate(() => document.getElementById('feedback-oeffnen').click()); await p.waitForTimeout(600); }, wurzel: '#fb-dialog', nurVoll: true },
  { id: 'auftraege/liste+neuer-auftrag-3-gruppen', hash: 'auftraege/liste', aktion: p => auftragMitGruppen(p, [['HZ480', 0], ['HZ480', 1], ['TX210', 0]]), wurzel: DLG, nurVoll: true },
  { id: 'auftraege/liste+schnellannahme', hash: 'auftraege/liste', aktion: async p => {
      await p.fill('#au-schnell-text', '20 Shirts JN054 navy, 5x M, 10x L, 5x XL, Druck vorne Logo, bis 10.12., Testverein Nordlicht');
      await p.click('#au-schnell-los'); await p.waitForTimeout(1500); }, wurzel: DLG, nurVoll: true },
  { id: 'kunden/stamm+neuer-kunde', hash: 'kunden/stamm', aktion: klick('#ku-neu'), wurzel: DLG },
  // KA1: Anfrage-Dialog (Tabelle, Bearbeiten, Monitor-Karte)
  { id: 'kunden/anfragen+dialog', hash: 'kunden/anfragen', aktion: klick('#anf-tbody tr[data-id]'), wurzel: '#anf-side-panel', nurVoll: true },
  { id: 'kunden/anfragen+bearbeiten', hash: 'kunden/anfragen', aktion: async p => { await klick('#anf-tbody tr[data-id]')(p); await klick('#anf-side-bearbeiten')(p); },
    wurzel: '#anf-side-panel', nurVoll: true },
  { id: 'kunden/anfragen+uebernehmen', hash: 'kunden/anfragen', aktion: async p => { await klick('#anf-tbody tr[data-id]')(p); await klick('#anf-side-uebernehmen')(p);
      await p.waitForTimeout(1500); }, wurzel: DLG, nurVoll: true },
  { id: 'kunden/anfragen+verlauf', hash: 'kunden/anfragen', aktion: async p => { await klick('#anf-tbody tr[data-id]')(p); await klick('#anf-side-verlauf > summary')(p); },
    wurzel: '#anf-side-panel', nurVoll: true },
  { id: 'bestellen/anfragen+karte', hash: 'bestellen/anfragen', aktion: klick('[data-anf-oeffnen]'), wurzel: '#anf-side-panel', nurVoll: true },
  { id: 'auftraege/bestellseiten+dialog', hash: 'auftraege/bestellseiten', aktion: klick('[data-bsm-oeffnen]'), wurzel: DLG, nurVoll: true },
  // KS8: Einträge mit Herkunft + "Übernehmen" je Eintrag
  { id: 'auftraege/bestellseiten+eintraege', hash: 'auftraege/bestellseiten', aktion: async p => { await klick('[data-bsm-oeffnen]')(p); await klick('[data-bsm-eintraege]')(p); await p.waitForTimeout(600); }, wurzel: DLG, nurVoll: true },
  { id: 'bestellen/lshop-korb+aus-lager', hash: 'bestellen/lshop-korb', aktion: klick('[data-aus-lager]'), wurzel: DLG, nurVoll: true },
  { id: 'bestellen/lshop-korb+edi', hash: 'bestellen/lshop-korb', aktion: async p => {
      await p.locator('#korb-alle-btn').first().click().catch(() => {});
      await klick('#korb-edi-btn')(p); }, wurzel: DLG, nurVoll: true },
  { id: 'bestellen/lshop-bestellungen+karton', hash: 'bestellen/lshop-bestellungen', aktion: klick('#ks-oeffnen'), wurzel: DLG },
  { id: 'bestellen/lshop-bestellungen+ware-angekommen', hash: 'bestellen/lshop-bestellungen', aktion: async p => {
      await p.locator('#panel-orders details').first().evaluate(d => { d.open = true; }).catch(() => {});
      await klick('[data-hilfe="ware-angekommen"]')(p); }, wurzel: DLG, nurVoll: true },
  { id: 'partner/lizenz+partner', hash: 'partner/lizenz', aktion: async p => { await p.selectOption('#pk-partner', 'P-001'); await p.waitForTimeout(1500); }, wurzel: PANEL, nurVoll: true },
  { id: 'lager/bestand+einbuchen', hash: 'lager/bestand', aktion: klick('[data-lager-aktion="einbuchen"]'), wurzel: DLG },
  { id: 'lager/bestand+ausbuchen', hash: 'lager/bestand', aktion: klick('[data-lager-aktion="ausbuchen"]'), wurzel: DLG },
  { id: 'partner.html', url: 'partner.html?token=attrappe-token', wurzel: 'body', seite: 'partner' },
  { id: 'partner-festpreis.html', url: 'partner-festpreis.html?token=attrappe-token', wurzel: 'body', seite: 'festpreis' },
  // PD2: Detailansicht mit eingeblendeten Betraegen und Kurve auf Umsatz
  { id: 'partner-festpreis.html+betraege', url: 'partner-festpreis.html?token=attrappe-token', wurzel: 'body', seite: 'festpreis', nurVoll: true,
    aktion: async p => { const b = p.locator('[data-pu-betraege]'); if (await b.isVisible()) await b.click(); await p.locator('[data-pu-reihe="umsatz"]').click(); await p.mouse.move(1, 1); await p.waitForTimeout(300); } },
  { id: 'bestellen.html', url: `bestellen.html#t=${'A'.repeat(43)}`, wurzel: 'body', seite: 'bestellen', art: 'dauer' },
  { id: 'bestellen.html+auftrag', url: `bestellen.html#t=${'B'.repeat(43)}`, wurzel: 'body', seite: 'bestellen', art: 'auftrag' },
  { id: 'anfrage.html', url: 'anfrage.html', wurzel: 'body', seite: 'anfrage' },
];
