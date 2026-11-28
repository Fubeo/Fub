// Le voci della pagina «formule, lanciatore, menu contestuali, modi ed
// esporta PDF» (`docs/misure/gesti-editor/formule-lanciatore-menu-pagina.md`):
// `n` è la riga della tabella. Misura ridotta del 2026-11-28: ci sono solo le
// righe diverse, mancanti o non provate il 21/11; le uguali sono lette dal
// codice. Le righe dell'esportazione e delle schede incorporate (PDF, Word)
// sono lette dal codice e non hanno voce.
import { gridCellCenter, openBase, openWorkbook } from "../scene/gesti-documenti.mjs";
import { openBoard } from "../scene/gesti-scrittura.mjs";
import { riquadri, vociDelMenu, vociDelPannello } from "./letture.mjs";

export const DOC = "formule-lanciatore-menu-pagina.md";

const NOTA = {
  testo: "# Nota di prova\n\nUn {==passo commentato==}{>>@Prova: una nota<<} e @Chiara Neri qui.\n\nLa formula $v=1$ e poi $w=2$ qui.\n\n$$\nA=1\n$$\n\n- [ ] Un compito\n- Una voce\n\n## Un titolo\n\nUn paragrafo con [[Benvenuto]] e parole scelte dentro.\n\n```js\nlet a = 1;\n```\n\nUltima riga.",
};
const SCELTA = { testo: NOTA.testo.replace("parole scelte", "§parole scelte§") };
/// La Lettura: la nota si apre in Scrittura e Ctrl E la porta in Lettura
/// (la scena del banco aspetta un editor che in Lettura non c'è).
const inLettura = async (page, h) => { await h.tasti("Control+e"); await page.waitForTimeout(300); };
const SORGENTE = { ...NOTA, modo: "source" };

/// Ciò che dice l'editor della formula aperto: il LaTeX, il messaggio, il
/// suggerimento, quante formule sono aperte.
function laFormula(page) {
  return page.evaluate(() => {
    const aperti = [...document.querySelectorAll(".cm-fub-mx")].filter((e) => e.getClientRects().length > 0);
    const m = aperti[0];
    return {
      aperti: aperti.length,
      campo: m?.querySelector(".cm-fub-mx-input")?.textContent?.trim() ?? null,
      detto: m?.querySelector("[role=status]")?.textContent?.trim() ?? null,
      lista: [...(m?.querySelectorAll("[role=option]") ?? [])].map((o) => o.textContent.trim().slice(0, 30)).slice(0, 6),
    };
  });
}

/// La tavolozza della formula: il suggerimento, il gruppo scelto, quante
/// tessere si vedono e le prime.
function laTavolozza(page) {
  return page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const tessere = [...document.querySelectorAll(".cm-fub-mx-popover .cm-fub-mx-tile, .cm-fub-mx-popover .cm-fub-mx-symbol")].filter(vis);
    return {
      tip: [...document.querySelectorAll(".cm-fub-mx-tip")].filter(vis).map((e) => e.textContent.trim()).join(" "),
      gruppo: document.querySelector(".cm-fub-mx-group[aria-selected=true], .cm-fub-mx-group[aria-pressed=true]")?.textContent?.trim() ?? null,
      tessere: tessere.length,
      prime: tessere.slice(0, 5).map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()),
    };
  });
}

/// Apre la formula in riga (`k` = 0 la prima, 1 la seconda).
async function apri(page, h, k = 0) {
  await page.locator(".pane.focus .cm-content .cm-fub-math").nth(k).click();
  // L'editor della formula sta in un popover fuori dal riquadro.
  await page.locator(".cm-fub-mx-surface[data-state=ready]").first().waitFor({ timeout: 3_000 });
  await h.fotogrammi();
}
const inFormula = (...tasti) => async (page, h) => {
  await apri(page, h);
  await h.tasti("End");
  for (const t of tasti) {
    if (t.length > 1 && /^[A-Z]/.test(t)) await h.tasti(t);
    else await h.scrivi(t);
  }
  await page.waitForTimeout(150);
};

/// Il lanciatore: la pillola, poi ciò che si scrive e i tasti.
const lancia = (testo, ...tasti) => async (page, h) => {
  await page.click("#pill");
  await page.waitForSelector(".launcher-input:focus");
  if (testo) await page.fill(".launcher-input", testo);
  await page.waitForTimeout(250);
  if (tasti.length) await h.tasti(...tasti);
};
function ilLanciatore(page) {
  return page.evaluate(() => {
    const l = document.querySelector(".launcher-layer");
    if (!l) return "chiuso";
    const testo = (e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 50);
    return {
      righe: [...l.querySelectorAll(".launcher-row")].slice(0, 10).map(testo),
      nota: l.querySelector(".launcher-note") ? testo(l.querySelector(".launcher-note")) : null,
      crea: l.querySelector(".launcher-create") ? testo(l.querySelector(".launcher-create")) : null,
      fondo: [...l.querySelectorAll(".launcher-hints, .launcher-foot")].filter((e) => e.getClientRects().length > 0).map(testo).slice(0, 2),
      anteprima: [...l.querySelectorAll(".launcher-preview")].filter((e) => e.getClientRects().length > 0).map(testo).slice(0, 1),
    };
  });
}

