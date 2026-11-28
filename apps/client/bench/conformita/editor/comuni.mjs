// Le parti comuni della mappa dell'editor: gli stati, le misure e i passi.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.
import { readFileSync } from "node:fs";

/// Gli stati.`larghezza` è quella del prototipo (`piena`, `700`,
/// `telefono`); `finestra` la finestra del banco dell'app che le corrisponde.
export const STATI = {
  "chiaro-1280": { luce: "light", prototipo: { luce: "giorno", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "scuro-1280": { luce: "dark", prototipo: { luce: "notte", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "chiaro-700": { luce: "light", prototipo: { luce: "giorno", larghezza: "700" }, finestra: { width: 700, height: 800 } },
  "scuro-700": { luce: "dark", prototipo: { luce: "notte", larghezza: "700" }, finestra: { width: 700, height: 800 } },
  ...statiDeiFogli([620, 540, 400, 340]),
};

/// Gli stati della finestra intera, quelli di quasi ogni vista.
export const TUTTI = ["chiaro-1280", "scuro-1280", "chiaro-700", "scuro-700"];
/// Gli stati dei fogli stretti della cornice (`statiDeiFogli`).
export const FOGLI = Object.keys(STATI).filter((id) => id.includes("-foglio-"));

/// I fogli stretti (controllo del 2026-11-28, parte 2). Nella cornice
/// l'editor sta dentro un foglio (`.pane > .pane-sheet > .win`), e le regole
/// di `src/embed.css` del simulatore «Fub, la cornice nuova» lo cambiano con
/// le query del contenitore `pane` (620, 540, 400 e 340 px). Il prototipo da
/// solo quelle regole non le ha: `cornice-embed.css` ne è la copia byte per
/// byte (sha256 634dc99a…), e lo stato le applica dal lato del prototipo come
/// fa la cornice, avvolgendo `#win` nel foglio con le sole regole di
/// `frame.css` che fanno il contenitore (`.pane`, riga 104; `.pane-sheet`,
/// riga 153). Dal lato dell'app il foglio a fuoco prende la stessa larghezza.
/// Una finestra larga dai due lati: la larghezza è quella del foglio.
function statiDeiFogli(larghezze) {
  const stati = {};
  for (const larghezza of larghezze) {
    for (const [nome, luce, luceProto] of [["chiaro", "light", "giorno"], ["scuro", "dark", "notte"]]) {
      stati[`${nome}-foglio-${larghezza}`] = {
        luce,
        prototipo: { luce: luceProto, larghezza: "piena", monta: (page) => montaNelFoglio(page, larghezza) },
        app: { monta: (page) => stringiIlFoglio(page, larghezza) },
        finestra: { width: 1280, height: 800 },
      };
    }
  }
  return stati;
}

async function montaNelFoglio(page, larghezza) {
  const css = readFileSync(new URL("./cornice-embed.css", import.meta.url), "utf8");
  await page.evaluate(
    ({ css: regole, larghezza: l }) => {
      const win = document.getElementById("win");
      const stile = document.createElement("style");
      stile.textContent = regole;
      document.head.append(stile);
      const pane = document.createElement("div");
      pane.className = "pane";
      pane.style.cssText = `display: flex; flex-direction: column; position: relative; isolation: isolate; container: pane / inline-size; flex: none; width: ${l}px; height: 900px;`;
      const sheet = document.createElement("div");
      sheet.className = "pane-sheet";
      sheet.style.cssText = "position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: 12px;";
      win.before(pane);
      pane.append(sheet);
      sheet.append(win);
    },
    { css, larghezza },
  );
  await page.waitForFunction((l) => Math.round(document.getElementById("win").getBoundingClientRect().width) === l, larghezza);
}

async function stringiIlFoglio(page, larghezza) {
  await page.evaluate((l) => {
    document.querySelector(".pane.focus").style.flex = `0 0 ${l}px`;
  }, larghezza);
  await page.waitForFunction(
    (l) => Math.round(document.querySelector(".pane.focus").getBoundingClientRect().width) === l,
    larghezza,
  );
}
/// L'anteprima del lanciatore c'è solo dove c'è posto: il prototipo la
/// nasconde a 700 px (riga 651), l'app sotto i 960 px (`PREVIEW_MIN_WIDTH`).
export const LARGHI = ["chiaro-1280", "scuro-1280"];

/// Riporta in cima il pannello delle sezioni, toglie il fuoco e porta via il
/// puntatore: gli stessi pezzi a riposo dai due lati.
export async function chiudiPannello(page, pannello) {
  await page.evaluate((selector) => {
    const side = document.querySelector(selector);
    if (side) side.scrollTop = 0;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, pannello);
  await page.mouse.move(0, 0);
}

/// Porta il giro del prototipo al passo che si chiama `titolo`, dai pallini
/// della guida (ognuno ha il titolo «n. Nome del passo»): per nome, non per
/// numero, così un passo aggiunto in mezzo non sposta la vista.
export async function passo(page, titolo) {
  await page.click(`#tour-steps [data-step][title$=". ${titolo}"]`);
}

export const DIMENSIONI = ["width", "height"];
export const ALLINEAMENTO = ["display", "align-items", "justify-content"];
