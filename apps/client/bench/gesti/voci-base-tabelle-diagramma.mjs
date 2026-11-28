// Le voci della pagina «Base, tabelle, fogli e diagramma»
// (`docs/misure/gesti-editor/base-tabelle-diagramma.md`): `n` è la riga della
// tabella. Misura ridotta del 2026-11-28: ci sono solo le righe diverse,
// mancanti o non provate il 21/11, e quelle che possono cambiare i dati
// (trascinamenti, Taglia, riempimento, Canc). Le uguali sono lette dal codice.
// Il foglio nella nota è la scheda viva di `Conti.xlsx` (`live=schede-vive`):
// il 21/11 la scena del foglio aveva le celle a dimensione zero.
import { openBase, openCalendar, openTimeline } from "../scene/gesti-documenti.mjs";
import { openLive } from "../scene/gesti-scrittura.mjs";
import { vociDelMenu, vociDelPannello } from "./letture.mjs";

export const DOC = "base-tabelle-diagramma.md";

const TABELLA = "| Voce | Costo |\n|---|---|\n| Pane | 3 |\n| Latte | 2 |\n| Burro | 5 |";
const DIAGRAMMA = "```mermaid\nflowchart TD\n  A[Inizio] --> B[Fine]\n```";
/// Una nota con una tabella e un diagramma; il cursore dopo «Pane».
const NOTA = { testo: `# Nota di prova\n\nPrima della tabella.\n\n${TABELLA.replace("Pane", "Pane§")}\n\nDopo la tabella.\n\n${DIAGRAMMA}\n\nUltima riga.` };
/// La stessa nota col cursore nel testo, fuori dalla tabella.
const FUORI = { testo: NOTA.testo.replace("§", "").replace("Ultima riga.", "Ultima riga.§") };

const BASE = { scena: (p) => openBase(p), query: "base=1" };
const SCHEDE = { scena: (p) => openLive(p, [], "top"), query: "live=schede-vive&pdf-scena=domanda&workbook=1" };


/// La cella della tabella che ha questo testo.
const cella = (testo) => `.pane.focus .tb-grid td:has-text("${testo}")`;
/// Il tasto destro su una cella della tabella, poi la voce del menu.
const dalMenu = (testo, ...voci) => async (p, h) => {
  await h.clicSu(cella(testo), { button: "right" });
  for (const v of voci) await h.voce(v);
};

/// Ciò che dice la tabella: le righe del Markdown, gli appunti.
async function laTabella(page) {
  return page.evaluate(async () => {
    let appunti = null;
    try { appunti = (await navigator.clipboard.readText()).slice(0, 80); } catch { appunti = "illeggibili"; }
    const attiva = document.querySelector(".pane.focus .tb-grid td.active, .pane.focus .tb-grid td[aria-selected=true], .pane.focus .tb-grid td.sel");
    return { attiva: attiva?.textContent?.trim() ?? null, scelte: document.querySelectorAll(".pane.focus .tb-grid td.sel, .pane.focus .tb-grid td.in-range, .pane.focus .tb-grid td[aria-selected=true]").length, appunti };
  });
}

