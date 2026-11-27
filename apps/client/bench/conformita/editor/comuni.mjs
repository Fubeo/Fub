// Le parti comuni della mappa dell'editor: gli stati, le misure e i passi.
// Un pezzo di `bench/conformita/mappa-editor.mjs`, che lo monta.

/// Gli stati.`larghezza` è quella del prototipo (`piena`, `700`,
/// `telefono`); `finestra` la finestra del banco dell'app che le corrisponde.
export const STATI = {
  "chiaro-1280": { luce: "light", prototipo: { luce: "giorno", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "scuro-1280": { luce: "dark", prototipo: { luce: "notte", larghezza: "piena" }, finestra: { width: 1280, height: 800 } },
  "chiaro-700": { luce: "light", prototipo: { luce: "giorno", larghezza: "700" }, finestra: { width: 700, height: 800 } },
  "scuro-700": { luce: "dark", prototipo: { luce: "notte", larghezza: "700" }, finestra: { width: 700, height: 800 } },
};

export const TUTTI = Object.keys(STATI);
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
