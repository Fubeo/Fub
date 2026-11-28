// **Le letture delle sonde dei gesti**: ciò che lo stato generico di
// `stato.mjs` non dice e che più pagine chiedono (le voci di un menu, la voce
// attiva del «/», i pulsanti di una barra). Ognuna va nel campo `leggi` di
// una voce, e il suo esito finisce nel referto come `letto`.

/// Le voci del menu aperto più in alto (blocco, contesto, riquadro), in ordine.
export function vociDelMenu(page) {
  return page.evaluate(() => {
    const menu = [...document.querySelectorAll("[role=menu], .cm-fub-block-menu")].filter((m) => m.getClientRects().length > 0).pop();
    if (!menu) return "nessun menu";
    return [...menu.querySelectorAll("[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]")]
      .filter((v) => v.getClientRects().length > 0)
      .map((v) => (v.querySelector(".menu-label, .label")?.textContent ?? v.textContent).replace(/\s+/g, " ").trim().slice(0, 40));
  });
}

/// La voce attiva del pannello aperto («/», «@», «[[», ricerca), e le prime
/// voci in ordine.
export function vociDelPannello(page) {
  return page.evaluate(() => {
    const pannelli = [...document.querySelectorAll(".slash-panel, .cm-tooltip-autocomplete, [role=listbox]")].filter((m) => m.getClientRects().length > 0);
    const p = pannelli.pop();
    if (!p) return "nessun pannello";
    const testo = (v) => v.textContent.replace(/\s+/g, " ").trim().slice(0, 40);
    const voci = [...p.querySelectorAll("[role=option], li")].filter((v) => v.getClientRects().length > 0);
    const attiva = voci.find((v) => v.getAttribute("aria-selected") === "true" || v.classList.contains("is-active") || v.classList.contains("active"));
    return { attiva: attiva ? testo(attiva) : null, voci: voci.slice(0, 12).map(testo) };
  });
}

/// I nomi dei pulsanti della barra di formato del riquadro a fuoco.
export function pulsantiDellaBarra(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".pane.focus [class*=format-bar] button")]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()),
  );
}

/// I riquadri aperti e la sbirciata: il titolo di ogni `.pane` visibile, e
/// la sbirciata aperta (`.note-peek`), col suo nome.
export function riquadri(page) {
  return page.evaluate(() => ({
    sbirciata: document.querySelector(".note-peek")?.getAttribute("aria-label") ?? null,
    riquadri: [...document.querySelectorAll(".pane")]
      .filter((p) => p.getClientRects().length > 0)
      .map((p) => (p.querySelector("[class*=title], h1")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)),
  }));
}

/// I pulsanti della scheda che compare sopra un link (anteprima).
export function pulsantiDellaScheda(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".kit-hover-card button, .kit-hover-card [role=button]")]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()),
  );
}

/// I nomi dei pulsanti della minibarra della selezione.
export function pulsantiDellaMinibarra(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".selection-bubble button")]
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()),
  );
}
