// La consegna dello strato d'avvio all'app.
//
// Lo strato (`.avvio`, in `index.html`, `mobile.html` e `document.html`) copre
// la pagina dal primo disegno; `#app`, lo skip-link e `#document-window` sono
// `inert` e `aria-busy` finché l'avvio non finisce. `consegna()` si chiama alla
// fine vera dell'avvio (`startup` della cornice, `bootDocumentWindow`) e rende
// l'app viva: toglie `inert`, rimette il fuoco al suo posto e porta via lo
// strato con il suo stile e i suoi attributi. Questa è la prima forma: subito,
// senza animazione e senza scrivere la cache `fub.avvio`. Senza strato (i test
// che montano un DOM loro, le pagine che non lo hanno) non fa niente.

/// Gli elementi che l'HTML tiene inerti sotto lo strato.
const INERTI = ["#app", ".skip-link", "#document-window"];

/// Dove va il fuoco se l'avvio l'ha lasciato sul `body`: le `focus()` fatte
/// durante l'avvio su un `#app` inerte si sono perse. Nell'ordine: ciò che si
/// scrive nel foglio attivo, il primo bottone della scelta del vault, i fogli.
const FUOCO = [
  ".pane.focus [contenteditable='true']",
  "#onboarding:not([hidden]) button:not([hidden])",
  "#panes",
];

export async function consegna(): Promise<void> {
  const strato = document.querySelector<HTMLElement>(".avvio");
  if (!strato) return;
  vivifica(strato);
  pulisci(strato);
}

/// L'app risponde: lo strato non prende più niente, `inert` e `aria-busy` se
/// ne vanno e il fuoco torna dove serve.
function vivifica(strato: HTMLElement): void {
  strato.dataset.consegna = "";
  strato.setAttribute("aria-hidden", "true");
  for (const selettore of INERTI) {
    for (const el of document.querySelectorAll<HTMLElement>(selettore)) {
      el.removeAttribute("inert");
      el.removeAttribute("aria-busy");
    }
  }
  const attivo = document.activeElement;
  if (attivo && attivo !== document.body && !strato.contains(attivo)) return;
  for (const selettore of FUOCO) {
    const bersaglio = document.querySelector<HTMLElement>(selettore);
    if (!bersaglio) continue;
    bersaglio.focus({ preventScroll: true });
    if (document.activeElement === bersaglio) return;
  }
}

/// Via lo strato, il suo stile e ciò che i due script hanno scritto su `<html>`.
function pulisci(strato: HTMLElement): void {
  strato.remove();
  document.getElementById("avvio-stile")?.remove();
  const root = document.documentElement;
  for (const nome of root.getAttributeNames()) {
    if (nome.startsWith("data-avvio")) root.removeAttribute(nome);
  }
  for (const proprieta of Array.from(root.style)) {
    if (proprieta.startsWith("--avvio-")) root.style.removeProperty(proprieta);
  }
}
