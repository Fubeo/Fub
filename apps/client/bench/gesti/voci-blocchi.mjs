// Le voci della pagina «blocchi e trascinamento»
// (`docs/misure/gesti-editor/blocchi.md`): `n` è la riga della tabella.
import { vociDelMenu } from "./letture.mjs";

export const DOC = "blocchi.md";

const LUNGO =
  "Un paragrafo lungo che va a capo più volte nella colonna del foglio, perché la freccia giù deve poter scendere di una riga restando nello stesso blocco prima di passare al blocco dopo, come in ogni editor a blocchi.";

/// La nota dei blocchi: titolo, paragrafo, sezione con tre attività, un
/// elenco, un paragrafo lungo, una citazione, il codice e una tabella.
export const NOTA = [
  "# Viaggio a Lisbona",
  "",
  "Il treno parte alle otto.",
  "",
  "## Da fare",
  "",
  "- [ ] Prenotare l'albergo",
  "- [ ] Comprare i biglietti",
  "- [ ] Fare la valigia",
  "",
  "- Primo punto",
  "- Secondo punto",
  "",
  LUNGO,
  "",
  "> Una città che si guarda dall'alto.",
  "",
  "```js",
  "const giorni = 3;",
  "```",
  "",
  "| Giorno | Posto |",
  "| --- | --- |",
  "| 1 | Alfama |",
  "",
  "Ultimo paragrafo.",
].join("\n");

/// La nota col cursore `k` caratteri dopo l'inizio di `ago` (`k` negativo:
/// dalla fine di `ago`).
export function a(ago, k = 0, nota = NOTA) {
  const i = nota.indexOf(ago);
  if (i === -1) throw new RangeError(`«${ago}» non è nella nota`);
  const p = k < 0 ? i + ago.length + k + 1 : i + k;
  return { testo: `${nota.slice(0, p)}§${nota.slice(p)}` };
}
const fine = (ago) => a(ago, -1);
const SENZA = { testo: NOTA };

/// Dove sta la maniglia: visibile o no, e accanto a quale riga.
async function maniglia(page) {
  return page.evaluate(() => {
    const h = document.querySelector(".pane.focus .pane-editor .cm-fub-block-handles");
    if (!h || h.getClientRects().length === 0 || getComputedStyle(h).visibility === "hidden" || Number(getComputedStyle(h).opacity) < 0.5) return "nascosta";
    const r = h.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const riga = [...document.querySelectorAll(".pane.focus .cm-line")].find((l) => {
      const b = l.getBoundingClientRect();
      return b.top <= y && y <= b.bottom;
    });
    return `visibile accanto a «${(riga?.textContent ?? "?").slice(0, 30)}»`;
  });
}

async function apriMenu(h, testo, pulsante = "left") {
  const p = await h.maniglia(testo);
  await h.page.mouse.click(p.x, p.y, { button: pulsante });
  await h.page.waitForTimeout(150);
  await h.fotogrammi();
}

/// Trasforma il blocco di `testo` nel tipo `tipo` dal menu della maniglia.
function trasforma(n, titolo, partenza, testo, tipo) {
  return {
    n,
    titolo,
    partenza,
    gesto: async (page, h) => {
      await apriMenu(h, testo);
      await h.voce("Trasforma");
      await h.voce(tipo);
    },
  };
}

async function sceltaBlocchi(h, ...tasti) {
  await h.tasti("Escape", ...tasti);
}

