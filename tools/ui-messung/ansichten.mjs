// Dialoge, Zustaende und Einzelseiten zusaetzlich zu den Ansichten aus BEREICHE.
// id = Ansicht + "+" + Zusatz; hash = welche Ansicht zuerst geoeffnet wird; wurzel = was gemessen wird.
const PANEL = 'main > .panel.active';
export const DLG = '.edi-dialog:not([hidden]), .modal-backdrop';
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
  // UB1: Ueberblick im Dashboard aufgeklappt (am Handy standardmaessig zu)
  { id: 'dashboard/start+ueberblick', hash: 'dashboard/start', aktion: async p => { await p.evaluate(() => { document.getElementById('dash-ueberblick').open = true; }); await p.waitForTimeout(300); }, wurzel: '#dash-ueberblick' },
  { id: 'auftraege/liste+ansicht', hash: 'auftraege/liste', aktion: klick('#au-ansicht [data-au-oeffnen]'), wurzel: DLG, nurVoll: true },
  { id: 'auftraege/liste+neuer-auftrag', hash: 'auftraege/liste', aktion: klick('#au-neu'), wurzel: DLG },
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
  { id: 'auftraege/bestellseiten+dialog', hash: 'auftraege/bestellseiten', aktion: klick('[data-bsm-oeffnen]'), wurzel: DLG, nurVoll: true },
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
