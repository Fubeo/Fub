// @vitest-environment happy-dom
// Un menu aperto non sta mai sotto un toast. La pila dei toast vive nel
// `body`, sopra `#app` che isola i suoi piani, e il menu nasce dentro `#app`:
// nessun `z-index` lo porta sopra. Il menu della modalità si apre dalla banda
// in basso a destra, dove scende la pila, e un guasto resta finché non lo si
// chiude (Scrittoio 2 T3). La regola della struttura fa da parte la pila
// finché un menu è aperto.
//
// happy-dom non applica `:has()` agli stili calcolati, ma lo sa confrontare:
// la prova legge il selettore vero da `structure.css` e lo confronta con la
// pila e il menu veri che montano `notify` e `showContextMenu`.
import { afterEach, describe, expect, it } from "vitest";
import structure from "../theme/scrittoio/structure.css?raw";
import { closeContextMenu, showContextMenu } from "./menu";
import { clearHistory, notify } from "./notify";

/// Le regole di `structure.css` che nascondono la pila dei toast.
function stackHidingSelectors(): string[] {
  const rules = [...structure.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  return rules
    .filter(([, , body]) => /visibility\s*:\s*hidden/.test(body!))
    .map(([, selector]) => selector!.trim())
    .filter((selector) => /\.toast-stack\s*$/.test(selector));
}

describe("il menu sopra il toast", () => {
  afterEach(() => {
    closeContextMenu();
    clearHistory();
    document.body.innerHTML = "";
  });

  it("col menu aperto la pila si fa da parte, e torna quando si chiude", () => {
    const selectors = stackHidingSelectors();
    expect(selectors).toHaveLength(1);
    const hides = selectors[0]!;

    document.body.innerHTML = `<div id="app"><main id="workspace"><button id="anchor">Live</button></main></div>`;
    notify("Benvenuto.md è cambiato su disco", "guasto");
    const stack = document.getElementById("toasts")!;
    expect(stack.matches(hides)).toBe(false);

    showContextMenu(document.getElementById("anchor")!, [{ label: "Lettura", run: () => {} }]);
    const menu = document.getElementById("context-menu")!;
    expect(menu.closest("#workspace")).not.toBeNull();
    expect(stack.matches(hides)).toBe(true);

    // Il menu esce con la sua animazione: finché c'è, la pila resta da parte;
    // tolto il menu, torna.
    closeContextMenu();
    menu.remove();
    expect(stack.matches(hides)).toBe(false);
  });
});