/// La scheda del foglio: attiva o no, la cella attiva, le celle scelte, il
/// campo aperto e le prime celle.
function ilFoglio(page) {
  return page.evaluate(() => {
    const s = document.querySelector('.pane.focus .live-card[data-card-kind="sheet"]');
    if (!s) return "nessun foglio";
    const a = s.querySelector(".grid-cell.active");
    const ed = s.querySelector(".grid-cell-editor:not([hidden]) .cm-content");
    return {
      attiva: s.dataset.cardActive ?? null,
      cella: a ? `${a.dataset.row},${a.dataset.column} «${a.textContent.trim()}»` : null,
      scelte: s.querySelectorAll(".grid-cell.selected").length,
      campo: ed ? ed.textContent : null,
      celle: [...s.querySelectorAll(".grid-cell")].slice(0, 9).map((c) => c.textContent.trim()).join(" | "),
      barra: document.querySelector(".format-bar-context-cell:not([hidden])")?.textContent?.trim() ?? null,
      tutte: s.querySelectorAll('.grid-cell[aria-selected="true"]').length,
      riquadro: [...s.querySelectorAll(".grid-selection")].filter((e) => e.getClientRects().length > 0).map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`).join(","),
    };
  });
}
/// Un punto del foglio nella scheda, in frazioni della sua griglia: le celle
/// del DOM della scheda hanno dimensione zero (la griglia si disegna), e si
/// punta la griglia.
async function puntoDelFoglio(p, fx, fy) {
  const b = await p.locator('.pane.focus .live-card[data-card-kind="sheet"] .grid-viewport, .pane.focus .live-card[data-card-kind="sheet"] .live-card-body').first().boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
/// Attiva il foglio (la cella attiva è la prima della parte), poi i tasti.
const nelFoglio = (...tasti) => async (p, h) => {
  await h.clicSu('.pane.focus .live-card[data-card-kind="sheet"] .live-card-body');
  await p.waitForSelector('.pane.focus .live-card[data-card-kind="sheet"][data-card-active="true"]', { timeout: 3_000 });
  await p.waitForTimeout(400);
  for (const t of tasti) {
    if (t.length > 1 && /^[A-Z]/.test(t)) await h.tasti(t);
    else await h.scrivi(t);
  }
};
const A = [0.2, 0.45];
const B = [0.55, 0.8];

/// Le schede vive: specie, stato, attiva, scelta.
function leSchede(page) {
  return page.evaluate(() => [...document.querySelectorAll(".pane.focus .live-card")].slice(0, 3).map((c) =>
    `${c.dataset.cardKind}/${c.dataset.cardState}${c.dataset.cardActive === "true" ? " attiva" : ""}${c.dataset.cardChosen === "true" ? " scelta" : ""} [${[...c.querySelectorAll(".live-card-head button")].filter((b) => b.getClientRects().length > 0).map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()).join(", ")}] ${c.querySelector("[class*=page]")?.textContent?.trim()?.slice(0, 20) ?? ""}`));
}
const PDF = '.pane.focus .live-card[data-card-kind="pdf"]';
/// Una nota con un documento Word e una lavagna incorporati.
const DOCLAV = { testo: "# Schede\n\nUn documento:\n\n![[Documenti/relazione.docx]]\n\nUna lavagna:\n\n![[Lavagne/Statistica.canvas]]\n\nFine.§", query: "lavagna=1" };
const DOCX = '.pane.focus .live-card[data-card-kind="document"]';
const LAV = '.pane.focus .live-card[data-card-kind="canvas"]';
/// Le schede, e dove sta il primo nodo della lavagna.
const schedeELavagna = async (p) => ({ schede: await leSchede(p), nodo: await p.evaluate(() => { const n = document.querySelector('.pane.focus .live-card[data-card-kind="canvas"] .canvas-node'); return n ? n.style.transform || n.getAttribute("transform") || `${Math.round(n.getBoundingClientRect().x)},${Math.round(n.getBoundingClientRect().y)}` : null; }) });

/// Il diagramma: il menu, lo stile scelto, i segmenti, il riquadro grande.
function ilDiagramma(page) {
  return page.evaluate(() => {
    const v = (e) => e.getClientRects().length > 0;
    const menu = [...document.querySelectorAll(".diagram-menu-style")].some(v);
    return {
      menu,
      stile: [...document.querySelectorAll(".diagram-menu-style[aria-pressed=true], .diagram-menu-style[aria-checked=true]")].map((e) => e.textContent.trim()).join(","),
      segmenti: [...document.querySelectorAll(".diagram-menu-segment[aria-pressed=true], .diagram-menu-segment[aria-checked=true]")].map((e) => e.textContent.trim()).join(","),
      grande: [...document.querySelectorAll(".lightbox")].some(v),
      disegni: document.querySelectorAll(".pane.focus .mermaid-diagram svg, .pane.focus .mermaid-diagram img").length,
      tema: document.querySelector(".pane.focus .mermaid-diagram")?.dataset?.style ?? null,
    };
  });
}
const DISEGNO = ".pane.focus .mermaid-diagram";
const menuDelDiagramma = (p, h) => h.clicSu(DISEGNO, { button: "right" });


/// Lo stato delle prime righe della Base (i campi della colonna «stato»).
const lostato = (p) => p.evaluate(() => [...document.querySelectorAll(".pane.focus .base-cell[data-column=stato]")].slice(0, 3).map((c) => c.querySelector("input")?.value ?? c.textContent.trim()));
/// Quante schede ha ogni corsia della bacheca.
const corsie = (p) => p.evaluate(() => [...document.querySelectorAll(".pane.focus .base-kanban-lane, .pane.focus .base-kanban-column")].map((l) => `${l.querySelector("h3, header, [class*=title]")?.textContent?.trim()?.slice(0, 15) ?? "?"}:${l.querySelectorAll(".base-kanban-card").length}`).join(", "));

export const VOCI = [
  // Base (in correzione da un altro coder): lo stato di oggi.
  { n: 2, titolo: "Viste nella barra della Base", partenza: BASE, gesto: async () => {}, leggi: (p) => p.evaluate(() => ({ viste: [...document.querySelectorAll(".pane.focus .base-tab")].map((t) => t.textContent.trim()), righe: document.querySelectorAll(".pane.focus .base-table tbody tr").length })) },
  { n: 10, titolo: "Pulsante Ordina", partenza: BASE, gesto: (p, h) => h.clicSu(".pane.focus .base-tool-sort"), leggi: vociDelPannello },
  { n: 18, titolo: "Pulsante Nuova", partenza: BASE, gesto: (p, h) => h.clicSu(".pane.focus .base-new-note"), leggi: (p) => p.evaluate(() => document.querySelectorAll(".pane.focus .base-table tbody tr").length) },
  { n: 19, titolo: "Riga Nuova in fondo", partenza: BASE, gesto: (p, h) => h.clicSu(".pane.focus .base-add-row-button"), leggi: (p) => p.evaluate(() => document.querySelectorAll(".pane.focus .base-table tbody tr").length) },
  { n: 21, titolo: "Lente Cerca nella vista", partenza: BASE, gesto: async (p, h) => { await h.clicSu(".pane.focus .base-tool-search"); await h.scrivi("a"); }, leggi: (p) => p.evaluate(() => document.querySelectorAll(".pane.focus .base-table tbody tr").length) },
  { n: 22, titolo: "Clic sullo stato di una riga", partenza: BASE, gesto: (p, h) => h.clicSu(".pane.focus .base-cell[data-column=stato]"), leggi: async (p) => ({ pannello: await vociDelPannello(p), stato: await lostato(p) }) },
  {
    n: 23, titolo: "Scrivere uno stato e Invio", partenza: BASE,
    gesto: async (p, h) => { await h.clicSu(".pane.focus .base-cell[data-column=stato]"); await h.scrivi("Da chiedere"); await h.tasti("Enter"); },
    leggi: lostato,
  },
  // Le corsie della bacheca prima del trascinamento della riga 25.
  { n: "25-riposo", titolo: "La bacheca a riposo", partenza: BASE, gesto: (p) => p.locator(".pane.focus .base-tab", { hasText: "Bacheca" }).first().click(), leggi: corsie },
  {
    n: 25, titolo: "Trascinare una scheda della bacheca", partenza: BASE,
    gesto: async (p, h) => {
      await p.locator(".pane.focus .base-tab", { hasText: "Bacheca" }).first().click();
      await h.aspetta(".pane.focus .base-kanban-card");
      const card = await p.locator(".pane.focus .base-kanban-card").first().boundingBox();
      const lanes = await p.locator(".pane.focus .base-kanban-lane, .pane.focus .base-kanban-column").all();
      const last = await lanes[lanes.length - 1].boundingBox();
      await h.trascina({ x: card.x + 20, y: card.y + 10 }, { x: last.x + last.width / 2, y: last.y + 80 }, 20);
    },
    leggi: corsie,
  },
  {
    n: 26, titolo: "Trascinare una consegna su un altro giorno", partenza: { scena: (p) => openCalendar(p), query: "base=calendario" },
    gesto: async (p, h) => { const e = await p.locator(".pane.focus .base-cal-event").first().boundingBox(); await h.trascina({ x: e.x + 10, y: e.y + 5 }, { x: e.x + 10 + 140, y: e.y + 5 }, 20); },
    leggi: (p) => p.evaluate(() => [...document.querySelectorAll(".pane.focus .base-cal-event")].slice(0, 2).map((e) => `${e.textContent.trim()}@${e.closest("[data-date]")?.dataset.date ?? "?"}`)),
  },
  {
    n: 27, titolo: "Trascinare una barra della linea del tempo", partenza: { scena: (p) => openTimeline(p), query: "base=tempo" },
    gesto: async (p, h) => { const b = await p.locator(".pane.focus .base-tl-bar").first().boundingBox(); await h.trascina({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: b.x + b.width / 2 + 120, y: b.y + b.height / 2 }, 20); },
  },

  // Tabelle nella nota.
  { n: 59, titolo: "Ctrl Maiusc = nella tabella", partenza: NOTA, gesto: (p, h) => h.tasti("Control+Shift+Equal"), leggi: laTabella },
  { n: 66, titolo: "Menu: Copia", partenza: NOTA, gesto: dalMenu("Latte", "Copia"), leggi: laTabella },
  { n: 67, titolo: "Menu: Taglia", partenza: NOTA, gesto: dalMenu("Latte", "Taglia"), leggi: laTabella },
  { n: 68, titolo: "Menu: Incolla", partenza: NOTA, gesto: async (p, h) => { await p.evaluate(() => navigator.clipboard.writeText("Uova")); await dalMenu("Latte", "Incolla")(p, h); }, leggi: laTabella },
  { n: 71, titolo: "Menu: Ordina, dalla A alla Z", partenza: NOTA, gesto: dalMenu("Latte", "Ordina", "A alla Z"), leggi: laTabella },
  { n: 72, titolo: "Menu: Allinea a destra", partenza: NOTA, gesto: dalMenu("3", "Allinea", "destra"), leggi: laTabella },
  { n: 73, titolo: "Menu della tabella: la somma", partenza: NOTA, gesto: (p, h) => h.clicSu(cella("3"), { button: "right" }), leggi: vociDelMenu },
  { n: 75, titolo: "Menu: Elimina la riga", partenza: NOTA, gesto: dalMenu("Latte", "Elimina la riga"), leggi: laTabella },
  { n: 76, titolo: "Ctrl C nella tabella", partenza: NOTA, gesto: async (p, h) => { await h.clicSu(cella("Latte")); await h.tasti("Control+c"); }, leggi: laTabella },
  {
    n: 79, titolo: "Trascinare la maniglia per riempire", partenza: NOTA,
    gesto: async (p, h) => {
      await h.clicSu(cella("3"));
      const f = await p.locator(".pane.focus .tb-fill >> visible=true").first().boundingBox();
      const giu = await p.locator(cella("5")).first().boundingBox();
      await h.trascina({ x: f.x + f.width / 2, y: f.y + f.height / 2 }, { x: f.x + f.width / 2, y: giu.y + giu.height / 2 }, 12);
    },
    leggi: laTabella,
  },
  {
    n: 80, titolo: "Doppio clic sulla maniglia", partenza: NOTA,
    gesto: async (p, h) => { await h.clicSu(cella("3")); await p.locator(".pane.focus .tb-fill >> visible=true").first().dblclick(); await h.fotogrammi(); },
    leggi: laTabella,
  },
  { n: 90, titolo: "Clic fuori dalla tabella", partenza: NOTA, gesto: async (p, h) => { await h.clicSu(cella("Latte")); await h.clic("Ultima riga", 3); }, leggi: laTabella },
  { n: 92, titolo: "Esc sulla tabella, poi Invio", partenza: NOTA, gesto: async (p, h) => { await h.clicSu(cella("Latte")); await h.tasti("Escape", "Enter"); }, leggi: laTabella },

  // Il foglio nella nota.
  { n: 93, titolo: "Clic su una cella del foglio", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio()(p, h); const a = await puntoDelFoglio(p, ...B); await p.mouse.click(a.x, a.y); await h.fotogrammi(); }, leggi: ilFoglio },
  {
    n: 94, titolo: "Trascinare sulle celle del foglio", partenza: SCHEDE,
    gesto: async (p, h) => { await nelFoglio()(p, h); await h.trascina(await puntoDelFoglio(p, ...A), await puntoDelFoglio(p, ...B)); },
    leggi: ilFoglio,
  },
  { n: 95, titolo: "Maiusc clic nel foglio", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio()(p, h); const a = await puntoDelFoglio(p, ...A); await p.mouse.click(a.x, a.y); const b = await puntoDelFoglio(p, ...B); await p.keyboard.down("Shift"); await p.mouse.click(b.x, b.y); await p.keyboard.up("Shift"); await h.fotogrammi(); }, leggi: ilFoglio },
  { n: 96, titolo: "Freccia giù nel foglio", partenza: SCHEDE, gesto: nelFoglio("ArrowDown"), leggi: ilFoglio },
  { n: 97, titolo: "Freccia destra nel foglio", partenza: SCHEDE, gesto: nelFoglio("ArrowRight"), leggi: ilFoglio },
  { n: 98, titolo: "Maiusc freccia giù nel foglio", partenza: SCHEDE, gesto: nelFoglio("Shift+ArrowDown"), leggi: ilFoglio },
  { n: 99, titolo: "Ctrl freccia giù nel foglio", partenza: SCHEDE, gesto: nelFoglio("Control+ArrowDown"), leggi: ilFoglio },
  { n: 100, titolo: "Invio nel foglio", partenza: SCHEDE, gesto: nelFoglio("Enter"), leggi: ilFoglio },
  { n: 101, titolo: "F2 nel foglio", partenza: SCHEDE, gesto: nelFoglio("F2"), leggi: ilFoglio },
  { n: 102, titolo: "Doppio clic nel foglio", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio()(p, h); const a = await puntoDelFoglio(p, ...A); await p.mouse.dblclick(a.x, a.y); await h.fotogrammi(); }, leggi: ilFoglio },
  { n: 103, titolo: "Scrivere 1000 e Invio nel foglio", partenza: SCHEDE, gesto: nelFoglio("1000", "Enter"), leggi: ilFoglio },
  // Se la battuta apre la cella, e se Invio scrive (riga 103).
  { n: "103-campo", titolo: "Scrivere 1000 nel foglio, senza Invio", partenza: SCHEDE, gesto: nelFoglio("ArrowDown", "ArrowRight", "1000"), leggi: ilFoglio },
  { n: "103-F2", titolo: "F2, scrivere 1000 e Invio nel foglio", partenza: SCHEDE, gesto: nelFoglio("ArrowDown", "ArrowRight", "F2", "Control+a", "1000", "Enter"), leggi: ilFoglio },
  { n: "103-dati", titolo: "Scrivere 1000 e Invio su una cella dei dati", partenza: SCHEDE, gesto: nelFoglio("ArrowDown", "ArrowRight", "1000", "Enter"), leggi: ilFoglio },
  { n: "107-dati", titolo: "Canc su una cella dei dati", partenza: SCHEDE, gesto: nelFoglio("ArrowDown", "ArrowRight", "Delete"), leggi: ilFoglio },
  // Il valore scritto resta? Si torna sulla cella e si legge il campo di F2.
  { n: "103-rilettura", titolo: "Scrivere 1000, Invio, tornare su e F2", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio("ArrowDown", "ArrowRight", "1000", "Enter")(p, h); await p.waitForTimeout(1000); await h.tasti("ArrowUp"); await h.tasti("F2"); }, leggi: ilFoglio },
  { n: "107-rilettura", titolo: "Canc su una cella dei dati, poi F2", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio("ArrowDown", "ArrowRight", "Delete")(p, h); await p.waitForTimeout(1000); await h.tasti("F2"); }, leggi: ilFoglio },
  { n: 104, titolo: "Tab nel foglio", partenza: SCHEDE, gesto: nelFoglio("Tab"), leggi: ilFoglio },
  { n: 105, titolo: "Maiusc Tab nel foglio", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio("ArrowRight")(p, h); await h.tasti("Shift+Tab"); }, leggi: ilFoglio },
  { n: 106, titolo: "Esc in modifica nel foglio", partenza: SCHEDE, gesto: nelFoglio("9", "Escape"), leggi: ilFoglio },
  { n: 107, titolo: "Canc nel foglio", partenza: SCHEDE, gesto: nelFoglio("Delete"), leggi: ilFoglio },
  { n: 108, titolo: "Ctrl A nel foglio", partenza: SCHEDE, gesto: nelFoglio("Control+a"), leggi: ilFoglio },
  { n: 109, titolo: "Maiusc giù, poi Esc nel foglio", partenza: SCHEDE, gesto: nelFoglio("Shift+ArrowDown", "Escape"), leggi: ilFoglio },
  { n: 110, titolo: "Esc senza selezione nel foglio", partenza: SCHEDE, gesto: nelFoglio("Escape"), leggi: ilFoglio },
  { n: 111, titolo: "Clic fuori dal foglio", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio()(p, h); await h.clic("I conti della casa", 3); }, leggi: ilFoglio },
  { n: 113, titolo: "Esc, poi Invio, sul foglio", partenza: SCHEDE, gesto: nelFoglio("Escape", "Enter"), leggi: ilFoglio },
  { n: 116, titolo: "Tasto destro sul foglio", partenza: SCHEDE, gesto: async (p, h) => { await nelFoglio()(p, h); const b = await puntoDelFoglio(p, ...B); await p.mouse.click(b.x, b.y, { button: "right" }); await h.fotogrammi(); }, leggi: vociDelMenu },

  // Le schede vive.
  { n: 117, titolo: "Clic sulla scheda PDF a riposo", partenza: SCHEDE, gesto: (p, h) => h.clicSu(`${PDF} .live-card-body`), leggi: leSchede },
  { n: 120, titolo: "Freccia destra sul PDF attivo", partenza: SCHEDE, gesto: async (p, h) => { await h.clicSu(`${PDF} .live-card-body`); await h.tasti("ArrowRight"); }, leggi: leSchede },
  { n: 121, titolo: "PageDown sul PDF attivo", partenza: SCHEDE, gesto: async (p, h) => { await h.clicSu(`${PDF} .live-card-body`); await h.tasti("PageDown"); }, leggi: leSchede },
  { n: 123, titolo: "Apri sulla scheda PDF", partenza: SCHEDE, gesto: async (p, h) => { await h.clicSu(`${PDF} .live-card-body`); await h.clicSu(`${PDF} .live-card-open`); }, leggi: (p) => p.evaluate(() => [...document.querySelectorAll(".pane")].filter((e) => e.getClientRects().length > 0).length + " riquadri; tab: " + (document.querySelector(".tab.active, [role=tab][aria-selected=true]")?.textContent?.trim() ?? "?")) },
  { n: 124, titolo: "Fine sulla scheda attiva", partenza: SCHEDE, gesto: async (p, h) => { await h.clicSu(`${PDF} .live-card-body`); await h.clicSu(`${PDF} .live-card-done`); }, leggi: leSchede },
  { n: 125, titolo: "Esc con la scheda attiva", partenza: SCHEDE, gesto: async (p, h) => { await h.clicSu(`${PDF} .live-card-body`); await h.tasti("Escape"); }, leggi: leSchede },
  { n: 133, titolo: "Tasto destro sulla scheda PDF", partenza: SCHEDE, gesto: (p, h) => h.clicSu(`${PDF} .live-card-body`, { button: "right" }), leggi: vociDelMenu },

  { n: 128, titolo: "Documento nella nota: scrivere", partenza: DOCLAV, gesto: async (p, h) => { await h.clicSu(`${DOCX} .live-card-body`); await h.scrivi("Zeta"); }, leggi: async (p) => ({ schede: await leSchede(p), scritto: await p.evaluate(() => document.querySelector('.pane.focus .live-card[data-card-kind="document"] .live-card-body')?.textContent?.includes("Zeta") ?? null) }) },
  { n: 129, titolo: "Documento nella nota: Esc", partenza: DOCLAV, gesto: async (p, h) => { await h.clicSu(`${DOCX} .live-card-body`); await h.tasti("Escape"); }, leggi: leSchede },
  { n: 130, titolo: "Lavagna nella nota: clic", partenza: DOCLAV, gesto: (p, h) => h.clicSu(`${LAV} .live-card-body`), leggi: schedeELavagna },
  {
    n: 131, titolo: "Lavagna nella nota: trascinare una scheda", partenza: DOCLAV,
    gesto: async (p, h) => { await h.clicSu(`${LAV} .live-card-body`); const b = await p.locator(`${LAV} .canvas-node`).first().boundingBox(); await h.trascina({ x: b.x + 10, y: b.y + 10 }, { x: b.x + 70, y: b.y + 40 }); },
    leggi: schedeELavagna,
  },
  { n: 132, titolo: "Lavagna nella nota: A tutta pagina", partenza: DOCLAV, gesto: async (p, h) => { await h.clicSu(`${LAV} .live-card-body`); await h.clicSu(`${LAV} .live-card-full`); }, leggi: async (p) => ({ schede: await leSchede(p), piena: await p.evaluate(() => document.querySelector('.pane.focus .live-card[data-card-kind="canvas"] .live-card-full')?.getAttribute("aria-pressed")) }) },
  // Il diagramma.
  { n: 135, titolo: "Tasto destro sul disegno", partenza: FUORI, gesto: menuDelDiagramma, leggi: ilDiagramma },
  { n: 136, titolo: "Passare su uno stile", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-style").nth(2).hover(); await h.fotogrammi(); }, leggi: ilDiagramma },
  {
    n: 137, titolo: "Uscire dagli stili senza scegliere", partenza: FUORI,
    gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-style").nth(2).hover(); await h.fotogrammi(); await p.locator(".diagram-menu-label").first().hover(); await h.fotogrammi(); },
    leggi: ilDiagramma,
  },
  { n: 138, titolo: "Stile per questo diagramma", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-style").nth(2).click(); await h.fotogrammi(); }, leggi: ilDiagramma },
  {
    n: 139, titolo: "Stile per tutti", partenza: FUORI,
    gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-segment", { hasText: "Tutti" }).first().click(); await p.locator(".diagram-menu-style").nth(2).click(); await h.fotogrammi(); },
    leggi: ilDiagramma,
  },
  { n: 140, titolo: "Orientamento da sinistra", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-segment", { hasText: "sinistra" }).first().click(); await h.fotogrammi(); }, leggi: ilDiagramma },
  { n: 141, titolo: "Ambito Tutti", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-segment", { hasText: "Tutti" }).first().click(); await h.fotogrammi(); }, leggi: ilDiagramma },
  { n: 143, titolo: "Menu: Ingrandisci", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await h.voce("Ingrandisci"); }, leggi: ilDiagramma },
  { n: 145, titolo: "Menu: Esporta", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await h.voce("Esporta"); }, leggi: vociDelMenu },
  { n: 146, titolo: "Esc sul menu dopo un passaggio", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-style").nth(2).hover(); await h.tasti("Escape"); }, leggi: ilDiagramma },
  { n: 147, titolo: "Clic fuori dal menu dopo un passaggio", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-style").nth(2).hover(); await p.mouse.click(5, 300); await h.fotogrammi(); }, leggi: ilDiagramma },
  { n: 149, titolo: "Scrivere nel sorgente", partenza: FUORI, gesto: async (p, h) => { await p.locator(DISEGNO).dblclick(); await h.fotogrammi(); await h.scrivi("\n  B --> C[Altro]"); await p.waitForTimeout(900); }, leggi: ilDiagramma },
  { n: 150, titolo: "Sorgente con una riga sbagliata", partenza: FUORI, gesto: async (p, h) => { await p.locator(DISEGNO).dblclick(); await h.fotogrammi(); await h.scrivi("\n  B -->"); await p.waitForTimeout(900); }, leggi: (p) => p.evaluate(() => document.querySelector(".pane.focus .cm-fub-diagram-notice, .pane.focus [class*=diagram-error]")?.textContent?.trim()?.slice(0, 120) ?? null) },
  { n: 151, titolo: "Tab nel sorgente", partenza: FUORI, gesto: async (p, h) => { await p.locator(DISEGNO).dblclick(); await h.fotogrammi(); await h.tasti("Tab"); }, leggi: ilDiagramma },
  { n: 152, titolo: "Esc nel sorgente", partenza: FUORI, gesto: async (p, h) => { await p.locator(DISEGNO).dblclick(); await h.fotogrammi(); await h.tasti("Escape"); }, leggi: ilDiagramma },
  { n: 153, titolo: "Fatto nella barra del diagramma", partenza: { ...FUORI, query: "formatbar=1" }, gesto: async (p, h) => { await p.locator(DISEGNO).dblclick(); await h.fotogrammi(); await h.clicSu(".pane.focus .cm-fub-code-done"); }, leggi: ilDiagramma },
  { n: 162, titolo: "Esc nel riquadro grande", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await h.voce("Ingrandisci"); await h.tasti("Escape"); }, leggi: ilDiagramma },
  // Il blocco del diagramma scelto davvero: si sceglie «Ultima riga.» e si sale.
  { n: "164-blocco", titolo: "Blocco del diagramma scelto (dal paragrafo sotto), Invio", partenza: FUORI, gesto: async (p, h) => { await h.clic("Ultima riga", 3); await h.tasti("Escape", "ArrowUp", "Enter"); }, leggi: ilDiagramma },
  { n: "165-blocco", titolo: "Blocco del diagramma scelto (dal paragrafo sotto), Spazio", partenza: FUORI, gesto: async (p, h) => { await h.clic("Ultima riga", 3); await h.tasti("Escape", "ArrowUp", "Space"); }, leggi: ilDiagramma },
  { n: "138-questo", titolo: "Vale per Questo, poi uno stile", partenza: FUORI, gesto: async (p, h) => { await menuDelDiagramma(p, h); await p.locator(".diagram-menu-segment", { hasText: "Questo" }).first().click(); await p.locator(".diagram-menu-style").nth(2).click(); await h.fotogrammi(); }, leggi: ilDiagramma },
  // Il blocco del diagramma scelto con un clic sul disegno.
  { n: "164-clic", titolo: "Clic sul disegno, poi Invio", partenza: FUORI, gesto: async (p, h) => { await h.clicSu(DISEGNO); await h.tasti("Enter"); }, leggi: ilDiagramma },
  { n: "165-clic", titolo: "Clic sul disegno, poi Spazio", partenza: FUORI, gesto: async (p, h) => { await h.clicSu(DISEGNO); await h.tasti("Space"); }, leggi: ilDiagramma },
  { n: "165-esc", titolo: "Esc dal sorgente, poi Spazio", partenza: FUORI, gesto: async (p, h) => { await p.locator(DISEGNO).dblclick(); await h.fotogrammi(); await h.tasti("Escape", "Space"); }, leggi: ilDiagramma },
  { n: 164, titolo: "Blocco del diagramma scelto, Invio", partenza: FUORI, gesto: async (p, h) => { await h.clic("Dopo la tabella", 3); await h.tasti("ArrowDown", "Escape", "Enter"); }, leggi: ilDiagramma },
  { n: 165, titolo: "Blocco del diagramma scelto, Spazio", partenza: FUORI, gesto: async (p, h) => { await h.clic("Dopo la tabella", 3); await h.tasti("ArrowDown", "Escape", "Space"); }, leggi: ilDiagramma },
];