/// Porta `testo` nella finestra (la nota è più alta dello schermo).
async function vedi(page, testo) {
  await page.evaluate(async (testo) => {
    const { findTextEditorOrThrow } = await import("/src/editors/text/test-support.ts");
    const view = findTextEditorOrThrow(document.querySelector(".pane.focus .pane-editor .cm-editor").parentElement);
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(testo) }, scrollIntoView: true });
  }, testo);
  await page.waitForTimeout(200);
}
/// Il tasto destro su un pezzo di testo, e le voci del menu.
const destro = (testo, k = 1) => async (page, h) => { await vedi(page, testo); await h.clic(testo, k, { button: "right" }); };

export const VOCI = [
  { n: "F1", titolo: "Clic sulla formula in riga", partenza: NOTA, gesto: (p, h) => apri(p, h), leggi: laFormula },
  { n: "F3", titolo: "Clic su un'altra formula con una aperta", partenza: NOTA, gesto: async (p, h) => { await apri(p, h, 0); await p.locator(".pane.focus .cm-content .cm-fub-math").nth(1).click(); await h.fotogrammi(); }, leggi: laFormula },
  { n: "F10", titolo: "«alpha» e spazio", partenza: NOTA, gesto: inFormula("+alpha "), leggi: laFormula },
  { n: "F13", titolo: "«sqrt» e spazio", partenza: NOTA, gesto: inFormula("+sqrt "), leggi: laFormula },
  { n: "F14", titolo: "«α»", partenza: NOTA, gesto: async (p, h) => { await apri(p, h); await h.tasti("End"); await p.keyboard.insertText("α"); await h.fotogrammi(); }, leggi: laFormula },
  { n: "F18", titolo: "«\\fr»", partenza: NOTA, gesto: inFormula("+\\fr"), leggi: laFormula },
  { n: "F19", titolo: "Esc con «\\fr»", partenza: NOTA, gesto: inFormula("+\\fr", "Escape"), leggi: laFormula },
  { n: "F20", titolo: "Tab con «\\fr»", partenza: NOTA, gesto: inFormula("+\\fr", "Tab"), leggi: laFormula },
  // Dal numeratore della frazione vuota (`\fr` e Tab, riga F20).
  { n: "F22", titolo: "Tab nella formula", partenza: NOTA, gesto: inFormula("+\\fr", "Tab", "1", "Tab", "2"), leggi: laFormula },
  { n: "F23", titolo: "Maiusc Tab nella formula", partenza: NOTA, gesto: inFormula("+\\fr", "Tab", "1", "Tab", "Shift+Tab", "3"), leggi: laFormula },
  { n: "F39", titolo: "Passaggio su una tessera", partenza: NOTA, gesto: async (p, h) => { await apri(p, h); await p.locator(".cm-fub-mx-tile").first().hover(); await h.fotogrammi(); }, leggi: laTavolozza },
  { n: "F40", titolo: "Cerca nella tavolozza", partenza: NOTA, gesto: async (p, h) => { await apri(p, h); await h.clicSu(".cm-fub-mx-all"); await p.locator(".cm-fub-mx-find-input").fill("radice"); await h.fotogrammi(); }, leggi: laTavolozza },
  { n: "F41", titolo: "Categoria della tavolozza", partenza: NOTA, gesto: async (p, h) => { await apri(p, h); await h.clicSu(".cm-fub-mx-all"); await p.locator(".cm-fub-mx-group").nth(2).click(); await h.fotogrammi(); }, leggi: laTavolozza },
  {
    n: "F42", titolo: "Clic sull'anteprima della formula", partenza: NOTA,
    gesto: async (p, h) => { await apri(p, h); const b = await p.locator(".cm-fub-mx-surface").first().boundingBox(); await p.mouse.click(b.x + 3, b.y + b.height / 2); await h.scrivi("q"); },
    leggi: laFormula,
  },
  { n: "F43", titolo: "Clic su un buco", partenza: NOTA, gesto: async (p, h) => { await inFormula("+\\fr", "Tab")(p, h); await p.locator(".cm-fub-mx-surface [data-fubhole]").first().click(); await h.scrivi("7"); }, leggi: laFormula },
  {
    n: "F29", titolo: "Clic fuori dal blocco aperto", partenza: NOTA,
    gesto: async (p, h) => {
      const b = await p.locator(".pane.focus .cm-content .math-block").first().boundingBox();
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await p.locator(".cm-fub-mx-surface[data-state=ready]").first().waitFor({ timeout: 3_000 });
      await h.clic("Un compito", 3);
    },
    leggi: laFormula,
  },
  { n: "F44", titolo: "Tasto destro sulla formula", partenza: NOTA, gesto: (p, h) => h.clicSu(".pane.focus .cm-content .cm-fub-math", { button: "right" }), leggi: vociDelMenu },
  { n: "F47", titolo: "«Da riga a blocco»", partenza: NOTA, gesto: async (p, h) => { await h.clicSu(".pane.focus .cm-content .cm-fub-math", { button: "right" }); await h.voce("Da riga a blocco"); } },
  { n: "F50", titolo: "«$» nel testo", partenza: NOTA, gesto: async (p, h) => { await vedi(p, "Ultima riga"); await h.clic("Ultima riga", 11); await h.scrivi(" $x"); } },

  { n: "L7", titolo: "Prefisso @", partenza: NOTA, gesto: lancia("@"), leggi: ilLanciatore },
  { n: "L8", titolo: "Prefisso /", partenza: NOTA, gesto: lancia("/"), leggi: ilLanciatore },
  { n: "L9", titolo: "Prefisso ?", partenza: NOTA, gesto: lancia("?"), leggi: ilLanciatore },
  { n: "L10", titolo: "Prefisso :", partenza: NOTA, gesto: lancia(":"), leggi: ilLanciatore },
  { n: "L15", titolo: "Alt Invio su una nota", partenza: NOTA, gesto: lancia("Benvenuto", "Alt+Enter"), leggi: riquadri },
  { n: "L16", titolo: "Ctrl Invio su una nota", partenza: NOTA, gesto: lancia("Benvenuto", "Control+Enter"), leggi: riquadri },
  { n: "L17", titolo: "Ctrl Maiusc Invio", partenza: NOTA, gesto: lancia("Benvenuto", "Control+Shift+Enter"), leggi: ilLanciatore },
  { n: "L18", titolo: "Maiusc Invio senza risultati", partenza: NOTA, gesto: lancia("Zqxw nuova", "Shift+Enter"), leggi: ilLanciatore },
  { n: "L20", titolo: "Tab su una nota", partenza: NOTA, gesto: lancia("Benvenuto", "Tab"), leggi: ilLanciatore },
  { n: "L26", titolo: "Clic sullo sfondo", partenza: NOTA, gesto: async (p, h) => { await lancia("")(p, h); await p.mouse.click(8, 790); await h.fotogrammi(); }, leggi: ilLanciatore },
  { n: "L27", titolo: "Nessun risultato", partenza: NOTA, gesto: lancia("Zqxw"), leggi: ilLanciatore },
  { n: "L30", titolo: "Comando Blocchi", partenza: NOTA, gesto: lancia(">Blocchi"), leggi: ilLanciatore },
  { n: "L32", titolo: "Comando Nuova nota", partenza: NOTA, gesto: lancia(">Nuova nota"), leggi: ilLanciatore },
  { n: "L33", titolo: "Comando Cronologia", partenza: NOTA, gesto: lancia(">Cronologia"), leggi: ilLanciatore },
  { n: "L34", titolo: "Comando Commenta", partenza: NOTA, gesto: lancia(">Commenta"), leggi: ilLanciatore },
  { n: "L36", titolo: "Comando Cerca nel vault", partenza: NOTA, gesto: lancia(">Cerca nel vault"), leggi: ilLanciatore },
  { n: "L37", titolo: "Anteprima della riga attiva", partenza: NOTA, gesto: lancia("Benvenuto"), leggi: ilLanciatore },
  { n: "L38", titolo: "Riga dei tasti in fondo, con un comando", partenza: NOTA, gesto: lancia(">Nuova nota"), leggi: ilLanciatore },

  { n: "C2", titolo: "Maiusc F10 nel blocco", partenza: NOTA, gesto: async (p, h) => { await h.clic("Un paragrafo", 3); await h.tasti("Shift+F10"); }, leggi: vociDelMenu },
  { n: "C3", titolo: "Tasto destro sulla selezione", partenza: SCELTA, gesto: async (p, h) => { await h.clic("parole scelte", 3, { button: "right" }); }, leggi: vociDelMenu },
  { n: "C6", titolo: "Frecce fra le tessere", partenza: SCELTA, gesto: async (p, h) => { await h.clic("parole scelte", 3, { button: "right" }); await h.tasti("ArrowRight", "ArrowRight"); }, leggi: (p) => p.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30)) },
  { n: "C7", titolo: "Tasto destro sul link", partenza: NOTA, gesto: destro("Benvenuto", 3), leggi: vociDelMenu },
  { n: "C8", titolo: "Tasto destro sul commento", partenza: NOTA, gesto: destro("passo commentato", 3), leggi: vociDelMenu },
  { n: "C9", titolo: "Tasto destro sulla persona", partenza: NOTA, gesto: destro("Chiara", 2), leggi: vociDelMenu },
  { n: "C12", titolo: "Tasto destro sul titolo", partenza: NOTA, gesto: destro("Un titolo", 3), leggi: vociDelMenu },
  { n: "C13", titolo: "Tasto destro sul compito", partenza: NOTA, gesto: destro("Un compito", 3), leggi: vociDelMenu },
  { n: "C14", titolo: "Tasto destro sull'elenco", partenza: NOTA, gesto: destro("Una voce", 3), leggi: vociDelMenu },
  { n: "C16", titolo: "Tasto destro sul codice", partenza: NOTA, gesto: destro("let a", 2), leggi: vociDelMenu },
  {
    n: "C24", titolo: "Tasto destro in Lettura", partenza: NOTA,
    gesto: async (p, h) => { await inLettura(p, h); await p.locator(".pane.focus :text('Un paragrafo') >> visible=true").first().click({ button: "right" }); await h.fotogrammi(); },
    leggi: vociDelMenu,
  },
  { n: "C25", titolo: "Tasto destro in Sorgente", partenza: SORGENTE, gesto: destro("Ultima riga", 3), leggi: vociDelMenu },
  { n: "C29", titolo: "Scrivere nel menu", partenza: NOTA, gesto: async (p, h) => { await h.clic("Un paragrafo", 3, { button: "right" }); await h.scrivi("cop"); }, leggi: vociDelMenu },
  { n: "C30", titolo: "Clic fuori dal menu", partenza: NOTA, gesto: async (p, h) => { await h.clic("Un paragrafo", 3, { button: "right" }); await p.mouse.click(1200, 400); await h.fotogrammi(); }, leggi: vociDelMenu },

  {
    n: "C17", titolo: "Tasto destro su una cella del foglio", partenza: { scena: (p) => openWorkbook(p), query: "workbook=1" },
    gesto: async (p, h) => { const c = await gridCellCenter(p, 1, 1); await p.mouse.click(c.x, c.y, { button: "right" }); await h.fotogrammi(); },
    leggi: vociDelMenu,
  },
  {
    n: "C18", titolo: "Tasto destro su una scheda della lavagna", partenza: { scena: (p) => openBoard(p, "Lavagne/Statistica.canvas"), query: "lavagna=1" },
    gesto: (p, h) => h.clicSu('.pane.focus .canvas-node[data-node="varianza"]', { button: "right" }),
    leggi: vociDelMenu,
  },
  { n: "C19", titolo: "Tasto destro su una riga della Base", partenza: { scena: (p) => openBase(p), query: "base=1&tipi=1" }, gesto: (p, h) => h.clicSu(".pane.focus .base-table tbody tr td:nth-child(2)", { button: "right" }), leggi: vociDelMenu },
  { n: "C20", titolo: "Tasto destro sulla testata della Base", partenza: { scena: (p) => openBase(p), query: "base=1&tipi=1" }, gesto: (p, h) => h.clicSu(".pane.focus .base-table thead th:nth-child(2)", { button: "right" }), leggi: vociDelMenu },
  { n: "P1", titolo: "Menu ⋯ della pagina", partenza: NOTA, gesto: (p, h) => h.clicSu(".pane.focus [data-pane-menu]"), leggi: vociDelMenu },
  { n: "M1", titolo: "Pulsante del modo", partenza: NOTA, gesto: (p, h) => h.clicSu("#status-mode"), leggi: vociDelMenu },
  { n: "M6", titolo: "Scrivere in Lettura", partenza: NOTA, gesto: async (p, h) => { await inLettura(p, h); await p.locator(".pane.focus :text('Un paragrafo') >> visible=true").first().click(); await h.scrivi("x"); } },
  {
    n: "M7", titolo: "«Modifica qui» in Lettura", partenza: NOTA,
    gesto: async (p, h) => { await inLettura(p, h); await p.locator(".pane.focus :text('Un paragrafo') >> visible=true").first().click({ button: "right" }); await h.voce("Modifica qui"); },
  },
  { n: "N1", titolo: "Pulsante Nuova nota", partenza: NOTA, gesto: (p, h) => h.clicSu("#new-note, [aria-label^='Crea un file nuovo'] >> visible=true"), leggi: vociDelMenu },
  { n: "E40", titolo: "Esc con un menu aperto", partenza: NOTA, gesto: async (p, h) => { await h.clicSu(".pane.focus [data-pane-menu]"); await h.tasti("Escape"); }, leggi: vociDelMenu },
];