export const VOCI = [
  { n: 1, titolo: "Passaggio su un paragrafo", partenza: SENZA, gesto: (p, h) => h.passa("Il treno", 4), leggi: maniglia },
  { n: 2, titolo: "Passaggio su un titolo", partenza: SENZA, gesto: (p, h) => h.passa("Da fare", 2), leggi: maniglia },
  {
    n: 3, titolo: "Il puntatore esce a destra", partenza: SENZA,
    gesto: async (page, h) => { await h.passa("Il treno", 4); const p = await h.punto("Il treno", 4); await page.mouse.move(1265, p.y, { steps: 5 }); await page.waitForTimeout(400); },
    leggi: maniglia,
  },
  {
    n: 4, titolo: "Il puntatore esce dall'area di scorrimento", partenza: SENZA,
    gesto: async (page, h) => { await h.passa("Il treno", 4); await page.mouse.move(640, 5, { steps: 5 }); await page.waitForTimeout(400); },
    leggi: maniglia,
  },
  {
    n: 5, titolo: "Clic sul «+»", partenza: SENZA,
    gesto: async (page, h) => { const p = await h.maniglia("Il treno", ".cm-fub-block-add"); await page.mouse.click(p.x, p.y); },
  },
  {
    n: 6, titolo: "Alt+clic sul «+»", partenza: SENZA,
    gesto: async (page, h) => { const p = await h.maniglia("Il treno", ".cm-fub-block-add"); await page.keyboard.down("Alt"); await page.mouse.click(p.x, p.y); await page.keyboard.up("Alt"); },
  },
  { n: 7, titolo: "Clic sulla maniglia", partenza: a("Il treno", 4), gesto: (p, h) => apriMenu(h, "Il treno"), leggi: vociDelMenu },
  { n: 8, titolo: "Tasto destro sulla maniglia", partenza: a("Il treno", 4), gesto: (p, h) => apriMenu(h, "Il treno", "right"), leggi: vociDelMenu },
  { n: 9, titolo: "Tasto destro sul testo", partenza: a("Il treno", 4), gesto: (p, h) => h.clic("Il treno", 6, { button: "right" }), leggi: vociDelMenu },
  {
    n: 10, titolo: "Menu → Trasforma", partenza: a("Il treno", 4),
    gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.voce("Trasforma"); }, leggi: vociDelMenu,
  },
  trasforma(11, "Trasforma → Titolo 2", a("Il treno", 4), "Il treno", "Titolo 2"),
  trasforma(12, "Trasforma → Titolo 3", a("Il treno", 4), "Il treno", "Titolo 3"),
  trasforma(13, "Trasforma → Titolo 1", a("Il treno", 4), "Il treno", "Titolo 1"),
  trasforma(14, "Trasforma → Elenco puntato", a("Il treno", 4), "Il treno", "Elenco puntato"),
  trasforma(15, "Trasforma → Elenco numerato", a("Il treno", 4), "Il treno", "Elenco numerato"),
  trasforma(16, "Trasforma → Elenco di attività", a("Il treno", 4), "Il treno", "attività"),
  trasforma(17, "Trasforma → Citazione", a("Il treno", 4), "Il treno", "Citazione"),
  trasforma(18, "Trasforma → Riquadro", a("Il treno", 4), "Il treno", "Riquadro"),
  trasforma(19, "Trasforma → Ripiegabile", a("Il treno", 4), "Il treno", "Ripiegabile"),
  trasforma(20, "Trasforma → Codice", a("Il treno", 4), "Il treno", "codice"),
  trasforma(21, "Trasforma → Testo (da un titolo)", a("Da fare", 2), "Da fare", "Testo"),
  {
    n: 22, titolo: "Colore → rosso", partenza: a("Il treno", 4),
    gesto: async (page, h) => { await apriMenu(h, "Il treno"); await h.voce("Colore"); await h.voce("Testo"); await page.locator("[role=menu] :is([role=menuitem],[role=menuitemradio],button,[aria-label])").filter({ hasText: /Rosso/ }).or(page.locator("[role=menu] [aria-label*=Rosso]")).first().click({ timeout: 3_000 }); },
    leggi: (page) => page.evaluate(() => { const l = [...document.querySelectorAll(".pane.focus .cm-line")].find((x) => x.textContent.includes("Il treno")); return l ? { classi: l.className, colore: getComputedStyle(l.querySelector("span") ?? l).color, fondo: getComputedStyle(l).backgroundColor } : null; }),
  },
  { n: 23, titolo: "Menu → Commenta", partenza: a("Il treno", 4), gesto: (p, h) => apriMenu(h, "Il treno"), leggi: vociDelMenu },
  // Una scheda viva: la cartella di Excel del banco (`workbook=1`) incorporata
  // da sola nel suo paragrafo.
  ...[24, 25].map((n) => ({
    n, titolo: "Menu del blocco di una scheda viva",
    partenza: { testo: "# Casa\n\nI conti:\n\n![[Conti.xlsx#Conti!A1:C4]]\n\nFine.", query: "workbook=1" },
    gesto: async (page, h) => {
      await page.waitForTimeout(800);
      await page.getByText("Conti.xlsx").first().hover();
      await h.fotogrammi();
      const g = page.locator(".pane.focus .pane-editor .cm-fub-block-grip >> visible=true").first();
      await g.waitFor({ state: "visible", timeout: 3_000 });
      await g.click();
      await h.fotogrammi();
    },
    leggi: vociDelMenu,
  })),
  {
    n: 26, titolo: "Menu di una tabella", partenza: SENZA,
    gesto: async (page, h) => {
      await page.locator(".pane.focus .cm-content td, .pane.focus .cm-content [role=gridcell]").filter({ hasText: "Alfama" }).first().hover();
      const g = page.locator(".pane.focus .pane-editor .cm-fub-block-grip").first();
      await g.waitFor({ state: "visible", timeout: 3_000 });
      await g.click();
      await h.fotogrammi();
    },
    leggi: vociDelMenu,
  },
  { n: 27, titolo: "Menu → Duplica", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.voce("Duplica"); } },
  { n: 28, titolo: "Menu → Sposta in…", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.voce("Sposta in"); } },
  { n: 29, titolo: "Menu → Copia il link al blocco", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.voce("Copia il link"); } },
  { n: 30, titolo: "Menu → Blocco sincronizzato", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.voce("sincronizzato"); } },
  { n: 31, titolo: "Menu → Elimina", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.voce("Elimina"); } },
  {
    n: 32, titolo: "Menu: freccia giù e Invio", partenza: a("Il treno", 4),
    gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.tasti("ArrowDown", "Enter"); }, leggi: vociDelMenu,
  },
  { n: 33, titolo: "«Elim» nel menu", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.scrivi("Elim"); }, leggi: vociDelMenu },
  { n: 34, titolo: "Esc chiude il menu", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.tasti("Escape"); } },
  // Il menu si apre verso l'alto e copre il titolo della pagina: il clic
  // «fuori» va nello spazio vuoto del foglio (35) o sulla barra di formato (35b).
  { n: 35, titolo: "Clic fuori dal menu, nello spazio vuoto del foglio", partenza: a("Il treno", 4), gesto: async (page, h) => { await apriMenu(h, "Il treno"); await page.mouse.click(960, 546); await h.fotogrammi(); } },
  { n: "35b", titolo: "Clic fuori dal menu, sulla barra di formato", partenza: a("Il treno", 4), gesto: async (page, h) => { await apriMenu(h, "Il treno"); await page.mouse.click(850, 132); await h.fotogrammi(); } },
  { n: 36, titolo: "«Sposta» nel menu", partenza: a("Il treno", 4), gesto: async (p, h) => { await apriMenu(h, "Il treno"); await h.scrivi("Sposta"); }, leggi: vociDelMenu },
  {
    n: 37, titolo: "Due blocchi scelti, poi la maniglia del primo", partenza: a("Il treno", 4),
    gesto: async (p, h) => { await sceltaBlocchi(h, "Shift+ArrowDown"); await apriMenu(h, "Il treno"); },
    leggi: async (page) => ({ voci: await vociDelMenu(page), titolo: await page.evaluate(() => document.querySelector(".cm-fub-block-menu, [role=menu]")?.querySelector(".menu-head, .menu-title, header")?.textContent ?? null) }),
  },
  { n: 38, titolo: "Esc nel testo", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Escape") },
  { n: 39, titolo: "Maiusc+giù sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Shift+ArrowDown") },
  { n: 40, titolo: "Giù sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "ArrowDown") },
  { n: 41, titolo: "Su sulla scelta", partenza: a("Da fare", 2), gesto: (p, h) => sceltaBlocchi(h, "ArrowUp") },
  { n: 42, titolo: "Maiusc+su sulla scelta", partenza: a("Da fare", 2), gesto: (p, h) => sceltaBlocchi(h, "Shift+ArrowUp") },
  { n: 43, titolo: "Esc con una scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Escape") },
  { n: 44, titolo: "Ctrl A una volta", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+a") },
  { n: 45, titolo: "Ctrl A due volte", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+a", "Control+a") },
  {
    // Il menu del riquadro è il «⋯» in alto a destra del foglio.
    n: 46, titolo: "Blocchi spenti dal menu del riquadro, poi Ctrl A", partenza: a("Il treno", 4),
    gesto: async (page, h) => {
      await h.clicSu(".pane.focus [data-pane-menu]");
      await h.voce("Blocchi", "#context-menu");
      await page.waitForTimeout(300);
      await h.clic("Il treno", 4);
      await h.tasti("Control+a");
    },
    leggi: (page) => page.evaluate(() => document.querySelectorAll(".pane.focus .cm-fub-block-handles").length),
  },
  { n: 47, titolo: "Canc sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Delete") },
  { n: 48, titolo: "Backspace sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Backspace") },
  { n: 49, titolo: "Ctrl Maiusc giù sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Control+Shift+ArrowDown") },
  { n: 50, titolo: "Ctrl Maiusc su sulla scelta", partenza: a("Da fare", 2), gesto: (p, h) => sceltaBlocchi(h, "Control+Shift+ArrowUp") },
  { n: 51, titolo: "Ctrl Maiusc giù nel paragrafo", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Shift+ArrowDown") },
  { n: 52, titolo: "Ctrl Maiusc su nel titolo", partenza: a("Da fare", 2), gesto: (p, h) => h.tasti("Control+Shift+ArrowUp") },
  { n: 53, titolo: "Ctrl D sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Control+d") },
  { n: 54, titolo: "Ctrl D nel paragrafo", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+d") },
  { n: 55, titolo: "Invio sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Enter") },
  {
    n: 56, titolo: "Ctrl C sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Control+c"),
    leggi: (page) => page.evaluate(() => navigator.clipboard.readText().catch((e) => `appunti illeggibili: ${e}`)),
  },
  {
    n: 57, titolo: "Ctrl X sulla scelta", partenza: a("Il treno", 4), gesto: (p, h) => sceltaBlocchi(h, "Control+x"),
    leggi: (page) => page.evaluate(() => navigator.clipboard.readText().catch((e) => `appunti illeggibili: ${e}`)),
  },
  { n: 58, titolo: "Clic fuori dai blocchi (titolo della pagina)", partenza: a("Il treno", 4), gesto: async (p, h) => { await sceltaBlocchi(h); await h.clic("Viaggio", 3); } },
  { n: 59, titolo: "Clic nel testo del blocco scelto", partenza: a("Il treno", 4), gesto: async (p, h) => { await sceltaBlocchi(h); await h.clic("Il treno", 6); } },
  {
    n: 60, titolo: "Maiusc+clic su un altro blocco", partenza: a("Il treno", 4),
    gesto: async (page, h) => { await page.keyboard.down("Shift"); await h.clic("Prenotare", 3); await page.keyboard.up("Shift"); },
  },
  { n: 61, titolo: "Invio alla fine di un paragrafo, poi «Nuovo»", partenza: fine("Il treno parte alle otto."), gesto: async (p, h) => { await h.tasti("Enter"); await h.scrivi("Nuovo"); } },
  { n: 62, titolo: "Invio nel mezzo di un paragrafo", partenza: a("Il treno", 9), gesto: (p, h) => h.tasti("Enter") },
  { n: 63, titolo: "Invio all'inizio di un paragrafo", partenza: a("Il treno", 0), gesto: (p, h) => h.tasti("Enter") },
  { n: 64, titolo: "Invio alla fine di un elemento di elenco", partenza: fine("- Primo punto"), gesto: (p, h) => h.tasti("Enter") },
  { n: 65, titolo: "Invio su un elemento di elenco vuoto", partenza: { testo: NOTA.replace("- Secondo punto", "- Secondo punto\n- §") }, gesto: (p, h) => h.tasti("Enter") },
  { n: 66, titolo: "Invio alla fine di un'attività", partenza: fine("Prenotare l'albergo"), gesto: (p, h) => h.tasti("Enter") },
  { n: 67, titolo: "Invio alla fine di un titolo", partenza: fine("## Da fare"), gesto: (p, h) => h.tasti("Enter") },
  { n: 68, titolo: "Ctrl+Invio su un'attività", partenza: a("Prenotare", 3), gesto: (p, h) => h.tasti("Control+Enter") },
  { n: 69, titolo: "Maiusc+Invio nel paragrafo", partenza: a("Il treno", 9), gesto: (p, h) => h.tasti("Shift+Enter") },
  { n: 70, titolo: "Backspace all'inizio di un paragrafo", partenza: a("Il treno", 0), gesto: (p, h) => h.tasti("Backspace") },
  { n: 71, titolo: "Backspace su un paragrafo vuoto", partenza: { testo: NOTA.replace("Il treno parte alle otto.\n", "Il treno parte alle otto.\n\n§\n") }, gesto: (p, h) => h.tasti("Backspace") },
  { n: 72, titolo: "Backspace all'inizio di un titolo", partenza: a("Da fare", 0), gesto: (p, h) => h.tasti("Backspace") },
  { n: 73, titolo: "Backspace all'inizio di un elemento", partenza: a("Primo punto", 0), gesto: (p, h) => h.tasti("Backspace") },
  { n: 74, titolo: "Backspace al primo blocco della nota", partenza: a("Viaggio", 0), gesto: (p, h) => h.tasti("Backspace") },
  { n: 75, titolo: "Backspace nel mezzo del testo", partenza: a("Il treno", 5), gesto: (p, h) => h.tasti("Backspace") },
  { n: 76, titolo: "Tab nel paragrafo", partenza: a("Il treno", 5), gesto: (p, h) => h.tasti("Tab") },
  { n: 77, titolo: "Tab in un elemento di elenco", partenza: a("Secondo punto", 3), gesto: (p, h) => h.tasti("Tab") },
  { n: 78, titolo: "Maiusc+Tab in un elemento di elenco", partenza: a("Secondo punto", 3), gesto: (p, h) => h.tasti("Shift+Tab") },
  { n: 79, titolo: "Tab nel codice", partenza: a("const giorni", 6), gesto: (p, h) => h.tasti("Tab") },
  { n: 80, titolo: "Giù alla fine di un blocco", partenza: fine("Il treno parte alle otto."), gesto: (p, h) => h.tasti("ArrowDown") },
  { n: 81, titolo: "Su all'inizio di un titolo", partenza: a("Da fare", 0), gesto: (p, h) => h.tasti("ArrowUp") },
  { n: 82, titolo: "Giù in un blocco su più righe", partenza: a("Un paragrafo lungo", 3), gesto: (p, h) => h.tasti("ArrowDown") },
  { n: 83, titolo: "Clic dentro un paragrafo", partenza: SENZA, gesto: (p, h) => h.clic("Il treno", 6) },
  {
    n: 84, titolo: "Trascinare oltre la soglia: il blocco si solleva", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Prenotare"); await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x, g.y + 30, { steps: 6 }); await h.fotogrammi(4); },
    leggi: async (page) => {
      const r = await page.evaluate(() => ({ sollevato: !!document.querySelector(".cm-fub-block-lift, .cm-fub-block-lifted"), testo: document.querySelector(".cm-fub-block-lift")?.textContent?.slice(0, 80) ?? null, etichetta: document.querySelector(".cm-fub-block-lift-to")?.textContent ?? null }));
      await page.keyboard.press("Escape"); await page.mouse.up(); return r;
    },
  },
  {
    n: 85, titolo: "Trascinare un'attività sotto la seconda", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Prenotare"); const t = await h.punto("Comprare", 3); await h.trascina(g, { x: g.x, y: t.y + 8 }); },
  },
  {
    n: 86, titolo: "Trascinare in alto, sopra la prima", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Fare la valigia"); const t = await h.punto("Prenotare", 3); await h.trascina(g, { x: g.x, y: t.y - 8 }); },
  },
  {
    n: 87, titolo: "Esc durante il trascinamento", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Prenotare"); const t = await h.punto("Fare la valigia", 3); await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x, t.y + 8, { steps: 10 }); await page.keyboard.press("Escape"); await page.mouse.up(); },
  },
  {
    n: 88, titolo: "Trascinare appena e rilasciare", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Prenotare"); await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x, g.y + 3, { steps: 2 }); await page.mouse.up(); },
  },
  {
    n: 89, titolo: "Trascinare fuori dalla colonna a sinistra", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Prenotare"); await h.trascina(g, { x: 40, y: g.y + 60 }); },
  },
  {
    n: 91, titolo: "Ctrl mentre si trascina", partenza: SENZA,
    gesto: async (page, h) => { const g = await h.maniglia("Prenotare"); const t = await h.punto("Fare la valigia", 3); await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x, g.y + 8, { steps: 3 }); await page.keyboard.down("Control"); await page.mouse.move(g.x, t.y + 8, { steps: 10 }); await page.mouse.up(); await page.keyboard.up("Control"); },
  },
  {
    n: 92, titolo: "Trascinare al bordo inferiore e aspettare",
    partenza: { testo: NOTA + `\n\n${LUNGO}`.repeat(6) },
    gesto: async (page, h) => {
      const g = await h.maniglia("Il treno");
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, g.y + 8, { steps: 3 });
      await page.mouse.move(g.x, 755, { steps: 12 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        globalThis.__sondaScorrimento = [...document.querySelectorAll(".pane.focus *")].filter((e) => e.scrollTop > 0).map((e) => `${e.className.split(" ")[0]} ${Math.round(e.scrollTop)}`).join(", ") || "nessuno scorre";
      });
      await page.mouse.up();
    },
    leggi: (page) => page.evaluate(() => ({ scorrimentoDurante: globalThis.__sondaScorrimento, dopo: document.querySelector(".pane.focus .cm-scroller").scrollTop })),
  },
  {
    n: 93, titolo: "Due blocchi scelti: si trascina uno", partenza: a("Prenotare", 3),
    gesto: async (page, h) => { await sceltaBlocchi(h, "Shift+ArrowDown"); const g = await h.maniglia("Prenotare"); const t = await h.punto("Primo punto", 3); await h.trascina(g, { x: g.x, y: t.y + 8 }); },
  },
  { n: 95, titolo: "Ctrl Alt 0 su un titolo", partenza: a("Da fare", 2), gesto: (p, h) => h.tasti("Control+Alt+0") },
  { n: 96, titolo: "Ctrl Alt 1", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+1") },
  { n: 97, titolo: "Ctrl Alt 2", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+2") },
  { n: 98, titolo: "Ctrl Alt 3", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+3") },
  { n: 99, titolo: "Ctrl Alt 4", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+4") },
  { n: 100, titolo: "Ctrl Alt 5", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+5") },
  { n: 101, titolo: "Ctrl Alt 7", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+7") },
  { n: 102, titolo: "Ctrl Alt M", partenza: a("Il treno", 4), gesto: (p, h) => h.tasti("Control+Alt+m") },
];
